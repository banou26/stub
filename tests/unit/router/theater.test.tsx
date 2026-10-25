// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('lucide-react', () => Object.fromEntries(
  ['LucidePause', 'LucidePlay', 'Volume', 'Volume1', 'Volume2', 'VolumeX'].map(name => [name, () => null])))

const player = vi.hoisted(() => ({ fail: () => {} }))
vi.mock('../../../src/components/yt-minimal-player', async () => {
  const { h } = await import('preact')
  return {
    default: ({ url, onError }: { url: string, onError: () => void }) => {
      player.fail = onError
      return h('i', { 'data-trailer': url })
    },
  }
})

// The details of a show by its uri, and the viewer's tracking. Like urql 4.2.2's `computeNextState`, a
// subscription keeps its last answer when its variables change.
const answer = vi.hoisted(() => ({ details: {} as Record<string, unknown>, tracking: undefined as unknown }))
vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: (
      { query, variables, pause }:
      { query: { definitions: { name?: { value: string } }[] }, variables: { input: { uri: string } }, pause?: boolean }
    ) => {
      const last = useRef<unknown>(undefined)
      const name = query.definitions[0]?.name?.value
      const data = pause ? undefined
        : name === 'GetMediaDetails' ? answer.details[variables.input.uri] && { media: answer.details[variables.input.uri] }
        : name === 'MediaTracking' ? answer.tracking && { tracking: answer.tracking }
        : undefined
      if (data) last.current = data
      return [{ data: last.current }]
    },
  }
})
vi.mock('../../../src/worker', () => ({}))

// a source's state, or `retry` for a source connecting again after it connected or failed
type SourceState = 'connecting' | 'connected' | 'error' | 'retry'
const sources = vi.hoisted(() => ({ states: [] as string[], listeners: new Set<() => void>() }))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => sources.states.map((state, index) => ({
    uri: `https:source-${index}`,
    ...state === 'retry' ? { state: 'connecting', retry: true } : { state },
  })),
  onPluginsChange: (listener: () => void) => {
    sources.listeners.add(listener)
    return () => { sources.listeners.delete(listener) }
  },
}))
const setSources = (...states: SourceState[]) => act(() => {
  sources.states = states
  sources.listeners.forEach(listener => listener())
})

/** What the hero reads of `navigator.connection`, with its `change` event. */
const connection = (reading: { effectiveType?: string, saveData?: boolean }) => {
  const listeners = new Set<() => void>()
  const link = {
    ...reading,
    addEventListener: (_: string, listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener) },
  }
  vi.stubGlobal('navigator', { connection: link })
  return {
    change: (next: { effectiveType?: string, saveData?: boolean }) => act(() => {
      Object.assign(link, next)
      listeners.forEach(listener => listener())
    }),
  }
}

const { default: HomeHeader } = await import('../../../src/router/home/theater')
const { SOURCES_WAIT_MS, THEATER_WAIT_MS } = await import('../../../src/utils/theater')

type Nodes = Parameters<typeof HomeHeader>[0]['mediaNodes']

const show = (id: string, { title = `${id} title`, description = `${id} description`, trailers = [id], score = 0.8, banners = [`https://img.test/${id}-banner.jpg`] } = {}) => ({
  _id: `cl:${id}`,
  uri: `ag:(anilist:${id},kitsu:${id})`,
  titles: [{ language: 'en', title, score }],
  shortDescriptions: [{ language: 'en', shortDescription: description }],
  trailers: trailers.map(trailer => ({ uri: `yt:${trailer}`, origin: 'yt', id: trailer, url: `https://www.youtube.com/watch?v=${trailer}` })),
  banners: banners.map(url => ({ language: 'en', url })),
  covers: [{ language: 'en', url: `https://img.test/${id}-cover.jpg` }],
  handles: [`anilist:${id}`, `kitsu:${id}`].map(uri => ({ relation: 'SAME_AS', node: { uri } })),
})

const hosts: HTMLElement[] = []
// linkedom has no Image, which the cover probe (utils/use-cover-url.ts) loads each banner with
beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  answer.details = {}
  answer.tracking = undefined
  sources.states = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const hero = (nodes: object[]) => {
  const { hook } = memoryLocation({ path: '/' })
  const tree = (next: object[]) => <Router hook={hook}><HomeHeader mediaNodes={next as Nodes}/></Router>
  const host = mount(tree(nodes))
  hosts.push(host)
  return {
    host,
    update: (next: object[]) => act(() => { render(tree(next), host) }),
    shown: () => ({
      title: host.querySelector('.title')?.textContent,
      description: host.querySelector('.short-description')?.textContent,
      trailer: host.querySelector('[data-trailer]')?.getAttribute('data-trailer'),
    }),
    backdrop: () => (host.querySelector('.player-wrapper') as HTMLElement | null)?.getAttribute('style') ?? '',
    controls: () => host.querySelector('.player-controls') !== null,
    play: () => {
      const link = host.querySelector('.actions > .play')
      return link && { label: link.textContent, href: link.getAttribute('href') }
    },
    actions: () => host.querySelector('.information > .actions') !== null,
  }
}

// What the hero's show answers to its own details query, with `episodes` aired and the rest ahead.
const details = (id: string, { title = `${id} details title`, episodes = 2, aired = episodes } = {}) => ({
  ...show(id, { title, description: `${id} details description` }),
  descriptions: [],
  status: aired < episodes ? 'RELEASING' : 'FINISHED',
  nextAiringEpisode: aired < episodes ? { episodeNumber: aired + 1, airingAt: '2999-01-01T00:00:00Z' } : null,
  episodes: Array.from({ length: episodes }, (_, index) => ({
    uri: `ag:(anilist:${id}-${index + 1})`,
    episodeNumber: index + 1,
    releaseDate: index < aired ? '2020-01-01' : undefined,
    handles: [],
  })),
})
const uriOf = (id: string) => show(id).uri

test('the hero holds its title and lines while it has no show, and draws the show in their place', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown, update, host } = hero([])
  const held = () => [...host.querySelectorAll('.information > .title > [aria-hidden], .information > .short-description[aria-hidden]')].length
  expect(held()).toBe(2)

  update([show('frieren', { title: 'Frieren' })])
  expect(held()).toBe(0)
  expect(shown()).toEqual({ title: 'Frieren', description: 'frieren description', trailer: 'https://www.youtube.com/watch?v=frieren' })
})

test('with no show, the hero holds its place only as long as it waits for one', () => {
  vi.useFakeTimers()
  const { host } = hero([])
  const held = () => host.querySelectorAll('.information > .title > [aria-hidden], .information > .short-description[aria-hidden]').length
  act(() => { vi.advanceTimersByTime(THEATER_WAIT_MS - 1) })
  expect(held(), 'the control: held while it waits').toBe(2)

  act(() => { vi.advanceTimersByTime(1) })
  expect(held()).toBe(0)
})

// Measured 2026-10-10: anizip's title, a longer description and another trailer merged into the
// pick after it was shown.
test('what the hero shows first stays when sources merge into the listing', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown, update } = hero([show('blue-box', { title: 'Blue Box Season 2', trailers: ['hJ6Y8PAOUk8'] }), show('other')])
  const first = shown()
  expect(first).toEqual({ title: 'Blue Box Season 2', description: 'blue-box description', trailer: 'https://www.youtube.com/watch?v=hJ6Y8PAOUk8' })

  update([show('blue-box', { title: 'Blue Box (2026)', description: 'longer', trailers: ['ZtFrSp4pMJ4'], score: 0.9 }), show('other')])
  expect(shown()).toEqual(first)
})

// Measured 2026-10-10 on cold loads: Kitsu alone filled the listing first in 12 of 26, AniList's
// fields followed 1.3 to 2.6 s later, and the hero showed Kitsu's placeholder synopsis and
// announcement trailer meanwhile, or kept them for good.
test('while only Kitsu has answered, the hero waits for a better source and shows its fields', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const kitsu = show('returner', { title: 'Returner Season 2', description: 'The second season of Returner.', trailers: ['TlEAAp9EWio'], score: 0.3 })
  const { shown, update } = hero([kitsu])
  expect(shown()).toEqual({ title: '', description: '', trailer: undefined })

  update([show('returner', { title: 'Returner Season 2', description: 'In a land dominated by the Shadow Worlds', trailers: ['YBWOrQCB9r0'] })])
  expect(shown()).toEqual({ title: 'Returner Season 2', description: 'In a land dominated by the Shadow Worlds', trailer: 'https://www.youtube.com/watch?v=YBWOrQCB9r0' })
})

// When AniList and Jikan were both down on 2026-08-16, every record was Kitsu's and a score gate left
// the hero empty over a full listing.
test('with no better source answering, the hero fills from Kitsu once the wait is over', () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown } = hero([show('kitsu-only', { score: 0.3 })])
  expect(shown().title).toBe('')

  act(() => { vi.advanceTimersByTime(THEATER_WAIT_MS) })
  expect(shown()).toEqual({ title: 'kitsu-only title', description: 'kitsu-only description', trailer: 'https://www.youtube.com/watch?v=kitsu-only' })
})

// Measured 2026-10-10 in 7 of 12 loads where Kitsu answered first: shows listed ahead of the pick
// gained a trailer from AniList and pushed it to index 11 to 14 of the candidates.
test('the show stays when shows gaining a trailer push it out of the pool', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
  const ahead = (trailer: boolean) => Array.from({ length: 5 }, (_, index) => show(`ahead-${index}`, trailer ? {} : { trailers: [] }))
  const pool = Array.from({ length: 10 }, (_, index) => show(`pool-${index}`))
  const { shown, update } = hero([...ahead(false), ...pool])
  expect(shown().title).toBe('pool-9 title')

  update([...ahead(true), ...pool])
  expect(shown().title).toBe('pool-9 title')
})

test('a details answer with other titles leaves the hero\'s title and description as shown', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.details[uriOf('blue-box')] = details('blue-box', { title: 'Blue Box (2026)' })
  const { shown, play } = hero([show('blue-box', { title: 'Blue Box Season 2' })])

  expect(play()?.label, 'the answer reached the hero').toBe('Play')
  expect(shown().title).toBe('Blue Box Season 2')
  expect(shown().description).toBe('blue-box description')
})

test('Play opens the first episode once the show\'s details answer', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { play, update } = hero([show('a')])
  expect(play()).toBeNull()

  answer.details[uriOf('a')] = details('a')
  update([show('a')])
  expect(play()).toEqual({ label: 'Play', href: `/watch/${uriOf('a')}/ag:(anilist:a-1)` })
})

test('with three episodes watched, it reads Continue and opens the fourth', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.details[uriOf('a')] = details('a', { episodes: 6 })
  answer.tracking = { _id: `tracking:${uriOf('a')}`, summary: { status: 'CURRENT', progress: 3 } }
  const { play } = hero([show('a')])
  expect(play()).toEqual({ label: 'Continue', href: `/watch/${uriOf('a')}/ag:(anilist:a-4)` })
})

// only the clock is faked, so the hero's own waits draw nothing over the tick
test('Continue appears on the clock\'s next tick once the next episode has aired', () => {
  vi.useFakeTimers({ now: Date.parse('2026-10-16T13:59:50Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.details[uriOf('a')] = { ...details('a', { episodes: 4, aired: 2 }), nextAiringEpisode: { episodeNumber: 3, airingAt: '2026-10-16T14:00:00Z' } }
  answer.tracking = { _id: `tracking:${uriOf('a')}`, summary: { status: 'CURRENT', progress: 2 } }
  const { play } = hero([show('a')])
  expect(play(), 'the control: the third is not out yet').toBeNull()

  act(() => { vi.advanceTimersByTime(30_000) })
  expect(play()).toEqual({ label: 'Continue', href: `/watch/${uriOf('a')}/ag:(anilist:a-3)` })
})

test('with nothing aired there is no Play, and its row is there from the first render', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { actions, play, update } = hero([show('a', { score: 0.3 })])
  expect(actions()).toBe(true)

  answer.details[uriOf('a')] = details('a', { aired: 0 })
  update([show('a')])
  expect(play()).toBeNull()
  expect(actions()).toBe(true)
})

test('a category change that moves the pick shows no Play until the new show\'s details answer', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.details[uriOf('a')] = details('a')
  const { play, shown, update } = hero([show('a')])
  expect(play()?.href).toBe(`/watch/${uriOf('a')}/ag:(anilist:a-1)`)

  update([show('b')])
  expect(shown().title).toBe('b title')
  expect(play()).toBeNull()

  answer.details[uriOf('b')] = details('b')
  update([show('b')])
  expect(play()?.href).toBe(`/watch/${uriOf('b')}/ag:(anilist:b-1)`)
})

// The cluster's id the hero held was retired by the merge, and it picked another show.
test('the hero keeps its show when its cluster merges with another of the same show', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown, update } = hero([show('a'), show('b')])
  const first = shown()
  expect(first.title).toBe('a title')

  const merged = {
    ...show('a', { title: 'a merged title', description: 'merged description' }),
    _id: 'cl:tmdb:a',
    uri: 'ag:(anilist:a,kitsu:a,tmdb:a)',
    handles: ['anilist:a', 'kitsu:a', 'tmdb:a'].map(uri => ({ relation: 'SAME_AS', node: { uri } })),
  }
  update([show('b'), merged])
  expect(shown()).toEqual(first)
})

// Measured 2026-10-13 on series.fkn.app: reading the hero's show asked Apple TV, whose season 1 then took
// the show's card, and the hero re-picked, up to three times in one load. JustWatch's titles score 0.2.
test('the hero keeps its show when the listing draws it as its season', () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.details[uriOf('widows-bay')] = details('widows-bay')
  const { shown, play, update } = hero([show('widows-bay', { score: 0.2 }), show('slow-horses', { score: 0.2 })])
  act(() => { vi.advanceTimersByTime(THEATER_WAIT_MS) })
  const first = shown()
  expect(first.title).toBe('widows-bay title')
  expect(play()?.href).toBe(`/watch/${uriOf('widows-bay')}/ag:(anilist:widows-bay-1)`)

  const season = {
    ...show('widows-bay-s1', { title: 'Widow\u2019s Bay', description: 'season one', score: 0.2 }),
    handles: [{ relation: 'SAME_AS', node: { uri: 'appletv:widows-bay-s1' } }, { relation: 'PART_OF', node: { uri: 'anilist:widows-bay' } }],
  }
  update([season, show('slow-horses', { score: 0.2 })])
  expect(shown()).toEqual(first)
  expect(play()?.href).toBe(`/watch/${uriOf('widows-bay')}/ag:(anilist:widows-bay-1)`)
})

test('a show that leaves the listing is replaced, even with seasons of other shows listed', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown, update } = hero([show('a'), show('b')])
  expect(shown().title).toBe('a title')

  const seasonOfB = { ...show('b-s1'), handles: [{ relation: 'SAME_AS', node: { uri: 'appletv:b-s1' } }, { relation: 'PART_OF', node: { uri: 'anilist:b' } }] }
  update([seasonOfB])
  expect(shown().title).toBe('b-s1 title')
})

// Measured 2026-10-10: YouTube refuses to embed some trailers (error 150, Kitsu's 9QyiEgv33z4 for
// Black Clover), and the hero then switched to another show about 0.3 s after showing this one.
test('a trailer that fails gives way to the show\'s next trailer, and the show stays', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown } = hero([show('black-clover', { trailers: ['9QyiEgv33z4', '4MYo8FfiXMA'] }), show('next')])
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=9QyiEgv33z4')

  act(() => { player.fail() })
  expect(shown()).toEqual({ title: 'black-clover title', description: 'black-clover description', trailer: 'https://www.youtube.com/watch?v=4MYo8FfiXMA' })
})

// With YouTube unreachable every embed is reported silent about 10 s after its frame loads, and the
// hero re-picked on each one: six shows in 70 s, measured 2026-10-10.
test('when every trailer of the show fails, the show stays without one', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown } = hero([show('a'), show('b'), show('c')])

  act(() => { player.fail() })
  act(() => { player.fail() })
  expect(shown()).toEqual({ title: 'a title', description: 'a description', trailer: undefined })
})

// Measured 2026-10-10: TOUGEN ANKI's only trailer (upBWYExYoYc) gets YouTube's error 150 in about 1 load
// in 6, and the hero then kept an empty dark band with pause and mute buttons for a video that was not
// there. The media modal shows the cover in that case.
test('a show with no trailer left shows its banner, or its cover, and no playback controls', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown, backdrop, controls } = hero([show('tougen', { trailers: ['upBWYExYoYc'] })])
  expect(controls()).toBe(true)
  expect(backdrop()).not.toContain('url(')

  act(() => { player.fail() })
  expect(shown()).toEqual({ title: 'tougen title', description: 'tougen description', trailer: undefined })
  expect(backdrop()).toContain('https://img.test/tougen-banner.jpg')
  expect(controls()).toBe(false)
})

test('with no banner, the cover stands in', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { backdrop } = hero([show('tougen', { trailers: [], banners: [] })])
  expect(backdrop()).toContain('https://img.test/tougen-cover.jpg')
})

test('while a source connects, the hero holds its trailer, shows its banner, and plays it once connected', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  sources.states = ['connected', 'connecting']
  const { shown, backdrop, controls } = hero([show('a')])
  expect(shown()).toEqual({ title: 'a title', description: 'a description', trailer: undefined })
  expect(backdrop()).toContain('https://img.test/a-banner.jpg')
  expect(controls()).toBe(false)

  setSources('connected', 'connected')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
  expect(controls()).toBe(true)
})

test('a source added while the trailer plays holds it until the source connects', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown } = hero([show('a')])
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')

  setSources('connecting')
  expect(shown().trailer).toBeUndefined()

  setSources('connected')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
})

// Measured 2026-10-25 on anime.fkn.app with one source FKN refuses (not installed by this app): it
// failed 1.6 s after the load and every 6 to 30 s after, and the hero stayed on its banner for 120 s.
test('a source that failed holds no trailer, and neither do its retries', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  sources.states = ['connected', 'connecting']
  const { shown } = hero([show('a')])
  expect(shown().trailer, 'the control: held while it connects').toBeUndefined()

  setSources('connected', 'error')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')

  setSources('connected', 'retry')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
  setSources('connected', 'error')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
})

// A source that has not connected in 10 s is stuck, or slow enough that a trailer can wait no longer:
// on a normal network one connected in 0.7 to 2.1 s, measured 2026-10-15.
test('a source still connecting holds the trailer for 10 s at most', () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  sources.states = ['connecting']
  const { shown } = hero([show('a')])
  expect(SOURCES_WAIT_MS).toBe(10_000)
  act(() => { vi.advanceTimersByTime(9_999) })
  expect(shown().trailer).toBeUndefined()

  act(() => { vi.advanceTimersByTime(1) })
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')

  setSources('error')
  setSources('retry')
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
})

test('the wait counts from when a source starts connecting, and starts again for the next one', () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const { shown } = hero([show('a')])
  act(() => { vi.advanceTimersByTime(SOURCES_WAIT_MS) })

  setSources('connecting')
  expect(shown().trailer).toBeUndefined()
  act(() => { vi.advanceTimersByTime(SOURCES_WAIT_MS) })
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')

  setSources('connected')
  setSources('connected', 'connecting')
  expect(shown().trailer).toBeUndefined()
})

test('on a connection read as 2G, or with data saving on, the hero holds its trailer until that changes', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const link = connection({ effectiveType: '2g', saveData: false })
  const { shown, backdrop } = hero([show('a')])
  expect(shown().trailer).toBeUndefined()
  expect(backdrop()).toContain('https://img.test/a-banner.jpg')

  link.change({ effectiveType: '4g', saveData: true })
  expect(shown().trailer).toBeUndefined()

  link.change({ saveData: false })
  expect(shown().trailer).toBe('https://www.youtube.com/watch?v=a')
})
