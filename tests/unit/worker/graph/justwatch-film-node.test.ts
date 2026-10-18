// Penguin Highway's address names `jw:403680`, which is the film as JustWatch's `tm403680` and an unrelated show,
// The Numbers, as `ts403680` (2026-10-19). JustWatch picks the node by what the cluster reads as when it asks, and
// on 3 of 24 cold loads of the modal (2026-10-19) AniZip's row was the cluster's first and AniList's landed 22 to 119
// answers later: JustWatch then asked the show, answered nothing, and the film's hoopla, Plex and Tubi never showed.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { resolvers as anizip } from '../../../../src/sources/anizip/extractor'
import { resolvers as justwatch } from '../../../../src/sources/justwatch/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import ANIZIP from '../../../fixtures/anizip/penguin-highway.json'
import JUSTWATCH from '../../../fixtures/justwatch/penguin-highway.json'
import { answer, media, sameAs, title } from './plugins/fixtures'

const ADDRESS = 'ag:(anilist:101249,anizip:13853,hoopla:12418002,jw:403680,kitsu:41007,mal:37407,nf:81037598,offline:mal-37407,omdb:tt8076344,plex:5d77708f594b2b001e74d1ea,simkl:774239,tubi:590793,watchmode:01298472)'
const JW_API = 'https://apis.justwatch.com/graphql'

const ingest = async (rows: Record<string, unknown>[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

const anizipRow = async () => {
  const context = { fetch: async () => ({ json: async () => ANIZIP }) }
  const { value } = await (anizip.Subscription as any).media.subscribe(undefined, { input: { uri: ADDRESS } }, context).next()
  return JSON.parse(JSON.stringify(value.media))
}

// JustWatch as the worker asks it, reading the cluster through the graph
const askJustWatch = async () => {
  const asked: string[] = []
  const context = {
    findAggregatedMedia: (uri: string) => resolveMedia(uri),
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== JW_API) throw new Error(`no recorded answer for ${url}`)
      const { nodeId } = JSON.parse(init?.body ?? '{}').variables
      asked.push(nodeId)
      return { json: async () => ({ data: { node: (JUSTWATCH as Record<string, unknown>)[nodeId] ?? null } }) }
    },
  }
  const { value } = await (justwatch.Subscription as any).media.subscribe(undefined, { input: { uri: ADDRESS } }, context).next()
  const offers = (value.media?.handles ?? [])
    .filter((handle: { relation: string, provenance?: string }) => handle.relation === 'SAME_AS' && handle.provenance !== 'address')
    .map((handle: { node: { uri: string } }) => handle.node.uri)
    .sort()
  return { asked, uri: value.media?.uri ?? null, offers }
}

beforeAll(async () => { await enableGraph(true) }, 300_000)
afterAll(async () => { await closeGraph() })

test('JustWatch asks for the film when AniZip\'s row is the first to land', async () => {
  await ingest([await anizipRow()])
  expect(await askJustWatch()).toEqual({
    asked: ['tm403680'],
    uri: 'jw:403680',
    offers: ['hoopla:12418002', 'nf:81037598', 'plex:5d77708f594b2b001e74d1ea', 'tubi:590793'],
  })
}, 60_000)

test('the control: once AniList\'s row lands too, JustWatch asks for the film', async () => {
  await ingest([media('anilist:101249', {
    type: 'MOVIE',
    categories: ['ANIME', 'MOVIE'],
    score: 0.8,
    startDate: '2018-08-17',
    titles: [title('en', 'Penguin Highway', 0.8)],
    handles: [sameAs(media('mal:37407'))],
  })])
  expect((await askJustWatch()).asked).toEqual(['tm403680'])
}, 60_000)
