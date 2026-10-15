// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { buildASTSchema, executeSync, type DocumentNode } from 'graphql'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'

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
    tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100' },
    entry: { _id: 'stub:1', status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 },
  }],
}
// every mutation the page sends, by operation name
const sent: { operation: string, input: { uri?: string, trackers: string[], entry?: Record<string, unknown> } }[] = []
// a write answers once this settles, so a test can keep one in flight
let held: Promise<unknown> = Promise.resolve()
const mutate = (operation: string) => async ({ input }: { input: (typeof sent)[number]['input'] }) => {
  sent.push({ operation, input })
  await held
  const outcomes = input.trackers.map(tracker => ({ tracker, outcome: 'SAVED' }))
  return { data: { saveListEntry: outcomes, deleteListEntry: outcomes } }
}
// a subscription is answered by running its own document against the worker's schema, so the page
// sees exactly the fields it asks for. The tracking is what the worker answered for the uri subscribed
// on so far; one with no answer yet hands back that hook's last result, as urql keeps it until the new
// subscription answers.
const schema = buildASTSchema(typeDefs)
const answered = new Map<string, unknown>()
// every uri the tracking was asked on, in order
const asked: string[] = []
vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: ({ query, variables, pause }: { query: DocumentNode, variables?: { input: { uri?: string } }, pause?: boolean }) => {
      const kept = useRef<unknown>(undefined)
      if (!variables) return [{ data: executeSync({ schema, document: query, rootValue: {} }).data }]
      const uri = variables.input.uri
      if (!pause && uri && asked.at(-1) !== uri) asked.push(uri)
      if (!pause && uri && answered.has(uri)) kept.current = executeSync({ schema, document: query, rootValue: { tracking: answered.get(uri) }, variableValues: variables }).data
      return [{ data: kept.current }]
    },
    useMutation: (document: { definitions: { name?: { value: string } }[] }) => [{}, mutate(document.definitions[0]?.name?.value ?? '')],
  }
})
const isSiteConnected = vi.hoisted(() => () => false)
vi.mock('../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected }))
const remembered = vi.hoisted(() => ({ recordTrackerAnswers: vi.fn(), siteStatuses: { record: () => {} } }))
vi.mock('../../../src/tracking/site-status', () => remembered)
// the page's worker, which Unlock asks to check the account again
vi.mock('../../../src/worker', () => ({ trackerCheck: async () => {} }))

const { default: MediaTracking } = await import('../../../src/components/media-tracking')
const { createCompactPrefs } = await import('../../../src/tracking/compact-prefs')

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

const hosts: HTMLElement[] = []
beforeEach(() => { answered.set('media:1', tracking) })
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  sent.length = 0
  asked.length = 0
  answered.clear()
  held = Promise.resolve()
})
// `work` is what the page asks its details on, `address` the page's own, `uri` the media its details
// answered with; `address` is `work` unless given
type Shown = { work: string | undefined, address?: string, uri: string | undefined }
// `show` is the page moving on, or the worker answering, and the row drawn again
const render = (initial: Shown = { work: 'media:1', uri: 'media:1' }, store = createCompactPrefs(memory())) => {
  let shownBy: (next: Shown) => void = () => {}
  const Harness = () => {
    const [{ work, address = work, uri }, setShown] = useState(initial)
    shownBy = setShown
    return <MediaTracking work={work} address={address} uri={uri} title="A show" episodeCount={12} prefsStore={store}/>
  }
  const host = mount(<Harness/>)
  hosts.push(host)
  return { host, show: async (next: Shown) => { await act(async () => { shownBy({ ...next }) }) } }
}
describe('the media tracking', () => {
  // what the trackers answer is what stub knows of their sites' sessions, shown under Settings, Accounts
  test('hands the trackers\' answers to the remembered sign-in states, for the sites connected here', () => {
    render()
    expect(remembered.recordTrackerAnswers).toHaveBeenCalledWith(
      [expect.objectContaining({ state: 'LISTED', tracker: expect.objectContaining({ id: 'stub' }) })],
      remembered.siteStatuses,
      isSiteConnected,
    )
  })

  test('shows the row and nothing else, even for a device that had the advanced panel open', () => {
    const storage = memory()
    storage.setItem('stub.tracking.compact', JSON.stringify({ advanced: true, targets: {} }))
    const { host } = render(undefined, createCompactPrefs(storage))
    expect([...host.querySelectorAll('section')].map(section => section.classList.contains('tracking-compact'))).toEqual([true])
    expect(host.querySelector('#tracking-advanced, .tracking')).toBeNull()
  })

  test('a + saves to one tracker with only the fields it changed', async () => {
    vi.useFakeTimers()
    const { host } = render()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="One episode more"]')!.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(sent.map(({ operation }) => operation)).toEqual(['SaveListEntry'])
    const { input } = sent[0]!
    expect(input.trackers).toEqual(['stub'])
    expect(input.entry).toStrictEqual({ progress: 4 })
  })

  test('Remove from list deletes the entry on the tracker that lists it', async () => {
    const { host } = render()
    const select = host.querySelector<HTMLSelectElement>('select[name="compact-status"]')!
    Object.defineProperty(select, 'value', { value: 'REMOVE', configurable: true })
    await act(async () => { select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(sent).toEqual([{ operation: 'DeleteListEntry', input: { uri: 'media:1', trackers: ['stub'] } }])
  })
})

const trackerOf = (id: string) => ({ id, name: id, canWrite: true, scoreScale: 'POINT_100' })
const answer = (tracker: string, uri: string, state: string, entry: Record<string, unknown> | null = null) =>
  ({ _id: `answer:${tracker}:${uri}`, state, candidates: [], tracker: trackerOf(tracker), entry: entry && { _id: `${tracker}:1`, ...entry } })
const trackingFor = (uri: string, answers: ReturnType<typeof answer>[], summary: Record<string, unknown> | null = null) =>
  ({ _id: `tracking:${uri}`, summary: summary && { _id: `summary:${uri}`, ...summary }, disagreements: [], answers })

const chips = (host: HTMLElement) => [...host.querySelectorAll('[data-chip]')].map(chip => `${chip.getAttribute('data-chip')}${chip.classList.contains('loading') ? ' loading' : ''}`)
const status = (host: HTMLElement) => host.querySelector<HTMLSelectElement>('select[name="compact-status"]')?.getAttribute('value')
const progress = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[name="compact-progress"]')?.getAttribute('value')

describe('while the media gains ids', () => {
  const NARROW = 'ag:(anilist:1)'
  const WIDE = 'ag:(anilist:1,mal:1)'
  const watching = { status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 }

  test('no chip drops out and the row keeps its values until the trackers have answered for the grown uri', async () => {
    answered.set(NARROW, trackingFor(NARROW, [answer('anilist', NARROW, 'LISTED', watching), answer('mal', NARROW, 'NOT_LISTED'), answer('stub', NARROW, 'NOT_LISTED')], watching))
    const { host, show } = render({ work: NARROW, uri: NARROW })
    expect(chips(host)).toEqual(['anilist', 'mal', 'stub'])

    // the grown uri's first answer, before AniList has read anilist.co again
    answered.set(WIDE, trackingFor(WIDE, [answer('anilist', WIDE, 'LOADING'), answer('mal', WIDE, 'NOT_LISTED'), answer('stub', WIDE, 'NOT_LISTED')]))
    await show({ work: NARROW, uri: WIDE })
    expect(chips(host)).toEqual(['anilist', 'mal', 'stub'])
    expect(status(host)).toBe('WATCHING')
    expect(progress(host)).toBe('3')

    answered.set(WIDE, trackingFor(WIDE, [answer('anilist', WIDE, 'LISTED', { ...watching, progress: 4 }), answer('mal', WIDE, 'NOT_LISTED'), answer('stub', WIDE, 'NOT_LISTED')], { ...watching, progress: 4 }))
    await show({ work: NARROW, uri: WIDE })
    expect(progress(host), "the grown uri's own answer, once it has heard from every tracker").toBe('4')
  })

  test('a tracker with no id for the narrow uri shows as loading once the grown one gives it one', async () => {
    const NAMELESS = 'ag:(cr:1)'
    const NAMED = 'ag:(anilist:1,cr:1)'
    answered.set(NAMELESS, trackingFor(NAMELESS, [answer('anilist', NAMELESS, 'NO_ID'), answer('stub', NAMELESS, 'LISTED', watching)], watching))
    const { host, show } = render({ work: NAMELESS, uri: NAMELESS })
    expect(chips(host)).toEqual(['stub'])

    answered.set(NAMED, trackingFor(NAMED, [answer('anilist', NAMED, 'LOADING'), answer('stub', NAMED, 'LISTED', watching)], watching))
    await show({ work: NAMELESS, uri: NAMED })
    expect(chips(host)).toEqual(['anilist loading', 'stub'])
  })

  test('the control: a tracker the narrow uri was still loading does not hold back the grown uri', async () => {
    answered.set(NARROW, trackingFor(NARROW, [answer('anilist', NARROW, 'LOADING'), answer('stub', NARROW, 'NOT_LISTED')]))
    const { host, show } = render({ work: NARROW, uri: NARROW })
    expect(chips(host)).toEqual(['anilist loading', 'stub'])

    answered.set(WIDE, trackingFor(WIDE, [answer('anilist', WIDE, 'LOADING'), answer('stub', WIDE, 'LISTED', watching)], watching))
    await show({ work: NARROW, uri: WIDE })
    expect(status(host)).toBe('WATCHING')
  })

  test('follows a media that names none of the uri the page asked on, as a show whose details are its first season', async () => {
    const SHOW = 'ag:(jw:1)'
    const SEASON = 'ag:(appletv:2-s1,jw:1-10)'
    answered.set(SHOW, trackingFor(SHOW, [answer('stub', SHOW, 'LISTED', watching)], watching))
    answered.set(SEASON, trackingFor(SEASON, [answer('stub', SEASON, 'NOT_LISTED')]))
    const { host, show } = render({ work: SHOW, uri: SHOW })
    expect(status(host)).toBe('WATCHING')

    await show({ work: SHOW, uri: SEASON })
    expect(status(host), "the season's own entry, the one a change saves to").toBe('')
  })
})

describe('a title opened from another title', () => {
  const A = 'ag:(anilist:1)'
  const B = 'ag:(anilist:2)'
  const completed = { status: 'COMPLETED', progress: 12, score: 90, episodeCount: 12 }

  test("never shows the other title's tracking, and shows its own once it answers", async () => {
    answered.set(A, trackingFor(A, [answer('stub', A, 'LISTED', completed)], completed))
    const { host, show } = render({ work: A, uri: A })
    expect(status(host)).toBe('COMPLETED')

    // the address names B, for the render before the page asks its details on B
    await show({ work: A, address: B, uri: A })
    expect(host.querySelector('.tracking-compact')).toBeNull()

    // the page asks on B while its details are still A's
    await show({ work: B, uri: undefined })
    expect(host.querySelector('.tracking-compact')).toBeNull()

    // B's details are in, and B's trackers have not answered
    await show({ work: B, uri: B })
    expect(host.querySelector('.tracking-compact')).toBeNull()

    answered.set(B, trackingFor(B, [answer('stub', B, 'NOT_LISTED')]))
    await show({ work: B, uri: B })
    expect(chips(host)).toEqual(['stub'])
    expect(status(host)).toBe('')
  })

  test('is asked on the page as soon as it opens, and draws what answered there once its details are in', async () => {
    const B_GROWN = 'ag:(anilist:2,mal:2)'
    answered.set(A, trackingFor(A, [answer('stub', A, 'LISTED', completed)], completed))
    answered.set(B, trackingFor(B, [answer('anilist', B, 'NOT_LISTED'), answer('stub', B, 'NOT_LISTED')]))
    const { host, show } = render({ work: A, uri: A })

    await show({ work: B, uri: undefined })
    expect(asked).toEqual([A, B])
    expect(host.querySelector('.tracking-compact'), "drawn before its details, it would show the episode count of whatever the page holds").toBeNull()

    // B's details answered with a grown uri nothing has answered for yet
    await show({ work: B, uri: B_GROWN })
    expect(asked).toEqual([A, B, B_GROWN])
    expect(chips(host)).toEqual(['anilist', 'stub'])
  })

  const watching = { status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 }
  const more = (host: HTMLElement) => act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="One episode more"]')!.click() })
  // the renders of a title opened from A's row, as the page goes through them
  const openB = async (show: (next: Shown) => Promise<void>) => {
    await show({ work: A, address: B, uri: A })
    await show({ work: B, uri: undefined })
    await show({ work: B, uri: B })
  }
  const saves = () => sent.map(({ input: { uri, entry } }) => [uri, entry])

  test('a + pressed on one title is saved to it, though another opens before the save goes', async () => {
    vi.useFakeTimers()
    answered.set(A, trackingFor(A, [answer('stub', A, 'LISTED', watching)], watching))
    answered.set(B, trackingFor(B, [answer('stub', B, 'LISTED', completed)], completed))
    const { host, show } = render({ work: A, uri: A })
    await more(host)
    expect(sent).toEqual([])
    await openB(show)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(saves()).toEqual([[A, { progress: 4 }]])
  })

  test('a + waiting behind a save still in flight is saved to its own title too', async () => {
    vi.useFakeTimers()
    answered.set(A, trackingFor(A, [answer('stub', A, 'LISTED', watching)], watching))
    answered.set(B, trackingFor(B, [answer('stub', B, 'LISTED', completed)], completed))
    let land = () => {}
    held = new Promise<void>(resolve => { land = resolve })
    const { host, show } = render({ work: A, uri: A })
    await more(host)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await more(host)
    await openB(show)
    await act(async () => {
      land()
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(saves()).toEqual([[A, { progress: 4 }], [A, { progress: 5 }]])
  })
})
