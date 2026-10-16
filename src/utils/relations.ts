import type { GetMediaDetailsSubscription } from '../generated/graphql'

import { isVideoFormat } from './franchise-layout'
import { relationRank } from './relation-labels'

export type RelationEdge = NonNullable<GetMediaDetailsSubscription['media']>['relations'][number]

/**
 * Sorted by what the relation IS rather than by what the source happened to return first, so the
 * source novel and the sequel sit at the top of every page instead of wherever AniList put them.
 * Ties keep their arrival order, which is at least stable between renders.
 */
export const sortRelations = (edges: readonly RelationEdge[]): RelationEdge[] =>
  [...edges].sort((a, b) => relationRank(a.relation) - relationRank(b.relation))

/**
 * Only the works this app can actually play.
 *
 * Stub aggregates VIDEO. A source novel and a manga are real relations and genuinely interesting, but
 * neither is something you can open here, so a card for one is a dead end: it navigates to a page with
 * no episodes and no way to read it. They come back when there is a product to hand them to.
 */
export const watchableRelations = (edges: readonly RelationEdge[]): RelationEdge[] =>
  edges.filter(edge => isVideoFormat(edge.format))
