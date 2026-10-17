import type { Media as GQLMedia, Episode as GQLEpisode, MediaCategory } from '../../generated/schema/types.generated'
import { runLength } from './consensus'
import type { Media, Episode } from './types'
import { getRoutePath, Route } from '../../router/path'
import { findPartOfMedia, graph, IDENTITY_LABELS } from './db'
import { isRoutableUri } from '../../utils/uri'
import { refinesDate } from '../../utils/release-date'
import { COERCING_ORIGINS } from '../graph/plugins/origins'
import { seasonNamesFirst } from '../../sources/season'

// keep ANIME plus exactly ONE of MOVIE/SERIES (highest-scored source's format wins), so a merged media never lands in both the Movies and the Series listing
const reconcileCategories = (cats: MediaCategory[]): MediaCategory[] => {
  const out: MediaCategory[] = []
  if (cats.includes('ANIME')) out.push('ANIME')
  const format = cats.find(category => category === 'MOVIE' || category === 'SERIES')
  if (format) out.push(format)
  return out
}

/** Sort array by score descending (highest first), nulls last */
function byScore<T extends { score?: number | null }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
}

/**
 * Genre and tag labels from every member of a cluster, in arrival order, one spelling each.
 *
 * The reduce feeds this the highest-scored source's labels first, so the spelling KEPT is that
 * source's: AniList's "Sci-Fi" survives and a lower-scored "sci-fi" folds into it. Case-insensitive
 * because the catalogues genuinely disagree on case and a user filtering for one would otherwise see
 * the same genre listed twice.
 *
 * `removeDuplicatesByField` cannot do this: it keys on a property of an object, and these are bare
 * strings.
 */
/**
 * The broadcast season a cluster aired in, taken from ONE member.
 *
 * Every other scalar here is won field by field, and this pair cannot be: `SUMMER` and `2026` only
 * mean anything together. Merged separately, a cluster whose members disagree can end up carrying a
 * season no source ever claimed, and `store/filter.ts` matches on both, so the media would answer a
 * season page that nothing put it in. Taking the year from whoever named the season keeps the pair a
 * quotation rather than a composite.
 *
 * A cluster nobody gave a season to still gets a year, because a year alone cannot be mixed with
 * anything: jikan publishes one for a film that has no season at all.
 *
 * `medias` must be sorted by score, descending, which is what `sorted` above is.
 */
const seasonOf = (medias: Media[]): { season: Media['season'], seasonYear: number | null } => {
  const named = medias.find(media => media.season)
  return {
    season: named?.season ?? null,
    seasonYear: (named ? named.seasonYear : medias.find(media => media.seasonYear !== null)?.seasonYear) ?? null,
  }
}

const dedupeLabels = (labels: string[] | undefined): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of labels ?? []) {
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

export function removeDuplicatesByField<T extends Record<string, any>>(field: keyof T, array: T[]): T[] {
  const seen = new Set<string | number>()
  const result: T[] = []
  for (const item of array) {
    if (!seen.has(item[field])) {
      seen.add(item[field])
      result.push(item)
    }
  }
  return result
}

/**
 * The two edge constructors this module needs.
 *
 * Local rather than imported from ../../sources/utils: that module reaches the whole source barrel,
 * and the store must not depend on it. The shape is three fields and duplicating it here is cheaper
 * than the import cycle.
 */
const sameAsHandle = (node: GQLMedia) => ({ node, relation: 'SAME_AS' as const })
const partOfHandle = (node: GQLMedia) => ({ node, relation: 'PART_OF' as const })
const sameAsEpisodeHandle = (node: GQLEpisode) => ({ node, relation: 'SAME_AS' as const })

/**
 * The uris a media claims to BE, out of its handle edges.
 *
 * Exported and used by `Media.episodes` rather than filtered inline there, because that resolver
 * cannot be imported under vitest (it reaches urql, which is CommonJS) and an untestable filter on the
 * most dangerous read in the tree is not good enough.
 *
 * WHY IT IS THE MOST DANGEROUS READ. `findAggregatedEpisodesForMedia` walks HAS_EPISODE for every uri
 * handed to it and `Media.episodes` groups the union by `episodeNumber` ALONE. A PART_OF node is a
 * SHOW, and `unogs/extractor.ts` hangs every season's episodes, each renumbered 1..n, off exactly that
 * kind of uri. Passing one in puts every run's episodes into this run's list and the row count becomes
 * the longest season: the 24-rows-on-a-14-episode-season defect, arriving by a new road.
 */
export const sameAsHandleUris = (handles: { relation: string, node: { uri: string } }[] | undefined | null): string[] =>
  (handles ?? []).filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri)

const unwrapMediaCache = new WeakMap<GQLMedia, GQLMedia[]>()

/**
 * Flatten a media and everything hanging off it into the rows the store should hold.
 *
 * EVERY node becomes a row, whatever it claims: this walk feeds `graph.set`, and a PART_OF node has to
 * be stored or its url can never be rendered. The relation decides how a node is LINKED, in
 * `upsertMedia`, not whether it is stored.
 *
 * THE WALK STOPS AT A PART_OF NODE, and that is the load bearing part. A PART_OF node is a CONTAINER,
 * usually a show, and its own handles are claims about the CONTAINER rather than about the run that
 * pointed at it. Carrying them through means two different runs, each hanging PART_OF off the same
 * show, each contribute a SAME_AS pair rooted at that show:
 *
 *     season 1 -PART_OF-> cr:SERIES -SAME_AS-> kitsu:42323
 *     season 3 -PART_OF-> cr:SERIES -SAME_AS-> kitsu:49002
 *
 * and `cr:SERIES` is one uri, so the union-find puts kitsu:42323 and kitsu:49002 in one cluster. Two
 * seasons welded, with no inverse, by a relation whose entire purpose is not to weld. The container's
 * row still arrives, so its url renders; only its claims are dropped, because nothing can reach them
 * anyway: `findPartOfMedia` returns the direct targets of a cluster and never walks their handles.
 *
 * The copy is what enforces it. Returning the node untouched would leave `handles` populated for the
 * pair loop in worker/extractor.ts to read, so the subtree has to be cut here rather than there.
 *
 * KEPT DELIBERATELY, and weighed against letting a container contribute its handles after all. Nothing
 * in the tree mints a PART_OF node carrying any, so the choice was only ever about which way the
 * default fails, and unrelated media being read as SAME_AS is the failure with no inverse.
 */
export function recursivelyUnwrapMediaHandles(media: GQLMedia): GQLMedia[] {
  if (unwrapMediaCache.has(media)) return unwrapMediaCache.get(media)!
  const result = media.handles
    ? [media, ...media.handles.flatMap(handle => {
      // a handle naming no node (a plugin's bare row that slipped past the boundary) claims nothing,
      // and one of them must not fail the batch every extractor's rows share
      if (!handle?.node) {
        console.warn(`a handle of ${media.uri} names no node and was skipped`)
        return []
      }
      return handle.relation === 'PART_OF'
        ? [{ ...handle.node, handles: [] }]
        : recursivelyUnwrapMediaHandles(handle.node)
    })]
    : [media]
  if (media.handles) unwrapMediaCache.set(media, result)
  return result
}

function mediaToGQL(media: Media): GQLMedia {
  return {
    _id: media.uri,
    uri: media.uri,
    origin: media.origin,
    id: media.id,
    url: media.url,
    score: media.score,
    type: media.type,
    categories: media.categories ?? [],
    status: media.status,
    titles: media.titles ?? [],
    descriptions: media.descriptions ?? [],
    shortDescriptions: media.shortDescriptions ?? [],
    trailers: media.trailers ?? [],
    covers: media.covers ?? [],
    banners: media.banners ?? [],
    averageScore: media.averageScore,
    popularity: media.popularity,
    startDate: media.startDate,
    endDate: media.endDate,
    isAdult: media.isAdult,
    episodeCount: media.episodeCount,
    nextAiringEpisode: media.nextAiringEpisode,
    season: media.season,
    seasonYear: media.seasonYear,
    genres: media.genres ?? [],
    tags: media.tags ?? [],
    scope: media.scope,
    episodes: [],
    handles: [],
    relations: (media.relations ?? []).map(relationToGQL),
    franchise: media.franchise ?? null,
  }
}

/**
 * A stored relation back out as an edge the schema describes.
 *
 * The node is inflated into a `Media` so the same components draw it as draw a handle, and it is
 * deliberately THIN: what the store kept is what a card needs. Nothing downstream may treat it as a
 * row this store holds, and `_id` is its uri rather than a cluster id for exactly that reason.
 */
function relationToGQL(relation: Media['relations'][number]): GQLMedia['relations'][number] {
  return {
    relation: relation.relation,
    format: relation.format,
    node: {
      _id: relation.uri,
      uri: relation.uri,
      origin: relation.origin,
      id: relation.id,
      url: relation.url,
      score: null,
      type: null,
      categories: [],
      status: relation.status,
      titles: relation.titles ?? [],
      descriptions: [],
      shortDescriptions: [],
      trailers: [],
      covers: relation.covers ?? [],
      banners: [],
      averageScore: null,
      popularity: null,
      startDate: relation.startDate,
      endDate: null,
      isAdult: null,
      episodeCount: relation.episodeCount,
      nextAiringEpisode: null,
      season: null,
      seasonYear: null,
      genres: [],
      tags: [],
      scope: 'RUN',
      episodes: [],
      handles: [],
      relations: [],
    },
  }
}

/**
 * The narrative edges of a whole cluster: every source's, deduplicated, minus the ones pointing back
 * inside.
 *
 * A cluster is one work described by several sources, so two of them naming the same sequel is one
 * edge and not two. Deduplicated on the pair rather than on the target alone, because the same work
 * can legitimately be reached twice under different names.
 *
 * SELF EDGES ARE DROPPED, and that is the part worth keeping. A source can name a related work whose
 * row has merged into THIS cluster, and rendering it would show a media as its own alternative, with
 * a card that navigates back to the page it is on. It is the one way this axis can produce something
 * visibly wrong, so it is cut here rather than in the UI where only one reader would benefit.
 */
function mergeRelations(edges: GQLMedia['relations'], medias: Media[]): GQLMedia['relations'] {
  const inside = new Set<string>(medias.map(media => media.uri))
  const seen = new Set<string>()
  const out: GQLMedia['relations'] = []
  for (const edge of edges) {
    if (!edge?.node?.uri || inside.has(edge.node.uri)) continue
    const key = `${edge.relation}\u0000${edge.node.uri}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
  }
  return out
}

// a cluster is a container only when nothing in it names a run: a legacy mixed cluster is a run
const scopeOfCluster = (medias: Media[]): Media['scope'] =>
  medias.every(media => media.scope === 'CONTAINER') ? 'CONTAINER' : 'RUN'

function episodeToGQL(episode: Episode): GQLEpisode {
  return {
    _id: episode.uri,
    uri: episode.uri,
    origin: episode.origin,
    id: episode.id,
    url: episode.url,
    embedUrl: episode.embedUrl,
    mediaUri: episode.mediaUri,
    score: episode.score,
    titles: episode.titles ?? [],
    descriptions: episode.descriptions ?? [],
    shortDescriptions: episode.shortDescriptions ?? [],
    thumbnails: episode.thumbnails ?? [],
    releaseDate: episode.releaseDate,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
    runtime: episode.runtime,
    handles: [],
  }
}

// Keyed on the union-find ROOT of the cluster's identity space, never on a member: the smallest uri
// moved whenever a member sorting before it landed, and the container cut in `findAllAggregatedMedia`
// handed the same cluster a second id. Any member maps to the same root.
const clusterId = (uris: string[], space: keyof typeof IDENTITY_LABELS) =>
  graph.componentId(uris[0]!, IDENTITY_LABELS[space])

function buildAggregatedIdentity(uris: string[]): { uri: string; id: string } {
  // one handle carrying a ',' or a '/' would split the list or the route path, and the media's whole watch page becomes unreachable
  const routable = uris.filter(isRoutableUri)
  const sorted = [...(routable.length ? routable : uris)].sort()
  return {
    uri: `ag:(${sorted.join(',')})`,
    id: `(${sorted.join(',')})`,
  }
}

export function aggregateMedia(medias: Media[], locationOrigin: string): GQLMedia {
  if (medias.length === 0) throw new Error('Cannot aggregate empty cluster')
  if (medias.length === 1) {
    const m = medias[0]!
    const _id = clusterId([m.uri], scopeOfCluster(medias))
    return {
      ...mediaToGQL(m),
      _id,
      scope: scopeOfCluster(medias),
      handles: [sameAsHandle(mediaToGQL(m)), ...findPartOfMedia(medias).map(node => partOfHandle(mediaToGQL(node)))],
    }
  }

  const sorted = [...medias].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const { uri, id } = buildAggregatedIdentity(medias.map(m => m.uri))
  const _id = clusterId(medias.map(m => m.uri), scopeOfCluster(medias))

  const merged = sorted.reduce<Partial<GQLMedia>>((acc, media) => {
    const gql = mediaToGQL(media)
    const dated = !COERCING_ORIGINS.has(media.origin)
    return {
      ...gql,
      ...acc,
      url: acc.url ?? gql.url,
      type: acc.type ?? gql.type,
      status: acc.status ?? gql.status,
      averageScore: acc.averageScore ?? gql.averageScore,
      popularity: acc.popularity ?? gql.popularity,
      startDate: dated && refinesDate(acc.startDate, gql.startDate) ? gql.startDate : acc.startDate ?? gql.startDate,
      endDate: dated && refinesDate(acc.endDate, gql.endDate) ? gql.endDate : acc.endDate ?? gql.endDate,
      isAdult: acc.isAdult ?? gql.isAdult,
      episodeCount: acc.episodeCount ?? gql.episodeCount,
      nextAiringEpisode: acc.nextAiringEpisode ?? gql.nextAiringEpisode,
      categories: [...(acc.categories ?? []), ...(gql.categories ?? [])],
      genres: [...(acc.genres ?? []), ...(gql.genres ?? [])],
      tags: [...(acc.tags ?? []), ...(gql.tags ?? [])],
      titles: [...(acc.titles ?? []), ...(media.titles ?? [])],
      descriptions: [...(acc.descriptions ?? []), ...(media.descriptions ?? [])],
      shortDescriptions: [...(acc.shortDescriptions ?? []), ...(media.shortDescriptions ?? [])],
      covers: [...(acc.covers ?? []), ...(media.covers ?? [])],
      banners: [...(acc.banners ?? []), ...(media.banners ?? [])],
      trailers: [...(acc.trailers ?? []), ...(media.trailers ?? [])],
      relations: [...(acc.relations ?? []), ...(gql.relations ?? [])],
      // The FIRST source to supply one wins outright, in score order, rather than being merged with
      // another's. A graph is one source's whole account of a series and two of them spliced together
      // would carry edges between nodes only one of them has.
      franchise: acc.franchise ?? gql.franchise,
    }
  }, {
    _id,
    uri,
    id,
    origin: 'ag',
    url: `${locationOrigin}/${getRoutePath(Route.MEDIA, { uri }).replace(/^\//, '')}`,
    score: Math.max(...medias.map(m => m.score ?? 0)),
    scope: scopeOfCluster(medias),
    // The cluster IS the SAME_AS set, by construction: `graph.cluster` over MEDIA_SAME_AS is what
    // produced `medias`. The PART_OF rows are read here rather than by the caller, so that no caller
    // can forget them: a missing link renders as a dead grey icon, which looks like ordinary absence.
    handles: [
      ...sorted.map(m => sameAsHandle(mediaToGQL(m))),
      ...findPartOfMedia(medias).map(node => partOfHandle(mediaToGQL(node))),
    ],
    episodes: [],
  })

  return {
    ...merged as GQLMedia,
    /**
     * The length the BEST sources give, with agreement breaking ties among equals. Everything else in
     * that reduce is a first-non-null-in-score-order pick, which is right for a spelling and not
     * enough for a number.
     *
     * It cannot answer worse than the reduce would: the tier it reads is the same top score the sort
     * puts first, so the two differ only when that tier disagrees with ITSELF, where the reduce takes
     * whichever row arrived first. Cluster order is union-find component order, which is HTTP arrival
     * order, so that case is not merely arbitrary, it is non-deterministic between loads.
     *
     * Measured over the 100 cluster snapshot in dist-seed on 2026-09-09: identical in 100 of 100,
     * because `mal` is the only member of the 0.9 tier until anizip's media row carries a score.
     */
    episodeCount: runLength(medias) ?? merged.episodeCount ?? null,
    relations: mergeRelations(merged.relations ?? [], medias),
    categories: reconcileCategories(merged.categories ?? []),
    ...seasonOf(sorted),
    genres: dedupeLabels(merged.genres),
    tags: dedupeLabels(merged.tags),
    titles: removeDuplicatesByField('title', seasonNamesFirst(byScore(merged.titles ?? []))),
    descriptions: byScore(merged.descriptions ?? []),
    shortDescriptions: byScore(merged.shortDescriptions ?? []),
    covers: byScore(merged.covers ?? []),
    banners: byScore(merged.banners ?? []),
    trailers: removeDuplicatesByField('uri', merged.trailers ?? []),
  }
}

export function aggregateEpisode(episodes: Episode[], locationOrigin: string): GQLEpisode {
  if (episodes.length === 0) throw new Error('Cannot aggregate empty cluster')
  if (episodes.length === 1) {
    const e = episodes[0]!
    return {
      ...episodeToGQL(e),
      _id: clusterId([e.uri], 'EPISODE'),
      handles: [sameAsEpisodeHandle(episodeToGQL(e))],
    }
  }

  const sorted = [...episodes].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const { uri, id } = buildAggregatedIdentity(episodes.map(e => e.uri))
  const _id = clusterId(episodes.map(e => e.uri), 'EPISODE')

  const merged = sorted.reduce<Partial<GQLEpisode>>((acc, episode) => {
    const gql = episodeToGQL(episode)
    return {
      ...gql,
      ...acc,
      url: acc.url ?? gql.url,
      embedUrl: acc.embedUrl ?? gql.embedUrl,
      releaseDate: acc.releaseDate ?? gql.releaseDate,
      seasonNumber: acc.seasonNumber ?? gql.seasonNumber,
      episodeNumber: acc.episodeNumber ?? gql.episodeNumber,
      absoluteEpisodeNumber: acc.absoluteEpisodeNumber ?? gql.absoluteEpisodeNumber,
      runtime: acc.runtime ?? gql.runtime,
      titles: [...(acc.titles ?? []), ...(episode.titles ?? [])],
      descriptions: [...(acc.descriptions ?? []), ...(episode.descriptions ?? [])],
      shortDescriptions: [...(acc.shortDescriptions ?? []), ...(episode.shortDescriptions ?? [])],
      thumbnails: [...(acc.thumbnails ?? []), ...(episode.thumbnails ?? [])],
    }
  }, {
    _id,
    uri,
    id,
    origin: 'ag',
    url: `${locationOrigin}/${getRoutePath(Route.MEDIA, { uri }).replace(/^\//, '')}`,
    mediaUri: uri,
    score: Math.max(...episodes.map(e => e.score ?? 0)),
    handles: sorted.map(e => sameAsEpisodeHandle(episodeToGQL(e))),
  })

  return {
    ...merged as GQLEpisode,
    titles: removeDuplicatesByField('title', byScore(merged.titles ?? [])),
    descriptions: byScore(merged.descriptions ?? []),
    shortDescriptions: byScore(merged.shortDescriptions ?? []),
    thumbnails: byScore(merged.thumbnails ?? []),
  }
}
