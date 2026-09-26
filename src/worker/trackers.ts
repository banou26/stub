import type { Tracker } from '../generated/schema/types.generated'

import * as trackerDefinitions from '../sources/trackers'
import { loadCatalog } from '../sources/offline/catalog'
import { makeExtractor } from './extractor'

/**
 * Every tracking provider, each on its own server built exactly as a media source's is, less the two
 * things a tracker must not have: a response cache (an answer is the viewer's own and moves on every
 * write) and the ingest hook (a list entry never enters the metadata graph).
 */
export const trackers = Object.values(trackerDefinitions).map(definition =>
  makeExtractor(definition, { responseCache: false, ingest: false, context: () => ({ catalog: loadCatalog }) }))

export type TrackerEntry = (typeof trackers)[number]

/** The provider a tracker entry is, as an answer names it when the tracker itself could not. */
export const trackerOf = (entry: TrackerEntry): Tracker => {
  const definition = entry.extractor as TrackerEntry['extractor'] & { scoreScale?: string }
  return {
    id: definition.origin,
    name: definition.name,
    icon: definition.icon ?? null,
    color: definition.color ?? null,
    signedIn: false,
    account: null,
    canWrite: false,
    scoreScale: definition.scoreScale ?? 'POINT_100',
  }
}
