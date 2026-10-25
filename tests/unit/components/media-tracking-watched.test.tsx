// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import type { CompactTracking } from '../../../src/tracking/compact'
import type { PlaybackLink } from '../../../src/party/bridge'
import type { PlaybackSource } from '../../../src/party/plugin-link'
import type { PlaybackState } from '../../../src/party/protocol'

import { pluginPlaybackLink } from '../../../src/party/plugin-link'

const answer = (id: string, name: string, state: string, entry?: object) =>
  ({ _id: `answer:${id}`, state, candidates: [], error: null, episodeCount: 12, tracker: { id, name, canWrite: true }, entry: entry ?? null })
const listedAt = (progress: number) => answer('anilist', 'AniList', 'LISTED', { status: 'WATCHING', progress, episodeCount: 12 })
let tracking: CompactTracking | undefined
const sent: { trackers: string[], entry: Record<string, unknown>, title?: string, cover?: string, episodeCount?: number }[] = []
let outcome: { outcome: string, error?: string } = { outcome: 'SAVED' }

vi.mock('urql', () => ({
  useSubscription: () => [{ data: tracking && { tracking } }],
  useMutation: () => [{}, async ({ input }: { input: (typeof sent)[number] }) => {
    sent.push(input)
    return { data: { saveListEntry: input.trackers.map(tracker => ({ tracker, ...outcome })) } }
  }],
}))

vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Smile', 'Star'].map(name => [name, () => null])))
vi.mock('../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
vi.mock('../../../src/tracking/site-status', () => ({ recordTrackerAnswers: () => {}, siteStatuses: {} }))
vi.mock('../../../src/tracking/fkn-cloud-live', () => ({ unlockTracker: async () => false }))
vi.mock('../../../src/worker', () => ({ trackerCheck: async () => {} }))

const { default: MediaTracking } = await import('../../../src/components/media-tracking')
const { createCompactPrefs } = await import('../../../src/tracking/compact-prefs')

// the saves the last render started come back
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

type Report = { paused: boolean, time?: number, ended?: boolean }
// a player as the watch page hears it; `duration` only where the player says how long it is
const fakeLink = (duration?: number) => {
  const listeners = new Set<(state: PlaybackState) => void>()
  let ended = false
  return {
    apply: () => {},
    onReport: (listener: (state: PlaybackState) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ended: () => ended,
    ...duration ? { duration: () => duration } : {},
    dispose: () => listeners.clear(),
    report: async (...states: Report[]) => {
      await act(async () => {
        for (const { paused, time = 0, ended: atEnd = false } of states) {
          ended = atEnd
          for (const listener of listeners) listener({ paused, time, rate: 1, at: Date.now() })
        }
      })
      await settle()
    },
  }
}
type Linked = PlaybackLink & Pick<ReturnType<typeof fakeLink>, 'report'>
// a source plugin's player that says its length, through the link the watch page makes of it
const pluginLink = (duration: number): Linked => {
  let ear: Parameters<NonNullable<PlaybackSource['onPlayback']>>[0] = () => {}
  const link = pluginPlaybackLink({ onPlayback: async listener => { ear = listener }, applyPlayback: async () => {} })!
  return {
    ...link,
    report: async (...states) => {
      await act(async () => {
        for (const { paused, time = 0, ended = false } of states) ear({ paused, time, rate: 1, at: Date.now(), ended, duration })
      })
      await settle()
    },
  }
}
const memory = (targets: Record<string, boolean> = {}) => {
  const values = new Map([['stub.tracking.compact', JSON.stringify({ targets })]])
  return createCompactPrefs({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } })
}
const notes = (host: HTMLElement) => [...host.querySelectorAll('[data-note]')].map(note => note.textContent)

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  sent.length = 0
  outcome = { outcome: 'SAVED' }
  vi.unstubAllGlobals()
})

// the watch page's row, whose player comes up once the row is drawn
const page = ({ link = fakeLink(1000) as Linked, episode = 5, prefs = memory(), movie = false } = {}) => {
  const tree = (props: { link?: Linked, episode: number }) => (
    <MediaTracking
      work="ag:(anilist:1)"
      address="ag:(anilist:1)"
      uri="ag:(anilist:1)"
      title="A show"
      cover="https://img.test/a.jpg"
      episodeCount={12}
      movie={movie}
      prefsStore={prefs}
      {...props}
    />
  )
  const host = mount(tree({ episode }))
  hosts.push(host)
  const rerender = (props: { link?: Linked, episode: number } = { link, episode }) => act(() => { render(tree(props), host) })
  rerender()
  return { host, link, rerender }
}
const playing = (time: number) => ({ paused: false, time })
const paused = (time: number) => ({ paused: true, time })

test('85% played saves the episode to each checked tracker, each with its own fields, once, even across seeks', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), answer('stub', 'Stub', 'NOT_LISTED')] }
  const { link } = page()
  await link.report(playing(0), playing(840))
  expect(sent).toEqual([])
  await link.report(playing(850))
  expect(sent).toEqual([
    { uri: 'ag:(anilist:1)', trackers: ['anilist'], entry: { progress: 5 }, title: 'A show', cover: 'https://img.test/a.jpg', episodeCount: 12 },
    { uri: 'ag:(anilist:1)', trackers: ['stub'], entry: { progress: 5, status: 'WATCHING' }, title: 'A show', cover: 'https://img.test/a.jpg', episodeCount: 12 },
  ])
  // the trackers have not answered with the new count yet, and the viewer seeks back and over the mark again
  await link.report(paused(100), playing(100), playing(900), playing(990))
  expect(sent).toHaveLength(2)
})

test('a seek past 85% while paused sends nothing until it plays', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link } = page()
  await link.report(playing(10), paused(10), paused(950))
  expect(sent).toEqual([])
  await link.report(playing(950))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }])
})

test('a player that says how long it is counts on the share played, never at an end reached by a paused drag', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link } = page()
  await link.report(playing(10), paused(11), { paused: true, time: 1000, ended: true })
  expect(sent).toEqual([])
})

test('a player that does not say how long it is counts at its end, once it played', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link } = page({ link: fakeLink() })
  await link.report(paused(0), { paused: true, time: 1400, ended: true })
  expect(sent, 'an end it never played to').toEqual([])
  await link.report(playing(0), playing(1300))
  expect(sent).toEqual([])
  await link.report({ paused: true, time: 1400, ended: true })
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }])
})

test('a source plugin\'s player that says how long it is counts at 85%, before its end', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link } = page({ link: pluginLink(1000) })
  await link.report(playing(0), playing(840))
  expect(sent).toEqual([])
  await link.report(playing(850))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }])
})

test('trackers that answer after the mark are written when they answer, once', async () => {
  tracking = undefined
  const { link, rerender } = page()
  await link.report(playing(900))
  expect(sent).toEqual([])
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  rerender()
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), answer('stub', 'Stub', 'NOT_LISTED')] }
  rerender()
  expect(sent.map(({ trackers }) => trackers)).toEqual([['anilist'], ['stub']])
})

test('a tracker still loading at the mark shows no line and is written once it answers, one with no id never', async () => {
  const noId = answer('mal', 'MyAnimeList', 'NO_ID')
  tracking = { summary: null, disagreements: [], answers: [answer('anilist', 'AniList', 'LOADING'), noId] }
  const { host, link, rerender } = page()
  await link.report(playing(900))
  expect(sent).toEqual([])
  expect(notes(host)).toEqual([])
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), noId] }
  rerender()
  await settle()
  // a grown uri asks again: every tracker reads LOADING, then answers before it has re-read the save
  tracking = { summary: null, disagreements: [], answers: [answer('anilist', 'AniList', 'LOADING'), noId] }
  rerender()
  await settle()
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), noId] }
  rerender()
  await settle()
  expect(sent.map(({ trackers, entry }) => [trackers, entry])).toEqual([[['anilist'], { progress: 5 }]])
  expect(notes(host)).toEqual([])
})

test('a tracker the viewer unchecked in the tracking row is not written', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), answer('stub', 'Stub', 'NOT_LISTED')] }
  const { link } = page({ prefs: memory({ anilist: false }) })
  await link.report(playing(900))
  expect(sent.map(({ trackers }) => trackers)).toEqual([['stub']])
})

test('a tracker unchecked on the row\'s chip is not written, where storage is blocked too', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), answer('stub', 'Stub', 'NOT_LISTED')] }
  const blocked = createCompactPrefs({ getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  const { host, link } = page({ prefs: blocked })
  await act(async () => { host.querySelector<HTMLButtonElement>('button.expand')!.click() })
  const check = host.querySelector<HTMLInputElement>('input[name="compact-target-anilist"]')!
  await act(async () => {
    check.checked = false
    check.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await link.report(playing(900))
  expect(sent.map(({ trackers }) => trackers)).toEqual([['stub']])
})

test.each([
  ['in another tab', 'stub.tracking.compact'],
  ['on the FKN account', 'stub.settings.account'],
])('a tracker unchecked %s is not written by a row already open', async (_where, changed) => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4), answer('stub', 'Stub', 'NOT_LISTED')] }
  const values = new Map<string, string>()
  const prefs = createCompactPrefs({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } })
  // another tab's change arrives as a storage event on this page's window, and node's globalThis has no listeners
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window))
  const { link } = page({ prefs })
  values.set('stub.tracking.compact', JSON.stringify({ targets: { anilist: false } }))
  act(() => { window.dispatchEvent(Object.assign(new Event('storage'), { key: changed })) })
  await link.report(playing(900))
  expect(sent.map(({ trackers }) => trackers)).toEqual([['stub']])
})

test('the next episode counts on its own', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link, rerender } = page()
  await link.report(playing(900))
  tracking = { summary: null, disagreements: [], answers: [listedAt(5)] }
  const next = fakeLink(1000)
  rerender({ link: next, episode: 6 })
  await next.report(playing(100))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }])
  await next.report(playing(900))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }, { progress: 6 }])
})

test('a save that does not land shows as the tracking row shows it, and Retry sends it again', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  outcome = { outcome: 'FAILED', error: 'AniList answered 502' }
  const { host, link } = page()
  expect(notes(host)).toEqual([])
  await link.report(playing(900))
  const note = host.querySelector<HTMLElement>('[data-note="anilist"]')!
  expect(note.textContent).toBe('AniList did not save episode 5: AniList answered 502Retry')
  outcome = { outcome: 'SAVED' }
  await act(async () => { note.querySelector('button')!.click() })
  await settle()
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 5 }, { progress: 5 }])
  expect(host.querySelector('[data-note="anilist"]')).toBeNull()
})

// a save there marks the one episode it names, so the next episode's save alone would leave 5 unmarked
test('on Crunchyroll, a mark that failed goes again on its own before the next episode watched', async () => {
  const cr = { ...answer('cr', 'Crunchyroll', 'LISTED', { progress: 4 }), tracker: { id: 'cr', name: 'Crunchyroll', canWrite: true, statuses: ['PLANNING'] } }
  tracking = { summary: null, disagreements: [], answers: [cr] }
  outcome = { outcome: 'FAILED', error: 'Crunchyroll answered 503' }
  const { host, link, rerender } = page()
  await link.report(playing(900))
  expect(host.querySelector('[data-note="cr"]')?.textContent).toContain('Crunchyroll did not save the status and episode 5')
  outcome = { outcome: 'SAVED' }
  const next = fakeLink(1000)
  rerender({ link: next, episode: 6 })
  await next.report(playing(900))
  expect(sent.map(({ entry }) => entry.progress)).toEqual([5, 5, 6])
  expect(host.querySelector('[data-note="cr"]')).toBeNull()
})

test('an earlier episode watched before the trackers re-read the last save writes nothing', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  const { link, rerender } = page({ episode: 7 })
  await link.report(playing(900))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 7 }])
  // the entry still reads 4
  const earlier = fakeLink(1000)
  rerender({ link: earlier, episode: 6 })
  await earlier.report(playing(900))
  expect(sent.map(({ entry }) => entry)).toEqual([{ progress: 7 }])
})

test('a checked tracker that cannot write at the mark shows its line, and is written once it can', async () => {
  for (const [state, error, why] of [['ERROR', 'AniList answered 502', 'AniList answered 502'], ['PAUSED', null, 'Paused for a while']] as const) {
    tracking = { summary: null, disagreements: [], answers: [{ ...answer('anilist', 'AniList', state), error }] }
    const { host, link, rerender } = page()
    await link.report(playing(900))
    expect(sent, state).toEqual([])
    const note = host.querySelector<HTMLElement>('[data-note="anilist"]')
    expect(note?.textContent, state).toBe(`AniList did not save the status and episode 5: ${why}Retry`)
    expect(note?.querySelector('button')?.disabled, state).toBe(true)
    tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
    rerender()
    await settle()
    rerender()
    await settle()
    expect(sent.map(({ entry }) => entry), state).toEqual([{ progress: 5 }])
    expect(host.querySelector('[data-note="anilist"]'), state).toBeNull()
    unmount(hosts.pop()!)
    sent.length = 0
  }
})

test('a save a tracker refuses shows its line, and Dismiss clears it', async () => {
  tracking = { summary: null, disagreements: [], answers: [listedAt(4)] }
  outcome = { outcome: 'REFUSED', error: 'AniList refused the count' }
  const { host, link } = page()
  await link.report(playing(900))
  const note = host.querySelector<HTMLElement>('[data-note="anilist"]')!
  expect(note.textContent).toBe('AniList did not save: AniList refused the countDismiss')
  await act(async () => { note.querySelector('button')!.click() })
  expect(host.querySelector('[data-note="anilist"]')).toBeNull()
  expect(sent).toHaveLength(1)
})

test('a movie watched is Completed', async () => {
  tracking = { summary: null, disagreements: [], answers: [answer('stub', 'Stub', 'NOT_LISTED')] }
  const { link } = page({ movie: true, link: fakeLink(6000) })
  await link.report(playing(5200))
  expect(sent.map(({ entry }) => entry)).toEqual([{ status: 'COMPLETED', progress: 1 }])
})
