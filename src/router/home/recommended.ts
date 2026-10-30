// Home's Recommended for you as data: the shows on the viewer's lists AniList is asked about, its picks for them with
// their votes summed, kept a day, and the picks shown. No component imports, for the reason ./movie.ts gives.

import type { FetchLike } from '../../worker/backoff'
import type { FranchisePick, RecommendationNode } from '../../sources/anilist/franchise'
import type { MediaStatus } from '../../generated/graphql'

import { foldFranchises, franchiseOf, recommendedPicks } from '../../sources/anilist/franchise'
import { isScored } from '../../tracking/score-scale'

/** Where the last answer is kept, in localStorage, with the shows it was asked about and when. */
export const RECOMMENDED_KEY = 'stub.recommended'
export const KEPT_MS = 86_400_000
/**
 * How many shows one request asks about: AniList's most for one page. Measured 2026-10-31, 50 answer in 1.9 to 2.4 s
 * and 63 KB gzipped, where 200, in four pages, took 5.0 to 5.6 s and 253 KB.
 */
export const SEEDS = 50
/**
 * How many of the summed picks are kept, about 68 KB. They are cut after the lists' own are dropped, so a list holding
 * AniList's 1000 most popular shows still fills the row (2026-10-31).
 */
export const KEPT_PICKS = 100
/** How many cards the row holds, as the title page's Recommendations. */
export const SHOWN = 12
/** A scored show is a seed from this 0 to 100 score, a 7 out of 10. */
const LIKED_SCORE = 70

const SEEDING = new Set(['WATCHING', 'REWATCHING', 'COMPLETED'])

/** One work on the viewer's lists, as the row reads it off `viewerLists`. */
export type ListedWork = { uri: string, summary: { status?: string | null, score?: number | null, updatedAt?: string | null } }

/** A pick as the request below selects it. AniList's statuses are stub's own. */
export type Pick = FranchisePick & {
  idMal?: number | null
  format?: string | null
  status?: MediaStatus | null
  title?: { romaji?: string | null, english?: string | null, native?: string | null } | null
  coverImage?: { large?: string | null, color?: string | null } | null
}

export type Summed = { pick: Pick, rating: number }[]

/**
 * The AniList ids asked about, in order: the shows scored LIKED_SCORE or more, and the unscored ones Watching,
 * Rewatching or Completed, the best scored then the latest changed first, SEEDS of them. A show only MyAnimeList or
 * another site places is left out.
 */
export const seedsOf = (works: readonly ListedWork[]): number[] =>
  works
    .flatMap(({ uri, summary }) => {
      const id = /^anilist:(\d+)$/.exec(uri)?.[1]
      const liked = isScored(summary.score) ? summary.score >= LIKED_SCORE : SEEDING.has(summary.status ?? '')
      return id && liked ? [{ id: Number(id), score: summary.score ?? 0, at: Date.parse(summary.updatedAt ?? '') || 0 }] : []
    })
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, SEEDS)
    .map(({ id }) => id)
    .sort((a, b) => a - b)

// `id_in` rather than one aliased `Media` a seed, measured 2026-10-31: one alias naming a missing id fails the whole
// document with 404 and `data: null` for every alias, where `id_in` answers the others; and each alias costs 26 of the
// 500 complexity AniList allows, so 19 seeds at most, where one page costs 33 whatever it holds. Twelve picks a seed,
// as the title page asks.
const RECOMMENDED_QUERY = `query ($ids: [Int]) {
  Page(perPage: ${SEEDS}) {
    media(id_in: $ids, type: ANIME) {
      id
      relations { edges { relationType(version: 2) node { id } } }
      recommendations(perPage: 12, sort: [RATING_DESC, ID]) {
        nodes {
          rating
          mediaRecommendation {
            id
            idMal
            format
            status
            title { romaji english native }
            coverImage { large color }
            startDate { year month day }
            isAdult
            relations { edges { relationType(version: 2) node { id } } }
          }
        }
      }
    }
  }
}`

type Seed = FranchisePick & { recommendations?: { nodes?: RecommendationNode<Pick>[] | null } | null }
type Answer = { data?: { Page?: { media?: (Seed | null)[] | null } | null } | null }

/**
 * `picks` one franchise a card, as `foldFranchises` folds them, none of whose works, or the works their relations name,
 * is on the lists or in `seen`.
 */
const unlisted = (picks: Summed, works: readonly ListedWork[], seen: ReadonlySet<number> = new Set()) => {
  const listed = new Set(works.map(work => work.uri))
  const isListed = (pick: Pick) => listed.has(`mal:${pick.idMal}`) || franchiseOf(pick).some(id => seen.has(id) || listed.has(`anilist:${id}`))
  return foldFranchises(picks).filter(({ members }) => !members.some(isListed))
}

/**
 * Every seed's picks once each, its votes summed, the most voted first, without what `works` holds or the seeds'
 * franchises, KEPT_PICKS of them. It takes a seed's own relations to place a later season: Re:ZERO's first names
 * neither its third nor is named by it, both naming the novel as SOURCE (2026-10-31).
 */
export const summedPicks = (answer: Answer, works: readonly ListedWork[]): Summed => {
  const seeds = (answer.data?.Page?.media ?? []).flatMap(media => media ? [media] : [])
  const votes = new Map<number, Summed[number]>()
  for (const seed of seeds) {
    for (const { pick, rating } of recommendedPicks(seed.recommendations?.nodes ?? [])) {
      votes.set(pick.id, { pick, rating: (votes.get(pick.id)?.rating ?? 0) + rating })
    }
  }
  const summed = [...votes.values()].sort((a, b) => b.rating - a.rating || a.pick.id - b.pick.id)
  const left = new Set(unlisted(summed, works, new Set(seeds.flatMap(seed => franchiseOf(seed)))).flatMap(({ members }) => members.map(({ id }) => id)))
  return summed.filter(({ pick }) => left.has(pick.id)).slice(0, KEPT_PICKS)
}

/**
 * AniList's picks for `seeds`, as `summedPicks` sums them. `fetch` is the viewer's browser's own, as for every host
 * open to CORS. Rejects on a failed request and on an answer holding no seed, so neither is kept.
 */
export const askRecommended = async (seeds: readonly number[], works: readonly ListedWork[], fetch: FetchLike): Promise<Summed> => {
  const response = await fetch('https://graphql.anilist.co/', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: RECOMMENDED_QUERY, variables: { ids: seeds } }),
  })
  const answer = await response.json() as Answer
  if (!response.ok || !answer.data?.Page?.media?.length) throw new Error(`AniList answered ${response.status}`)
  return summedPicks(answer, works)
}

type Kept = { at: number, seeds: number[], picks: Summed }

/** The picks kept for `seeds` less than KEPT_MS ago, or nothing. */
export const readKept = (seeds: readonly number[], now: number): Summed | undefined => {
  try {
    const kept = JSON.parse(globalThis.localStorage.getItem(RECOMMENDED_KEY) ?? 'null') as Kept | null
    return kept && now - kept.at < KEPT_MS && kept.seeds.join() === seeds.join() && Array.isArray(kept.picks) ? kept.picks : undefined
  } catch {
    return undefined
  }
}

export const keep = (seeds: readonly number[], picks: Summed, now: number) => {
  try {
    globalThis.localStorage.setItem(RECOMMENDED_KEY, JSON.stringify({ at: now, seeds, picks }))
  } catch {}
}

export const forgetKept = () => {
  try {
    globalThis.localStorage.removeItem(RECOMMENDED_KEY)
  } catch {}
}

/** The picks the row shows, `unlisted` for the lists as they stand, which may have changed since they were kept. */
export const shownPicks = (picks: Summed, works: readonly ListedWork[]) => unlisted(picks, works).slice(0, SHOWN)
