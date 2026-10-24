// An address no cluster holds yet: `ag:(anilist:20)` while only the offline history has answered for Naruto, whose
// AniList id is then a placeholder its `seed` claim named (HOR-915). The reader draws the record that claims it, wakes
// when that record's cluster forms, and gives way to AniList's own row once it lands.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { resolvers as offline } from '../../../../src/sources/offline/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { createMediaReader, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS, viewOf } from '../../../../src/worker/graph/scheduler'
import { answer, media, sameAs, title, type Row } from './plugins/fixtures'

const pass = async (rows: Row[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
  return viewOf(report.changes)
}

const offlineRow = async (uri: string): Promise<Row> => {
  const { value } = await (offline.Subscription as any).media.subscribe(undefined, { input: { uri } }, {}).next()
  return JSON.parse(JSON.stringify(value.media))
}

const titlesOf = (media?: Record<string, unknown>) => (media?.titles as { title: string }[] | undefined)?.map(entry => entry.title)

beforeAll(async () => { await enableGraph(true) }, 300_000)
afterAll(async () => { await closeGraph() })

// Mutations: drop the claimed placeholders from `viewOf` and the reader never wakes; drop the claims fallback in
// `createMediaReader.read` and it draws no title; follow claims in `resolveMedia` instead and a source waiting on the
// cluster is released by the offline record alone.
test('the reader draws the record that claims the address, and AniList\'s own row heads it once it lands', async () => {
  const reader = createMediaReader('ag:(anilist:20)')
  const stranger = createMediaReader('ag:(anilist:99999999)')
  expect(await reader.read(), 'nothing has answered yet').toBeUndefined()

  const view = await pass([await offlineRow('ag:(anilist:20)')])
  expect(reader.wakes(view), 'the pass that clusters the record names the id it claims').toBe(true)
  expect(stranger.wakes(view), 'the control: another address sleeps').toBe(false)

  const claimed = await reader.read()
  expect(claimed?._id).toBe('cl:offline:mal-20')
  expect(titlesOf(claimed)).toEqual(['Naruto'])
  expect(claimed?.categories).toEqual(['ANIME'])
  expect(await resolveMedia('ag:(anilist:20)'), 'a source waiting on the cluster is not released by the record alone').toBeUndefined()

  await pass([media('anilist:20', {
    score: 0.8,
    type: 'TV',
    categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'NARUTO', 0.8)],
    handles: [sameAs(media('mal:20'))],
  })])
  const live = await reader.read()
  expect(titlesOf(live)?.[0], 'the live source heads, the history stays the floor').toBe('NARUTO')
  expect(titlesOf(live)).toContain('Naruto')
  expect([live?.type, live?.categories]).toEqual(['TV', ['ANIME', 'SERIES']])
}, 60_000)

// Mutation: follow the claim before the provisional view, as the first cut did, and the relation redraws as the
// history's マクロス ゼロ with the dump's cover.
test('a relation its parent described keeps the parent\'s snapshot over the record that claims it', async () => {
  await pass([media('anilist:777100', {
    score: 0.8,
    titles: [title('en', 'Parent Show', 0.8)],
    relations: [{
      relation: 'SIDE_STORY',
      format: 'TV',
      node: {
        uri: 'anilist:194',
        titles: [title('en', 'Macross Zero')],
        covers: [{ language: 'en', url: 'https://cover.test/anilist-194.jpg', score: 0.8 }],
      },
    }],
  })])
  await pass([await offlineRow('ag:(anilist:194)')])

  const unnamed = await createMediaReader('ag:(mal:194)').read()
  expect([unnamed?._id, titlesOf(unnamed)], 'the control: an id nobody described draws the record').toEqual(['cl:offline:mal-194', ['マクロス ゼロ']])

  const relation = await createMediaReader('ag:(anilist:194)').read()
  expect(titlesOf(relation)).toEqual(['Macross Zero'])
  expect((relation?.covers as { url: string }[] | undefined)?.map(cover => cover.url)).toEqual(['https://cover.test/anilist-194.jpg'])
}, 60_000)

// Mutation: drop `k.provenance <> 'address'` and the echo's cluster is drawn under an id it only repeated.
test('an address echo is never followed: a source that only repeated the id it was asked about is not that id', async () => {
  await pass([media('tvdb:777000', {
    score: 0.5,
    titles: [title('en', 'Echo Show', 0.5)],
    handles: [{ relation: 'SAME_AS', provenance: 'address', node: media('anilist:777001') }],
  })])
  expect((await createMediaReader('ag:(anilist:777001)').read())?._id).toBe('anilist:777001')
  expect((await createMediaReader('ag:(tvdb:777000)').read())?._id, 'the control: the echo itself resolves').toBe('cl:tvdb:777000')
}, 60_000)
