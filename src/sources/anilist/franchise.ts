// AniList's franchise rules, which the extractor and home's Recommended for you both read: the relations that make one
// franchise, a sortable day, and recommendations folded one franchise to a card. Import free, so the page loads it
// without the extractor.

/**
 * The relations a franchise WALK may follow, which is not all of them.
 *
 * CHARACTER and OTHER are reported to the reader and never traversed. A crossover promotional short
 * relates by CHARACTER to every series taking part, so following those edges walks straight out of
 * the franchise: measured 2026-09-08 from `Tensei Shitara Slime Datta Ken`, two hops following
 * everything reached 36 works of which 10 were other franchises entirely (Attack on Titan, Fire
 * Force, Chihayafuru among them), while following only these reached 21 works and nothing foreign.
 *
 * The novel and the manga ARE followed, and have to be: an anime franchise's hub is its source
 * material, and the later seasons hang off that rather than off each other.
 */
export const FRANCHISE_EDGES = new Set([
  'SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE',
  'PARENT', 'SOURCE', 'ADAPTATION', 'SUMMARY', 'COMPILATION', 'CONTAINS',
])

type Day = { year?: number | null, month?: number | null, day?: number | null }

/**
 * A sortable day, zero padded, out of the parts AniList publishes.
 *
 * The YEAR ALONE is not enough for the one thing this graph is for. A franchise routinely puts two
 * cours and a film in the same year, and a year-only key files all three into one column, which is
 * exactly where the reading order stops being visible. A missing month or day sorts to the start of
 * the year, which is the right guess for a work whose exact date nobody recorded.
 */
export const franchiseDate = (date: Day | null | undefined): string | undefined => {
  if (!date?.year) return undefined
  const pad = (value: number | null | undefined) => String(value ?? 1).padStart(2, '0')
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** A work as far as these rules read it: AniList's `Media` with its relations' ids. */
export type FranchisePick = {
  id: number
  isAdult?: boolean | null
  startDate?: Day | null
  relations?: { edges?: ({ relationType?: unknown, node?: { id: number } | null } | null)[] | null } | null
}

/** One of AniList's recommendation nodes. */
export type RecommendationNode<P> = { rating?: number | null, mediaRecommendation?: P | null } | null

/** The work and every work its own relations make it one franchise with. */
export const franchiseOf = (pick: FranchisePick): number[] => [
  pick.id,
  ...(pick.relations?.edges ?? []).flatMap(edge => edge?.node?.id && FRANCHISE_EDGES.has(String(edge.relationType)) ? [edge.node.id] : []),
]

/** The picks shown of AniList's nodes, in its order: none adult, and none rated 0 or below. */
export const recommendedPicks = <P extends FranchisePick>(nodes: readonly RecommendationNode<P>[]) =>
  nodes.flatMap(node => {
    const pick = node?.mediaRecommendation
    return pick?.id && !pick.isAdult && node?.rating && node.rating > 0 ? [{ pick, rating: node.rating }] : []
  })

/**
 * Picks best rated first, a franchise once, with the picks it folded (`members`).
 *
 * Picks reaching one work by `FRANCHISE_EDGES` are one franchise, drawn as its earliest work at its best rated pick's
 * place: Mushoku Tensei's twelve hold Slime's first season, its second and the second's part two, which name one
 * manga as their SOURCE where no anime relation joins the first to the others (108465, 2026-10-29).
 */
export const foldFranchises = <P extends FranchisePick>(picks: readonly { pick: P, rating: number }[]) => {
  const group = picks.map((_, index) => index)
  const root = (index: number): number => group[index] === index ? index : (group[index] = root(group[index]!))
  const reachedBy = new Map<number, number>()
  picks.forEach(({ pick }, index) => {
    for (const id of franchiseOf(pick)) {
      const other = reachedBy.get(id)
      if (other === undefined) reachedBy.set(id, index)
      else group[Math.max(root(other), root(index))] = Math.min(root(other), root(index))
    }
  })
  const groups = new Map<number, { pick: P, rating: number }[]>()
  picks.forEach((entry, index) => groups.set(root(index), [...groups.get(root(index)) ?? [], entry]))
  return [...groups.values()].map(([best, ...rest]) => {
    const { pick } = rest.reduce((earliest, entry) => {
      const date = franchiseDate(entry.pick.startDate)
      const held = franchiseDate(earliest.pick.startDate)
      return date && (!held || date < held) ? entry : earliest
    }, best!)
    return { pick, rating: best!.rating, members: [best!, ...rest].map(entry => entry.pick) }
  })
}
