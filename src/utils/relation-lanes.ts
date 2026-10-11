import type { GetMediaDetailsSubscription } from '../generated/graphql'

import { isVideoFormat } from './franchise-layout'
import { relationRank } from './relation-labels'

/**
 * How a relation ROW is assembled: what belongs on it, in what order, and in which of its three lanes.
 *
 * Separate from the component because none of it is rendering, and because the unit runner cannot
 * import a .tsx: a rule about where a card goes is exactly the kind of thing that should be pinned
 * without standing a DOM up.
 */
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

/**
 * The three lanes a relation row is laid out in, which read as a TIMELINE rather than a fill.
 *
 * What came before is on the left, what comes after is on the right, and everything that is neither
 * sits between them. A single grid filled left to right put the sequel next to the prequel and left
 * the right half of the modal empty, which reads as a row that ran out of cards rather than as an
 * order, and it moves a work's position every time another relation is added.
 *
 * Each lane keeps `sortRelations`' order within itself, so the middle is still ranked by what the
 * relation is.
 */
export const relationLanes = (edges: readonly RelationEdge[]) => {
  const sorted = sortRelations(edges)
  return {
    before: sorted.filter(edge => edge.relation === 'PREQUEL'),
    middle: sorted.filter(edge => edge.relation !== 'PREQUEL' && edge.relation !== 'SEQUEL'),
    after: sorted.filter(edge => edge.relation === 'SEQUEL'),
  }
}
