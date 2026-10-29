// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import type { DetailsEpisode } from '../../../src/router/home/media-details'

import { render as rerender } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { DISABLED_SOURCES_KEY } from '../../../src/sources/disabled-sources'
import { releaseDateLabel } from '../../../src/utils/release-date'

let origin = 'cr'
let icon: string | null = null
vi.mock('urql', () => ({
  useSubscription: ({ variables }: { variables: { input: { ids: string[] } } }) =>
    [{ data: { originPage: { nodes: variables.input.ids.includes(origin) ? [{ id: origin, name: origin, icon, color: null }] : [] } } }],
}))
vi.mock('../../../src/worker', () => ({}))
vi.mock('lucide-react', () => ({ LucidePlay: () => null }))

const { default: MoviePlay, FilmSources } = await import('../../../src/router/home/movie-play')
const { useWatchSources } = await import('../../../src/router/home/media-details')
const { startLanguage } = await import('../../../src/i18n')

const episode = {
  uri: 'ag:(cr:GX1)',
  handles: [{ relation: 'SAME_AS', node: { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' } }],
} as unknown as DetailsEpisode

const hosts: HTMLElement[] = []
const TZ = process.env.TZ
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  origin = 'cr'
  icon = null
  vi.useRealTimers()
  if (TZ === undefined) delete process.env.TZ
  else process.env.TZ = TZ
})

type Offers = Parameters<typeof useWatchSources>[2]

// what the modal draws for a film under its title, the tracking it is handed beside Play, and its services
const Film = ({ movie, handles, startDate, status, settled }: { movie: DetailsEpisode | undefined, handles: Offers, startDate: string | null, status?: string, settled: boolean }) => {
  const { sources } = useWatchSources(movie, 'ag:(anilist:9)', handles)
  const film = { episode: movie, mediaUri: 'ag:(anilist:9)', sources, settled, startDate, status }
  return (
    <>
      <MoviePlay {...film}>
        <section className="tracking-compact"/>
      </MoviePlay>
      <FilmSources {...film}/>
    </>
  )
}

const tree = (movie: DetailsEpisode | undefined, handles: Offers = [], startDate: string | null = '2020-01-01', status?: string, settled = true) => {
  const { hook } = memoryLocation({ path: '/' })
  return withIntl(<Router hook={hook}><Film movie={movie} handles={handles} startDate={startDate} status={status} settled={settled}/></Router>)
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

// the line under a film's large date: its day written out, or Releases and a year or a month alone
const when = (host: HTMLElement) => host.querySelector('.release > .date')?.textContent
const longDay = (day: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(day))

test('Play opens the watch page naming no source, even when Crunchyroll plays', () => {
  expect(render(episode).querySelector('a.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
})

test('Play\'s row draws no source icon, the list names each source and what a click does', () => {
  const host = render(episode)
  expect(host.querySelector('a.source[href="/watch/ag:(anilist:9)/ag:(cr:GX1)/cr:GX1"] .name')?.textContent).toBe('cr')
  expect(host.querySelector('a.source .how')?.textContent).toBe('Plays here')
  expect(host.querySelector('.actions')?.querySelectorAll('a:not(.play)')).toHaveLength(0)
})

// HOR-1059: the owner did not want an empty band between the tracking and what is above it
test('the tracking shares Play\'s row, and the row under the date of a film not out yet', () => {
  const classes = (host: HTMLElement) => [...host.querySelector('.movie > .actions')!.children].map(child => child.className)
  expect(classes(render(episode))).toEqual(['play', 'tracking-compact'])
  const ahead = render(episode, [], '2099-01-01', 'NOT_YET_RELEASED')
  expect([...ahead.querySelector('.movie')!.children].map(child => child.className)).toEqual(['release', 'actions'])
  expect(classes(ahead)).toEqual(['tracking-compact'])
})

// a browser cannot open a magnet, and the watch page plays a torrent plugin's release itself
test('a lone release a browser cannot open plays on the watch page, so Play shows', () => {
  origin = 'nyaa'
  const magnet = {
    uri: 'ag:(nyaa:a)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'nyaa:a', origin: 'nyaa', url: 'magnet:?xt=urn:btih:a' } }],
  } as unknown as DetailsEpisode
  const host = render(magnet)
  expect(host.querySelector('a[href^="magnet:"]')).toBeNull()
  const button = host.querySelector('a.source')
  expect(button?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(nyaa:a)/nyaa:a')
  expect(button?.getAttribute('target')).toBeNull()
  expect(button?.querySelector('.count'), 'one release, no count').toBeNull()
  expect(host.querySelector('a.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(nyaa:a)')
})

test('a source with several releases of the film shows how many, and opens the watch page on the first', () => {
  origin = 'nyaa'
  const two = {
    uri: 'ag:(nyaa:a)',
    handles: ['a', 'b'].map(id => ({ relation: 'SAME_AS', node: { uri: `nyaa:${id}`, origin: 'nyaa', url: `https://nyaa.si/view/${id}` } })),
  } as unknown as DetailsEpisode
  const button = render(two).querySelector('a.source')
  expect(button?.querySelector('.count')?.textContent).toBe('2')
  expect(button?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(nyaa:a)/nyaa:a')
  expect(button?.getAttribute('target')).toBeNull()
})

// a Canadian's Prime Video plays in stub with the extension, which the watch page asks for, so Play opens it there
test('a film whose stream plays only with the extension shows Play, and its button still links out', () => {
  origin = 'amazon'
  const canadian = {
    uri: 'ag:(amazon:amzn1.dv.gti.ca000001)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'amazon:amzn1.dv.gti.ca000001', origin: 'amazon', url: 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.ca000001' } }],
  } as unknown as DetailsEpisode
  process.env.TZ = 'Asia/Tokyo'
  expect(render(canadian).querySelector('.play'), 'the control: not the viewer\'s own Prime Video').toBeNull()
  process.env.TZ = 'America/Toronto'
  const host = render(canadian)
  expect(host.querySelector('a.source')?.getAttribute('target'), 'the control: on the cloud its button links out').toBe('_blank')
  expect(host.querySelector('.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(amazon:amzn1.dv.gti.ca000001)')
})

// a film's offers hang off the media, not its one episode (Ninja Scroll's HIDIVE, 2026-10-12)
test('a media-level offer the episode does not name links out from its button', () => {
  origin = 'hidive'
  const host = render(episode, [
    { relation: 'SAME_AS', node: { origin: 'hidive', url: 'https://www.hidive.com/interstitial/715215' } },
  ])
  const link = host.querySelector('a.source[href="https://www.hidive.com/interstitial/715215"]')
  expect(link?.getAttribute('target')).toBe('_blank')
  expect(link?.querySelector('.how')?.textContent).toBe('hidive.com')
  expect(host.querySelector('a.play')).toBeNull()
  expect(host.querySelector('.none'), 'and it does not read No sources yet').toBeNull()
})

test('until a source lands or the film\'s sources have all answered, Play\'s place is held and No sources yet is not read', () => {
  origin = 'none'
  const loading = render(episode, [], '2020-01-01', undefined, false)
  expect(loading.querySelector('.actions > .play-pending')).not.toBeNull()
  expect(loading.querySelector('.none')).toBeNull()
  const settled = render(episode)
  expect(settled.querySelector('.play-pending'), 'the control: settled, nothing is held').toBeNull()
  expect(settled.querySelector('.none')?.textContent).toBe('No sources yet')
  origin = 'cr'
  expect(render(episode, [], '2020-01-01', undefined, false).querySelector('.play-pending'), 'Play has landed').toBeNull()
})

// Made in Abyss: Mezameru Shinpi Part 2, 2026-10-26: AniList lists it as not yet released, with no date
test('a film not out yet with no date reads Coming soon, never No sources yet, and holds nothing while its sources answer', () => {
  origin = 'none'
  for (const settled of [false, true]) {
    const host = render(episode, [], null, 'NOT_YET_RELEASED', settled)
    expect([host.querySelector('.release > .day')?.textContent, when(host)], `settled ${settled}`).toEqual(['Coming soon', 'No release date yet'])
    expect(host.querySelector('.none')).toBeNull()
    expect(host.querySelector('.play-pending, .source-pending'), `settled ${settled}: nothing is held`).toBeNull()
  }
  expect(render(episode, [], null, undefined, false).querySelector('.play-pending'), 'the control: a film not known to be ahead is held').not.toBeNull()
  expect(render(episode, [], null).querySelector('.none')?.textContent, 'the control: and reads No sources yet once settled').toBe('No sources yet')
})

// what the list over the description holds, a card or a card's place
const cards = (host: HTMLElement) => [...host.querySelector('.sources')?.children ?? []]
  .map(card => card.firstElementChild!.className.split(' ').filter(name => !name.startsWith('css-')).join('.'))

// so the description under the list keeps its place while the services land
test('until a film settles, the list holds three cards\' place, each card landing in one', () => {
  origin = 'none'
  expect(cards(render(episode, [], '2020-01-01', undefined, false))).toEqual(['source-pending', 'source-pending', 'source-pending'])
  expect(render(episode).querySelector('.sources'), 'the control: settled with none, no list').toBeNull()
  origin = 'hidive'
  const offer = [{ relation: 'SAME_AS', node: { origin: 'hidive', url: 'https://www.hidive.com/interstitial/715215' } }]
  expect(cards(render(episode, offer, '2020-01-01', undefined, false))).toEqual(['source', 'source-pending', 'source-pending'])
  expect(cards(render(episode, offer)), 'settled, the rest let go').toEqual(['source'])
  origin = 'none'
  expect(render(episode, [], '2099-01-01', 'NOT_YET_RELEASED', false).querySelector('.source-pending'), 'a film not out yet holds none').toBeNull()
})

// so a film whose services all link out, none of them one stub plays, loses the held place as its buttons land,
// not when the media settles
test('a source that links out ends the hold, settled or not', () => {
  origin = 'hidive'
  const offer = [{ relation: 'SAME_AS', node: { origin: 'hidive', url: 'https://www.hidive.com/interstitial/715215' } }]
  for (const settled of [false, true]) {
    const host = render(episode, offer, '2020-01-01', undefined, settled)
    expect(host.querySelector('a.source'), `the control: its row, settled ${settled}`).not.toBeNull()
    expect(host.querySelector('.play-pending, a.play'), `settled ${settled}`).toBeNull()
  }
})

// JustWatch's Netflix offer can land before Netflix's own answer brings the film's episode, 0.15 to 2 s on Penguin
// Highway (2026-10-19), and until then Netflix links out
test('while a source stub plays still links out and the film has not settled, the bar holds Play\'s place', () => {
  origin = 'nf'
  const offer = [{ relation: 'SAME_AS', node: { origin: 'nf', url: 'https://www.netflix.com/title/81037598' } }]
  const film = { uri: 'ag:(jw:403680-1)', handles: [] } as unknown as DetailsEpisode
  const early = render(film, offer, '2018-08-17', undefined, false)
  expect(early.querySelector('a.source')?.getAttribute('target'), 'the control: Netflix links out').toBe('_blank')
  expect(early.querySelector('.play-pending')).not.toBeNull()
  expect(render(film, offer, '2018-08-17').querySelector('.play-pending'), 'the control: settled, nothing to hold').toBeNull()
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === DISABLED_SOURCES_KEY ? '["nf"]' : null })
  try {
    expect(render(film, offer, '2018-08-17', undefined, false).querySelector('.play-pending'), 'turned off, Netflix never plays here').toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
  const played = {
    uri: 'ag:(jw:403680-1,nf:81037598-1)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'nf:81037598-1', origin: 'nf', url: 'https://www.netflix.com/watch/81037598' } }],
  } as unknown as DetailsEpisode
  expect(render(played, offer, '2018-08-17', undefined, false).querySelector('a.play'), 'the control: its episode landed').not.toBeNull()
})

test('a film not out yet never holds Play\'s place', () => {
  origin = 'none'
  const host = render(episode, [], '2099-01-01', 'NOT_YET_RELEASED', false)
  expect(when(host), 'the control: not out yet').toBe(longDay('2099-01-01'))
  expect(host.querySelector('.play-pending')).toBeNull()
})

// Simkl's `first_aired` for Blade Runner: Black Out 2022 (tests/fixtures/simkl/search-blade-runner.json),
// seen before it was out, from the two sides of Greenwich
test('a film not out yet names its release day, the same day for every viewer', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const host = seenAt('2017-09-01T12:00:00Z', zone, episode, '2017-09-26T00:00:00Z')
    expect(when(host), zone).toBe(longDay('2017-09-26'))
  }
})

// anizip's `airDateUtc` for Jujutsu Kaisen 0 (anilist 131573): 00:30 JST on Dec 24, still Dec 23 in UTC and Los Angeles
const jujutsuKaisen0 = { ...episode, releaseDate: '2021-12-23T15:30:00Z' } as DetailsEpisode

test('a film\'s own release day stays put when its episode\'s air time arrives, the same day for every viewer', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const host = seenAt('2021-12-01T12:00:00Z', zone, undefined, '2021-12-24T00:00:00Z')
    expect(when(host), zone).toBe(longDay('2021-12-24'))
    act(() => { rerender(tree(jujutsuKaisen0, [], '2021-12-24T00:00:00Z'), host) })
    expect(when(host), zone).toBe(longDay('2021-12-24'))
  }
})

// the title page and the hero decide by the episode's air time, so the modal does too
test('a film is out when its episode airs within a day of its own release day, in every zone, its line naming its own day until then', () => {
  for (const zone of ZONES) {
    const early = seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0, '2021-12-24T00:00:00Z')
    expect(when(early), zone).toBe(longDay('2021-12-24'))
    expect(early.querySelector('a.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0, '2021-12-24T00:00:00Z').querySelector('a.play'), zone).not.toBeNull()
  }
})

// a source's status lags the release, so it does not hold a film's own day either
test('a film whose episode names only a day, or a time further off, is out from the start of its own day where the viewer is', () => {
  // the first moment of Dec 24 in Los Angeles is 08:00 UTC, in Tokyo 15:00 UTC on Dec 23
  const dated = [{ ...episode, releaseDate: '2021-12-25' }, { ...episode, releaseDate: '2022-01-07T15:00:00Z' }] as DetailsEpisode[]
  for (const movie of dated) {
    for (const [zone, midnight] of [['America/Los_Angeles', '2021-12-24T08:00:00Z'], ['Asia/Tokyo', '2021-12-23T15:00:00Z']] as const) {
      const late = seenAt(new Date(Date.parse(midnight) - 60_000).toISOString(), zone, movie, '2021-12-24T00:00:00Z', 'NOT_YET_RELEASED')
      expect(when(late), zone).toBe(longDay('2021-12-24'))
      expect(late.querySelector('a.play'), zone).toBeNull()
      expect(seenAt(midnight, zone, movie, '2021-12-24T00:00:00Z', 'NOT_YET_RELEASED').querySelector('a.play'), `${zone} ${movie.releaseDate}`).not.toBeNull()
    }
  }
})

// AniList knowing only December 2021 and its schedule airing the film at 09:00 JST on Dec 24, which is 00:00 UTC
test('a film whose start is an air time at midnight UTC is out at that time, not from the start of its day', () => {
  const nine = { ...episode, releaseDate: '2021-12-24T00:00:00Z' } as DetailsEpisode
  for (const zone of ZONES) {
    expect(seenAt('2021-12-23T23:59:00Z', zone, nine, 'Fri, 24 Dec 2021 00:00:00 GMT').querySelector('a.play'), zone).toBeNull()
    expect(seenAt('2021-12-24T00:00:00Z', zone, nine, 'Fri, 24 Dec 2021 00:00:00 GMT').querySelector('a.play'), zone).not.toBeNull()
  }
})

test('a film with no release day of its own is out at its episode\'s air time, in every zone', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const early = seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0)
    expect(when(early), zone).toMatch(/December 2[34], 2021$/)
    expect(early.querySelector('a.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0).querySelector('a.play'), zone).not.toBeNull()
  }
})

// only the clock is faked, so nothing but its tick draws the bar again
test('Play appears on the clock\'s next tick once the film\'s release day has started', () => {
  // 23:59:50 on Oct 16 in Los Angeles
  process.env.TZ = 'America/Los_Angeles'
  vi.useFakeTimers({ now: Date.parse('2026-10-17T06:59:50Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
  const host = render(episode, [], '2026-10-17')
  expect(when(host), 'the control: not out yet').toBe(longDay('2026-10-17'))
  expect(host.querySelector('a.play')).toBeNull()

  act(() => { vi.advanceTimersByTime(30_000) })
  expect(render(episode, [], '2026-10-17').querySelector('a.play'), 'the control: a bar drawn now has Play').not.toBeNull()
  expect(host.querySelector('a.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
  expect(host.querySelector('.release')).toBeNull()
})

// AniList knows only December 2021 for Jujutsu Kaisen 0, so `airedDate` gives its schedule's first airing
test('a film whose own start is an air time is out at that time, and names its day where the viewer is', () => {
  const startDate = 'Thu, 23 Dec 2021 15:30:00 GMT'
  for (const [zone, day] of [['America/Los_Angeles', '2021-12-23'], ['Asia/Tokyo', '2021-12-24']] as const) {
    expect(when(seenAt('2021-12-22T12:00:00Z', zone, episode, startDate)), zone).toBe(longDay(day))
    expect(seenAt('2021-12-23T15:29:00Z', zone, jujutsuKaisen0, startDate).querySelector('a.play'), zone).toBeNull()
    expect(seenAt('2021-12-23T15:30:00Z', zone, jujutsuKaisen0, startDate).querySelector('a.play'), zone).not.toBeNull()
  }
})

test('a film with no release day of its own names its episode\'s air time, where the viewer is', () => {
  for (const [zone, day] of [['America/Los_Angeles', '2021-12-23'], ['Asia/Tokyo', '2021-12-24']] as const) {
    const host = seenAt('2021-12-01T12:00:00Z', zone, jujutsuKaisen0)
    expect(when(host), zone).toBe(longDay(day))
  }
})

// AniList's startDate for ONE PIECE FILM: GOD VALLEY (anilist 215855) is the year alone (2026-10-16)
test('a film known only to its year names the year, and a film not out yet stays upcoming until that year is over', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    for (const now of ['2026-11-01T12:00:00Z', '2027-10-17T12:00:00Z']) {
      const host = seenAt(now, zone, episode, '2027', 'NOT_YET_RELEASED')
      expect([host.querySelector('.release > .day')?.textContent, when(host)], `${zone} ${now}`).toEqual(['2027', 'Releases 2027'])
      expect(host.querySelector('a.play'), zone).toBeNull()
    }
  }
})

// TMDB dates every film by its year alone, and IMDb's search, Watchmode and uNoGS often do
test('a film dated by a year or a month that has begun is out, unless it is known not to be', () => {
  for (const zone of ZONES) {
    for (const startDate of ['2026', '2026-10']) {
      for (const status of [undefined, 'FINISHED']) {
        const out = seenAt('2026-10-17T12:00:00Z', zone, episode, startDate, status)
        expect(out.querySelector('a.play'), `${zone} ${startDate} ${status}`).not.toBeNull()
        expect(out.querySelector('.release'), `${zone} ${startDate} ${status}`).toBeNull()
      }
      const ahead = seenAt('2026-10-17T12:00:00Z', zone, episode, startDate, 'NOT_YET_RELEASED')
      expect(when(ahead), `${zone} ${startDate}`).toBe(`Releases ${releaseDateLabel(startDate)}`)
      expect(ahead.querySelector('a.play'), `${zone} ${startDate}`).toBeNull()
    }
  }
})

test('an episode\'s air time outranks a film\'s year or month alone', () => {
  for (const startDate of ['2027', '2027-07']) {
    const host = seenAt('2027-03-01T12:00:00Z', 'America/Los_Angeles', { ...episode, releaseDate: '2027-07-15T15:30:00Z' } as DetailsEpisode, startDate)
    expect(when(host), startDate).toBe(longDay('2027-07-15'))
    expect(host.querySelector('a.play'), startDate).toBeNull()
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
    expect(render(episode).querySelector('.source'), 'the control: its button is drawn while shown').not.toBeNull()
    setIconShown('cr', false)
    const host = render(episode)
    expect(host.querySelector('.source')).toBeNull()
    expect(host.querySelector('a.play')?.getAttribute('href')).toBe('/watch/ag:(anilist:9)/ag:(cr:GX1)')
    expect(host.querySelector('.none'), 'and it does not read No sources yet').toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})

// HOR-830: JustWatch's 100 px logos (src/sources/justwatch/logos.ts), sharper than the sites' favicons
test('a service\'s card shows its sharp logo, the site\'s own icon when that fails, then the name\'s first letter', () => {
  origin = 'nf'
  icon = 'https://nf.test/favicon.ico'
  const offer = [{ relation: 'SAME_AS', node: { origin: 'nf', url: 'https://www.netflix.com/title/81037598' } }]
  const host = render(episode, offer)
  const logo = () => host.querySelector('.source .logo')!
  expect(logo().className).toBe('logo sharp')
  expect(logo().querySelector('img')?.getAttribute('src')).toBe('https://images.justwatch.com/icon/207360008/s100/netflix.webp')
  act(() => { logo().querySelector('img')!.dispatchEvent(new Event('error')) })
  expect([logo().className, logo().querySelector('img')?.getAttribute('src')]).toEqual(['logo', 'https://nf.test/favicon.ico'])
  act(() => { logo().querySelector('img')!.dispatchEvent(new Event('error')) })
  expect([logo().querySelector('img'), logo().textContent]).toEqual([null, 'n'])
})

// HOR-830: design 3's service cards (the owner, 2026-10-30: "the same as the 3: service cards [...] but make them a bit
// smaller"), a picture the service has of the film, else its logo on its own colour
test('a service\'s card leads with its own picture of the film, its logo in a corner, else with its logo alone, and marks what a click does', () => {
  const pictured = {
    uri: 'ag:(cr:GX1)',
    thumbnails: [{ url: 'https://film.test/still.jpg' }],
    handles: [{ relation: 'SAME_AS', node: { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1', thumbnails: [{ url: 'https://cr.test/a.jpg' }, { url: 'https://cr.test/b.jpg' }] } }],
  } as unknown as DetailsEpisode
  const host = render(pictured)
  const card = () => host.querySelector('a.source')!
  const still = () => card().querySelector('.picture > img.still')
  expect([card().querySelector('.picture')!.className, still()?.getAttribute('src')]).toEqual(['picture', 'https://cr.test/a.jpg'])
  expect(card().querySelector('.picture > .logo'), 'its logo over the picture').not.toBeNull()
  expect(card().querySelector('.mark')?.textContent, 'stub plays it').toBe('▶')
  act(() => { still()!.dispatchEvent(new Event('error')) })
  expect(still()?.getAttribute('src'), 'its next picture').toBe('https://cr.test/b.jpg')
  act(() => { still()!.dispatchEvent(new Event('error')) })
  expect([card().querySelector('.picture')!.className, still()], 'none loads: its logo alone').toEqual(['picture logo-led', null])

  // HIDIVE names no picture, and Crunchyroll's and the film's own are not its
  origin = 'hidive'
  const offer = [{ relation: 'SAME_AS', node: { origin: 'hidive', url: 'https://www.hidive.com/interstitial/715215' } }]
  const linked = render(pictured, offer).querySelector('a.source')!
  expect([linked.querySelector('.picture')!.className, linked.querySelector('img.still')]).toEqual(['picture logo-led', null])
  expect(linked.querySelector('.mark')?.textContent, 'it opens its site').toBe('↗')
})

test('in German, Play, its release line, its cards, No sources yet and Coming soon read German', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    expect(render(episode).querySelector('a.play')?.textContent).toBe('Abspielen')
    expect(when(render(episode, [], '2099-01-01', 'NOT_YET_RELEASED', false))).toBe('Donnerstag, 1. Januar 2099')
    expect(render(episode).querySelector('.source .how')?.textContent).toBe('Hier abspielbar')
    origin = 'none'
    expect(render(episode).querySelector('.none')?.textContent).toBe('Noch keine Quellen')
    expect(when(render(episode, [], null, 'NOT_YET_RELEASED'))).toBe('Noch kein Erscheinungsdatum')
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})
