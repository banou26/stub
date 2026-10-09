// Which listed card, if any, the media route is showing. Kept pure and free of the component's
// imports so it can be tested: media-modal.tsx reaches urql, whose CommonJS `require('react')` no
// alias intercepts, and therefore cannot load under vitest at all.

import { fromAggregatedUri, isAggregatedUri, isRoutableUri, type AggregatedUri } from '../../utils/uri'

/** Every source handle a uri names: an aggregate's members, or a bare `origin:id` as a cluster of one. */
const memberUris = (uri: string | undefined): readonly string[] =>
  !uri ? []
  : isAggregatedUri(uri) ? fromAggregatedUri(uri as AggregatedUri)?.handleUris ?? []
  // `isRoutableUri` rather than `isUri`, which THROWS on a comma in the id and would take the whole
  // app down with it: this app has no error boundary anywhere
  : isRoutableUri(uri) ? [uri]
  : []

/**
 * Whether two uris name the same work.
 *
 * THEY SHARE A MEMBER, and equality is never the question. An aggregated uri is a set of source
 * handles that GROWS as the store folds more sources into the cluster, and the address bar carries
 * whichever set was known when the link was made: a shared or bookmarked link routinely names more
 * sources than the home listing's own card does, `ag:(anilist:178789,cr:G24H1N3MP-GS00374452,jw:...,
 * kitsu:49002,mal:59193,nf:...,offline:mal-59193)` against the card's
 * `ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)`. Compared for equality those are two
 * different works, which is how a pasted media link came to look broken (open problem 22).
 *
 * A bare `origin:id` counts as a cluster of one, so a link that names a work through a single source
 * still finds it in the listing. `matchAggregatedUris` refuses both sides that are not `ag:(...)`,
 * and that is the case this adds.
 */
export const namesSameWork = (uri1: string | undefined, uri2: string | undefined): boolean => {
  const members = memberUris(uri1)
  if (!members.length) return false
  const others = new Set(memberUris(uri2))
  return members.some(member => others.has(member))
}

/**
 * The listed card the route's uri names, or nothing when the listing does not carry that work.
 *
 * NOTHING IS NOT A CLOSED MODAL. This decides only what the modal can draw from the page it opens
 * over while the `media` subscription is still asking, and that subscription answers for any uri
 * that names a work, listed or not (`findAggregatedMediaForContext` falls back to the members of an
 * aggregate one by one). The modal opens on the route alone.
 */
export const listedMediaFor = <T extends { uri: string }>(
  routeUri: string | undefined,
  mediaNodes: readonly T[] | undefined
): T | undefined =>
  mediaNodes?.find(media => namesSameWork(media.uri, routeUri))
