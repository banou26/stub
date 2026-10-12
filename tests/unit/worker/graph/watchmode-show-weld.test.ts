// Breaking Bad as TVmaze and Watchmode answered its search on 2026-10-13, each cut to the show and its
// minisodes. Watchmode's series record names the whole show, as TVmaze's does, and both carry its IMDb
// id, so each show is one card; series.fkn.app listed a second, thinner `ag:(watchmode:03173903)` beside
// Breaking Bad's.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import * as tvmaze from '../../../../src/sources/tvmaze/extractor'
import * as watchmode from '../../../../src/sources/watchmode/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import TVMAZE from '../../../fixtures/tvmaze/search-breaking-bad.json'
import WATCHMODE from '../../../fixtures/watchmode/search-breaking-bad.json'
import { answer } from './plugins/fixtures'

const search = async (source: { resolvers: unknown }, body: unknown) => {
  const context = {
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    fetch: async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }),
  }
  const { value } = await (source.resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: 'breaking bad' } }, context).next()
  return value.mediaPage.nodes as { uri: string }[]
}

beforeAll(async () => {
  await enableGraph(true)
  const rows = [...await search(tvmaze, TVMAZE), ...await search(watchmode, WATCHMODE)]
  expect(rows.map(row => row.uri).sort()).toEqual(['tvmaze:169', 'tvmaze:27845', 'watchmode:03173903', 'watchmode:03317920'])
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

test('each Watchmode show is one card with the TVmaze show of the same IMDb id', async () => {
  expect(await members('tvmaze:169')).toEqual(['imdb:tt0903747', 'tmdb:1396', 'tvmaze:169', 'watchmode:03173903'])
  expect(await members('tvmaze:27845')).toEqual(['imdb:tt2387761', 'tmdb:337563', 'tvmaze:27845', 'watchmode:03317920'])
})
