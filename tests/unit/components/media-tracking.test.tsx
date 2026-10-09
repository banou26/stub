// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { buildASTSchema, executeSync, type DocumentNode } from 'graphql'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { typeDefs } from '../../../src/generated/schema/typeDefs.generated'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Smile', 'Star'].map(name => [name, () => null])))

const tracking = {
  _id: 'tracking:media:1',
  summary: { _id: 'summary:media:1', status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 },
  disagreements: [],
  answers: [{
    _id: 'answer:stub:media:1',
    state: 'LISTED',
    candidates: [],
    tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100', writeNotice: 'A save here shows on your public profile.' },
    entry: { _id: 'stub:1', status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 },
  }],
}
// every mutation the page sends, by operation name
const sent: { operation: string, input: { trackers: string[], entry?: Record<string, unknown> } }[] = []
const mutate = (operation: string) => async ({ input }: { input: (typeof sent)[number]['input'] }) => {
  sent.push({ operation, input })
  const outcomes = input.trackers.map(tracker => ({ tracker, outcome: 'SAVED' }))
  return { data: { saveListEntry: outcomes, deleteListEntry: outcomes } }
}
// a subscription is answered by running its own document against the worker's schema, so the page
// sees exactly the fields it asks for
const schema = buildASTSchema(typeDefs)
vi.mock('urql', () => ({
  useSubscription: ({ query, variables }: { query: DocumentNode, variables?: Record<string, unknown> }) =>
    [{ data: executeSync({ schema, document: query, rootValue: { tracking }, variableValues: variables }).data }],
  useMutation: (document: { definitions: { name?: { value: string } }[] }) => [{}, mutate(document.definitions[0]?.name?.value ?? '')],
}))
vi.mock('../../../src/tracking/site-sessions', () => ({ trackerSignIns: {} }))
// the page's worker, which Unlock asks to check the account again
vi.mock('../../../src/worker', () => ({ trackerCheck: async () => {} }))

const { default: MediaTracking } = await import('../../../src/components/media-tracking')
const { createCompactPrefs } = await import('../../../src/tracking/compact-prefs')

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  sent.length = 0
})
const render = (store = createCompactPrefs(memory())) => {
  const host = mount(<MediaTracking uri="media:1" title="A show" episodeCount={12} prefsStore={store}/>)
  hosts.push(host)
  return host
}
describe('the media tracking', () => {
  test('shows the row and nothing else, even for a device that had the advanced panel open', () => {
    const storage = memory()
    storage.setItem('stub.tracking.compact', JSON.stringify({ advanced: true, targets: {} }))
    const host = render(createCompactPrefs(storage))
    expect([...host.querySelectorAll('section')].map(section => section.classList.contains('tracking-compact'))).toEqual([true])
    expect(host.querySelector('#tracking-advanced, .tracking')).toBeNull()
  })

  test('a + saves to one tracker with only the fields it changed', async () => {
    vi.useFakeTimers()
    const host = render()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="One episode more"]')!.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(sent.map(({ operation }) => operation)).toEqual(['SaveListEntry'])
    const { input } = sent[0]!
    expect(input.trackers).toEqual(['stub'])
    expect(input.entry).toStrictEqual({ progress: 4 })
  })

  test('Remove from list deletes the entry on the tracker that lists it', async () => {
    const host = render()
    const select = host.querySelector<HTMLSelectElement>('select[name="compact-status"]')!
    Object.defineProperty(select, 'value', { value: 'REMOVE', configurable: true })
    await act(async () => { select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(sent).toEqual([{ operation: 'DeleteListEntry', input: { uri: 'media:1', trackers: ['stub'] } }])
  })

  test("a tracker's card says what a write there does beyond the list", async () => {
    const host = render()
    await act(async () => { host.querySelector('[data-chip="stub"]')!.dispatchEvent(new Event('focusin', { bubbles: true })) })
    expect(host.querySelector('[data-card="stub"]')!.textContent).toContain('A save here shows on your public profile.')
  })
})
