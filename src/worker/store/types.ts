import type { Uri } from '../../utils/uri'

export const mediaTypeEnum = ['TV', 'TV_SHORT', 'MOVIE', 'ANIME', 'SPECIAL', 'OVA', 'ONA', 'LIVE_ACTION'] as const
export type MediaType = typeof mediaTypeEnum[number]

/**
 * The four broadcast seasons, mirroring `MediaSeason` in the graphql schema.
 *
 * UPPER CASE, like every enum here and unlike `ANIME_SEASONS` in sources/season.ts, which is lower
 * case because it names the same four seasons for a different consumer. `upperSeason` and
 * `lowerSeason` in that file are the only bridge between the two spellings; do not add a third.
 */
export const mediaSeasonEnum = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
export type MediaSeason = typeof mediaSeasonEnum[number]

export const mediaStatusEnum = ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'] as const
export type MediaStatus = typeof mediaStatusEnum[number]

export const mediaCategoryEnum = ['ANIME', 'SERIES', 'MOVIE'] as const
export type MediaCategory = typeof mediaCategoryEnum[number]

/**
 * What a handle claims, mirroring `MediaHandleRelation` in the graphql schema.
 *
 * Mirrored rather than imported, like every other enum in this file, so the store does not depend on
 * generated code. SAME_AS is the only one that unions: see `upsertMedia` in ./db.ts.
 */
export const handleRelationEnum = ['SAME_AS', 'PART_OF'] as const
export type HandleRelation = typeof handleRelationEnum[number]

/**
 * What a handle may SAY, which is the GraphQL enum and is wider than what this store can act on.
 *
 * `MediaHandleRelation` gained `INCLUDES` as an OUTPUT value: a run's page lists the catalogue seasons
 * that hold it. This store has no edge for that direction and never will, since the graph store
 * replaces it, so a claim carrying it is refused at `upsertMedia` rather than at every caller. The
 * type exists so the refusal is visible in the signature instead of being a cast at four call sites.
 */
export type ClaimedRelation = HandleRelation | 'INCLUDES'

/**
 * How one work relates to another as a STORY, mirroring `MediaRelation` in the graphql schema.
 *
 * The OTHER axis from `HandleRelation`, and the distinction is load bearing: nothing here may ever
 * union a cluster, because a sequel is a different work. See the enum's own doc in
 * `worker/resolvers/media/schema.gql`.
 */
export const mediaRelationEnum = [
  'ADAPTATION', 'PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'CHARACTER', 'SUMMARY',
  'ALTERNATIVE', 'SPIN_OFF', 'SOURCE', 'COMPILATION', 'CONTAINS', 'OTHER',
] as const
export type MediaRelation = typeof mediaRelationEnum[number]

/**
 * One related work, stored FLAT rather than as a nested media.
 *
 * A snapshot, not a row. Storing the other end as a `Media` would put a second copy of a work into
 * the store's own space, where the clustering would then have to decide what it is, and the whole
 * point of this axis is that it never asks that question. Flat also keeps the record small: a
 * franchise is dozens of edges and each carries a title and a cover, nothing more.
 */
export type Relation = {
  relation: MediaRelation
  /** The source's own word for the kind of work: `TV`, `MOVIE`, `MANGA`, `NOVEL`. Display only. */
  format: string | null
  uri: Uri
  origin: string
  id: string
  url: string | null
  titles: Title[]
  covers: Cover[]
  status: MediaStatus | null
  episodeCount: number | null
  startDate: string | null
}

/** One work in a franchise graph, and one arrow between two of them. See `MediaFranchise`. */
export type FranchiseNode = {
  uri: Uri
  titles: Title[]
  covers: Cover[]
  format: string | null
  status: MediaStatus | null
  episodeCount: number | null
  startDate: string | null
}
export type FranchiseEdge = { from: Uri, to: Uri, relation: MediaRelation }
export type Franchise = { nodes: FranchiseNode[], edges: FranchiseEdge[] }

/**
 * Which identity space a row lives in, mirroring `MediaScope` in the graphql schema.
 *
 * A RUN is one broadcast run, the unit this store aggregates. A CONTAINER is a show, a series, a
 * franchise page: something several runs are part of. Sameness unions only within one scope; a claim
 * across scopes is derived as PART_OF. See `upsertMedia` in ./db.ts.
 */
export const mediaScopeEnum = ['RUN', 'CONTAINER'] as const
export type MediaScope = typeof mediaScopeEnum[number]

export type Title = { language: string; title: string; score?: number | null }
export type Description = { language: string; description: string; score?: number | null }
export type ShortDescription = { language: string; shortDescription: string; score?: number | null }
/** An episode a source has scheduled and that has not aired yet. */
export type AiringEpisode = { episodeNumber: number; airingAt: string }

export type Cover = { language?: string | null; url: string; height?: number | null; width?: number | null; color?: string | null; score?: number | null }
export type Banner = { language?: string | null; url: string; height?: number | null; width?: number | null; color?: string | null; score?: number | null }
export type Trailer = { uri: string; origin: string; id: string; url?: string | null; language?: string | null; thumbnail?: string | null; score?: number | null }
export type Thumbnail = { language?: string | null; url: string; height?: number | null; width?: number | null; color?: string | null; score?: number | null }

export type Media = {
  uri: Uri
  origin: string
  id: string
  url: string | null
  score: number | null
  type: MediaType | null
  categories: MediaCategory[]
  status: MediaStatus | null
  titles: Title[]
  descriptions: Description[]
  shortDescriptions: ShortDescription[]
  trailers: Trailer[]
  covers: Cover[]
  banners: Banner[]
  averageScore: number | null
  popularity: number | null
  startDate: string | null
  endDate: string | null
  isAdult: boolean | null
  episodeCount: number | null
  nextAiringEpisode: AiringEpisode | null
  airingSchedule: AiringEpisode[] | null
  season: MediaSeason | null
  seasonYear: number | null
  genres: string[]
  tags: string[]
  scope: MediaScope
  /** Narrative edges out of this row. Never clustered on: see `Relation`. */
  relations: Relation[]
  /** The whole series as a graph, where a source could supply one. Null is the common case. */
  franchise: Franchise | null
}

export type Episode = {
  uri: Uri
  origin: string
  id: string
  url: string | null
  embedUrl: string | null
  mediaUri: Uri
  score: number | null
  titles: Title[]
  descriptions: Description[]
  shortDescriptions: ShortDescription[]
  thumbnails: Thumbnail[]
  releaseDate: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  absoluteEpisodeNumber: number | null
  runtime: number | null
  videoQualities: string[] | null
  audioQualities: string[] | null
  audioLanguages: string[] | null
  subtitleLanguages: string[] | null
}

export type Origin = {
  id: string
  url: string | null
  name: string
  icon: string | null
  color: string | null
  isApiOnly: boolean
}
