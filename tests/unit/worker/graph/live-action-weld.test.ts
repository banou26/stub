// Death Note as AniList, IMDb, Watchmode and uNoGS answered its search on 2026-10-12, each cut to the
// anime series and the 2006 live-action film. The film and the series share a title and a year, so only
// their formats tell them apart, and the anime's cluster carried the film into ANIME on anime.fkn.app.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import * as anilist from '../../../../src/sources/anilist/extractor'
import * as omdb from '../../../../src/sources/omdb/extractor'
import * as unogs from '../../../../src/sources/unogs/extractor'
import * as watchmode from '../../../../src/sources/watchmode/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import ANILIST from '../../../fixtures/anilist/search-death-note.json'
import OMDB from '../../../fixtures/omdb/search-death-note.json'
import UNOGS from '../../../fixtures/unogs/search-death-note.json'
import WATCHMODE from '../../../fixtures/watchmode/search-death-note.json'
import { answer } from './plugins/fixtures'

const search = async (source: { resolvers: unknown }, body: unknown) => {
  const context = {
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    // uNoGS asks for its anonymous token first
    fetch: async (url: string) => {
      const answer = url.endsWith('/api/user') ? { token: { access_token: 'token' } } : body
      return { ok: true, status: 200, json: async () => answer, text: async () => JSON.stringify(answer) }
    },
  }
  const { value } = await (source.resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: 'Death Note' } }, context).next()
  return value.mediaPage.nodes as { uri: string }[]
}

beforeAll(async () => {
  await enableGraph(true)
  const rows = [...await search(anilist, ANILIST), ...await search(omdb, OMDB), ...await search(watchmode, WATCHMODE), ...await search(unogs, UNOGS)]
  expect(rows.map(row => row.uri).sort()).toEqual(['anilist:1535', 'nf:70068528', 'omdb:tt0758742', 'omdb:tt0877057', 'watchmode:0194656', 'watchmode:0329415'])
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row as never, 'MEDIA_PAGE'))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

const members = async (uri: string) => {
  const page = await resolveMedia(uri) as { handles: { relation: string, node: { uri: string } }[] } | undefined
  return page?.handles.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri).sort()
}

test('the live-action film stays out of the anime series of the same title and year', async () => {
  expect(await members('anilist:1535')).not.toContain('omdb:tt0758742')
  expect(await members('anilist:1535')).not.toContain('watchmode:0194656')
  expect(await members('anilist:1535')).not.toContain('nf:70068528')
})

test('the film is one cluster across IMDb, Watchmode and Netflix, and nothing else', async () => {
  expect(await members('omdb:tt0758742')).toEqual(['nf:70068528', 'omdb:tt0758742', 'watchmode:0194656'])
})
