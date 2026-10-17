// Split into its own module with NO imports so it can be tested: an extractor pulls in the source
// barrel and, through it, a CommonJS require of react that cannot load outside a browser. Same reason
// ./season.ts and ./catalogue-gate.ts are separate.

/**
 * The date a media actually started or ended, preferring AniList's own `startDate` over its airing
 * schedule, and never trusting the schedule's array ORDER.
 *
 * This read `airingSchedule.edges.at(0)` and `.at(-1)`, which is wrong twice over.
 *
 *   - `airingSchedule` lists what AniList has SCHEDULED, which for a mid-season show is the episodes
 *     still to come. `at(0)` is then the NEXT episode rather than the first, so the media's start date
 *     is a date in the future, off by however far into its run the show is. Measured over a 333 record
 *     sample: precise but wrong on 7 of them, by 4 to 1001 days.
 *   - A show that finished airing often has no schedule left at all, so `at(0)` is undefined and the
 *     media went out with NO start date. That was 42% of entries, and it is not a cosmetic gap:
 *     profileCluster derives its `years` from startDate and fuzzyMergeMediaClusters only compares
 *     clusters that share a year, so a cluster with no date is never compared with anything and
 *     silently never merges.
 *
 * `media.startDate` is a FuzzyDate whose members are individually nullable, and it was already in the
 * query, feeding only matchSeasonByDate. A complete one wins outright. An incomplete one is worth less
 * than a real airing date, so the schedule is tried next, by EPISODE NUMBER and then by earliest time,
 * never by position. Only if both fail does the partial date go out, as `YYYY` or `YYYY-MM`: every
 * reader that parses it gets the first of that year or month, which buckets as before and reads as
 * no day, while the page can still show "2027" rather than a January 1 nobody named.
 */
export type FuzzyDate = { year?: number | null, month?: number | null, day?: number | null } | null | undefined
export type AiringEdges = { edges?: ({ node?: { airingAt?: number | null, episode?: number | null } | null } | null)[] | null } | null | undefined

export const airedDate = (fuzzy: FuzzyDate, schedule: AiringEdges, end: 'first' | 'last'): string | undefined => {
  if (fuzzy?.year && fuzzy.month && fuzzy.day) {
    return new Date(Date.UTC(fuzzy.year, fuzzy.month - 1, fuzzy.day)).toUTCString()
  }

  const nodes =
    (schedule?.edges ?? [])
      .map(edge => edge?.node)
      .filter((node): node is { airingAt?: number | null, episode?: number | null } => Boolean(node?.airingAt))
  if (nodes.length) {
    const byEpisode = nodes.filter(node => node.episode === 1)
    const chosen =
      end === 'first' && byEpisode.length ? byEpisode[0]!
      : nodes.reduce((best, node) =>
        (end === 'first' ? node.airingAt! < best.airingAt! : node.airingAt! > best.airingAt!) ? node : best
      )
    return new Date(chosen.airingAt! * 1000).toUTCString()
  }

  if (fuzzy?.year) return fuzzy.month ? `${fuzzy.year}-${String(fuzzy.month).padStart(2, '0')}` : String(fuzzy.year)
  return undefined
}

