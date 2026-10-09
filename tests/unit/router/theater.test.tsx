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

// A query of the pick's own answering after it was shown, which is how anizip's titles reached the hero.
const answer = vi.hoisted(() => ({ media: undefined as unknown }))
vi.mock('urql', () => ({ useSubscription: () => [{ data: answer.media ? { media: answer.media } : undefined }] }))

const { default: HomeHeader } = await import('../../../src/router/home/theater')
const { THEATER_WAIT_MS } = await import('../../../src/utils/theater')

type Nodes = Parameters<typeof HomeHeader>[0]['mediaNodes']

const show = (id: string, { title = `${id} title`, description = `${id} description`, trailers = [id], score = 0.8, banners = [`https://img.test/${id}-banner.jpg`] } = {}) => ({
  _id: `cl:${id}`,
  uri: `ag:(anilist:${id},kitsu:${id})`,
  titles: [{ language: 'en', title, score }],
  shortDescriptions: [{ language: 'en', shortDescription: description }],
  trailers: trailers.map(trailer => ({ uri: `yt:${trailer}`, origin: 'yt', id: trailer, url: `https://www.youtube.com/watch?v=${trailer}` })),
  banners: banners.map(url => ({ language: 'en', url })),
  covers: [{ language: 'en', url: `https://img.test/${id}-cover.jpg` }],
})

const hosts: HTMLElement[] = []
// linkedom has no Image, which the cover probe (utils/use-cover-url.ts) loads each banner with
beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  answer.media = undefined
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
    update: (next: object[]) => act(() => { render(tree(next), host) }),
    shown: () => ({
      title: host.querySelector('.title')?.textContent,
      description: host.querySelector('.short-description')?.textContent,
      trailer: host.querySelector('[data-trailer]')?.getAttribute('data-trailer'),
    }),
    backdrop: () => (host.querySelector('.player-wrapper') as HTMLElement | null)?.getAttribute('style') ?? '',
    controls: () => host.querySelector('.player-controls') !== null,
  }
}

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

test('a later answer for the pick does not change it', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  answer.media = show('blue-box', { title: 'Blue Box (2026)', description: 'anizip', trailers: ['hJ6Y8PAOUk8'] })
  const { shown } = hero([show('blue-box', { title: 'Blue Box Season 2' })])

  expect(shown().title).toBe('Blue Box Season 2')
  expect(shown().description).toBe('blue-box description')
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

