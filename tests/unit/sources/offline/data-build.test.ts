// The data build's own checks on the offline history: every answerable record reaches the history with its AniDB
// id, a history that heads next to no show with AniDB's title refuses the build rather than shipping, and the job's
// picks ship only with the merge and the dump they were made of.
import { expect, test } from 'vite-plus/test'

import { HISTORY_SOURCES, buildExtract, historySets, refusal } from '../../../../scripts/build-anime-data.mjs'
import { decodeHistory, encodeHistory, encodePicks, withPicks } from '../../../../scripts/history-files.mjs'
import * as offlinePick from '../../../../scripts/offline-pick'
import { historyPicks, historyShards, type AnidbTitle, type HistoryRecord } from '../../../../scripts/offline-pick'
import { seasonMedia, type ManamiRecord } from '../../../../src/sources/offline/normalize'

const BEBOP = {
  title: 'Cowboy Bebop',
  type: 'TV',
  picture: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg',
  sources: ['https://myanimelist.net/anime/1', 'https://anilist.co/anime/1', 'https://kitsu.app/anime/1', 'https://anidb.net/anime/23'],
  animeSeason: { year: 1998, season: 'SPRING' },
}

// Mutation: keep no hash of the dump, so every build reads the job's picks as another dump's.
test('the extract keeps the dump\'s tag and hash, which the job\'s picks are compared with', () => {
  expect(buildExtract({ entries: [BEBOP], meta: { lastUpdate: '2026-10-19' }, tag: '2026-43', sha256: 'abc' })).toMatchObject({ tag: '2026-43', sha256: 'abc' })
})

// Mutation: push the history record without its AniDB id.
test('a record outside the bundled seasons reaches the history with its ids, AniDB\'s included', () => {
  const { history, seasons } = buildExtract({ entries: [BEBOP], meta: { lastUpdate: '2026-10-19' }, tag: '2026-43' })
  expect(history).toEqual([{ t: 'Cowboy Bebop', ty: 'TV', p: '4/19644.jpg', ml: 1, al: 1, ku: 1, ad: 23 }])
  expect(seasons).toEqual({})
})

// The three the 2026-44 dump carries, as it writes them.
const PLACEHOLDERS = [
  'https://raw.githubusercontent.com/cedya77/anime-offline-database/main/pics/no_pic.png',
  'https://cdn.anime-planet.com/images/anime/default/default-anime-fall.png',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/default.jpg',
]

// Mutation: keep the dump's picture whatever it is.
test('a placeholder picture is no poster in the bundle, so a card draws another source\'s from its first paint', () => {
  const show = (ml: number, picture: string) =>
    ({ ...BEBOP, title: `Show ${ml}`, picture, sources: [`https://myanimelist.net/anime/${ml}`], animeSeason: { year: 2026, season: 'FALL' } })
  const entries = [...PLACEHOLDERS.map((picture, index) => show(index + 1, picture)), show(4, BEBOP.picture)]
  const { seasons, history } = buildExtract({ entries, meta: { lastUpdate: '2026-10-19' }, tag: '2026-43' })
  const pictures = [[1, ''], [2, ''], [3, ''], [4, '4/19644.jpg']]
  expect(seasons['2026-FALL'].map(({ ml, p }: { ml: number, p: string }) => [ml, p])).toEqual(pictures)
  expect(history.map(({ ml, p }: { ml: number, p: string }) => [ml, p])).toEqual(pictures)
  expect(seasons['2026-FALL'].map((record: ManamiRecord) => seasonMedia(record, '2026-FALL')!.covers.length)).toEqual([0, 0, 0, 1])
})

// Mutations: rename a source; drop TVmaze's licence or its link back.
test('the stub shards credit every source a pick can come from, TVmaze with its licence and a link back', () => {
  expect(HISTORY_SOURCES.stub.map(({ name }) => name)).toEqual(['AniDB', 'Kitsu', 'TVmaze', 'The other sources stub reads'])
  expect(HISTORY_SOURCES.stub[2]).toMatchObject({ url: 'https://www.tvmaze.com/', license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' })
})

const HEALTHY = { indexRows: 24_461, seasons: 6, anidbTitles: 12_075 }

// Mutation: drop the AniDB floor.
test('a history heading fewer than 10,000 shows with AniDB\'s title refuses the build', () => {
  expect(refusal(HEALTHY)).toBeUndefined()
  expect(refusal({ ...HEALTHY, anidbTitles: 9_999 })).toMatch(/only 9999 history titles from AniDB.*Run the Offline history workflow/)
  // an empty AniDB asset, as a first publish AniDB refused leaves it, gives no AniDB title at all
  const { counts } = historyPicks(
    [{ t: 'Kidou Senshi Gundam', ty: 'TV', p: '', ml: 80, ad: 63 }],
    new Map<number, AnidbTitle[]>(),
    new Map(),
  )
  expect(refusal({ ...HEALTHY, anidbTitles: counts.anidbTitles })).toMatch(/only 0 history titles from AniDB/)
  // control: the same record with AniDB's titles counts one
  expect(historyPicks([{ t: 'Kidou Senshi Gundam', ty: 'TV', p: '', ml: 80, ad: 63 }], new Map([[63, [['official', 'en', 'Mobile Suit Gundam'] as AnidbTitle]]]), new Map()).counts.anidbTitles).toBe(1)
})

// Mutations: drop the index floor; drop the seasons floor.
test('too few index rows or seasons refuse the build too', () => {
  expect(refusal({ ...HEALTHY, indexRows: 14_999 })).toMatch(/only 14999 index rows/)
  expect(refusal({ ...HEALTHY, seasons: 2 })).toMatch(/only 2 seasons/)
})

const GUNDAM: HistoryRecord = { t: 'Kidou Senshi Gundam', ty: 'TV', p: '', ml: 80, ad: 63 }
const TITLES = new Map([[63, [['official', 'en', 'Mobile Suit Gundam'] as AnidbTitle]]])
const public_ = () => encodeHistory({
  anidb: { fetchedAt: null, lastModified: null, titles: TITLES },
  kitsu: new Map(),
  fields: { dump: { tag: '2026-43', sha256: 'abc' }, kitsu: { refreshedFor: '2026-43' }, checkpoints: {}, open: [] },
})
const STAMP = { merge: 'merge-1', dump: { tag: '2026-43', sha256: 'abc' } }
const MANAMI = { tag: '2026-43', sha256: 'abc', history: [GUNDAM] }
const BUILD = { module: offlinePick, version: 'merge-1' }
// the job's picks, with what only the private store holds
const JOB = new Map<string, offlinePick.PickEntry>([['mal-80', { t: 'Mobile Suit Gundam 0079' }]])
const withJob = (picks = JOB, stamp = STAMP) => decodeHistory(withPicks(public_(), encodePicks(picks, stamp)))

// Mutation: ship the build's own merge with fresh picks.
test('picks of this merge and this dump are what the build ships, while its checks read its own merge', () => {
  const { sets, counts, picked } = historySets(BUILD, withJob(), MANAMI)
  expect(sets.stub[80]).toEqual({ 'mal-80': { t: 'Mobile Suit Gundam 0079' } })
  expect(sets.dump[80]).toEqual({ 'mal-80': ['Kidou Senshi Gundam', ''] })
  expect(counts.anidbTitles).toBe(1)
  expect(picked).toBe('the job\'s picks of 1 shows, merge merge-1, dump 2026-43')
})

// Mutation: ship picks of another merge or dump; fail a build with no picks.
test.each([
  ['no picks yet', decodeHistory(public_()), 'no picks published yet'],
  ['another merge', withJob(JOB, { ...STAMP, merge: 'merge-0' }), 'the picks are of merge merge-0, this build\'s is merge-1'],
  ['another dump', withJob(JOB, { ...STAMP, dump: { tag: '2026-42', sha256: 'old' } }), 'the picks are of dump 2026-42, this build\'s is 2026-43'],
])('with %s the build ships what it ships today, its own merge of the public assets', (_, history, why) => {
  const { picks } = historyPicks([GUNDAM], TITLES, new Map())
  const { sets, picked } = historySets(BUILD, history, MANAMI)
  expect(sets).toEqual(historyShards([GUNDAM], picks))
  expect(sets.stub[80]).toEqual({ 'mal-80': { t: 'Mobile Suit Gundam' } })
  expect(picked).toBe(`this build's own merge, as ${why}`)
})

// Mutation: read the picks' entries differently from the build's own.
test('picks of the same inputs as the build\'s cut to the same shards, byte for byte', () => {
  const { picks } = historyPicks([GUNDAM], TITLES, new Map())
  expect(JSON.stringify(historySets(BUILD, withJob(picks), MANAMI).sets)).toBe(JSON.stringify(historyShards([GUNDAM], picks)))
})

// Mutation: ship the picks' images as they are.
test('an image Kitsu signed for minutes is none in the history, so a record draws the dump\'s picture', () => {
  // as the job's picks held Kitsu's banners for the 2026-44 dump
  const signed = (kind: string) => `https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/${kind}/77caf9278cd8d42507318d08f7db6239.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261101T120155Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=b54f6a74`
  const picks = new Map<string, offlinePick.PickEntry>([['mal-80', { t: 'Mobile Suit Gundam 0079', p: signed('poster_image'), b: signed('cover_image') }]])
  const lasting = new Map<string, offlinePick.PickEntry>([['mal-80', { t: 'Mobile Suit Gundam 0079', b: 'cover_image/77caf9278cd8d42507318d08f7db6239.png' }]])

  expect(historySets(BUILD, withJob(picks), MANAMI).sets.stub[80]).toEqual({ 'mal-80': { t: 'Mobile Suit Gundam 0079' } })
  expect(historySets(BUILD, withJob(lasting), MANAMI).sets.stub[80], 'the control: a lasting banner').toEqual({ 'mal-80': lasting.get('mal-80') })
})
