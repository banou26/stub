// A Crunchyroll id with no season component names the SHOW, and a show has no honest episode list in
// a store where every media is one season. Asking for one used to answer with every season's episodes
// at once, each carrying a WITHIN-season `episodeNumber`, which is how the Mushoku Tensei season 3
// page came to list 24 rows for a 14 episode season (measured on the live site 2026-08-31: rows 1 to
// 10 correct, row 11 an AniZip season 3 title over a season 1 description, rows 12 to 24 season 1).
//
// The bare handle reached that cluster from Kitsu, which publishes the show's Crunchyroll link on
// every season record. That half is pinned in tests/unit/sources/kitsu/stream-id.test.ts. This file pins the other
// half: even handed a show-level id, this source must not hand back a show's worth of episodes.
import { beforeEach, expect, test, vi } from 'vitest'

import { getMedia, resetCrunchyrollCaches, resolvers, cdnImageUrl } from '../../../../src/sources/crunchyroll/extractor'

const CMS = 'https://www.crunchyroll.com/content/v2/cms'

type Season = {
  id: string, seasonNumber: number, episodes: number, airDate?: string,
  /** a split cour: the season stops after `after` episodes and resumes months later, as one season */
  resume?: { after: number, at: string },
}

// Crunchyroll's own shape, trimmed to the fields getMedia reads. The three season lengths are what
// make the count observable: grouped by episodeNumber alone the union is max(23, 24, 14) = 24, which
// is the reported symptom, so a fixture where every season were the same length could not show it.
const WEEK = 7 * 24 * 60 * 60 * 1000

// WEEKLY from the premiere, and across the gap when the season is a split cour. A season is
// recognised as CONTAINING a run by its span, and a fixture where every episode shares a date has no
// span to read.
const airDateOf = (season: Season, index: number): string => {
  const first = Date.parse(season.airDate ?? '2026-07-04T15:00:00Z')
  if (!season.resume || index < season.resume.after) return new Date(first + index * WEEK).toISOString()
  return new Date(Date.parse(season.resume.at) + (index - season.resume.after) * WEEK).toISOString()
}

const series = (id: string, seasons: Season[]) => ({
  [`${CMS}/series/${id}?preferred_audio_language=ja-JP&locale=en-US`]: {
    data: [{ id, title: 'Mushoku Tensei', slug_title: 'mushoku-tensei', description: 'A show.', images: {} }]
  },
  [`${CMS}/series/${id}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`]: {
    data: seasons.map(season => ({
      id: season.id,
      title: `Season ${season.seasonNumber}`,
      description: `Season ${season.seasonNumber} of the show.`,
      audio_locale: 'ja-JP',
    }))
  },
  ...Object.fromEntries(seasons.map(season => [
    `${CMS}/seasons/${season.id}/episodes?preferred_audio_language=ja-JP&locale=en-US`,
    {
      data: Array.from({ length: season.episodes }, (_, index) => ({
        id: `${season.id}-EP${index + 1}`,
        title: `S${season.seasonNumber}E${index + 1}`,
        description: '',
        // within-season, exactly as Crunchyroll numbers it: this is why the union collides
        episode_number: index + 1,
        season_number: season.seasonNumber,
        season_id: season.id,
        series_id: id,
        sequence_number: index + 1,
        // the season walk reads the FIRST episode's air date as the season's premiere, which is what
        // the date axis compares against
        // WEEKLY from the season's premiere, not all on one day. A season is recognised as containing
        // a run by its SPAN, and a fixture where every episode shares a date has no span to read.
        episode_air_date: airDateOf(season, index),
      }))
    },
  ])),
})

// Every url getMedia can reach, answered from a table. An unlisted url throws rather than returning
// an empty payload, so a fixture that has drifted out of step with the source fails loudly instead of
// quietly producing the zero this file is trying to assert is a refusal.
const context = (routes: Record<string, unknown>) => ({
  fetch: async (url: string) => {
    if (url === 'https://www.crunchyroll.com/auth/v1/token') {
      return { json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }
    }
    if (!(url in routes)) throw new Error(`fixture has no route for ${url}`)
    return { json: async () => routes[url] }
  }
}) as never

// The same table, counting how many times each url is asked for, so a test can say what a request
// path COSTS and not only what it answers.
const counting = (routes: Record<string, unknown>) => {
  const calls = new Map<string, number>()
  const inner = context(routes) as { fetch: (url: string) => Promise<unknown> }
  const ctx = {
    fetch: async (url: string) => {
      calls.set(url, (calls.get(url) ?? 0) + 1)
      return inner.fetch(url)
    }
  } as never
  return { ctx, calls }
}

// The season walk is a module-level cache keyed by series id, so without this a test would read the
// walk the test before it made and a count of requests would be a count of test order.
beforeEach(() => resetCrunchyrollCaches())

// The real premiere dates, so the date axis has something honest to choose between. Season 2 and
// season 2 part 2 are the pair that matters: both are "season 2" by ordinal, 273 days apart.
const MUSHOKU = series('G24H1N3MP', [
  { id: 'GSSEASON1', seasonNumber: 1, episodes: 23, airDate: '2021-01-11T00:00:00Z' },
  { id: 'GSSEASON2', seasonNumber: 2, episodes: 24, airDate: '2023-07-09T00:00:00Z' },
  { id: 'GS00374452', seasonNumber: 3, episodes: 14, airDate: '2026-07-04T00:00:00Z' },
])

test('a show-level id answers with the metadata and NO episodes', async () => {
  const media = await getMedia('G24H1N3MP', context(MUSHOKU))

  expect(media?.uri).toBe('cr:G24H1N3MP')
  // 61 before the guard, and 24 distinct episode numbers once the resolver groups them
  expect(media?.episodes ?? []).toHaveLength(0)
})

// The control, and it is the half that matters: a source that answered nothing for every id would
// pass the assertion above unconditionally, so this proves the fixture can produce episodes at all.
test('the season-scoped id for the same series still answers with its own 14', async () => {
  const media = await getMedia('G24H1N3MP-GS00374452', context(MUSHOKU))

  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(media?.episodes ?? []).toHaveLength(14)
  expect([...new Set((media?.episodes ?? []).map(episode => episode.seasonNumber))]).toEqual([3])
})

/**
 * A season row carries ITS OWN premiere, which is the first air date in it.
 *
 * `normalizeMedia` publishes `series_launch_year` on the SHOW and deliberately nothing on a season,
 * because one season must not carry another's premiere. Nothing put the season's own date there
 * either, so every Crunchyroll season row reached the store with a NULL year, and `plugin:title`'s
 * gate 0 buckets candidates BY YEAR: a row with no year is never placed beside the run it belongs to.
 * The corpus triage names exactly this, beside the JustWatch title since fixed: "the nf and cr rows
 * that split publish no start date at all, so their profiles hold year NULL and gate 0's year bucket
 * never puts them beside the run".
 *
 * Mutation: drop the `media.startDate` fill and the season answers `undefined` here, while the show
 * below still answers its launch year, which is what makes this about the SEASON.
 */
test('a season row publishes its own premiere, and the show still publishes its launch year', async () => {
  const season = await getMedia('G24H1N3MP-GS00374452', context(MUSHOKU))
  // season 3's fixture premieres 2026-07-04 and runs weekly; the row takes the earliest, not the last
  expect(season?.startDate).toBe('2026-07-04T00:00:00.000Z')

  // the control: a show-level id has no season of its own to date and must NOT borrow one, since
  // that is the mistake the original comment is guarding against
  const show = await getMedia('G24H1N3MP', context(MUSHOKU))
  expect(show?.episodes ?? [], 'the show has no episodes to take a date from').toHaveLength(0)
  expect(show?.startDate, 'so it keeps whatever the series metadata said, here nothing').toBeUndefined()
})

// A one-season series has no seasons to be confused between, so its bare id is already exact and
// `targetSeason` falls back to that single season. The guard must not cost it its episodes.
test('a single-season series keeps its episodes when asked by the bare series id', async () => {
  const media = await getMedia('SOLO', context(series('SOLO', [{ id: 'GSONLY', seasonNumber: 1, episodes: 3 }])))

  expect(media?.uri).toBe('cr:SOLO-GSONLY')
  expect(media?.episodes ?? []).toHaveLength(3)
})

// `similarMedia` is how a source holding nothing but a SHOW link gets a run out of this source without
// minting a show-level handle. Driven through the real resolver rather than through `seasonForShow`,
// because the yield-once shape is part of the contract: a generator that ends without yielding makes
// yoga answer 204 and the caller waits out its timeout instead of reading the refusal.
type Ask = { showId: string, startDate?: string, titles?: string[], episodeCount?: number, episodeTitles?: string[] }

const askSeason = async (input: Ask, routes: Record<string, unknown>, ctx: unknown = context(routes)) => {
  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return value?.similarMedia ?? null
}

test('a show plus a date resolves to that one run', async () => {
  const media = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU)

  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(media?.episodes ?? []).toHaveLength(14)
})

// The pair an ordinal cannot separate. Both of these are "season 2" of this show, so a caller passing
// seasonNumber 2 would have no way to say which it meant; 273 days says it unambiguously.
test('the date, not the ordinal, is what picks between two runs sharing a season number', async () => {
  const cour1 = await askSeason({ showId: 'G24H1N3MP', startDate: '2023-07-09T00:00:00Z' }, MUSHOKU)
  const cour3 = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU)

  expect(cour1?.uri).toBe('cr:G24H1N3MP-GSSEASON2')
  expect(cour3?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(cour1?.uri).not.toBe(cour3?.uri)
})

test('an unparseable date with nothing else is a refusal, never a nearest-of-anything', async () => {
  expect(await askSeason({ showId: 'G24H1N3MP', startDate: 'not a date' }, MUSHOKU)).toBeNull()
})

// Crunchyroll answers an unknown or seasonless series with an empty `data`, which is a refusal here
// and not an error. A source that THROWS instead is also a refusal, but one handled a layer up:
// `firstSimilarMedia` in worker/extractor.ts settles undefined on `result.error`.
test('a show with no seasons is a refusal', async () => {
  const routes = { ...MUSHOKU, ...series('SEASONLESS', []) }

  expect(await askSeason({ showId: 'SEASONLESS', startDate: '2026-07-04T00:00:00Z' }, routes)).toBeNull()
})

// The window, which this source did NOT apply until 2026-08-31: `matchSeasonByDate` returned the
// nearest season at any distance, so a date from a different year still came back with a season.
// 2019 is nearest to season 1 (2021) and 731 days away, which is not a rounding difference.
test('a date outside the window is a refusal, not the nearest season anyway', async () => {
  expect(await askSeason({ showId: 'G24H1N3MP', startDate: '2019-04-06T00:00:00Z' }, MUSHOKU)).toBeNull()
})

// The control for the test above. Without it, a source that refused everything would pass that
// assertion and this file would be pinning nothing.
test('a date inside the window still resolves, so the refusal above is the window and not a wall', async () => {
  const media = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-20T00:00:00Z' }, MUSHOKU)

  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

// A day-precise date that nothing else contradicts is still not enough when TWO seasons sit inside
// its window: two parts released together are two runs, and the date cannot say which is ours.
test('two seasons inside one window is an ambiguity, and a refusal', async () => {
  const routes = series('GPAIR', [
    { id: 'GP1', seasonNumber: 1, episodes: 12, airDate: '2024-04-05T00:00:00Z' },
    { id: 'GP2', seasonNumber: 2, episodes: 12, airDate: '2024-04-15T00:00:00Z' },
  ])

  expect(await askSeason({ showId: 'GPAIR', startDate: '2024-04-08T00:00:00Z' }, routes)).toBeNull()
})

// Season 3 and a season 4 in the same year, so a year alone cannot tell them apart and the later
// rules have to do the work the date rule cannot.
const TWO_IN_2026 = series('GTWO2026', [
  { id: 'GT1', seasonNumber: 1, episodes: 23, airDate: '2021-01-11T00:00:00Z' },
  { id: 'GT2', seasonNumber: 2, episodes: 24, airDate: '2023-07-09T00:00:00Z' },
  { id: 'GT3', seasonNumber: 3, episodes: 14, airDate: '2026-07-04T00:00:00Z' },
  { id: 'GT4', seasonNumber: 4, episodes: 12, airDate: '2026-10-05T00:00:00Z' },
])

// Seven extractors template a bare year as `YYYY-01-01` and two more answer `YYYY-MM-01` when only
// the month is known. Against a 45 day window that is a year pretending to be a day, so the window
// never sees it: `2026-07-01` is three days from season 3's premiere and is NOT matched as a date.
// What a year-only date can still do is name the one season dated that year when our count shows that
// season is not a fold, and no more: no count, or two seasons in the year, is a refusal, whatever the
// distance to either.
test('a year-only date never reaches the window: it names the one season of its year, or nothing', async () => {
  const one = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-01-01T00:00:00Z', episodeCount: 14 }, MUSHOKU)
  expect(one?.uri, '2026 holds season 3 alone, so the year names it').toBe('cr:G24H1N3MP-GS00374452')
  expect(await askSeason({ showId: 'G24H1N3MP', startDate: '2026-01-01T00:00:00Z' }, MUSHOKU), 'a year with no count checks nothing').toBeNull()

  expect(await askSeason({ showId: 'GTWO2026', startDate: '2026-01-01T00:00:00Z', episodeCount: 14 }, TWO_IN_2026)).toBeNull()
  expect(
    await askSeason({ showId: 'GTWO2026', startDate: '2026-07-01T00:00:00Z', episodeCount: 14 }, TWO_IN_2026),
    'three days from a premiere, and still not a date: a first-of-month names a month'
  ).toBeNull()
})

// An announced season, or one this region cannot list, answers an EMPTY episodes payload. Offered as a
// season of 0 episodes it fit under every run's count, and two runs two years apart both took it
// (2026-09-05). A season with nothing listed has no length, and a lone season with no length is not
// a season still listing: it is nothing to match.
test('a season with no episodes listed is never the answer', async () => {
  const routes = series('GEMPTY', [{ id: 'GE1', seasonNumber: 1, episodes: 0 }])

  expect(await askSeason({ showId: 'GEMPTY', titles: ['Show'], episodeCount: 12, startDate: '2024-04-07T00:00:00Z' }, routes)).toBeNull()
  expect(await askSeason({ showId: 'GEMPTY', titles: ['Another Run Of It'], episodeCount: 24, startDate: '2022-10-02T00:00:00Z' }, routes)).toBeNull()

  const listed = series('GLISTED', [{ id: 'GL1', seasonNumber: 1, episodes: 5 }])
  expect(
    (await askSeason({ showId: 'GLISTED', titles: ['Show'], episodeCount: 12 }, listed))?.uri,
    'the control: a lone season with SOME episodes is a season still listing'
  ).toBe('cr:GLISTED-GL1')
})

// The ordinal, read off the caller's titles, matched against the season_number Crunchyroll stamps on
// every episode, and admitted only with a count the season does not exceed.
test('a year-only date falls back to the ordinal and count', async () => {
  const input = { startDate: '2026-01-01T00:00:00Z', titles: ['Mushoku Tensei Season 3'], episodeCount: 14 }

  expect((await askSeason({ showId: 'G24H1N3MP', ...input }, MUSHOKU))?.uri).toBe('cr:G24H1N3MP-GS00374452')
  // the year holds two seasons here, so only the ordinal can have picked
  expect((await askSeason({ showId: 'GTWO2026', ...input }, TWO_IN_2026))?.uri).toBe('cr:GTWO2026-GT3')
})

// Netflix's season 2 of this show is 25 episodes over anime's 13 and 12; here Crunchyroll's season 2
// holds 24 against a caller's 12. A season holding MORE episodes than the run holds other runs too,
// and the year (2023, season 2 alone) would otherwise have named it.
test('a fold is refused', async () => {
  expect(await askSeason(
    { showId: 'G24H1N3MP', startDate: '2023-01-01T00:00:00Z', titles: ['Mushoku Tensei Season 2'], episodeCount: 12 },
    MUSHOKU
  )).toBeNull()
})

test('titles that disagree about the season refuse outright', async () => {
  expect(await askSeason(
    { showId: 'G24H1N3MP', titles: ['Mushoku Tensei Season 2', 'Mushoku Tensei Part 3'], episodeCount: 24 },
    MUSHOKU
  )).toBeNull()
})

// The coincidence that welded season 1 to Netflix's season 3 on the live site: an 11 episode run and
// an 11 episode third season. Only the FIRST season is ever tried on a count with no ordinal, and
// with several seasons only an exact count is accepted.
test('a count with no ordinal is tried against the first season only', async () => {
  const first = await askSeason({ showId: 'G24H1N3MP', titles: ['Mushoku Tensei'], episodeCount: 23 }, MUSHOKU)
  expect(first?.uri).toBe('cr:G24H1N3MP-GSSEASON1')

  expect(
    await askSeason({ showId: 'G24H1N3MP', titles: ['Mushoku Tensei'], episodeCount: 14 }, MUSHOKU),
    'season 3 holds exactly 14, and it is never reached by count'
  ).toBeNull()
})

const season3Titles = Array.from({ length: 14 }, (_, index) => `S3E${index + 1}`)

// The count alone refuses this run (23 !== 14 on the first season), and the titles carry no ordinal.
// Fourteen episode titles that are season 3's are what establish it.
test('episode titles pick the season when nothing else does', async () => {
  expect(await askSeason({ showId: 'G24H1N3MP', episodeCount: 14 }, MUSHOKU), 'the control').toBeNull()

  const media = await askSeason({ showId: 'G24H1N3MP', episodeCount: 14, episodeTitles: season3Titles }, MUSHOKU)
  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

// Decisive the other way too: three real episode titles that no season carries say this is not any
// of these seasons, whatever the ordinal says.
test('episode titles sharing none with any season refuse a season the ordinal would have taken', async () => {
  expect(await askSeason(
    { showId: 'G24H1N3MP', titles: ['Mushoku Tensei Season 3'], episodeCount: 14, episodeTitles: ['Alpha', 'Beta', 'Gamma'] },
    MUSHOKU
  )).toBeNull()
})

// The contract on the answer: a RUN at this origin carrying no handle naming another run. The CALLER
// decides what to claim about it; a handle here would claim on its behalf.
test('the answer is a RUN with no handles', async () => {
  const media = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU)

  expect(media?.scope).toBe('RUN')
  expect(media?.handles).toEqual([])
})

test('similarMedia yields exactly once, on an answer and on a refusal', async () => {
  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  for (const input of [{ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, { showId: 'G24H1N3MP' }]) {
    const iterator = subscribe(undefined, { input }, context(MUSHOKU))
    expect((await iterator.next()).done).toBe(false)
    expect((await iterator.next()).done).toBe(true)
  }
})

// SCOPE. A media in this store is one run, and a bare Crunchyroll series id is the same for every
// season, so it names the show and not any run. Handed to the store as a RUN it entered a run's
// SAME_AS cluster and welded seasons together (Mushoku Tensei season 1 to season 3 on the live site,
// through exactly cr:G24H1N3MP). The source stamps CONTAINER on it from its own grammar: no season
// segment, no run.
test('a show-level id is scoped CONTAINER', async () => {
  const media = await getMedia('G24H1N3MP', context(MUSHOKU))

  expect(media?.uri).toBe('cr:G24H1N3MP')
  expect(media?.scope).toBe('CONTAINER')
})

// The controls. A stamp that said CONTAINER on everything would pass the test above and take every
// run out of its own identity space, so both run shapes have to read RUN: the season-scoped id, and
// the single-season series asked by its bare id, which resolves to its one season and so is a run.
test('a season-scoped id is scoped RUN', async () => {
  const media = await getMedia('G24H1N3MP-GS00374452', context(MUSHOKU))

  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(media?.scope).toBe('RUN')
})

test('a single-season series asked by its bare id resolves to its one run and is scoped RUN', async () => {
  const media = await getMedia('SOLO', context(series('SOLO', [{ id: 'GSONLY', seasonNumber: 1, episodes: 3 }])))

  expect(media?.uri).toBe('cr:SOLO-GSONLY')
  expect(media?.scope).toBe('RUN')
})

const SEARCH = (query: string, items: { id: string, title: string }[]) => ({
  [`https://www.crunchyroll.com/content/v2/discover/search?q=${encodeURIComponent(query)}&n=50&type=series&locale=en-US`]: {
    data: [{
      type: 'series',
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        slug_title: item.title.toLowerCase().replace(/\s+/g, '-'),
        description: 'A show.',
        images: {},
        series_metadata: { episode_count: 61, series_launch_year: 2021 }
      }))
    }]
  }
})

// Search answers series, and a series row is minted under the bare id, so every search hit is a
// container. This is the other site that mints bare ids, and the one whose rows reach the store's
// fuzzy merge first.
test('search rows are minted under the bare series id and scoped CONTAINER', async () => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const routes = SEARCH('mushoku', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }, { id: 'GRDV0019R', title: 'Jujutsu Kaisen' }])
  const { value } = await subscribe(undefined, { input: { search: 'mushoku' } }, context(routes)).next()
  const nodes = value.mediaPage.nodes as { uri: string, scope?: string | null }[]

  expect(nodes.map(node => node.uri)).toEqual(['cr:G24H1N3MP', 'cr:GRDV0019R'])
  expect(nodes.map(node => node.scope)).toEqual(['CONTAINER', 'CONTAINER'])
})

// The search-and-link path always resolves a season-scoped id, so the media it returns is a run, and
// the handles it builds from the aggregated uri are bare SAME_AS claims carrying no container scope:
// a SAME_AS between two RUN rows is what unions the cluster, once the store has both rows.
test('the handles built on the search path carry the run scope of the media they attach to', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const known = { titles: [{ language: 'en', title: 'Mushoku Tensei', score: 1 }], startDate: '2026-07-04T00:00:00Z' }
  const ctx = Object.assign(
    context({ ...MUSHOKU, ...SEARCH('Mushoku Tensei', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }]) }),
    { findAggregatedMedia: async () => known, listenForMediaChanges: async function* () {} }
  )
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:108465,kitsu:42323)' } }, ctx).next()
  const media = value.media

  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(media?.scope).toBe('RUN')
  expect(media?.handles.map((handle: { node: { uri: string }, relation: string }) => [handle.node.uri, handle.relation]))
    .toEqual([['anilist:108465', 'SAME_AS'], ['kitsu:42323', 'SAME_AS']])
  expect(media?.handles.map((handle: { node: { scope?: string | null } }) => handle.node.scope)).toEqual(['RUN', 'RUN'])
})

// COST. The walk is every japanese-audio season of a series at one episodes request each, and it used
// to run once per ask: two pages of one show walked it twice, and the consumer's re-asks on new
// evidence would multiply that. One walk per series per session, reused inside a TTL.
const SEASON1_EPISODES = `${CMS}/seasons/GSSEASON1/episodes?preferred_audio_language=ja-JP&locale=en-US`

// GSSEASON1 is a season neither ask below wins, so only the walk ever reads it: its count is the walk's.
test('two asks about one show walk its seasons once', async () => {
  const { ctx, calls } = counting(MUSHOKU)

  const cour3 = await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU, ctx)
  const cour1 = await askSeason({ showId: 'G24H1N3MP', startDate: '2023-07-09T00:00:00Z' }, MUSHOKU, ctx)

  expect(cour3?.uri).toBe('cr:G24H1N3MP-GS00374452')
  expect(cour1?.uri, 'the control: the cache still answers each ask its own season').toBe('cr:G24H1N3MP-GSSEASON2')
  expect(calls.get(SEASON1_EPISODES)).toBe(1)
})

// A different series is a different walk: the cache is per show, never per module.
test('a different show still walks its own seasons', async () => {
  const { ctx, calls } = counting({ ...MUSHOKU, ...TWO_IN_2026 })

  await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU, ctx)
  const other = await askSeason({ showId: 'GTWO2026', startDate: '2026-10-05T00:00:00Z' }, TWO_IN_2026, ctx)

  expect(other?.uri).toBe('cr:GTWO2026-GT4')
  expect(calls.get(SEASON1_EPISODES)).toBe(1)
  expect(calls.get(`${CMS}/seasons/GT1/episodes?preferred_audio_language=ja-JP&locale=en-US`)).toBe(1)
})

test('the walk is reused for ten minutes and not longer', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const start = Date.parse('2026-09-05T00:00:00Z')
    vi.setSystemTime(new Date(start))
    const { ctx, calls } = counting(MUSHOKU)
    const ask = () => askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU, ctx)

    await ask()
    vi.setSystemTime(new Date(start + 9 * 60 * 1000))
    await ask()
    expect(calls.get(SEASON1_EPISODES), 'nine minutes in, the walk is still the first one').toBe(1)

    vi.setSystemTime(new Date(start + 11 * 60 * 1000))
    await ask()
    expect(calls.get(SEASON1_EPISODES), 'eleven minutes in, the walk is made again').toBe(2)
  } finally {
    vi.useRealTimers()
  }
})

// A walk that threw is not an answer about the show, so it must not be served to the next ask; and a
// request that fails must fail the caller once, never as a second, unhandled rejection beside it.
test('a failed walk is not remembered', async () => {
  const ask = { showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }
  await expect(askSeason(ask, {}, context({}))).rejects.toThrow('fixture has no route')

  const media = await askSeason(ask, MUSHOKU)
  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

// OBSERVABILITY. The rule is not on the wire (the answer is a store row, and a rule is not a fact about
// the row), so the answering side says which rule picked, and a live log reads ask, rule, answer, claim.
test('a pick says which rule picked it', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await askSeason({ showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }, MUSHOKU)
    const lines = () => warn.mock.calls.map(call => String(call[0])).filter(text => text.startsWith('similarMedia:'))
    expect(lines()).toEqual(['similarMedia: cr picked GS00374452 by date for G24H1N3MP'])

    expect(await askSeason({ showId: 'G24H1N3MP' }, MUSHOKU)).toBeNull()
    expect(lines(), 'a refusal picks nothing and says nothing').toHaveLength(1)
  } finally {
    warn.mockRestore()
  }
})

// Crunchyroll's rate limit is a JSON body with no `data` (`{ __class__: 'error', code: 'rate_limited' }`).
// Read as an empty list it was an answer: a walk over three such bodies described three seasons of zero
// episodes, refused, and was served to every ask for ten minutes while upstream had long recovered
// (2026-09-05). An error body is an error, so the walk rejects and the cache forgets it.
const RATE_LIMITED = { __class__: 'error', code: 'rate_limited' }
const degradedOnce = (routes: Record<string, unknown>, urls: string[]) => {
  const pending = new Set(urls)
  const inner = context(routes) as { fetch: (url: string) => Promise<unknown> }
  return {
    fetch: async (url: string) => pending.delete(url) ? { status: 429, json: async () => RATE_LIMITED } : inner.fetch(url)
  } as never
}
const EPISODES_URLS = ['GSSEASON1', 'GSSEASON2', 'GS00374452'].map(id => `${CMS}/seasons/${id}/episodes?preferred_audio_language=ja-JP&locale=en-US`)
const SEASONS_URL = `${CMS}/series/G24H1N3MP/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`

test('a rate limited walk is an error, not an answer the cache keeps', async () => {
  const ask = { showId: 'G24H1N3MP', startDate: '2026-07-04T00:00:00Z' }

  const episodes = degradedOnce(MUSHOKU, EPISODES_URLS)
  await expect(askSeason(ask, MUSHOKU, episodes), 'three seasons of zero episodes is not a refusal').rejects.toThrow(/answered .* with no data/)
  expect((await askSeason(ask, MUSHOKU, episodes))?.uri, 'upstream healthy again, inside the TTL: the walk is made again').toBe('cr:G24H1N3MP-GS00374452')

  resetCrunchyrollCaches()
  const seasons = degradedOnce(MUSHOKU, [SEASONS_URL])
  await expect(askSeason(ask, MUSHOKU, seasons), 'no seasons at all is not a refusal either').rejects.toThrow(/answered .* with no data/)
  expect((await askSeason(ask, MUSHOKU, seasons))?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

// Crunchyroll's API hands image urls on www.crunchyroll.com/imgsrv/display/<kind>/<WxH>/<key>, and that
// host answers a geo-blocked location with a 301 to its "currently unavailable" page, which a browser
// refuses to embed as an image: measured from Japan 2026-09-05, every episode thumbnail of a season
// blank while the same keys on imgsrv.crunchyroll.com behind Cloudflare's resizer answered 200.
test('an image url on the geo-gated site is served from the CDN host instead', async () => {
  const routes = series('IMG', [{ id: 'GSIMG', seasonNumber: 1, episodes: 1 }]) as any
  routes[`${CMS}/seasons/GSIMG/episodes?preferred_audio_language=ja-JP&locale=en-US`].data[0].images = {
    thumbnail: [[{ source: 'https://www.crunchyroll.com/imgsrv/display/thumbnail/1920x1080/catalog/crunchyroll/38d60ec2b92fa401a1f04ab9b84caa6f.png' }]]
  }
  const media = await getMedia('IMG-GSIMG', context(routes))
  expect(media?.episodes?.[0]?.thumbnails?.[0]?.url)
    .toBe('https://imgsrv.crunchyroll.com/cdn-cgi/image/fit=contain,format=auto,quality=85,width=1920/catalog/crunchyroll/38d60ec2b92fa401a1f04ab9b84caa6f.png')
  expect(cdnImageUrl('https://imgsrv.crunchyroll.com/cdn-cgi/image/fit=contain,format=auto,quality=85,width=1920/catalog/crunchyroll/x.png'), 'already the CDN form')
    .toBe('https://imgsrv.crunchyroll.com/cdn-cgi/image/fit=contain,format=auto,quality=85,width=1920/catalog/crunchyroll/x.png')
  expect(cdnImageUrl('https://s4.anilist.co/file/x.jpg'), 'another host is left alone').toBe('https://s4.anilist.co/file/x.jpg')
})

/**
 * THE FOLD, and why title and date cannot see it.
 *
 * Crunchyroll models Mushoku Tensei season 1 as ONE season of 23, where AniList and MAL split the same
 * broadcast into 11 and 12. Its premiere is season 1 part 1's premiere, so the date axis matches to
 * the day and the title axis matches by construction: part 1 came back holding a season that is part 1
 * plus part 2 plus the Eris special, and the modal listed 24 rows for an 11 episode run.
 *
 * Measured on the live site 2026-09-09, reached by opening season 3 and clicking the prequel relation
 * four times: hop 2 and hop 4 each landed on a part 1 showing 24, and each had gained a `cr:` season
 * handle the direct address did not have. Rows 12 to 23 were part 2's episodes by title and row 24 was
 * the special.
 *
 * A count is the only axis that separates them, and `foldVetoed` is the rule the rest of this tree
 * already uses for it.
 */
test('a season holding more episodes than the run does not become the run', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  // part 1 as AniList and MAL describe it: 11 episodes, premiering the day before CR's season 1
  const known = {
    titles: [{ language: 'en', title: 'Mushoku Tensei', score: 1 }],
    startDate: '2021-01-10T00:00:00Z',
    episodeCount: 11,
  }
  const ctx = Object.assign(
    context({ ...MUSHOKU, ...SEARCH('Mushoku Tensei', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }]) }),
    { findAggregatedMedia: async () => known, listenForMediaChanges: async function* () {} }
  )
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:108465,kitsu:42323)' } }, ctx).next()
  const media = value.media

  // it is not this run, and says so by claiming nothing: a SAME_AS here would union part 1 with its
  // own part 2 through a shared uri, which is what the fold veto exists to prevent
  expect(media?.handles ?? [], 'a containing season claims no identity').toEqual([])

  // but it LENDS what it has. The episodes are re-pointed at the asking cluster so the run's own walk
  // can reach them, and they keep Crunchyroll's numbering: store/consensus.ts aligns and windows them
  // at read time, because the node is shared with everything else that reads that season.
  expect(media?.uri).toBe('cr:G24H1N3MP-GSSEASON1')
  expect(new Set((media?.episodes ?? []).map((episode: { mediaUri: string }) => episode.mediaUri)))
    .toEqual(new Set(['anilist:108465']))
  expect((media?.episodes ?? []).map((episode: { episodeNumber?: number }) => episode.episodeNumber).slice(0, 3))
    .toEqual([1, 2, 3])
})

/**
 * THE CONTROL, and it is the whole point of the rule being a count rather than a refusal.
 *
 * The same show, the same search, the same date axis. A run whose own count matches the season still
 * links, so the veto is separating folded seasons rather than switching Crunchyroll off for anything
 * with a number attached.
 */
test('and a season the size of the run still links', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  // season 3 as its metadata describes it: 14 episodes, premiering the day CR says
  const known = {
    titles: [{ language: 'en', title: 'Mushoku Tensei', score: 1 }],
    startDate: '2026-07-04T00:00:00Z',
    episodeCount: 14,
  }
  const ctx = Object.assign(
    context({ ...MUSHOKU, ...SEARCH('Mushoku Tensei', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }]) }),
    { findAggregatedMedia: async () => known, listenForMediaChanges: async function* () {} }
  )
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:178789,kitsu:49002)' } }, ctx).next()

  expect(value.media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

// and a run that says nothing about its length is unchanged: the veto reads a count it was given, and
// refusing on silence would take Crunchyroll off every cluster whose sources never published one
test('a run with no count of its own still links, as it always did', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const known = { titles: [{ language: 'en', title: 'Mushoku Tensei', score: 1 }], startDate: '2026-07-04T00:00:00Z' }
  const ctx = Object.assign(
    context({ ...MUSHOKU, ...SEARCH('Mushoku Tensei', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }]) }),
    { findAggregatedMedia: async () => known, listenForMediaChanges: async function* () {} }
  )
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:178789)' } }, ctx).next()

  expect(value.media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

/**
 * THE SEARCH PATH INHERITS THE PICKER'S GUARDS, which it had none of until 2026-09-09.
 *
 * It compared premiere dates itself and took the nearest, where `pickSimilarSeason` refuses an
 * ambiguity, ignores a start date that names only a year, and vetoes a fold. A wrong claim here is
 * not a bad row: `buildHandlesFromUri` mints SAME_AS against every member of the cluster, and
 * `graph.link` is a union-find with no inverse, so it unions two runs for the session.
 *
 * The class is measured rather than imagined. Against the manami database joined to real AniList
 * dates, 82 pairs of RELATED entries premiere within 45 days of each other and clear this file's own
 * 0.9 title gate on both sides, 37 of them with a TV side: Rent-a-Girlfriend season 2 and its Petit
 * shorts are three days apart and score 1.0000. What kept those apart was whether Crunchyroll
 * published the companion as its own season, which is upstream data and not a rule.
 */
const searchFor = async (known: Record<string, unknown>, routes: Record<string, unknown>, uri = 'ag:(anilist:1,kitsu:2)') => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const ctx = Object.assign(
    context(routes),
    { findAggregatedMedia: async () => known, listenForMediaChanges: async function* () {} }
  )
  const { value } = await subscribe(undefined, { input: { uri } }, ctx).next()
  return value.media
}

const NAMED = [{ language: 'en', title: 'Mushoku Tensei', score: 1 }]

test('the search path refuses two seasons inside one window, which is two parts released together', async () => {
  const pair = series('GPAIRSEARCH', [
    { id: 'GPS1', seasonNumber: 1, episodes: 12, airDate: '2024-04-05T00:00:00Z' },
    { id: 'GPS2', seasonNumber: 2, episodes: 12, airDate: '2024-04-15T00:00:00Z' },
  ])
  const media = await searchFor(
    { titles: NAMED, startDate: '2024-04-08T00:00:00Z', episodeCount: 12 },
    { ...pair, ...SEARCH('Mushoku Tensei', [{ id: 'GPAIRSEARCH', title: 'Mushoku Tensei' }]) },
  )
  expect(media, 'the date cannot say which of the two is ours, so neither is claimed').toBeNull()
})

/**
 * A start date naming only a YEAR does not reach the date rule, so it cannot pick a season on
 * proximity. Seven extractors template `YYYY-01-01` when they know only the year, and against a 45
 * day window that is a year pretending to be a day.
 *
 * It is not thrown away either: the later rules still read the year, which is why this fixture needs
 * TWO seasons in 2026 to show the refusal. With one, rule 4 would identify it correctly and should.
 */
test('and a start date naming only a year cannot pick between two seasons in it', async () => {
  const media = await searchFor(
    { titles: NAMED, startDate: '2026-01-01T00:00:00Z', episodeCount: 14 },
    { ...TWO_IN_2026, ...SEARCH('Mushoku Tensei', [{ id: 'GTWO2026', title: 'Mushoku Tensei' }]) },
  )
  expect(media, 'two seasons dated 2026 and a date that names no day: nothing to choose on').toBeNull()
})

// the control for both: the same path, a day-precise date and one season inside the window, still links
test('while a day-precise date with one season in range still links', async () => {
  const media = await searchFor(
    { titles: NAMED, startDate: '2026-07-04T00:00:00Z', episodeCount: 14 },
    { ...MUSHOKU, ...SEARCH('Mushoku Tensei', [{ id: 'G24H1N3MP', title: 'Mushoku Tensei' }]) },
  )
  expect(media?.uri).toBe('cr:G24H1N3MP-GS00374452')
})

/**
 * AND IT CAN NOW MATCH WHERE A DATE COMPARISON HAD NO ANSWER.
 *
 * A run whose only date names a year used to be unmatchable on this path: the window was the single
 * rule, and 2026-01-01 is 185 days from a July premiere. The ordinal in its own title settles it,
 * which is a rule the picker has and this path did not.
 */
test('an ordinal in the title picks a season the date alone could not', async () => {
  const media = await searchFor(
    {
      titles: [{ language: 'en', title: 'Mushoku Tensei Season 3', score: 1 }],
      startDate: '2026-01-01T00:00:00Z',
      episodeCount: 14,
    },
    { ...TWO_IN_2026, ...SEARCH('Mushoku Tensei Season 3', [{ id: 'GTWO2026', title: 'Mushoku Tensei' }]) },
  )
  expect(media?.uri).toBe('cr:GTWO2026-GT3')
})

/**
 * THE PART TWO, which never came near a Crunchyroll season before.
 *
 * Mushoku Tensei season 2 part 2 starts 2024-04-07. Crunchyroll's season 2 premiered 2023-07-09 with
 * part ONE, 273 days earlier, so no premiere is within any window of it and every date rule is
 * silent. What IS true is that its broadcast SPANS this run: part 2 aired inside it.
 */
const SPANNING = series('GSPAN', [
  // one crunchyroll season, two cours: twelve from July 2023 and twelve more from April 2024
  { id: 'GSP1', seasonNumber: 1, episodes: 24, airDate: '2023-07-09T00:00:00Z', resume: { after: 12, at: '2024-04-07T00:00:00Z' } },
])

test('a run inside a season it never matched still gets that season\'s episodes', async () => {
  const media = await searchFor(
    { titles: NAMED, startDate: '2024-04-07T00:00:00Z', episodeCount: 12 },
    { ...SPANNING, ...SEARCH('Mushoku Tensei', [{ id: 'GSPAN', title: 'Mushoku Tensei' }]) },
    'ag:(anilist:166873,kitsu:47694)',
  )
  expect(media?.uri, 'the season that contains it').toBe('cr:GSPAN-GSP1')
  expect(media?.handles ?? [], 'and still claims nothing').toEqual([])
  expect(new Set((media?.episodes ?? []).map((e: { mediaUri: string }) => e.mediaUri)))
    .toEqual(new Set(['anilist:166873']))
})

// the span has to actually contain the run: a season that ended before it started lends nothing
test('and a season whose broadcast ended before the run started lends nothing', async () => {
  const media = await searchFor(
    { titles: NAMED, startDate: '2026-01-01T00:00:00Z', episodeCount: 12 },
    { ...SPANNING, ...SEARCH('Mushoku Tensei', [{ id: 'GSPAN', title: 'Mushoku Tensei' }]) },
    'ag:(anilist:1,kitsu:2)',
  )
  expect(media).toBeNull()
})

/**
 * TWO seasons containing the run is not an answer either. A catalogue that splits a show differently
 * again gives nothing to choose between, and choosing anyway is how the wrong episodes arrive.
 */
test('two seasons containing the run is a refusal', async () => {
  // both split the same way, so both really do span 2024-04-07: the refusal has to come from there
  // being two of them, not from neither containing the run
  const overlapping = series('GOVER', [
    { id: 'GO1', seasonNumber: 1, episodes: 24, airDate: '2023-07-09T00:00:00Z', resume: { after: 12, at: '2024-04-07T00:00:00Z' } },
    { id: 'GO2', seasonNumber: 2, episodes: 26, airDate: '2023-07-16T00:00:00Z', resume: { after: 13, at: '2024-04-14T00:00:00Z' } },
  ])
  const media = await searchFor(
    { titles: NAMED, startDate: '2024-04-07T00:00:00Z', episodeCount: 12 },
    { ...overlapping, ...SEARCH('Mushoku Tensei', [{ id: 'GOVER', title: 'Mushoku Tensei' }]) },
    'ag:(anilist:166873,kitsu:47694)',
  )
  expect(media).toBeNull()
})
