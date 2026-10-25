/**
 * The field policy of 6.3 and 6.4: which member supplies each field of an aggregated row, what the
 * card carries, and what is recorded about every choice.
 *
 * POLICY, THEREFORE A PLUGIN'S (6.3). `aggregateFields` and `aggregateEpisodeFields` are pure
 * functions of the rows handed to them, versioned with `plugin:aggregate`, executed at WRITE time
 * into `Cluster.card`, `Cluster.media`, `Cluster.episodes` and `Slot.episode`. No read chooses a
 * field value; a read is a lookup of what these wrote.
 *
 * WHAT THEY PROMISE. Same rows and merge order, same output, whatever order the rows arrived in. The
 * members are sorted once, by score descending and then by uri, weighed by the viewer's merge order
 * (`mergeWeights`), and every rule below reads that one order:
 * `aggregate.ts:379-381` records today's reduce as "non-deterministic between loads" because a tie
 * inside one score tier fell to arrival order, and that is the one behaviour change 6.3 asks for.
 *
 * TWO DIFFERENCES FROM `src/worker/store/aggregate.ts`, both named in 6.3:
 * - ties inside a score tier are broken by uri, never by arrival order,
 * - the SINGLETON PATH IS GONE (`aggregate.ts:308-317` returned the member's own uri, origin and url
 *   with no normalization). One rule for every cluster size, so a cluster of one is a cluster.
 *
 * WHY NOT THE GENERATED `Media`. 6.3 adds four fields the schema does not carry yet (`kind`,
 * `scope`, `provenance`, `anomalies`) and an `INCLUDES` value of `MediaHandleRelation`, so the
 * materialized row is deliberately typed here rather than as `src/generated/schema`'s `Media`. The
 * field NAMES are the schema's, so the read path of step 3 selects them unchanged.
 */
import { getRoutePath, Route } from '../../../router/path'
import { isRoutableUri } from '../../../utils/uri'
import { seasonNamesFirst } from '../../../sources/season'
import { DEFAULT_MERGE, mergeOrder } from '../../../sources/merge-order'
import { refinesDate } from '../../../utils/release-date'
import { mergeCredits } from './credits'
import { COERCING_ORIGINS } from './origins'

/** Where one field's value came from, and under which rule (6.3's third column). */
export type FieldProvenance = {
  field: string
  /** The member that supplied it, for a per-field rule. */
  uri?: string
  /** Every member that backed it, for a vote. */
  uris?: string[]
  /** `Media.fieldSeq[field]` of the supplying member: the exact answer behind the value. */
  answerSeq?: number | null
  /** The deciding score tier, for a vote. */
  tier?: number | null
  /** How many members backed the value, for a vote. */
  witnesses?: number
  rule: 'first-non-null' | 'day-in-partial' | 'tiered' | 'season-pair' | 'best-score' | 'concat' | 'dedupe' | 'first-supplier' | 'merged'
}

/**
 * One member of a cluster as the policy reads it.
 *
 * `raw` is the owner's field-merged row (2.1), which every typed column on `Media` is a projection
 * of, so it is the ONE place a field is read from and the two can never disagree here. A placeholder
 * has none and contributes no field, which is what "a placeholder cluster is never a card" means one
 * row at a time.
 */
export type MemberRow = {
  uri: string
  origin: string
  id: string
  owned: boolean
  score: number | null
  raw: Record<string, unknown>
  fieldSeq: Record<string, number>
}

/** One container or part the cluster reaches in ONE hop of `PART_OF` or `INCLUDES` (3.5). */
export type RelatedRow = {
  uri: string
  origin: string
  id: string
  /** The target's own url, or the best claimer's `node.url` when the target is a placeholder (6.3). */
  url: string | null
  relation: 'PART_OF' | 'INCLUDES'
  /** The link's reason, carried onto the handle so the modal can say why the badge is there. */
  via: string
  by: string
}

/** One narrative edge of `RELATED`, as 2.1 stored it. */
export type RelationRow = {
  fromUri: string
  toUri: string
  relation: string
  format: string | null
  claimer: string
  node: Record<string, unknown>
}

/** Everything about the cluster itself that a field rule reads. */
export type ClusterFacts = {
  id: string
  aggUri: string
  scope: 'RUN' | 'CONTAINER'
  runLength: number | null
  runLengthTier: number | null
  runLengthWitnesses: number
  runLengthFrom: string[]
  anomalies: { rule: string, detail: string }[]
}

/** One handle of the aggregated row: a member, a container, or a proven range (6.3). */
export type AggregatedHandle = {
  relation: 'SAME_AS' | 'PART_OF' | 'INCLUDES'
  /** Why this handle is here, so the trace panel can print it beside the badge (7.5). */
  via: string
  by: string
  node: Record<string, unknown>
}

/** The aggregated Media of 6.3: the schema's field names plus the four 6.3 adds. */
export type AggregatedMedia = Record<string, unknown> & {
  _id: string
  uri: string
  handles: AggregatedHandle[]
  provenance: FieldProvenance[]
}

/** The aggregated Episode of 6.4. */
export type AggregatedEpisode = Record<string, unknown> & {
  _id: string
  uri: string
  handles: { relation: 'SAME_AS', via: string, node: Record<string, unknown> }[]
  provenance: FieldProvenance[]
}

/**
 * One handle of a CARD: `MediaFragment`'s five node fields and nothing else (6.1).
 *
 * The aggregated row's handle node is the member's whole `raw`, which is the page payload's single
 * largest term. A listing document selects exactly these five, so the card carries exactly these
 * five; `via` and `by` are the detail view's and stay off the card.
 */
export type CardHandle = {
  relation: 'SAME_AS' | 'PART_OF' | 'INCLUDES'
  node: { _id: string, uri: string, origin: string, id: string, url: string | null }
}

/**
 * The listing's CLOSED field set (6.1).
 *
 * A listing document selecting a field outside this set is a schema change that adds it here, which
 * is what keeps a page read to one lookup: nothing about a card is computed at read time.
 *
 * It is the union of `MediaFragment` and the two listing documents' own selections, which is also
 * every field `applyMediaFilters`, `searchRelevance` and `applyMediaSorts` read. `handles` is on it
 * because `Media.handles` is `[MediaHandle!]!` and `MediaPage.nodes` is `[Media!]!`: a card without
 * it nulls the WHOLE PAGE rather than one field.
 */
export type ClusterCard = {
  _id: string
  uri: string
  origin: string
  id: string
  url: string | null
  handles: CardHandle[]
  score: number | null
  titles: unknown[]
  shortDescriptions: unknown[]
  covers: unknown[]
  banners: unknown[]
  trailers: unknown[]
  popularity: number | null
  averageScore: number | null
  episodeCount: number | null
  nextAiringEpisode: Record<string, unknown> | null
  type: string | null
  status: string | null
  season: string | null
  seasonYear: number | null
  genres: string[]
  tags: string[]
  categories: string[]
  startDate: string | null
  /** Every member uri, so a listing can map an inserted uri to the card without a second read. */
  members: string[]
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The one member order every rule below reads: score descending, ties by uri.
 *
 * An unscored row sorts last, which is where anizip's media row sits for scalars until its extractor
 * passes a score to `makeMedia` (`consensus.ts:38-40`, and 6.3's "at parity").
 */
export const byScoreThenUri = <T extends { score: number | null, uri: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || compare(a.uri, b.uri))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const scoreOf = (value: unknown): number => (isRecord(value) && typeof value.score === 'number' ? value.score : -1)

/** Sorted by score descending, and STABLE within a score, which is the member order it arrived in. */
const byScore = <T>(values: T[]): T[] => [...values].sort((a, b) => scoreOf(b) - scoreOf(a))

/** How the viewer's merge order weighs one origin's rows and values. */
type Weight = { place: number, scaled: (score: number) => number }

const AS_TUNED: Weight = { place: 0, scaled: score => score }

/**
 * THE VIEWER'S MERGE ORDER (Settings, src/sources/merge-order.ts). A built-in source moved to place `i` weighs as the
 * source the default order puts there: a row's, a value's or its credits' score is scaled by the default score at `i`
 * over the source's own, so the offsets inside one source keep their ratios (MyAnimeList's 0.4 romaji stays under its
 * 0.9 English title), and a score equal to the source's own becomes the one at `i` exactly, so a tie goes to the
 * earlier place. Against another source an offset is read at its own source's scale: AniList's 0.05 strip banner (at
 * most 0.056) stays under JustWatch's 0.1 backdrops (at least 0.1) wherever either sits, but moving a third source can
 * reorder two values, as Kitsu moved above Crunchyroll puts Crunchyroll's English title (0.5, now 0.3) under
 * MyAnimeList's romaji (0.4). An unscored row or value, and an origin the order does not name, keep their own. The
 * default order, or none, weighs every origin as tuned: today's merge byte for byte
 * (tests/unit/worker/graph/plugins/merge-order.test.ts).
 */
export const mergeWeights = (kept: readonly string[] = []): ((origin: string) => Weight) => {
  const order = mergeOrder(kept)
  if (order.every((origin, at) => origin === DEFAULT_MERGE[at]![0])) return () => AS_TUNED
  const own = new Map(DEFAULT_MERGE)
  const weights = new Map(order.map((origin, place): [string, Weight] => {
    const from = own.get(origin)!
    const to = DEFAULT_MERGE[place]![1]
    return [origin, { place, scaled: score => (score < 0 ? score : score === from ? to : score * (to / from)) }]
  }))
  const unnamed: Weight = { place: order.length, scaled: score => score }
  return origin => weights.get(origin) ?? unnamed
}

type Weigh = ReturnType<typeof mergeWeights>

/** The members by weighted score, then by place, then in the order they arrived in. */
const byWeight = <T extends { origin: string, score: number | null }>(rows: readonly T[], weigh: Weigh): T[] =>
  [...rows].sort((a, b) =>
    weigh(b.origin).scaled(b.score ?? -1) - weigh(a.origin).scaled(a.score ?? -1) || weigh(a.origin).place - weigh(b.origin).place)

/**
 * Every member's values of `field`, each carrying its weighted score, by that score, then by place, then in member
 * order. The home hero reads the leading title's score (src/utils/theater.ts `fromGoodSource`). A value the order
 * leaves at its own score is the member's own object, which scripts/offline-pick.ts finds its source by.
 */
const valuesOf = (members: readonly MemberRow[], field: string, weigh: Weigh): unknown[] =>
  members
    .flatMap(member => listOf(member.raw[field]).map(value => {
      const { place, scaled } = weigh(member.origin)
      return { value, place, score: scaled(scoreOf(value)) }
    }))
    .sort((a, b) => b.score - a.score || a.place - b.place)
    .map(({ value, score }) => (isRecord(value) && typeof value.score === 'number' && value.score !== score ? { ...value, score } : value))

/** ANIME if present plus exactly one of MOVIE / SERIES, first in score order (`aggregate.ts:8-15`). */
const reconcileCategories = (categories: string[]): string[] => {
  const out: string[] = []
  if (categories.includes('ANIME')) out.push('ANIME')
  const format = categories.find(category => category === 'MOVIE' || category === 'SERIES')
  if (format) out.push(format)
  return out
}

/**
 * Case-insensitive dedupe keeping the best-scored spelling (`aggregate.ts:55-65`).
 *
 * The labels arrive best-scored member first, so the spelling kept is that member's: AniList's
 * "Sci-Fi" survives and a lower-scored "sci-fi" folds into it.
 */
const dedupeLabels = (labels: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of labels) {
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/** Keep the first entry per value of `field` (`aggregate.ts:67-76`), over an already sorted list. */
const dedupeByField = (field: string, values: unknown[]): unknown[] => {
  const seen = new Set<unknown>()
  const out: unknown[] = []
  for (const value of values) {
    const key = isRecord(value) ? value[field] : value
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

const stringsOf = (value: unknown): string[] => listOf(value).filter((entry): entry is string => typeof entry === 'string')

// Simkl files every anime film under anime, so a film it files under movies outvotes JustWatch, which lists the
// live-action Gintama (2017) as Japanese animation (recorded 2026-10-15). Its tv filing is no such signal: Star
// Wars: Visions is under tv, and TVmaze and TMDB tag it anime (2026-10-16).
// It never outvotes an anime catalogue on the same card: that member lists only anime.
const nonAnimeFilm = (member: MemberRow): boolean => {
  const categories = stringsOf(member.raw.categories)
  return member.origin === 'simkl' && categories.includes('MOVIE') && !categories.includes('ANIME')
}

const ANIME_CATALOGUES = new Set(['anilist', 'mal', 'kitsu', 'anidb', 'offline'])

/** The parenthesized member list an `ag:(...)` address carries, and the address itself. */
export const aggregatedIdentity = (uris: readonly string[]): { uri: string, id: string } => {
  // one uri carrying a ',' or a '/' would split the list or the route path and make the whole watch
  // page unreachable, so an unroutable uri is kept out of the address (`aggregate.ts:296-304`)
  const routable = uris.filter(isRoutableUri)
  const sorted = [...(routable.length ? routable : uris)].sort()
  return { uri: `ag:(${sorted.join(',')})`, id: `(${sorted.join(',')})` }
}

/**
 * A node's `origin` and `id`, taken from the node where it carries them and from its uri where it
 * does not.
 *
 * `MediaRelationEdge.node` is `Media!` whose `origin` and `id` are `String!`, and `relations` is
 * `[MediaRelationEdge!]!`, so ONE relation node missing either nulls the whole media. The stored node
 * is the naming source's own nested byte (`ingest.ts`), and nothing on the write path forces those
 * two onto it: the ingest only proves the uri parses. So the address is re-derived here, where the
 * node is built, rather than defended at the read.
 */
const addressOf = (uri: string, node: Record<string, unknown>): { origin: string, id: string } => {
  const colon = uri.indexOf(':')
  const origin = typeof node.origin === 'string' && node.origin ? node.origin : uri.slice(0, Math.max(colon, 0))
  const id = typeof node.id === 'string' && node.id ? node.id : uri.slice(colon + 1)
  return { origin, id }
}

/** The member row as a handle node: its own uri is its `_id`, never the cluster's (6.3). */
const nodeOf = (member: MemberRow): Record<string, unknown> => ({
  ...member.raw,
  _id: member.uri,
  uri: member.uri,
  origin: member.origin,
  id: member.id,
  // a container reached through PART_OF contributes no claims of its own (4.2 step 6), and a node
  // drawn inside a handle carries none either: the badge reader needs the address and the url
  handles: [],
  episodes: [],
  credits: undefined,
  themes: undefined,
})

const SCALARS = [
  'url', 'type', 'status', 'averageScore', 'popularity', 'startDate', 'endDate', 'isAdult', 'nextAiringEpisode',
  'airingSchedule', 'duration', 'sourceMaterial',
] as const

/**
 * ONE HANDLE PER RELATION AND TARGET, which the narrative axis already does and this side did not.
 *
 * A `RelatedRow` is one LINK, and one hop of `PART_OF` reaches a container once per link rather than
 * once per target: two members of a cluster claiming the same show are two rows, and so are the
 * `asserted` link `plugin:direct` derives from a claim and the `span` link `plugin:containment`
 * derives from the same containment (the engine facts record both reaching one season). Both drew the
 * badge twice, measured 2026-09-12 on `ag:(anilist:108465)`, whose handle list carried
 * `PART_OF:jw:222366` twice.
 *
 * THE SURVIVOR IS CHOSEN BY SORT, never by arrival: the scan's row order inside a tie is not stable
 * between two passes in one process (the engine facts of step 2f), so picking the first row as it
 * arrives would rewrite the view on a pass that changed nothing. `by` then `via` orders it, which
 * keeps one plugin's reason for a badge stable while the other plugin's link comes and goes.
 */
const dedupeRelated = (related: readonly RelatedRow[]): RelatedRow[] => {
  const best = new Map<string, RelatedRow>()
  for (const entry of [...related].sort((a, b) =>
    a.relation.localeCompare(b.relation) || a.uri.localeCompare(b.uri)
    || a.by.localeCompare(b.by) || a.via.localeCompare(b.via))) {
    const key = `${entry.relation}\u0000${entry.uri}`
    if (!best.has(key)) best.set(key, entry)
  }
  return [...best.values()]
}

/**
 * The aggregated Media of 6.3, field by field, with the provenance of every choice.
 *
 * `members` need not be sorted: the order every rule reads is computed here, once.
 */
export const aggregateFields = (options: {
  cluster: ClusterFacts
  members: readonly MemberRow[]
  /** The containers and proven ranges of ONE hop (3.5), already resolved to their own rows. */
  related: readonly RelatedRow[]
  /** The narrative edges of `RELATED`, every member's. */
  relations: readonly RelationRow[]
  /** The app origin a media route is built against. Empty in a worker with no `location`. */
  locationOrigin: string
  /** The viewer's merge order as kept (src/sources/merge-order.ts). None is the default order. */
  order?: readonly string[]
}): AggregatedMedia => {
  const { cluster, locationOrigin } = options
  const members = byScoreThenUri(options.members)
  const weigh = mergeWeights(options.order)
  const owned = byWeight(members, weigh).filter(member => member.owned)
  const provenance: FieldProvenance[] = []
  const identity = aggregatedIdentity(members.map(member => member.uri))

  const row: AggregatedMedia = {
    _id: cluster.id,
    uri: cluster.aggUri,
    id: identity.id,
    origin: 'ag',
    url: `${locationOrigin}/${getRoutePath(Route.MEDIA, { uri: cluster.aggUri }).replace(/^\//, '')}`,
    scope: cluster.scope,
    // `FOLD` needs the `INCLUDES` edges and the RUN / CONTAINER exchange of `plugin:containment`, so
    // the third value of 6.3's `kind` is not minted here and the scope stands for it until it lands
    kind: cluster.scope,
    score: members.length ? Math.max(...members.map(member => member.score ?? 0)) : null,
    handles: [],
    episodes: [],
    provenance,
    anomalies: cluster.anomalies,
  }

  // the scalars: first non-null in score order, ties by uri (`aggregate.ts:328-337`), but a start or end
  // known only to its year or month gives way, in score order, to a month or day inside it from an
  // origin that does not coerce one
  for (const field of SCALARS) {
    const present = owned.filter(member => member.raw[field] !== null && member.raw[field] !== undefined)
    // kitsu's count is its user count, about 80 times smaller than the bundle's laid count for the same show
    // (measured on Fall 2026, 2026-10-17), so it only stands in when no other member has a count
    if (field === 'popularity') present.sort((a, b) => Number(a.origin === 'kitsu') - Number(b.origin === 'kitsu'))
    const first = present[0]
    const supplier = first && (field === 'startDate' || field === 'endDate')
      ? present.reduce((best, member) =>
        !COERCING_ORIGINS.has(member.origin) && refinesDate(best.raw[field] as string, member.raw[field] as string) ? member : best, first)
      : first
    row[field] = supplier ? supplier.raw[field] : null
    if (supplier) {
      provenance.push({ field, uri: supplier.uri, answerSeq: supplier.fieldSeq[field] ?? null, rule: supplier === first ? 'first-non-null' : 'day-in-partial' })
    }
  }
  // the route url is the cluster's own, never a member's: the address names every member, and a
  // member's url is reachable through its handle
  row.url = `${locationOrigin}/${getRoutePath(Route.MEDIA, { uri: cluster.aggUri }).replace(/^\//, '')}`

  // the length is a VOTE, not a pick (5.4 P5): `Cluster.runLength`, with its tier and its witnesses
  row.episodeCount = cluster.runLength
  provenance.push({
    field: 'episodeCount',
    uris: cluster.runLengthFrom,
    tier: cluster.runLengthTier,
    witnesses: cluster.runLengthWitnesses,
    rule: 'tiered',
  })

  // the season PAIR, from one member: `SUMMER` and `2026` only mean anything together
  // (`aggregate.ts:34-53`)
  const named = owned.find(member => typeof member.raw.season === 'string' && member.raw.season)
  const yearOnly = owned.find(member => member.raw.seasonYear !== null && member.raw.seasonYear !== undefined)
  row.season = named ? named.raw.season : null
  row.seasonYear = (named ? named.raw.seasonYear : yearOnly?.raw.seasonYear) ?? null
  if (named || yearOnly) provenance.push({ field: 'season', uri: (named ?? yearOnly)!.uri, rule: 'season-pair' })

  const categories = owned.flatMap(member => stringsOf(member.raw.categories))
  const liveAction = owned.some(nonAnimeFilm) && !owned.some(member => ANIME_CATALOGUES.has(member.origin))
  row.categories = reconcileCategories(liveAction ? categories.filter(category => category !== 'ANIME') : categories)
  if (owned.length) provenance.push({ field: 'categories', uri: owned[0]!.uri, rule: 'first-non-null' })

  for (const field of ['genres', 'tags', 'studios'] as const) {
    row[field] = dedupeLabels(owned.flatMap(member => stringsOf(member.raw[field])))
    for (const member of owned) {
      if (stringsOf(member.raw[field]).length) provenance.push({ field, uri: member.uri, rule: 'best-score' })
    }
  }

  row.titles = dedupeByField('title', seasonNamesFirst(valuesOf(owned, 'titles', weigh) as { title?: string }[]))
  for (const member of owned) {
    if (listOf(member.raw.titles).length) {
      provenance.push({ field: 'titles', uri: member.uri, answerSeq: member.fieldSeq.titles ?? null, rule: 'concat' })
    }
  }

  // sorted by score and NOT deduped: two catalogues describing the same work in two languages are two
  // descriptions, and two covers are two covers
  for (const field of ['descriptions', 'shortDescriptions', 'covers', 'banners'] as const) {
    row[field] = valuesOf(owned, field, weigh)
    for (const member of owned) {
      if (listOf(member.raw[field]).length) {
        provenance.push({ field, uri: member.uri, answerSeq: member.fieldSeq[field] ?? null, rule: 'concat' })
      }
    }
  }

  row.trailers = dedupeByField('uri', valuesOf(owned, 'trailers', weigh))

  const credits = mergeCredits(owned, (member, score) => weigh(member.origin).scaled(score))
  if (credits) {
    Object.assign(row, credits)
    const uris = owned.filter(member => member.raw.credits).map(member => member.uri)
    provenance.push({ field: 'characters', uris, rule: 'merged' }, { field: 'staff', uris, rule: 'merged' })
  }

  // the first supplier's WHOLE graph, never spliced: a franchise is one source's account of a series
  // and two of them spliced carry edges between nodes only one of them has (`aggregate.ts:348-350`)
  const franchiseFrom = owned.find(member => member.raw.franchise !== null && member.raw.franchise !== undefined)
  row.franchise = franchiseFrom ? franchiseFrom.raw.franchise : null
  if (franchiseFrom) provenance.push({ field: 'franchise', uri: franchiseFrom.uri, rule: 'first-supplier' })

  const themesFrom = owned.find(member => Array.isArray(member.raw.themes) && member.raw.themes.length)
  if (themesFrom) {
    row.themes = themesFrom.raw.themes
    provenance.push({ field: 'themes', uri: themesFrom.uri, rule: 'first-supplier' })
  }

  const seasonsFrom = owned.find(member => listOf(member.raw.seasons).length)
  if (seasonsFrom) {
    row.seasons = seasonsFrom.raw.seasons
    provenance.push({ field: 'seasons', uri: seasonsFrom.uri, rule: 'first-supplier' })
  }

  row.ratings = dedupeByField('source', owned.flatMap(member => listOf(member.raw.ratings)))
  for (const member of owned) {
    if (listOf(member.raw.ratings).length) provenance.push({ field: 'ratings', uri: member.uri, rule: 'dedupe' })
  }

  // the narrative axis: deduped on the pair, and every edge pointing back inside the cluster dropped,
  // because a media drawn as its own alternative navigates to the page it is on (`aggregate.ts:243-247`)
  const inside = new Set(members.map(member => member.uri))
  const seenRelation = new Set<string>()
  row.relations = options.relations
    .filter(edge => {
      if (inside.has(edge.toUri)) return false
      const key = `${edge.relation}\u0000${edge.toUri}`
      if (seenRelation.has(key)) return false
      seenRelation.add(key)
      return true
    })
    .map(edge => ({
      relation: edge.relation,
      format: edge.format,
      claimer: edge.claimer,
      // the empty lists come FIRST, so a node that carries its own keeps them: `Media.titles` and
      // `Media.covers` are `[X!]!`, and a naming source that omits either nulls the whole media the
      // same way a missing `origin` does
      node: { titles: [], covers: [], ...edge.node, _id: edge.toUri, uri: edge.toUri, ...addressOf(edge.toUri, edge.node) },
    }))

  row.handles = [
    ...members.map((member): AggregatedHandle => ({
      relation: 'SAME_AS',
      via: member.owned ? 'member' : 'placeholder',
      by: 'plugin:aggregate',
      node: nodeOf(member),
    })),
    ...dedupeRelated(options.related).map((entry): AggregatedHandle => ({
      relation: entry.relation,
      via: entry.via,
      by: entry.by,
      node: { _id: entry.uri, uri: entry.uri, origin: entry.origin, id: entry.id, url: entry.url, handles: [], episodes: [] },
    })),
  ]

  return row
}

/** The listing's card (6.1), read off the aggregated row so the two can never disagree. */
export const cardOf = (media: AggregatedMedia, members: readonly string[]): ClusterCard => ({
  _id: media._id,
  uri: media.uri,
  origin: String(media.origin ?? 'ag'),
  id: String(media.id ?? ''),
  url: (media.url as string | null) ?? null,
  handles: media.handles.map((handle): CardHandle => ({
    relation: handle.relation,
    node: {
      _id: String(handle.node._id ?? handle.node.uri ?? ''),
      uri: String(handle.node.uri ?? ''),
      origin: String(handle.node.origin ?? ''),
      id: String(handle.node.id ?? ''),
      url: (handle.node.url as string | null) ?? null,
    },
  })),
  score: (media.score as number | null) ?? null,
  titles: listOf(media.titles),
  shortDescriptions: listOf(media.shortDescriptions),
  covers: listOf(media.covers),
  banners: listOf(media.banners),
  trailers: listOf(media.trailers),
  averageScore: (media.averageScore as number | null) ?? null,
  nextAiringEpisode: (media.nextAiringEpisode as Record<string, unknown> | null) ?? null,
  popularity: (media.popularity as number | null) ?? null,
  episodeCount: (media.episodeCount as number | null) ?? null,
  type: (media.type as string | null) ?? null,
  status: (media.status as string | null) ?? null,
  season: (media.season as string | null) ?? null,
  seasonYear: (media.seasonYear as number | null) ?? null,
  genres: stringsOf(media.genres),
  tags: stringsOf(media.tags),
  categories: stringsOf(media.categories),
  startDate: (media.startDate as string | null) ?? null,
  members: [...members].sort(),
})

/** One episode row filling a slot, as the policy reads it. */
export type EpisodeMemberRow = {
  uri: string
  origin: string
  id: string
  score: number | null
  raw: Record<string, unknown>
  fieldSeq: Record<string, number>
  /** How this row reached the slot: `member` or `aligned` (5.4 P5). */
  via: string
}

const EPISODE_SCALARS = [
  'url', 'embedUrl', 'releaseDate', 'seasonNumber', 'absoluteEpisodeNumber', 'runtime',
] as const

/**
 * The aggregated Episode of 6.4: `aggregate.ts:412-450` with the three corrections that section names.
 *
 * - `_id` is the SLOT's id and `episodeNumber` is the SLOT's number, which is the run's own numbering
 *   (1 to 12 for a split cour, never 13 to 24, because showing 13 to 24 leaves 1 to 12 rendering as
 *   empty rows),
 * - `mediaUri` is the CLUSTER's address, where `aggregate.ts:439` set it to the aggregated episode's
 *   own uri and lost the link back,
 * - a one-row slot takes the same shape as any other, where `aggregate.ts:401-409` returned the
 *   member's raw uri for a cluster of one.
 */
export const aggregateEpisodeFields = (options: {
  slot: { id: string, number: number | null }
  clusterUri: string
  rows: readonly EpisodeMemberRow[]
}): AggregatedEpisode => {
  const rows = byScoreThenUri(options.rows)
  const provenance: FieldProvenance[] = []
  const identity = aggregatedIdentity(rows.map(row => row.uri))

  const episode: AggregatedEpisode = {
    _id: options.slot.id,
    uri: identity.uri,
    id: identity.id,
    origin: 'ag',
    mediaUri: options.clusterUri,
    episodeNumber: options.slot.number,
    score: rows.length ? Math.max(...rows.map(row => row.score ?? 0)) : null,
    handles: rows.map(row => ({
      relation: 'SAME_AS' as const,
      via: row.via,
      node: { ...row.raw, _id: row.uri, uri: row.uri, origin: row.origin, id: row.id, handles: [] },
    })),
    provenance,
  }

  for (const field of EPISODE_SCALARS) {
    const supplier = rows.find(row => row.raw[field] !== null && row.raw[field] !== undefined)
    episode[field] = supplier ? supplier.raw[field] : null
    if (supplier) {
      provenance.push({ field, uri: supplier.uri, answerSeq: supplier.fieldSeq[field] ?? null, rule: 'first-non-null' })
    }
  }

  episode.titles = dedupeByField('title', byScore(rows.flatMap(row => listOf(row.raw.titles))))
  for (const field of ['descriptions', 'shortDescriptions', 'thumbnails'] as const) {
    episode[field] = byScore(rows.flatMap(row => listOf(row.raw[field])))
  }
  for (const row of rows) {
    provenance.push({ field: 'titles', uri: row.uri, answerSeq: row.fieldSeq.titles ?? null, rule: 'concat' })
  }

  return episode
}
