// HOR-1189. JustWatch titles Kaiju No. 8 season 2's episode 1 with the special Hoshina's Day Off and every later one
// with the title of the episode before it, but its numbers, days and offers are the episode's own: Prime Video's season
// page (2026-11-01) names the offer JustWatch hangs under 1, gti 026713b1, its "第13話 怪獣兵器" (Kaiju Weapon), and so
// on to 3e7d49ba, "第23話 第2波" (Second Wave), under 11. So the list joins by number, and pairing it by its titles
// put each Prime Video link on the row before its episode. The answers are the page's own (2026-10-31), the six that
// describe the run. The page joined JustWatch through its ask, which the answer log does not keep, so that claim is
// written here.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../src/worker/graph/answers'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { replayAnswers, writeAskClaim } from '../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { rowsOf } from './plugins/fixtures'

const ANSWERS = JSON.parse(readFileSync(new URL('./plugins/__fixtures__/kaiju-no-8-season-2.answers.json', import.meta.url), 'utf-8')) as AnswerRow[]
const JUSTWATCH = 'jw:365566-507532'
// Prime Video's own episodes 1 to 11 of the season, in its order
const PRIME = ['026713b1', '1507c4b4', '1be10ecc', '75ab3487', '3a1e6b5b', '47adb562', 'a7ef573e', '155850c2', '4ecfc56a', 'c8327d99', '3e7d49ba']

type Listed = { uri: string, episodeNumber: number | null, titles?: { title: string }[] }
const listOf = (uri: string) => (JSON.parse(ANSWERS.find(row => row.uri === uri)!.raw) as { episodes: Listed[] }).episodes
const titleOf = new Map([...listOf('anizip:18722'), ...listOf(JUSTWATCH)].map(row => [row.uri, row.titles?.[0]?.title]))

beforeAll(async () => {
  await enableGraph(true)
  await replayAnswers(ANSWERS)
  await writeAskClaim({
    fromUri: 'anilist:178754', toUri: JUSTWATCH, kind: 'SAME_AS', claimer: 'jw', targetScope: 'RUN',
    node: { uri: JUSTWATCH, origin: 'jw', id: '365566-507532', scope: 'RUN', titles: null },
  })
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

// Mutation: put back the first draft's title pairing (`namedElsewhere` in `plugin:range`, `listsApart` in
// `plugin:aggregate`) and rows 1 to 10 open Prime Video's next episode, row 11 none.
test('each row opens the Prime Video episode JustWatch lists under its number, not under its title', async () => {
  const [cluster] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.episodes AS episodes', { uri: JUSTWATCH })
  const drawn = (JSON.parse(String(cluster!.episodes)) as { episodeNumber: number | null, handles: { node: { uri: string } }[] }[])
    .map(row => ({ number: row.episodeNumber, uris: row.handles.map(handle => handle.node.uri) }))
  const rows = drawn.filter(row => row.number !== null)
  const on = (origin: string) => rows.map(row => row.uris.filter(uri => uri.startsWith(`${origin}:`)))
  expect(rows.map(row => row.number)).toEqual(Array.from({ length: 11 }, (_, index) => index + 1))
  expect(drawn.filter(row => row.number === null).flatMap(row => row.uris.filter(uri => /^(jw|amazon):/.test(uri)))).toEqual([])
  expect(on('amazon').map(uris => uris.map(uri => uri.split('.').pop()!.slice(0, 8)))).toEqual(PRIME.map(id => [id]))

  // the control on the data itself: JustWatch's own title on each row is the title of the row before
  const titled = (origin: string) => on(origin).map(uris => titleOf.get(uris[0]!))
  expect(titled('jw')).toEqual(['Hoshina\'s Day Off', ...titled('anizip').slice(0, 10)])
})
