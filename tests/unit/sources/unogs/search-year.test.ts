// The search path had one axis, and one axis is not enough to name a work.
//
// `pickTitleMatch` decides which Netflix title the search found, with a category veto beside it, and
// both of those are about the TITLE. Measured on the recorded summer-2026 season corpus (223 runs,
// tests/corpus/), that took a bare Netflix title id into 16 runs whose hand-checked labels say the
// two are different works: Hollow Man (2000) for Potato Man, Indiana Jones and the Last Crusade
// (1989) for a 2026 Avatar film, The 40-Year-Old Virgin (2005) for Cherry and Virgin. What the
// sixteen share is a year nothing in this source read, while the search payload carried it the whole
// time. The rule the rest of the tree runs on is title picks the show and date picks the run
// (src/sources/catalogue-gate.ts); this file is the date half arriving at unogs.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { filmDatedAnotherYear, resolvers, runYearDate } from '../../../../src/sources/unogs/extractor'
import { titleSimilarity } from '../../../../src/sources/utils'

const UNOGS = 'https://unogs.com/api'

type Candidate = { nfid: number, title: string, year: number | null }
type Run = { uri: string, titles: string[], categories: string[], startDate?: string, seasonYear?: number }

/**
 * The recorded search answer, rebuilt from the recorded row.
 *
 * The walk records what the SOURCE answered rather than what unOGS served, and the year survives that
 * intact: `normalizeTitle` and `normalizeSearchResult` both stamp `${year}-01-01` and nothing else
 * writes that field, so a recorded `startDate` of 2012-01-01 is unOGS's `year: 2012` and nothing is
 * being guessed here. `vtype` comes back the same way, through the `categories` ternary both
 * normalizers share.
 */
const searchPayload = (candidate: Candidate) => ({
  nfid: candidate.nfid,
  title: candidate.title,
  vtype: 'movie',
  synopsis: '',
  img: '',
  year: candidate.year,
})

/**
 * EVERY query rung answers with the same hit, which is the strict version of this test rather than a
 * convenience. `searchAndLinkMedia` walks `[title, ...simplifyTitle(title)]` and stops at the first
 * rung that links, so a table answering only the recorded rung would let a refusal come from a rung
 * that found nothing at all, which proves nothing about the gate.
 *
 * Anything else throws, so fixture drift fails loudly instead of coming back undefined and reading as
 * "the source had nothing to say".
 */
const ctxFor = (run: Run, candidate: Candidate): ExtractorServerContext => {
  const detail = [{
    netflixid: candidate.nfid,
    title: candidate.title,
    vtype: 'movie',
    synopsis: '',
    year: candidate.year,
    img: '',
    lgimg: '',
    nfdate: '',
    imdbid: null,
    imdbrating: null,
  }]
  const bodyFor = (url: string): unknown => {
    if (url === `${UNOGS}/user`) return { token: { access_token: 'test-token' } }
    if (url.startsWith(`${UNOGS}/search?`)) return { results: [searchPayload(candidate)] }
    if (url === `${UNOGS}/title/detail?netflixid=${candidate.nfid}`) return detail
    if (url === `${UNOGS}/title/bgimages?netflixid=${candidate.nfid}`) return {}
    throw new Error(`unstubbed url: ${url}`)
  }
  return {
    fetch: (async (url: string) => {
      const body = bodyFor(String(url))
      return { json: async () => body, ok: true, status: 200 }
    }) as unknown as ExtractorServerContext['fetch'],
    findAggregatedMedia: async () => ({
      uri: run.uri,
      titles: run.titles.map(title => ({ language: 'en', title })),
      categories: run.categories,
      startDate: run.startDate,
      seasonYear: run.seasonYear,
      episodeCount: 1,
    }),
    listenForMediaChanges: async function* () {},
  } as unknown as ExtractorServerContext
}

const askMedia = async (uri: string, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const yields: { media: GQLMedia | null }[] = []
  for await (const value of subscribe(undefined, { input: { uri } }, ctx)) yields.push(value)
  return yields[0]?.media ?? null
}

const handleUris = (media: GQLMedia | null): string[] =>
  (media?.handles ?? []).map(handle => handle.node.uri)

/**
 * Seven of the sixteen, as their case files record them: the run's own row on one side, the Netflix
 * row the search welded into it on the other.
 *
 * The query is the run's first recorded title, which is the closest stand-in available for the
 * aggregate's first title, the string `resolveMedia` really searches with. Each of these clears
 * TITLE_MATCH_THRESHOLD against its Netflix row on some rung, which is why they are the seven: the
 * title axis admits them and only the year tells them apart. `anilist-214070` is in the list because
 * its first rung is refused by the title axis and the second one is not, so a gate that ran on the
 * first query alone would still weld it.
 */
const WELDS: { slug: string, work: string, run: Run, candidate: Candidate }[] = [
  {
    slug: 'anilist-133007',
    work: 'the 2026 fourth Madoka film against the 2012 Beginnings compilation',
    run: {
      uri: 'anilist:133007',
      titles: ['Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-'],
      categories: ['ANIME', 'MOVIE'],
      startDate: 'Fri, 28 Aug 2026 00:00:00 GMT',
      seasonYear: 2026,
    },
    candidate: { nfid: 80041086, title: 'Puella Magi Madoka Magica the Movie: Beginnings', year: 2012 },
  },
  {
    slug: 'kitsu-50666',
    work: 'the 2026 Avatar Aang film against Indiana Jones and the Last Crusade',
    run: {
      uri: 'kitsu:50666',
      titles: ['Avatar Aang: The Last Airbender'],
      categories: ['ANIME', 'MOVIE'],
      startDate: '2026-07-25',
      seasonYear: 2026,
    },
    candidate: { nfid: 60010487, title: 'Indiana Jones and the Last Crusade', year: 1989 },
  },
  {
    slug: 'mal-48832',
    work: 'Cherry and Virgin against The 40-Year-Old Virgin',
    run: {
      uri: 'mal:48832',
      titles: ['Cherry and Virgin'],
      categories: ['ANIME', 'MOVIE'],
      startDate: '2026-07-19',
      seasonYear: 2026,
    },
    candidate: { nfid: 70028904, title: 'The 40-Year-Old Virgin', year: 2005 },
  },
  {
    slug: 'mal-64674',
    work: 'the 2026 Monkey King anime against the 2023 film of that name',
    run: {
      uri: 'mal:64674',
      titles: ['Monkey King', 'Wukong Da Sheng'],
      categories: ['ANIME', 'MOVIE'],
      startDate: '2026-07-24',
      seasonYear: 2026,
    },
    candidate: { nfid: 80237245, title: 'The Monkey King', year: 2023 },
  },
  {
    slug: 'mal-64675',
    work: 'Three Kingdoms: The Beginning against Stamped from the Beginning',
    run: {
      uri: 'mal:64675',
      titles: ['Three Kingdoms: The Beginning', 'Sanguo Di Yi Bu: Zheng Luoyang'],
      categories: ['ANIME', 'MOVIE'],
      startDate: '2026-07-10',
      seasonYear: 2026,
    },
    candidate: { nfid: 81321341, title: 'Stamped from the Beginning', year: 2023 },
  },
  {
    slug: 'mal-64863',
    work: 'Potato Man against Hollow Man',
    run: {
      uri: 'mal:64863',
      titles: ['Potato Man', 'Tudou Xia: Wo Yao Dang Da Xia'],
      categories: ['ANIME', 'MOVIE'],
      startDate: '2026-08-21',
      seasonYear: 2026,
    },
    candidate: { nfid: 60000893, title: 'Hollow Man', year: 2000 },
  },
  {
    slug: 'anilist-214070',
    work: 'Dust of the Simulacrum against Dust of Empire, welded on the second query rung',
    run: {
      uri: 'anilist:214070',
      titles: ['Dust of the Simulacrum', 'Sazin no Nakade'],
      categories: ['ANIME', 'MOVIE'],
      startDate: 'Sun, 19 Jul 2026 00:00:00 GMT',
      seasonYear: 2026,
    },
    candidate: { nfid: 81635510, title: 'Dust of Empire', year: 1983 },
  },
]

for (const { slug, work, run, candidate } of WELDS) {
  test(`${slug} mints nothing: ${work}`, async () => {
    const media = await askMedia(`ag:(${run.uri})`, ctxFor(run, candidate))

    expect(handleUris(media), `nf:${candidate.nfid} claiming ${run.uri} is a weld with no inverse`).toEqual([])
    expect(media, 'a media here carries the claim, whatever else is right about it').toBeNull()
  })
}

// The controls. A run where the film is refused too has stopped this source linking rather than
// stopped it lying, and every assertion above would pass exactly the same way.
test('control: the same title in the run\'s own year still links', async () => {
  const run = WELDS[3]!.run
  const media = await askMedia(`ag:(${run.uri})`, ctxFor(run, { nfid: 80237245, title: 'The Monkey King', year: 2026 }))

  expect(media?.uri).toBe('nf:80237245')
  expect(handleUris(media), 'the link this source exists to make').toEqual(['mal:64674'])
})

// unOGS leaves `year` out often enough that refusing on it would cost far more than the sixteen. An
// absent year is unknown, never a disagreement, the same rule the category veto in `pickTitleMatch`
// already runs on.
test('control: a candidate carrying no year still links', async () => {
  const run = WELDS[3]!.run
  const media = await askMedia(`ag:(${run.uri})`, ctxFor(run, { nfid: 80237245, title: 'The Monkey King', year: null }))

  expect(media?.uri).toBe('nf:80237245')
  expect(handleUris(media)).toEqual(['mal:64674'])
})

// The other direction of the same rule, and the one that would be a new refusal: a run whose cluster
// names no year at all is linked exactly as it was before this gate existed. That is not a rare
// shape, it is every cluster on the tick where only a title has landed, since the wait in
// `resolveMedia` is on the title and the year is read as whatever happens to be beside it.
test('control: a run naming no year of its own is not newly refused', async () => {
  const run: Run = { uri: 'mal:64674', titles: ['Monkey King'], categories: ['ANIME', 'MOVIE'] }
  const media = await askMedia(`ag:(${run.uri})`, ctxFor(run, { nfid: 80237245, title: 'The Monkey King', year: 2023 }))

  expect(media?.uri, 'silence is not evidence, and a gate that reads it as evidence stops linking').toBe('nf:80237245')
  expect(handleUris(media)).toEqual(['mal:64674'])
})

// A run that knows its broadcast season and no date at all still has a year, and it is the only year
// it has. `runYearDate` reads seasonYear FIRST for that reason, and mal:64867 is the corpus run that
// proves the fallback is not decoration.
test('the run year is its seasonYear first, its start date second, and nothing otherwise', () => {
  expect(runYearDate({ seasonYear: 2026 })).toBe('2026-01-01')
  expect(runYearDate({ seasonYear: 2026, startDate: '2019-04-01' }), 'a coerced date never beats the season').toBe('2026-01-01')
  expect(runYearDate({ startDate: 'Fri, 28 Aug 2026 00:00:00 GMT' })).toBe('Fri, 28 Aug 2026 00:00:00 GMT')
  expect(runYearDate({}), 'nothing at all, never a guess').toBeUndefined()
  expect(runYearDate(undefined)).toBeUndefined()
})

// One year of slack on the catalogue's side, and one only. unOGS publishes a listing year rather than
// a premiere, so a film released late in one year is routinely listed under the next.
test('a film listed one year off the run is admitted, two years off is not', () => {
  const run = '2026-07-24'
  expect(filmDatedAnotherYear({ vtype: 'movie', year: 2025 }, run)).toBe(false)
  expect(filmDatedAnotherYear({ vtype: 'movie', year: 2027 }, run)).toBe(false)
  expect(filmDatedAnotherYear({ vtype: 'movie', year: 2024 }, run)).toBe(true)
  expect(filmDatedAnotherYear({ vtype: 'movie', year: 2028 }, run)).toBe(true)
})

// A SERIES year is the whole TITLE's, which is its first season's, so read as this run's year it
// vetoes the very season that holds the run: Netflix lists Mushoku Tensei as a 2021 title and its
// season 3 is a 2026 run. `netflixCandidates` offers that year to season 1 alone for the same reason.
test('a series candidate is never judged on the title year', () => {
  expect(filmDatedAnotherYear({ vtype: 'series', year: 2021 }, '2026-01-01')).toBe(false)
  expect(filmDatedAnotherYear({ vtype: undefined, year: 2021 }, '2026-01-01')).toBe(false)
})

// Why the answer was a second axis and not a higher TITLE_MATCH_THRESHOLD, which is the cheaper thing
// to reach for and would have cost the calibration. Two of the sixteen score ABOVE the correct match
// 0.44 is pinned on ("Cowboy Bebop" against "Cowboy Bebop: The Movie", recorded in src/sources/utils.ts
// at 0.505), so a threshold that refuses them refuses that one too. No number on this axis separates
// them, which is the whole argument for reading the date.
test('no title threshold could have caught the sixteen', async () => {
  const anchor = await titleSimilarity('Cowboy Bebop', 'Cowboy Bebop: The Movie')
  expect(anchor, 'the correct match the threshold is pinned on').toBeCloseTo(0.505, 2)

  const monkeyKing = await titleSimilarity('Monkey King', 'The Monkey King')
  const madoka = await titleSimilarity(
    'Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-',
    'Puella Magi Madoka Magica the Movie: Beginnings'
  )
  expect(monkeyKing, 'the 2026 anime against the 2023 film of that name').toBeGreaterThan(anchor)
  expect(madoka, 'the 2026 fourth film against the 2012 compilation').toBeGreaterThan(anchor)
})

const HERE = dirname(fileURLToPath(import.meta.url))
const CASES_DIR = join(HERE, '../../../corpus/cases')
const DUMP = join(HERE, '../../../../corpus/season/summer-2026/answers.jsonl')

type Recorded = { startDate?: string | null, seasonYear?: number | null, categories?: string[] | null }

/** Every media answer the season walk recorded, by uri. The raw answer, not a reshaping of it. */
const recordedMedia = (): Map<string, Recorded[]> => {
  const byUri = new Map<string, Recorded[]>()
  for (const line of readFileSync(DUMP, 'utf8').split('\n')) {
    if (!line) continue
    const row = JSON.parse(line) as { kind: string, uri: string, raw: string }
    if (row.kind !== 'media') continue
    const raw = JSON.parse(row.raw) as Recorded & { uri?: string }
    const uri = raw.uri ?? row.uri
    byUri.set(uri, [...(byUri.get(uri) ?? []), raw])
  }
  return byUri
}

const yearOfDate = (date: string | null | undefined): number | undefined => {
  if (!date) return undefined
  const parsed = new Date(date)
  return isNaN(parsed.getTime()) ? undefined : parsed.getUTCFullYear()
}

type LabelledPair = { slug: string, nfUri: string, runUris: string[] }

/**
 * The whole recorded season, run through the gate: every Netflix answer the walk recorded, against
 * every run in the corpus whose labels name it.
 *
 * A `together` group holding an `nf:` uri is a CORRECT match, the link this source exists to make. An
 * `apart` group pairing an `nf:` uri with one of ours is a weld, a claim the labels overrule. Both
 * arms are computed here rather than quoted, and the unchecked arm is computed the same way with the
 * gate switched off, because "no correct match was lost" is a comparison and not an assertion about a
 * number somebody wrote down once.
 *
 * The run's year is taken from EVERY row of its cluster (`seasonYear` first, exactly as
 * `runYearDate` reads it) and a candidate is refused only when it disagrees with all of them, which
 * is the conservative reading: the aggregate the source really asks carries one year, and no choice
 * of which it is can refuse more than this.
 *
 * The two numbers print with `npx vitest run tests/unit/sources/unogs --disableConsoleIntercept`, the
 * same flag `npm run calibrate` already needs. Without it the reporter keeps a passing test's output,
 * so the assertions below carry the counts as well.
 */
test('the measurement: what the year gate keeps and what it refuses over the recorded season', () => {
  if (!existsSync(DUMP)) {
    console.warn(`no corpus at ${DUMP}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const recorded = recordedMedia()
  const correct: LabelledPair[] = []
  const welds: LabelledPair[] = []
  const runYearsBySlug = new Map<string, string[]>()
  const candidates = new Map<string, { vtype: string, year: number | null }>()

  for (const file of readdirSync(CASES_DIR).filter(name => name.endsWith('.json')).sort()) {
    const slug = file.slice(0, -'.json'.length)
    const corpusCase = JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')) as {
      rows: { uri: string, startDate?: string | null, categories?: string[] | null }[]
      expect: { together: string[][], apart: string[][] }
    }

    const runDates = new Set<string>()
    for (const row of corpusCase.rows) {
      if (row.uri.startsWith('nf:')) continue
      for (const answer of recorded.get(row.uri) ?? []) {
        const date = runYearDate(answer)
        if (date) runDates.add(date)
      }
      const fromCase = runYearDate({ startDate: row.startDate })
      if (fromCase) runDates.add(fromCase)
    }
    runYearsBySlug.set(slug, [...runDates])

    for (const row of corpusCase.rows) {
      if (!row.uri.startsWith('nf:') || candidates.has(row.uri)) continue
      const answers = recorded.get(row.uri) ?? []
      // the dump carries no answer for a case written from the specification's walkthroughs rather
      // than from the walk, and a candidate nobody recorded is not a candidate this gate ever saw
      if (!answers.length) continue
      const categories = answers.find(answer => answer.categories?.length)?.categories ?? row.categories ?? []
      const year = yearOfDate(answers.find(answer => answer.startDate)?.startDate ?? row.startDate)
      candidates.set(row.uri, { vtype: categories.includes('MOVIE') ? 'movie' : 'series', year: year ?? null })
    }

    for (const group of corpusCase.expect.together) {
      const runUris = group.filter(uri => !uri.startsWith('nf:'))
      for (const nfUri of group.filter(uri => uri.startsWith('nf:'))) correct.push({ slug, nfUri, runUris })
    }
    for (const group of corpusCase.expect.apart) {
      const runUris = group.filter(uri => !uri.startsWith('nf:'))
      if (!runUris.length) continue
      for (const nfUri of group.filter(uri => uri.startsWith('nf:'))) welds.push({ slug, nfUri, runUris })
    }
  }

  const refuses = (pair: LabelledPair, gated: boolean): boolean => {
    const candidate = candidates.get(pair.nfUri)
    const dates = runYearsBySlug.get(pair.slug) ?? []
    if (!gated || !candidate || !dates.length) return false
    return dates.every(date => filmDatedAnotherYear(candidate, date))
  }

  const keptBefore = correct.filter(pair => !refuses(pair, false)).length
  const keptCorrect = correct.filter(pair => !refuses(pair, true)).length
  const refusedBefore = welds.filter(pair => refuses(pair, false)).length
  const refusedWelds = welds.filter(pair => refuses(pair, true))

  console.log(
    `[unogs year gate] correct matches kept ${keptCorrect} of ${correct.length} (${keptBefore} before the gate), ` +
    `welds refused ${refusedWelds.length} of ${welds.length} (${refusedBefore} before the gate)`
  )

  expect(keptCorrect, 'a gate that pays for its welds in correct links is not worth having').toBe(keptBefore)
  expect(keptCorrect, 'every Netflix row the labels call a correct match still links').toBe(correct.length)
  expect(refusedWelds.length).toBeGreaterThan(refusedBefore)
  // 15 pairs across 14 cases: anilist-133007 carries two Netflix rows, Beginnings and Eternal, and the
  // gate refuses both. A change here is the labels changing and is meant to be read, not re-pinned.
  expect(refusedWelds.length, 'the welds this gate takes off the board').toBe(15)

  // The sixteen, split by what the record can actually say about each. Fourteen are films carrying
  // their own year and are refused. The other two are SEASON picks on a Netflix SERIES
  // (`nf:82010449-1`, `nf:82085211-1`): the recorded answer carries no year at all, because the season
  // rewrite in `assembleMedia` drops the show's year on purpose, and the search year behind them is
  // the TITLE's, which this gate refuses to read as a run's. They are named here rather than left out,
  // so the gap is loud.
  const FILM_WELDS = [
    'anilist-133007', 'anilist-202717', 'anilist-206682', 'anilist-208754', 'anilist-208829',
    'anilist-211232', 'anilist-214070', 'kitsu-50666', 'mal-48832', 'mal-63903', 'mal-64674',
    'mal-64675', 'mal-64682', 'mal-64863',
  ]
  const SEASON_WELDS = ['anilist-206521', 'mal-64867']

  const refusedSlugs = [...new Set(refusedWelds.map(pair => pair.slug))].sort()
  expect(refusedSlugs).toEqual(FILM_WELDS.slice().sort())
  expect(
    SEASON_WELDS.filter(slug => refusedSlugs.includes(slug)),
    'a season pick on a series has no year here, and reading the title year as the run year is the mistake catalogue-gate.ts measures'
  ).toEqual([])

  // The tolerance is free on this corpus, which is the argument for it being one year rather than
  // zero: the nearest refused weld is three years out, so exact matching refuses the same rows.
  const exact = welds.filter(pair => {
    const candidate = candidates.get(pair.nfUri)
    const dates = runYearsBySlug.get(pair.slug) ?? []
    if (!candidate || candidate.vtype !== 'movie' || !candidate.year || !dates.length) return false
    return dates.every(date => yearOfDate(date) !== candidate.year)
  })
  expect(exact.length, 'one year of slack costs nothing here, so it is bought for the listing drift alone').toBe(refusedWelds.length)
})
