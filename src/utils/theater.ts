// Which media the homepage hero can be built from, and which one it holds. No app imports, so the rules
// are tested without rendering the hero.

/** Only the parts of a media the hero reads. Deliberately structural, so any source can satisfy it. */
export type TheaterCandidate = {
  _id?: string | null
  uri?: string | null
  titles?: readonly { title?: string | null, score?: number | null }[] | null
  shortDescriptions?: readonly unknown[] | null
  trailers?: readonly unknown[] | null
  handles?: readonly { relation: string, node: { uri: string } }[] | null
}

/** The listing's id for a media. A merge can retire it, so the hero does not find its show by it alone. */
export const theaterKey = (media: TheaterCandidate): string => media._id ?? media.uri ?? ''

/** Whether `media` has a handle of `relation` to one of the sources `held` is (its SAME_AS handles). */
const linksTo = (media: TheaterCandidate, held: TheaterCandidate, relation: string): boolean => {
  const sources = held.handles?.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri) ?? []
  return !!media.handles?.some(handle => handle.relation === relation && sources.includes(handle.node.uri))
}

/**
 * Whether `media` is the show `held` is: the same id, or a source in common. The id is the cluster's,
 * and a merge of two clusters of one show retires one of them, while the merged card keeps every
 * source of both.
 */
export const isSameShow = (media: TheaterCandidate, held: TheaterCandidate): boolean =>
  theaterKey(media) === theaterKey(held) || linksTo(media, held, 'SAME_AS')

/**
 * Whether `media` is a season the listing draws in the place of the show `held` is (section 6.1 of
 * the representation design, `inAnswerOrder`): it shares no source with the show, only a PART_OF
 * handle to one. A sibling season, PART_OF the same show, is not one.
 */
export const standsInFor = (media: TheaterCandidate, held: TheaterCandidate): boolean => linksTo(media, held, 'PART_OF')

/**
 * The media the hero can render, best first.
 *
 * The hero shows a title, a short description, and autoplays a trailer when there is one. So those
 * are the things to select on.
 *
 * It used to gate on `score >= 0.8` instead, which was never a quality measure: `score` is the
 * source-confidence weight the store merges fields by, and 0.8 only ever meant "AniList (0.9) or
 * Jikan (0.9) is in this cluster". When both went down on 2026-08-16 every remaining record scored
 * Kitsu's 0.3, `aggregateMedia` takes the cluster MAX, and the hero silently rendered an empty shell
 * while the season row below it was full. Gating on the fields actually used cannot fail that way,
 * because a source that can fill the hero is by definition good enough for it.
 *
 * A trailer is preferred rather than required: with no trailer the hero still shows a title and a
 * description, which beats showing nothing.
 */
export const theaterCandidates = <T extends TheaterCandidate>(mediaNodes: readonly T[]): T[] => {
  const usable = mediaNodes.filter(media => media.titles?.length && media.shortDescriptions?.length)
  const withTrailer = usable.filter(media => media.trailers?.length)
  return withTrailer.length ? withTrailer : usable
}

/** What the hero reads of the browser's `navigator.connection`, where it has one. */
export type ConnectionReading = { effectiveType?: string, saveData?: boolean }

/**
 * Whether the hero plays no trailer on this connection: one the browser reads as 2G or slower, or with
 * data saving on. Not 3G: Chrome reads that from latency alone, so a fast link with a 270 ms round
 * trip is 3G.
 */
export const slowConnection = (connection: ConnectionReading | undefined): boolean =>
  !!connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')

/**
 * How long sources that have not connected hold the hero's trailer back, from when one started
 * connecting. A source that never connects (its files gone, or FKN unreachable) is retried for as long
 * as the page is open, and fails within about a second on a fast link. Measured 2026-10-16 at 6 KB/s
 * and 300 ms, a source connected 39 to 191 s after it was added, most often within 110 s, and in some
 * runs not within 200 s.
 */
export const SOURCES_WAIT_MS = 120_000

/** How many of the candidates the hero picks between. Kept small so it stays a highlight reel. */
export const THEATER_POOL_SIZE = 10

/** Kitsu's score. Above it in the listing are AniList (0.8) and Jikan (0.9, its romaji 0.4), below it the bundle (0.2). */
const KITSU_SCORE = 0.3

/**
 * Whether a source better than Kitsu has filled this media, which is what the hero takes the owner's
 * "good quality source" to mean. Kitsu and the bundle often answer first, Kitsu with a one-line
 * placeholder synopsis ("The second season of ...") and an announcement trailer that YouTube may
 * refuse to embed where AniList's trailer for the same show plays (measured 2026-10-10). A source
 * answers a show's title, description and trailer together, so the leading title's score stands for all three.
 * Jikan's romaji (0.4) sits below its description (0.9), and still above Kitsu.
 *
 * It decides when what the hero shows is final, and only for `THEATER_WAIT_MS` whether it shows anything.
 */
export const fromGoodSource = (media: TheaterCandidate): boolean => (media.titles?.[0]?.score ?? 0) > KITSU_SCORE

/**
 * How long after it mounts the hero picks only among shows `fromGoodSource` accepts, rather than show
 * Kitsu's fields and replace them a second later. Measured on 26 cold loads 2026-10-10, AniList's
 * fields reached the listing 0.9 to 5.0 s after the hero mounted, and at most 3.8 s after in the loads
 * where Kitsu answered first. With AniList and Jikan both down, as on 2026-08-16, the hero fills from
 * Kitsu once this has passed.
 */
export const THEATER_WAIT_MS = 5000

/**
 * What the hero shows: `current` exactly as it was picked once a good source has filled it
 * (`fromGoodSource`), for as long as it is a candidate. Before that, the listing's node for the same
 * show (`isSameShow`), so a show Kitsu or the bundle filled takes AniList's fields when they merge in,
 * and is held from then on. A season drawn in the show's place (`standsInFor`) keeps `current` as it
 * is. Leaving the candidates (a category tab, or trailers arriving for a text-only pick) replaces it
 * with a random show from the first `THEATER_POOL_SIZE` candidates. With no candidates at all,
 * `current` stays, so the hero keeps its text rather than going blank.
 *
 * Held rather than looked up again because sources keep merging into the listing for seconds after
 * it fills, and later data is not better data for the hero. Measured on cold loads 2026-10-10, 2.1
 * visible changes per load on anime.fkn.app: the pick's title, description or trailer swapped to
 * another source's in place (anizip's titles carry a year and backticks), and shows that gained a
 * trailer pushed the pick out of the pool, which re-picked.
 *
 * `pick` is injected so a test does not depend on Math.random.
 */
export const holdTheaterPick = <T extends TheaterCandidate>(
  candidates: readonly T[],
  current: T | undefined,
  pick: (limit: number) => number = limit => Math.floor(Math.random() * limit)
): T | undefined => {
  if (current) {
    const listed = candidates.find(media => isSameShow(media, current))
    if (listed) return fromGoodSource(current) ? current : listed
    if (candidates.some(media => standsInFor(media, current))) return current
  }
  const pool = candidates.slice(0, THEATER_POOL_SIZE)
  if (!pool.length) return current
  return pool[Math.min(pool.length - 1, Math.max(0, pick(pool.length)))]
}
