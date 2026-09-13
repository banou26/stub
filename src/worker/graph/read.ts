/**
 * THE READ PATH of section 6, behind `?store=graph`.
 *
 * Every export here is a LOOKUP: it reads JSON that `plugin:aggregate` and `plugin:containment`
 * materialized, and writes nothing. No id is minted, no alias is written, nothing is unioned, and
 * the fuzzy title pass does not run inside a page read any more: that is `plugin:title`, woken by
 * the scheduler.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than living in `../resolvers/media/index.ts`. That module
 * reaches urql and, through it, a CommonJS `require('react')` no alias intercepts, so it cannot be
 * imported under vitest (`vitest.config.ts` records the measurement). Nothing here imports a resolver
 * or `../extractor.ts`, so every rule below is pinned by `tests/unit/worker/graph/read.test.ts`
 * against a real engine. The resolvers become thin switches on the read store.
 *
 * WHAT IT PROMISES.
 * - A page is at most two statements, an episode list exactly one, and a detail view five: a member
 *   resolve, a `published` scan, a `Cluster` id lookup, an `Alias` lookup, then the view. A live one
 *   costs a sixth for its member uris. Those figures are asserted rather than claimed
 *   (`read.test.ts`, "the statement budget"); the two-segment resolve below is the one caller that
 *   can exceed them, and no route reaches it. `placeholdersOf` is off that budget: it feeds the ask
 *   of 7.1 step 3, not the draw, and a page that never asks anything still costs what is stated.
 * - A statement never runs with an empty `UNWIND` list, which dies at runtime on this engine rather
 *   than returning nothing (the engine facts of 2026-09-12).
 * - Nothing it returns has been merged, filtered or sorted: `applyMediaFilters`, `searchRelevance`
 *   and `applyMediaSorts` are the caller's, unchanged, and run over the cards this hands back.
 */
import type { AggregatedEpisode, AggregatedMedia, ClusterCard } from './plugins/fields'

import {
  isAggregatedUri, isRoutableUri, isUri, fromAggregatedUri, toAggregatedUri,
  type AggregatedUri, type Uri,
} from '../../utils/uri'
import { listen } from '../store/events'
import { graphReady } from './schema'

/**
 * The two MATERIALIZED reads, memoized until the graph next moves.
 *
 * `Cluster.media` and `Cluster.episodes` are columns a pass WRITES, so between two commits every read
 * of one is the same bytes. Nothing here was re-reading them because the data changed: a page's
 * subscriptions re-render many times while the sources answer, and each render asked again. Measured
 * on a Mushoku Tensei modal, 2026-09-13: `episodesOf` 63 calls returning 6 rows for 1.7 s, and
 * `viewOfCluster` 52 calls for 0.7 s, which is 2.4 s of the ~9.5 s the engine burned for that page.
 *
 * The cost is not the rows, it is the CALL: about 6 round trips into the ladybug worker at ~0.7 ms
 * each, plus the wasm to JS marshalling, whatever the statement returns (`scripts/bench-graph-engine.mjs`).
 *
 * CLEARED WHOLESALE ON ANY CHANGE, never per cluster, and that is what makes it safe to reason about:
 * there is no rule here about which clusters a commit touched, so there is no rule to get wrong.
 *
 * ALL THREE EVENTS, and `view:changed` is the one that matters most. The INGEST emits `graph:changed`
 * and `row:changed`; a plugin PASS emits neither, it emits `view:changed` (`scheduler.ts`), and a
 * pass is precisely what rewrites `Cluster.media` and `Cluster.episodes`. Listening to the first two
 * alone leaves the cache holding the view from before the pass forever, so the modal stops updating
 * while the sources are still answering, which is the exact failure this cache exists to speed up.
 * The unit suite caught that before it shipped; `clearReadCache` is how a test that seeds the graph
 * directly, emitting nothing, starts from a known state.
 */
const materialized = new Map<string, unknown>()
let materializedLive = false

/** Drop everything memoized. For a test that writes to the graph directly and emits nothing. */
export const clearReadCache = (): void => { materialized.clear() }

const rememberMaterialized = <T>(key: string, value: T): T => {
  // subscribed LAZILY, on the first read rather than at module scope: importing this file must not
  // attach a listener in a test that never touches the store (the header's own rule about imports)
  if (!materializedLive) {
    materializedLive = true
    listen('graph:changed', () => materialized.clear())
    listen('row:changed', () => materialized.clear())
    listen('view:changed', () => materialized.clear())
  }
  materialized.set(key, value)
  return value
}

/**
 * Which store answers `mediaPage`, `media`, `Media.episodes` and `ctx.findAggregatedMedia`.
 *
 * SEPARATE FROM `?graph`, and that is the point of having two flags. `?graph` warms the engine and
 * runs the tee and the pass beside the old store, which is what the shadow of step 2 needs; this one
 * switches what the app actually READS. With it on `legacy` the graph can be fully warm and nothing a
 * user sees has moved, which is what makes the switch reversible in one query parameter.
 */
export type ReadStore = 'graph' | 'legacy'

let store: ReadStore = 'legacy'

/** Which store the reads are on. `legacy` until something switches it, `?graph` on or off. */
export const readStore = (): ReadStore => store

/**
 * Switch the reads. The caller owns turning the ENGINE on: `?store=graph` implies `?graph`, and the
 * one place that implication lives is `../yoga.ts`, so a test can move the flag without booting one.
 */
export const setReadStore = (next: ReadStore): void => { store = next }

/** One row of the page statements: the cluster, whether a listing draws it, and what it draws. */
type PageRow = {
  id: string
  hidden: boolean
  hiddenBy: string[]
  card: ClusterCard | null
}

/** The cluster a resolve landed on, before its view is read. */
type ResolvedCluster = {
  id: string
  scope: string
  preferredRun: string | null
}

const parse = <T>(value: unknown): T | null => {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    // a column the writer could not have written: report it once and answer nothing, since throwing
    // here takes a whole page down for one corrupt row
    console.error(new Error(`graph read: a cluster column is not JSON: ${value.slice(0, 80)}`))
    return null
  }
}

// An empty `STRING[]` reads back as NULL on this engine, so every list column is normalized on the
// way out rather than at each use.
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const pageRowOf = (row: Record<string, unknown>): PageRow => ({
  id: String(row.id),
  hidden: row.hidden === true,
  hiddenBy: stringsOf(row.hiddenBy),
  card: parse<ClusterCard>(row.card),
})

// The two statements that select `id` and `card` alone: `pageRowOf` over those would manufacture a
// `hidden` and a `hiddenBy` out of columns nobody asked for, which is a type claiming more than the
// row carries.
const cardsOf = (rows: readonly Record<string, unknown>[]): ClusterCard[] =>
  rows.map(row => parse<ClusterCard>(row.card)).filter((card): card is ClusterCard => card !== null)

// `NOT c.hidden` is NULL for a row whose `hidden` was never written, and a NULL `WHERE` drops the
// row, so such a cluster would be in NEITHER bucket: not drawn by this and not hidden behind
// anything either, simply absent from every listing with no error anywhere. `schema.ts` says the
// column is written false explicitly, and 0 of 330 clusters carried a NULL over 3,000 recorded rows
// (2026-09-12), so this is the one line standing between the read and a plugin's habit.
const NOT_HIDDEN = 'coalesce(c.hidden, false) = false'

/**
 * The uris statement 1 of 6.2 asks about: an aggregated address is every member it names, and a bare
 * uri is itself.
 *
 * The address is a LIST OF SOURCES TO ASK and never a statement about how they relate (3.3), so a
 * uri in it that the graph relates to nothing simply matches no cluster here.
 */
export const addressUris = (uri: string): string[] => {
  if (isAggregatedUri(uri)) return fromAggregatedUri(uri as AggregatedUri)?.handleUris ?? []
  return uri ? [uri] : []
}

/**
 * The clusters a listing draws (6.1), as their materialized cards.
 *
 * With no uris the seed is EVERY visible cluster, and that whole-store case is load bearing rather
 * than a convenience: a page only re-reads on an event, and a second subscription over a warm store
 * fires none, so answering nothing here leaves the page empty forever (measured on the search page,
 * 2026-09-06). With uris it is their clusters plus the runs a hidden one hides behind, which is what
 * keeps a query only unogs or JustWatch answered from drawing nothing at all.
 *
 * A cluster with no card is a cluster no member of which is owned ("a placeholder cluster is never a
 * card"), and it is absent from both cases rather than drawn empty.
 */
export const pageClusters = async (uris?: readonly string[]): Promise<ClusterCard[]> => {
  const { query } = await graphReady()
  if (!uris) {
    const rows = await query(
      `MATCH (c:Cluster) WHERE ${NOT_HIDDEN} RETURN c.id AS id, c.card AS card`
    )
    return cardsOf(rows)
  }
  if (!uris.length) return []

  const seeds = (await query(
    `UNWIND $uris AS u
     MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster)
     RETURN DISTINCT c.id AS id, c.hidden AS hidden, c.hiddenBy AS hiddenBy, c.card AS card`,
    { uris: [...uris] }
  )).map(pageRowOf)

  return withHiddenRuns(seeds, query)
}

/**
 * The visible cards of a seed set, plus the runs its hidden rows hide behind.
 *
 * The second hop drops ids already in hand, so a run that is both a seed and a `hiddenBy` target is
 * read once and drawn once.
 */
const withHiddenRuns = async (
  seeds: readonly PageRow[],
  query: (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>
): Promise<ClusterCard[]> => {
  const drawn = new Map<string, ClusterCard>()
  const wanted = new Set<string>()
  for (const row of seeds) {
    if (!row.hidden && row.card) drawn.set(row.id, row.card)
    if (row.hidden) for (const id of row.hiddenBy) wanted.add(id)
  }
  for (const id of drawn.keys()) wanted.delete(id)
  if (wanted.size) {
    const rows = await query(
      `UNWIND $ids AS hid MATCH (c:Cluster {id: hid}) WHERE ${NOT_HIDDEN} RETURN c.id AS id, c.card AS card`,
      { ids: [...wanted].sort() }
    )
    for (const card of cardsOf(rows)) drawn.set(card._id, card)
  }
  return [...drawn.values()]
}

/**
 * A listing that keeps its page as a map keyed on cluster id, re-read one cluster at a time (6.1).
 *
 * `read` is the whole seed, `apply` is what a `view:changed` costs: the named clusters only, never
 * the store. THE REMOVAL RULE is the half that is easy to miss. A named cluster that comes back
 * hidden, cardless or absent is DELETED from the map, because from the outside it is otherwise
 * indistinguishable from one that did not change and would sit on the page forever.
 *
 * Admitting a cluster the page never asked for is the mirror mistake, so a named cluster enters the
 * map only when the page is the whole store, or when the map already holds it, or when it holds one
 * of the uris the fan-out has answered.
 */
export const createPageReader = () => {
  const cards = new Map<string, ClusterCard>()

  const admits = (card: ClusterCard, uris: readonly string[]): boolean =>
    !uris.length || cards.has(card._id) || card.members.some(member => uris.includes(member))

  return {
    /** The seed read, which replaces the map. */
    read: async (uris: readonly string[]): Promise<ClusterCard[]> => {
      cards.clear()
      for (const card of await pageClusters(uris.length ? uris : undefined)) cards.set(card._id, card)
      return [...cards.values()]
    },
    /** One `view:changed` applied: the named clusters re-read, the removal rule run over them. */
    apply: async (ids: readonly string[], uris: readonly string[]): Promise<ClusterCard[]> => {
      if (!ids.length) return [...cards.values()]
      const { query } = await graphReady()
      const rows = (await query(
        `UNWIND $ids AS i MATCH (c:Cluster {id: i})
         RETURN c.id AS id, c.hidden AS hidden, c.hiddenBy AS hiddenBy, c.card AS card`,
        { ids: [...ids] }
      )).map(pageRowOf)

      const seen = new Set(rows.map(row => row.id))
      // absent: retired into another cluster, or never existed. Either way it is not on the page.
      for (const id of ids) if (!seen.has(id)) cards.delete(id)

      // WHICH HIDDEN ROWS ARE THIS PAGE'S, read before the removal loop takes them out of the map.
      // A row the page was drawing, or one whose members meet the uris this fan-out answered: the
      // two ways the seed read would have returned it. An event names every cluster that MOVED,
      // store-wide, so any other hidden row is a fold somewhere else entirely, and following its
      // `hiddenBy` would put a card on this page that no state justifies and that nothing will ever
      // name again.
      const displaced = rows.filter(row =>
        row.hidden && (cards.has(row.id) || (row.card !== null && admits(row.card, uris))))

      for (const row of rows) {
        if (row.hidden || !row.card) cards.delete(row.id)
        else if (admits(row.card, uris)) cards.set(row.id, row.card)
      }
      // a row that JUST became hidden takes its run's place, so the run is drawn here exactly as the
      // seed read draws it. Every card this hop answers is the `hiddenBy` target of a displaced row,
      // so `displaced` IS the admission test and there is nothing left for a second one to say.
      for (const card of await withHiddenRuns(displaced, query)) cards.set(card._id, card)
      return [...cards.values()]
    },
    /** The page as it stands, for a caller that wants it without a read. */
    cards: (): ClusterCard[] => [...cards.values()],
  }
}

const RESOLVE_COLUMNS =
  `RETURN DISTINCT c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun, c.key AS key,
          CASE WHEN c.scope = 'RUN' THEN 0 ELSE 1 END AS scopeRank
   ORDER BY scopeRank, key
   LIMIT 1`

const clusterOf = (row: Record<string, unknown> | undefined): ResolvedCluster | undefined =>
  row === undefined
    ? undefined
    : {
      id: String(row.id),
      scope: String(row.scope ?? 'RUN'),
      preferredRun: typeof row.preferredRun === 'string' && row.preferredRun ? row.preferredRun : null,
    }

/**
 * Statement 1 of 6.2, and only on its empty answer statement 1a.
 *
 * MEMBERSHIP RANKS ABOVE PUBLICATION, by construction rather than by a score: a uri once published
 * under one cluster's id and now a member of its own would otherwise open the other cluster's page
 * (`mal:51535`, 8.6). `published` is append-only, so the scan below is the ONLY way a departed member
 * still resolves, and it is taken on the fallthrough and never level with membership.
 */
const resolveByUris = async (uris: readonly string[]): Promise<ResolvedCluster | undefined> => {
  if (!uris.length) return undefined
  const { query } = await graphReady()
  const [member] = await query(
    `UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) ${RESOLVE_COLUMNS}`,
    { uris: [...uris] }
  )
  if (member) return clusterOf(member)
  const [published] = await query(
    `UNWIND $uris AS u MATCH (c:Cluster) WHERE u IN c.published ${RESOLVE_COLUMNS}`,
    { uris: [...uris] }
  )
  return clusterOf(published)
}

/** Statement 1b: a cluster id, current, then retired. */
const resolveById = async (id: string): Promise<ResolvedCluster | undefined> => {
  const { query } = await graphReady()
  const [current] = await query(
    'MATCH (c:Cluster {id: $id}) RETURN c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun',
    { id }
  )
  if (current) return clusterOf(current)
  const [aliased] = await query(
    `MATCH (x:Alias {id: $id}) MATCH (c:Cluster {id: x.clusterId})
     RETURN c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun`,
    { id }
  )
  return clusterOf(aliased)
}

/**
 * Whether one cluster holds any uri of an address, which is what the fallthrough of 6.2 asks.
 *
 * The ADDRESS and not the raw string: a second segment is spelled `ag:(...)` as often as it is
 * spelled bare, and matching the whole aggregated string against `Media.uri` matches nothing, so the
 * fallthrough below would fire unconditionally and discard the first segment.
 */
const holds = async (id: string, uris: readonly string[]): Promise<boolean> => {
  if (!uris.length) return false
  const { query } = await graphReady()
  const rows = await query(
    'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster {id: $id}) RETURN c.id AS id',
    { id, uris: [...uris] }
  )
  return rows.length > 0
}

/**
 * A detail view (6.2): resolve, then one lookup.
 *
 * `uri` is the decoded route uri, an aggregated address, or a cluster id, current or retired.
 *
 * `member` IS THE ONE ARGUMENT NOTHING PASSES YET, and it is here rather than later on purpose. It is
 * the second segment of `/media/:uri/:mediaUri` (`Route.MEDIA_EPISODE`), for which `router/index.tsx`
 * registers no `WRoute`: `Route.MEDIA` is `/media/:uri`, which wouter will not match against
 * `/media/a/b`, so every caller today passes one argument. 6.2 states the rule it implements ("a
 * resolve by `_id`, or through `published`, that lands on a cluster not holding the member the route
 * names falls through to resolving that member uri"), and the reason to keep it is that the rule is
 * about an address a client may ALREADY hold: a bookmark on a retired `_id` is exactly what statement
 * 1b answers, and the day the route is wired the fallthrough has to exist or a stale first segment
 * silently wins over the row the user asked for. When the first resolves to a cluster that does NOT
 * hold it, the member is resolved on its own instead.
 *
 * A CONTAINER with a `preferredRun` follows to that run, which is "a show page follows to its
 * attached run, earliest first". A REQUESTED URI IS NEVER HIDDEN: the hide rule is a listing rule and
 * is not consulted here.
 *
 * Returns undefined when no cluster resolves, which is what keeps the modal on its loading state
 * rather than on a null while the sources are still answering.
 */
export const resolveMedia = async (uri: string, member?: string): Promise<AggregatedMedia | undefined> => {
  const memberUris = member ? addressUris(member) : []
  // statement 1 then 1a over the address's members, then 1b over the same string read as a cluster
  // id: a value that is neither matches nothing in either, at the cost of two key lookups
  let resolved = await resolveByUris(addressUris(uri))
  if (!resolved && uri) resolved = await resolveById(uri)
  if (!resolved) resolved = await resolveByUris(memberUris)
  if (!resolved) return undefined

  if (memberUris.length && !(await holds(resolved.id, memberUris))) {
    const fallthrough = await resolveByUris(memberUris)
    if (fallthrough) resolved = fallthrough
  }

  const id = resolved.scope === 'CONTAINER' && resolved.preferredRun ? resolved.preferredRun : resolved.id
  return viewOfCluster(id)
}

/** Statement 2: the materialized view of one cluster, with the page `kind` of 6.5 beside it. */
const viewOfCluster = async (id: string): Promise<AggregatedMedia | undefined> => {
  const cacheKey = `view#${id}`
  if (materialized.has(cacheKey)) return materialized.get(cacheKey) as AggregatedMedia | undefined
  const { query } = await graphReady()
  const [row] = await query('MATCH (c:Cluster {id: $id}) RETURN c.media AS media, c.kind AS kind', { id })
  if (!row) return rememberMaterialized(cacheKey, undefined)
  const media = parse<AggregatedMedia>(row.media)
  if (!media) return rememberMaterialized(cacheKey, undefined)
  // `kind` is the CLUSTER's column, not the view's: `plugin:containment` computes `FOLD` and
  // `aggregateFields` is not handed it, so the JSON carries the scope standing in for it. Reading it
  // from the same row costs no second statement and is what makes a folded season draw its own page.
  return rememberMaterialized(
    cacheKey,
    typeof row.kind === 'string' && row.kind ? { ...media, kind: row.kind } : media
  )
}

/**
 * A live detail view: the read, and the test for whether one `view:changed` concerns it (6.6).
 *
 * Two states, and the first is the one a wake on cluster ids alone would miss. Before a cluster
 * exists for the requested uri there is no id to wake on, so the subscription wakes on its REQUESTED
 * URIS until one resolves. After that it wakes on its cluster id, or on any member uri, which is how
 * a retirement reaches it: the surviving cluster's event names members the retired one held.
 *
 * `member` is the second segment of the route `resolveMedia` documents, and nothing passes it yet.
 */
export const createMediaReader = (uri: string, member?: string) => {
  const requested = new Set([...addressUris(uri), ...(member ? addressUris(member) : [])])
  let clusterId: string | undefined
  let wakeUris = new Set(requested)

  return {
    read: async (): Promise<AggregatedMedia | undefined> => {
      const media = await resolveMedia(uri, member)
      if (media) {
        clusterId = media._id
        wakeUris = new Set([...requested, ...await memberUrisOf([media._id])])
      }
      return media
    },
    // The middle clause is the one an id-shaped address needs: 6.2 lets the route uri BE a cluster
    // id, `clusterId` is only set by a successful read, and a read only runs on a wake, so a reader
    // addressed by an id that has no cluster yet would compare its id against `detail.uris` alone
    // and wait forever on the event that names exactly it.
    wakes: (detail: { clusters: readonly string[], uris: readonly string[] }): boolean =>
      (clusterId !== undefined && detail.clusters.includes(clusterId)) ||
      detail.clusters.some(named => requested.has(named)) ||
      detail.uris.some(named => wakeUris.has(named)),
    /** The cluster this reader last resolved to, for a caller that logs or keys on it. */
    clusterId: (): string | undefined => clusterId,
  }
}

/**
 * The episode list of one cluster (6.4): ONE lookup of the materialized row, never a walk from a
 * media uri, so it can never be handed a container's flat list of every season at once.
 *
 * A parent that is not a cluster answers `[]` rather than erroring, which is what a handle node is:
 * its `_id` is the member's own uri and matches no `Cluster.id`.
 *
 * ROWS WITH NO NUMBER ARE DROPPED, which is parity with today (`media/index.ts` filters
 * `episodeNumber == null`) and NOT what `Cluster.episodes` holds: a special gets its own slot and is
 * listed last. Listing specials is a visible change nobody has priced, since the modal and the watch
 * page both sort on the number and have never drawn a row without one, so it is decision 7 for the
 * owner and this read stays at parity until it is made.
 */
export const episodesOf = async (clusterId: string): Promise<AggregatedEpisode[]> => {
  if (!clusterId) return []
  const cacheKey = `episodes#${clusterId}`
  if (materialized.has(cacheKey)) return materialized.get(cacheKey) as AggregatedEpisode[]
  const { query } = await graphReady()
  const [row] = await query('MATCH (c:Cluster {id: $id}) RETURN c.episodes AS episodes', { id: clusterId })
  if (!row) return rememberMaterialized(cacheKey, [])
  const episodes = parse<AggregatedEpisode[]>(row.episodes)
  if (!Array.isArray(episodes)) return rememberMaterialized(cacheKey, [])
  return rememberMaterialized(
    cacheKey,
    episodes.filter(episode => episode.episodeNumber !== null && episode.episodeNumber !== undefined)
  )
}

/**
 * One uri a member's claim NAMED and no source has described (4.3), with the provenance of the claim
 * that named it.
 *
 * `provenance` is carried rather than filtered on, which is the whole of 3.3 as the ask sees it: an
 * `address` claim asserts nothing and never enters the closure, so its target can stay a placeholder
 * forever, and it still names a source to ask. A caller that wants to tell an echo of the address bar
 * from a source's own statement reads this column; a caller that only wants the origins ignores it.
 */
export type Placeholder = {
  uri: string
  origin: string
  provenance: string
}

/**
 * The cluster's placeholders and `address` pointers, verbatim from 7.1 step 3.
 *
 * WHAT THIS IS FOR, and why the aggregated view cannot answer it. A placeholder is a `Media` row with
 * `owned: false`: a uri a claim named that no source has described. It is not a member and it carries
 * no field, so it appears in NEITHER the cluster's members nor its `handles`, which is exactly why a
 * read that walked those asked nobody about it. That is self-reinforcing, because the origin is never
 * asked, so its row never arrives, so it never becomes a member: measured 2026-09-12 on
 * `ag:(anilist:108465)`, where `kitsu:42323` was answered once on the old store and 0 times on the
 * graph path, so the page drew four members against the old store's six.
 *
 * `owned: false` is the whole filter and it is a PROPERTY MATCH rather than a `coalesce`, because
 * `Media.owned` is written by the ingest on both of its branches (`ingest.ts`: `false` on the
 * placeholder `MERGE`, `cast(r.owned AS BOOLEAN)` on the owner's) and no plugin writes the `Media`
 * table at all, so the column is never NULL.
 *
 * One uri may come back more than once, once per provenance a claim gave it, which is what the
 * spec's `RETURN DISTINCT` over three columns says. The order is this function's, not the engine's,
 * since row order inside a tie is not stable between two passes in one process.
 */
export const placeholdersOf = async (clusterId: string): Promise<Placeholder[]> => {
  if (!clusterId) return []
  const { query } = await graphReady()
  const rows = await query(
    `MATCH (c:Cluster {id: $id})<-[:MEMBER_OF]-(:Media)-[cl:CLAIMS]->(t:Media {owned: false})
     RETURN DISTINCT t.uri AS uri, t.origin AS origin, cl.provenance AS provenance`,
    { id: clusterId }
  )
  return rows
    .map(row => ({
      uri: String(row.uri),
      origin: String(row.origin ?? ''),
      provenance: String(row.provenance ?? ''),
    }))
    .sort((a, b) => a.uri.localeCompare(b.uri) || a.provenance.localeCompare(b.provenance))
}

/**
 * The address 7.1 step 3 re-asks with: the cluster's members BESIDE the placeholders they name.
 *
 * Here rather than in the resolver because it is the one thing a caller cannot build from the view:
 * the view holds members, and a placeholder is by definition not one. A source recognises itself by
 * finding its own handle in the uri it is handed (`extractAggregatedUriOrigin`), so an address of the
 * placeholders alone would ask a source addressable by two origins with only one of them, and an
 * address of the members alone is the defect this exists to close.
 *
 * A uri a claim named is only proven to PARSE, so anything that could not survive a route segment is
 * dropped: inside `ag:(...)` a comma or a bracket splits the list and addresses a page that is not
 * this one. Empty when the cluster names no placeholder, which is what tells the caller to ask
 * nothing rather than to ask about the members again.
 */
export const askAddressOf = async (clusterId: string, mediaUri: string): Promise<string> => {
  const placeholders = await placeholdersOf(clusterId)
  if (!placeholders.length) return ''
  const named = [...addressUris(mediaUri), ...placeholders.map(placeholder => placeholder.uri)]
  // `isRoutableUri` goes FIRST because `isUri` THROWS on a comma in the id rather than answering
  // false, and this list is the one place a uri nobody validated arrives
  const uris = [...new Set(named.filter(uri => isRoutableUri(uri) && isUri(uri)))] as Uri[]
  return uris.length ? toAggregatedUri(uris) : ''
}

/** Every member uri of the named clusters, sorted and deduplicated. Empty in, empty out. */
export const memberUrisOf = async (clusterIds: readonly string[]): Promise<string[]> => {
  if (!clusterIds.length) return []
  const { query } = await graphReady()
  const rows = await query(
    'UNWIND $ids AS i MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: i}) RETURN m.uri AS uri',
    { ids: [...clusterIds] }
  )
  return [...new Set(rows.map(row => String(row.uri)))].sort()
}
