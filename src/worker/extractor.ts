import type { Plugin, YogaInitialContext } from 'graphql-yoga'
import type { Exchange } from 'urql'

import type { Episode, Media, Origin, Resolvers, SimilarMediaInput } from '../generated/schema/types.generated'
import type { Uri } from 'src/utils/uri'
import type { Episode as StoreEpisode, Origin as StoreOrigin, ClaimedRelation } from './store/types'

import { useOnResolve } from '@envelop/on-resolve'
import { createSchema, createYoga } from 'graphql-yoga'
import { useErrorHandler } from '@envelop/core'
import { useResponseCache } from '@graphql-yoga/plugin-response-cache'
import { Client, fetchExchange, getOperationName } from 'urql'
import { getNamedType, GraphQLError } from 'graphql'
import DataLoader from 'dataloader'
import { pipe, tap } from 'wonka'

import { attach } from '@fkn/lib/packages'

import { typeDefs } from '../generated/schema/typeDefs.generated'
import * as extractorDefinitions from '../sources'
import { merge } from '../utils/merge'
import { defaultResolvers } from './extractor-defaults'
import { collectUris, joinFanout, leaveFanout, openFanout, type Fanout } from './fanout'
import { answersForOrigins, type Answerable } from '../sources/supported'
import { fetch, fetchWithBackoff } from './fetch'
import { isAggregatedUri, fromAggregatedUri, type AggregatedUri } from '../utils/uri'
import { upsertMedia, upsertEpisodes, upsertOrigins, findAggregatedMedia } from './store/db'
import { aggregateMedia, recursivelyUnwrapMediaHandles } from './store/aggregate'
import { normalizeToStoreMedia } from './store/normalize'
import { listenMultipleIterator } from './store/events'
import { readPluginPayload, readPluginSources } from './plugin-sources'
import { recordAnswers } from './graph/answers'
// `./graph/read` and not `./graph`, which would drag every plugin in behind a flag that is off
import { readStore, resolveMedia } from './graph/read'
import { canBeContained, describeEvidence, hasEvidence, isRunAnswerFrom, printableToken, similarAskKey, type SimilarOutcome } from '../sources/similar'
import { CONTAINING_MEDIA_DOCUMENT, SIMILAR_MEDIA_DOCUMENT } from './similar-document'
import { closeRoot, descend, openRoot, readContext, stamp, type RequestContext, type RootOperation } from './request-context'

export type ExtractorServerContext = YogaInitialContext & {
  fetch: typeof fetch
  key: (origin: string) => string | undefined
  findAggregatedMedia: (uri: string) => Promise<Media | undefined>
  listenForMediaChanges: (params: { uri: string }, options?: { abortSignal?: AbortSignal }) => AsyncGenerator<Media | undefined>
  /**
   * Ask ONE other origin which of its runs of a show is ours, by evidence about our run. See
   * `similarMediaFrom` below for what it costs and what it refuses.
   */
  similarMedia: (origin: string, input: SimilarMediaInput) => Promise<Media | undefined>
}

export type ExtractorUserContext = {

}

let userKeys: Record<string, string> = {}
export const setUserKeys = (keys: Record<string, string>) => { userKeys = keys ?? {} }

const normalizeToStoreEpisode = (episode: Episode): StoreEpisode => ({
  uri: episode.uri as Uri,
  origin: episode.origin,
  id: episode.id,
  url: episode.url ?? null,
  embedUrl: episode.embedUrl ?? null,
  mediaUri: episode.mediaUri as Uri,
  score: episode.score ?? null,
  titles: episode.titles ?? [],
  descriptions: episode.descriptions ?? [],
  shortDescriptions: episode.shortDescriptions ?? [],
  thumbnails: episode.thumbnails ?? [],
  releaseDate: episode.releaseDate ?? null,
  seasonNumber: episode.seasonNumber ?? null,
  episodeNumber: episode.episodeNumber ?? null,
  absoluteEpisodeNumber: episode.absoluteEpisodeNumber ?? null,
  runtime: episode.runtime ?? null,
})

const normalizeOrigin = (origin: { id: string; url?: string | null; name: string; icon?: string | null; color?: string | null; isApiOnly: boolean }): StoreOrigin => ({
  id: origin.id,
  url: origin.url ?? null,
  name: origin.name,
  icon: origin.icon ?? null,
  color: origin.color ?? null,
  isApiOnly: origin.isApiOnly,
})

const findAggregatedMediaForContext = async (uri: string): Promise<Media | undefined> => {
  // The seven `waitForMedia` callers block on this, so it follows the read store rather than the old
  // one: a source waiting on a row the app is no longer reading waits forever.
  if (readStore() === 'graph') return await resolveMedia(uri) as unknown as Media | undefined
  let cluster = await findAggregatedMedia(uri)
  if (!cluster.length && isAggregatedUri(uri)) {
    const parsed = fromAggregatedUri(uri as AggregatedUri)
    for (const handleUri of parsed?.handleUris ?? []) {
      cluster = await findAggregatedMedia(handleUri)
      if (cluster.length) break
    }
  }
  if (!cluster.length) return undefined
  return aggregateMedia(cluster, location.origin)
}

const listenForMediaChangesForContext = async function* (
  params: { uri: string },
  options?: { abortSignal?: AbortSignal }
) {
  yield await findAggregatedMediaForContext(params.uri)

  // `view:changed` fires AFTER the pass wrote the row this re-reads, where the other two fire at the
  // commit before it (4.5): a caller woken by those on the graph store reads the state it already had.
  const iterator = readStore() === 'graph'
    ? listenMultipleIterator(['view:changed'], { abortSignal: options?.abortSignal })
    : listenMultipleIterator(['media:changed', 'episode:changed'], { abortSignal: options?.abortSignal })
  for await (const _ of iterator) {
    yield await findAggregatedMediaForContext(params.uri)
  }
}

const mediaInserter = new DataLoader<Media, Media>(async (medias) => {
  const allUnwrapped = (medias as Media[]).flatMap(recursivelyUnwrapMediaHandles)

  // The relation rides all the way to the store, because it is the store that acts on it: SAME_AS
  // unions the cluster and PART_OF hangs a directed edge that unions nothing. Deduping on the RELATION
  // too, not just the pair, so one media may hold both kinds for one origin without either silently
  // winning on arrival order.
  const handlePairs: { mediaUri: string; handleUri: string; relation: ClaimedRelation }[] = []
  const seen = new Set<string>()
  for (const media of allUnwrapped) {
    for (const handle of media.handles ?? []) {
      // a handle naming no node claims nothing; the row it sits on still lands
      if (!handle?.node) continue
      const key = `${media.uri}\0${handle.node.uri}\0${handle.relation}`
      if (!seen.has(key)) {
        seen.add(key)
        handlePairs.push({ mediaUri: media.uri, handleUri: handle.node.uri, relation: handle.relation })
      }
    }
  }

  await upsertMedia(allUnwrapped.map(normalizeToStoreMedia), handlePairs)
  return medias
}, {
  cache: false,
  batch: true,
  maxBatchSize: 250,
  batchScheduleFn: (callback) => setTimeout(callback, 50)
})

const episodeInserter = new DataLoader<Episode, Episode>(async (episodes) => {
  const handlePairs: { episodeUri: string; handleUri: string; relation: ClaimedRelation }[] = []
  for (const episode of episodes as Episode[]) {
    for (const handle of episode.handles ?? []) {
      if (!handle?.node) continue
      handlePairs.push({ episodeUri: episode.uri, handleUri: handle.node.uri, relation: handle.relation })
    }
  }

  await upsertEpisodes((episodes as Episode[]).map(normalizeToStoreEpisode), handlePairs)
  return episodes
}, {
  cache: false,
  batch: true,
  maxBatchSize: 250,
  batchScheduleFn: (callback) => setTimeout(callback, 50)
})

const originInserter = new DataLoader<Origin, Origin>(async (origins) => {
  await upsertOrigins((origins as Origin[]).map(o => normalizeOrigin({ ...o, url: o.url ?? null, icon: o.icon ?? null, color: o.color ?? null })))
  return origins
}, {
  cache: false,
  batch: true,
  maxBatchSize: 50,
  batchScheduleFn: (callback) => setTimeout(callback, 50)
})

export type ExtractorDefinition = {
  origin: string
  originUrl: string
  name: string
  icon?: string | null
  color?: string | null
  isApiOnly: boolean
  metadataOnly?: boolean
  resolvers: Resolvers
}

/**
 * One origin, one show id, and evidence about OUR run; the answer is that origin's own run or nothing.
 *
 * WHY THIS EXISTS. Stub models a broadcast run; every catalogue models a show. A source holding a
 * show-level link (Kitsu publishes Crunchyroll's `/series/<id>/` url on EVERY season record) has
 * something true about the show and nothing it may honestly mint as a handle, because a handle is an
 * identity claim and `graph.link` is a union-find union with no inverse. Dropping the link loses a
 * real offer; minting it welds every season of the show. This is the third option: hand the show id
 * back to the origin that owns it, say what we know about our run, and take the run it names, which
 * IS an honest identity and links like any other.
 *
 * WHY EVIDENCE AND NOT A SEASON NUMBER. Season numbers do not agree across platforms: Netflix folds
 * two cours into one season, JustWatch numbers by its own list, anime metadata says "Season 2 Part 2".
 * An id minted by ordinal is a guess wearing a precise uri, and on 2026-09-05 two such guesses met in
 * `nf:80987039-3`. What establishes sameness is decided in `sources/similar.ts`, once, and every
 * answering source goes through it.
 *
 * THE SELECTION is `SIMILAR_MEDIA_DOCUMENT` in ./similar-document.ts, with what it selects and why.
 */

// A source may walk every season of a show to answer, which is one request per season on top of the
// seasons call, so this is generous. It is a backstop against a source that never yields, not a
// latency budget: the common answers, a hit and a refusal, both arrive on the first payload.
const SIMILAR_MEDIA_TIMEOUT_MS = 30_000

/**
 * Cycles are ALLOWED here, by decision: a source may call `similarMedia` from inside its own
 * `similarMedia` resolver, and nothing removes that capability. What is bounded is the part that
 * cannot make progress anyway.
 *
 * A repeat of a question already being answered is the only cycle this can see for certain, and
 * returning the in-flight promise to its own caller would deadlock it, so the nested ask is declined
 * with a warning and the OUTER call carries on. The ceiling is the blunt half: a mutual recursion
 * that varies its show id every hop is not a repeat, so nothing above would catch it, and this stops
 * it costing the worker rather than a log line.
 *
 * Neither is exact detection. That would need the call chain threaded through the request, and the
 * only honest places to put it are the public input or a module-level stack, which a browser worker
 * cannot keep straight across awaits (no AsyncLocalStorage). Worth revisiting if a real cycle ever
 * shows up in the warnings.
 */
const MAX_CONCURRENT_SIMILAR_MEDIA = 32

/**
 * And a per-caller share, because the ceiling above is global and a third-party source can spend it.
 *
 * A plugin may register a `similarMedia` resolver that simply never yields, and a slot is then held
 * for the full SIMILAR_MEDIA_TIMEOUT_MS. Enough of those pin the global ceiling, and the next
 * FIRST-PARTY ask is refused: the page looks exactly like a source that had no answer. A per-caller
 * share cannot stop a plugin wasting its own budget, which is fine, and does stop it spending
 * anybody else's.
 */
const MAX_SIMILAR_MEDIA_PER_CALLER = 8

/**
 * What a showId may look like, checked ONCE here rather than in each of the 23 sources.
 *
 * Every source interpolates ids straight into a url (`${CMS}/series/${id}/seasons`, `/tv/${showId}`,
 * `/series/${id}/extended`), which was safe for as long as an id could only have come out of an
 * upstream response. This endpoint is the first place an id is chosen by the CALLER, and a plugin is
 * a caller. `..` segments normalise and a `?` or `#` terminates the path, so an unchecked id steers
 * which path on that host gets fetched and what query it carries. The host cannot move, since the
 * prefix is absolute, and the method, headers and body are the source's own, so this is the whole of
 * the exposure and it closes here.
 *
 * The character set is the union of every id shape actually in use: Crunchyroll `G24H1N3MP`, Apple TV
 * `umc.cmc.1srk2goyh2q2zdxcx605w8vtx`, a Hulu uuid, a numeric TVmaze or TMDB id, and a trakt slug
 * like `mushoku-tensei-jobless-reincarnation`.
 */
const SAFE_SHOW_ID = /^[A-Za-z0-9._~-]{1,128}$/

const similarAsksInFlight = new Map<string, Promise<SimilarOutcome<Media>>>()
const asksByCaller = new Map<string, number>()

/** How one subscription to a source's `similarMedia` ended, before the answer is judged. */
type Delivered = { kind: 'media', media: Media } | { kind: 'null' } | { kind: 'error' } | { kind: 'timeout' }

const firstSimilarMedia = (
  extractor: ReturnType<typeof makeExtractor>,
  input: SimilarMediaInput,
  /** which question is being put: the two documents differ only in the field they select. */
  field: 'similarMedia' | 'containingMedia' = 'similarMedia'
): Promise<Delivered> =>
  new Promise(resolve => {
    let settled = false
    let subscription: { unsubscribe: () => void } | undefined
    const finish = (delivered: Delivered) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // the callback can fire before `subscribe` has returned, so unsubscribing is deferred a tick
      queueMicrotask(() => { try { subscription?.unsubscribe() } catch { /* already gone */ } })
      resolve(delivered)
    }
    const timer = setTimeout(() => finish({ kind: 'timeout' }), SIMILAR_MEDIA_TIMEOUT_MS)
    try {
      subscription =
        extractor.client
          .subscription(field === 'containingMedia' ? CONTAINING_MEDIA_DOCUMENT : SIMILAR_MEDIA_DOCUMENT, { input })
          .subscribe(result => {
            if (result.error) return finish({ kind: 'error' })
            // any DELIVERED payload settles this, including an explicit null. A source that cannot
            // answer yields null once and ends, and waiting out the timeout for that would turn the
            // ordinary refusal into the slowest path in the system.
            if (!result.data) return
            const media = (result.data as Record<string, Media | null | undefined>)[field]
            finish(media ? { kind: 'media', media } : { kind: 'null' })
          })
    } catch (error) {
      console.error(new Error(`Extractor ${extractor.name} failed to answer ${field}`, { cause: error }))
      finish({ kind: 'error' })
    }
  })

/**
 * Whether a source answers `similarMedia` at all. Read off the DEFINITION's resolvers, never the
 * merged schema, so the yield-null default in `makeExtractor` counts as "not implemented" and a
 * caller can skip the subscription round trip that would only ever answer null.
 */
export const implementsSimilarMedia = (origin: string): boolean =>
  extractors.some(entry =>
    entry.extractor.origin === origin
    && Boolean((entry.extractor.resolvers.Subscription as { similarMedia?: unknown } | undefined)?.similarMedia))

/**
 * Whether a source answers `containingMedia`, read the same way and for a sharper reason: the second
 * question costs a second walk of the same show, and a source that cannot answer it must not be made
 * to walk anything at all. Four of the five sources answering `similarMedia` implement nothing here
 * and are never asked.
 */
export const implementsContainingMedia = (origin: string): boolean =>
  extractors.some(entry =>
    entry.extractor.origin === origin
    && Boolean((entry.extractor.resolvers.Subscription as { containingMedia?: unknown } | undefined)?.containingMedia))

/**
 * The SECOND question, put only where the first came to nothing: "does one of your seasons HOLD this
 * run" (4.4).
 *
 * It is a separate subscription because it is a separate field, and it is asked AFTER the first rather
 * than beside it because the two answers are mutually exclusive and the first is the one worth having:
 * a run that has a season needs no container, and a source that answered one must not be walked twice.
 * Undefined means "nothing to say here", so the caller keeps the refusal the first question earned; a
 * timeout or an error is a DECLINE, because it never reached the source and the pair is not settled.
 *
 * A source that does not implement the field is never subscribed to at all, which is what keeps this
 * free for the four `similarMedia` answerers that do not ship it.
 */
const containingOutcome = async (
  extractor: ReturnType<typeof makeExtractor>,
  origin: string,
  input: SimilarMediaInput,
  caller: string
): Promise<SimilarOutcome<Media> | undefined> => {
  const { showId } = input
  if (!implementsContainingMedia(origin)) return undefined
  // THE SECOND WALK IS THE COST, so the evidence is read before it is paid rather than after. Every
  // containment axis is a comparison against our own length, so a run with no count is inside nothing
  // and the source would walk the whole show again only to say so (`canBeContained`,
  // sources/similar.ts). Undefined and never a decline: the first question's refusal is the outcome,
  // and a decline would have the consumer re-ask the whole pair on the next read.
  if (!canBeContained(input)) {
    console.warn(`containingMedia: not asked ${origin} ${showId} for '${caller}' (${describeEvidence(input)} carries no count to be longer than)`)
    return undefined
  }
  console.warn(`containingMedia: asked ${origin} ${showId} by '${caller}' with ${describeEvidence(input)}`)
  const delivered = await firstSimilarMedia(extractor, input, 'containingMedia')
  if (delivered.kind === 'media') {
    // the SHOW is not a container answer either: the bare title is already what the run hangs under,
    // it asserts nothing about where the run is, and a `PART_OF` onto it would claim a fact nobody
    // measured. Only a season of that show can hold a run.
    if (!isRunAnswerFrom(origin, showId, delivered.media)) {
      console.warn(`containingMedia: refused ${origin} ${showId} to '${caller}' (not-a-run ${delivered.media.uri} scope ${delivered.media.scope ?? 'RUN'})`)
      return { outcome: 'refused', reason: 'not-a-run' }
    }
    console.warn(`containingMedia: containing ${delivered.media.uri} to '${caller}' for ${origin} ${showId} (${delivered.media.episodeCount ?? '-'} episodes)`)
    return { outcome: 'containing', media: delivered.media }
  }
  if (delivered.kind === 'timeout') {
    console.warn(`containingMedia: declined ${origin} ${showId} to '${caller}' (timeout ${SIMILAR_MEDIA_TIMEOUT_MS}ms)`)
    return { outcome: 'declined', reason: 'timeout' }
  }
  if (delivered.kind === 'error') {
    console.warn(`containingMedia: declined ${origin} ${showId} to '${caller}' (error)`)
    return { outcome: 'declined', reason: 'error' }
  }
  console.warn(`containingMedia: refused ${origin} ${showId} to '${caller}' (null)`)
  return undefined
}

/**
 * The ask, bound to the origin doing the asking so a budget can be attributed to it, answering with
 * an outcome and never an error: `declined` never reached the source (no evidence, a showId that is
 * not an id, an origin that does not implement the field, a ceiling, a timeout, an error) and may be
 * retried; `refused` did reach it (null, or an answer that is not a RUN of the asked origin) and is
 * final for that evidence; `answered` carries the run.
 *
 * THE DEDUPE KEY IS THE QUESTION, NORMALISED, by `similarAskKey` in sources/similar.ts: the day, the
 * count, the ordinals the titles agree on, whether any names a part, and the real episode titles.
 * Two asks agreeing on all of it are one question and share one answer; two differing only in their
 * episode titles are two runs of one year (the only evidence Rule 2 has to tell them apart) and a
 * join there would hand the second run the first run's season.
 *
 * Every branch says what it did on one `similarMedia: ` line, for EVERY caller: the funnel is the one
 * place that sees them all, and scripts/check-similar-media.mjs reads these lines off the deployed
 * worker's console.
 */
export const similarOutcomeFrom = (caller: string) =>
  async (origin: string, input: SimilarMediaInput): Promise<SimilarOutcome<Media>> => {
    if (!origin || !input?.showId || !hasEvidence(input)) {
      console.warn(`similarMedia: declined ${printableToken(origin)} ${printableToken(input?.showId)} to '${caller}' (no-evidence)`)
      return { outcome: 'declined', reason: 'no-evidence' }
    }
    // one hop deeper, carrying the caller's origin, so the answering source can see the chain it is
    // part of. A caller that passed no context of its own descends from nothing and the callee reads
    // a miss, which is counted rather than guessed at.
    const parent = readContext(input)
    if (parent) input = { ...input, context: descend(parent, caller) }
    const { showId } = input
    if (!SAFE_SHOW_ID.test(showId)) {
      console.warn(`similarMedia: declined ${origin} ${printableToken(showId)} to '${caller}' (bad-show-id)`)
      return { outcome: 'declined', reason: 'bad-show-id' }
    }
    const extractor = implementsSimilarMedia(origin) ? extractors.find(candidate => candidate.extractor.origin === origin) : undefined
    if (!extractor) {
      console.warn(`similarMedia: declined ${origin} ${showId} to '${caller}' (not-implemented)`)
      return { outcome: 'declined', reason: 'not-implemented' }
    }

    /**
     * A repeat of a question already in flight JOINS it rather than being refused.
     *
     * Most repeats are not cycles. Measured on the real app the first time this shipped: two kitsu
     * records for one show asked `(cr, GT00374354, 2026-07-07)` concurrently, and refusing the second
     * cost it its Crunchyroll handle for no reason, since the answer was seconds away. Sharing the
     * promise gives both the right answer and costs one upstream walk instead of two.
     *
     * A genuine cycle joins its own ancestor, which cannot settle until the ancestor does. That is a
     * stall rather than a deadlock: the ancestor's `firstSimilarMedia` timer settles it at
     * SIMILAR_MEDIA_TIMEOUT_MS and the whole chain unwinds with undefined. Bounded, warned about,
     * and not prevented, which is the shape asked for.
     */
    const key = similarAskKey(origin, showId, input)
    const inFlight = similarAsksInFlight.get(key)
    if (inFlight) {
      // the joined ask's own answered or refused line fires once, for the caller that made it
      console.warn(`similarMedia: joined ${origin} ${showId} by '${caller}' (in flight with the same evidence)`)
      return inFlight
    }

    const byCaller = asksByCaller.get(caller) ?? 0
    if (byCaller >= MAX_SIMILAR_MEDIA_PER_CALLER || similarAsksInFlight.size >= MAX_CONCURRENT_SIMILAR_MEDIA) {
      console.warn(`similarMedia: declined ${origin} ${showId} to '${caller}' (ceiling ${byCaller}/${MAX_SIMILAR_MEDIA_PER_CALLER} by caller, ${similarAsksInFlight.size}/${MAX_CONCURRENT_SIMILAR_MEDIA} global)`)
      return { outcome: 'declined', reason: 'ceiling' }
    }

    asksByCaller.set(caller, byCaller + 1)
    console.warn(`similarMedia: asked ${origin} ${showId} by '${caller}' with ${describeEvidence(input)}`)
    const ask =
      firstSimilarMedia(extractor, input)
        .then(async (delivered): Promise<SimilarOutcome<Media>> => {
          if (delivered.kind === 'media') {
            // the show itself, a container, or another origin's row is not an answer: claiming any of
            // them as SAME_AS of the caller's run is the weld the caller asked in order to avoid
            if (!isRunAnswerFrom(origin, showId, delivered.media)) {
              console.warn(`similarMedia: refused ${origin} ${showId} to '${caller}' (not-a-run ${delivered.media.uri} scope ${delivered.media.scope ?? 'RUN'})`)
              return { outcome: 'refused', reason: 'not-a-run' }
            }
            console.warn(`similarMedia: answered ${delivered.media.uri} to '${caller}' for ${origin} ${showId}`)
            return { outcome: 'answered', media: delivered.media }
          }
          if (delivered.kind === 'null') {
            // the second question, and the only place it is ever put: no season IS the run, so ask
            // whether one HOLDS it (4.4)
            const container = await containingOutcome(extractor, origin, input, caller)
            if (container) return container
            console.warn(`similarMedia: refused ${origin} ${showId} to '${caller}' (null)`)
            return { outcome: 'refused', reason: 'null' }
          }
          if (delivered.kind === 'timeout') {
            console.warn(`similarMedia: declined ${origin} ${showId} to '${caller}' (timeout ${SIMILAR_MEDIA_TIMEOUT_MS}ms)`)
            return { outcome: 'declined', reason: 'timeout' }
          }
          console.warn(`similarMedia: declined ${origin} ${showId} to '${caller}' (error)`)
          return { outcome: 'declined', reason: 'error' }
        })
        .finally(() => {
          similarAsksInFlight.delete(key)
          const left = (asksByCaller.get(caller) ?? 1) - 1
          if (left > 0) asksByCaller.set(caller, left)
          else asksByCaller.delete(caller)
        })
    similarAsksInFlight.set(key, ask)
    return ask
  }

/**
 * The same ask as `similarOutcomeFrom`, answering the run or undefined: the contract `ctx.similarMedia`
 * and a plugin's delegate keep, where a source has no use for why it got nothing.
 */
export const similarMediaFrom = (caller: string) => {
  const ask = similarOutcomeFrom(caller)
  return async (origin: string, input: SimilarMediaInput): Promise<Media | undefined> => {
    const result = await ask(origin, input)
    return result.outcome === 'answered' ? result.media : undefined
  }
}

/**
 * How a provider server differs from a media source's. A media source takes every default; a tracker
 * takes none of these, because its answer is the viewer's own and moves on every write.
 */
export type ExtractorOptions = {
  /** Serve a repeated query from a 15 minute cache. */
  responseCache?: boolean
  /** Insert every Media, Episode and Origin the server resolves into the metadata store. */
  ingest?: boolean
  /** Extra fields for each request's context, beside the ones every provider gets. */
  context?: () => Record<string, unknown>
}

export const makeExtractor = (
  extractor: ExtractorDefinition,
  { responseCache = true, ingest = true, context }: ExtractorOptions = {}
) => {
  const originData = normalizeOrigin({ ...extractor, id: extractor.origin, url: extractor.originUrl, icon: extractor.icon ?? null, color: extractor.color ?? null })

  // the rows every answer names go into the metadata store, which is what a media source is for
  const ingestPlugin: Plugin = {
    onPluginInit: ({ addPlugin }) => {
      addPlugin(useOnResolve(({ info }) =>
        async ({ result }) => {
          const named = getNamedType(info.returnType).name
          // The answer log is started BESIDE the inserters, never after them: both coalesce on a
          // 50 ms window, so awaiting them in series would add the two windows together on every
          // resolve. It returns undefined with the `?graph` flag down, which is the whole of its
          // cost there.
          const logged = recordAnswers(info, named, result)
          if (named === 'Media') {
            if (Array.isArray(result)) {
              await mediaInserter.loadMany(result as Media[])
            } else if (result) {
              await mediaInserter.load(result as Media)
            }
          } else if (named === 'Episode') {
            if (Array.isArray(result)) {
              await episodeInserter.loadMany(result as Episode[])
            } else if (result) {
              await episodeInserter.load(result as Episode)
            }
          } else if (named === 'Origin') {
            if (Array.isArray(result)) {
              await originInserter.loadMany(result as Origin[])
            } else if (result) {
              await originInserter.load(result as Origin)
            }
          }
          await logged
        }
      ))
    }
  }

  const server = createYoga<Omit<ExtractorServerContext, keyof YogaInitialContext>, ExtractorUserContext>({
    schema: createSchema<Omit<ExtractorServerContext, keyof YogaInitialContext>>({
      typeDefs,
      resolvers: merge(defaultResolvers(originData), extractor.resolvers) as Resolvers
    }),
    plugins: [
      ...(responseCache ? [useResponseCache({ session: () => null, ttl: 15 * 60 * 1000 })] : []),
      ...(ingest ? [ingestPlugin] : [])
    ],
    maskedErrors: {
      maskError(error, message, isDev) {
        console.error(`Server Extractor ${extractor.name} GQLError occurred:`, error)
        return new GraphQLError((error as Error).message)
      },
    }
  })

  const errorExchange: Exchange = ({ forward }) => (ops$) => {
    return pipe(
      forward(ops$),
      tap((result) => {
        if (result.error) {
          if (result.error.networkError) {
            console.error(new Error(`Client Extractor ${extractor.name} Network error on ${getOperationName(result.operation.query)}:`, { cause: result.error.networkError }))
          }
          if (result.error.graphQLErrors?.length) {
            result.error.graphQLErrors.forEach((err) => {
              console.error(new Error(`Client Extractor ${extractor.name} GraphQL error on ${getOperationName(result.operation.query)}:`, { cause: err }))
            })
          }
        }
      })
    )
  }

  const client = new Client({
    url: 'http://d/graphql',
    exchanges: [errorExchange, fetchExchange],
    fetchSubscriptions: true,
    fetch: async (input: Parameters<typeof globalThis.fetch>[0], init: Parameters<typeof globalThis.fetch>[1]) =>
      server.handleRequest(
        new Request(input, init),
        {
          ...context?.(),
          fetch: fetchWithBackoff,
          key: (origin: string) => userKeys[origin],
          findAggregatedMedia: (uri: string) => findAggregatedMediaForContext(uri),
          listenForMediaChanges: listenForMediaChangesForContext,
          similarMedia: similarMediaFrom(extractor.origin)
        }
      )
  })

  return {
    name: extractor.name,
    server,
    client,
    extractor,
    pluginUri: undefined as string | undefined
  }
}

// a lambda and never `.map(makeExtractor)`, which would hand the index over as the options
export const extractors = Object.values(extractorDefinitions).map(definition => makeExtractor(definition))

// data fields materialize locally, resolver functions stay remote and execute inside the plugin's own sandbox frame

/** Everything a plugin source is handed. One function, and see `delegate` below for why only this one. */
type RemotePluginContext = { similarMedia: ExtractorServerContext['similarMedia'] }
type RemotePluginSubscribe = (parent: undefined, args: unknown, ctx: RemotePluginContext) => Promise<AsyncIterable<any>>
/** One connection may carry several sources, so a package can ship a whole family of them. */
type RemotePluginPayload = RemotePluginSource & { sources?: unknown }
type RemotePluginSource = {
  origin?: unknown
  originUrl?: unknown
  name?: unknown
  icon?: unknown
  color?: unknown
  isApiOnly?: unknown
  metadataOnly?: unknown
  resolvers?: {
    Subscription?: {
      media?: { subscribe?: RemotePluginSubscribe }
      mediaPage?: { subscribe?: RemotePluginSubscribe }
      similarMedia?: { subscribe?: RemotePluginSubscribe }
      containingMedia?: { subscribe?: RemotePluginSubscribe }
    }
  }
}

// nested handles stay untouched: cross-origin handles are how clustering works (accepted residual, bounded by the aggregation score threshold)
type PluginField = 'media' | 'mediaPage' | 'similarMedia' | 'containingMedia'

const enforcePluginOrigin = (origin: string, field: PluginField, payload: any): any => {
  // similarMedia answers with one media, exactly as `media` does, so it is held to the same rule: a
  // plugin may only ever name ITS OWN run. Without this a plugin asked about its own show could
  // answer with someone else's uri and have it linked as an identity. containingMedia answers with
  // one media too, and the rule is the same one for the same reason: an origin naming another
  // origin's row as the season holding our run is claiming something it cannot know.
  if (field === 'media' || field === 'similarMedia' || field === 'containingMedia') {
    if (payload?.[field] && payload[field].origin !== origin) {
      console.warn(`Plugin source '${origin}' yielded media from origin '${payload[field].origin}', dropped`)
      return { [field]: null }
    }
    return payload
  }
  const nodes = payload?.mediaPage?.nodes
  if (!Array.isArray(nodes)) return payload
  const kept = nodes.filter((node: any) => {
    if (node?.origin === origin) return true
    console.warn(`Plugin source '${origin}' yielded media from origin '${node?.origin}', dropped`)
    return false
  })
  return { ...payload, mediaPage: { ...payload.mediaPage, nodes: kept } }
}

const makeDelegatingResolvers = (origin: string, remote: RemotePluginSource): Resolvers => {
  const subscription = remote.resolvers?.Subscription
  const delegate = (field: PluginField) => ({
    subscribe: async function* (_parent: unknown, args: unknown) {
      const subscribe = subscription?.[field]?.subscribe
      if (!subscribe) return
      /**
       * The ctx a plugin sees is EXACTLY one function and never the real one. Stub's privileged
       * context, the proxy fetch, the user's API keys and the store reads, still does not cross to
       * third-party code; what crosses is the ability to ask a first-party source "which run of this
       * show is the one this evidence describes", which is the same question the app asks on the
       * plugin's behalf anyway.
       *
       * Deliberate, and worth knowing rather than assuming: a plugin CAN now cause a key-gated source
       * to spend the user's key on a request it did not initiate. The surface is narrow, scalars and
       * strings that every implementation compares rather than interpolates into a url, and the
       * answer it gets back is a media the app was going to fetch anyway. It is not nothing, which is
       * why it is written down here next to the code rather than in a commit message.
       */
      for await (const payload of await subscribe(undefined, args, { similarMedia: similarMediaFrom(origin) })) {
        // a plugin written against `handles: [Media!]!` sends bare rows where the store reads edges
        yield enforcePluginOrigin(origin, field, readPluginPayload(field, payload))
      }
    }
  })
  return {
    Query: {},
    Mutation: {},
    Subscription: {
      ...(subscription?.media?.subscribe ? { media: delegate('media') } : {}),
      ...(subscription?.mediaPage?.subscribe ? { mediaPage: delegate('mediaPage') } : {}),
      ...(subscription?.similarMedia?.subscribe ? { similarMedia: delegate('similarMedia') } : {}),
      ...(subscription?.containingMedia?.subscribe ? { containingMedia: delegate('containingMedia') } : {}),
    }
  } as Resolvers
}

// the plugin frame renders its own picker, so the app needs both the package to show and the call
// that drives it; keyed by origin because that is all the source selector knows about a source
type RemotePicker = { pluginUri: string, select: (uris: string[]) => Promise<string | null> }
const pickers = new Map<string, RemotePicker>()

export const remotePicker = (origin: string): { pluginUri: string } | null => {
  const picker = pickers.get(origin)
  return picker ? { pluginUri: picker.pluginUri } : null
}

export const selectRemoteRelease = async (origin: string, uris: string[]): Promise<string | null> => {
  const picker = pickers.get(origin)
  if (!picker) return null
  return (await picker.select(uris)) ?? null
}

// A source that plays its own releases, unlike the picker, is only ever announced here: the app MOUNTS
// the package's frame in its player area and calls `play` on that connection, not on this one. The two
// are different documents of the same package, so a call made here would render into a frame nobody is
// looking at. All the app needs from the worker is which package to mount.
const players = new Map<string, string>()

export const remotePlayer = (origin: string): { pluginUri: string } | null => {
  const pluginUri = players.get(origin)
  return pluginUri ? { pluginUri } : null
}

export const registerRemoteExtractor = async (
  port: MessagePort,
  pluginUri: string
): Promise<{ sources: { origin: string, name: string }[], rejected: { origin: string, reason: string }[] }> => {
  const remote = await attach(port) as RemotePluginPayload
  const { sources, rejected } = readPluginSources(remote, pluginUri)

  // a reconnect re-registers the same plugin, so drop its own previous entries before the collision check
  unregisterRemoteExtractor(pluginUri)

  const registered: { origin: string, name: string }[] = []
  const failed = [...rejected]
  for (const { meta, source } of sources) {
    try {
      if (extractors.some(entry => entry.extractor.origin === meta.origin)) {
        throw new Error(`origin '${meta.origin}' is already registered by another source`)
      }
      const entry = makeExtractor({ ...meta, resolvers: makeDelegatingResolvers(meta.origin, source as RemotePluginSource) })
      entry.pluginUri = pluginUri
      extractors.push(entry)
      const select = (source as { selectRelease?: unknown }).selectRelease
      if (typeof select === 'function') {
        pickers.set(meta.origin, { pluginUri, select: select as RemotePicker['select'] })
      }
      if (typeof (source as { play?: unknown }).play === 'function') players.set(meta.origin, pluginUri)
      for (const fanout of fanouts) joinFanout(fanout, entry)
      registered.push({ origin: meta.origin, name: meta.name })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(new Error(`plugin '${pluginUri}': source '${meta.origin}' failed to register`, { cause: error }))
      failed.push({ origin: meta.origin, reason })
    }
  }

  for (const entry of failed) {
    console.warn(`plugin '${pluginUri}': skipped source '${entry.origin}' (${entry.reason})`)
  }
  if (!registered.length) {
    const detail = failed.map(entry => `${entry.origin}: ${entry.reason}`).join('; ')
    throw new Error(`plugin '${pluginUri}': no source could be registered${detail ? ` (${detail})` : ''}`)
  }

  return { sources: registered, rejected: failed }
}

export const unregisterRemoteExtractor = (pluginUri: string) => {
  for (const [origin, picker] of pickers) {
    if (picker.pluginUri === pluginUri) pickers.delete(origin)
  }
  for (const [origin, uri] of players) {
    if (uri === pluginUri) players.delete(origin)
  }
  for (let index = extractors.length - 1; index >= 0; index -= 1) {
    const entry = extractors[index]!
    if (entry.pluginUri !== pluginUri) continue
    extractors.splice(index, 1)
    for (const fanout of fanouts) leaveFanout(fanout, entry)
  }
}

type ExtractorEntry = (typeof extractors)[number]

type SubscriptionArgs = Parameters<ExtractorEntry['client']['subscription']>

// every in-flight media fan-out, so a source that registers mid-subscription can still join it
const fanouts = new Set<Fanout<ExtractorEntry>>()

export const proxyRequestToExtractors = (
  ctx: ExtractorServerContext,
  operation: RootOperation,
  extractUris?: (result: any) => string[]
) => {
  const root = openRoot(operation)
  const insertedUris = new Set<string>()
  const fanout = openFanout({
    entries: extractors,
    query: ctx.params.query!,
    variables: ctx.params.variables,
    root,
    onResult: extractUris ? collectUris(extractUris, insertedUris) : undefined,
  })
  fanouts.add(fanout)

  /**
   * Ask a subset of the sources again, with a question they can actually answer.
   *
   * A source identifies itself by finding its own handle inside the uri it is handed, and that uri is
   * captured once above. So a source whose id is contributed LATER by another source was asked before
   * that id existed, answered "not mine", and ended: its `Subscription.media` is a yield-once
   * generator with no retry (crunchyroll/extractor.ts:247-252). Re-asking is the only way it ever
   * fetches its own data on the click path, which is the whole of what a reload does differently.
   *
   * MATCHED ON `supportedUris` AS WELL AS ON THE SOURCE'S OWN ORIGIN, and the difference is a whole
   * class of source. anizip answers from an anidb or a mal id and publishes under `anizip:`, so its
   * own name cannot appear in the cluster until it has already answered: matching by origin alone, it
   * is never re-asked and never answers at all. Its data only appeared on a RELOAD, where the address
   * bar already carried the mal id it needed (measured 2026-09-09 on
   * `ag:(anilist:166873)`, which settled without anizip and gained it on the second load).
   * `supportedUris` is declared by every source in src/sources and, until this, was read by nothing.
   *
   * Termination holds WITHOUT capping a source to one re-ask, and the cap would cost correctness. The
   * caller only ever hands over origins it has never handed over before (`askedOrigins` in
   * resolvers/media/index.ts grows and never shrinks), so a source is asked at most once per origin it
   * declares plus once for its own: three questions for the widest source in the tree. Capping it at
   * one instead means a source whose needed id lands in a LATER batch than the one that first named
   * something it understands is asked too early, refuses, and never gets another chance. anizip
   * survives that cap only because anilist happens to contribute anidb, kitsu, mal and offline in a
   * single upsert.
   *
   * Deliberately NOT recorded in `fanout.joined`, which tracks the original variables so a source
   * registering mid-flight joins exactly once. These land in `subscriptions`, so the caller's
   * teardown collects them with the rest.
   */
  const askOrigins = (originIds: string[], variables: SubscriptionArgs[1]) => {
    for (const extractor of extractors) {
      // A PLUGIN source is matched on its origin alone: `PluginSourceMeta` carries no `supportedUris`
      // (see plugin-sources.ts), so a third party answering from a foreign id keeps the old behaviour.
      const definition = extractor.extractor as Answerable
      if (!answersForOrigins(definition, originIds)) continue
      try {
        fanout.subscriptions.push(
          extractor.client.subscription(ctx.params.query!, stamp(variables ?? {}, root)).subscribe(() => {})
        )
      } catch (error) {
        console.error(new Error(`Extractor ${extractor.name} failed to re-join the fan-out`, { cause: error }))
      }
    }
  }

  return {
    subscriptions: fanout.subscriptions,
    insertedUris,
    askOrigins,
    /** the root context of this fan-out, for a consumer that asks other origins on the page's behalf */
    root,
    // stop accepting late joiners; the caller still unsubscribes what it holds
    /** stop accepting late joiners; the caller still unsubscribes what it holds */
    close: () => { fanouts.delete(fanout); closeRoot(root.rootId) },
  }
}
