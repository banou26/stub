// "star wars" and "the lion king" as JustWatch and Simkl answered their searches through the relay on
// 2026-10-13, and The Lion King 1½ on 2026-10-15, trimmed to the films (and JustWatch's offers dropped).
// Simkl's search rows are built from each film's detail, whose `released` day is JustWatch's own for eight
// of the nine films. The Lion King 1½ is 2004-02-10 on Simkl, its US video release, and 2004-10-28 on
// JustWatch, its one theatrical release, so its release dates are kept, cut to those two. Simkl answers
// last, since its rows wait on those detail reads.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import * as justwatch from '../../../../src/sources/justwatch/extractor'
import * as simkl from '../../../../src/sources/simkl/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import JUSTWATCH_LION_KING from '../../../fixtures/justwatch/the-lion-king-search.json'
import JUSTWATCH_STAR_WARS from '../../../fixtures/justwatch/star-wars-search-films.json'
import SIMKL_LION_KING from '../../../fixtures/simkl/search-the-lion-king.json'
import SIMKL_STAR_WARS from '../../../fixtures/simkl/search-star-wars.json'
import { answer } from './plugins/fixtures'

type Recorded = { search: Record<string, unknown>, detail: Record<string, unknown> }

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

const justwatchAnswers = (body: unknown) => async () => respond(body)

const simklAnswers = (recorded: Recorded) => async (url: string, init?: { body?: string }) => {
  const { origin, pathname } = new URL(url)
  if (origin === 'https://simkl.com') return respond(recorded.search[new URLSearchParams(init?.body).get('type')!])
  const detail = recorded.detail[pathname]
  if (!detail) throw new Error(`no recorded answer for ${url}`)
  return respond(detail)
}

const search = async (source: { resolvers: unknown }, fetch: unknown, query: string) => {
  const context = { request: new Request('http://d/graphql'), findAggregatedMedia: async () => null, listenForMediaChanges: async function* () {}, fetch }
  const { value } = await (source.resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: query } }, context).next()
  return value.mediaPage.nodes as { uri: string }[]
}

const ingest = async (rows: { uri: string }[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row as never, 'MEDIA_PAGE'))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => {
  await enableGraph(true)
  await ingest([
    ...await search(justwatch, justwatchAnswers(JUSTWATCH_STAR_WARS), 'star wars'),
    ...await search(justwatch, justwatchAnswers(JUSTWATCH_LION_KING), 'the lion king'),
  ])
  await ingest([
    ...await search(simkl, simklAnswers(SIMKL_STAR_WARS), 'star wars'),
    ...await search(simkl, simklAnswers(SIMKL_LION_KING), 'the lion king'),
  ])
}, 300_000)

afterAll(async () => { await closeGraph() })

const members = async (uri: string) => {
  const page = await resolveMedia(uri) as { handles: { relation: string, node: { uri: string } }[] } | undefined
  return page?.handles.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri).sort()
}

test('each Star Wars film Simkl lists is one card with JustWatch\'s', async () => {
  expect(await members('jw:4')).toEqual(['jw:4', 'simkl:55520'])
  expect(await members('jw:5')).toEqual(['jw:5', 'simkl:55522'])
  expect(await members('jw:6')).toEqual(['jw:6', 'simkl:55524'])
  expect(await members('jw:7')).toEqual(['jw:7', 'simkl:235018'])
  expect(await members('jw:8')).toEqual(['jw:8', 'simkl:274676'])
  expect(await members('jw:9')).toEqual(['jw:9', 'simkl:274680'])
})

test('a remake keeps its own card: each The Lion King joins the Simkl film of its own year', async () => {
  expect(await members('jw:113629')).toEqual(['jw:113629', 'simkl:61342'])
  expect(await members('jw:309655')).toEqual(['jw:309655', 'simkl:625300'])
})

test('a film Simkl dates by its video release joins its film by its theatrical one', async () => {
  expect(await members('jw:87748')).toEqual(['jw:87748', 'simkl:65784'])
})
