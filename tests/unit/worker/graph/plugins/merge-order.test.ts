// The viewer's merge order (Settings), as aggregateFields follows it. The default order is today's tuning, so its
// merge is pinned byte for byte to what aggregateFields wrote before the order existed: over the merge corpus's
// cases and 42 clusters of the recorded Summer 2026 season (one pass, 2026-09-12 answers, inputs as the pass
// handed them, handles, episodes and relations cut and descriptions cut to 120 characters).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { DEFAULT_MERGE_ORDER } from '../../../../../src/sources/merge-order'
import { aggregateFields, type MemberRow } from '../../../../../src/worker/graph/plugins/fields'
import { fromGoodSource } from '../../../../../src/utils/theater'

type Options = Parameters<typeof aggregateFields>[0]

const CASES = new URL('../../../../corpus/cases/', import.meta.url)

const corpusClusters = (): [string, Options][] => readdirSync(CASES).sort().map(file => {
  const rows = (JSON.parse(readFileSync(new URL(file, CASES), 'utf8')) as { rows: Record<string, unknown>[] }).rows
  const members: MemberRow[] = rows.map(row => ({
    uri: String(row.uri),
    origin: String(row.origin),
    id: String(row.id),
    owned: true,
    score: typeof row.score === 'number' ? row.score : null,
    raw: row,
    fieldSeq: {},
  }))
  return [file, {
    cluster: { id: `cl:${file}`, aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
    members,
    related: [],
    relations: [],
    locationOrigin: '',
  }]
})

const seasonClusters = (): [string, Options][] =>
  (JSON.parse(readFileSync(new URL('./__fixtures__/summer-2026-clusters.json', import.meta.url), 'utf8')) as Omit<Options, 'locationOrigin'>[])
    .map(options => [options.cluster.id, { ...options, locationOrigin: '' }])

const CLUSTERS = [...corpusClusters(), ...seasonClusters()]

const digests = (merge: (options: Options) => unknown) =>
  CLUSTERS.map(([name, options]) => `${name} ${createHash('sha256').update(JSON.stringify(merge(options))).digest('hex')}`).join('\n') + '\n'

test('the default order merges byte for byte as before the order existed', async () => {
  expect(CLUSTERS.length, 'the corpus and the season sample are read').toBe(291)
  await expect(digests(options => aggregateFields(options))).toMatchFileSnapshot('./__snapshots__/merge-default.txt')
})

test('an order the default one follows merges as no order does', () => {
  const unset = digests(options => aggregateFields(options))
  for (const order of [[], DEFAULT_MERGE_ORDER, DEFAULT_MERGE_ORDER.slice(0, 3), ['nyaa', ...DEFAULT_MERGE_ORDER, 'other']]) {
    expect(digests(options => aggregateFields({ ...options, order })), order.join()).toBe(unset)
  }
})

const member = (uri: string, score: number | null, raw: Record<string, unknown>): MemberRow => {
  const origin = uri.slice(0, uri.indexOf(':'))
  return { uri, origin, id: uri.slice(origin.length + 1), owned: true, score, raw: { uri, origin, ...raw }, fieldSeq: {} }
}
const text = (field: string, value: string, score: number, language = 'en') => ({ language, [field]: value, score })
const image = (url: string, score: number) => ({ url, score })

// one show as each source answers it, with the scores their extractors give
const SHOW = [
  member('mal:1', 0.9, {
    titles: [text('title', 'MyAnimeList English', 0.9), text('title', 'MyAnimeList Romaji', 0.4, 'jp-en')],
    descriptions: [text('description', 'MyAnimeList synopsis', 0.9)],
    covers: [image('https://mal.test/cover.jpg', 0.9)],
    status: 'FINISHED',
    startDate: '2020-01-05',
  }),
  member('anilist:1', 0.8, {
    titles: [text('title', 'AniList English', 0.8), text('title', 'AniList Romaji', 0.8, 'jp-en')],
    descriptions: [text('description', 'AniList description', 0.8)],
    covers: [image('https://anilist.test/cover.jpg', 0.8)],
    banners: [image('https://anilist.test/strip.jpg', 0.05)],
    status: 'RELEASING',
    startDate: '2020-01-04',
  }),
  member('kitsu:1', 0.3, { titles: [text('title', 'Kitsu English', 0.3)], banners: [image('https://kitsu.test/banner.jpg', 0.3)] }),
  member('anizip:1', null, { titles: [text('title', 'AniZip English', 0.9)], banners: [image('https://anizip.test/fanart.jpg', 0.9)], status: 'CANCELLED' }),
  member('nyaa:1', 0.85, { titles: [text('title', 'Nyaa English', 0.85)] }),
]

const merged = (members: MemberRow[], order?: readonly string[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: 12, runLengthTier: 0.8, runLengthWitnesses: 2, runLengthFrom: [], anomalies: [] },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
  order,
})
const pick = (media: ReturnType<typeof merged>, field: string, key: string) => (media[field] as Record<string, string>[]).map(entry => entry[key])

// the owner, 2026-10-26 (HOR-1030): "I feel like the card order should decide merge priority, yes, but by default,
// their card order is the order we defined, and most people aren't going to change the order, so our tuning will still
// be useful."
test('AniList moved above MyAnimeList wins the titles, the description, the cover and the status, and keeps its strip banner last', () => {
  const tuned = merged(SHOW)
  expect(pick(tuned, 'titles', 'title')).toEqual(['MyAnimeList English', 'AniZip English', 'Nyaa English', 'AniList English', 'AniList Romaji', 'MyAnimeList Romaji', 'Kitsu English'])
  expect([pick(tuned, 'descriptions', 'description')[0], pick(tuned, 'covers', 'url')[0], tuned.status, tuned.startDate]).toEqual(['MyAnimeList synopsis', 'https://mal.test/cover.jpg', 'FINISHED', '2020-01-05'])

  const moved = merged(SHOW, ['anilist', 'mal'])
  expect(pick(moved, 'titles', 'title')).toEqual(['AniList English', 'AniList Romaji', 'MyAnimeList English', 'Nyaa English', 'AniZip English', 'MyAnimeList Romaji', 'Kitsu English'])
  expect(pick(moved, 'descriptions', 'description')).toEqual(['AniList description', 'MyAnimeList synopsis'])
  expect(pick(moved, 'covers', 'url')).toEqual(['https://anilist.test/cover.jpg', 'https://mal.test/cover.jpg'])
  expect([moved.status, moved.startDate], 'the scalars follow, and AniZip\'s unscored row still supplies none').toEqual(['RELEASING', '2020-01-04'])
  expect(pick(moved, 'banners', 'url'), 'AniList\'s strip under every other banner').toEqual(['https://anizip.test/fanart.jpg', 'https://kitsu.test/banner.jpg', 'https://anilist.test/strip.jpg'])
  expect(pick(merged(SHOW, ['anilist', 'cr', 'offline', 'kitsu']), 'banners', 'url'), 'even with AniList first, and Kitsu moved above AniZip')
    .toEqual(['https://kitsu.test/banner.jpg', 'https://anizip.test/fanart.jpg', 'https://anilist.test/strip.jpg'])
  expect([moved.score, moved.episodeCount], 'the order stays out of the score and the length').toEqual([tuned.score, tuned.episodeCount])
})

test('a source moved past another of the same score wins the tie', () => {
  const pair = [member('kitsu:2', 0.3, { titles: [text('title', 'Kitsu Title', 0.3)], status: 'FINISHED' }), member('tmdb:2', 0.3, { titles: [text('title', 'TMDB Title', 0.3)], status: 'RELEASING' })]
  expect([pick(merged(pair), 'titles', 'title')[0], merged(pair).status]).toEqual(['Kitsu Title', 'FINISHED'])
  const order = DEFAULT_MERGE_ORDER.filter(origin => origin !== 'tmdb').toSpliced(DEFAULT_MERGE_ORDER.indexOf('kitsu'), 0, 'tmdb')
  expect([pick(merged(pair, order), 'titles', 'title')[0], merged(pair, order).status]).toEqual(['TMDB Title', 'RELEASING'])
})

test('LiveChart moved to the top takes MyAnimeList\'s score exactly, so the earlier place wins their tie', () => {
  const pair = [member('mal:3', 0.9, { titles: [text('title', 'MyAnimeList Title', 0.9)] }), member('livechart:3', 0.6, { titles: [text('title', 'LiveChart Title', 0.6)] })]
  expect(pick(merged(pair, ['livechart']), 'titles', 'title')).toEqual(['LiveChart Title', 'MyAnimeList Title'])
})

test('a source moved down leads the characters only after the sources above it', () => {
  const actor = { language: 'ja', person: { id: 'x:1', name: 'Kouichi Yamadera' } }
  const spike = (origin: string) => ({ id: `${origin}:c1`, names: ['Spike Spiegel'], image: `https://${origin}.test/spike.jpg`, role: 'MAIN', voiceActors: [actor] })
  const pair = [
    member('mal:5', 0.9, { credits: { score: 0.7, characters: [spike('mal')], staff: [] } }),
    member('anilist:5', 0.8, { credits: { characters: [spike('anilist')], staff: [] } }),
  ]
  expect(pick(merged(pair), 'characters', 'image'), 'AniList\'s faces lead by default').toEqual(['https://anilist.test/spike.jpg'])
  const last = [...DEFAULT_MERGE_ORDER.filter(origin => origin !== 'anilist'), 'anilist']
  expect(pick(merged(pair, last), 'characters', 'image')).toEqual(['https://mal.test/spike.jpg'])
})

test('the leading title reads at its place in the order, so the home hero takes a show the first source titled', () => {
  const titles = (media: ReturnType<typeof merged>) => media.titles as { title: string, score: number }[]
  expect(fromGoodSource({ titles: titles(merged(SHOW.filter(({ origin }) => origin === 'kitsu'))) }), 'Kitsu is no good source by default').toBe(false)
  const first = titles(merged(SHOW, ['kitsu']))
  expect(first[0]).toEqual({ language: 'en', title: 'Kitsu English', score: 0.9 })
  expect(fromGoodSource({ titles: first })).toBe(true)
})
