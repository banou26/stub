/**
 * `plugin:profile`, rule by rule, through the graph rather than through the functions.
 *
 * Every case ingests answers, runs the pass and READS THE ROW BACK, because half of what can go wrong
 * here is not the derivation but the column it lands in: a JSON array, an INT64 day, a BOOLEAN that
 * is only sometimes false and a `STRING[]` that reads back NULL when it is empty. A test against the
 * pure function would pass with every one of those broken.
 *
 * Each case carries its own control, since most of these rules are about what NOT to derive.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { countReadingOf, formatOf, profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { COERCING_ORIGINS } from '../../../../../src/worker/graph/plugins/origins'
import { answer, episode, media, partOf, rowsOf, sameAs, title } from './fixtures'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const runProfile = () => runPlugins([profilePlugin], { reason: 'manual' })

const profileOf = async (uri: string) =>
  (await rowsOf(
    `MATCH (n:MediaProfile {uri: $uri})
     RETURN n.uri AS uri, n.by AS by, n.version AS version, n.scope AS scope, n.scopeFrom AS scopeFrom,
       n.dateSubject AS dateSubject, n.titleKeys AS titleKeys, n.titleKeysFolded AS titleKeysFolded,
       n.seasonOrdinal AS seasonOrdinal, n.partOrdinal AS partOrdinal, n.ordinalFrom AS ordinalFrom,
       n.year AS year, n.startDay AS startDay, n.datePrecision AS datePrecision, n.dateDerivation AS dateDerivation,
       n.format AS format, n.workKind AS workKind, n.companion AS companion,
       n.countKind AS countKind, n.countStated AS countStated, n.countDistinct AS countDistinct,
       n.folding AS folding, n.retranslates AS retranslates, n.showLevelOrigin AS showLevelOrigin,
       n.idParent AS idParent`,
    { uri }
  ))[0]

const episodeProfileOf = async (uri: string) =>
  (await rowsOf(
    `MATCH (n:EpisodeProfile {uri: $uri})
     RETURN n.uri AS uri, n.day AS day, n.dayPrecision AS dayPrecision, n.numberSpace AS numberSpace,
       n.titleKeys AS titleKeys, n.synopsisKeys AS synopsisKeys, n.generic AS generic`,
    { uri }
  ))[0]

const keysOf = async (uri: string): Promise<string[]> => {
  const profile = await profileOf(uri)
  return (JSON.parse((profile?.titleKeys as string) ?? '[]') as { key: string }[]).map(entry => entry.key)
}

const day = (date: string) => Math.floor(Date.parse(date) / 86_400_000)

/** One real `contextualSynopsis`, Netflix season 3 episode 1 of Mushoku Tensei (recorded 2026-09-13). */
const NETFLIX_SYNOPSIS =
  'Leaving Rudeus, Eris goes with Ghislaine to the Holy Land of Swords. '
  + 'There, Eris trains under Sword God Gal Farion alongside fellow Sword Saint Nina.'

/** Netflix season 3 episode 2, written to `descriptions` alone, and episode 5, to the short field alone. */
const LONG_ONLY =
  'A skeptical Nina investigates after hearing Eris talk about Rudeus. '
  + 'Later, Water God Reida and her disciple Isolde arrive at the training grounds.'
const SHORT_ONLY =
  'Rudeus brings Roxy into his happy home. She begins teaching at the Ranoa University of Magic.'

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    // the ratchet: one answer said CONTAINER, a later one said RUN
    await answer('media', media('jw:tm1', { scope: 'CONTAINER', titles: [title('en', 'Frieren')] })),
    await answer('media', media('jw:tm1', { scope: 'RUN', titles: [title('en', 'Frieren')], startDate: '2023-09-29' })),
    // a show-level origin, and the two that are NOT show level however container-ish they look
    await answer('media', media('imdb:tt1', { titles: [title('en', 'Frieren')] })),
    await answer('media', media('omdb:tt1', { titles: [title('en', 'Frieren')], type: 'MOVIE', categories: ['MOVIE'] })),
    // a container reached through PART_OF: the claim stamps it, and the claimer is a source
    await answer('media', media('anilist:1', {
      titles: [title('en', 'Mushoku Tensei Season 2 Part 3'), title('ja', '無職転生 第2期')],
      handles: [partOf(media('cr:GX1'))],
      startDate: '2021-01-01',
      type: 'TV',
      categories: ['SERIES'],
      episodeCount: 12,
    })),
    // the seed control: `offline` SAME_AS is provenance `seed`, which never stamps a scope
    await answer('media', media('offline:mal-59193', { handles: [sameAs(media('anidb:9', { scope: 'CONTAINER' }))] })),
    // a crunchyroll season with a list of its own, under a parent that exists
    await answer('media', media('cr:GX1-GS1', {
      titles: [title('en', 'Frieren Specials')],
      episodeCount: 2,
      episodes: [
        episode('cr:GX1-GS1-1', 'cr:GX1-GS1', { episodeNumber: 1, releaseDate: '2023-09-29', titles: [title('en', 'The Journey\'s End')] }),
        episode('cr:GX1-GS1-2', 'cr:GX1-GS1', { episodeNumber: 2, releaseDate: '2023-10-06T15:00:00.000Z', titles: [title('en', 'Episode 2')] }),
      ],
    })),
    // a declared count, no list at all
    await answer('media', media('mal:1', { titles: [title('en', 'Frieren'), title('ja', 'Sôsô no Frieren')], episodeCount: 28, type: 'TV_SHORT' })),
    // the title rules: a synonym field, a CJK title, a numeric title and a season label
    await answer('media', media('kitsu:1', {
      titles: [title('ja', '転生したらスライムだった件'), title('en', '2026'), title('en', 'Season 3')],
      synonyms: ['minna no uta'],
    })),
    // netflix: folding and retranslating, with an episode numbered by position. Its rows carry the
    // shape a synopsis arrives in: `desc` (`utils.ts:153`) writes one text to BOTH description fields
    await answer('media', media('nf:81091393-3', {
      titles: [title('en', 'Demon Slayer')],
      episodes: [
        episode('nf:8109-1', 'nf:81091393-3', {
          episodeNumber: 1,
          titles: [title('en', 'Episode 1')],
          descriptions: [{ language: 'en', description: NETFLIX_SYNOPSIS, score: 0.5 }],
          shortDescriptions: [{ language: 'en', shortDescription: NETFLIX_SYNOPSIS, score: 0.5 }],
        }),
        // a source that writes ONE of the two fields, one each way, since both are read
        episode('nf:8109-2', 'nf:81091393-3', {
          episodeNumber: 2,
          titles: [title('en', 'Episode 2')],
          descriptions: [{ language: 'en', description: LONG_ONLY, score: 0.5 }],
        }),
        episode('nf:8109-3', 'nf:81091393-3', {
          episodeNumber: 3,
          titles: [title('en', 'Episode 3')],
          shortDescriptions: [{ language: 'en', shortDescription: SHORT_ONLY, score: 0.5 }],
        }),
        // a synopsis with too few content words to say anything, which is a placeholder and not a row
        episode('nf:8109-4', 'nf:81091393-3', {
          episodeNumber: 4,
          titles: [title('en', 'Episode 4')],
          descriptions: [{ language: 'en', description: 'Rudeus meets Eris again today.', score: 0.5 }],
        }),
      ],
    })),
    await answer('media', media('anizip:1', { titles: [title('en', 'Frieren')], episodes: [episode('anizip:1-1', 'anizip:1', { episodeNumber: 1 })] })),
    // the coercion table, one row per origin that builds a date out of a bare year
    ...await Promise.all([...COERCING_ORIGINS].map(origin =>
      answer('media', media(`${origin}:coerced`, { titles: [title('en', `${origin} coerced`)], startDate: '2021-01-01' })))),
    // a declared precision overrides the day-of-month rule, which is how a real premiere survives
    await answer('media', media('anilist:2', { titles: [title('en', 'New Year')], startDate: '2021-01-01', startDatePrecision: 'day' })),
  ])
  resetPassState()
  await runProfile()
})

afterAll(async () => {
  await closeGraph()
})

// (a) THE SCOPE RATCHET, computed as a VIEW over the Answer log, which is why a later RUN cannot flip
// it: nothing is overwritten to make that true (`db.ts:142-146`).
// Mutation: read `Media.scope` (the owner's LAST word) instead of the answers and jw:tm1 reads RUN,
// which is the bug the ratchet exists to prevent.
test('a CONTAINER once said stays CONTAINER, and a row nobody called a container does not', async () => {
  const container = (await profileOf('jw:tm1'))!
  expect(container.scope).toBe('CONTAINER')
  expect(container.scopeFrom, 'the answer that said so is named').toEqual(['answer:jw'])
  expect(container.dateSubject, 'a container row dates the container, so its date buckets no year').toBe('container')

  const run = (await profileOf('mal:1'))!
  expect(run.scope, 'the control: owned, and nothing ever called it a container').toBe('RUN')
  expect(run.scopeFrom).toBe(null)
  expect(run.dateSubject).toBe('run')
})

// (b) THE OTHER THREE WAYS A SCOPE IS SAID: a show-level origin, a source claim stamping the target,
// and the seed claim that never counts (`db.ts:99-103`, and 5.4 P0's "a seed or address stamp never").
// Mutation: drop the provenance filter in `scopeReadingOf` and `anidb:9` reads CONTAINER off the
// offline seed, which is a scope no source ever asserted.
test('a show-level origin is a container, a source claim can say so, and a seed claim never can', async () => {
  const showLevel = (await profileOf('imdb:tt1'))!
  expect([showLevel.scope, showLevel.showLevelOrigin, showLevel.scopeFrom]).toEqual(['CONTAINER', true, ['showLevelOrigin']])

  const claimed = (await profileOf('cr:GX1'))!
  expect(claimed.scope, 'a placeholder the PART_OF claim stamped').toBe('CONTAINER')
  expect(claimed.scopeFrom).toEqual(['claim:anilist'])

  const seeded = (await profileOf('anidb:9'))!
  expect(seeded.scope, 'the seed stamped CONTAINER and it counts for nothing').toBe(null)
  expect((await profileOf('omdb:tt1'))!.showLevelOrigin, 'omdb mints a RUN for a film').toBe(false)
  expect((await profileOf('omdb:tt1'))!.scope).toBe('RUN')
})

// (c) THE TITLE KEYS. Three of the four rules here are refusals, and each one cost something: a key
// with no letter merged 1,321 of 1,430 wrong pairs (2026-08-11), a season label merged Grand Blue
// into Mushoku Tensei, and a synonym put `minna no uta` on 23 unrelated shows (2026-08-29).
// Mutation: read `raw.synonyms` beside `raw.titles` and `minna no uta` becomes a key; drop the
// `isOnlySeasonLabel` test and `season 3` becomes one; drop `HAS_LETTER` and `2026` does.
test('a CJK title yields a key, and a synonym, a bare number and a season label yield none', async () => {
  expect(await keysOf('kitsu:1')).toEqual(['転生したらスライムだった件'])

  const stored = (await profileOf('mal:1'))!
  expect(await keysOf('mal:1'), 'both titles, best score per key, ordered by score then key').toEqual(['frieren', 'sôsô no frieren'])
  expect(JSON.parse(stored.titleKeysFolded as string).map((entry: { key: string }) => entry.key))
    .toEqual(['frieren', 'soso no frieren'])
  expect(JSON.parse(stored.titleKeys as string)[0]).toEqual({ key: 'frieren', score: 1, language: 'en', class: 'MAIN' })

  // and the key is a NODE plus an edge, so exact agreement is a join rather than a pairwise loop
  const keyEdges = await rowsOf(
    'MATCH (m:Media {uri: $uri})-[e:HAS_KEY]->(t:TitleKey) RETURN t.key AS key, e.score AS score, e.language AS language, e.class AS class ORDER BY t.key',
    { uri: 'mal:1' }
  )
  expect(keyEdges).toEqual([
    { key: 'frieren', score: 1, language: 'en', class: 'MAIN' },
    { key: 'sôsô no frieren', score: 1, language: 'ja', class: 'MAIN' },
  ])
  expect(await rowsOf('MATCH (t:TitleKey {key: $key}) RETURN t.by AS by', { key: 'frieren' })).toEqual([{ by: 'plugin:profile' }])
})

// (d) THE DATE, derived from the PARSED value and never from the string shape, because AniList emits
// `toUTCString()` for its year-only coercion too (`aired-date.ts:33,44,50`). Keeping January 1 as a
// day would destroy 14,992 of 17,946 streaming attaches (`fuzzy-merge.ts:150-156`).
// Mutation: test the string for `-01-01` instead of reading `getUTCDate()` and every origin that
// emits an ISO instant or a `toUTCString` reads `day`; drop the declared override and a real New
// Year's premiere can never be seen again.
test('a coerced date reads month-or-year and a real one reads day, for every coercing origin', async () => {
  for (const origin of COERCING_ORIGINS) {
    const coerced = (await profileOf(`${origin}:coerced`))!
    expect([origin, coerced.datePrecision, coerced.startDay, coerced.year, coerced.dateDerivation])
      .toEqual([origin, 'month-or-year', null, 2021, 'coerced'])
  }

  const real = (await profileOf('jw:tm1'))!
  expect([real.datePrecision, real.startDay, real.year, real.dateDerivation])
    .toEqual(['day', day('2023-09-29'), 2023, 'published'])

  const declared = (await profileOf('anilist:2'))!
  expect([declared.datePrecision, declared.startDay, declared.dateDerivation], 'a declared precision wins')
    .toEqual(['day', day('2021-01-01'), 'declared'])

  const undated = (await profileOf('kitsu:1'))!
  expect([undated.datePrecision, undated.startDay, undated.year, undated.dateDerivation]).toEqual(['none', null, null, null])
})

// (e) THE COUNTS. `countStated` is what the source published and `countDistinct` is what the graph
// holds, and the pair is what tells 14 rows over 10 distinct epids from a season of 14 (netflixid
// 80198505 season 3, 2026-09-10). An empty list is `none`, never 0.
// Mutation: read the list length as `countStated`, or default an unknown origin to `declared`, and a
// plugin source counting 120 releases for a twelve episode run becomes a declared count.
test('a fetched list is a listLength count and a published figure is a declared one', async () => {
  const fetched = (await profileOf('cr:GX1-GS1'))!
  expect([fetched.countKind, fetched.countStated, fetched.countDistinct]).toEqual(['listLength', 2, 2])

  const published = (await profileOf('mal:1'))!
  expect([published.countKind, published.countStated, published.countDistinct], 'mal publishes a figure and hung no list')
    .toEqual(['declared', 28, null])

  const silent = (await profileOf('kitsu:1'))!
  expect([silent.countKind, silent.countStated, silent.countDistinct], 'no count is not a count of zero')
    .toEqual(['none', null, null])
})

// LiveChart's `episode_count` is a figure off its season list, and it fetches no episodes at all.
// Mutation: drop `livechart` from DECLARED_COUNT_ORIGINS and its 12 reads as the length of a list.
test('a LiveChart count is a published figure', () => {
  expect(countReadingOf('livechart', 12, 0)).toEqual({ countKind: 'declared', countStated: 12, countDistinct: null })
})

// (f) THE ID PARENT. Specificity is PREFIX EXTENSION and the parent has to EXIST, which is the whole
// guard (`src/utils/uri.ts:23-34`).
// Mutation: drop the existence check and `offline:mal-59193` extends a nonexistent `offline:mal`,
// which is a containment nothing asserted.
test('a season-scoped id names its parent when the parent is a row, and never otherwise', async () => {
  expect((await profileOf('cr:GX1-GS1'))!.idParent).toBe('cr:GX1')
  expect((await profileOf('offline:mal-59193'))!.idParent, 'no offline:mal was ever named').toBe(null)
  expect((await profileOf('mal:1'))!.idParent, 'and an id with no suffix extends nothing').toBe(null)
})

// (g) THE PER-ORIGIN TABLES, which are constants standing in for per-claim properties (5.4 P0).
// Mutation: swap `nf` out of `RETRANSLATING_ORIGINS` and the episode-title rule that refused 21 of 25
// wrong pairs (2026-09-10) stops being asked on the one origin it was measured for.
test('folding, retranslating and show level are read off the origin tables', async () => {
  const netflix = (await profileOf('nf:81091393-3'))!
  expect([netflix.folding, netflix.retranslates, netflix.showLevelOrigin]).toEqual([true, true, false])

  const crunchyroll = (await profileOf('cr:GX1-GS1'))!
  expect([crunchyroll.folding, crunchyroll.retranslates]).toEqual([true, false])

  const metadata = (await profileOf('mal:1'))!
  expect([metadata.folding, metadata.retranslates, metadata.showLevelOrigin], 'a metadata origin folds nothing')
    .toEqual([false, false, false])
})

// (h) THE ORDINALS, read off the RAW titles because `normalizeTitle` folds `Season 4` and `Season 40`
// closer together (`fuzzy-merge.ts:324-325`). Silence is NULL and never zero: 284 of 4,159 titles end
// in a bare number and most name no season (2026-08-11).
// Mutation: run `parseSeasonNumber` over the whole title for the part as well and `Season 2 Part 3`
// reports part 2, which is the season's number wearing the part's name.
test('a season and a part are read separately, and a silent title says nothing', async () => {
  const ordinal = (await profileOf('anilist:1'))!
  expect([ordinal.seasonOrdinal, ordinal.partOrdinal]).toEqual([2, 3])
  expect(ordinal.ordinalFrom).toBe('Mushoku Tensei Season 2 Part 3')

  const silent = (await profileOf('mal:1'))!
  expect([silent.seasonOrdinal, silent.partOrdinal, silent.ordinalFrom]).toEqual([null, null, null])
})

// (i) FORMAT, WORK KIND AND COMPANION, as `profileCluster` derives them (`fuzzy-merge.ts:282-362`),
// with TV_SHORT folded back to TV (`:58,74`) and one-off specials left format-neutral (`:309`).
// Mutation: read `type` without `mergeType` and mal:1's TV_SHORT leaves `workKind` empty, so the
// companion veto stops firing on every cluster AniList alone types.
// A ROW THAT NAMES NO `type` NAMES NO FORMAT, which is the one place this differs from
// `profileCluster` (`fuzzy-merge.ts:305-316`). `categories` is the shelf a source files its rows
// under: `anizip/extractor.ts:20` stamps `['ANIME', 'SERIES']` on every row it mints, film or series,
// and ani.zip publishes no `type`, so a format read off categories alone hands guard 9 a constant to
// refuse a first-party id claim on. Measured over the corpus 2026-09-12: eight film clusters that
// mal, AniList, kitsu and offline all agree about lost their anizip row to it.
// Mutation: drop the `if (!kind) return null` and the third row below reads SERIES, which is
// `kind-mismatch` against every one of that film's other members.
test('a row with categories and no type of its own names no format', () => {
  expect(formatOf('MOVIE', ['ANIME', 'MOVIE']), 'the control: a row that names its own type').toBe('MOVIE')
  expect(formatOf('TV', ['ANIME', 'SERIES'])).toBe('SERIES')
  expect(formatOf(null, ['ANIME', 'SERIES']), "ani.zip's constant, on a film").toBe(null)
  expect(formatOf(null, ['MOVIE']), 'and the same for a row that only shelves itself under MOVIE').toBe(null)
  expect(formatOf('MOVIE', ['SERIES']), 'a row that disagrees with itself is silent').toBe(null)
  expect(formatOf('SPECIAL', ['ANIME', 'SERIES']), 'a one-off special straddles the boundary').toBe(null)
})

test('format and work kind follow the merge profile, and a companion marker is recorded', async () => {
  const series = (await profileOf('anilist:1'))!
  expect([series.format, series.workKind]).toEqual(['SERIES', 'TV'])

  const film = (await profileOf('omdb:tt1'))!
  expect([film.format, film.workKind]).toEqual(['MOVIE', 'MOVIE'])

  const short = (await profileOf('mal:1'))!
  expect(short.workKind, 'TV_SHORT is the TV it used to be').toBe('TV')

  expect((await profileOf('cr:GX1-GS1'))!.companion, '"Frieren Specials" ends in a measured marker').toBe(true)
  expect((await profileOf('anilist:1'))!.companion, 'the control: a title with no marker').toBe(false)
})

// (j) THE EPISODE PROFILE. A named day is that day and an instant is floored to its UTC day
// (`consensus.ts:85-88`); a title that names a position carries no identity (`similar.ts:104`).
// Mutation: parse a named `YYYY-MM-DD` in local time and every date-only episode moves a day west of
// Greenwich; drop the `generic` test and 11 of Netflix season 2's 25 rows claim an identity.
test('an episode day is precise about how it was named, and a generic title carries no identity', async () => {
  const named = (await episodeProfileOf('cr:GX1-GS1-1'))!
  expect([named.day, named.dayPrecision, named.generic]).toEqual([day('2023-09-29'), 'day', false])
  expect(JSON.parse(named.titleKeys as string).map((entry: { key: string }) => entry.key)).toEqual(['the journeys end'])

  const instant = (await episodeProfileOf('cr:GX1-GS1-2'))!
  expect([instant.day, instant.dayPrecision], 'an instant is floored to its UTC day').toEqual([day('2023-10-06'), 'instant'])
  expect([instant.generic, JSON.parse(instant.titleKeys as string)], '"Episode 2" names a position').toEqual([true, []])

  const undated = (await episodeProfileOf('anizip:1-1'))!
  expect([undated.day, undated.dayPrecision, undated.numberSpace], 'anizip numbers by its map key').toEqual([null, 'none', 'entry'])
  expect((await episodeProfileOf('nf:8109-1'))!.numberSpace, 'unogs numbers by list position').toBe('position')
  expect((await episodeProfileOf('cr:GX1-GS1-1'))!.numberSpace, 'everyone else numbers within a season').toBe('season')
})

// (j2) THE SYNOPSIS KEY, which is rule 3's third anchor source (5.4 P4) and the one column an
// episode carries that no title rule reads. It is the content words of the synopsis, deduplicated,
// sorted and joined: four letters or longer, function words dropped, and NOTHING at all below
// `MIN_SYNOPSIS_KEY_TOKENS`, because token Dice over two short bags is a coincidence rather than a
// similarity.
// Mutation: read `shortDescriptions` alone and episode 2 below stops being empty, since its source
// wrote only a description; drop the `MIN_SYNOPSIS_KEY_TOKENS` bar and its four content words become
// the key `eris meets rudeus today`, which scores 0.5 against any other key naming those two people;
// drop the sort and the column stops being byte-stable across passes.
test('an episode synopsis is stored as its content words, sorted, and a short one is stored as nothing', async () => {
  const first = (await episodeProfileOf('nf:8109-1'))!
  // the real Netflix `contextualSynopsis` above: `with`, `to`, `the`, `of`, `there`, `god` and `gal`
  // are gone, `Eris` and `Sword` appear once each however often they were written, and the order is
  // the alphabet rather than the sentence
  expect(JSON.parse(first.synopsisKeys as string)).toEqual([{
    key: 'alongside eris farion fellow ghislaine goes holy land leaving nina rudeus saint sword swords trains under',
    score: 0.5,
    language: 'en',
  }])
  // ONE ENTRY, not two: `desc` writes the same text as a description and as a shortDescription, so
  // reading both fields and deduplicating by key is what keeps one synopsis from counting twice
  expect(JSON.parse(first.synopsisKeys as string)).toHaveLength(1)

  // BOTH FIELDS ARE READ, proven one each way rather than on a row that carries both
  const longOnly = JSON.parse((await episodeProfileOf('nf:8109-2'))!.synopsisKeys as string)
  expect(longOnly.map((entry: { key: string }) => entry.key))
    .toEqual(['arrive disciple eris grounds hearing investigates isolde later nina reida rudeus skeptical talk training water'])
  const shortOnly = JSON.parse((await episodeProfileOf('nf:8109-3'))!.synopsisKeys as string)
  expect(shortOnly.map((entry: { key: string }) => entry.key))
    .toEqual(['begins brings happy home magic ranoa roxy rudeus teaching university'])

  const short = (await episodeProfileOf('nf:8109-4'))!
  expect(JSON.parse(short.synopsisKeys as string), 'four content words is not a synopsis').toEqual([])
  // and a row whose source ships no description at all is silent the same way
  expect(JSON.parse((await episodeProfileOf('cr:GX1-GS1-1'))!.synopsisKeys as string)).toEqual([])
})

// (k) THE EDGE TO THE ROW IT DESCRIBES, both ways round, since `PROFILE_OF` declares two FROM/TO
// pairs and a row of the wrong one silently writes nothing.
// Mutation: write the `PROFILE_OF` rows for only the first declared pair and every EpisodeProfile
// loses its edge while the count of profiles stays right.
test('every profile is joined to the row it describes', async () => {
  expect(await rowsOf('MATCH (p:MediaProfile {uri: $uri})-[e:PROFILE_OF]->(m:Media {uri: $uri}) RETURN e.by AS by', { uri: 'mal:1' }))
    .toEqual([{ by: 'plugin:profile' }])
  expect(await rowsOf('MATCH (p:EpisodeProfile {uri: $uri})-[e:PROFILE_OF]->(m:Episode {uri: $uri}) RETURN e.by AS by', { uri: 'cr:GX1-GS1-1' }))
    .toEqual([{ by: 'plugin:profile' }])

  const [counts] = await rowsOf(`MATCH (m:Media) RETURN count(m) AS media`)
  const [profiles] = await rowsOf('MATCH (n:MediaProfile) RETURN count(n) AS profiles')
  expect(profiles!.profiles, 'one profile per row, placeholders included').toBe(counts!.media)
})

// (l) THE CONTRACT ITSELF: same graph, same scope, same output. A second pass over an unchanged graph
// is a read and nothing else.
// Mutation: put `Date.now()` anywhere in a derivation, or order `titleKeys` by arrival, and this
// reports a write on every pass forever, which on a live page is a re-render per flush.
test('running the profile twice over the same graph writes nothing', async () => {
  const again = await runProfile()
  expect(again.changes, 'the second pass applied nothing').toEqual([])
  expect(again.iterations).toBe(1)
  expect(again.audit.ok).toBe(true)
})

// (l2) THE SCOPED PASS, which is the whole of what this plugin does with a delta: a wake naming two
// EPISODE uris profiles those two episodes and nothing else, and the profiles outside the scope
// stand. `delta.episodes` holds uris; when it held `HAS_EPISODE` edge keys the `UNWIND $uris AS u
// MATCH (e:Episode {uri: u})` form matched nothing and the scoped pass wrote no episode profile at
// all, while reporting a clean pass.
// Mutation: drop `ctx.delta.episodes` from this plugin's `subjectsOf`, which is what a delta of edge
// keys amounts to (a list matching no row), and this reports zero new profiles with no error
// anywhere.
test('a scoped pass over a wake naming only episode uris profiles those episodes', async () => {
  await ingestAnswers([
    await answer('media', media('tvdb:500', { titles: [title('en', 'Frieren')] })),
    await answer('episode', episode('tvdb:500-1', 'tvdb:500', { episodeNumber: 1, releaseDate: '2023-09-29' })),
    await answer('episode', episode('tvdb:500-2', 'tvdb:500', { episodeNumber: 2, releaseDate: '2023-10-06' })),
  ])
  const before = Number((await rowsOf('MATCH (n:EpisodeProfile) RETURN count(n) AS total'))[0]!.total)

  const pass = await runPlugins([profilePlugin], {
    reason: 'graph:changed', seq: 1, episodes: ['tvdb:500-1', 'tvdb:500-2'],
  })

  expect(pass.anomalies).toEqual([])
  expect(pass.audit.ok).toBe(true)
  expect(pass.changes.filter(change => change.table === 'EpisodeProfile').map(change => change.key).sort())
    .toEqual(['tvdb:500-1', 'tvdb:500-2'])
  expect((await episodeProfileOf('tvdb:500-1'))!.day, 'and it really derived one').toBe(day('2023-09-29'))
  // THE CONTROL, the other half of a scope: nothing outside it moved, retracted or otherwise
  const after = Number((await rowsOf('MATCH (n:EpisodeProfile) RETURN count(n) AS total'))[0]!.total)
  expect(after - before, 'two new profiles, and not one row retracted').toBe(2)
  expect(await episodeProfileOf('cr:GX1-GS1-1'), 'a profile outside the scope stands').toBeDefined()
})

// (m) A REAL RECORDED PAGE, which is the only case that meets the shapes 24 sources actually produce:
// nested nodes four deep, handles naming no node, a source that answers about another origin's uri.
// Skipped with a message where the corpus has not been walked, because a session with no corpus and a
// session with a broken plugin must not report alike.
test('the first 800 rows of a recorded page get a profile each, and a second pass writes nothing', async () => {
  if (!existsSync(CORPUS)) {
    console.warn(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= 800) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  // the fixtures above are already in the graph, so every number below is reported as a DELTA: a
  // total would read as the corpus's and be wrong by whatever this file ingested first
  const baseline = {
    media: Number((await rowsOf('MATCH (n:MediaProfile) RETURN count(n) AS total'))[0]!.total),
    episodes: Number((await rowsOf('MATCH (n:EpisodeProfile) RETURN count(n) AS total'))[0]!.total),
    keys: Number((await rowsOf('MATCH (t:TitleKey) RETURN count(t) AS total'))[0]!.total),
    edges: Number((await rowsOf('MATCH ()-[e:HAS_KEY]->() RETURN count(e) AS total'))[0]!.total),
  }
  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])

  const pass = await runPlugins([profilePlugin], { reason: 'graph:changed', seq: 1 })
  expect(pass.audit.ok, 'the source tables are what they were').toBe(true)
  expect(pass.anomalies).toEqual([])

  const [missingMedia] = await rowsOf('MATCH (m:Media) WHERE m.owned AND NOT EXISTS { MATCH (p:MediaProfile {uri: m.uri}) } RETURN count(m) AS total')
  expect(missingMedia!.total, 'every owned Media has a MediaProfile').toBe(0)
  const [missingEpisodes] = await rowsOf('MATCH (e:Episode) WHERE NOT EXISTS { MATCH (p:EpisodeProfile {uri: e.uri}) } RETURN count(e) AS total')
  expect(missingEpisodes!.total, 'every Episode has an EpisodeProfile').toBe(0)

  const again = await runPlugins([profilePlugin], { reason: 'graph:changed', seq: 2 })
  expect(again.changes, 'the same page twice is the same profile').toEqual([])

  // the numbers this step reports, printed rather than asserted: a threshold on a recorded page would
  // fail on the next walk rather than on the next bug
  const [written] = await rowsOf(`MATCH (n:MediaProfile) RETURN count(n) AS profiles`)
  const [episodes] = await rowsOf('MATCH (n:EpisodeProfile) RETURN count(n) AS profiles')
  const [keys] = await rowsOf('MATCH (t:TitleKey) RETURN count(t) AS keys')
  const [edges] = await rowsOf('MATCH ()-[e:HAS_KEY]->() RETURN count(e) AS edges')
  const scopes = await rowsOf('MATCH (n:MediaProfile) RETURN n.scope AS scope, count(n) AS total ORDER BY scope')
  const counts = await rowsOf('MATCH (n:MediaProfile) RETURN n.countKind AS countKind, count(n) AS total ORDER BY countKind')
  console.info('profile over 800 corpus rows:', JSON.stringify({
    mediaProfiles: Number(written!.profiles) - baseline.media,
    episodeProfiles: Number(episodes!.profiles) - baseline.episodes,
    titleKeys: Number(keys!.keys) - baseline.keys,
    hasKey: Number(edges!.edges) - baseline.edges,
    scope: scopes,
    countKind: counts,
    passMs: pass.ms,
    auditMs: pass.audit.ms,
    secondPassMs: again.ms,
  }))
}, 180_000)
