import type { Media, Episode, Origin, ClaimedRelation, MediaScope } from './types'
import { createGraph, lastWriteLongestArray } from './graph'
import { emit } from './events'
import { alignRunEpisodes, runEpisodes } from './consensus'
import { fromAggregatedUri, isAggregatedUri, type AggregatedUri } from '../../utils/uri'

/**
 * Two identity spaces, one per scope. A run's SAME_AS unions in the first, a container's in the second,
 * and nothing ever unions across them: a show-level id entering a run's cluster is what welded Mushoku
 * Tensei season 1 to season 3 on the live site (the bare crunchyroll series id and the bare tvmaze
 * show id were fuzzy merged into season 1's cluster on the search path, and season 3's media path then
 * asserted sameness through one of them; `graph.link` is a union-find with no inverse).
 */
const MEDIA_SAME_AS = 'media:same_as'
const CONTAINER_SAME_AS = 'container:same_as'

// The run space less the unions only an address made, for `findClaimedMedia`. An address says nothing of how the rows it
// names relate, and a link can name two shows, but a search hit's only handles are the address's, so the run space keeps them.
const MEDIA_CLAIMED = 'media:claimed'

// Origins whose id names a SHOW and has no season-level equivalent to name instead.
//
// A handle is an identity claim: linking it says "this media and that one are the same thing". An
// IMDb `tt` id is the series, so every season of a show carries the same one and the claim is that
// they are all one media - which is what merged Mushoku Tensei's three seasons even after JustWatch,
// TMDB and TVmaze each stopped doing it, because five separate sources (tvmaze, trakt, simkl, omdb,
// watchmode) all emit it.
//
// TMDB and TVmaze could be scoped because both model seasons; IMDb does not, so there is no honest
// season id to mint and scoping would invent one that no source could independently reproduce.
//
// THAT WAY NOW EXISTS, so this no longer drops the handle. It first read as a DEMOTION: a SAME_AS for
// one of these origins was rewritten to PART_OF, which carries its url without asserting sameness.
// The comment that used to end here read "Until there is a way to attach a handle for its LINK
// without asserting identity, it is not linked at all. The cost is the IMDb link disappearing from
// the aggregated media." That cost is paid back by this line.
//
// Now it reads as a SCOPE: a uri of one of these origins is a CONTAINER, whatever row it arrived in,
// and `upsertMedia` derives the relation from the two scopes exactly as it does for a row a source
// stamped CONTAINER itself. Same outcome for a run's claim (an edge, never a union), and a claim from
// another container unions in the container space instead of being thrown away.
//
// It stays as a backstop rather than being deleted with the producers migrated: it is one Set lookup,
// and it means a source that starts emitting a bare imdb id again is corrected here instead of
// welding every season of a show.
const SHOW_LEVEL_ORIGINS = new Set(['imdb'])

const originOf = (uri: string) => uri.slice(0, uri.indexOf(':'))
const EPISODE_SAME_AS = 'episode:same_as'
const EPISODE_PART_OF = 'episode:part_of'
const HAS_EPISODE = 'has_episode'

/** The media -> episode edge label, for ./export.ts. */
export const HAS_EPISODE_LABEL = HAS_EPISODE

/** The identity space labels, for the one reader outside this file that needs them: the cluster id in ./aggregate.ts. */
export const IDENTITY_LABELS = { RUN: MEDIA_SAME_AS, CONTAINER: CONTAINER_SAME_AS, EPISODE: EPISODE_SAME_AS } as const

/**
 * A second, adjacency-only record of every pair a SOURCE claimed through a handle, written by
 * `upsertMedia` and by nothing else. `./export.ts` is its only reader.
 *
 * Two properties the identity labels above cannot supply, and the export needs both. `graph.link`
 * carries the same label whether the pair came from a handle or from `linkSameMediaPairs`, so a
 * cluster cannot say which of its unions a source actually asserted; and a union-find cannot answer
 * "what would this component be with that node removed", which is exactly what excluding a plugin or
 * the offline origin asks. An adjacency answers both, and unions nothing, so nothing downstream of
 * the store sees these labels at all.
 */
export const ASSERTED_LABELS = {
  RUN: 'asserted:media_same_as',
  CONTAINER: 'asserted:container_same_as',
  PART_OF: 'asserted:media_part_of',
} as const

/**
 * PART_OF rides a DIRECTED edge, which unions nothing.
 *
 * `graph.link` maintains a union-find per label, so two labels would give two separate clusters, and a
 * PART_OF cluster is a thing nobody wants: it would merge every run of a show with every other run
 * that pointed at the same container. `graph.edge` is the primitive that already exists for exactly
 * this and is what HAS_EPISODE uses.
 */
const MEDIA_PART_OF = 'media:part_of'

export const graph = createGraph<Media | Episode>()
const originMap = new Map<string, Origin>()

graph.registerLabel('media', { merge: lastWriteLongestArray })
graph.registerLabel('episode', { merge: lastWriteLongestArray })

// The backstop first, then the stored row, then RUN, which is the default the schema gives an absent
// `scope`. A uri with NO row never reaches a union or an edge: `upsertMedia` holds its claims until a
// row lands, so the default here only ever reads a stored row that said nothing.
const scopeOf = (uri: string): MediaScope =>
  SHOW_LEVEL_ORIGINS.has(originOf(uri)) ? 'CONTAINER' : (graph.get(uri) as Media | undefined)?.scope ?? 'RUN'

const sameAsLabelFor = (scope: MediaScope) => scope === 'CONTAINER' ? CONTAINER_SAME_AS : MEDIA_SAME_AS
const isRun = (media: Media) => media.scope !== 'CONTAINER'
const compareStrings = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const keyOf = (cluster: Media[]) => cluster.map(media => media.uri).sort()[0] ?? ''

// The fields that NAME a row rather than describe it. A row carrying nothing else is a placeholder
// rebuilt from a uri (`buildHandlesFromUri` in sources/utils.ts mints one per sibling of an aggregated
// uri), and a uri says nothing about what it names: the row would contribute no field to a merge and
// its scope is `makeMedia`'s default. So it is not stored, and a claim naming it waits for a row that
// is. A CONTAINER stamp counts as a description, since it is a source's own reading of the id.
const IDENTITY_FIELDS = new Set(['uri', 'origin', 'id', 'scope'])
const isPlaceholder = (media: Media) =>
  media.scope !== 'CONTAINER'
  && Object.entries(media).every(([field, value]) =>
    IDENTITY_FIELDS.has(field) || value == null || (Array.isArray(value) && value.length === 0))

type Claim = { mediaUri: string; handleUri: string; relation?: ClaimedRelation; address?: boolean }
const claimKey = ({ mediaUri, handleUri, relation }: Claim) => `${mediaUri}\0${handleUri}\0${relation ?? 'SAME_AS'}`

/**
 * Claims naming a uri no row describes yet, keyed by that uri and deduped on the claim.
 *
 * The relation is derived from BOTH scopes, and a uri with no row has none. It used to read as RUN,
 * which let a run union with a show whose own row was still in flight: a media page reloaded cold
 * fans out to every source at once, each answers with the aggregated uri's siblings rebuilt as bare
 * SAME_AS nodes, and whichever landed first decided. A RUN row for `cr:G24H1N3MP` minted by justwatch
 * milliseconds before crunchyroll said CONTAINER was a RUN x RUN union, the CONTAINER that followed
 * flipped the scope and not the union, and the same graph then answered differently depending on
 * which member it was entered through. A claim now waits for the row and is applied when it lands.
 */
const pendingClaims = new Map<string, Map<string, Claim>>()

const defer = (uri: string, claim: Claim) => {
  let waiting = pendingClaims.get(uri)
  if (!waiting) pendingClaims.set(uri, waiting = new Map())
  waiting.set(claimKey(claim), claim)
}

export async function upsertMedia(
  newMedias: Media[],
  handles: Claim[]
) {
  let changed = false
  const landed: string[] = []

  const episodes = graph.labeled('episode')
  for (const media of newMedias) {
    // see `upsertEpisodes`: a uri already stored as an episode stays one
    if (isPlaceholder(media) || episodes.has(media.uri)) continue
    const isNew = !graph.has(media.uri)
    // Scope is STICKY toward CONTAINER: once any row for this uri said CONTAINER, a later row that says
    // RUN or says nothing does not flip it back. The failure with no inverse is a wrong SAME_AS, and
    // the failure of a wrong CONTAINER is a missing SAME_AS, which a later slice can recover. The
    // merge function alone would let an incoming RUN overwrite it (scalars are last-write-wins).
    const scope: MediaScope = scopeOf(media.uri) === 'CONTAINER' ? 'CONTAINER' : media.scope ?? 'RUN'
    graph.set(media.uri, { ...media, scope }, { addLabels: ['media'] })
    if (isNew) {
      changed = true
      landed.push(media.uri)
    }
  }

  const claims = [...handles]
  for (const uri of landed) {
    const waiting = pendingClaims.get(uri)
    if (!waiting) continue
    pendingClaims.delete(uri)
    claims.push(...waiting.values())
  }

  // The rows loop above runs first, so every handle node that describes itself has a stored row when
  // the pairs are read (worker/extractor.ts unwraps every handle node into the rows list). The
  // relation is DERIVED from the two scopes and the claim:
  //
  //     RUN x RUN                claimed SAME_AS unions in the run space, PART_OF is an edge
  //     RUN x CONTAINER          an edge media -> handle, whatever was claimed
  //     CONTAINER x RUN          an edge handle -> media: the edge always runs from run to container
  //     CONTAINER x CONTAINER    claimed SAME_AS unions in the container space, PART_OF is an edge
  //
  // Guesses go on edges, which are deletable; only asserted sameness within one scope goes on a union.
  //
  // Each applied claim is also recorded in ASSERTED_LABELS, and those writes' return values are
  // DISCARDED: `changed` stays driven by the real labels alone. Feeding it an asserted write would put
  // every listener back in the re-read loop tests/unit/worker/store/edge-idempotence.test.ts exists to
  // stop, since the two records can go new at different times.
  for (const claim of claims) {
    const { mediaUri, handleUri, relation, address } = claim
    // `INCLUDES` is an OUTPUT value of `MediaHandleRelation` (6.3): a run's page lists the catalogue
    // seasons that hold it. This store has no edge for that direction, and reading it as PART_OF
    // would point the containment the wrong way round, so it is refused here rather than guessed.
    if (relation === 'INCLUDES') continue
    const undescribed = [mediaUri, handleUri].filter(uri => !graph.labeled('media').has(uri))
    if (undescribed.length) {
      for (const uri of undescribed) defer(uri, claim)
      continue
    }
    const claimed = relation ?? 'SAME_AS'
    const mediaScope = scopeOf(mediaUri)
    const handleScope = scopeOf(handleUri)
    if (mediaScope !== handleScope) {
      const [run, container] = mediaScope === 'RUN' ? [mediaUri, handleUri] : [handleUri, mediaUri]
      graph.edge(run, container, ASSERTED_LABELS.PART_OF)
      if (graph.edge(run, container, MEDIA_PART_OF)) changed = true
    } else if (claimed === 'SAME_AS') {
      graph.connect(mediaUri, handleUri, mediaScope === 'CONTAINER' ? ASSERTED_LABELS.CONTAINER : ASSERTED_LABELS.RUN)
      if (!address) graph.link(mediaUri, handleUri, MEDIA_CLAIMED)
      if (graph.link(mediaUri, handleUri, sameAsLabelFor(mediaScope))) changed = true
    } else {
      graph.edge(mediaUri, handleUri, ASSERTED_LABELS.PART_OF)
      if (graph.edge(mediaUri, handleUri, MEDIA_PART_OF)) changed = true
    }
  }

  if (changed) emit('media:changed', {})
}

/**
 * Union two media that no handle connects, which is what a fuzzy title merge decides.
 *
 * IT GOES THROUGH THE SAME REFUSAL `upsertMedia` DOES, and did not until 2026-09-05. Every guard the
 * handle refactor added lives in `upsertMedia`'s loop, so this path, whose only caller is
 * `fuzzyMergeMediaClusters`, was a raw `graph.link` with no relation, no demotion and no check: a
 * show-level origin that could never be minted as SAME_AS by any source could still be welded here by
 * a title match.
 *
 * There is no PART_OF fallback to demote to, because there is no handle and nothing asserted a
 * containment. A pair with a CONTAINER on either side is simply refused, which subsumes the
 * show-level backstop: those origins read as CONTAINER.
 */
export function linkSameMediaPairs(pairs: [string, string][]): boolean {
  let changed = false
  for (const [uriA, uriB] of pairs) {
    if (scopeOf(uriA) === 'CONTAINER' || scopeOf(uriB) === 'CONTAINER') continue
    if (graph.link(uriA, uriB, MEDIA_SAME_AS)) changed = true
  }
  if (changed) emit('media:changed', {})
  return changed
}

/**
 * Union two containers that no handle connects, in the CONTAINER space only. The mirror of
 * `linkSameMediaPairs`: a pair with a RUN on either side is refused, because a run is never the same
 * thing as a show. Emits `media:changed` when a union was new and says whether one was.
 */
export function linkSameContainerPairs(pairs: [string, string][]): boolean {
  let changed = false
  for (const [uriA, uriB] of pairs) {
    if (scopeOf(uriA) !== 'CONTAINER' || scopeOf(uriB) !== 'CONTAINER') continue
    if (graph.link(uriA, uriB, CONTAINER_SAME_AS)) changed = true
  }
  if (changed) emit('media:changed', {})
  return changed
}

/**
 * Hang a run under a container that no handle connects, which is what a fuzzy title match between a
 * run and a show decides. An edge, never a union, and only when the scopes are RUN then CONTAINER in
 * that order: anything else is refused rather than flipped, since a caller that got the order wrong
 * may have the scopes wrong too. Emits `media:changed` when an edge was new and says whether one was.
 */
export function linkPartOfPairs(pairs: [string, string][]): boolean {
  let changed = false
  for (const [runUri, containerUri] of pairs) {
    if (scopeOf(runUri) !== 'RUN' || scopeOf(containerUri) !== 'CONTAINER') continue
    if (graph.edge(runUri, containerUri, MEDIA_PART_OF)) changed = true
  }
  if (changed) emit('media:changed', {})
  return changed
}

export async function findAggregatedMedia(uri: string): Promise<Media[]> {
  const resolved = graph.resolve(uri)
  // the alias table carries EPISODE cluster ids too (`componentId` aliases every id it mints), and an
  // episode node is never a media whatever a caller typed the id as
  if (!graph.labeled('media').has(resolved)) return []
  // a container row clusters in the container space, so its own SAME_AS siblings are what comes back
  return graph.cluster(resolved, sameAsLabelFor(scopeOf(resolved))) as Media[]
}

/** The rows some source's own claims join to `uri`, itself included: its cluster less what only an address joined. */
export const findClaimedMedia = (uri: string): Media[] => graph.cluster(uri, MEDIA_CLAIMED) as Media[]

/**
 * Every row a cluster points at but does not claim to be, deduped by uri.
 *
 * Read from the DIRECTED PART_OF edges of every cluster member, because the aggregated media is the
 * cluster and any of its members may hold one. Each target is expanded to its whole cluster in ITS
 * OWN space, so a run that is part of a show links to every id that show has: the fuzzy pass writes
 * ONE edge, to the cluster key, and the other catalogues of an already unioned show were only ever
 * reachable while they were welded in. A node with no stored row is skipped: `graph.edge` accepts a
 * uri that was never `set`, exactly as `graph.link` does.
 */
export function findPartOfMedia(cluster: Media[]): Media[] {
  const seen = new Set<string>()
  const inCluster = new Set(cluster.map(member => member.uri))
  const out: Media[] = []
  for (const member of cluster) {
    for (const targetUri of graph.targets(member.uri, MEDIA_PART_OF)) {
      const nodes = graph.cluster(targetUri, sameAsLabelFor(scopeOf(targetUri))) as Media[]
      // A run is not part of itself. The two claims disagree (one source called the target a container
      // of this run, another called it the same run and unioned it in), and the union is the stronger
      // statement, so the edge is left to the reader that wants edges rather than rendered as a show
      // this run belongs to.
      if (nodes.some(node => inCluster.has(node.uri))) continue
      for (const node of nodes) {
        if (seen.has(node.uri)) continue
        seen.add(node.uri)
        out.push(node)
      }
    }
  }
  return out
}

/**
 * Every run cluster hanging off a container cluster, read backwards along the PART_OF edges, each
 * cluster once. Only a RUN row counts as a source: a container pointing at another container is a
 * PART_OF claimed between two shows, never a run of one.
 */
export function findRunsOfContainer(cluster: Media[]): Media[][] {
  const seen = new Set<string>()
  const runs: Media[][] = []
  for (const member of cluster) {
    for (const runUri of graph.sources(member.uri, MEDIA_PART_OF)) {
      if (!graph.has(runUri) || scopeOf(runUri) !== 'RUN') continue
      const run = graph.cluster(runUri, MEDIA_SAME_AS) as Media[]
      const key = keyOf(run)
      if (seen.has(key)) continue
      seen.add(key)
      runs.push(run)
    }
  }
  return runs
}

const startOf = (cluster: Media[]) =>
  Math.min(...cluster.map(media => {
    const time = media.startDate ? Date.parse(media.startDate) : NaN
    return Number.isNaN(time) ? Infinity : time
  }))

/**
 * The cluster a page shows for the one a uri resolved to.
 *
 * A run is shown as it is. A show whose runs are in the store is shown as its FIRST run, by start
 * date and then by uri: that is the page the weld used to produce, season 1's episodes and offers
 * under the show's ids, and a show page with no episode and no offer is what splitting the spaces
 * cost until this. The run's PART_OF handles still carry every id of the show. A show with no run
 * attached is shown as itself, which is today's card for a live-action catalogue.
 */
export function preferAttachedRun(cluster: Media[]): Media[] {
  if (cluster.some(isRun)) return cluster
  const runs = findRunsOfContainer(cluster)
  if (!runs.length) return cluster
  return runs.sort((a, b) => startOf(a) - startOf(b) || compareStrings(keyOf(a), keyOf(b)))[0]!
}

/**
 * The cluster a media page shows for the uri it was asked for.
 *
 * The uri itself first (an alias resolves there too), then, for an aggregated uri, its handles one by
 * one: a bookmark carries ids that may have clustered differently since. A handle naming a RUN wins
 * over one naming a show whichever comes first in the uri, because a uri that mixes the two came off
 * a run's page. What is found is then shown as `preferAttachedRun` says.
 */
export async function findMediaForPage(uri: string): Promise<Media[]> {
  let cluster = await findAggregatedMedia(uri)
  if (!cluster.length && isAggregatedUri(uri)) {
    const parsed = fromAggregatedUri(uri as AggregatedUri)
    for (const handleUri of parsed?.handleUris ?? []) {
      const found = await findAggregatedMedia(handleUri)
      if (!found.length) continue
      if (found.some(isRun)) {
        cluster = found
        break
      }
      if (!cluster.length) cluster = found
    }
  }
  return preferAttachedRun(cluster)
}

/**
 * Every cluster the store holds, runs first and then containers, each row in exactly one of them.
 *
 * A run cluster is a run-space component with at least one non-CONTAINER member. A container cluster
 * is a container-space component, cut down to its CONTAINER members that no run cluster already
 * lists: a legacy mixed cluster from before scope existed keeps its container member on the run side
 * rather than showing the row twice. A cluster emptied by that cut is dropped.
 */
export async function findAllAggregatedMedia(uris?: string[]): Promise<Media[][]> {
  const nodeLabel = uris ? undefined : 'media'
  const runs = (graph.clusters(MEDIA_SAME_AS, nodeLabel, uris) as Media[][])
    .filter(cluster => cluster.some(isRun))
  const listed = new Set(runs.flatMap(cluster => cluster.map(media => media.uri)))
  const containers = (graph.clusters(CONTAINER_SAME_AS, nodeLabel, uris) as Media[][])
    .map(cluster => cluster.filter(media => !isRun(media) && !listed.has(media.uri)))
    .filter(cluster => cluster.length > 0)
  return [...runs, ...containers]
}

/**
 * The clusters a listing shows. A listing shows RUNS, and a show whose run is on the page is already
 * represented by that run's card: a container-only cluster is dropped when any of its members is a
 * PART_OF target of any member of a run cluster IN THE SAME LIST. A show with no run on the page still
 * gets a card, which is today's behaviour for live-action catalogues. Run clusters always survive.
 */
export function hideAttachedContainers(clusters: Media[][]): Media[][] {
  const attached = new Set<string>()
  for (const cluster of clusters) {
    if (!cluster.some(isRun)) continue
    for (const container of findPartOfMedia(cluster)) attached.add(container.uri)
  }
  return clusters.filter(cluster => cluster.some(isRun) || !cluster.some(media => attached.has(media.uri)))
}

export async function upsertEpisodes(
  newEpisodes: Episode[],
  handles: { episodeUri: string; handleUri: string; relation?: ClaimedRelation }[]
) {
  // One uri can name a title and also the episode that plays it (a Prime film's gti, or a Prime
  // season's, which its first episode carries), and a node takes one of the two labels: the first wins.
  const media = graph.labeled('media')
  for (const episode of newEpisodes) {
    if (media.has(episode.uri)) continue
    graph.set(episode.uri, episode, { addLabels: ['episode'] })
    graph.edge(episode.mediaUri, episode.uri, HAS_EPISODE)
  }

  for (const { episodeUri, handleUri, relation } of handles) {
    // as in `upsertMedia`: this store has no edge pointing from the whole at its part
    if (relation === 'INCLUDES') continue
    if ((relation ?? 'SAME_AS') === 'SAME_AS') graph.link(episodeUri, handleUri, EPISODE_SAME_AS)
    else graph.edge(episodeUri, handleUri, EPISODE_PART_OF)
  }

  emit('episode:changed', {})
}

/**
 * The episode groups a RUN should list, which is the walk above minus any tail a longer packaging of
 * the run brings with it. See ./consensus.ts for the rule and for why it needs two witnesses.
 *
 * Takes the cluster rather than the uris, because the decision is made on what each member says its
 * own length is, and a uri does not carry that.
 */
export async function findRunEpisodes(cluster: Media[]): Promise<Episode[][]> {
  const groups = await findAggregatedEpisodesForMedia(cluster.map(media => media.uri))
  const aligned = alignRunEpisodes(cluster, groups.flat())
  return groups
    .map(group => runEpisodes(cluster, group.map(episode => aligned.get(episode.uri) ?? episode)))
    .filter(group => group.length)
}

export async function findAggregatedEpisodesForMedia(mediaUris: string[]): Promise<Episode[][]> {
  const seen = new Set<string>()
  const allEpisodes: Episode[] = []
  for (const mediaUri of mediaUris) {
    for (const epUri of graph.targets(mediaUri, HAS_EPISODE)) {
      if (!seen.has(epUri)) {
        seen.add(epUri)
        const ep = graph.get(epUri) as Episode | undefined
        if (ep) allEpisodes.push(ep)
      }
    }
  }

  const visited = new Set<string>()
  const groups: Episode[][] = []
  for (const ep of allEpisodes) {
    if (visited.has(ep.uri)) continue
    const cluster = graph.cluster(ep.uri, EPISODE_SAME_AS) as Episode[]
    for (const e of cluster) visited.add(e.uri)
    groups.push(cluster)
  }

  return mergeByEpisodeNumber(groups)
}

/**
 * Within ONE run, two episodes carrying the same number are the same episode.
 *
 * Episodes only ever merged through an explicit `EPISODE_SAME_AS`, which nothing mints between two
 * metadata sources, so a run described by two of them came out as two full lists rather than one.
 * Measured 2026-09-09 on Mushoku Tensei season 2 part 2: twelve kitsu episodes with no titles followed
 * by the same twelve from anizip with every title and date, drawn as twenty four rows.
 *
 * SAFE ONLY BECAUSE THE INPUT IS ONE RUN. The caller passes the uris of a single media cluster, which
 * is its SAME_AS set by construction, and a run numbers its episodes once. This is emphatically not a
 * rule about episodes in general: two runs of a show both have an episode 1, which is why nothing may
 * read episodes across a PART_OF and why this must never be handed a container's uris.
 *
 * Keyed on the number ALONE, not on the season too. Sources disagree about which season a run belongs
 * to (anizip says 2 where kitsu says nothing), so including it would prevent exactly the merges this
 * exists for. A number is only usable when it is a positive whole one: a special carries none, so
 * specials stay separate rather than colliding with episode 1.
 */
export const mergeByEpisodeNumber = (groups: Episode[][]): Episode[][] => {
  const byNumber = new Map<number, Episode[]>()
  const merged: Episode[][] = []
  for (const group of groups) {
    const numbers = group.map(episode => episode.episodeNumber)
    const number = numbers.find(value => typeof value === 'number' && Number.isInteger(value) && value > 0)
    if (number === undefined || number === null) {
      merged.push(group)
      continue
    }
    const already = byNumber.get(number)
    if (already) already.push(...group)
    else {
      const started = [...group]
      byNumber.set(number, started)
      merged.push(started)
    }
  }
  return merged
}

/**
 * Empty the store. TESTS ONLY, and it exists for one kind of test.
 *
 * The store is a module singleton, so every test in a run shares it. The suites that predate this
 * dodged that by inventing ids no other test uses (`anilist:2460`, `anilist:601`), which works right
 * up until the fixtures carry REAL ids: `merge-fixtures.test.ts` asserts on kitsu:49002 and
 * anilist:178789 as they really are, and the same show legitimately appears in several cases. Without
 * a reset the second case inherits the first case's welds and passes or fails for reasons that are
 * not in it.
 *
 * Not exported through ./index.ts, and never called by the app: a live reset would drop every cluster
 * mid-session with no way to rebuild them short of re-asking every source.
 */
export function resetStore() {
  graph.clear()
  originMap.clear()
  pendingClaims.clear()
}

export async function upsertOrigins(newOrigins: Origin[]) {
  for (const origin of newOrigins) {
    const existing = originMap.get(origin.id)
    originMap.set(origin.id, existing ? lastWriteLongestArray(origin, existing) : origin)
  }
  emit('origin:changed', {})
}

export async function findOrigin(id: string): Promise<Origin | null> {
  return originMap.get(id) ?? null
}

export async function findOrigins(
  ids: string[],
  filters?: ('IS_API_ONLY' | 'IS_NOT_API_ONLY')[]
): Promise<Origin[]> {
  let result: Origin[]

  if (ids.length > 0) {
    result = ids.map(id => originMap.get(id)).filter((o): o is Origin => o != null)
  } else {
    result = [...originMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  if (filters?.length) {
    result = result.filter(o =>
      filters.every(f => f === 'IS_API_ONLY' ? o.isApiOnly : !o.isApiOnly)
    )
  }

  return result
}
