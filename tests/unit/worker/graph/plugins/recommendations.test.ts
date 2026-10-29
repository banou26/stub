// A title's Recommendations: every member's picks as one list (HOR-1062).
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

import type { MemberRow } from '../../../../../src/worker/graph/plugins/fields'

import { resolvers as anilistResolvers } from '../../../../../src/sources/anilist/extractor'
import { resolvers as malResolvers } from '../../../../../src/sources/jikan/extractor'
import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { aggregatePlugin } from '../../../../../src/worker/graph/plugins/aggregate'
import { directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { resolveMedia } from '../../../../../src/worker/graph/read'
import { answer, media, rowsOf, sameAs, title } from './fixtures'
import FRIEREN from '../../../sources/anilist/__fixtures__/anilist-recommendations-154587.json'

const MAL_PAGE = readFileSync(new URL('../../../sources/jikan/__fixtures__/mal-anime-52991.html', import.meta.url), 'utf8')

// a source's answer as the store keeps it: JSON
const answerOf = async (resolvers: unknown, uri: string, details: boolean, fetch: (url: string) => Promise<unknown>): Promise<Record<string, unknown>> => {
  const subscribe = (resolvers as { Subscription: { media: { subscribe: Function } } }).Subscription.media.subscribe
  const { value } = await subscribe(undefined, { input: { uri, details } }, { fetch, similarMedia: async () => undefined }).next()
  return JSON.parse(JSON.stringify(value.media))
}

const member = (raw: Record<string, unknown>): MemberRow =>
  ({ uri: String(raw.uri), origin: String(raw.origin), id: String(raw.id), owned: true, score: Number(raw.score ?? 0), raw, fieldSeq: {} })

const rowOf = (members: MemberRow[]) => aggregateFields({
  cluster: {
    id: 'cl:1', aggUri: `ag:(${members.map(({ uri }) => uri).join(',')})`, scope: 'RUN', runLength: null, runLengthTier: null,
    runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
  },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
})

type Card = { rating: number, node: { _id: string, uri: string, origin: string, titles: { title: string }[] } }
const cardsOf = (members: MemberRow[]) => (rowOf(members).recommendations as Card[] | undefined) ?? []

// AniList's first six of Frieren's twelve (154587, 2026-10-29), as a title with fewer picks gets, and MyAnimeList's 21
// off its page the same day. Mutation: join no picks, and MyAnimeList's own Violet Evergarden, Mushishi and three more
// come back as cards of their own.
test('AniList\'s picks in its order, then MyAnimeList\'s others by votes, each card naming every source of its work', async () => {
  const anilist = await answerOf(anilistResolvers, 'anilist:154587', true, async () => ({
    status: 200,
    json: async () => ({ data: { Media: {
      id: 154587, idMal: 52991, format: 'TV', title: { romaji: 'Sousou no Frieren' },
      recommendations: { nodes: FRIEREN.data.frieren.recommendations.nodes.slice(0, 6) },
    } } }),
  }))
  // the page alone: the credits page a details answer adds is beside the point here
  const mal = await answerOf(malResolvers, 'mal:52991', false, async () => ({ ok: true, text: async () => MAL_PAGE }))

  const cards = cardsOf([member(anilist), member(mal)])
  expect(cards.map(({ node }) => node.uri)).toEqual([
    'ag:(anilist:21827,mal:33352)', 'ag:(anilist:153518,mal:52701)', 'ag:(anilist:112609,mal:40571)',
    'ag:(anilist:114535,mal:41025)', 'ag:(anilist:147105,mal:51553)', 'ag:(anilist:457,mal:457)',
    'ag:(mal:35851)', 'ag:(mal:39535)', 'ag:(mal:486)', 'ag:(mal:2966)', 'ag:(mal:59459)', 'ag:(mal:4081)',
  ])
  expect(cards[0]!.node).toMatchObject({ _id: 'ag:(anilist:21827,mal:33352)', origin: 'ag' })
  expect(cards[0]!.node.titles[0]!.title, 'AniList\'s node').toBe('Violet Evergarden')
  expect(cards[0]!.rating, 'AniList\'s votes').toBe(1209)
})

const pick = (uri: string, rating: number) => ({ rating, node: { uri, origin: uri.split(':')[0], titles: [{ title: uri }], handles: [] } })
const source = (uri: string, recommendations: unknown[], raw: Record<string, unknown> = {}) =>
  member({ uri, origin: uri.split(':')[0], id: uri.split(':')[1], recommendations, ...raw })
const shown = (members: MemberRow[]) => cardsOf(members).map(({ node }) => node.uri)

// MyAnimeList's page lists its picks by votes already, so the rule shows only on picks that are not. Mutations: keep
// the members' order (MyAnimeList's 0.9 above AniList's 0.8), or the picks' own.
test('AniList\'s picks lead whatever their votes, and every other source\'s follow by votes', () => {
  expect(shown([
    source('mal:100', [pick('mal:1', 2), pick('mal:2', 9)], { score: 0.9 }),
    source('kitsu:100', [pick('kitsu:3', 5)], { score: 0.3 }),
    source('anilist:100', [pick('anilist:4', 1), pick('anilist:5', 3)], { score: 0.8 }),
  ])).toEqual(['ag:(anilist:4)', 'ag:(anilist:5)', 'ag:(mal:2)', 'ag:(kitsu:3)', 'ag:(mal:1)'])
})

// Mutation: drop the cluster and its franchise from what is skipped, and both come back.
test('a pick inside the cluster or its series is left out, and the cap counts only what is shown', () => {
  const eleven = Array.from({ length: 11 }, (_, index) => pick(`anilist:${index + 1}`, 100 - index))
  expect(shown([
    source('anilist:100', [pick('anilist:200', 500), ...eleven], { franchise: { nodes: [{ uri: 'anilist:100' }, { uri: 'anilist:200' }], edges: [] } }),
    source('mal:100', [pick('mal:100', 50), pick('mal:300', 5), pick('mal:400', 4)]),
  ])).toEqual([...eleven.map(({ node }) => `ag:(${node.uri})`), 'ag:(mal:300)'])
})

// Mutation: drop `recommendations: undefined` from `nodeOf`, and every handle of the row carries its member's picks.
test('a handle node carries no recommendations', () => {
  const row = rowOf([source('anilist:1', [pick('anilist:2', 10)])])
  expect(row.recommendations, 'the control: the row itself has them').toHaveLength(1)
  expect(JSON.stringify(row.handles)).not.toContain('anilist:2')
})

test('no pick is no list', () => {
  expect(rowOf([source('anilist:1', [])]).recommendations).toBeUndefined()
})

describe('through the graph', () => {
  const aniListPick = { rating: 400, node: media('anilist:2', { titles: [title('en', 'Violet Evergarden')], handles: [sameAs(media('mal:2'))] }) }
  beforeAll(async () => {
    await enableGraph(true)
    await ingestAnswers([
      await answer('media', media('anilist:1', { score: 0.8, titles: [title('en', 'Frieren')], handles: [sameAs(media('mal:1'))], recommendations: [aniListPick] })),
      await answer('media', media('mal:1', { score: 0.9, titles: [title('en', 'Frieren')], recommendations: [pick('mal:2', 30), pick('mal:3', 5)] })),
    ])
    resetPassState()
    await runPlugins([profilePlugin, directPlugin, aggregatePlugin], { reason: 'manual' })
  }, 120_000)
  afterAll(async () => { await closeGraph() })

  test('a title read off the graph carries its merged recommendations, and a pick is no row of the store', async () => {
    const row = await resolveMedia('ag:(anilist:1,mal:1)') as { recommendations?: Card[] } | undefined
    expect(row?.recommendations?.map(({ node }) => node.uri)).toEqual(['ag:(anilist:2,mal:2)', 'ag:(mal:3)'])
    expect(await rowsOf('MATCH (m:Media) WHERE m.uri IN $uris RETURN m.uri AS uri', { uris: ['anilist:2', 'mal:2', 'mal:3'] })).toEqual([])
    expect(await rowsOf('MATCH (m:Media) WHERE m.uri IN $uris RETURN m.uri AS uri ORDER BY uri', { uris: ['anilist:1', 'mal:1'] }), 'the control: the members are')
      .toEqual([{ uri: 'anilist:1' }, { uri: 'mal:1' }])
  })
})
