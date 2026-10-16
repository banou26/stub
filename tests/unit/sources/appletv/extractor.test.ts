// One stub media is one run, and Apple TV's bare content id is the id every season of a show shares.
// A row minted from that id names the show, so it goes out scoped CONTAINER and the store keeps it out
// of every run's identity space: the unscoped search row is exactly the shape that welded runs of one
// show together when it reached graph.link as a run. A film and a season-scoped row each name one run.
//
// Apple describes a season with a number and a premiere and nothing this source will vouch for beyond
// that (27.280% of its per-season episodes belong to another season), so the only evidence that can
// place a run here is a day inside the 45 day window: a year cannot show a count-less season is not a
// fold, so it only ever vetoes.
import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { resolvers } from '../../../../src/sources/appletv/extractor'
import SEVERANCE from '../../../fixtures/appletv/severance.json'
import SEVERANCE_S2_EPISODES from '../../../fixtures/appletv/severance-s2-episodes.json'
import SLOW_HORSES from '../../../fixtures/appletv/slow-horses.json'
import THE_INSTIGATORS from '../../../fixtures/appletv/the-instigators.json'
import SEARCH_TEHRAN from '../../../fixtures/appletv/search-tehran.json'
import TEHRAN from '../../../fixtures/appletv/tehran.json'
import SEARCH_NAPOLEON from '../../../fixtures/appletv/search-napoleon.json'
import NAPOLEON from '../../../fixtures/appletv/napoleon.json'
import NAPOLEON_DIRECTORS_CUT from '../../../fixtures/appletv/napoleon-directors-cut.json'
import SEARCH_WOLFS from '../../../fixtures/appletv/search-wolfs.json'
import SEARCH_HOUSE from '../../../fixtures/appletv/search-house.json'
import SEARCH_THE from '../../../fixtures/appletv/search-the.json'

const ATV = 'https://uts-api.itunes.apple.com/uts/v3'
const PARAMS = 'caller=web&sf=143441&v=58&pfm=web&locale=en-US&utsk=0'
const url = (path: string) => `${ATV}${path}${path.includes('?') ? '&' : '?'}${PARAMS}`

// throws on an unlisted url, so fixture drift fails loudly instead of reading as an empty answer
const ctxFor = (table: Record<string, unknown>, known?: unknown, request = new Request('http://d/graphql')): ExtractorServerContext => ({
  request,
  fetch: (async (input: string) => {
    const key = typeof input === 'string' ? input : String(input)
    if (!(key in table)) throw new Error(`unstubbed url: ${key}`)
    return { json: async () => table[key], ok: true, status: 200 }
  }) as unknown as ExtractorServerContext['fetch'],
  // what the aggregated media already knows, or per uri; the listener ends at once so a probe never waits
  findAggregatedMedia: async (uri: string) => typeof known === 'function' ? known(uri) : known,
  listenForMediaChanges: async function* () {},
} as unknown as ExtractorServerContext)

const subscriptions = resolvers.Subscription as any

const first = async (iterator: AsyncIterator<any>): Promise<any> => (await iterator.next()).value

const searchPage = async (term: string, items: unknown[]) => {
  const ctx = ctxFor({ [url(`/search?searchTerm=${encodeURIComponent(term)}`)]: { data: { canvas: { shelves: [{ items }] } } } })
  const result = await first(subscriptions.mediaPage.subscribe(undefined, { input: { search: term } }, ctx))
  return result.mediaPage.nodes
}

const resolveMedia = async (uri: string, table: Record<string, unknown>, known?: unknown) => {
  const result = await first(subscriptions.media.subscribe(undefined, { input: { uri } }, ctxFor(table, known)))
  return result.media
}

type Ask = { showId: string, startDate?: string, titles?: string[], episodeCount?: number }

const askSeason = async (input: Ask, table: Record<string, unknown>) => {
  const result = await first(subscriptions.similarMedia.subscribe(undefined, { input }, ctxFor(table)))
  return result.similarMedia ?? null
}

const SHOW = 'umc.cmc.show'
const SEASON_1 = 'umc.cmc.show.season1'
const SEASON_2 = 'umc.cmc.show.season2'
const SEASON_3 = 'umc.cmc.show.season3'

// Two seasons in 2023, 182 days apart: a year cannot tell them apart, a day can. Season 1 is 2021's
// alone. Every season's `releaseDate` is epoch MILLISECONDS, as the endpoint answers it.
const showRoutes = () => ({
  [url(`/shows/${SHOW}`)]: {
    data: {
      content: { id: SHOW, type: 'Show', title: 'A Show', releaseDate: Date.UTC(2021, 0, 11) },
      seasons: {
        [SEASON_1]: { id: SEASON_1, seasonNumber: 1, releaseDate: Date.UTC(2021, 0, 11) },
        [SEASON_2]: { id: SEASON_2, seasonNumber: 2, releaseDate: Date.UTC(2023, 3, 3) },
        [SEASON_3]: { id: SEASON_3, seasonNumber: 3, releaseDate: Date.UTC(2023, 9, 2) },
      },
    },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_1}`)]: {
    data: { episodes: [{ id: 'ep-1-1', title: 'S1E1', seasonNumber: 1, episodeNumber: 1 }, { id: 'ep-1-2', title: 'S1E2', seasonNumber: 1, episodeNumber: 2 }] },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_2}`)]: {
    data: { episodes: [{ id: 'ep-2-1', title: 'S2E1', seasonNumber: 2, episodeNumber: 1 }] },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_3}`)]: {
    data: { episodes: [{ id: 'ep-3-1', title: 'S3E1', seasonNumber: 3, episodeNumber: 1 }] },
  },
})

const movieRoutes = () => ({
  [url('/shows/umc.cmc.film')]: { code: 404, title: 'NotFound', message: 'show not found' },
  [url('/movies/umc.cmc.film')]: { data: { content: { id: 'umc.cmc.film', type: 'Movie', title: 'A Film', releaseDate: Date.UTC(2020, 5, 1) } } },
})

test('a search row for a Show carries the id every season shares, so it is a CONTAINER', async () => {
  const nodes = await searchPage('A Show', [{ id: SHOW, type: 'Show', title: 'A Show' }])

  expect(nodes.map((node: any) => node.uri)).toEqual([`appletv:${SHOW}`])
  expect(nodes[0].scope, 'the bare show id names every run of the show at once').toBe('CONTAINER')
})

// The controls. A film has no seasons to be confused between, and a season-scoped row names one
// season only; a run where either of those read CONTAINER has stamped everything rather than the show.
// A film's MOVIE type is what keeps a live-action film out of its anime's cluster, which the category
// alone does not.
test('a search row for a Movie names one run, typed MOVIE', async () => {
  const nodes = await searchPage('A Film', [{ id: 'umc.cmc.film', type: 'Movie', title: 'A Film' }])

  expect(nodes.map((node: any) => node.uri)).toEqual(['appletv:umc.cmc.film'])
  expect(nodes[0].scope).toBe('RUN')
  expect(nodes[0].type).toBe('MOVIE')
})

test('a season-scoped media names one run, and attaches only that season', async () => {
  const media = await resolveMedia(`appletv:${SHOW}-s2`, showRoutes())

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

test('a movie resolved by id names one run', async () => {
  const media = await resolveMedia('appletv:umc.cmc.film', movieRoutes())

  expect(media?.uri).toBe('appletv:umc.cmc.film')
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

// Recorded 2026-10-16 through the relay with the reader's own `/shows/<id>`, `/movies/<id>` and
// `/shows/<id>/episodes` requests. Each keeps every image its answer carries, so the test shows which
// one is read. A show's `posterArt` is its wide image with the title and Apple's logo lettered on it.
type Recorded = { data: { content: { id: string, type: string } } }

const recordedRoutes = (answer: Recorded) => {
  const { id, type } = answer.data.content
  return type === 'Movie'
    ? { [url(`/shows/${id}`)]: { code: 404, title: 'NotFound', message: 'show not found' }, [url(`/movies/${id}`)]: answer }
    : { [url(`/shows/${id}`)]: answer }
}

const mzstatic = (image: string, size: string) => `https://is1-ssl.mzstatic.com/image/thumb/${image}/${size}.jpg`
const urls = (images?: { url: string }[]) => images?.map(image => image.url)

test.each([
  ['show', SLOW_HORSES, 'gaxT8-02hxIwn62aKXvgkA', 'EJo0K6ENwDN0rmv0m5br2g'],
  ['film', THE_INSTIGATORS, 'C0GzyIYIV0BPygvI8YWSAA', 'IzskYQaIAHGnApdnP7R68w'],
])('a recorded %s answer takes its tall image as a 2:3 poster and its unlettered wide one as a banner', async (_, answer: Recorded, poster, banner) => {
  const media = await resolveMedia(`appletv:${answer.data.content.id}`, recordedRoutes(answer))

  expect(urls(media?.covers)).toEqual([mzstatic(poster, '600x900tc')])
  expect(urls(media?.banners)).toEqual([mzstatic(banner, '1920x1080sr')])
})

// Recorded 2026-10-16. A search item carries only landscape art (`shelfImage`, `shelfImageBackground`,
// `transitionImage`), and its shelves list each item twice. Tehran and Napoleon: The Director's Cut are
// cards no other source joined on the live search page.
type SearchNode = { uri: string, covers: { url: string }[], banners: { url: string }[] }
type SearchAnswer = { data: { canvas: { shelves: { items: { id: string, title: string }[] }[] } } }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// a fresh module, so no search reads what another test's search remembered
const freshSources = async () => {
  vi.resetModules()
  return (await import('../../../../src/sources/appletv/extractor')).resolvers.Subscription as any
}

const searchRecorded = async (term: string, table: Record<string, unknown>, sources?: any, known?: unknown) => {
  sources ??= await freshSources()
  const asked: string[] = []
  const ctx = ctxFor(table, known)
  const fetch = ctx.fetch
  ctx.fetch = ((input: string) => {
    asked.push(input)
    return fetch(input)
  }) as ExtractorServerContext['fetch']
  const answers: { asked: number, nodes: SearchNode[] }[] = []
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const answering = (async () => {
    for await (const result of sources.mediaPage.subscribe(undefined, { input: { search: term } }, ctx)) {
      answers.push({ asked: asked.length, nodes: result.mediaPage.nodes })
    }
  })()
  await vi.runAllTimersAsync()
  await answering
  return { asked, answers, nodes: new Map(answers.flatMap(answer => answer.nodes).map(node => [node.uri, node])) }
}

const searchTable = (term: string, answer: unknown, ...shown: Recorded[]) => ({
  [url(`/search?searchTerm=${encodeURIComponent(term)}`)]: answer,
  ...Object.fromEntries(shown.map(own => [url(`/${own.data.content.type === 'Movie' ? 'movies' : 'shows'}/${own.data.content.id}`), own])),
})

const readTitles = (asked: string[], answer: SearchAnswer) => {
  const titles = new Map(answer.data.canvas.shelves.flatMap(shelf => shelf.items).map(item => [item.id, item.title]))
  return asked.flatMap(input => input.match(/\/(?:shows|movies)\/([^/?]+)\?/)?.slice(1).map(id => titles.get(id)) ?? [])
}

test.each([
  ['show', 'Tehran', SEARCH_TEHRAN, [TEHRAN], { [TEHRAN.data.content.id]: ['pWmm65HepO4FZvrMeL7Gxw', '4eOr8cFzDPWk0_WEn1hakA'] }],
  ['film', 'Napoleon', SEARCH_NAPOLEON, [NAPOLEON, NAPOLEON_DIRECTORS_CUT], {
    [NAPOLEON.data.content.id]: ['pLNV6LiSH0TvyZKickchLw', 'ev_xryrZVdS_VEe9RI05Pg'],
    [NAPOLEON_DIRECTORS_CUT.data.content.id]: ['uB7gWiiGWqFdVmgZvaEf_w', '64yjq0s57QKALj2IdzpsWw'],
  }],
])('a %s search item the page keeps carries the tall poster and the banner of its own answer', async (_, term, answer, shown, art) => {
  const { nodes } = await searchRecorded(term, searchTable(term, answer, ...shown))

  for (const [id, [poster, banner]] of Object.entries(art)) {
    expect(urls(nodes.get(`appletv:${id}`)?.covers)).toEqual([mzstatic(poster!, '600x900tc')])
    expect(urls(nodes.get(`appletv:${id}`)?.banners)).toEqual([mzstatic(banner!, '1920x1080sr')])
  }
})

test('a search answers every row before it reads any, then the rows it read', async () => {
  const { answers } = await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN, TEHRAN))

  expect(answers.map(answer => [answer.asked, answer.nodes.length])).toEqual([[1, 11], [2, 1]])
})

// The page keeps a result whose title scores at least 0.7 against the query, and only those are read,
// each once although the shelves list it twice. "Wolfs" keeps Wolfwalkers (0.82) and Wolfboy (0.71) and
// drops Five Days at Memorial (0.33); "house" keeps nothing, its best being Slow Horses (0.62).
test.each([
  ['Tehran', SEARCH_TEHRAN, ['Tehran']],
  ['Napoleon', SEARCH_NAPOLEON, ['Napoleon', 'Napoleon: The Director’s Cut']],
  ['Wolfs', SEARCH_WOLFS, ['Wolfs', 'Wolfwalkers', 'Wolfboy and the Everything Factory']],
  ['house', SEARCH_HOUSE, []],
])('a search for %s reads only the items the page keeps, each once', async (term, answer, read) => {
  const { asked } = await searchRecorded(term, searchTable(term, answer))

  expect(readTitles(asked, answer)).toEqual(read)
})

// "the" keeps 54 of its 56 results, so reading every one is a burst past the relay's 40 per viewer.
test('a search for a common word reads only the first twelve items the page keeps, in the order Apple answers them', async () => {
  const { asked } = await searchRecorded('the', searchTable('the', SEARCH_THE))

  expect(readTitles(asked, SEARCH_THE)).toEqual([
    'The Morning Show', 'The Gorge', 'The Last Thing He Told Me', 'The Last First: Winter K2', 'The Studio', 'The Family Plan 2',
    'The Family Plan', 'The Crowded Room', 'The Lost Bus', 'The Buccaneers', 'The Greatest Beer Run Ever', 'The Peanuts Classics',
  ])
})

// The twelve are counted before the cards another source already gives a poster are left out, so the
// cost stays on the first cards the page draws.
test('a search for a common word reads only the blank cards among the first twelve, none after them', async () => {
  const ids = new Map(SEARCH_THE.data.canvas.shelves.flatMap(shelf => shelf.items).map(item => [item.title, item.id]))
  const postered = new Set(['The Gorge', 'The Studio', 'The Lost Bus'].map(title => `appletv:${ids.get(title)}`))
  const known = (uri: string) => postered.has(uri) ? { covers: [{ url: 'https://image.tmdb.org/t/p/w600/poster.jpg' }] } : undefined
  const { asked } = await searchRecorded('the', searchTable('the', SEARCH_THE), undefined, known)

  expect(readTitles(asked, SEARCH_THE)).toEqual([
    'The Morning Show', 'The Last Thing He Told Me', 'The Last First: Winter K2', 'The Family Plan 2', 'The Family Plan',
    'The Crowded Room', 'The Buccaneers', 'The Greatest Beer Run Ever', 'The Peanuts Classics',
  ])
})

// Each site draws its own category alone, and anime.fkn.app never draws a card Apple TV answers alone.
test.each([
  ['series.fkn.app', [
    'The Morning Show', 'The Last Thing He Told Me', 'The Studio', 'The Crowded Room', 'The Buccaneers', 'The Peanuts Classics',
    'The Line', 'The Last Days of Ptolemy Grey', 'The Afterparty', 'The Snoopy Show', 'The Last Frontier', 'The Hunt',
  ]],
  ['movies.fkn.app', [
    'The Gorge', 'The Last First: Winter K2', 'The Family Plan 2', 'The Family Plan', 'The Lost Bus', 'The Greatest Beer Run Ever',
    'The Banker', 'The Sixth Sense', 'The Dink', 'The Girl With the Dragon Tattoo', 'The Instigators', 'F1 The Movie',
  ]],
  ['anime.fkn.app', []],
])('on %s a search reads only the cards that site draws', async (host, read) => {
  vi.stubGlobal('location', new URL(`https://${host}/`))
  const { asked } = await searchRecorded('the', searchTable('the', SEARCH_THE))

  expect(readTitles(asked, SEARCH_THE)).toEqual(read)
})

test('a search item whose own answer fails is still answered, with no poster, and the others keep theirs', async () => {
  const { nodes } = await searchRecorded('Napoleon', searchTable('Napoleon', SEARCH_NAPOLEON, NAPOLEON))

  expect(urls(nodes.get(`appletv:${NAPOLEON_DIRECTORS_CUT.data.content.id}`)?.covers)).toEqual([])
  expect(urls(nodes.get(`appletv:${NAPOLEON.data.content.id}`)?.covers)).toEqual([mzstatic('pLNV6LiSH0TvyZKickchLw', '600x900tc')])
})

test('a result whose card another source already gives a poster is not read, nor answered again', async () => {
  const { asked, answers } = await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN), undefined, { covers: [{ url: 'https://image.tmdb.org/t/p/w600/tehran.jpg' }] })

  expect(readTitles(asked, SEARCH_TEHRAN)).toEqual([])
  expect(answers).toHaveLength(1)
})

const TEHRAN_POSTER = mzstatic('pWmm65HepO4FZvrMeL7Gxw', '600x900tc')

// Typing a title searches each prefix that holds for a moment, and the prefixes keep the same results.
test('a result read once is not read again in the session, and keeps its poster', async () => {
  const sources = await freshSources()
  await searchRecorded('Tehra', searchTable('Tehra', SEARCH_TEHRAN, TEHRAN), sources)
  const { asked, nodes } = await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN, TEHRAN), sources)

  expect(readTitles(asked, SEARCH_TEHRAN)).toEqual([])
  expect(urls(nodes.get(`appletv:${TEHRAN.data.content.id}`)?.covers)).toEqual([TEHRAN_POSTER])
})

test('a read that failed is asked again by the next search', async () => {
  const sources = await freshSources()
  await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN), sources)
  const { asked, nodes } = await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN, TEHRAN), sources)

  expect(readTitles(asked, SEARCH_TEHRAN)).toEqual(['Tehran'])
  expect(urls(nodes.get(`appletv:${TEHRAN.data.content.id}`)?.covers)).toEqual([TEHRAN_POSTER])
})

// The page replaces its search on every prefix that holds, so a replaced search's reads would only
// spend the relay's per-viewer burst, retries included, against the search that replaced it.
const cancellable = async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const cancel = new AbortController()
  const ctx = ctxFor(searchTable('Tehran', SEARCH_TEHRAN), undefined, new Request('http://d/graphql', { signal: cancel.signal }))
  const answer = ctx.fetch
  const reads: string[] = []
  ctx.fetch = ((input: string, init?: RequestInit) => {
    if (input.includes('/search?')) return answer(input)
    reads.push(input)
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
  }) as ExtractorServerContext['fetch']
  const sources = await freshSources()
  const search = sources.mediaPage.subscribe(undefined, { input: { search: 'Tehran' } }, ctx)
  await search.next()
  return { cancel, reads, rest: search.next(), sources }
}

const settled = (answer: Promise<unknown>) =>
  Promise.race([answer, vi.advanceTimersByTimeAsync(60_000).then(() => 'still reading')])

test('a search replaced before it has held for two seconds reads nothing', async () => {
  const { cancel, reads, rest } = await cancellable()
  await vi.advanceTimersByTimeAsync(1_900)
  cancel.abort()

  expect(await settled(rest)).toEqual({ done: true, value: undefined })
  expect(reads).toEqual([])
})

test('a search cancelled while its reads are out stops them and answers nothing more, and the next search asks them again', async () => {
  const { cancel, reads, rest, sources } = await cancellable()
  await vi.advanceTimersByTimeAsync(2_000)
  await vi.waitFor(() => expect(reads).toHaveLength(1))
  cancel.abort()

  expect(await settled(rest)).toEqual({ done: true, value: undefined })

  const { asked, nodes } = await searchRecorded('Tehran', searchTable('Tehran', SEARCH_TEHRAN, TEHRAN), sources)

  expect(readTitles(asked, SEARCH_TEHRAN)).toEqual(['Tehran'])
  expect(urls(nodes.get(`appletv:${TEHRAN.data.content.id}`)?.covers)).toEqual([TEHRAN_POSTER])
})

// Each episode also names the show's lettered art as `showPosterArt`.
test('a recorded season answer gives each of its episodes its own still', async () => {
  const { id } = SEVERANCE.data.content
  const media = await resolveMedia(`appletv:${id}-s2`, {
    [url(`/shows/${id}`)]: SEVERANCE,
    [url(`/shows/${id}/episodes?selectedSeasonId=umc.cmc.uhm560ns0yg3a5fy454bb967`)]: SEVERANCE_S2_EPISODES,
  })

  expect(media?.episodes?.map((episode: { thumbnails: { url: string }[] }) => urls(episode.thumbnails))).toEqual(
    ['H8ApKzved8NUkSOA-0Wmlg', '8hSoEZuR695MkM1iy-p7-w', '9SMCasTEGL-y4nF4gtUMew', 'b3K0ifmQXbyogK6W7kppTg', 'zQDsSwFG7XVFxR24ZuYTfg', 'Wgb1NPDkunT1lWimTR0jaQ']
      .map(still => [mzstatic(still, '1280x720')])
  )
})

// THE MEDIA PATH picks its season through the shared picker, off what the aggregated media knows.
test('a media whose run is dated inside a season\'s window resolves to that season', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show' }], startDate: '2023-04-10' })

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

// A show used to have no identity here when its season could not be placed, and a link to it vanished.
// The bare id IS the show, so it is answered as the show: a CONTAINER with no episodes, the shape
// tvmaze and unogs already answer, and the store keeps it as a container edge off the run.
test('a show whose season cannot be placed answers as the CONTAINER on the media path', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show' }] })

  expect(media?.uri).toBe(`appletv:${SHOW}`)
  expect(media?.scope).toBe('CONTAINER')
  expect(media?.episodes).toEqual([])
  expect(media?.episodeCount).toBeUndefined()
})

// Apple offers no episode count, so an ordinal in our title has nothing to be checked against and never
// picks on its own: "Season 2" of 8 episodes could as easily be Apple's season 2 of 25.
test('a title ordinal with a count is not enough here, because Apple vouches for no count', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show Season 2' }], episodeCount: 8 })

  expect(media?.uri).toBe(`appletv:${SHOW}`)
  expect(media?.scope).toBe('CONTAINER')
  expect(await askSeason({ showId: SHOW, titles: ['A Show Season 2'], episodeCount: 8 }, showRoutes())).toBeNull()
})

// SIMILAR MEDIA: the one season of a show the caller's date establishes, as a run, or null.
test('similarMedia places a run by a day inside the window', async () => {
  const media = await askSeason({ showId: SHOW, startDate: '2023-04-10' }, showRoutes())

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.handles).toEqual([])
  expect(media?.episodeCount).toBe(1)
})

// The window is the whole rule on a day: a day 100 days from every premiere is a disagreement about
// when the run started, and a title ordinal that would have named season 2 does not rescue it.
test('similarMedia refuses a day outside every window, whatever the title says', async () => {
  expect(await askSeason({ showId: SHOW, startDate: '2022-07-12', titles: ['A Show Season 2'], episodeCount: 1 }, showRoutes())).toBeNull()
})

// A `YYYY-01-01` names a year. 2023 holds two seasons, so it names neither; 2021 holds one, and it
// still names nothing here, because Apple vouches for no count and a season whose length is unknown
// cannot be shown not to be a fold. Until 2026-09-05 the 2021 ask answered season 1, and so did a
// second 2021 run of any length: two runs on one season.
test('similarMedia refuses a year-only date, whether the year holds one season or two', async () => {
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01' }, showRoutes())).toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01', titles: ['A Show'], episodeCount: 12 }, showRoutes())).toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01', titles: ['A Show: Second Arc'], episodeCount: 8 }, showRoutes())).toBeNull()

  expect(await askSeason({ showId: SHOW, startDate: '2021-01-01' }, showRoutes()), 'one season in the year, and no count to check it by').toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2021-01-01', titles: ['A Show'], episodeCount: 12 }, showRoutes())).toBeNull()

  const media = await askSeason({ showId: SHOW, startDate: '2021-01-11' }, showRoutes())
  expect(media?.uri, 'the control: the same season by a day inside its window').toBe(`appletv:${SHOW}-s1`)
})

test('similarMedia is null for a movie, a missing show and no evidence, and yields exactly once', async () => {
  expect(await askSeason({ showId: 'umc.cmc.film', startDate: '2020-06-01' }, movieRoutes())).toBeNull()
  expect(await askSeason({ showId: 'umc.cmc.gone', startDate: '2023-04-10' }, {
    [url('/shows/umc.cmc.gone')]: { code: 404 },
    [url('/movies/umc.cmc.gone')]: { code: 404 },
  })).toBeNull()
  expect(await askSeason({ showId: SHOW }, showRoutes())).toBeNull()

  for (const input of [{ showId: SHOW, startDate: '2023-04-10' }, { showId: SHOW }]) {
    const iterator = subscriptions.similarMedia.subscribe(undefined, { input }, ctxFor(showRoutes()))
    expect((await iterator.next()).done).toBe(false)
    expect((await iterator.next()).done).toBe(true)
  }
})
