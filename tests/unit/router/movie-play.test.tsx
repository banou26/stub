// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsEpisode } from '../../../src/router/home/media-details'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { releaseDateLabel } from '../../../src/utils/release-date'

let origin = 'cr'
vi.mock('urql', () => ({
  useSubscription: ({ variables }: { variables: { input: { ids: string[] } } }) =>
    [{ data: { originPage: { nodes: variables.input.ids.includes(origin) ? [{ id: origin, name: origin, icon: null, color: null }] : [] } } }],
}))
vi.mock('../../../src/worker', () => ({}))
vi.mock('lucide-react', () => ({ LucidePlay: () => null }))

const { default: MoviePlay } = await import('../../../src/router/home/movie-play')

const episode = {
  uri: 'ag:(cr:GX1)',
  handles: [{ relation: 'SAME_AS', node: { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' } }],
} as unknown as DetailsEpisode

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  origin = 'cr'
})

const render = (movie: DetailsEpisode, handles: Parameters<typeof MoviePlay>[0]['handles'] = []) => {
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(<Router hook={hook}><MoviePlay episode={movie} mediaUri="ag:(anilist:9)" handles={handles} startDate="2020-01-01"/></Router>)
  hosts.push(host)
  return host
}

test('Play opens the watch page naming no source, even when Crunchyroll plays', () => {
  expect(render(episode).querySelector('.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
})

test('no Play when no source plays in stub', () => {
  origin = 'nyaa'
  const magnet = {
    uri: 'ag:(nyaa:a)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'nyaa:a', origin: 'nyaa', url: 'magnet:?xt=urn:btih:a' } }],
  } as unknown as DetailsEpisode
  const host = render(magnet)
  expect(host.querySelector('a[href^="magnet:"]')).not.toBeNull()
  expect(host.querySelector('.play')).toBeNull()
})

// a film's offers hang off the media, not its one episode (Ninja Scroll's HIDIVE, 2026-10-12)
test('a media-level offer the episode does not name links out from the play bar', () => {
  origin = 'hidive'
  const host = render(episode, [
    { relation: 'SAME_AS', node: { origin: 'hidive', url: 'https://www.hidive.com/interstitial/715215' } },
  ])
  const link = host.querySelector('a[href="https://www.hidive.com/interstitial/715215"]')
  expect(link?.getAttribute('target')).toBe('_blank')
  expect(host.querySelector('.play')).toBeNull()
})

// Simkl's `first_aired` for Blade Runner: Black Out 2022 (tests/fixtures/simkl/search-blade-runner.json),
// seen before it was out, from the two sides of Greenwich
test('a film not out yet names its release day, the same day for every viewer', () => {
  const TZ = process.env.TZ
  vi.useFakeTimers({ now: new Date('2017-09-01T12:00:00Z'), toFake: ['Date'] })
  try {
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone
      const { hook } = memoryLocation({ path: '/' })
      const host = mount(<Router hook={hook}><MoviePlay episode={episode} mediaUri="ag:(anilist:9)" startDate="2017-09-26T00:00:00Z"/></Router>)
      hosts.push(host)
      expect(host.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2017-09-26')}`)
    }
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

// anizip's `airDateUtc` for Jujutsu Kaisen 0 (anilist 131573), 00:30 JST on Dec 24
test('a film episode that airs at a set time keeps it, so Tokyo reads its own day', () => {
  const TZ = process.env.TZ
  vi.useFakeTimers({ now: new Date('2021-12-01T12:00:00Z'), toFake: ['Date'] })
  try {
    process.env.TZ = 'Asia/Tokyo'
    const aired = { ...episode, releaseDate: '2021-12-23T15:30:00Z' } as DetailsEpisode
    const { hook } = memoryLocation({ path: '/' })
    const host = mount(<Router hook={hook}><MoviePlay episode={aired} mediaUri="ag:(anilist:131573)" startDate="2021-12-24T00:00:00Z"/></Router>)
    hosts.push(host)
    expect(host.querySelector('.when')?.textContent).toBe(`Releases ${releaseDateLabel('2021-12-24')}`)
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

test('a media-level handle to a catalogue is not offered as a place to watch', () => {
  origin = 'anilist'
  const host = render(episode, [{ relation: 'SAME_AS', node: { origin: 'anilist', url: 'https://anilist.co/anime/617' } }])
  expect(host.querySelector('a[href="https://anilist.co/anime/617"]')).toBeNull()
})
