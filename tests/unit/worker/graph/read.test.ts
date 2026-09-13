/**
 * The read path of section 6, against a real engine seeded through the real ingest and one real pass.
 *
 * WHAT EACH GROUP IS FOR. The read has exactly three ways to be wrong and all three are silent. It
 * can draw a card that should be hidden, or hide one that should be drawn, which is a page that is
 * subtly the wrong shape; it can answer a payload the SCHEMA then nulls, which takes the whole page
 * down for one missing field; or it can wake on the wrong event, which is a page that never updates
 * and reads as a slow source. So the closed set is executed through a real yoga against the real
 * generated schema with the CLIENT'S OWN DOCUMENTS, read out of the client files rather than retyped,
 * and every wake rule is asserted with the control that must NOT wake beside it.
 *
 * Every case names the mutation that reddens it.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { existsSync, readFileSync, readdirSync } from 'node:fs'

import type { AnswerRow } from '../../../../src/worker/graph/answers'

import { createSchema, createYoga } from 'graphql-yoga'

// THE ONE STUB IN THIS FILE, and it buys the app's own resolver map below. `resolvers/media/index.ts`
// reaches `worker/extractor.ts` and, through urql's CJS bundle, a bare `require('react')` that no
// vite alias can intercept, which is the measurement `vitest.config.ts` records and the whole reason
// `read.ts` exists as its own module. urql is the only module on that path that cannot load here, and
// nothing the maps below call touches it, so stubbing it changes nothing about what runs.
vi.mock('urql', () => ({
  Client: class {},
  fetchExchange: {},
  mapExchange: () => ({}),
  getOperationName: () => undefined,
}))

import { resolvers as episodeResolvers } from '../../../../src/worker/resolvers/episode/index'
import { resolvers as mediaResolvers } from '../../../../src/worker/resolvers/media/index'
import { typeDefs } from '../../../../src/generated/schema/typeDefs.generated'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../src/worker/graph/ingest'
import { emit } from '../../../../src/worker/store/events'
import { graphReady } from '../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import {
  addressUris, askAddressOf, createMediaReader, createPageReader, episodesOf, memberUrisOf,
  pageClusters, placeholdersOf, readStore, resolveMedia, setReadStore, clearReadCache } from '../../../../src/worker/graph/read'
import { answersForOrigins } from '../../../../src/sources/supported'
import { originsOfUri } from '../../../../src/utils/uri'
import { answer, episode, media, rowsOf, title } from './plugins/fixtures'

// The read cache is cleared between cases because this file writes to the graph DIRECTLY and emits
// none of the three events that clear it in the app. Without this, a case reads the view a previous
// case materialized: two cases asserting a null modal resolved a media instead (2026-09-13).
beforeEach(() => { clearReadCache() })

const CORPUS = new URL('../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })
const partOf = (node: Record<string, unknown>) => ({ relation: 'PART_OF', node: { ...node, scope: 'CONTAINER' } })

const MS_PER_DAY = 86_400_000
const weekly = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + index * 7 * MS_PER_DAY).toISOString().slice(0, 10))

const MUSHOKU = weekly('2021-01-10', 11)

// ---------------------------------------------------------------------------------------------
// The documents, READ OUT OF THE CLIENT rather than retyped, so a closed-set case can never pass
// against a copy of the document the app has since changed. `gql(`...`)` is the only shape they take
// (`src/generated/gql.ts` is what registers them), so one regex finds every one of them.

const sourceOf = (file: string): string => readFileSync(new URL(file, import.meta.url).pathname, 'utf-8')

const gqlBlocks = (source: string): string[] =>
  [...source.matchAll(/gql\(`([\s\S]*?)`\)/g)].map(match => match[1]!)

const documentNamed = (file: string, name: string): string => {
  const block = gqlBlocks(sourceOf(file)).find(entry =>
    entry.includes(`subscription ${name}(`) || entry.includes(`fragment ${name} on`))
  if (!block) throw new Error(`no document named ${name} in ${file}: the client renamed it`)
  return block
}

/** Every client document that selects `mediaPage`, by name, so a third one cannot arrive unchecked. */
const mediaPageDocuments = (sources: readonly string[]): string[] =>
  sources
    .flatMap(gqlBlocks)
    .filter(block => /\bmediaPage\s*\(/.test(block))
    .map(block => /\b(?:subscription|query)\s+(\w+)\s*[({]/.exec(block)?.[1] ?? '(unnamed)')
    .sort()

const CLIENT_SRC = new URL('../../../../src/', import.meta.url).pathname

const clientSources = (): string[] =>
  readdirSync(CLIENT_SRC, { recursive: true, encoding: 'utf-8' })
    .filter(entry => (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.startsWith('generated/'))
    .map(entry => readFileSync(`${CLIENT_SRC}${entry}`, 'utf-8'))

const MEDIA_FRAGMENT = documentNamed('../../../../src/worker/resolvers/media/fragment.ts', 'MediaFragment')
const EPISODE_FRAGMENT = documentNamed('../../../../src/worker/resolvers/episode/fragment.ts', 'EpisodeFragment')
const HOME_PAGE = documentNamed('../../../../src/router/home/index.tsx', 'GetReleasingMediaPage')
const SEARCH_PAGE = documentNamed('../../../../src/router/search/index.tsx', 'SearchMediaPage')
const MEDIA_MODAL = documentNamed('../../../../src/router/home/media-modal.tsx', 'GetMediaModal')

// ---------------------------------------------------------------------------------------------
// One yoga over the REAL generated schema, whose `Media` and `Episode` maps are THE APP'S OWN and
// whose data comes from read.ts and nothing else. It is the only way to prove the closed set: a
// field missing from a card is not an absent key here, it is a null on a non-null field, which nulls
// its parent and, through `MediaPage.nodes: [Media!]!`, the whole page. `vitest.config.ts` inlines
// yoga so one graphql realm exists.
//
// THE MAPS ARE IMPORTED RATHER THAN RETYPED, for the same reason the documents below are read out of
// the client: a friendlier copy proves the closed set against a shape the worker does not run. The
// copy this file carried until 2026-09-12 had a `Media.relations` resolver the app has no equivalent
// of, so a view whose `relations` the plugin never materialized would have nulled the modal in
// production and passed here. Only `Subscription` is this file's: the app's subscribe runs the whole
// source fan-out, where the two below are the read under test.

const server = createYoga({
  schema: createSchema({
    typeDefs,
    resolvers: {
      Query: {},
      Mutation: {},
      Subscription: {
        mediaPage: {
          subscribe: async function* (_parent: unknown, args: { input: { nodes?: { uri: string }[] | null } }) {
            const uris = (args.input.nodes ?? []).map(node => node.uri)
            yield { mediaPage: { nodes: await pageClusters(uris.length ? uris : undefined) } }
          },
        },
        media: {
          subscribe: async function* (_parent: unknown, args: { input: { uri?: string | null } }) {
            yield { media: await resolveMedia(args.input.uri ?? '') }
          },
        },
      },
      Media: mediaResolvers.Media,
      Episode: episodeResolvers.Episode,
    } as never,
  }),
  maskedErrors: false,
})

/**
 * Drives one subscription document and returns its single payload, refusing any error it carried.
 *
 * The read store is moved for the call because the app's `Media.episodes` branches on it: on
 * `legacy` that resolver walks the old store's handles, which is not the read under test.
 */
const execute = async (document: string, variables: Record<string, unknown>) => {
  setReadStore('graph')
  try {
    const response = await server.handleRequest(
      new Request('http://d/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ query: document, variables }),
      }),
      {}
    )
    const text = await response.text()
    const payloads = [...text.matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]!))
    for (const entry of payloads) {
      if (entry.errors) throw new Error(`the document answered errors: ${JSON.stringify(entry.errors)}`)
    }
    return payloads[0]?.data
  } finally {
    setReadStore('legacy')
  }
}

// ---------------------------------------------------------------------------------------------
// The fixtures. One run with everything a listing document selects, the catalogue season that hides
// behind it, a second unrelated run as the control, and a third run that a later claim retires into
// the first, which is the only way an `Alias` row is ever written.

const mushokuAnswers = async () => [
  await answer('media', media('anilist:108465', {
    url: 'https://anilist.test/108465', score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 11, startDate: MUSHOKU[0],
    season: 'WINTER', seasonYear: 2021, popularity: 900, averageScore: 82, isAdult: false,
    genres: ['Adventure', 'Fantasy'], tags: ['Isekai'], categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation')],
    shortDescriptions: [{ language: 'en', shortDescription: 'A man is reborn.', score: 0.8 }],
    descriptions: [{ language: 'en', description: '<p>A man is reborn in a world of magic.</p>', score: 0.8 }],
    covers: [{ language: 'en', url: 'https://cover.test/1.jpg', color: '#112233', score: 0.8 }],
    banners: [{ language: 'en', url: 'https://banner.test/1.jpg', score: 0.8 }],
    trailers: [{ uri: 'yt:abc', origin: 'yt', id: 'abc', url: 'https://yt.test/abc', thumbnail: 'https://yt.test/abc.jpg' }],
    nextAiringEpisode: { episodeNumber: 12, airingAt: '2021-04-04' },
    // A RELATION NODE WITH NO `origin` AND NO `id`, which is the shape Q5 is about: `Media.origin` is
    // `String!` inside a `[MediaRelationEdge!]!`, so one of these unnormalized nulls the whole media.
    relations: [{ relation: 'SEQUEL', format: 'TV', node: { uri: 'anilist:127720', titles: [title('en', 'Part 2')] } }],
    handles: [
      sameAs(media('mal:39535', { score: 0.9 })),
      sameAs(media('anizip:14758', {})),
      partOf(media('nf:80987039-1', { score: 0.2 })),
      // THE TWO PLACEHOLDERS of 7.1 step 3: a uri a claim NAMES and no source describes. Neither is
      // a member, which is exactly why the aggregated view cannot report them. The first carries no
      // scope stamp, so 5.4 P0 reads NULL for it and `plugin:direct` never evaluates the claim; a
      // stamped one would be a member with no field, which is the other half of the real page
      // (`mal:39535` was a member and was answered 0 times, 2026-09-12) and needs no fixture of its
      // own here, since `placeholdersOf` reads `owned` and never membership.
      sameAs(media('anidb:14758', { scope: null })),
      // and one stamped by the address bar (3.3): it asserts nothing and still names a source to ask
      { ...sameAs(media('tmdb:1399', {})), provenance: 'address' },
    ],
  })),
  await answer('media', media('mal:39535', {
    url: 'https://mal.test/39535',
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 11, startDate: MUSHOKU[0],
    season: 'WINTER', seasonYear: 2021, popularity: 950, averageScore: 84,
    genres: ['Fantasy'], tags: ['Isekai'], categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'Mushoku Tensei')],
    covers: [{ language: 'en', url: 'https://cover.test/mal.jpg', color: '#445566', score: 0.9 }],
  })),
  // the episode supplier: eleven numbered rows and ONE SPECIAL, which is the row today's read drops
  await answer('media', media('anizip:14758', {
    url: 'https://anizip.test/14758', type: 'TV', episodeCount: 11, titles: [title('en', 'Mushoku Tensei')],
    episodes: [
      ...MUSHOKU.map((day, index) => episode(`anizip:14758-${index + 1}`, 'anizip:14758', {
        episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Episode ${index + 1}`)],
        thumbnails: [{ url: `https://thumb.test/${index + 1}.jpg` }],
        shortDescriptions: [{ language: 'en', shortDescription: `About episode ${index + 1}.`, score: 1 }],
      })),
      episode('anizip:14758-s1', 'anizip:14758', {
        episodeNumber: null, titles: [title('en', 'Eris the Special')],
      }),
    ],
  })),
  // THE CATALOGUE SEASON, answering for itself so it is OWNED: an unowned cluster is hidden with an
  // EMPTY `hiddenBy`, and the second hop of 6.1 would then have nothing to follow
  await answer('media', media('nf:80987039-1', {
    url: 'https://nf.test/80987039-1', score: 0.2, scope: 'CONTAINER', type: 'TV', status: 'FINISHED',
    titles: [title('en', 'Mushoku Tensei: Season 1')],
    covers: [{ language: 'en', url: 'https://cover.test/nf.jpg', score: 0.2 }],
  })),
]

// the control run: nothing relates it to the one above, so every "and not this one" below names it
const samuraiAnswers = async () => [
  await answer('media', media('anilist:182616', {
    url: 'https://anilist.test/182616', score: 0.8, type: 'TV', status: 'RELEASING', episodeCount: 12, startDate: '2026-07-17',
    season: 'SUMMER', seasonYear: 2026, popularity: 400, averageScore: 75,
    genres: ['Action'], tags: ['Historical'], categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'The Elusive Samurai')],
    covers: [{ language: 'en', url: 'https://cover.test/2.jpg', score: 0.8 }],
    handles: [sameAs(media('mal:60059', { score: 0.9 }))],
  })),
  await answer('media', media('mal:60059', {
    url: 'https://mal.test/60059', score: 0.9, type: 'TV', status: 'RELEASING', episodeCount: 12, categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'The Elusive Samurai')],
  })),
]

// a run of its own in pass one, retired into Mushoku's cluster in pass two, which is what writes the
// `Alias` row statement 1b's second half reads
const strayAnswers = async () => [
  await answer('media', media('kitsu:42323', {
    url: 'https://kitsu.test/42323', score: 0.3, type: 'TV', status: 'FINISHED', episodeCount: 11, categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'Mushoku Tensei')],
  })),
]

const weldAnswer = async () =>
  answer('media', media('mal:39535', {
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 11,
    titles: [title('en', 'Mushoku Tensei')],
    handles: [sameAs(media('kitsu:42323', { score: 0.3 }))],
  }))

const runPass = async () => {
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
  return report
}

const clusterIdOf = async (uri: string): Promise<string> => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri })
  return String(row!.id)
}

/**
 * A synthetic `Cluster` row, so a case can put a fold somewhere ELSE in the store and take it away.
 *
 * The card is the run's with its identity replaced, since admission reads `_id` and `members` and
 * nothing else. A visible row's `hiddenBy` is never read, so it is filled rather than left empty:
 * an empty `STRING[]` param is a shape this engine has no type for.
 */
const writeCluster = async (id: string, members: string[], hiddenBy?: string[]): Promise<void> => {
  const { query } = await graphReady()
  const [run] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.card AS card', { id: RUN_ID })
  const card = JSON.stringify({ ...JSON.parse(String(run!.card)) as object, _id: id, members })
  await query(
    'CREATE (c:Cluster {id: $id, hidden: $hidden, hiddenBy: $hiddenBy, card: $card})',
    { id, hidden: hiddenBy !== undefined, hiddenBy: hiddenBy ?? [id], card }
  )
}

const dropClusters = async (...ids: string[]): Promise<void> => {
  const { query } = await graphReady()
  for (const id of ids) await query('MATCH (c:Cluster {id: $id}) DETACH DELETE c', { id })
}

/** Edits a card UNDER a reader, which is the only way to tell a re-read from a cached row. */
const retitle = async (id: string, titleText: string): Promise<void> => {
  const { query } = await graphReady()
  const [row] = await query('MATCH (c:Cluster {id: $id}) RETURN c.card AS card', { id })
  const card = JSON.parse(String(row!.card)) as { titles: { title: string }[] }
  card.titles = [{ title: titleText, language: 'en', score: 1 } as never]
  await query('MATCH (c:Cluster {id: $id}) SET c.card = $card', { id, card: JSON.stringify(card) })
}

const titleOf = (cards: readonly { _id: string, titles: unknown[] }[], id: string): string | undefined =>
  ((cards.find(card => card._id === id)?.titles ?? []) as { title: string }[])[0]?.title

let RUN_ID = ''
let CONTROL_ID = ''
let SEASON_ID = ''
let STRAY_ID = ''

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([...await mushokuAnswers(), ...await samuraiAnswers(), ...await strayAnswers()])
  resetPassState()
  await runPass()
  STRAY_ID = await clusterIdOf('kitsu:42323')
  // the weld, and the SECOND pass: `kitsu:42323`'s cluster retires into Mushoku's and leaves an Alias
  await ingestAnswers([await weldAnswer()])
  await runPass()
  RUN_ID = await clusterIdOf('mal:39535')
  CONTROL_ID = await clusterIdOf('mal:60059')
  SEASON_ID = await clusterIdOf('nf:80987039-1')
}, 300_000)

afterAll(async () => {
  setReadStore('legacy')
  await closeGraph()
})

// ---------------------------------------------------------------------------------------------
// 6.1, the page.

// Mutation: drop `WHERE NOT c.hidden` from the whole-store statement in read.ts and the season
// appears as its own card, which is the "opening Mushoku adds no season card" fixture of 8.1.
test('a page with no uris lists every visible cluster and no hidden one', async () => {
  const cards = await pageClusters(undefined)
  const ids = cards.map(card => card._id).sort()

  expect(ids).toContain(RUN_ID)
  expect(ids).toContain(CONTROL_ID)
  expect(ids, 'the catalogue season hides behind the run it holds').not.toContain(SEASON_ID)
  // and the control that proves the rig can see a hidden row at all: it IS in the store, hidden
  const [season] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.hidden AS hidden, c.hiddenBy AS hiddenBy', { id: SEASON_ID })
  expect(season!.hidden).toBe(true)
  expect(season!.hiddenBy).toEqual([RUN_ID])
})

// Mutation: delete the `withHiddenRuns` second hop (return only the visible seeds) and this answers
// [], which is a search only unogs or JustWatch answered drawing nothing at all.
test('a page seeded with a hidden row draws the run it hides behind, never the row', async () => {
  const cards = await pageClusters(['nf:80987039-1'])
  expect(cards.map(card => card._id)).toEqual([RUN_ID])
})

test('and a page seeded with a visible member draws that member\'s own cluster', async () => {
  const cards = await pageClusters(['mal:39535'])
  expect(cards.map(card => card._id)).toEqual([RUN_ID])
})

// the empty `UNWIND` of the engine facts: a statement run with no rows dies at runtime, and the
// symptom is a corrupt-statement error rather than an empty page
test('an empty uri list is answered without running a statement', async () => {
  expect(await pageClusters([])).toEqual([])
})

// Mutation: `WHERE NOT c.hidden` in place of `coalesce(c.hidden, false) = false`. `NOT NULL` is NULL
// on this engine and a NULL `WHERE` drops the row, so such a cluster is in NEITHER bucket: not drawn
// and not hidden behind anything either, which is a card silently missing from every listing.
test('a cluster whose hidden was never written is drawn, not lost between the two buckets', async () => {
  const { query } = await graphReady()
  const [run] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.card AS card', { id: RUN_ID })
  const card = JSON.stringify({ ...JSON.parse(String(run!.card)) as object, _id: 'cl:with-hidden', members: [] })
  // the column is simply not written, which is the one thing `schema.ts` says never happens
  await query('CREATE (c:Cluster {id: $id, card: $card})', { id: 'cl:with-hidden', card })

  // the control, so the case is known to be about a NULL rather than about a missing row
  const [row] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.id AS id, c.hidden AS hidden', { id: 'cl:with-hidden' })
  expect(row?.id, 'the row is there').toBe('cl:with-hidden')
  expect(row!.hidden ?? null, 'and its hidden is NULL').toBeNull()
  const hidden = await rowsOf('MATCH (c:Cluster) WHERE c.hidden RETURN c.id AS id')
  expect(hidden.map(entry => String(entry.id)), 'the hidden bucket does not hold it either').not.toContain('cl:with-hidden')

  expect((await pageClusters(undefined)).map(card => card._id)).toContain('cl:with-hidden')

  await dropClusters('cl:with-hidden')
})

// ---------------------------------------------------------------------------------------------
// 6.1, the incremental re-read and its removal rule.

// Mutation: make `apply` re-read the whole store (call `read` instead) and the control assertion
// below goes green while the scoping is gone; make it ignore the removal rule and the third does.
test('a view:changed re-reads the clusters it names, and only those', async () => {
  const page = createPageReader()
  const before = await page.read([])
  expect(before.map(card => card._id)).toContain(RUN_ID)

  await retitle(RUN_ID, 'RE-READ')
  await retitle(CONTROL_ID, 'NOT RE-READ')

  const after = await page.apply([RUN_ID], [])
  expect(titleOf(after, RUN_ID), 'the named cluster is re-read').toBe('RE-READ')
  expect(titleOf(after, CONTROL_ID), 'and the one nobody named is not').not.toBe('NOT RE-READ')
})

// Mutation: drop the `cards.delete(row.id)` on a hidden row and a cluster that has just been folded
// away stays on the page forever, since nothing else ever names it again.
test('and a named cluster that comes back hidden or absent is REMOVED from the page', async () => {
  const { query } = await graphReady()
  const page = createPageReader()
  expect((await page.read([])).map(card => card._id)).toContain(CONTROL_ID)

  await query('MATCH (c:Cluster {id: $id}) SET c.hidden = true', { id: CONTROL_ID })
  expect((await page.apply([CONTROL_ID], [])).map(card => card._id)).not.toContain(CONTROL_ID)

  await query('MATCH (c:Cluster {id: $id}) SET c.hidden = false', { id: CONTROL_ID })
  expect((await page.apply([CONTROL_ID], [])).map(card => card._id)).toContain(CONTROL_ID)

  // naming a cluster that was never there changes nothing, and the page keeps what it had
  expect((await page.apply(['cl:no-such-cluster'], [])).map(card => card._id)).toContain(CONTROL_ID)

  // ABSENT, which is what a retirement looks like from the page's side: the row stops existing and
  // nothing else will ever name it again
  const card = JSON.stringify({ ...page.cards()[0], _id: 'cl:temporary', members: [] })
  await query(
    'CREATE (c:Cluster {id: $id, hidden: false, card: $card})', { id: 'cl:temporary', card }
  )
  const stale = createPageReader()
  expect((await stale.read([])).map(entry => entry._id)).toContain('cl:temporary')
  await query('MATCH (c:Cluster {id: $id}) DETACH DELETE c', { id: 'cl:temporary' })
  expect((await stale.apply(['cl:temporary'], [])).map(entry => entry._id)).not.toContain('cl:temporary')
})

// ---------------------------------------------------------------------------------------------
// 6.1, ADMISSION: which named cluster belongs on THIS page.
//
// Every `apply` above passes `[]` for `uris`, where `admits` short circuits on its first clause, so
// until 2026-09-12 a copy of read.ts with `admits` replaced by `() => true` left the whole file green
// (22 of 22). The three cases below are the ones that mutation has to redden.

// Mutation: `admits` to `() => true`. Also reddened by dropping its `card.members.some` clause, which
// is the opposite mistake: a search whose fan-out answered a uri then draws nothing for it.
test('a seeded page admits a named cluster whose members meet its uris', async () => {
  const page = createPageReader()
  const after = await page.apply([CONTROL_ID], ['mal:60059'])
  expect(after.map(card => card._id), 'the map never held it, and one of its members is a uri the fan-out answered')
    .toEqual([CONTROL_ID])
})

// Mutation: `admits` to `() => true`, which admits the control onto a page that never asked for it.
test('and refuses one whose members meet none of them', async () => {
  const page = createPageReader()
  expect((await page.read(['mal:39535'])).map(card => card._id)).toEqual([RUN_ID])

  expect((await page.apply([CONTROL_ID], ['mal:39535'])).map(card => card._id)).toEqual([RUN_ID])
  // the seed is the authority on what belongs on this page, so it is what the apply is measured
  // against: `read` and `apply` answering differently for the same uris is the G3 failure of 6.6
  expect((await pageClusters(['mal:39535'])).map(card => card._id)).toEqual([RUN_ID])
})

// Mutation: drop the `cards.has(card._id)` clause from `admits` and a card the page IS drawing stops
// being re-read as soon as the event that names it carries other uris, which is a stale card that
// nothing will ever refresh.
test('and keeps re-reading one the map already holds, whatever the uris say', async () => {
  const page = createPageReader()
  expect((await page.read(['mal:39535'])).map(card => card._id)).toEqual([RUN_ID])

  await retitle(RUN_ID, 'STILL MINE')
  const after = await page.apply([RUN_ID], ['mal:60059'])
  expect(titleOf(after, RUN_ID), 'held by the page, so named means re-read').toBe('STILL MINE')
})

// Mutation: `rows.filter(row => row.hidden)` in place of `displaced`, which is what this file shipped
// until 2026-09-12. `view:changed` names every cluster that MOVED, store-wide, so that filter follows
// the `hiddenBy` of folds this page never saw and the run joins it forever: nothing names that run
// again, and the page only re-seeds when `insertedUris.length` changes.
test('a fold somewhere else in the store does not push its run onto a seeded page', async () => {
  const page = createPageReader()
  const uris = ['mal:39535']
  expect((await page.read(uris)).map(card => card._id)).toEqual([RUN_ID])

  // a run and the row that folds behind it: neither is on this page and neither holds a uri this
  // fan-out answered
  await writeCluster('cl:elsewhere-run', ['tvdb:9001'])
  await writeCluster('cl:elsewhere-season', ['tvdb:9001-1'], ['cl:elsewhere-run'])

  expect((await page.apply(['cl:elsewhere-season'], uris)).map(card => card._id)).toEqual([RUN_ID])
  expect(
    (await page.apply(['cl:elsewhere-run', 'cl:elsewhere-season'], uris)).map(card => card._id),
    'and naming the run itself changes nothing either'
  ).toEqual([RUN_ID])
  expect((await pageClusters(uris)).map(card => card._id), 'the re-seed agrees').toEqual([RUN_ID])

  await dropClusters('cl:elsewhere-run', 'cl:elsewhere-season')
})

// Mutation: narrow `displaced` to `cards.has(row.id)` alone, which is the mirror mistake and the one
// a fix for the case above lands in: this page never DREW the season, it drew the run behind it, so
// the row it has to follow is one its map has never held.
test('and a page seeded on a hidden row follows that row to its new run', async () => {
  const { query } = await graphReady()
  const page = createPageReader()
  const uris = ['nf:80987039-1']
  expect((await page.read(uris)).map(card => card._id)).toEqual([RUN_ID])

  await writeCluster('cl:other-run', ['tvdb:9002'])
  await query('MATCH (c:Cluster {id: $id}) SET c.hiddenBy = $by', { id: SEASON_ID, by: ['cl:other-run'] })

  expect((await page.apply([SEASON_ID], uris)).map(card => card._id)).toContain('cl:other-run')
  expect((await pageClusters(uris)).map(card => card._id), 'the re-seed agrees').toEqual(['cl:other-run'])

  await query('MATCH (c:Cluster {id: $id}) SET c.hiddenBy = $by', { id: SEASON_ID, by: [RUN_ID] })
  await dropClusters('cl:other-run')
})

// ---------------------------------------------------------------------------------------------
// 6.2, the detail resolve.

// Mutation: swap statements 1 and 1a (publication before membership) and the departed-member case
// below opens the wrong cluster's page.
test('a member uri, an aggregated uri and a cluster id all resolve to the one cluster', async () => {
  const byMember = await resolveMedia('mal:39535')
  expect(byMember?._id).toBe(RUN_ID)

  const byAddress = await resolveMedia(String(byMember!.uri))
  expect(byAddress?._id).toBe(RUN_ID)

  // the singleton path is GONE, so a one-source address routes here too
  const bySingleton = await resolveMedia('ag:(mal:39535)')
  expect(bySingleton?._id).toBe(RUN_ID)

  const byId = await resolveMedia(RUN_ID)
  expect(byId?._id).toBe(RUN_ID)
})

// Mutation: delete the `Alias` half of `resolveById` and a client holding the id a retired cluster
// published opens nothing, which is a bookmark that renders a shell and sits empty.
test('and a RETIRED cluster id resolves through its alias', async () => {
  expect(STRAY_ID, 'the stray had its own cluster in pass one').not.toBe(RUN_ID)
  const [alias] = await rowsOf('MATCH (a:Alias {id: $id}) RETURN a.clusterId AS clusterId', { id: STRAY_ID })
  expect(alias?.clusterId, 'pass two retired it into the run').toBe(RUN_ID)
  expect((await resolveMedia(STRAY_ID))?._id).toBe(RUN_ID)
})

// Mutation: return `resolved.id` unconditionally (never following `preferredRun`) and a show page
// draws a container with no episodes where it should draw its earliest attached run.
test('a container with a preferredRun follows to that run', async () => {
  const [season] = await rowsOf(
    'MATCH (c:Cluster {id: $id}) RETURN c.scope AS scope, c.preferredRun AS preferredRun', { id: SEASON_ID }
  )
  expect(season!.scope).toBe('CONTAINER')
  expect(season!.preferredRun, 'the run is attached to the season it is part of').toBe(RUN_ID)
  expect((await resolveMedia('nf:80987039-1'))?._id).toBe(RUN_ID)
})

// Mutation: drop the `holds` check in `resolveMedia` and `/media/:uri/:mediaUri` silently opens the
// cluster the first segment names even when the row the second names has left it.
//
// NO ROUTE REACHES THIS TODAY: `router/index.tsx` registers no `WRoute` for `Route.MEDIA_EPISODE`.
// It is pinned because 6.2 states the rule and because the surface is exported, so the day the route
// is wired the behaviour is already the documented one rather than whatever survived unexercised.
test('the /media/:uri/:mediaUri fallthrough resolves the member when the cluster does not hold it', async () => {
  expect(await resolveMedia(CONTROL_ID)).toBeDefined()
  const through = await resolveMedia(CONTROL_ID, 'mal:39535')
  expect(through?._id, 'the control does not hold the run\'s member, so the member decides').toBe(RUN_ID)
  // and the control: a member the named cluster DOES hold leaves the resolve where it was
  expect((await resolveMedia(CONTROL_ID, 'mal:60059'))?._id).toBe(CONTROL_ID)
})

// Mutation: match the raw `member` string in `holds` (`MATCH (m:Media {uri: $uri})`) instead of the
// address's uris. An `ag:(...)` second segment then matches no `Media` row whatever the cluster
// holds, so the check is false for every aggregated spelling, the fallthrough fires unconditionally
// and the first segment is discarded: here that hands the page to the run, since `resolveByUris`
// ranks the two clusters by key and the run's sorts first.
test('and the fallthrough reads the second segment as an ADDRESS, not as a raw uri', async () => {
  const held = await resolveMedia(CONTROL_ID, 'ag:(mal:60059,mal:39535)')
  expect(held?._id, 'the control holds one of the address\'s uris, so it keeps the page').toBe(CONTROL_ID)
  // the control: an address it holds NONE of does fall through, and to the cluster that holds them
  expect((await resolveMedia(CONTROL_ID, 'ag:(mal:39535)'))?._id).toBe(RUN_ID)
})

test('a uri nothing in the store names resolves to nothing, rather than to an empty row', async () => {
  expect(await resolveMedia('mal:00000000')).toBeUndefined()
  expect(await resolveMedia('')).toBeUndefined()
})

// ---------------------------------------------------------------------------------------------
// 6.4, the episode list.

// Mutation: remove the `episodeNumber != null` filter and the special is listed, which is the change
// decision 7 prices. The ORDER is `plugin:aggregate`'s and not this read's: `episodesOf` sorts
// nothing, so the order below is an assertion about the materialized list, and the mutation that
// reddens it lives in that plugin (reverse its slot order).
test('the episode list is ordered, and a special is dropped for parity with today', async () => {
  const episodes = await episodesOf(RUN_ID)
  expect(episodes.map(entry => entry.episodeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

  // the control: the special IS in the materialized list, so the drop above is this read's and not
  // an absence in the store
  const [row] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.episodes AS episodes', { id: RUN_ID })
  const stored = JSON.parse(String(row!.episodes)) as { episodeNumber: number | null }[]
  expect(stored.filter(entry => entry.episodeNumber === null).length).toBe(1)
})

// Mutation: resolve the parent through its handles instead of by `_id` and a handle node is handed
// the cluster's whole list, which is the modal drawing every episode inside every badge.
test('a handle node answers an empty list, because its _id is its own uri', async () => {
  expect(await episodesOf('mal:39535')).toEqual([])
  expect(await episodesOf('')).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// 6.6, the wake.

// ---------------------------------------------------------------------------------------------
// 6.2, the row a pass has not clustered yet.

/**
 * Opening a RELATION draws immediately, from what the parent said about it.
 *
 * `anilist:127720` is the `SEQUEL` node of `anilist:108465`'s answer, and nothing in this file
 * describes it: it has a `Media` row because a claim named it, `raw` is `{}`, no source owns it, and
 * `plugin:aggregate` skips it because its effective scope is neither RUN nor CONTAINER. So
 * `resolveMedia` answers nothing for it, which is correct and was also, until 2026-09-14, a blank
 * modal for as long as it took a pass to run.
 *
 * Measured in the browser on a cold media page that day, clicking the first relation: 940 to 1,835 ms
 * to draw on the graph store against 90 ms on `?store=legacy`, whose union-find made every uri a
 * claim named resolvable the moment it was mentioned. With the provisional view it is 88 ms.
 *
 * Mutation, three of them, one per thing the view needs: drop the `provisionalView` fallback in
 * `createMediaReader.read` and this is undefined; read `raw` with `parse` rather than `record` and
 * the row comes back with no titles, because `Media.raw` reads as an object and `parse` refuses a
 * non string; leave `owned` as the column says and it comes back with no titles again, because
 * `aggregateFields` reads fields off owned members only and nothing owns a placeholder.
 */
test('a relation nothing has described yet draws from what its claimer said', async () => {
  const reader = createMediaReader('anilist:127720')
  const media = await reader.read()

  expect(media, 'the row exists because a claim named it, so there is something to draw').toBeDefined()
  // `AggregatedMedia.titles` is `unknown[]`, the shape the JSON column round trips
  expect((media!.titles as { title: string }[]).map(entry => entry.title)).toContain('Part 2')
  // the id is the member uri and matches no cluster, which is what keeps `episodesOf` empty for it
  expect(media!._id).toBe('anilist:127720')
  expect(await episodesOf(media!._id)).toEqual([])
})

/**
 * And it is PROVISIONAL: the reader must still wake when the real cluster arrives.
 *
 * This is the half a fallback gets wrong. `read` sets `clusterId` and narrows `wakeUris` from a
 * resolved cluster; doing that from a provisional view would leave the reader waking on an id that
 * is not a cluster and on members it does not have, so the blank modal becomes a STALE modal, which
 * is worse. The provisional path therefore touches neither.
 */
test('and the provisional view does not become the state the reader settles in', async () => {
  const reader = createMediaReader('anilist:127720')
  expect(await reader.read()).toBeDefined()

  expect(reader.clusterId(), 'a provisional view is not a cluster').toBeUndefined()
  expect(reader.wakes({ clusters: ['cl:anything'], uris: ['anilist:127720'] })).toBe(true)
  // the control: it still refuses another page's event, so this is not "wakes on everything"
  expect(reader.wakes({ clusters: ['cl:anything'], uris: ['mal:60059'] })).toBe(false)
})

// Mutation: make `wakes` return true unconditionally and the control assertion below goes green
// while every page in the app re-reads on every other page's event.
test('a detail view wakes on its own cluster and not on another', async () => {
  const reader = createMediaReader('mal:39535')
  expect((await reader.read())?._id).toBe(RUN_ID)

  expect(reader.wakes({ clusters: [RUN_ID], uris: [] })).toBe(true)
  expect(reader.wakes({ clusters: [CONTROL_ID], uris: ['mal:60059'] })).toBe(false)
  // a member uri names it too, which is how a retirement into another cluster reaches it
  expect(reader.wakes({ clusters: ['cl:elsewhere'], uris: ['anilist:108465'] })).toBe(true)
})

// Mutation: seed `wakeUris` from the resolved cluster only (drop `requested`) and a modal opened
// before its first source answered never wakes, which is a page stuck on its loading state.
test('and an EMPTY cluster waits on its requested uris until one exists', async () => {
  const reader = createMediaReader('ag:(mal:77777777,anilist:77777777)')
  expect(await reader.read()).toBeUndefined()
  expect(reader.clusterId()).toBeUndefined()

  expect(reader.wakes({ clusters: ['cl:anything'], uris: ['mal:77777777'] })).toBe(true)
  expect(reader.wakes({ clusters: ['cl:anything'], uris: ['anilist:77777777'] })).toBe(true)
  expect(reader.wakes({ clusters: ['cl:anything'], uris: ['mal:39535'] })).toBe(false)
})

// Mutation: drop the `detail.clusters.some(named => requested.has(named))` clause from `wakes`. The
// address 6.2 allows may BE a cluster id, `clusterId` is only set by a successful read and a read
// only runs on a wake, so a reader on an id whose cluster does not exist yet compares that id
// against `detail.uris` alone and waits forever on the one event that names exactly it.
test('a reader addressed by a cluster id that has no cluster yet wakes on its own id', async () => {
  const reader = createMediaReader('cl:not-yet')
  expect(await reader.read()).toBeUndefined()
  expect(reader.clusterId()).toBeUndefined()

  expect(reader.wakes({ clusters: ['cl:not-yet'], uris: [] })).toBe(true)
  // and the control that must NOT wake
  expect(reader.wakes({ clusters: ['cl:someone-else'], uris: ['mal:39535'] })).toBe(false)
})

test('memberUrisOf names every member of the clusters asked about, and nothing for none', async () => {
  expect(await memberUrisOf([RUN_ID])).toEqual(
    ['anilist:108465', 'anizip:14758', 'kitsu:42323', 'mal:39535'].sort()
  )
  expect(await memberUrisOf([])).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// 7.1 step 3, THE PLACEHOLDER RE-ASK, which is the whole reason a cluster grows past its first
// answer. The defect this pins is self-reinforcing and therefore silent: a placeholder is not a
// member, so it is in neither `members` nor `handles`; a read that walked those asked nobody about
// it; the row never arrived, so it never became a member. Measured 2026-09-12 on
// `ag:(anilist:108465)`, where `mal:39535` and `kitsu:42323` were answered 0 times on the graph path
// and the page drew four members against the old store's six.

// Mutation: drop `{owned: false}` from the pattern in `placeholdersOf` and every described member of
// the cluster comes back as a placeholder, `mal:39535` and `nf:80987039-1` among them.
test('the cluster reports the uris its members named and nobody described', async () => {
  const placeholders = await placeholdersOf(RUN_ID)
  expect(placeholders.map(placeholder => placeholder.uri), 'both, and only these two').toEqual([
    'anidb:14758', 'tmdb:1399',
  ])
  expect(placeholders[0], 'the origin is what selects the source to ask').toEqual({
    uri: 'anidb:14758', origin: 'anidb', provenance: 'source',
  })
})

// Mutation: add `WHERE cl.provenance <> 'address'` to `placeholdersOf` and the pointer of 3.3 is
// never asked, which is the case that CANNOT recover on its own: an `address` claim never enters the
// closure, so its target stays a placeholder however many passes run.
test('an address pointer is reported too, carrying the provenance that says what it is', async () => {
  const placeholders = await placeholdersOf(RUN_ID)
  expect(placeholders.find(placeholder => placeholder.uri === 'tmdb:1399')).toEqual({
    uri: 'tmdb:1399', origin: 'tmdb', provenance: 'address',
  })
})

test('and a described member is never one, whichever way its claim pointed', async () => {
  const uris = (await placeholdersOf(RUN_ID)).map(placeholder => placeholder.uri)
  for (const described of ['mal:39535', 'anizip:14758', 'kitsu:42323', 'anilist:108465', 'nf:80987039-1']) {
    expect(uris, `${described} answered for itself`).not.toContain(described)
  }
  expect(await placeholdersOf('cl:nothing'), 'and a cluster that does not exist names none').toEqual([])
})

// THE ADDRESS THE ASK IS MADE WITH, which is the half a placeholder read alone does not give: a
// source finds its own handle in the uri it is handed, so the members travel with the placeholders.
// Mutation: return `toAggregatedUri(addressUris(mediaUri))` from `askAddressOf` (the pre-fix
// behaviour, members only) and `anidb` and `tmdb` vanish from the origins asked.
test('the ask address names the members AND the placeholders, so every origin is addressable', async () => {
  const view = await resolveMedia(RUN_ID)
  const address = await askAddressOf(RUN_ID, String(view!.uri))
  expect(originsOfUri(address).sort(), 'the four members and the two placeholders').toEqual(
    ['anidb', 'anilist', 'anizip', 'kitsu', 'mal', 'tmdb']
  )
  expect(addressUris(address), 'and each origin travels with the id that addresses it').toContain('anidb:14758')
  // the origins of the placeholders are what `askOrigins` matches a source on (7.1 step 3), and a
  // source addressable by a foreign id is the class this whole mechanism exists for
  expect(answersForOrigins({ origin: 'anizip', supportedUris: ['anidb', 'mal'] }, originsOfUri(address)))
    .toBe(true)
})

test('and a cluster that names no placeholder is asked nothing at all', async () => {
  const view = await resolveMedia(CONTROL_ID)
  expect(await askAddressOf(CONTROL_ID, String(view!.uri)), 'an empty address is "ask nobody"').toBe('')
})

// ---------------------------------------------------------------------------------------------
// Both spellings (step 3's cache note, decision Q9).

test('addressUris takes both spellings of a one-source address', () => {
  expect(addressUris('ag:(mal:39535)')).toEqual(['mal:39535'])
  expect(addressUris('mal:39535')).toEqual(['mal:39535'])
  expect(addressUris('')).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// THE CLOSED SET, through the real schema with the client's own documents.

// THE NON-NULL HALF NEEDS NO ASSERTION OF ITS OWN: `execute` throws on any error the document
// carried, and a null on a field the schema declares non-null IS an error, which propagates up to
// the nearest nullable parent. So a card missing `handles` does not fail one expectation here, it
// fails the whole page and the throw names it. What is asserted below is the other half: the fields
// the schema lets be null, which a thinned card would quietly answer null for.
const nonNull = (row: Record<string, unknown>, fields: readonly string[], where: string): void => {
  for (const field of fields) expect(row[field], `${where}.${field}`).not.toBeNull()
}

const HANDLE_NODE_FIELDS = ['_id', 'uri', 'origin', 'id', 'url'] as const

// The card is a CLOSED SET, which means a new selection has to extend it: the two cases below
// execute the two listing documents by name, so a THIRD `mediaPage` document added anywhere in the
// client would be checked by nothing at all. This is the case that notices.
test('the client has exactly the two mediaPage documents the closed set executes', () => {
  expect(mediaPageDocuments(clientSources())).toEqual(['GetReleasingMediaPage', 'SearchMediaPage'])
  // the control, so a scan that reports absence is known to be able to report a presence
  expect(mediaPageDocuments([
    'const a = gql(`subscription ThirdPage($input: MediaPageInput!) { mediaPage(input: $input) { nodes { _id } } }`)',
    'const b = gql(`subscription NotAPage { media(input: $input) { _id } }`)',
  ])).toEqual(['ThirdPage'])
})

// Mutation: delete `handles` from `cardOf` in plugins/fields.ts. `Media.handles` is `[MediaHandle!]!`
// inside `MediaPage.nodes: [Media!]!`, so the WHOLE PAGE comes back null and this throws on the
// errors the document carried, which is the failure a card missing one field actually produces.
test('the home row document executes over cards with every selected field present', async () => {
  const data = await execute(`${HOME_PAGE}\n${MEDIA_FRAGMENT}`, {
    input: { nodes: [{ uri: 'mal:39535' }] },
    shortDescriptionInput: { count: 1 },
  })
  const nodes = data.mediaPage.nodes as Record<string, unknown>[]
  expect(nodes.length).toBe(1)
  const node = nodes[0]!

  nonNull(node, ['_id', 'uri', 'origin', 'id', 'url', 'score', 'episodeCount', 'popularity'], 'card')
  for (const field of ['titles', 'covers', 'banners', 'trailers']) {
    expect((node[field] as unknown[]).length, field).toBeGreaterThan(0)
  }
  expect((node.shortDescriptions as unknown[]).length, 'the document asks for one').toBe(1)

  const handles = node.handles as { relation: string, node: Record<string, unknown> }[]
  expect(handles.length, 'a card without handles nulls the whole page').toBeGreaterThan(0)
  for (const handle of handles) nonNull(handle.node, HANDLE_NODE_FIELDS, String(handle.node.uri))
})

// Mutation: any of `averageScore`, `nextAiringEpisode`, `banners` or `score` removed from `cardOf`
// turns its assertion below to null; removing `covers` nulls the page outright.
test('and so does the search page document, which selects the wider half of the set', async () => {
  const data = await execute(`${SEARCH_PAGE}\n${MEDIA_FRAGMENT}`, {
    input: { nodes: [{ uri: 'mal:39535' }] },
    shortDescriptionInput: { count: 1 },
  })
  const node = (data.mediaPage.nodes as Record<string, unknown>[])[0]!

  nonNull(node, ['score', 'averageScore', 'popularity', 'status', 'type', 'season', 'seasonYear'], 'card')
  expect(node.status).toBe('FINISHED')
  expect(node.type).toBe('TV')
  expect(node.season).toBe('WINTER')
  expect(node.seasonYear).toBe(2021)
  expect(node.genres).toEqual(expect.arrayContaining(['Fantasy']))
  expect(node.tags).toEqual(['Isekai'])
  expect(node.nextAiringEpisode).toEqual({ episodeNumber: 12, airingAt: '2021-04-04' })
  expect((node.covers as { color: string | null }[])[0]!.color, '`color` is selected only here').not.toBeNull()

  const handles = node.handles as { node: Record<string, unknown> }[]
  for (const handle of handles) nonNull(handle.node, HANDLE_NODE_FIELDS, String(handle.node.uri))
})

// Mutation: drop the `addressOf` normalization from the relations map in plugins/fields.ts. The
// fixture's relation node carries no `origin` and no `id`, `Media.origin` is `String!` inside a
// `[MediaRelationEdge!]!`, and the whole media comes back null.
test('the modal document executes over the detail view, relations and episodes included', async () => {
  const data = await execute(`${MEDIA_MODAL}\n${MEDIA_FRAGMENT}\n${EPISODE_FRAGMENT}`, {
    input: { uri: 'ag:(mal:39535)' },
    descriptionInput: { type: 'HTML' },
  })
  const media = data.media as Record<string, unknown>
  expect(media._id).toBe(RUN_ID)

  const relations = media.relations as { relation: string, node: { origin: string, id: string } }[]
  expect(relations.length).toBe(1)
  expect(relations[0]!.node.origin, 'derived from the uri, since the source node carried none').toBe('anilist')
  expect(relations[0]!.node.id).toBe('127720')

  const episodes = media.episodes as { episodeNumber: number, handles: unknown[] }[]
  expect(episodes.map(entry => entry.episodeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

  for (const entry of episodes) {
    for (const handle of entry.handles as { node: Record<string, unknown> }[]) {
      nonNull(handle.node, ['_id', 'uri', 'origin', 'id', 'mediaUri'], String(handle.node.uri))
    }
  }
  for (const handle of media.handles as { node: Record<string, unknown> }[]) {
    nonNull(handle.node, HANDLE_NODE_FIELDS, String(handle.node.uri))
  }
  nonNull(media, ['_id', 'uri', 'origin', 'id', 'url', 'episodeCount'], 'media')
})

// THE MAP IS THE APP'S, and these two cases are what that buys. Both strip a field the materialized
// JSON is supposed to carry and both must take the WHOLE payload down, because the app's map has no
// `?? []` over either: `Media.relations` has no resolver at all and `Episode.shortDescriptions`
// answers `undefined` for an absent parent field. Under the friendlier map this file carried until
// 2026-09-12 each returned `[]` and both cases passed, which is exactly the regression a closed-set
// case exists to catch.
//
// Mutation: put `relations: parent => parent.relations ?? []` back into the map above.
test('a view with no relations nulls the modal, since the app has no resolver to cover for it', async () => {
  const { query } = await graphReady()
  const [row] = await query('MATCH (c:Cluster {id: $id}) RETURN c.media AS media', { id: RUN_ID })
  const media = JSON.parse(String(row!.media)) as Record<string, unknown>
  expect(media.relations, 'the control: the plugin DOES materialize it').toBeDefined()

  const { relations: _relations, ...thinned } = media
  await query('MATCH (c:Cluster {id: $id}) SET c.media = $media', { id: RUN_ID, media: JSON.stringify(thinned) })
  await expect(execute(`${MEDIA_MODAL}\n${MEDIA_FRAGMENT}\n${EPISODE_FRAGMENT}`, {
    input: { uri: 'ag:(mal:39535)' },
    descriptionInput: { type: 'HTML' },
  })).rejects.toThrow(/relations/)
  await query('MATCH (c:Cluster {id: $id}) SET c.media = $media', { id: RUN_ID, media: JSON.stringify(media) })
})

// Mutation: put `shortDescriptions: parent => parent.shortDescriptions ?? []` back into the `Episode`
// map above.
test('and an episode with no shortDescriptions does too, through [Episode!]!', async () => {
  const { query } = await graphReady()
  const [row] = await query('MATCH (c:Cluster {id: $id}) RETURN c.episodes AS episodes', { id: RUN_ID })
  const episodes = JSON.parse(String(row!.episodes)) as Record<string, unknown>[]
  expect(episodes[0]!.shortDescriptions, 'the control: the plugin DOES materialize it').toBeDefined()

  const { shortDescriptions: _short, ...first } = episodes[0]!
  await query(
    'MATCH (c:Cluster {id: $id}) SET c.episodes = $episodes',
    { id: RUN_ID, episodes: JSON.stringify([first, ...episodes.slice(1)]) }
  )
  await expect(execute(`${MEDIA_MODAL}\n${MEDIA_FRAGMENT}\n${EPISODE_FRAGMENT}`, {
    input: { uri: 'ag:(mal:39535)' },
    descriptionInput: { type: 'HTML' },
  })).rejects.toThrow(/shortDescriptions/)
  await query('MATCH (c:Cluster {id: $id}) SET c.episodes = $episodes', { id: RUN_ID, episodes: JSON.stringify(episodes) })
})

// ---------------------------------------------------------------------------------------------
// G5, the statement budget, counted rather than claimed. `read.ts`'s own header states these numbers
// and the file had them wrong until 2026-09-12 ("a detail view at most four", where the worst
// reachable resolve is five and a live reader costs six).

/**
 * Counts the statements one read runs, by swapping the shared connection's `query` for the call.
 *
 * COLD, always: the read cache is dropped first, so every number below is what the read costs with
 * nothing memoized. Without that the budget became order dependent the moment the cache landed, and
 * the retired-id case read 4 instead of 5 purely because an earlier line had already materialized the
 * same cluster's view. A budget that moves when you reorder the lines above it is not a budget.
 * What the cache is worth is asserted on its own, below.
 */
const statements = async (work: () => Promise<unknown>): Promise<number> => {
  const graph = await graphReady()
  clearReadCache()
  const real = graph.query
  let count = 0
  graph.query = (cypher, params) => {
    count += 1
    return real(cypher, params)
  }
  try {
    await work()
  } finally {
    graph.query = real
  }
  return count
}

/** The same counter WITHOUT the clear, so two consecutive reads can be compared against each other. */
const statementsWarm = async (work: () => Promise<unknown>): Promise<number> => {
  const graph = await graphReady()
  const real = graph.query
  let count = 0
  graph.query = (cypher, params) => {
    count += 1
    return real(cypher, params)
  }
  try {
    await work()
  } finally {
    graph.query = real
  }
  return count
}

// Mutation: run `resolveById` unconditionally in `resolveMedia` (drop the `!resolved &&` guard) and
// the retired-id count goes to six, which is the shape a page that recurses would have.
test('the statement budget: a page two, an episode list one, a detail view five, a reader six', async () => {
  expect(await statements(() => pageClusters(undefined)), 'the whole store').toBe(1)
  expect(await statements(() => pageClusters(['nf:80987039-1'])), 'seeded, with the hidden hop').toBe(2)
  expect(await statements(() => episodesOf(RUN_ID)), 'one lookup of the materialized list').toBe(1)
  expect(await statements(() => resolveMedia('mal:39535')), 'a member uri: statement 1, then the view').toBe(2)
  // the worst reachable resolve: no member, nothing published, no current cluster, an alias, the view
  expect(await statements(() => resolveMedia(STRAY_ID)), 'a retired cluster id').toBe(5)
  expect(await statements(() => createMediaReader(STRAY_ID).read()), 'and its member uris').toBe(6)

  // AND WHAT THE CACHE BUYS, which is the other half of the same budget: `Cluster.media` and
  // `Cluster.episodes` are columns a pass writes, so between two commits a second read of either is
  // the same bytes and should cost no statement at all. Measured on a real modal, these two were 52
  // and 63 calls for one page load.
  // MUTATED: drop the `materialized.has` early return from `episodesOf` and the warm read costs 1.
  clearReadCache()
  expect(await statementsWarm(() => episodesOf(RUN_ID)), 'a cold list costs its lookup').toBe(1)
  expect(await statementsWarm(() => episodesOf(RUN_ID)), 'a warm one costs nothing').toBe(0)
  // a resolve is TWO statements cold, the address lookup then the view; warm it keeps the lookup and
  // drops the view, which is the one this cache removes
  expect(await statementsWarm(() => resolveMedia('mal:39535')), 'cold: the lookup and the view').toBe(2)
  expect(await statementsWarm(() => resolveMedia('mal:39535')), 'warm: the lookup alone').toBe(1)

  // AND EVERY EVENT THAT MOVES THE GRAPH HAS TO DROP IT. `view:changed` is the one a plugin PASS
  // emits, and a pass is what rewrites these two columns: the ingest's `graph:changed` never fires
  // for it. Listening to the ingest alone leaves the modal showing the view from before the pass for
  // the rest of the session, which is the failure this whole cache would otherwise cause.
  // MUTATED, each separately: delete any one of the three `listen` calls in read.ts and its case here
  // reads 0 instead of 1, because the stale entry answered.
  for (const event of ['view:changed', 'graph:changed', 'row:changed'] as const) {
    await statementsWarm(() => episodesOf(RUN_ID))
    expect(await statementsWarm(() => episodesOf(RUN_ID)), `warm before ${event}`).toBe(0)
    emit(event, { seq: 1, uris: [], episodes: [], claims: [], clusters: [] } as never)
    expect(await statementsWarm(() => episodesOf(RUN_ID)), `${event} drops the cache`).toBe(1)
  }

  const page = createPageReader()
  await page.read(['mal:39535'])
  await writeCluster('cl:budget-run', ['tvdb:9004'])
  await writeCluster('cl:budget-season', ['tvdb:9004-1'], ['cl:budget-run'])
  expect(
    await statements(() => page.apply(['cl:budget-season'], ['tvdb:9004-1'])),
    'the named clusters, then the runs the displaced ones hide behind'
  ).toBe(2)
  await dropClusters('cl:budget-run', 'cl:budget-season')
})

// ---------------------------------------------------------------------------------------------

test('the read store flag defaults to legacy and moves only when asked', () => {
  expect(readStore()).toBe('legacy')
  setReadStore('graph')
  expect(readStore()).toBe('graph')
  setReadStore('legacy')
  expect(readStore()).toBe('legacy')
})

// ---------------------------------------------------------------------------------------------

// BYTES PER CARD on a page nobody chose, which is the step 2 measurement the spec asks for and the
// price of the widened card. It REPORTS rather than asserts a threshold: a figure pinned to one walk
// fails on the next walk rather than on the next bug.
test('the recorded page reports its bytes per card', async () => {
  if (!existsSync(CORPUS)) {
    console.warn(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= 800) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  expect(rows.length, 'a recorded page is about 800 rows (2026-09-12)').toBeGreaterThan(100)

  const seeded = (await pageClusters(undefined)).length
  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])
  await runPass()

  const cards = await pageClusters(undefined)
  expect(cards.length, 'the recorded page adds cards of its own').toBeGreaterThan(seeded)

  const sizes = cards.map(card => JSON.stringify(card).length).sort((a, b) => a - b)
  const total = sizes.reduce((sum, size) => sum + size, 0)
  const handles = cards.reduce((sum, card) => sum + card.handles.length, 0)
  // what the widening COST, priced against the ten fields the card carried before it: the same rows
  // with `origin`, `id`, `url`, `handles`, `score`, `shortDescriptions`, `banners`, `trailers`,
  // `averageScore` and `nextAiringEpisode` taken back off
  const WIDENED = ['origin', 'id', 'url', 'handles', 'score', 'shortDescriptions', 'banners', 'trailers', 'averageScore', 'nextAiringEpisode']
  const narrow = cards
    .map(card => JSON.stringify(Object.fromEntries(Object.entries(card).filter(([key]) => !WIDENED.includes(key)))).length)
    .reduce((sum, size) => sum + size, 0)
  console.info(
    `bytes per card over ${cards.length} cards (${rows.length} recorded rows + the fixtures): ` +
    `mean ${Math.round(total / cards.length)}, median ${sizes[Math.floor(sizes.length / 2)]}, ` +
    `min ${sizes[0]}, max ${sizes.at(-1)}, whole page ${Math.round(total / 1024)} KiB, ` +
    `${(handles / cards.length).toFixed(1)} handles per card; the ten fields 6.1 adds cost ` +
    `${Math.round((total - narrow) / cards.length)} of those bytes per card ` +
    `(${(total / narrow).toFixed(2)}x the card before the widening)`
  )
}, 300_000)
