// Keep a listing's order still once it has one, so late data changes what a card SAYS and never where
// it SITS. No app imports, so a unit test loads it without the app.

/** Only the part of a media this reads. Structural, so any listing can use it. */
export type Orderable = { _id?: string | null, uri?: string | null, popularity?: number | null }

// a card's cluster `_id`, and each id its address names, which it keeps when a merge or a reload gives it a new `_id`
const namesOf = (media: Orderable): string[] => {
  const uri = media.uri ?? ''
  return [media._id ?? '', ...uri.match(/^ag:\((.*)\)$/)?.[1]?.split(',') ?? [uri]].filter(Boolean)
}

/**
 * The listing in a stable order: every held card keeps its place, everything else follows in the
 * order the resolver gave it. Which cards are held is `orderKeys`'s call.
 *
 * Measured on the deployed home page 2026-09-06: the top ten changed five times over twenty seconds,
 * settling at 2.0 s and then reordering AGAIN at 9.0 s, when positions 2 and 3 swapped. The listing
 * sorts on popularity and re-sorts on every store change, so a show jumps whenever a live source
 * restates its count. The owner's words: "the top10 list keeps changing for like freaking 10-15
 * seconds, I don't want that".
 *
 * Placement is remembered by cluster `_id` and by every id the card's address names, so a card keeps its
 * place when a merge or a reload gives it a new `_id`. Remembered by `_id` alone, such a card appended:
 * measured 2026-10-17, 3 of 12 home page reloads moved Steel Ball Run from place 1 to about place 130.
 *
 * This does not slow anything down or hide anything: every field still updates in place, the titles
 * and covers still sharpen as sources answer, and a genuinely new show still appears. It only refuses
 * to move a card the user has already seen in the place its count gave it.
 */
export const settledOrder = <T extends Orderable>(nodes: readonly T[], placed: readonly (readonly string[])[]): T[] => {
  const rank = new Map<string, number>()
  placed.forEach((names, at) => { for (const name of names) if (!rank.has(name)) rank.set(name, at) })
  const placeOf = (node: T) => Math.min(...namesOf(node).map(name => rank.get(name) ?? Infinity))
  const known: T[] = []
  const fresh: T[] = []
  for (const node of nodes) (placeOf(node) < Infinity ? known : fresh).push(node)
  known.sort((a, b) => placeOf(a) - placeOf(b))
  return [...known, ...fresh]
}

/**
 * The keys to hold on the next update, in the order they are shown. Only a card with a popularity is
 * held: one without was placed by arrival order rather than by a count, so it stays free to move into
 * place when its count lands. Measured 2026-10-13 on anime.fkn.app: the bundle carried no count for
 * the new season, all 158 cards of the first draw had none, and holding them kept that order for good.
 */
export const orderKeys = (nodes: readonly Orderable[]): string[][] =>
  nodes.filter(node => node.popularity != null).map(namesOf).filter(names => names.length)
