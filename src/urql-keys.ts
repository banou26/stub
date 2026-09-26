// Split out of ./urql.ts so it can be tested: that module imports urql itself, and through it a
// CommonJS require of react that cannot load outside a browser. Same reason sources/aired-date.ts is
// its own file.
import type { KeyingConfig } from '@urql/exchange-graphcache'

import type { Episode, ListEntry, Media, MediaTrailer, PlaybackSource, Tracker, TrackerAnswer, Tracking } from './generated/schema/types.generated'

/**
 * How graphcache identifies each type in the schema.
 *
 * A type with no identity of its own answers null, which tells graphcache to embed it in its parent
 * rather than normalise it. `satisfies KeyingConfig` does NOT force exhaustiveness, so a type missing
 * from here compiles and type-checks, and shows up only as a dev-console warning while the cache
 * invents a key for an object that has none. tests/unit/urql-keys.test.ts is what actually pins it.
 */
export const keyResolvers = {
  Media: (media) => (media as Media)._id,
  // An EDGE has no identity of its own: it is a relation between two rows, and the row it points at is
  // keyed by its own `_id`. Null tells graphcache to embed it in its parent rather than normalise it.
  // Omitting these compiles, because `satisfies KeyingConfig` does not force exhaustiveness, and shows
  // up only as a dev-console warning while the cache invents keys for unkeyable objects.
  MediaHandle: () => null,
  // a narrative edge, keyed no more than a structural one: the work it points at carries its own `_id`
  MediaRelationEdge: () => null,
  // A franchise graph is one media's whole account of its series, so it is embedded in that media
  // rather than normalised: its nodes are thin snapshots keyed by uri, not rows the store holds.
  MediaFranchise: () => null,
  MediaFranchiseNode: () => null,
  MediaFranchiseEdge: () => null,
  EpisodeHandle: () => null,
  MediaTitle: () => null,
  MediaDescription: () => null,
  MediaShortDescription: () => null,
  MediaCover: () => null,
  MediaBanner: () => null,
  MediaAiringEpisode: () => null,
  // The trace pair: one entry is a statement ABOUT a field of the media carrying it, so it has no
  // identity away from that media and is embedded in it like every title and cover above.
  MediaFieldProvenance: () => null,
  MediaAnomaly: () => null,
  MediaTrailer: (trailer) => (trailer as MediaTrailer).uri,
  Episode: (episode) => (episode as Episode)._id,
  EpisodeTitle: () => null,
  EpisodeDescription: () => null,
  EpisodeShortDescription: () => null,
  EpisodeThumbnail: () => null,
  PlaybackSource: (playbackSource) => (playbackSource as PlaybackSource).uri,
  // Tracking. A tracker's entry is keyed by its own id and the summary by one no tracker uses
  // (tracking/aggregate.ts), so the summary never lands on one tracker's row. An outcome and a date
  // describe their parent and are embedded in it.
  Tracking: (tracking) => String((tracking as Tracking)._id),
  TrackerAnswer: (answer) => String((answer as TrackerAnswer)._id),
  Tracker: (tracker) => (tracker as Tracker).id,
  ListEntry: (entry) => String((entry as ListEntry)._id),
  FuzzyDate: () => null,
  WriteOutcome: () => null,
} satisfies KeyingConfig
