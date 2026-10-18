import type { Media } from '../../generated/schema/types.generated'
import type { Media as StoreMedia } from './types'
import type { Uri } from '../../utils/uri'

/**
 * The graphql row a source produced, as the row the store holds.
 *
 * Every nullable field lands as `null` rather than `undefined`, and `scope` defaults to RUN: a source
 * that says nothing about scope is naming a run, which is what every source did before scope existed.
 * Pure, and outside ../extractor.ts on purpose: that module reaches urql and cannot load under vitest,
 * so a field dropped here would go unpinned.
 */
export const normalizeToStoreMedia = (media: Media): StoreMedia => ({
  uri: media.uri as Uri,
  origin: media.origin,
  id: media.id,
  url: media.url ?? null,
  score: media.score ?? null,
  type: (media.type as StoreMedia['type']) ?? null,
  categories: media.categories ?? [],
  status: (media.status as StoreMedia['status']) ?? null,
  titles: media.titles ?? [],
  descriptions: media.descriptions ?? [],
  shortDescriptions: media.shortDescriptions ?? [],
  trailers: media.trailers ?? [],
  covers: media.covers ?? [],
  banners: media.banners ?? [],
  averageScore: media.averageScore ?? null,
  popularity: media.popularity ?? null,
  startDate: media.startDate ?? null,
  endDate: media.endDate ?? null,
  isAdult: media.isAdult ?? null,
  episodeCount: media.episodeCount ?? null,
  nextAiringEpisode: media.nextAiringEpisode ?? null,
  airingSchedule: media.airingSchedule ?? null,
  season: (media.season as StoreMedia['season']) ?? null,
  seasonYear: media.seasonYear ?? null,
  genres: media.genres ?? [],
  tags: media.tags ?? [],
  scope: (media.scope as StoreMedia['scope']) ?? 'RUN',
  // Flattened here rather than kept as nested media: the other end is a snapshot the store never
  // clusters on. See `Relation` in ./types.ts.
  relations: (media.relations ?? []).flatMap(edge => {
    const node = edge?.node
    if (!node?.uri) return []
    return [{
      relation: edge.relation as StoreMedia['relations'][number]['relation'],
      format: edge.format ?? null,
      uri: node.uri as Uri,
      origin: node.origin,
      id: node.id,
      url: node.url ?? null,
      titles: node.titles ?? [],
      covers: node.covers ?? [],
      status: (node.status as StoreMedia['status']) ?? null,
      episodeCount: node.episodeCount ?? null,
      startDate: node.startDate ?? null,
    }]
  }),
  franchise:
    media.franchise
      ? {
        nodes: (media.franchise.nodes ?? []).map(node => ({
          uri: node.uri as Uri,
          titles: node.titles ?? [],
          covers: node.covers ?? [],
          format: node.format ?? null,
          status: (node.status as StoreMedia['status']) ?? null,
          episodeCount: node.episodeCount ?? null,
          startDate: node.startDate ?? null,
        })),
        edges: (media.franchise.edges ?? []).map(edge => ({
          from: edge.from as Uri,
          to: edge.to as Uri,
          relation: edge.relation as StoreMedia['relations'][number]['relation'],
        })),
      }
      : null,
})
