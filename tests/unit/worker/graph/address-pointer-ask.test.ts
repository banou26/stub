// STUB-391: Casablanca opened from movies search never asked IMDb, so its cast had no photos. The search had already
// stored IMDb's row (1942, the year it premiered), which JustWatch's film (1943-01-23) does not join by date, and
// JustWatch's own `omdb:` id for the film reads as an address pointer, so the row stayed in a cluster of its own.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { addressUris, askAddressOf, placeholdersOf, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, sameAs, title } from './plugins/fixtures'

const IMDB = 'https://www.imdb.com/title/tt0034583'
const HBO = 'hbo:83b99ff6-56a0-4696-aa68-fdd6d3f31efa'
const film = (uri: string, score: number, startDate: string, handles: unknown[]) =>
  media(uri, { type: 'MOVIE', categories: ['MOVIE'], score, titles: [title('en', 'Casablanca', score)], startDate, handles })

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    await answer('media', { ...film('omdb:tt0034583', 0.3, '1942', [sameAs(media('imdb:tt0034583', { url: IMDB }))]), url: IMDB }, 'MEDIA_PAGE'),
    await answer('media', film('jw:77588', 0.2, '1943-01-23', [sameAs(media('omdb:tt0034583', { url: IMDB })), sameAs(media(HBO))])),
    // a member pointing back at the film off the address it was asked with
    await answer('media', film(HBO, 0.2, '1943-01-23', [{ ...sameAs(media('jw:77588')), provenance: 'address' }])),
  ])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)
afterAll(async () => { await closeGraph() })

// Mutation: report only unowned targets in `placeholdersOf` and the address names no IMDb row; drop the membership
// test and the film's own member is reported as one more
test('a film whose address pointer names a row the search stored still asks that row\'s source', async () => {
  const view = await resolveMedia('jw:77588')
  expect(addressUris(String(view!.uri)), 'IMDb\'s row is not a member of the film').toEqual([HBO, 'jw:77588'])
  expect(addressUris(await askAddressOf(String(view!._id), String(view!.uri)))).toEqual([HBO, 'jw:77588', 'omdb:tt0034583'])
  expect((await placeholdersOf(String(view!._id))).map(({ uri, provenance }) => `${uri} ${provenance}`), 'and a pointer at a member is none')
    .toEqual(['omdb:tt0034583 address'])
})
