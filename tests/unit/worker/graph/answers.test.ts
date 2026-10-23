/**
 * The `Answer` log, driven through the real hook.
 *
 * `src/worker/extractor.ts` cannot be imported under vitest (it reaches react through urql), so the
 * server here is built the way `makeExtractor` builds one: the same generated typeDefs, the same
 * `useOnResolve` from `@envelop/on-resolve`, and the same `recordAnswers` call the extractor's hook
 * makes. What is not here is the three DataLoaders, which this step does not touch.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { useOnResolve } from '@envelop/on-resolve'
import { createSchema, createYoga } from 'graphql-yoga'
import { getNamedType } from 'graphql'

import { typeDefs } from '../../../../src/generated/schema/typeDefs.generated'
import { closeRoot, openRoot, stamp, type RootOperation } from '../../../../src/worker/request-context'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { enableGraph } from '../../../../src/worker/graph'
import { exportAnswers, keepEpisodes, recordAnswers } from '../../../../src/worker/graph/answers'

const HANDLE_NODE = { uri: 'kitsu:1', origin: 'kitsu', id: '1' }
const RELATION_NODE = { uri: 'anilist:99', origin: 'anilist', id: '99' }
const EPISODE_HANDLE_NODE = { uri: 'cr:e1', origin: 'cr', id: 'e1', mediaUri: 'cr:1' }

const mediaFixture = (title: string) => ({
  uri: 'mal:1',
  origin: 'mal',
  id: '1',
  titles: [{ language: 'en', title, score: 1 }],
  handles: [{ relation: 'SAME_AS', node: HANDLE_NODE }],
  relations: [{ relation: 'SEQUEL', node: RELATION_NODE }],
  episodes: [{
    uri: 'mal:1-1',
    origin: 'mal',
    id: '1-1',
    mediaUri: 'mal:1',
    episodeNumber: 1,
    handles: [{ relation: 'SAME_AS', node: EPISODE_HANDLE_NODE }],
  }],
})

const ORIGIN = { id: 'mal', url: 'https://myanimelist.net', name: 'MyAnimeList', icon: null, color: null, isApiOnly: false }
const PAGE_ORIGIN = { id: 'kitsu', url: 'https://kitsu.app', name: 'Kitsu', icon: null, color: null, isApiOnly: false }

// the other three answer positions each answer a row of their own, because a position writes a row
// only when its CONTENT is new: the same object served through a narrower document is the same answer
const PAGE_NODE = { uri: 'mal:2', origin: 'mal', id: '2', titles: [{ language: 'en', title: 'Ranking of Kings', score: 1 }] }
const SIMILAR_NODE = { uri: 'cr:GRJ', origin: 'cr', id: 'GRJ', titles: [{ language: 'en', title: 'Frieren', score: 1 }] }
// the fold's answer (4.4): a season that HOLDS the run, carrying its own episodes, which is the whole
// reason the position has to be here rather than being reached by a second ask
const CONTAINING_EPISODE = { uri: 'cr:GRJ-S1-1', origin: 'cr', id: 'GRJ-S1-1', mediaUri: 'cr:GRJ-S1', episodeNumber: 1 }
const CONTAINING_NODE = {
  uri: 'cr:GRJ-S1',
  origin: 'cr',
  id: 'GRJ-S1',
  episodeCount: 24,
  titles: [{ language: 'en', title: 'Frieren', score: 1 }],
  episodes: [CONTAINING_EPISODE],
}

// the payload the fixture source answers with, so one test can change a single byte of it
let payload = mediaFixture('Frieren')

const listNullGuards = {
  Media: {
    _id: (parent: { uri: string }) => parent.uri,
    handles: (parent: { handles?: unknown[] }) => parent.handles ?? [],
    relations: (parent: { relations?: unknown[] }) => parent.relations ?? [],
    titles: (parent: { titles?: unknown[] }) => parent.titles ?? [],
    episodes: (parent: { episodes?: unknown[] }) => parent.episodes ?? [],
  },
  Episode: {
    _id: (parent: { uri: string }) => parent.uri,
    handles: (parent: { handles?: unknown[] }) => parent.handles ?? [],
  },
}

const server = createYoga({
  schema: createSchema({
    typeDefs,
    resolvers: {
      ...listNullGuards,
      Query: {},
      Mutation: {},
      Subscription: {
        media: { subscribe: async function* () { yield { media: payload } } },
        mediaPage: { subscribe: async function* () { yield { mediaPage: { nodes: [PAGE_NODE] } } } },
        similarMedia: { subscribe: async function* () { yield { similarMedia: SIMILAR_NODE } } },
        containingMedia: { subscribe: async function* () { yield { containingMedia: CONTAINING_NODE } } },
        origin: { subscribe: async function* () { yield { origin: ORIGIN } } },
        originPage: { subscribe: async function* () { yield { originPage: { nodes: [PAGE_ORIGIN] } } } },
      },
    } as never,
  }),
  maskedErrors: false,
  plugins: [{
    onPluginInit: ({ addPlugin }) => {
      addPlugin(useOnResolve(({ info }) =>
        async ({ result }) => { await recordAnswers(info, getNamedType(info.returnType).name, result) }
      ))
    },
  }],
})

/**
 * Drives one subscription document to completion and returns its payloads, errors and all.
 *
 * `carriesContext` is false for the origin documents: `OriginInput` has no `context` field today
 * (`origin/schema.gql:17-19`), so an origin answer reaches the hook with no root operation to read,
 * which is what `UNKNOWN` records.
 */
const run = async (document: string, operation: RootOperation, input: Record<string, unknown>, carriesContext = true) => {
  const root = openRoot(operation)
  const variables = carriesContext ? stamp({ input }, root) : { input }
  const response = await server.handleRequest(
    new Request('http://d/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ query: document, variables }),
    }),
    {}
  )
  const text = await response.text()
  closeRoot(root.rootId)
  const payloads = [...text.matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]!))
  for (const entry of payloads) {
    if (entry.errors) throw new Error(`the fixture server answered errors: ${JSON.stringify(entry.errors)}`)
  }
  return payloads
}

const MEDIA_DOCUMENT = `
  subscription Media($input: MediaInput!) {
    media(input: $input) {
      uri origin id
      titles { language title score }
      handles { relation node { uri origin id } }
      relations { relation node { uri origin id } }
      episodes { uri origin id mediaUri episodeNumber handles { relation node { uri origin id } } }
    }
  }`

const MEDIA_PAGE_DOCUMENT = `
  subscription MediaPage($input: MediaPageInput!) {
    mediaPage(input: $input) { nodes { uri origin id titles { language title score } } }
  }`

const SIMILAR_DOCUMENT = `
  subscription SimilarMedia($input: SimilarMediaInput!) {
    similarMedia(input: $input) { uri origin id titles { language title score } }
  }`

// the shape `CONTAINING_MEDIA_DOCUMENT` asks for (worker/similar-document.ts): the shared selection
// plus the container's own count, and its episodes
const CONTAINING_DOCUMENT = `
  subscription ContainingMedia($input: SimilarMediaInput!) {
    containingMedia(input: $input) {
      uri origin id episodeCount
      titles { language title score }
      episodes { uri origin id mediaUri episodeNumber }
    }
  }`

const ORIGIN_DOCUMENT = `
  subscription Origin($input: OriginInput!) {
    origin(input: $input) { id name url isApiOnly }
  }`

const ORIGIN_PAGE_DOCUMENT = `
  subscription OriginPage($input: OriginPageInput!) {
    originPage(input: $input) { nodes { id name url isApiOnly } }
  }`

beforeAll(async () => {
  await enableGraph(true)
})

afterAll(async () => {
  await closeGraph()
})

describe('the Answer log', () => {
  test('a top-level media answer is one row, and its raw round-trips', async () => {
    await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:1' })

    const rows = await exportAnswers()
    const media = rows.filter(row => row.kind === 'media')
    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({
      uri: 'mal:1',
      origin: 'mal',
      kind: 'media',
      operation: 'MEDIA',
      selection: ['episodes', 'handles', 'id', 'origin', 'relations', 'titles', 'uri'],
    })
    expect(JSON.parse(media[0]!.raw)).toEqual(payload)

    // the episodes of that answer are answers of their own, at the one nested position that is one
    const episodes = rows.filter(row => row.kind === 'episode')
    expect(episodes.map(row => row.uri)).toEqual(['mal:1-1'])
    expect(JSON.parse(episodes[0]!.raw)).toEqual(payload.episodes[0])
  })

  // THE CONTROL. Every nested node above is `Media!` or `Episode!` exactly as the answer is, so a
  // hook keyed on the type alone writes all four of these, and a hook keyed on a blacklist of
  // `handles` still writes the relation node.
  test('a nested handle node, a relation node and an episode handle node write nothing', async () => {
    await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:1' })

    const uris = (await exportAnswers()).map(row => row.uri)
    expect(uris).not.toContain(HANDLE_NODE.uri)
    expect(uris).not.toContain(RELATION_NODE.uri)
    expect(uris).not.toContain(EPISODE_HANDLE_NODE.uri)
    expect(uris.filter(uri => uri === 'mal:1')).toHaveLength(1)
  })

  test('the same payload resolved twice writes one row and moves no seq', async () => {
    const before = await exportAnswers()

    await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:1' })
    await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:1' })

    expect(await exportAnswers()).toEqual(before)
  })

  test('a payload differing in one byte writes a second row', async () => {
    const before = await exportAnswers()
    payload = mediaFixture('Frieren.')

    await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:1' })

    const after = await exportAnswers()
    const media = after.filter(row => row.kind === 'media')
    expect(media).toHaveLength(2)
    expect(media[0]!.key).not.toBe(media[1]!.key)
    expect(media.map(row => row.uri)).toEqual(['mal:1', 'mal:1'])
    // the one new answer, and nothing else: the episodes did not change, so they wrote nothing
    expect(after).toHaveLength(before.length + 1)
    expect(JSON.parse(media[1]!.raw).titles[0].title).toBe('Frieren.')
  })

  test('the other answer positions each write their own row', async () => {
    payload = mediaFixture('Frieren')
    const before = new Set((await exportAnswers()).map(row => row.key))

    await run(MEDIA_PAGE_DOCUMENT, 'MEDIA_PAGE', { nodes: [{ uri: 'mal:2' }] })
    await run(SIMILAR_DOCUMENT, 'SIMILAR_MEDIA', { showId: 'GRJ' })
    await run(ORIGIN_DOCUMENT, 'MEDIA', { id: 'mal' }, false)
    await run(ORIGIN_PAGE_DOCUMENT, 'MEDIA', { ids: ['kitsu'] }, false)

    const added = (await exportAnswers()).filter(row => !before.has(row.key))
    // an origin row is keyed on its id, which is its only address; the two origin documents carry no
    // request context, so their operation is UNKNOWN rather than a guess
    expect(added.map(row => [row.kind, row.uri, row.operation])).toEqual([
      ['media', 'mal:2', 'MEDIA_PAGE'],
      ['media', 'cr:GRJ', 'SIMILAR_MEDIA'],
      ['origin', 'mal', 'UNKNOWN'],
      ['origin', 'kitsu', 'UNKNOWN'],
    ])
    expect(added[0]!.selection).toEqual(['id', 'origin', 'titles', 'uri'])
    expect(JSON.parse(added[2]!.raw)).toEqual(ORIGIN)
  })

  // FINDING 3 OF THE 2026-09-13 REVIEW. `containingMedia` was not in the whitelist, so a season a
  // source answered as holding a run produced no `Answer` row at all: its episodes reached the old
  // store through the position-blind inserters and the graph not at all, `?export=answers` could
  // never carry one so no corpus could replay one, and the graph only got the season because the
  // claim's unowned target was re-asked as an ordinary `media` one round trip later.
  //
  // Mutation: remove either `containingMedia` key from `ANSWER_POSITIONS` and the matching half of
  // this reddens, the media row or the episode row.
  test('a containing answer is an answer, episodes and all', async () => {
    const before = new Set((await exportAnswers()).map(row => row.key))

    await run(CONTAINING_DOCUMENT, 'SIMILAR_MEDIA', { showId: 'GRJ' })

    const added = (await exportAnswers()).filter(row => !before.has(row.key))
    expect(added.map(row => [row.kind, row.uri, row.operation])).toEqual([
      ['media', 'cr:GRJ-S1', 'SIMILAR_MEDIA'],
      ['episode', 'cr:GRJ-S1-1', 'SIMILAR_MEDIA'],
    ])
    expect(added[0]!.selection, 'the count the placement reads is in the row').toEqual(['episodeCount', 'episodes', 'id', 'origin', 'titles', 'uri'])
    expect(JSON.parse(added[1]!.raw)).toEqual(CONTAINING_EPISODE)
  })

  // The log is awaited by the resolve hook, so a value it cannot read has to be dropped there and
  // not thrown: a rejection here would fail the source's answer, which is the opposite of what a log
  // is for. Called directly rather than through a document, because a circular payload cannot be
  // served through one.
  test('a return value JSON cannot express is dropped, never thrown at the resolver', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const circular: Record<string, unknown> = { uri: 'mal:9', origin: 'mal' }
    circular.self = circular
    const info = { path: { prev: undefined, key: 'media', typename: 'Subscription' }, variableValues: {} }

    await expect(recordAnswers(info, 'Media', circular)).resolves.toBeUndefined()

    expect(spy).toHaveBeenCalledOnce()
    expect((await exportAnswers()).map(row => row.uri)).not.toContain('mal:9')
    spy.mockRestore()
  })

  // the link preview's copy (src/preview), where a long series' episodes in every source's answer were most of its heap
  test('with episodes off, a media answer is kept without them and an episode answer not at all', async () => {
    const before = new Set((await exportAnswers()).map(row => row.key))
    const fixture = mediaFixture('One Piece')
    payload = { ...fixture, uri: 'mal:21', id: '21', episodes: fixture.episodes.map(episode => ({ ...episode, uri: 'mal:21-1', id: '21-1', mediaUri: 'mal:21' })) }
    keepEpisodes(false)
    try {
      await run(MEDIA_DOCUMENT, 'MEDIA', { uri: 'mal:21' })
    } finally {
      keepEpisodes(true)
      payload = mediaFixture('Frieren')
    }

    const added = (await exportAnswers()).filter(row => !before.has(row.key))
    expect(added.map(row => [row.kind, row.uri])).toEqual([['media', 'mal:21']])
    expect(added[0]!.selection).toEqual(['handles', 'id', 'origin', 'relations', 'titles', 'uri'])
    expect(JSON.parse(added[0]!.raw).episodes).toBeUndefined()
    expect(JSON.parse(added[0]!.raw).titles[0].title).toBe('One Piece')
  })

  test('the export is ordered by seq, with no number re-used', async () => {
    const rows = await exportAnswers()

    expect(rows.length).toBeGreaterThan(3)
    expect(rows.map(row => row.seq)).toEqual([...rows.keys()].map(index => index + 1))
  })
})
