/**
 * `plugin:title` of 5.4 P3: every verdict the fuzzy pass reaches, reached again through the graph.
 *
 * WHAT EACH CASE IS FOR. The first twenty-one are `tests/unit/worker/store/fuzzy-merge.test.ts` and
 * `season-separation.test.ts` ported onto seeded graphs, one for one, because the point of moving the
 * pass is that it decides the same things: a case here that disagrees with its twin there is a
 * regression whichever file is right. The rest are what the move ADDS and the old pass could not
 * have: the four gate outcomes as a row, the exact-key join, the cap read off the profile, an LRU
 * that evicts one entry, and a whole recorded page through all four plugins.
 *
 * EVERY FIXTURE HAS ITS OWN YEAR, and that is load bearing rather than tidy. The scan is over the
 * WHOLE graph, so two fixtures sharing a year are compared with each other and a case would then be
 * testing the other case's titles. The years are far from the corpus's, which replays into the same
 * graph at the end.
 *
 * The mutation that makes each case fail is named above it, and the ones that were actually run are
 * marked MUTATED.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { TitleMemberRow } from '../../../../../src/worker/graph/plugins/title'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import { aggregatePlugin } from '../../../../../src/worker/graph/plugins/aggregate'
import {
  containerKeyOf, createDecisionCache, decide, EXACT_SCAN, MEMBER_SCAN, orderPair, profileClusters,
  proposalFor, titleDecisions, titlePlugin,
} from '../../../../../src/worker/graph/plugins/title'
import { checkInvariants } from '../../../../../src/worker/graph/plugins/invariants'
import { parseSeasonNumber } from '../../../../../src/sources/season'
import { answer, media, rowsOf, sameAs, title } from './fixtures'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const PLUGINS = [profilePlugin, directPlugin, aggregatePlugin, titlePlugin]

const runPass = async () => {
  const report = await runPlugins(PLUGINS, { reason: 'manual' })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
  // the pass's own anomalies: a plugin that threw, a cycle, or a source row that moved under it
  expect(report.anomalies).toEqual([])
  return report
}

/** A day-precise date: day 3 rather than day 1, which every origin coerces and `startDay` drops. */
const dated = (year: number, month = 4, day = 3) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00Z`

/** A media as a source answers one: titled, typed, dated, and RUN unless the case says otherwise. */
const show = (uri: string, titles: [string, number][], startDate: string | null, fields: Record<string, unknown> = {}) =>
  media(uri, {
    titles: titles.map(([text, score]) => title('ja', text, score)),
    type: 'TV',
    categories: ['ANIME', 'SERIES'],
    ...startDate === null ? {} : { startDate },
    ...fields,
  })

/** Every `plugin:title` row touching one uri, as a shape a case can read at a glance. */
const titleLinks = async (uri: string) =>
  (await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = 'plugin:title' AND (a.uri = $uri OR b.uri = $uri)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason,
       l.confidence AS confidence, l.evidence AS evidence, l.gates AS gates, l.supports AS supports
     ORDER BY fromUri, toUri, kind`,
    { uri }
  )).map(row => ({
    pair: `${String(row.fromUri)} ${String(row.toUri)}`,
    kind: String(row.kind),
    status: String(row.status),
    reason: String(row.reason),
    confidence: Number(row.confidence),
    evidence: JSON.parse(String(row.evidence ?? 'null')) as Record<string, unknown> | null,
    gates: row.gates === null || row.gates === undefined ? null : JSON.parse(String(row.gates)) as Record<string, string>,
    supports: ((row.supports as string[] | null) ?? []).map(String),
  }))

/** The members of one uri's cluster, which is what a weld means once `plugin:aggregate` has run. */
const clusterOf = async (uri: string): Promise<string[]> =>
  (await rowsOf(
    `MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(o:Media)
     RETURN o.uri AS uri ORDER BY uri`,
    { uri }
  )).map(row => String(row.uri))

const welded = async (a: string, b: string) => (await clusterOf(a)).includes(b)

/** The cluster profiles as the plugin builds them, read off the graph the same way it reads them. */
const profilesNow = async () => profileClusters(await rowsOf(MEMBER_SCAN) as unknown as TitleMemberRow[])

const profileOf = async (uri: string) => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri })
  return (await profilesNow()).get(String(row!.id))!
}

/** Every link this plugin wrote, counted by kind, status and reason: the histogram of the replay. */
const histogramOf = async (): Promise<Map<string, number>> => new Map((await rowsOf(
  `MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:title'
   RETURN l.kind AS kind, l.status AS status, l.reason AS reason, count(l) AS total
   ORDER BY kind, status, reason`
)).map(row => [`${String(row.kind)} ${String(row.status)} ${String(row.reason)}`, Number(row.total)]))

// Seeded, because the property under test is that the outcome does not vary: an unseeded shuffle that
// only sometimes picks the order that flips it is a flake, and a flake here reads as noise rather
// than as the regression it is.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = swap
  }
  return shuffled
}

// Mushoku Tensei as the store actually holds it: two MAL cours and ani.zip's record already welded by
// their claims, EIGHT distinct normalized titles all carrying the same score 0.9, against a cap of
// six. Only ani.zip renders the short name, and the short name is the only title JustWatch carries.
const MUSHOKU: [string, [string, number][]][] = [
  ['mal:39535', [
    ['Mushoku Tensei: Jobless Reincarnation', 0.9],
    ['Mushoku Tensei: Isekai Ittara Honki Dasu', 0.9],
    ['無職転生 異世界行ったら本気だす', 0.9],
  ]],
  ['kitsu:45576', [
    ['Mushoku Tensei: Jobless Reincarnation Part 2', 0.9],
    ['Mushoku Tensei: Isekai Ittara Honki Dasu Part 2', 0.9],
    ['無職転生 異世界行ったら本気だす 第2クール', 0.9],
  ]],
  ['anizip:15669', [
    ['Mushoku Tensei', 0.9],
    ['無職転生', 0.9],
  ]],
]

const PERMUTATIONS = 24

beforeAll(async () => {
  const random = mulberry32(20260912)
  await enableGraph(true)
  await ingestAnswers([
    // 1901, the year-only japanese title: ani.zip's "(2026)" and the show's own 4th season are one
    // cluster by claim, and the unrelated show that also renders its year must not join them
    await answer('media', show('anilist:182205', [
      ['Tensei Shitara Slime Datta Ken 4th Season', 0.7], ['転生したらスライムだった件 第4期', 0.7],
    ], dated(1901), { handles: [sameAs(media('anizip:18884'))] })),
    await answer('media', show('anizip:18884', [
      ['That Time I Got Reincarnated as a Slime (1901)', 0.9], ['転生したらスライムだった件 (1901)', 0.9],
    ], dated(1901))),
    await answer('media', show('anilist:205116', [
      ['Aware! Meisaku-kun (1901)', 0.7], ['あはれ！名作くん (1901)', 0.7],
    ], dated(1901, 7, 5))),

    // 1902 and 1903: the two merges the whole pass exists for, one per script
    await answer('media', show('anilist:1000', [['転生したらスライムだった件 第4期', 0.7]], dated(1902))),
    await answer('media', show('anizip:1001', [['転生したらスライムだった件 第4期', 0.9]], dated(1902))),
    await answer('media', show('anilist:2000', [['That Time I Got Reincarnated as a Slime (1903)', 0.7]], dated(1903))),
    await answer('media', show('kitsu:2001', [['That Time I Got Reincarnated as a Slime 1903', 0.3]], dated(1903))),

    // 1904, the bare number: "第2期" and "第2クール" both left "2" behind, the busiest key of all
    await answer('media', show('anilist:3000', [['Mato Seihei no Slave 2', 0.7], ['2', 0.9]], dated(1904))),
    await answer('media', show('anilist:3001', [['Medalist 2nd Season', 0.7], ['2', 0.9]], dated(1904))),

    // 1905 and 1906: the season gate, refusing and agreeing, both on a SHARED EXACT alias so the
    // exact shortcut is what the gate has to stop
    await answer('media', show('anilist:4000', [['Slime Season 3', 0.7], ['TenSura', 0.9]], dated(1905))),
    await answer('media', show('anilist:4001', [['Slime Season 4', 0.7], ['TenSura', 0.9]], dated(1905))),
    await answer('media', show('anilist:4100', [['Slime Season 4', 0.7], ['TenSura', 0.9]], dated(1906))),
    await answer('media', show('anizip:4101', [['転生したらスライムだった件 第4期', 0.9], ['TenSura', 0.9]], dated(1906))),

    // 1907, the trailing number compared as a value, and 1908, the punctuation it must not cost
    await answer('media', show('anilist:4200', [['Yami Shibai 16', 0.9]], dated(1907))),
    await answer('media', show('anilist:4201', [['Yami Shibai 17', 0.9]], dated(1907))),
    await answer('media', show('anilist:4300', [['Onii-chan wa Oshimai!', 0.7]], dated(1908))),
    await answer('media', show('mal:4301', [['Oniichan wa Oshimai', 0.9]], dated(1908))),

    // 1909 and 1910, the season-only label: two unrelated shows each carrying Crunchyroll's own
    // "Season 3". The anilist rows state a count because `cr` FOLDS, and guard 8 refuses a folding
    // season facing a run with no length at all (5.2), which would take the claim with it
    await answer('media', show('anilist:199111', [['Grand Blue Dreaming Season 3', 0.7]], dated(1909), {
      episodeCount: 12, handles: [sameAs(media('cr:GNVHKN94W'))],
    })),
    await answer('media', show('cr:GNVHKN94W', [['Season 3', 0.5]], dated(1909))),
    await answer('media', show('anilist:178789', [['Mushoku Tensei: Jobless Reincarnation Season 3', 0.7]], dated(1909), {
      episodeCount: 12, handles: [sameAs(media('cr:G24H1N3MP'))],
    })),
    await answer('media', show('cr:G24H1N3MP', [['Season 3', 0.5]], dated(1909))),
    await answer('media', show('anilist:4400', [['Some Show 2nd Season', 0.7]], dated(1910), {
      episodeCount: 12, handles: [sameAs(media('cr:AAA'))],
    })),
    await answer('media', show('cr:AAA', [['2nd Season', 0.5]], dated(1910))),
    await answer('media', show('anilist:4401', [['Another Show 2nd Season', 0.7]], dated(1910), {
      episodeCount: 12, handles: [sameAs(media('cr:BBB'))],
    })),
    await answer('media', show('cr:BBB', [['2nd Season', 0.5]], dated(1910))),

    // 1911, the work against its own companion entry: both signals present, and both needed
    await answer('media', show('anilist:5000', [['Vanquished Queens', 0.8], ['ヴァンキッシュドクイーンズ', 0.8]], dated(1911), {
      type: 'OVA', handles: [sameAs(media('kitsu:5001'))],
    })),
    await answer('media', show('kitsu:5001', [['Vanquished Queens', 0.3]], dated(1911), { type: 'OVA' })),
    await answer('media', show('anilist:5002', [['Vanquished Queens Specials', 0.8], ['ヴァンキッシュドクイーンズ', 0.8]], dated(1911), {
      type: 'SPECIAL', handles: [sameAs(media('kitsu:5003'))],
    })),
    await answer('media', show('kitsu:5003', [['Vanquished Queens Specials', 0.3]], dated(1911), { type: 'SPECIAL' })),

    // 1912, the marker with NO disagreement: one catalogue's naming convention, and it must not block
    await answer('media', show('anilist:5100', [['Mirai Nikki OVA', 0.8], ['未来日記', 0.8]], dated(1912), { type: 'OVA' })),
    await answer('media', show('kitsu:5101', [['Mirai Nikki', 0.3], ['未来日記', 0.3]], dated(1912), { type: 'OVA' })),

    // 1914, the type disagreement with NO marker: alone it destroys 547 correct merges, which is why
    // the companion gate takes both signals. 1915, a trailing number whose stem is long enough that
    // the pair scores 0.9214, ABOVE the threshold: the skip is the only thing that separates them
    await answer('media', show('anilist:5300', [['Futatsu no Kuni', 0.8]], dated(1914), { type: 'OVA' })),
    await answer('media', show('kitsu:5301', [['Futatsu no Kuni', 0.3]], dated(1914), { type: 'SPECIAL' })),
    await answer('media', show('anilist:5400', [['The Eminence in Shadow 2', 0.9]], dated(1915))),
    await answer('media', show('kitsu:5401', [['The Eminence in Shadow 3', 0.9]], dated(1915))),

    // 1913, the streaming attach: the metadata cluster's own title carries a marker and the
    // catalogue row types nothing, so both the companion gate and the format gate are SILENT
    await answer('media', show('anilist:5200', [['Keijo!!!!!!!! Specials', 0.8], ['競女 specials', 0.8]], dated(1913), {
      type: 'SPECIAL', episodeCount: 12, handles: [sameAs(media('kitsu:5201'))],
    })),
    await answer('media', show('kitsu:5201', [['Keijo!!!!!!!!', 0.3], ['競女', 0.3]], dated(1913), { type: 'SPECIAL' })),
    await answer('media', media('jw:tskeijo', { titles: [title('en', 'Keijo!!!!!!!!', 0.2)], startDate: '1913-01-01' })),

    // 1916, the verdict weighed against the clusters AS THEY STAND: ani.zip carries the second cour
    // by the time the pair is weighed, so the season it now names is what the gate reads
    await answer('media', show('cr:GRQ8VE29Y-s1', [['Mushoku Tensei', 0.5], ['Season 1', 0.5]], dated(1916))),
    await answer('media', show('anizip:20001', [['Mushoku Tensei', 0.9]], dated(1916), {
      episodeCount: 12, handles: [sameAs(media('mal:20002'))],
    })),
    await answer('media', show('mal:20002', [['Mushoku Tensei Part 2', 0.9]], dated(1916))),

    // 1917, a run and a container, and 1918, two containers
    await answer('media', show('anilist:7000', [['Mushoku Tensei', 0.8]], dated(1917))),
    await answer('media', show('tvmaze:7001', [['Mushoku Tensei', 0.3]], dated(1917), { scope: 'CONTAINER' })),
    await answer('media', show('tmdb:7100', [['Mushoku Tensei Show', 0.5]], dated(1918), { scope: 'CONTAINER' })),
    await answer('media', show('tvmaze:7101', [['Mushoku Tensei Show', 0.3]], dated(1918), { scope: 'CONTAINER' })),

    // 1919, the cluster whose member is a container: the claim that welded them is downgraded, and
    // the two RUNS still have to find each other
    await answer('media', show('kitsu:7301', [['Mushoku Tensei', 0.3]], dated(1919), {
      handles: [sameAs(media('cr:7300'))],
    })),
    await answer('media', show('cr:7300', [['Mushoku Tensei', 0.5]], dated(1919), { scope: 'CONTAINER' })),
    await answer('media', show('mal:7302', [['Mushoku Tensei', 0.9]], dated(1919))),

    // 1920, the control: two runs that agree on title and year, with nothing else in the way
    await answer('media', show('anilist:7200', [['Mushoku Tensei', 0.8]], dated(1920))),
    await answer('media', show('kitsu:7201', [['Mushoku Tensei', 0.3]], dated(1920))),

    // 1921, the short that must profile as the TV it used to be spelled
    await answer('media', show('anilist:9210', [['Aru Short', 0.7]], dated(1921), { type: 'TV_SHORT' })),
    await answer('media', show('kitsu:9211', [['Aru Short', 0.9]], dated(1921))),

    // 1922, the format gate, and 1923, the date gate, each with the title agreeing exactly so the
    // gate is the only thing that can refuse
    await answer('media', show('anilist:9220', [['Format Probe', 0.9]], dated(1922), {
      type: 'MOVIE', categories: ['ANIME', 'MOVIE'],
    })),
    await answer('media', show('anilist:9221', [['Format Probe', 0.9]], dated(1922))),
    await answer('media', show('anilist:9230', [['Date Probe', 0.9]], dated(1923, 1, 6))),
    await answer('media', show('anilist:9231', [['Date Probe', 0.9]], dated(1923, 7, 6))),

    // 1924 and 1925 against 1926: the same title in two years is never compared, and the control in
    // one year is. 1927 is the silent half, a cluster that names no date at all
    await answer('media', show('anilist:9240', [['Bucket Probe', 0.9]], dated(1924))),
    await answer('media', show('anilist:9250', [['Bucket Probe', 0.9]], dated(1925))),
    await answer('media', show('anilist:9260', [['Bucket Probe', 0.9]], dated(1926))),
    await answer('media', show('kitsu:9261', [['Bucket Probe', 0.9]], dated(1926))),
    await answer('media', show('anilist:9270', [['Undated Probe', 0.9]], null)),
    await answer('media', show('kitsu:9271', [['Undated Probe', 0.9]], dated(1927))),

    // 1928, the cap: seven titles in ONE tier, so the seventh in title order is the one dropped
    await answer('media', show('anilist:9280', [
      ['Cap Zulu', 0.9], ['Cap Alpha', 0.9], ['Cap Bravo', 0.9], ['Cap Charlie', 0.9],
      ['Cap Delta', 0.9], ['Cap Echo', 0.9], ['Cap Foxtrot', 0.9],
    ], dated(1928))),
    await answer('media', show('kitsu:9281', [['Cap Zulu', 0.3]], dated(1928))),
    await answer('media', show('kitsu:9282', [['Cap Alpha', 0.3]], dated(1928))),

    // 1929, the known gap: one side names a part and the other names nothing, and the year-only side
    // has no day for the date gate to read
    await answer('media', show('anilist:8601', [['86', 0.8], ['86 -不存在的战区-', 0.9]], '1929-01-01')),
    await answer('media', show('kitsu:8602', [['86 Part 2', 0.8], ['86 -不存在的战区-', 0.9]], dated(1929, 7, 6))),

    // 1930 against 1933, THE ORDINAL AXIS. The container carries the SHOW's date, which is its first
    // run's, so the two share no year bucket and sit 1095 days apart: nothing in the shipped pass
    // ever compares them. The run names its own show by dropping its season marker, and that is the
    // only thing that pairs them
    await answer('media', show('jw:ordinalprobe', [['Ordinal Probe', 0.2]], dated(1930), { scope: 'CONTAINER' })),
    await answer('media', show('anilist:8310', [['Ordinal Probe Season 2', 0.8]], dated(1933))),

    // 1934, the date gate's own half: ONE year, 181 days apart, which is the same distance the two
    // Date Probes are refused on. Between a show and its second season the two dates are about two
    // different runs, so the gate has nothing to say rather than a verdict
    await answer('media', show('jw:ordinalsame', [['Ordinal Same', 0.2]], dated(1934, 1, 6), { scope: 'CONTAINER' })),
    await answer('media', show('anilist:8330', [['Ordinal Same Part 2', 0.8]], dated(1934, 7, 6))),

    // 1935, the CONTROL for that silence, and the narrowness of it: a FIRST run against its show, the
    // same 181 days, where the two dates really are about the same run and the window still refuses
    await answer('media', show('jw:ordinalfirst', [['Ordinal First', 0.2]], dated(1935, 1, 6), { scope: 'CONTAINER' })),
    await answer('media', show('anilist:8350', [['Ordinal First', 0.8]], dated(1935, 7, 6))),

    // 1936 against 1937, the remake shape: a run that declares an ordinal on ONE title and names the
    // container on ANOTHER, which carries no marker. The axis is a rule about a KEY and not about a
    // cluster, so the unmarked key names no container and the two years keep them apart
    await answer('media', show('jw:ordinalmixed', [['Ordinal Elsewhere', 0.2]], dated(1936), { scope: 'CONTAINER' })),
    await answer('media', show('anilist:8370', [
      ['Ordinal Mixed Season 3', 0.8], ['Ordinal Elsewhere', 0.8],
    ], dated(1937))),

    // 1940, GATE 3 AGAINST A CONTAINER THE RUN NEVER NAMED, which is the premise read off the run
    // alone rather than off the pair. The run declares a second season of `totally other show` and
    // reaches this container only by the ordinary fuzzy pass at 0.9, on a title one letter short of
    // it. Same year, 182 days apart because 1940 is a leap year, and the ordinal is another show's
    await answer('media', show('jw:ncwindow', [['Neg Control Window', 0.2]], dated(1940, 1, 6), { scope: 'CONTAINER' })),
    await answer('media', show('anilist:9451', [
      ['Neg Control Windo', 0.8], ['Totally Other Show Season 2', 0.8],
    ], dated(1940, 7, 6))),

    // 1941, two films of one title six months apart: an anime film and a live-action one
    await answer('media', show('anilist:9410', [['Film Probe', 0.8]], dated(1941, 1, 6), { type: 'MOVIE', categories: ['ANIME', 'MOVIE'] })),
    await answer('media', show('jw:filmprobe', [['Film Probe', 0.2]], dated(1941, 7, 6), { type: 'MOVIE', categories: ['MOVIE'] })),

    // 1950 and up, one year per permutation so no two permutations can ever be compared with each
    // other: the same component and the same JustWatch row, assembled in 24 different orders
    ...await Promise.all(Array.from({ length: PERMUTATIONS }, (_, permutation) => permutation).flatMap(permutation => {
      const suffix = `-p${permutation}`
      const year = dated(1950 + permutation)
      const rows = shuffle([
        ...MUSHOKU.map(([uri, titles]) => show(uri + suffix, shuffle(titles, random) as [string, number][], year)),
        show(`jw:tsmushokutensei${suffix}`, [['Mushoku Tensei', 0.2]], year),
      ], random)
      return rows.map(row => answer('media', row))
    })),
  ])

  // the claims that weld each permutation's component, written as their own answers so the shuffle
  // above cannot change which row carries them
  await ingestAnswers(await Promise.all(
    Array.from({ length: PERMUTATIONS }, (_, permutation) => permutation).map(permutation => {
      const suffix = `-p${permutation}`
      return answer('media', show(`mal:39535${suffix}`, MUSHOKU[0]![1], dated(1950 + permutation), {
        // a run length on the metadata side, because `jw` folds and guard 8 never welds a folding
        // season onto a run with no length (5.2)
        episodeCount: 11,
        handles: [sameAs(media(`kitsu:45576${suffix}`)), sameAs(media(`anizip:15669${suffix}`))],
      }))
    })
  ))

  resetPassState()
  await runPass()
})

afterAll(async () => {
  await closeGraph()
})

// PORTED: fuzzy-merge.test.ts "a japanese title that shares only its year does not weld two shows".
// Normalizing to [a-z0-9] erased ani.zip's "転生したらスライムだった件 (2026)" to the literal "2026",
// which was equal to every other show airing that year.
// Mutation: make `stripTitle` ascii-only and the two clusters share the key "1901" and weld.
test('a japanese title that shares only its year does not weld two shows', async () => {
  expect(await clusterOf('anilist:182205')).toEqual(['anilist:182205', 'anizip:18884'])
  expect(await welded('anilist:182205', 'anilist:205116')).toBe(false)
})

// PORTED: "two sources that agree on the same japanese title still merge". Dropping non-latin titles
// also stops the weld above, and silently costs every merge two sources reach by agreeing on the
// japanese title, which is the one they agree on most often.
// MUTATED: drop the CJK branch of the title loop (compare `titles.filter(ascii)`) and this goes red.
test('two sources that agree on the same japanese title still merge', async () => {
  expect(await clusterOf('anilist:1000')).toEqual(['anilist:1000', 'anizip:1001'])
  const [link] = await titleLinks('anilist:1000')
  expect(link).toMatchObject({
    pair: 'anilist:1000 anizip:1001', kind: 'SAME_AS', status: 'active', reason: 'exact', confidence: 1,
  })
  expect(link!.evidence).toEqual({
    titleA: '転生したらスライムだった件 第4期', titleB: '転生したらスライムだった件 第4期',
    similarity: 1, year: 1902, daysDelta: 0,
  })
  expect(link!.supports, 'the two HAS_KEY keys').toEqual(['転生したらスライムだった件 第4期'])
})

// PORTED: "two sources that agree on the same latin title still merge".
test('two sources that agree on the same latin title still merge', async () => {
  expect(await clusterOf('anilist:2000')).toEqual(['anilist:2000', 'kitsu:2001'])
})

// PORTED: "a bare number title is not an identity". `第2期` and `第2クール` both leave "2" behind, so
// it was the busiest key of all: 60 shows, among them Dandadan, Frieren and Kusuriya no Hitorigoto.
// Mutation: drop `plugin:profile`'s HAS_LETTER test and both clusters carry the key "2" and weld.
// The key is asserted as well as the outcome, so a fixture that stopped producing a bare number
// could not make this pass by accident.
test('a bare number title is not an identity', async () => {
  expect((await profileOf('anilist:3000')).titles).toEqual(['mato seihei no slave 2'])
  expect(await welded('anilist:3000', 'anilist:3001')).toBe(false)
  expect(await titleLinks('anilist:3000')).toEqual([])
})

// PORTED: "two seasons of one show do not merge on a shared alias", and the half the old pass could
// not have: the refusal is a ROW, with the gate that refused it named on it (5.2 G5).
// MUTATED: make the season gate return 'passed' when the two sets are disjoint and the two weld.
test('two seasons of one show do not merge on a shared alias, and the refusal is a row', async () => {
  expect(await welded('anilist:4000', 'anilist:4001')).toBe(false)
  const [link] = await titleLinks('anilist:4000')
  expect(link).toMatchObject({
    pair: 'anilist:4000 anilist:4001', kind: 'SAME_AS', status: 'refused', reason: 'season',
  })
  expect(link!.gates, 'every gate is recorded, not only the one that refused')
    .toEqual({ format: 'passed', season: 'refused', date: 'passed', companion: 'passed' })
  expect(link!.evidence).toMatchObject({ titleA: 'tensura', titleB: 'tensura', similarity: 1 })
})

// PORTED: "the same season spelled two ways still merges". `第4期` and `Season 4` are the same claim.
test('the same season spelled two ways still merges', async () => {
  expect(await clusterOf('anilist:4100')).toEqual(['anilist:4100', 'anizip:4101'])
  const [link] = await titleLinks('anilist:4100')
  expect(link!.gates).toMatchObject({ season: 'passed' })
})

// PORTED: "a bare trailing number is compared as a value". A bare trailing number is not a season
// (284 of 4159 real titles end in one), so the season gate cannot see this pair: the title gate skips
// it before the wasm call, which is what `differOnlyByTrailingNumber` is for.
//
// THE SECOND PAIR IS WHAT MAKES THE SKIP LOAD BEARING, and the first alone would not have proven it.
// Measured on frizbee here, 2026-09-12: "yami shibai 16" against "17" scores 0.8849 and the THRESHOLD
// refuses it with the skip gone, so that pair cannot tell the rule from the number. A longer stem
// moves the same one-digit difference above the line: "the eminence in shadow 2" against "3" scores
// 0.9214, which is the population the rule exists for.
// MUTATED: drop the `differOnlyByTrailingNumber` skip and the Eminence pair welds.
test('a bare trailing number is compared as a value', async () => {
  expect(await welded('anilist:4200', 'anilist:4201')).toBe(false)
  expect(await titleLinks('anilist:4200'), 'a pair the title gate never matched leaves no row').toEqual([])
  expect(await welded('anilist:5400', 'kitsu:5401'), 'and one that scores 0.9214, above the threshold').toBe(false)
})

// PORTED: "punctuation differences still merge". The guard above must not cost the merges the pass
// exists for: punctuation is the normalizer's job and is still free.
test('punctuation differences still merge', async () => {
  expect(await clusterOf('anilist:4300')).toEqual(['anilist:4300', 'mal:4301'])
})

// PORTED: "a title that is only a season label does not weld two shows". Crunchyroll names most
// seasons by their position alone, so two unrelated shows on their third season hold an IDENTICAL
// title and merge on the exact shortcut, no similarity needed.
// Mutation: drop `isOnlySeasonLabel` from `plugin:profile`'s key rule and the two cr rows share the
// key "season 3", which welds Grand Blue Dreaming into Mushoku Tensei.
test('a title that is only a season label does not weld two shows', async () => {
  expect(await clusterOf('anilist:199111')).toEqual(['anilist:199111', 'cr:GNVHKN94W'])
  expect((await profileOf('cr:GNVHKN94W')).titles, 'the label is not a key, so the cluster keeps one title')
    .toEqual(['grand blue dreaming season 3'])
  expect(await welded('anilist:199111', 'anilist:178789')).toBe(false)
  expect(await welded('cr:GNVHKN94W', 'cr:G24H1N3MP')).toBe(false)
})

test('the other season-only labels are refused too', async () => {
  expect(await clusterOf('anilist:4400')).toEqual(['anilist:4400', 'cr:AAA'])
  expect(await welded('cr:AAA', 'cr:BBB')).toBe(false)
})

// PORTED: "a work does not weld to its own companion entry". The class the date axis cannot reach: a
// work and its own companion entry share a year, often a DAY, and the native title unchanged.
// MUTATED: drop the marker half of the gate and the two OVA clusters weld.
test('a work does not weld to its own companion entry', async () => {
  expect(await clusterOf('anilist:5000')).toEqual(['anilist:5000', 'kitsu:5001'])
  expect(await welded('anilist:5000', 'anilist:5002')).toBe(false)
  const refused = (await titleLinks('anilist:5000')).filter(link => link.status === 'refused')
  expect(refused[0]).toMatchObject({ reason: 'companion', kind: 'SAME_AS' })
  expect(refused[0]!.gates).toEqual({ format: 'silent', season: 'silent', date: 'passed', companion: 'refused' })

  // and the half that makes it TWO signals: the type disagreement alone is mostly noise, since
  // anilist and kitsu type one anime differently often enough to destroy 547 correct merges
  expect(await clusterOf('anilist:5300')).toEqual(['anilist:5300', 'kitsu:5301'])
  expect((await titleLinks('anilist:5300'))[0]!.gates, 'disagreeing types, no marker, no refusal')
    .toMatchObject({ companion: 'passed' })
})

// PORTED: "one catalogue appending OVA to its own title still merges". The marker alone destroys 136
// correct merges over the corpus against the 2 the pair of signals costs, which is why the type
// disagreement is required.
test('one catalogue appending OVA to its own title still merges', async () => {
  expect(await clusterOf('anilist:5100')).toEqual(['anilist:5100', 'kitsu:5101'])
})

// PORTED: "a streaming cluster still attaches to a cluster whose title carries a marker". A streaming
// catalogue fills no `type`, so silence never blocks and the attach the pass exists for survives.
// This is also the SILENT half of two gates at once, read off the row.
test('a streaming cluster still attaches to a cluster whose title carries a marker', async () => {
  expect(await clusterOf('anilist:5200')).toEqual(['anilist:5200', 'jw:tskeijo', 'kitsu:5201'])
  const [link] = (await titleLinks('jw:tskeijo')).filter(row => row.kind === 'SAME_AS')
  expect(link!.gates, 'no format, no work kind and no day: three silences and an attach')
    .toEqual({ format: 'silent', season: 'silent', date: 'silent', companion: 'silent' })
})

// PORTED: "the merge outcome does not depend on the order the medias arrived in". Every ordering here
// is one an extractor response can produce. Measured before the fix in the old pass: the order
// [mal, mal, anizip] left ani.zip's two titles at positions 7 and 8 of the tied block, both were
// sliced off, and the only comparisons left for "mushoku tensei" had an upper bound of 0.389.
// Each permutation carries its own YEAR, so no two of them are ever compared with each other.
// MUTATED: drop the `ORDER BY` from the member scan AND take the six in arrival order, which is the
// pair of things that lets the network choose a title. Either alone is not enough, and that is the
// plugin's own answer to the bug: an ordered scan means arrival order has nowhere to enter.
test('the merge outcome does not depend on the order the medias arrived in', async () => {
  const outcomes = new Set<string>()
  for (let permutation = 0; permutation < PERMUTATIONS; permutation += 1) {
    const members = await clusterOf(`jw:tsmushokutensei-p${permutation}`)
    outcomes.add(members.map(uri => uri.replace(/-p\d+$/, '')).sort().join(' '))
  }
  expect([...outcomes]).toEqual(['anizip:15669 jw:tsmushokutensei kitsu:45576 mal:39535'])
})

// PORTED: "the profile of a cluster is a function of its titles, not of their order". The cap has to
// fall on the SET of titles, so the same six survive whichever member renders them first.
// MUTATED: drop the sort in `orderWithinTier` and the shuffled profiles disagree with the first one.
test('the profile of a cluster is a function of its titles, not of their order', async () => {
  const random = mulberry32(4159)
  const rows = await rowsOf(MEMBER_SCAN) as unknown as TitleMemberRow[]
  const cluster = (await profileOf('mal:39535-p0')).id
  const expected = profileClusters(rows.filter(row => row.cluster === cluster)).get(cluster)!

  for (let permutation = 0; permutation < 50; permutation += 1) {
    const profile = profileClusters(shuffle(rows.filter(row => row.cluster === cluster), random)).get(cluster)!
    expect(profile.titles).toEqual(expected.titles)
    expect(profile.cacheKey).toEqual(expected.cacheKey)
  }

  // and the six keep the SHORT name of each script, which is the name a catalogue lists the show
  // under and the one JustWatch's 0.2 title has to meet
  expect(expected.titles).toContain('mushoku tensei')
  expect(expected.titles).toContain('無職転生')
})

// PORTED: "a verdict is applied only if the two components still agree when it lands". The old pass
// took a snapshot before its first await and re-read both components before applying a verdict. Here
// there is no snapshot to go stale: the pass iterates to a fixed point and the gates read the
// clusters as they stand, so ani.zip carrying the second cour is what the season gate sees.
// Mutation: read the ordinals off one member rather than off every member of the cluster.
test('a verdict is weighed against the clusters as they stand', async () => {
  expect(await clusterOf('anizip:20001')).toEqual(['anizip:20001', 'mal:20002'])
  expect(await clusterOf('cr:GRQ8VE29Y-s1')).toEqual(['cr:GRQ8VE29Y-s1'])
  const [link] = await titleLinks('cr:GRQ8VE29Y-s1')
  expect(link).toMatchObject({ status: 'refused', reason: 'season' })
})

// PORTED: "a run and a container that agree on title and year hang on an edge, never a union". The
// verdict is the same whatever the scopes are; what it is ALLOWED to do is not, and that is the
// writer's call rather than this plugin's: it proposes `SAME_AS` and guard 2 downgrades it.
// MUTATED: emit the pair as `PART_OF` from the plugin and the refused `SAME_AS` row disappears, so
// the trace loses the verdict that produced the badge.
test('a run and a container that agree on title and year hang on an edge, never a union', async () => {
  expect(await clusterOf('anilist:7000'), 'the run cluster is unchanged').toEqual(['anilist:7000'])
  expect(await clusterOf('tvmaze:7001')).toEqual(['tvmaze:7001'])
  const links = await titleLinks('anilist:7000')
  expect(links.map(link => `${link.pair} ${link.kind} ${link.status} ${link.reason}`)).toEqual([
    'anilist:7000 tvmaze:7001 PART_OF active cross-scope',
    'anilist:7000 tvmaze:7001 SAME_AS refused cross-scope',
  ])
  expect(links.find(link => link.kind === 'SAME_AS')!.gates, 'the gates the pair passed are still on the row')
    .toEqual({ format: 'passed', season: 'silent', date: 'passed', companion: 'passed' })
  expect(links.find(link => link.kind === 'PART_OF')!.gates, 'the downgrade is the writer\'s row and carries none')
    .toBeNull()
})

test('two containers that agree on title and year union in the container space', async () => {
  expect(await clusterOf('tmdb:7100')).toEqual(['tmdb:7100', 'tvmaze:7101'])
})

// PORTED: "a mixed cluster keyed by its container member still unions with a run". The MECHANISM has
// moved: guard 2 refuses a cross-scope `SAME_AS` outright, so the claim that made the mixed cluster
// is a containment edge and the cluster is no longer mixed. What must still hold is the verdict the
// old case was written for: the two runs find each other.
test('a cluster whose member flipped CONTAINER still unions with a run', async () => {
  expect(await clusterOf('kitsu:7301')).toEqual(['kitsu:7301', 'mal:7302'])
  expect(await welded('kitsu:7301', 'cr:7300'), 'the container rides an edge, never the cluster').toBe(false)
})

// the control, or the two above are indistinguishable from a pass that links nothing
test('control: two runs that agree on title and year still union', async () => {
  expect(await clusterOf('anilist:7200')).toEqual(['anilist:7200', 'kitsu:7201'])
})

// PORTED: "a short profiles for the merge exactly as the TV it used to be spelled". An EMPTY work
// kind set is the dangerous half, because the companion gate only fires when both sides name one, so
// a short profiling as nothing would stop vetoing anything, and the gates record says which it is.
// MUTATED: drop `mergeType`'s TV_SHORT fold and the companion gate reads `silent` here.
test('a short profiles for the merge exactly as the TV it used to be spelled', async () => {
  const profile = await profileOf('anilist:9210')
  expect([...profile.workKinds]).toEqual(['TV'])
  expect([...profile.formats]).toEqual(['SERIES'])
  expect(await clusterOf('anilist:9210')).toEqual(['anilist:9210', 'kitsu:9211'])
  const [link] = await titleLinks('anilist:9210')
  expect(link!.gates, 'both sides name a work kind, so the gate has something to say')
    .toMatchObject({ companion: 'passed', format: 'passed' })
})

// THE FORMAT GATE, both halves. Refused when both sides name a format and they are disjoint, silent
// when either names none, which is every streaming catalogue.
// MUTATED: return 'silent' for a disjoint pair and the MOVIE welds to the SERIES.
test('the format gate refuses a disjoint pair and is silent when one side names none', async () => {
  expect(await welded('anilist:9220', 'anilist:9221')).toBe(false)
  const [link] = await titleLinks('anilist:9220')
  expect(link).toMatchObject({ status: 'refused', reason: 'format' })
  expect(link!.gates).toEqual({ format: 'refused', season: 'silent', date: 'passed', companion: 'passed' })
  const [silent] = (await titleLinks('jw:tskeijo')).filter(row => row.kind === 'SAME_AS')
  expect(silent!.gates!.format).toBe('silent')
})

// THE DATE GATE, both halves. 181 days apart inside one year is the owner's own case, and the silent
// half is the catalogue that only knows the year: `${year}-01-01` is a coercion seven extractors
// template, so `startDay` drops it and the gate has nothing to read.
// MUTATED: widen the window to 365 and the two Date Probes weld.
test('the date gate refuses beyond 45 days and is silent when one side names no day', async () => {
  expect(await welded('anilist:9230', 'anilist:9231')).toBe(false)
  const [link] = await titleLinks('anilist:9230')
  expect(link).toMatchObject({ status: 'refused', reason: 'date' })
  expect(link!.gates!.date).toBe('refused')
  expect(link!.evidence).toMatchObject({ daysDelta: 181 })
  const [silent] = await titleLinks('anilist:8601')
  expect(silent!.gates!.date, 'a year-only side has no day, so the gate says nothing').toBe('silent')
  expect(silent!.evidence).toMatchObject({ daysDelta: null })
})

// THE YEAR BUCKET, gate 0, and the control that proves the rig can see a weld for this exact title.
// Two clusters holding the SAME key are never compared across two years, and a cluster that names no
// year at all is never bucketed, so it is never compared with anything.
// MUTATED: bucket on nothing (compare every pair of clusters) and both halves weld.
test('the year bucket never compares two years, and never buckets a cluster with no year', async () => {
  expect(await welded('anilist:9240', 'anilist:9250'), 'one year apart, same title').toBe(false)
  expect(await welded('anilist:9270', 'kitsu:9271'), 'no year at all on one side').toBe(false)
  expect(await clusterOf('anilist:9260'), 'the control: the same title inside ONE year')
    .toEqual(['anilist:9260', 'kitsu:9261'])
})

// THE ORDINAL AXIS, the one candidate route that does NOT go through a year bucket, and the whole of
// what it is for: a show container's date is its FIRST run's, so the 1930 container and the 1933 run
// share no bucket and are 1095 days apart, which is every stop the shipped pass has. The run names
// its own show by dropping its season marker and reaches it.
// MUTATED: delete the `containerByKey` loop that seeds `ordinalPairs` and the pair is gone, the
// `PART_OF` with it. Take the year-bucket loop away instead and this case is unchanged, which is what
// says the axis and not the bucket is what carried it.
test('a later run reaches its show container across two year buckets', async () => {
  const links = await titleLinks('anilist:8310')
  expect(links.map(link => [link.pair, link.kind, link.status, link.reason])).toEqual([
    ['anilist:8310 jw:ordinalprobe', 'PART_OF', 'active', 'cross-scope'],
    ['anilist:8310 jw:ordinalprobe', 'SAME_AS', 'refused', 'cross-scope'],
  ])
  expect(await welded('anilist:8310', 'jw:ordinalprobe'), 'an edge, never a union').toBe(false)
  const [, refused] = links
  expect(refused!.gates, 'the container names no ordinal, and its date is about a different run')
    .toEqual({ format: 'passed', season: 'silent', date: 'silent', companion: 'passed' })
  expect(refused!.supports, 'both keys are real TitleKey rows, so a trace descends to them')
    .toEqual(['ordinal probe', 'ordinal probe season 2'])
  const profile = await profileOf('anilist:8310')
  expect([...profile.containerKeys]).toEqual(['ordinal probe'])
  expect(profile.laterRun).toBe(true)
})

// THE DATE GATE'S PREMISE, which is the second half of the same cause. 181 days apart inside ONE year
// is exactly the distance the two Date Probes above are refused on; between a show and its second
// season the two dates are about two DIFFERENT runs, so the gate is silent rather than lenient.
// MUTATED: drop `!laterRunAgainstContainer(a, b)` from gate 3 and this reads `date: 'refused'` with
// no `PART_OF` at all, which is the state this whole slice started from.
test('the date gate is silent between a show and a run that says it is not the first', async () => {
  const links = await titleLinks('anilist:8330')
  expect(links.map(link => [link.kind, link.status, link.reason])).toEqual([
    ['PART_OF', 'active', 'cross-scope'], ['SAME_AS', 'refused', 'cross-scope'],
  ])
  expect(links[1]!.gates!.date).toBe('silent')
  expect(links[1]!.evidence, 'the guard\'s evidence replaces the proposal\'s on a downgrade')
    .toEqual({ theirs: 'CONTAINER', ours: 'RUN' })
})

// AND IT IS NARROW: a FIRST run against its own show is two readings of ONE run's premiere, so the 45
// days still mean what they were measured to mean and still refuse. Same 181 days, same shape, and
// the only difference is the ordinal the run declares.
// MUTATED: make gate 3 silent for every run-against-container pair rather than for a later run and
// this goes green with a `PART_OF`, which is the widening this change deliberately is not.
test('a first run against its show still meets the 45 day window', async () => {
  const links = await titleLinks('anilist:8350')
  expect(links.map(link => [link.kind, link.status, link.reason])).toEqual([['SAME_AS', 'refused', 'date']])
  expect(links[0]!.gates!.date).toBe('refused')
  expect(links[0]!.evidence).toMatchObject({ daysDelta: 181 })
  expect((await profileOf('anilist:8350')).laterRun, 'it declares no ordinal').toBe(false)
})

test('two films of one title and year months apart stay two', async () => {
  expect(await welded('anilist:9410', 'jw:filmprobe')).toBe(false)
  const [link] = await titleLinks('anilist:9410')
  expect(link).toMatchObject({ status: 'refused', reason: 'date', evidence: { daysDelta: 181 } })
})

// WHAT THE AXIS IS WORTH is a number that has to mean pairs NOTHING ELSE WAS MAKING, because a run
// routinely shares a year bucket with the very container it names and the bucket pass has already
// paired those. It is also the axis's ONLY audit surface: a run against a container is guard 2's
// `cross-scope` every time, and the downgrade replaces the proposal's evidence with the guard's, so
// no `via: 'ordinal'` ever reaches the link table to be counted there.
// The expectation is recomputed from the profiles rather than written as a literal, so a fixture
// added later moves both sides together instead of turning this red for an unrelated reason.
// MUTATED: count every proposal rather than the ones `pairs` did not already hold, and the reported
// figure rises above the recomputed one, which is the axis taking credit for the bucket pass's work.
test('the ordinal axis reports the pairs it ADDS, not the ones it proposes', async () => {
  const profiles = await profilesNow()
  const containers = [...profiles.values()].filter(profile => profile.scope === 'CONTAINER')
  const disjointYears = (a: Set<number>, b: Set<number>) => ![...a].some(year => b.has(year))
  const added = new Set<string>()
  let proposed = 0
  for (const profile of profiles.values()) {
    for (const key of profile.containerKeys) {
      for (const container of containers) {
        if (container.id === profile.id || !container.keys.has(key)) continue
        proposed += 1
        // `pairs` holds only the year buckets when the axis runs, so "added" is "shares no year"
        if (disjointYears(profile.years, container.years)) added.add([profile.id, container.id].sort().join(' '))
      }
    }
  }
  expect(added.size, 'the axis has to be adding something, or this asserts nothing').toBeGreaterThan(0)
  expect(proposed, 'and some of what it proposes the bucket pass already had').toBeGreaterThan(added.size)

  const pass = await runPass()
  const detail = pass.logs.find(event => event.rule === 'title-scan')!.detail
  expect(detail).toContain(`${added.size} through the ordinal axis`)
})

// AND THE PREMISE IS ABOUT THE PAIR, not about the run. "A container's start day is its first run's
// premiere" is a fact about THE CONTAINER THE RUN BELONGS TO and says nothing about one it merely
// shares a year with, so the run has to NAME the container for the gate to have lost its footing.
// Keyed on the run alone, a cluster declaring a second season had the 45 days lifted against every
// container the fuzzy pass could reach it, and one ordinal on a title neither gate reads was the
// whole difference between a refusal and a weld.
// MUTATED: drop `&& names(a, b)` from both arms of `laterRunAgainstContainer` and this reads
// `PART_OF active cross-scope` with `date: 'silent'`, an unrelated show attached to a season page.
test('gate 3 is silent only against the container the run actually names', async () => {
  const links = await titleLinks('anilist:9451')
  expect(links.map(link => [link.kind, link.status, link.reason])).toEqual([['SAME_AS', 'refused', 'date']])
  expect(links[0]!.gates!.date).toBe('refused')
  expect(links[0]!.evidence).toMatchObject({ daysDelta: 182 })

  // the two halves of the premise, side by side: BOTH clusters say they are a later run, and only one
  // of them says it about the show it is being compared with
  const unrelated = await profileOf('anilist:9451')
  expect([unrelated.laterRun, [...unrelated.containerKeys]]).toEqual([true, ['totally other show']])
  const named = await profileOf('anilist:8330')
  expect([named.laterRun, [...named.containerKeys]]).toEqual([true, ['ordinal same']])
})

// THE AXIS IS A RULE ABOUT A KEY, never about the cluster the key sits in, and that is what keeps a
// remake out: `anilist:8370` declares season 3 on one title and carries the container's exact name on
// another, which loses no marker and therefore names nothing. Two years apart, they stay apart.
// MUTATED: build `containerKeys` from every key of a cluster whose `laterRun` is true, which is the
// obvious cluster-shaped spelling, and 'Ordinal Elsewhere' attaches to a show it never named.
test('a key that loses no season marker names no container, whatever its cluster declares', async () => {
  expect(await titleLinks('anilist:8370')).toEqual([])
  const profile = await profileOf('anilist:8370')
  expect(profile.laterRun, 'the cluster does declare a third season').toBe(true)
  expect([...profile.containerKeys], 'and names only the show THAT title belongs to').toEqual(['ordinal mixed'])
})

// WHAT THE ROUTE PUTS ON THE PROPOSAL, which is more than survives onto the row: a run against a
// container is guard 2's `cross-scope` every time, so the writer replaces the reason and the evidence
// with the guard's. `proposalFor` is where the route is readable, and this is the only case that
// reads it.
// MUTATED: drop `via` from `ordinalMatch`'s return and the reason falls back to 'similar' with a
// confidence of 1, which reads as a 1.0 alignment and is not one.
test('an ordinal match proposes reason ordinal at confidence 1', async () => {
  const profiles = await profilesNow()
  const [run] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri: 'anilist:8310' })
  const [container] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri: 'jw:ordinalprobe' })
  const first = profiles.get(String(run!.id))!
  const second = profiles.get(String(container!.id))!
  const decision = await decide(first, second, {
    titleSimilarity: async () => 0, maxPossibleSimilarity: () => 0,
  }, createDecisionCache(8))
  expect(decision.match).toEqual({
    titleA: 'ordinal probe season 2', titleB: 'ordinal probe', similarity: 1, exact: false, via: 'ordinal',
  })
  const proposal = proposalFor(first, second, decision)!
  expect([proposal.kind, proposal.reason, proposal.confidence]).toEqual(['SAME_AS', 'ordinal', 1])
  expect(proposal.evidence).toMatchObject({ via: 'ordinal' })
  expect(orderPair(second, first)[0]!.scope, 'the run is named first whichever side the scan reached')
    .toBe('RUN')
})

// THE THREE CONDITIONS of `containerKeyOf`, each stated on a key and each measured over the manami
// database in `scripts/calibrate-container-ordinal.test.ts`.
// MUTATED, the three separately, because one key can only ever reach one of them: drop the ordinal
// floor and 'yofukashi no uta season 1' starts naming a container the year bucket already pairs; drop
// the `stripped === key` refusal and '無職転生 2期' names ITSELF, because `SEASON_MARKER` deliberately
// declines to delete a bare `N期` that carries no 第 and a key that loses nothing is a key with no
// marker in it; drop the emptiness refusal and 'season 2' names the container '' that every
// season-labelled row in the graph would then share.
test('a container key needs an ordinal of two, a marker that comes off, and something left', () => {
  expect(containerKeyOf('mushoku tensei jobless reincarnation season 2')).toBe('mushoku tensei jobless reincarnation')
  expect(containerKeyOf('mushoku tensei jobless reincarnation season 2 part 2'), 'both markers, one pass')
    .toBe('mushoku tensei jobless reincarnation')
  expect(containerKeyOf('無職転生 異世界行ったら本気だす 第2期')).toBe('無職転生 異世界行ったら本気だす')
  expect(containerKeyOf('fruits basket'), 'no ordinal to read').toBeUndefined()
  expect(containerKeyOf('yofukashi no uta season 1'), 'the show\'s own first run').toBeUndefined()
  // the ordinal is READ off `N期` and `N기` and the marker is NOT removed from either, which is the
  // one shape where the second condition is the only thing standing between a key and itself
  expect(parseSeasonNumber('無職転生 2期'), 'the ordinal really is read').toBe(2)
  expect(containerKeyOf('無職転生 2期'), 'and nothing comes off, so it names no show').toBeUndefined()
  expect(containerKeyOf('무직전생 2기')).toBeUndefined()
  expect(containerKeyOf('season 2'), 'nothing but a position').toBeUndefined()
})

// THE CAP, read off the profile and proven by what it costs: seven titles tie at 0.9, the tier is
// ordered by the title, and the seventh is the one that goes. A partner holding only the dropped
// title does not match; a partner holding one of the six does, which is the same shape as JustWatch
// attaching to Mushoku Tensei through ani.zip's short name.
// MUTATED twice: raise MAX_TITLES_PER_CLUSTER to 7 and `kitsu:9281` welds; take every key instead of
// `selectByScore`'s six and the same case goes red on the list.
test('the six keys are the six, in title-ascending order within a tier', async () => {
  const profile = await profileOf('anilist:9280')
  expect(profile.titles).toEqual([
    'cap alpha', 'cap bravo', 'cap charlie', 'cap delta', 'cap echo', 'cap foxtrot',
  ])
  expect(await welded('anilist:9280', 'kitsu:9282'), 'a title among the six matches').toBe(true)
  expect(await welded('anilist:9280', 'kitsu:9281'), 'the seventh title is not there to match').toBe(false)
})

// THE EXACT-KEY JOIN of 5.4 P3, asked directly. It is a strict subset of the year buckets on a full
// pass, which is what makes it a CONTROL rather than a second opinion: it must find the pair the
// similarity scan finds, and must never reach across two year buckets.
// MUTATED: drop the year equality from the statement and the 1924 against 1925 pair appears.
test('the exact-key join finds a pair inside one bucket and never one across two', async () => {
  const clusters = [...(await profilesNow()).keys()].sort()
  const rows = await rowsOf(EXACT_SCAN, { clusters })
  const pairs = new Set(rows.map(row => `${String(row.fromCluster)} ${String(row.toCluster)} ${String(row.shared)}`))

  // the control is a pair that SHARES an exact key and stays two clusters, since a pair that welds is
  // one cluster by the time the scan runs and no join can find it twice: the two Slime seasons the
  // season gate refused hold "tensura" on both sides
  const control = await profileOf('anilist:4000')
  const partner = await profileOf('anilist:4001')
  expect(
    pairs.has(`${control.id} ${partner.id} tensura`) || pairs.has(`${partner.id} ${control.id} tensura`),
    'the pair the similarity scan also found, and refused on the season'
  ).toBe(true)
  expect((await titleLinks('anilist:4000'))[0], 'the similarity scan weighed the same pair')
    .toMatchObject({ status: 'refused', reason: 'season' })

  const earlier = await profileOf('anilist:9240')
  const later = await profileOf('anilist:9250')
  expect(
    pairs.has(`${earlier.id} ${later.id} bucket probe`) || pairs.has(`${later.id} ${earlier.id} bucket probe`),
    'the same key one year apart'
  ).toBe(false)
})

// THE KNOWN GAP, pinned as the gap it is rather than hidden. Both silent-side vetoes only block on a
// DISAGREEMENT: "86" names no ordinal and carries a year-only date, so the season gate and the date
// gate both have nothing to say and the shared label welds it to "86 Part 2". Closing it is the rule
// already refused at one wrong weld stopped per 37 correct merges destroyed.
// If this case goes red, something closed the gap: read the cost before keeping it.
test('KNOWN GAP: a year-only silent side still welds to a part-2 cluster', async () => {
  expect(await welded('anilist:8601', 'kitsu:8602')).toBe(true)
  const [link] = await titleLinks('anilist:8601')
  expect(link).toMatchObject({ status: 'active', reason: 'exact' })
  expect(link!.gates).toEqual({ format: 'passed', season: 'silent', date: 'silent', companion: 'passed' })
})

// THE LRU, which is the one thing here that is NEW rather than moved (5.4 P3): the old cache CLEARED
// itself at 50,000, which threw away every verdict the next pass was about to ask for again.
// MUTATED: replace the eviction with `entries.clear()` and the two survivors below are gone.
test('the decision cache evicts one entry and never the whole map', () => {
  const cache = createDecisionCache(3)
  const decision = (year: number) => ({ gates: { format: 'silent', season: 'silent', date: 'silent', companion: 'silent' }, refusedBy: null, match: undefined, year, daysDelta: null } as const)
  cache.set('a', decision(1))
  cache.set('b', decision(2))
  cache.set('c', decision(3))
  // a hit on the oldest makes it the youngest, so the next eviction takes 'b' rather than 'a'
  expect(cache.get('a')?.year).toBe(1)
  cache.set('d', decision(4))

  expect(cache.size).toBe(3)
  expect(cache.get('b'), 'the least recently used entry, and the only one evicted').toBeUndefined()
  expect(cache.get('a')?.year).toBe(1)
  expect(cache.get('c')?.year).toBe(3)
  expect(cache.get('d')?.year).toBe(4)
})

// IDEMPOTENCE, which is the contract rather than the plugin's discipline. It is sharper here than for
// any earlier plugin: an active title link has already been SPENT on a merge, so its pair is one
// cluster by the next iteration and cannot be re-derived. Without the sticky re-proposal the writer
// deletes it, `plugin:aggregate` splits the cluster, the pair reappears and the pass oscillates.
// MUTATED: drop the carry scan and the WHOLE FILE goes red, in `beforeAll`, on a `fixed-point-cap`
// anomaly: the pass really does oscillate, link deleted and re-created until the cap of four.
test('a second pass over the same graph writes nothing', async () => {
  const again = await runPass()
  expect(again.changes).toEqual([])
})

// A REAL RECORDED PAGE, the only case here that meets shapes nobody chose. It reports its histogram
// rather than asserting a threshold on it: a number pinned to one walk fails on the next walk rather
// than on the next bug. What IS asserted is what must hold whatever the page contains: the four
// invariants of 3.5, the audit, and a second pass that writes nothing.
test('the first 800 corpus rows replay through profile, direct, aggregate and title', async () => {
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
  expect(rows.length, 'a recorded page is about 800 rows (2026-09-12)').toBeGreaterThan(100)

  // the fixtures above are already in the graph, so every number below is reported as a DELTA
  const baseline = await histogramOf()
  const cacheBefore = titleDecisions.size

  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])

  const started = Date.now()
  const pass = await runPass()
  const passMs = Date.now() - started

  const { query } = await graphReady()
  const invariants = await checkInvariants(query)
  expect(invariants.counts, 'the four queries of 3.5').toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })

  const histogram = await histogramOf()
  const [clusters] = await rowsOf('MATCH (c:Cluster) RETURN count(c) AS total')
  console.info('plugin:title over 800 corpus rows:', JSON.stringify({
    clusters: Number(clusters!.total),
    links: [...histogram].map(([key, total]) => `${key}: ${total - (baseline.get(key) ?? 0)} of ${total}`),
    scan: pass.logs.filter(event => event.rule === 'title-scan').map(event => event.detail),
    cache: `${cacheBefore} entries before, ${titleDecisions.size} after`,
    titleMs: pass.runs.filter(run => run.id === 'plugin:title').map(run => run.ms),
    iterations: pass.iterations,
    passMs,
    auditMs: pass.audit.ms,
  }, null, 2))

  const again = await runPass()
  expect(again.changes, 'the same page twice is the same links').toEqual([])
  console.info(`the second pass over the same graph: ${again.ms} ms, ${again.iterations} iteration(s), nothing written`)
}, 600_000)
