// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'preact/test-utils'

import type { PanelTracking } from '../../../src/components/tracking-panel'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'SlidersHorizontal', 'Smile', 'Star'].map(name => [name, () => null])))

const tracking: PanelTracking = {
  summary: { _id: 'summary:x', status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 },
  disagreements: [],
  answers: [{
    _id: 'answer:stub',
    state: 'LISTED',
    candidates: [],
    tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100' },
    entry: { _id: 'stub:1', status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 },
  }],
}
const save = vi.fn(async (_variables: unknown) => ({ data: { saveListEntry: [{ tracker: 'stub', outcome: 'SAVED' }] } }))
vi.mock('urql', () => ({
  useSubscription: () => [{ data: { tracking } }],
  useMutation: () => [{}, save],
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
})
const render = (store = createCompactPrefs(memory())) => {
  const host = mount(<MediaTracking uri="media:1" title="A show" episodeCount={12} prefsStore={store}/>)
  hosts.push(host)
  return host
}
const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[aria-label="Advanced tracking"]')!

describe('the media tracking', () => {
  test('shows the row alone by default, the panel below it once Advanced is on, and remembers it', async () => {
    const store = createCompactPrefs(memory())
    const host = render(store)
    expect(host.querySelector('.tracking-compact')).toBeTruthy()
    expect(host.querySelector('#tracking-advanced')).toBeNull()

    await act(async () => { toggle(host).click() })
    expect(toggle(host).getAttribute('aria-expanded')).toBe('true')
    const sections = [...host.querySelectorAll('section')].map(section => section.classList.contains('tracking-compact') ? 'row' : section.classList.contains('tracking') ? 'panel' : '?')
    expect(sections).toEqual(['row', 'panel'])
    expect(host.querySelector('#tracking-advanced .tracking')).toBeTruthy()
    expect(store.read().advanced).toBe(true)

    unmount(hosts.pop()!)
    expect(render(store).querySelector('#tracking-advanced')).toBeTruthy()
  })

  test('a + saves to one tracker with only the fields it changed', async () => {
    vi.useFakeTimers()
    const host = render()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="One episode more"]')!.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(save).toHaveBeenCalledTimes(1)
    const { input } = save.mock.calls[0]![0] as { input: { trackers: string[], entry: Record<string, unknown> } }
    expect(input.trackers).toEqual(['stub'])
    expect(input.entry).toEqual({ progress: 4 })
    expect('status' in input.entry || 'score' in input.entry).toBe(false)
  })
})
