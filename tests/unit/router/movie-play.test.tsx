// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsEpisode } from '../../../src/router/home/media-details'

import { render as rerender } from 'preact'
import { act } from 'preact/test-utils'
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
const TZ = process.env.TZ
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  origin = 'cr'
  vi.useRealTimers()
  if (TZ === undefined) delete process.env.TZ
  else process.env.TZ = TZ
})

const tree = (movie: DetailsEpisode | undefined, handles: Parameters<typeof MoviePlay>[0]['handles'] = [], startDate: string | null = '2020-01-01', status?: string) => {
  const { hook } = memoryLocation({ path: '/' })
  return <Router hook={hook}><MoviePlay episode={movie} mediaUri="ag:(anilist:9)" handles={handles} startDate={startDate} status={status}/></Router>
}

const render = (...props: Parameters<typeof tree>) => {
  const host = mount(tree(...props))
  hosts.push(host)
  return host
}

const seenAt = (now: string, zone: string, movie: DetailsEpisode | undefined, startDate: string | null = null, status?: string) => {
  vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] })
  process.env.TZ = zone
  return render(movie, [], startDate, status)
}

const ZONES = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']

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
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const host = seenAt('2017-09-01T12:00:00Z', zone, episode, '2017-09-26T00:00:00Z')
    expect(host.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2017-09-26')}`)
  }
})

// anizip's `airDateUtc` for Jujutsu Kaisen 0 (anilist 131573): 00:30 JST on Dec 24, still Dec 23 in UTC and Los Angeles
const jujutsuKaisen0 = { ...episode, releaseDate: '2021-12-23T15:30:00Z' } as DetailsEpisode

test('a film\'s own release day stays put when its episode\'s air time arrives, the same day for every viewer', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const host = seenAt('2021-12-01T12:00:00Z', zone, undefined, '2021-12-24T00:00:00Z')
    expect(host.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2021-12-24')}`)
    act(() => { rerender(tree(jujutsuKaisen0, [], '2021-12-24T00:00:00Z'), host) })
    expect(host.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2021-12-24')}`)
  }
})

test('a film\'s year is its own release day\'s, whatever year its episode airs', () => {
  const host = render({ ...episode, releaseDate: '2021-12-31T15:30:00Z' } as DetailsEpisode, [], '2022-01-01T00:00:00Z')
  expect(host.querySelector('.facts')?.textContent).toBe('Movie · 2022')
})

// the title page and the hero decide by the episode's air time, so the modal does too
test('a film is out when its episode airs within a day of its own release day, in every zone, its line naming its own day until then', () => {
  for (const zone of ZONES) {
    const early = seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0, '2021-12-24T00:00:00Z')
    expect(early.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2021-12-24')}`)
    expect(early.querySelector('.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0, '2021-12-24T00:00:00Z').querySelector('.play'), zone).not.toBeNull()
  }
})

// a source's status lags the release, so it does not hold a film's own day either
test('a film whose episode names only a day, or a time further off, is out from the start of its own day where the viewer is', () => {
  // the first moment of Dec 24 in Los Angeles is 08:00 UTC, in Tokyo 15:00 UTC on Dec 23
  const dated = [{ ...episode, releaseDate: '2021-12-25' }, { ...episode, releaseDate: '2022-01-07T15:00:00Z' }] as DetailsEpisode[]
  for (const movie of dated) {
    for (const [zone, midnight] of [['America/Los_Angeles', '2021-12-24T08:00:00Z'], ['Asia/Tokyo', '2021-12-23T15:00:00Z']] as const) {
      const late = seenAt(new Date(Date.parse(midnight) - 60_000).toISOString(), zone, movie, '2021-12-24T00:00:00Z', 'NOT_YET_RELEASED')
      expect(late.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel('2021-12-24')}`)
      expect(late.querySelector('.play'), zone).toBeNull()
      expect(seenAt(midnight, zone, movie, '2021-12-24T00:00:00Z', 'NOT_YET_RELEASED').querySelector('.play'), `${zone} ${movie.releaseDate}`).not.toBeNull()
    }
  }
})

// AniList knowing only December 2021 and its schedule airing the film at 09:00 JST on Dec 24, which is 00:00 UTC
test('a film whose start is an air time at midnight UTC is out at that time, not from the start of its day', () => {
  const nine = { ...episode, releaseDate: '2021-12-24T00:00:00Z' } as DetailsEpisode
  for (const zone of ZONES) {
    expect(seenAt('2021-12-23T23:59:00Z', zone, nine, 'Fri, 24 Dec 2021 00:00:00 GMT').querySelector('.play'), zone).toBeNull()
    expect(seenAt('2021-12-24T00:00:00Z', zone, nine, 'Fri, 24 Dec 2021 00:00:00 GMT').querySelector('.play'), zone).not.toBeNull()
  }
})

test('a film with no release day of its own is out at its episode\'s air time, in every zone', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const early = seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0)
    expect(early.querySelector('.when')?.textContent, zone).toMatch(/^Releases /)
    expect(early.querySelector('.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0).querySelector('.play'), zone).not.toBeNull()
  }
})

// only the clock is faked, so nothing but its tick draws the bar again
test('Play appears on the clock\'s next tick once the film\'s release day has started', () => {
  // 23:59:50 on Oct 16 in Los Angeles
  process.env.TZ = 'America/Los_Angeles'
  vi.useFakeTimers({ now: Date.parse('2026-10-17T06:59:50Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
  const host = render(episode, [], '2026-10-17')
  expect(host.querySelector('.when')?.textContent, 'the control: not out yet').toBe(`Releases ${releaseDateLabel('2026-10-17')}`)
  expect(host.querySelector('.play')).toBeNull()

  act(() => { vi.advanceTimersByTime(30_000) })
  expect(render(episode, [], '2026-10-17').querySelector('.play'), 'the control: a bar drawn now has Play').not.toBeNull()
  expect(host.querySelector('.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
  expect(host.querySelector('.when')).toBeNull()
})

// AniList knows only December 2021 for Jujutsu Kaisen 0, so `airedDate` gives its schedule's first airing
test('a film whose own start is an air time is out at that time, and names its day where the viewer is', () => {
  const startDate = 'Thu, 23 Dec 2021 15:30:00 GMT'
  for (const [zone, day] of [['America/Los_Angeles', '2021-12-23'], ['Asia/Tokyo', '2021-12-24']] as const) {
    expect(seenAt('2021-12-22T12:00:00Z', zone, episode, startDate).querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel(day)}`)
    expect(seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0, startDate).querySelector('.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0, startDate).querySelector('.play'), zone).not.toBeNull()
  }
})

test('a film with no release day of its own names its episode\'s air time, where the viewer is', () => {
  for (const [zone, day] of [['America/Los_Angeles', '2021-12-23'], ['Asia/Tokyo', '2021-12-24']] as const) {
    const host = seenAt('2021-12-01T12:00:00Z', zone, jujutsuKaisen0)
    expect(host.querySelector('.when')?.textContent, zone).toBe(`Releases ${releaseDateLabel(day)}`)
  }
})

// AniList's startDate for ONE PIECE FILM: GOD VALLEY (anilist 215855) is the year alone (2026-10-16)
test('a film known only to its year names the year, and a film not out yet stays upcoming until that year is over', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    for (const now of ['2026-11-01T12:00:00Z', '2027-10-17T12:00:00Z']) {
      const host = seenAt(now, zone, episode, '2027', 'NOT_YET_RELEASED')
      expect(host.querySelector('.when')?.textContent, `${zone} ${now}`).toBe('Releases 2027')
      expect(host.querySelector('.facts')?.textContent, zone).toBe('Movie · 2027')
      expect(host.querySelector('.play'), zone).toBeNull()
    }
  }
})

// TMDB dates every film by its year alone, and IMDb's search, Watchmode and uNoGS often do
test('a film dated by a year or a month that has begun is out, unless it is known not to be', () => {
  for (const zone of ZONES) {
    for (const startDate of ['2026', '2026-10']) {
      for (const status of [undefined, 'FINISHED']) {
        const out = seenAt('2026-10-17T12:00:00Z', zone, episode, startDate, status)
        expect(out.querySelector('.play'), `${zone} ${startDate} ${status}`).not.toBeNull()
        expect(out.querySelector('.when'), `${zone} ${startDate} ${status}`).toBeNull()
      }
      const ahead = seenAt('2026-10-17T12:00:00Z', zone, episode, startDate, 'NOT_YET_RELEASED')
      expect(ahead.querySelector('.when')?.textContent, `${zone} ${startDate}`).toBe(`Releases ${releaseDateLabel(startDate)}`)
      expect(ahead.querySelector('.play'), `${zone} ${startDate}`).toBeNull()
    }
  }
})

// AniList's schedule airing a film at 00:30 JST on New Year's Day 2027
test('a film whose start is an air time names the year of the day its line names', () => {
  for (const zone of ZONES) {
    const host = seenAt('2026-12-01T00:00:00Z', zone, episode, 'Thu, 31 Dec 2026 15:30:00 GMT')
    const day = host.querySelector('.when')!.textContent!
    expect(host.querySelector('.facts')?.textContent, `${zone}: ${day}`).toBe(`Movie · ${day.slice(-4)}`)
  }
})

test('an episode\'s air time outranks a film\'s year or month alone', () => {
  for (const startDate of ['2027', '2027-07']) {
    const host = seenAt('2027-03-01T12:00:00Z', 'America/Los_Angeles', { ...episode, releaseDate: '2027-07-15T15:30:00Z' } as DetailsEpisode, startDate)
    expect(host.querySelector('.when')?.textContent, startDate).toBe(`Releases ${releaseDateLabel('2027-07-15')}`)
    expect(host.querySelector('.play'), startDate).toBeNull()
  }
})

test('a media-level handle to a catalogue is not offered as a place to watch', () => {
  origin = 'anilist'
  const host = render(episode, [{ relation: 'SAME_AS', node: { origin: 'anilist', url: 'https://anilist.co/anime/617' } }])
  expect(host.querySelector('a[href="https://anilist.co/anime/617"]')).toBeNull()
})

test('Play stays when the source that plays has its icon hidden', async () => {
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  try {
    const { setIconShown } = await import('../../../src/sources/hidden-icons')
    expect(render(episode).querySelector('.src'), 'the control: its icon is drawn while shown').not.toBeNull()
    setIconShown('cr', false)
    const host = render(episode)
    expect(host.querySelector('.src')).toBeNull()
    expect(host.querySelector('.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
    expect(host.querySelector('.when'), 'and it does not read No sources yet').toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})
