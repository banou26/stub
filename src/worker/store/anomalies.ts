import type { Media } from './types'
import { runLength } from './consensus'

/**
 * Ways a cluster can be visibly wrong ABOUT ITSELF, without anyone having to say what it should be.
 *
 * The merge fixtures decide each case by hand: these uris together, those two never. That is the right
 * way to pin a known answer and the wrong way to find an unknown one, because it only ever looks where
 * somebody already looked. These rules need no expected answer, so they can be swept over every
 * cluster in the corpus at once, and over a franchise walked live.
 *
 * Every rule here is a CONTRADICTION rather than a preference. A cluster that trips one is claiming
 * two things that cannot both be true, which is why it is safe to run them everywhere.
 */
export type Anomaly = { rule: string, detail: string }

/**
 * Two ids of one origin that are not the same id at different precision.
 *
 * One source names one thing once. Two of its ids in a cluster means a union happened that the source
 * itself would refuse, and `graph.link` has no inverse, so it is permanent for the session. The
 * precision case is real and must not be reported: `cr:G24H1N3MP` beside `cr:G24H1N3MP-GS00374452` is
 * a series id and one of its seasons, `<a>` against `<a>-<something>`.
 */
const disagreeingIds = (cluster: readonly Media[]): Anomaly[] => {
  const byOrigin = new Map<string, string[]>()
  for (const media of cluster) {
    if (!media.origin || !media.id) continue
    byOrigin.set(media.origin, [...(byOrigin.get(media.origin) ?? []), media.id])
  }

  const found: Anomaly[] = []
  for (const [origin, ids] of [...byOrigin].sort()) {
    if (ids.length < 2) continue
    // one-way: dropping both sides lets a shared parent hide the disagreement it sits between, so
    // `[A, A-1, A-2]` would report nothing at all
    const specific = [...new Set(ids)].filter(id => !ids.some(other => other.startsWith(`${id}-`))).sort()
    if (specific.length > 1) {
      found.push({
        rule: 'two ids of one origin',
        detail: `${origin} names ${specific.join(' and ')}, which are different runs to that source`,
      })
    }
  }
  return found
}

/**
 * A run listing more episodes than its sources agree it is long.
 *
 * The one the membership rules cannot see, because the cluster is right about who it contains: an
 * episode arrives attached to whichever media published it, so a member that packages this run inside
 * a longer season brings that season's whole list. Mushoku Tensei season 1 part 1 listed 24 for an 11
 * episode run this way (2026-09-09).
 *
 * `listed` is passed in rather than read, because counting it means walking the episode graph and
 * these rules are pure.
 */
const overLength = (cluster: readonly Media[], listed: number | undefined): Anomaly[] => {
  const length = runLength(cluster)
  if (length == null || listed == null || listed <= length) return []
  return [{
    rule: 'lists more episodes than it is long',
    detail: `${listed} episodes listed against a length of ${length} that ${
      cluster.filter(media => media.episodeCount === length).length} of its sources agree on`,
  }]
}

/** Every anomaly in one cluster. An empty array is the only acceptable answer. */
export const clusterAnomalies = (cluster: readonly Media[], listed?: number): Anomaly[] =>
  [...disagreeingIds(cluster), ...overLength(cluster, listed)]
