// Which media the homepage hero can actually be built from, split out with NO app imports so it can
// be tested: the vitest project only picks up src/worker, src/sources and src/utils, and a component
// pulls in Preact and Emotion besides.

/** Only the parts of a media the hero reads. Deliberately structural, so any source can satisfy it. */
export type TheaterCandidate = {
  _id?: string | null
  uri?: string | null
  titles?: readonly { title?: string | null, score?: number | null }[] | null
  shortDescriptions?: readonly unknown[] | null
  trailers?: readonly unknown[] | null
}

/** How the hero finds the show it holds, and names one it bans. An index cannot: the listing reorders under it. */
export const theaterKey = (media: TheaterCandidate): string => media._id ?? media.uri ?? ''

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

/** How many of the candidates the hero picks between. Kept small so it stays a highlight reel. */
export const THEATER_POOL_SIZE = 10

/** Kitsu's score. Above it in the listing are AniList (0.8) and Jikan (0.9), below it the bundle (0.2). */
const KITSU_SCORE = 0.3

/**
 * Whether a source better than Kitsu has filled this media, which is what the hero takes the owner's
 * "good quality source" to mean. Kitsu and the bundle often answer first, Kitsu with a one-line
 * placeholder synopsis ("The second season of ...") and an announcement trailer that YouTube may
 * refuse to embed where AniList's trailer for the same show plays (measured 2026-10-10). A source
 * answers a show's title, description and trailer together, so the best title's score stands for all three.
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
 * (`fromGoodSource`), for as long as it is an unbanned candidate. Before that, the listing's node for
 * the same show, so a show Kitsu or the bundle filled takes AniList's fields when they merge in, and
 * is held from then on. A ban (its trailer failed) or leaving the candidates (a category tab, or
 * trailers arriving for a text-only pick) replaces it with a random unbanned show from the first
 * `THEATER_POOL_SIZE` candidates. Bans are by key, since an index names whichever show sits there next.
 * With nothing unbanned left to pick, `current` stays, so the hero keeps its text rather than going
 * blank over a full listing.
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
  banned: readonly string[] = [],
  pick: (limit: number) => number = limit => Math.floor(Math.random() * limit)
): T | undefined => {
  const listed = current && candidates.find(media => theaterKey(media) === theaterKey(current))
  if (current && listed && !banned.includes(theaterKey(current))) return fromGoodSource(current) ? current : listed
  const pool = candidates.slice(0, THEATER_POOL_SIZE).filter(media => !banned.includes(theaterKey(media)))
  if (!pool.length) return current
  return pool[Math.min(pool.length - 1, Math.max(0, pick(pool.length)))]
}
