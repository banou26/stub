// Lupin's season 1 at its own address, as the page heard it (2026-11-02): TMDB lists the season's 10 chapters, JustWatch
// and Netflix each list Part 1's 5. JustWatch's count is the episodes out in its own season, which here is one part.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../src/worker/graph/answers'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { replayAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { rowsOf } from './plugins/fixtures'

const ANSWERS = JSON.parse(readFileSync(new URL('./plugins/__fixtures__/lupin-season-1.answers.json', import.meta.url), 'utf-8')) as AnswerRow[]

beforeAll(async () => {
  await enableGraph(true)
  await replayAnswers(ANSWERS)
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

// Mutation: put `jw` back in DECLARED_COUNT_ORIGINS and the season counts JustWatch's 5 again, over 10 rows.
test('a part JustWatch lists shorter than the season does not count the season: 10 episodes over 10 rows', async () => {
  const [cluster] = await rowsOf(
    `MATCH (m:Media {uri: 'tmdb:96677-s1'})-[:MEMBER_OF]->(c:Cluster)
     RETURN c.runLength AS runLength, c.runLengthFrom AS from, c.episodes AS episodes`
  )
  const members = await rowsOf(`MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE c.runLength IS NOT NULL RETURN m.uri AS uri ORDER BY uri`)
  // the control on the data: the three members heard, two of them listing Part 1 alone
  expect(members.map(row => row.uri)).toEqual(['jw:296046-304226', 'nf:80994082-1', 'tmdb:96677-s1'])
  const rows = (JSON.parse(String(cluster!.episodes)) as { episodeNumber: number | null }[]).map(row => row.episodeNumber)
  expect(rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(Number(cluster!.runLength)).toBe(10)
  expect(cluster!.from).toEqual(['tmdb:96677-s1'])
  expect((await resolveMedia('ag:(tmdb:96677-s1)') as unknown as { episodeCount: number | null }).episodeCount).toBe(10)
})

