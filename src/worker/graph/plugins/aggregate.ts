/**
 * `plugin:aggregate`, P5 of 5.4: the materialized view. Membership, the cluster ids, the run length,
 * the slots and every JSON a read looks up.
 *
 * IT IS THE ONLY PLACE A CLUSTER EXISTS. Sameness closes over active `SAME_AS` links and nothing else
 * (3.5), the closure is computed here once per pass by a union-find over the edge list, and what it
 * comes to is written as `MEMBER_OF` so no read ever recurses (6.8 ms per uri against 1.7 ms for a
 * materialized lookup, 2026-09-11). Every row with an effective scope sits in exactly one cluster,
 * singletons and placeholders included, which is what makes the listing read uniform and the
 * singleton branch of `aggregate.ts:308-317` unnecessary.
 *
 * WHAT IT PROMISES.
 * - Same graph, same output: every list read is ordered, every group is keyed on a uri, and the ids
 *   are carried from the previous output rather than minted per pass. A second pass over an unmoved
 *   graph writes nothing, which is the contract the writer enforces and this file has to keep.
 * - An id is minted ONCE per component and carried across growth (`carryComponentId`'s rule,
 *   `graph.ts:246-263`, executed in a pass instead of during a read): on a merge the larger keeps its
 *   id, ties to the lexicographically smaller `key`, and the loser becomes an `Alias` row; on a split
 *   the id stays with the fragment holding the previous `key`.
 * - `Cluster.published` only ever GROWS, so `ag:(...)` never shrinks and an address the app already
 *   handed out keeps resolving.
 *
 * WHAT IT REFUSES TO DO. It proposes no link and reads no title: membership is whatever the links
 * already say. A row it cannot scope has no cluster, which is the same silence `plugin:direct` keeps
 * for an unknown scope (5.2 guard 1).
 *
 * THE 2C HOOK, and where the 2D rules sit:
 * - `scope.full` every pass. 5.4 P5 splits the declaration in two (membership global, the slots and
 *   the JSON per dirty cluster); the dirty set is `delta`, which arrives with the scheduler.
 * - `Cluster.hidden`, `hiddenBy`, `kind` and `preferredRun` are columns of THIS plugin's row, because
 *   the writer diffs a table per plugin and a second writer would be a second row for one primary key
 *   (5.2). The RULES are `plugin:containment`'s and are imported from it (6.1, 6.5, 5.4 P2), computed
 *   over the same active containment edges that plugin turns into `ATTACHED_TO`, so the two cannot
 *   disagree about an attachment and the verdict needs no round trip and no second iteration.
 * - `via: 'aligned'` fills are the pairs `plugin:range` proved (5.4 P4), and they are the ONLY way a
 *   row that is not a member's own reaches a slot: at the pair's `toNumber`, inside `1..runLength`,
 *   onto a slot a member already fills. A member row a pair renumbered is `aligned` too, because
 *   `via` says where the NUMBER came from (3.2), which for those rows is the pair and not the row.
 */
import type { Anomaly } from './anomalies'
import type { ClusterFacts } from './containment'
import type { EpisodeMemberRow, RelatedRow, RelationRow } from './fields'
import type { Plugin, PluginContext, PluginOutput, PluginRow } from './contract'

import { isRoutableUri } from '../../../utils/uri'
import { tieredConsensus } from '../../store/consensus'
import { readAnomalies } from './anomalies'
import { attachmentsOf, listingIndexOf, listingVerdict, preferredRunOf } from './containment'
import { aggregateEpisodeFields, aggregateFields, byScoreThenUri, cardOf } from './fields'
import { readComponents } from './guards'

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const AGGREGATE_VERSION = 1

/** The id every minted cluster carries, so an id is readable as one at a glance in a trace. */
const ID_PREFIX = 'cl:'

/**
 * `plugin:range`'s id, written out rather than imported.
 *
 * A pair that places a NON-member row has to be one a rule proved (5.4 P4, P5), so the aligned scan
 * names its author; importing the plugin for its id would pull the whole rule module, its scorers and
 * its constants into the view for one string.
 */
const RANGE = 'plugin:range'

type Subject = {
  uri: string
  origin: string
  id: string
  owned: boolean
  score: number | null
  raw: Record<string, unknown>
  fieldSeq: Record<string, number>
  scope: 'RUN' | 'CONTAINER'
  countKind: string
  countStated: number | null
  countDistinct: number | null
  /** The UTC day of a day-precise start, which is what `preferredRun` orders by (5.4 P2). */
  startDay: number | null
}

type EpisodeRow = {
  mediaUri: string
  uri: string
  origin: string
  id: string
  number: number | null
  seasonNumber: number | null
  numberSpace: string
  score: number | null
  raw: Record<string, unknown>
  fieldSeq: Record<string, number>
  hasEpisodeKey: string
}

type ContainmentRow = {
  fromUri: string
  toUri: string
  kind: 'PART_OF' | 'INCLUDES'
  reason: string
  by: string
  /** The `LINK.key`, which is what an `ATTACHED_TO` row carries as its `supports` (5.4 P2). */
  key: string
}

const asText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null

const parseRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || value === undefined) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const numbersOf = (value: unknown): Record<string, number> => {
  const record = parseRecord(value)
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    const number = asNumber(entry)
    if (number !== null) out[key] = number
  }
  return out
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(compare)

// ---------------------------------------------------------------------------------------------
// What the pass reads.

const readSubjects = async (ctx: PluginContext): Promise<Subject[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (p:MediaProfile)-[:PROFILE_OF]->(m:Media)
     RETURN m.uri AS uri, m.origin AS origin, m.id AS id, m.owned AS owned, m.score AS score,
       m.raw AS raw, m.fieldSeq AS fieldSeq, p.scope AS scope, p.countKind AS countKind,
       p.countStated AS countStated, p.countDistinct AS countDistinct, p.startDay AS startDay
     ORDER BY uri`
  )
  const subjects: Subject[] = []
  for (const row of rows) {
    const scope = asText(row.scope)
    // a row with no effective scope has no cluster: the same silence guard 1 keeps for a claim whose
    // endpoint nobody has described yet (5.2, `db.ts:113-123`)
    if (scope !== 'RUN' && scope !== 'CONTAINER') continue
    subjects.push({
      uri: String(row.uri),
      origin: String(row.origin ?? ''),
      id: String(row.id ?? ''),
      owned: row.owned === true,
      score: asNumber(row.score),
      raw: parseRecord(row.raw),
      fieldSeq: numbersOf(row.fieldSeq),
      scope,
      countKind: asText(row.countKind) ?? 'none',
      countStated: asNumber(row.countStated),
      countDistinct: asNumber(row.countDistinct),
      startDay: asNumber(row.startDay),
    })
  }
  return subjects
}

const readContainment = async (ctx: PluginContext): Promise<ContainmentRow[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'active' AND l.kind IN ['PART_OF', 'INCLUDES']
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.reason AS reason, l.by AS by,
       l.key AS linkKey
     ORDER BY fromUri, toUri, kind`
  )
  return rows.map(row => ({
    fromUri: String(row.fromUri),
    toUri: String(row.toUri),
    kind: String(row.kind) === 'INCLUDES' ? 'INCLUDES' : 'PART_OF',
    reason: asText(row.reason) ?? '',
    by: asText(row.by) ?? '',
    key: asText(row.linkKey) ?? '',
  }))
}

/** One episode row of either scan, with its own numbering and the key it hangs by. */
const episodeRowOf = (row: Record<string, unknown>): EpisodeRow => {
  const raw = parseRecord(row.raw)
  return {
    mediaUri: String(row.mediaUri),
    uri: String(row.uri),
    origin: String(row.origin ?? ''),
    id: String(row.id ?? ''),
    number: asNumber(row.episodeNumber),
    seasonNumber: asNumber(row.seasonNumber),
    numberSpace: asText(row.numberSpace) ?? 'season',
    score: asNumber(raw.score),
    raw,
    fieldSeq: numbersOf(row.fieldSeq),
    hasEpisodeKey: String(row.hasEpisodeKey ?? ''),
  }
}

/**
 * The member episodes of 5.4 P5: `HAS_EPISODE` targets whose claimer is the member's OWN origin.
 *
 * The claimer test is the fence. An episode reaches the graph attached to whichever media published
 * it, so a season that contains this run hangs its whole list on a member's uri (4.4); those rows are
 * not this cluster's members and may only reach a slot through a proven pair (`via: 'aligned'`).
 */
const readEpisodes = async (ctx: PluginContext): Promise<EpisodeRow[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode)
     WHERE h.claimer = m.origin
     MATCH (p:EpisodeProfile)-[:PROFILE_OF]->(e)
     RETURN m.uri AS mediaUri, e.uri AS uri, e.origin AS origin, e.id AS id,
       e.episodeNumber AS episodeNumber, e.seasonNumber AS seasonNumber, e.raw AS raw,
       e.fieldSeq AS fieldSeq, p.numberSpace AS numberSpace, h.key AS hasEpisodeKey
     ORDER BY mediaUri, uri`
  )
  return rows.map(episodeRowOf)
}

/** One active pair as the view reads it: which row, onto which row, at which number, by which key. */
type EpisodeLinkRow = { fromUri: string, toUri: string, toNumber: number | null, key: string }

const readEpisodeLinks = async (ctx: PluginContext): Promise<EpisodeLinkRow[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     WHERE l.status = 'active'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.toNumber AS toNumber, l.key AS linkKey
     ORDER BY fromUri, toUri`
  )
  return rows.map(row => ({
    fromUri: String(row.fromUri),
    toUri: String(row.toUri),
    toNumber: asNumber(row.toNumber),
    key: asText(row.linkKey) ?? '',
  }))
}

/** A row a proven pair may place: the episode, the row it was paired onto, and the two keys it names. */
type AlignedRow = { row: EpisodeRow, toUri: string, toNumber: number | null, linkKey: string }

/**
 * Every `HAS_EPISODE` row whose episode is the FROM side of an active `plugin:range` pair (5.4 P5).
 *
 * These are the rows `readEpisodes` fences out and the ONLY ones that can come back: a season's own
 * episode, and an episode a foreign claimer hung on a member (the transitional lend of 4.4). The
 * claimer is not tested here, because it is not what admits the row: the pair is, and a row hung on a
 * member by the member's own origin is already in `own` and never reaches a slot twice.
 */
const readAlignedRows = async (ctx: PluginContext): Promise<AlignedRow[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     WHERE l.status = 'active' AND l.by = $by
     MATCH (m:Media)-[h:HAS_EPISODE]->(a)
     MATCH (p:EpisodeProfile)-[:PROFILE_OF]->(a)
     RETURN m.uri AS mediaUri, a.uri AS uri, a.origin AS origin, a.id AS id,
       a.episodeNumber AS episodeNumber, a.seasonNumber AS seasonNumber, a.raw AS raw,
       a.fieldSeq AS fieldSeq, p.numberSpace AS numberSpace, h.key AS hasEpisodeKey,
       b.uri AS toUri, l.toNumber AS toNumber, l.key AS linkKey
     ORDER BY uri, toUri, mediaUri`,
    { by: RANGE }
  )
  return rows.map(row => ({
    row: episodeRowOf(row),
    toUri: String(row.toUri),
    toNumber: asNumber(row.toNumber),
    linkKey: asText(row.linkKey) ?? '',
  }))
}

const readRelations = async (ctx: PluginContext): Promise<RelationRow[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Media)-[r:RELATED]->(b:Media)
     RETURN a.uri AS fromUri, b.uri AS toUri, r.relation AS relation, r.format AS format,
       r.claimer AS claimer, r.node AS node
     ORDER BY fromUri, toUri, relation`
  )
  return rows.map(row => ({
    fromUri: String(row.fromUri),
    toUri: String(row.toUri),
    relation: asText(row.relation) ?? 'UNKNOWN',
    format: asText(row.format),
    claimer: asText(row.claimer) ?? '',
    node: parseRecord(row.node),
  }))
}

/**
 * The url a PLACEHOLDER's badge renders from: the best-scored claimer's `node.url` (6.3).
 *
 * A row nobody answered about has no `raw` of its own, whether it is a container kept for its badge
 * (`cr:G24H1N3MP` reached only through `ATTACHED_TO`) or a member whose own source has not answered.
 * The claim carries the claimer's own description of it, which is where the url is.
 */
const readClaimedUrls = async (ctx: PluginContext, uris: string[]): Promise<Map<string, string>> => {
  const urls = new Map<string, string>()
  // an empty `UNWIND` list dies at runtime on this engine (2026-09-12), so an empty list asks nothing
  if (!uris.length) return urls
  const rows = await ctx.query<Record<string, unknown>>(
    `UNWIND $uris AS u
     MATCH (a:Media)-[c:CLAIMS]->(b:Media {uri: u})
     RETURN u AS uri, a.uri AS claimant, a.score AS score, c.node AS node
     ORDER BY uri, claimant`,
    { uris }
  )
  const best = new Map<string, number>()
  for (const row of rows) {
    const uri = String(row.uri)
    const url = asText(parseRecord(row.node).url)
    if (!url) continue
    const score = asNumber(row.score) ?? -1
    if (urls.has(uri) && (best.get(uri) ?? -1) >= score) continue
    urls.set(uri, url)
    best.set(uri, score)
  }
  return urls
}

// ---------------------------------------------------------------------------------------------
// The ids, carried.

type PreviousCluster = { id: string, key: string, published: string[], aliases: string[] }

type PreviousState = {
  clusters: Map<string, PreviousCluster>
  /** uri -> the cluster id it was in at the end of the previous pass. */
  memberOf: Map<string, string>
  /** Every retired id, so one that was already an alias is never minted again. */
  aliases: Set<string>
}

const emptyPrevious = (): PreviousState => ({ clusters: new Map(), memberOf: new Map(), aliases: new Set() })

/**
 * What this plugin wrote last time, which is what the ids are carried from.
 *
 * `ctx.previous` is the writer's own index of the last output and is authoritative while a worker
 * runs. The graph read beside it is what makes an id survive a pass state that was forgotten (a fresh
 * `runPlugins` in a test, a re-enable, 5.3): the rows are the same rows, since the writer had just
 * written them, so the two can only agree.
 */
const previousStateOf = async (ctx: PluginContext): Promise<PreviousState> => {
  const state = emptyPrevious()
  const clusters = ctx.previous.nodes.Cluster
  const members = ctx.previous.edges.MEMBER_OF
  if (clusters?.size) {
    for (const row of clusters.values()) {
      state.clusters.set(String(row.id), {
        id: String(row.id),
        key: String(row.key ?? ''),
        published: (row.published as string[] | undefined) ?? [],
        aliases: (row.aliases as string[] | undefined) ?? [],
      })
      for (const alias of (row.aliases as string[] | undefined) ?? []) state.aliases.add(alias)
    }
    for (const row of members?.values() ?? []) state.memberOf.set(String(row.from), String(row.to))
    return state
  }

  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (c:Cluster) WHERE c.by = $by
     RETURN c.id AS id, c.key AS key, c.published AS published, c.aliases AS aliases ORDER BY id`,
    { by: ctx.id }
  )
  for (const row of rows) {
    const id = String(row.id)
    // an empty STRING[] reads back as NULL on this engine, so both lists are normalized here
    const published = Array.isArray(row.published) ? row.published.map(String) : []
    const aliases = Array.isArray(row.aliases) ? row.aliases.map(String) : []
    state.clusters.set(id, { id, key: String(row.key ?? ''), published, aliases })
    for (const alias of aliases) state.aliases.add(alias)
  }
  const memberRows = await ctx.query<Record<string, unknown>>(
    `MATCH (m:Media)-[e:MEMBER_OF]->(c:Cluster) WHERE e.by = $by
     RETURN m.uri AS uri, c.id AS id ORDER BY uri`,
    { by: ctx.id }
  )
  for (const row of memberRows) state.memberOf.set(String(row.uri), String(row.id))
  const aliasRows = await ctx.query<Record<string, unknown>>(
    'MATCH (a:Alias) WHERE a.by = $by RETURN a.id AS id ORDER BY id',
    { by: ctx.id }
  )
  for (const row of aliasRows) state.aliases.add(String(row.id))
  return state
}

/** One component as the carry sees it: its members and which previous ids they came from. */
type Component = { key: string, members: string[] }

/**
 * Which previous id each component keeps, and which ids are retired into it.
 *
 * THE TWO RULES OF 5.4 P5, and they have to be decided together rather than per component:
 * - a MERGE gives the id to the larger contribution, ties to the lexicographically smaller previous
 *   `key` (`carryComponentId`, `graph.ts:246-263`, which used SIZE and then the smaller root so that
 *   the surviving id never followed the union-find's own rank),
 * - a SPLIT keeps the id on the fragment holding the previous `key`, and the other fragment is new.
 *
 * So an old id is first CLAIMED by exactly one component (the one holding its previous key, else the
 * one holding most of its previous members), and only then does each component choose among the ids
 * that claimed it.
 */
export const carryIds = (components: Component[], previous: PreviousState): Map<string, { id: string, retired: string[] }> => {
  const byKey = new Map<string, number>()
  components.forEach((component, index) => {
    for (const member of component.members) byKey.set(member, index)
  })

  // which component may claim each previous id
  const claims = new Map<number, string[]>()
  for (const [id, cluster] of [...previous.clusters].sort(([a], [b]) => compare(a, b))) {
    const held = new Map<number, number>()
    for (const [uri, clusterId] of previous.memberOf) {
      if (clusterId !== id) continue
      const index = byKey.get(uri)
      if (index === undefined) continue
      held.set(index, (held.get(index) ?? 0) + 1)
    }
    if (!held.size) continue
    const withKey = byKey.get(cluster.key)
    // the fragment holding the previous key keeps the id; with that row gone, the largest fragment
    // does, and the lowest component key breaks a tie so the answer does not depend on array order
    const target = withKey !== undefined && previous.memberOf.get(cluster.key) === id
      ? withKey
      : [...held].sort((a, b) => b[1] - a[1] || compare(components[a[0]]!.key, components[b[0]]!.key))[0]![0]
    claims.set(target, [...claims.get(target) ?? [], id])
  }

  const carried = new Map<string, { id: string, retired: string[] }>()
  const minted = new Set<string>()
  components.forEach((component, index) => {
    const candidates = claims.get(index) ?? []
    if (!candidates.length) {
      carried.set(component.key, { id: mintId(component.key, previous, minted), retired: [] })
      return
    }
    const size = (id: string): number =>
      component.members.filter(uri => previous.memberOf.get(uri) === id).length
    const survivor = [...candidates].sort((a, b) =>
      size(b) - size(a)
      || compare(previous.clusters.get(a)?.key ?? a, previous.clusters.get(b)?.key ?? b))[0]!
    carried.set(component.key, { id: survivor, retired: candidates.filter(id => id !== survivor).sort(compare) })
  })
  return carried
}

/**
 * A new component's id: `cl:` and the key it was minted on, which is a uri and therefore unique
 * among live clusters.
 *
 * Deterministic rather than a `crypto.randomUUID()` (`graph.ts:239`), because an id that changes
 * between two runs over one graph cannot be compared, and the app caches on it. The suffix is the one
 * case a key is not enough: a component whose key was the minting key of a cluster that has since
 * been retired into another id would otherwise take an id an `Alias` row still resolves.
 */
const mintId = (key: string, previous: PreviousState, minted: Set<string>): string => {
  const base = `${ID_PREFIX}${key}`
  let candidate = base
  for (let attempt = 2; previous.clusters.has(candidate) || previous.aliases.has(candidate) || minted.has(candidate); attempt += 1) {
    candidate = `${base}#${attempt}`
  }
  minted.add(candidate)
  return candidate
}

// ---------------------------------------------------------------------------------------------
// The run length.

/** What the members agreed the run is long, with the tier and the witnesses behind it (5.4 P5). */
export type RunLength = { length: number, tier: number, witnesses: number, from: string[] }

/**
 * Tiered consensus over the member profiles, with the provenance CLASSES read first.
 *
 * A `declared` count beats any number of `listLength` counts, and `countKind: 'none'` contributes
 * nothing: half the counts in this tree are `episodes.length` rather than a claim about the world, so
 * a catalogue that could only reach part of a run publishes a short count as confidently as one that
 * knows the whole run. Within the deciding class the rule is `tieredConsensus` verbatim
 * (`consensus.ts:12-30`): the best score present decides the tier, the value most of that tier claims
 * wins, ties go to the larger value, and nothing below the tier is consulted.
 *
 * `witnesses` is today's `backing` (`consensus.ts:171`): every member whose own count equals the
 * chosen value AT ANY TIER, which is the number the trimming bar of 5.4 P5 reads. On
 * `anilist(0.8)=13 anizip(null)=12 kitsu(0.3)=22 mal(0.9)=12` the declared class is mal 12, anilist
 * 13 and anizip 12, kitsu's 22 is a list length and is never consulted, the top tier is mal alone, so
 * the length is 12 and its witnesses are mal and anizip.
 */
export const runLengthOf = (
  // the four columns the vote reads, rather than a whole `Subject`: a caller holding the count and
  // the score can ask, and a column added for another rule cannot change what the length is
  members: readonly Pick<Subject, 'uri' | 'score' | 'countKind' | 'countStated'>[]
): RunLength | null => {
  const stated = members.filter(member => member.countKind !== 'none' && member.countStated !== null)
  const declared = stated.filter(member => member.countKind === 'declared')
  const pool = declared.length ? declared : stated.filter(member => member.countKind === 'listLength')
  if (!pool.length) return null
  const agreed = tieredConsensus(pool.map(member => ({ value: member.countStated, score: member.score })))
  if (!agreed) return null
  const witnesses = stated.filter(member => member.countStated === agreed.value)
  return {
    length: agreed.value,
    tier: agreed.tier,
    witnesses: witnesses.length,
    from: sortedUnique(witnesses.map(member => member.uri)),
  }
}

// ---------------------------------------------------------------------------------------------
// The trim.

/**
 * Whether one member row is kept out of the cluster's slots (5.4 P5, "Trimming").
 *
 * A member that packages this run inside a longer season is describing a different thing, and the
 * only reason to believe that rather than believe its own count is that better sources disagree with
 * it. So three bars stand between a row and being hidden, and all three are the record's:
 *
 * - TWO WITNESSES (`consensus.ts:171`). A length resting on one row, acted on, hides episodes that
 *   aired: MAL publishes no count for Mushoku Tensei season 2 part 1 and AniList says 13 for a run
 *   that aired 12 (2026-09-09).
 * - A STRICTLY LOWER TIER (`consensus.ts:210-211`). A source that agrees about the length
 *   (`reference`) and a source at or above the deciding tier (`equals`) are never trimmed: two 0.9
 *   catalogues disagreeing is a disagreement, and the answer to one is to show the tier's majority,
 *   never to delete the dissenter's episodes.
 * - TWICE THE WEIGHT. The backing's summed score must be at least twice the trimmed claim's, which is
 *   the margin `anilist(0.8)=13` against `mal(0.9)=12` demands: trimming on 0.1 would hide a
 *   thirteenth episode AniList may be right about, while Crunchyroll's fold at 0.5 against mal 0.9
 *   plus kitsu 0.3 clears it and stays trimmed however many streaming catalogues echo it.
 *
 * The window is 1 to `length` rather than a ceiling: a season that CONTAINS this run brings episodes
 * on both sides of it, and a ceiling alone would leave the ones below on the page numbered 0 and -1.
 */
export const trimsRow = (options: {
  run: RunLength
  /** The origins that agree about the length, which are never trimmed. */
  reference: Set<string>
  /** The origins at or above the deciding tier, which are never trimmed. */
  equals: Set<string>
  /** The summed score of the members backing the length. */
  backingWeight: number
  member: { origin: string, score: number | null }
  number: number | null
}): boolean => {
  const { run, member, number } = options
  // a row the sources never numbered is not beyond anything: a special is listed last, never hidden
  if (number === null) return false
  if (number >= 1 && number <= run.length) return false
  if (run.witnesses < 2) return false
  if (options.reference.has(member.origin) || options.equals.has(member.origin)) return false
  return options.backingWeight >= 2 * (member.score ?? 0)
}

// ---------------------------------------------------------------------------------------------
// The slots.

/** A union-find over uris whose root is always the LOWEST member, so a group key is stable. */
const grouping = () => {
  const parent = new Map<string, string>()
  const find = (uri: string): string => {
    let root = uri
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!
    let walk = uri
    while (parent.get(walk) && parent.get(walk) !== walk) {
      const next = parent.get(walk)!
      parent.set(walk, root)
      walk = next
    }
    return root
  }
  return {
    add: (uri: string) => { if (!parent.has(uri)) parent.set(uri, uri) },
    find,
    union: (a: string, b: string) => {
      parent.set(a, parent.get(a) ?? a)
      parent.set(b, parent.get(b) ?? b)
      const rootA = find(a)
      const rootB = find(b)
      if (rootA === rootB) return
      if (rootA < rootB) parent.set(rootB, rootA)
      else parent.set(rootA, rootB)
    },
    keys: () => [...parent.keys()].sort(compare),
  }
}

const isPositiveWhole = (value: number | null): value is number => value !== null && Number.isInteger(value) && value >= 1

/** One row filling a slot: how it got there, at what number, and the keys that prove it (3.2). */
type Filled = { row: EpisodeRow, number: number | null, via: 'member' | 'aligned', supports: string[] }

/** One slot as this pass computed it, with the rows that fill it. */
type BuiltSlot = {
  id: string
  number: number | null
  rows: Filled[]
}

/** The numbering a proven pair gives one row for one cluster, and the pair that gave it. */
type Renumbering = { number: number, key: string }

/**
 * The slots of one cluster: its member episodes grouped by `EPISODE_LINK` component and then by
 * positive whole number, inside this one cluster (5.4 P5).
 *
 * `mergeByEpisodeNumber` is "safe ONLY because its input is one run" (`db.ts:465-468`), and that is
 * exactly the fence here: the input is the cluster's own member episodes and nothing else, so two
 * metadata catalogues describing one run produce ONE list while paramount's flat multi-season list
 * cannot reach a slot at all.
 *
 * An unnumbered row (anizip's `S1`) gets a slot of its own keyed on its lowest uri with `number`
 * NULL, listed last, so a special never collides with episode 1.
 */
const slotsOf = (options: {
  clusterId: string
  episodes: EpisodeRow[]
  /** The numbering a proven pair gives a row for THIS cluster, when one exists (`FILLS.number`). */
  renumber: Map<string, Renumbering>
  links: { fromUri: string, toUri: string }[]
}): BuiltSlot[] => {
  const { clusterId, episodes } = options
  const inCluster = new Set(episodes.map(episode => episode.uri))
  const groups = grouping()
  for (const episode of episodes) groups.add(episode.uri)
  // grouped by EPISODE_LINK component first: a pair says two rows are one broadcast episode whatever
  // the two numbers are, which is what a renumbering looks like from here
  for (const link of options.links) {
    if (inCluster.has(link.fromUri) && inCluster.has(link.toUri)) groups.union(link.fromUri, link.toUri)
  }
  const numberOf = (episode: EpisodeRow): number | null => options.renumber.get(episode.uri)?.number ?? episode.number
  const byNumber = new Map<number, string>()
  for (const episode of episodes) {
    const number = numberOf(episode)
    if (!isPositiveWhole(number)) continue
    const first = byNumber.get(number)
    if (first) groups.union(first, episode.uri)
    else byNumber.set(number, episode.uri)
  }

  const members = new Map<string, EpisodeRow[]>()
  for (const episode of [...episodes].sort((a, b) => compare(a.uri, b.uri))) {
    const root = groups.find(episode.uri)
    members.set(root, [...members.get(root) ?? [], episode])
  }

  const slots: BuiltSlot[] = []
  for (const [root, rows] of [...members].sort(([a], [b]) => compare(a, b))) {
    const numbers = rows.map(numberOf).filter(isPositiveWhole)
    // with no pair in the graph every row of a group already carries one number, so the choice only
    // decides which of two numberings a proven renumbering publishes: the run's own, the lowest
    const number = numbers.length ? Math.min(...numbers) : null
    slots.push({
      id: number === null ? `${clusterId}#s:${root}` : `${clusterId}#${number}`,
      number,
      rows: rows.map(row => {
        // `via` says where the NUMBER came from (3.2): a member row a pair renumbered is `aligned`
        // and names that pair beside its own hang, which is 8.2's Crunchyroll 13 to 20 onto 1 to 8
        const pair = options.renumber.get(row.uri)
        return {
          row,
          number: numberOf(row),
          via: pair ? 'aligned' as const : 'member' as const,
          supports: [row.hasEpisodeKey, ...pair ? [pair.key] : []].filter(Boolean),
        }
      }),
    })
  }
  return slots.sort((a, b) =>
    (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0)
    || (a.number ?? 0) - (b.number ?? 0)
    || compare(a.id, b.id))
}

/** One fill a proven pair placed: which row, which slot, and the number the pair gave it. */
export type AlignedFill = { uri: string, slotId: string, number: number, supports: string[] }

/**
 * The `via: 'aligned'` fills of one cluster (5.4 P5): every row a proven pair places on a slot.
 *
 * A NON-MEMBER ROW REACHES A SLOT HERE AND NOWHERE ELSE, and three bars stand in front of it, each
 * of them the difference between a play button and a wrong play button:
 *
 * - THE PAIR. Only an active `EPISODE_LINK` a rule wrote, never a number: "no positional loan
 *   exists" (5.4 P5), because the loan was placed BY NUMBER onto a row that might not exist while a
 *   pair is placed by shared evidence onto a row the run's own sources already list.
 * - THE WINDOW `1..runLength`. A season that contains this run brings episodes on both sides of it
 *   (`consensus.ts:185-191`), and a member row beyond the length that escaped the trim would
 *   otherwise let a neighbouring cour's row in behind it.
 * - A SLOT A MEMBER ALREADY FILLS, at the pair's own `toNumber`. So a lent season can never ADD a
 *   row, and a pair whose target was trimmed out places nothing, since the row it would have joined
 *   is not on the page either.
 *
 * A row of the cluster's own members is refused here whatever a pair says about it: it fills by the
 * member rule, and admitting it twice would draw it twice.
 */
export const alignedFillsOf = (options: {
  slots: readonly { id: string, number: number | null, filled: readonly string[] }[]
  /** The cluster's agreed length, or NULL when its members state none: then only the slots bound it. */
  runLength: number | null
  /** The member episodes of this cluster, which fill by their own numbering (`via: 'member'`). */
  own: ReadonlySet<string>
  pairs: readonly { uri: string, toUri: string, toNumber: number | null, supports: string[] }[]
}): AlignedFill[] => {
  const byNumber = new Map<number, { id: string, filled: readonly string[] }>()
  for (const slot of options.slots) {
    if (slot.number !== null && !byNumber.has(slot.number)) byNumber.set(slot.number, slot)
  }

  const fills: AlignedFill[] = []
  const placed = new Set<string>()
  for (const pair of [...options.pairs].sort((a, b) => compare(a.uri, b.uri) || compare(a.toUri, b.toUri))) {
    const number = pair.toNumber
    if (!isPositiveWhole(number)) continue
    if (options.own.has(pair.uri)) continue
    if (options.runLength !== null && number > options.runLength) continue
    const slot = byNumber.get(number)
    if (!slot || !slot.filled.includes(pair.toUri)) continue
    const key = `${pair.uri} ${slot.id}`
    if (placed.has(key)) continue
    placed.add(key)
    fills.push({ uri: pair.uri, slotId: slot.id, number, supports: pair.supports })
  }
  return fills
}

/**
 * Whether a CONTAINER cluster may mint slots from its own members (5.4 P5's one exception).
 *
 * A container cluster gets no slots, because paramount, trakt and tvdb flatten every season onto one
 * id and `mergeByEpisodeNumber` would then draw the longest season's rows for every season. The
 * exception is the live-action show page, which "lost every episode and offer" once before
 * (`db.ts:319-323`, 2026-09-05): a container with no run attached anywhere whose own member episodes
 * carry exactly one distinct non-null `seasonNumber` between them, and none without one, is kept at
 * what the extractors already promise, since each of those five sources attaches its list only when
 * the episodes are all one season (2026-09-04, 877e07f, 843528e).
 */
export const containerMayMintSlots = (episodes: readonly { seasonNumber: number | null }[]): boolean => {
  if (!episodes.length) return false
  if (episodes.some(episode => episode.seasonNumber === null)) return false
  return new Set(episodes.map(episode => episode.seasonNumber)).size === 1
}

// ---------------------------------------------------------------------------------------------

/**
 * `plugin:aggregate`, P5 of 5.4.
 *
 * Consumes `Media`, `MediaProfile`, `LINK`, `EPISODE_LINK`, `HAS_EPISODE`, `Episode`,
 * `EpisodeProfile`, `CLAIMS` and `RELATED`; produces `Cluster`, `Alias`, `MEMBER_OF`, `Slot`,
 * `SLOT_OF` and `FILLS`; `after: [plugin:direct]`, because a cluster is whatever the links say and
 * the links are written by the plugins before it.
 */
export const aggregatePlugin: Plugin = {
  id: 'plugin:aggregate',
  consumes: {
    nodes: ['Media', 'Episode', 'MediaProfile', 'EpisodeProfile'],
    // `ATTACHED_TO` is consumed so the scheduler re-runs this plugin when an attachment moves (5.4
    // P5): a season row's hide verdict changes when its container gains or loses a run
    edges: ['LINK', 'EPISODE_LINK', 'HAS_EPISODE', 'CLAIMS', 'RELATED', 'ATTACHED_TO'],
    kinds: ['SAME_AS', 'PART_OF', 'INCLUDES'],
  },
  produces: { nodes: ['Cluster', 'Alias', 'Slot'], edges: ['MEMBER_OF', 'SLOT_OF', 'FILLS'] },
  after: ['plugin:direct'],
  version: AGGREGATE_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    const locationOrigin = typeof globalThis.location === 'undefined' ? '' : globalThis.location.origin
    const [subjects, containment, episodeRows, episodeLinks, alignedRows, relations, components, previous] = await Promise.all([
      readSubjects(ctx),
      readContainment(ctx),
      readEpisodes(ctx),
      readEpisodeLinks(ctx),
      readAlignedRows(ctx),
      readRelations(ctx),
      // ONE closure for the whole store, shared with the guards so the two can never disagree about
      // what a component is (3.5). The harness asserts it equals a breadth-first search over the same
      // edge list for every uri, which is the check 5.4 P5 asks for.
      readComponents(ctx.query),
      previousStateOf(ctx),
    ])

    const byUri = new Map(subjects.map(subject => [subject.uri, subject]))

    // MEMBERSHIP: every scoped row, grouped by its component key, singletons included
    const grouped = new Map<string, Subject[]>()
    for (const subject of subjects) {
      const key = components.keyOf(subject.uri)
      grouped.set(key, [...grouped.get(key) ?? [], subject])
    }
    const componentList: Component[] = [...grouped]
      .map(([key, members]) => ({ key, members: members.map(member => member.uri).sort(compare) }))
      .sort((a, b) => compare(a.key, b.key))
    const carried = carryIds(componentList, previous)

    // THE CLUSTER FACTS the listing rules of 6.1 and 6.5 read, built before the row loop because every
    // one of them is about a cluster's RELATION to other clusters: which runs hold this season, which
    // runs a container is attached from. The attachments are computed here rather than read back from
    // `ATTACHED_TO`, over the same active `PART_OF` list `plugin:containment` turns into that table
    // (5.4 P2), so the verdict costs no round trip, needs no second iteration and cannot drift from
    // the edges the read path walks.
    const clusterFacts = new Map<string, ClusterFacts>()
    const memberCluster = new Map<string, string>()
    const runLengths = new Map<string, RunLength | null>()
    for (const component of componentList) {
      const members = component.members.map(uri => byUri.get(uri)!)
      const id = carried.get(component.key)!.id
      const run = runLengthOf(members)
      runLengths.set(component.key, run)
      const days = members.map(member => member.startDay).filter((day): day is number => day !== null)
      clusterFacts.set(id, {
        id,
        scope: members.every(member => member.scope === 'CONTAINER') ? 'CONTAINER' : 'RUN',
        key: component.key,
        members: [...component.members],
        owned: members.some(member => member.owned),
        startDay: days.length ? Math.min(...days) : null,
        runLength: run?.length ?? null,
      })
      for (const uri of component.members) memberCluster.set(uri, id)
    }
    const clusterOf = (uri: string): string | undefined => memberCluster.get(uri)
    const attachments = attachmentsOf({ links: containment, clusterOf, clusters: clusterFacts })
    const listing = listingIndexOf({ clusters: clusterFacts, clusterOf, links: containment, attachments })

    const anomalies = await readAnomalies(ctx.query)
    const anomaliesByUri = new Map<string, Anomaly[]>()
    for (const anomaly of anomalies) {
      for (const uri of anomaly.uris) anomaliesByUri.set(uri, [...anomaliesByUri.get(uri) ?? [], anomaly])
    }

    // every placeholder a badge is drawn for, a member or a container reached in ONE hop
    const placeholderUris = new Set(subjects.filter(subject => !subject.owned).map(subject => subject.uri))
    for (const link of containment) {
      if (!byUri.get(link.toUri)?.owned) placeholderUris.add(link.toUri)
    }
    const claimedUrls = await readClaimedUrls(ctx, [...placeholderUris].sort(compare))

    const episodesByMedia = new Map<string, EpisodeRow[]>()
    for (const episode of episodeRows) {
      episodesByMedia.set(episode.mediaUri, [...episodesByMedia.get(episode.mediaUri) ?? [], episode])
    }
    const renumberOnto = new Map<string, { toUri: string, number: number, key: string }>()
    for (const link of episodeLinks) {
      if (link.toNumber !== null) renumberOnto.set(link.fromUri, { toUri: link.toUri, number: link.toNumber, key: link.key })
    }
    // the pairs indexed by the row they point AT, so a cluster asks only about the rows it already
    // fills rather than scanning every pair in the store per cluster
    const alignedByTarget = new Map<string, AlignedRow[]>()
    for (const aligned of alignedRows) {
      alignedByTarget.set(aligned.toUri, [...alignedByTarget.get(aligned.toUri) ?? [], aligned])
    }

    const clusterRows: PluginRow[] = []
    const aliasRows: PluginRow[] = []
    const memberRows: PluginRow[] = []
    const slotRows: PluginRow[] = []
    const slotOfRows: PluginRow[] = []
    const fillsRows: PluginRow[] = []

    for (const component of componentList) {
      const members = byScoreThenUri(component.members.map(uri => byUri.get(uri)!))
      const entry = carried.get(component.key)!
      const id = entry.id
      const facts = clusterFacts.get(id)!
      const scope = facts.scope
      const previousCluster = previous.clusters.get(id)

      // APPEND ONLY, so `ag:(...)` never shrinks and a departed member keeps resolving (6.2)
      const published = sortedUnique([
        ...previousCluster?.published ?? [],
        ...entry.retired.flatMap(retired => previous.clusters.get(retired)?.published ?? []),
        ...members.map(member => member.uri).filter(isRoutableUri),
      ])
      const aliases = sortedUnique([
        ...previousCluster?.aliases ?? [],
        ...entry.retired,
        ...entry.retired.flatMap(retired => previous.clusters.get(retired)?.aliases ?? []),
      ])
      const aggUri = `ag:(${published.join(',')})`
      const run = runLengths.get(component.key) ?? null
      const length = {
        runLength: run?.length ?? null,
        runLengthTier: run?.tier ?? null,
        runLengthWitnesses: run?.witnesses ?? 0,
        runLengthFrom: run?.from ?? [],
      }

      // THE LISTING RULES OF 6.1 AND 6.5, whose columns are this row's and whose rules are P2's. A
      // REQUESTED URI IS NEVER HIDDEN and that is the read path's job (6.2): this flag is the
      // store-wide truth about a LISTING, and the resolve answers with the cluster holding the asked
      // row whatever it says, so the column never depends on who is looking.
      const verdict = listingVerdict(facts, listing)
      const preferredRun = scope === 'CONTAINER'
        ? preferredRunOf({ container: id, attachments, clusters: clusterFacts })
        : null

      // THE SLOTS. The member episodes of this cluster, trimmed, grouped, and materialized.
      const own = members.flatMap(member => episodesByMedia.get(member.uri) ?? [])
      // the one exception of 5.4 P5, complete now that `preferredRun` exists: a container with a run
      // attached anywhere FOLLOWS to it (6.2) and mints none, and only a container with no run at all
      // keeps the live-action show page that "lost every episode and offer" once (`db.ts:319-323`)
      const fenced = scope === 'RUN' || (preferredRun === null && containerMayMintSlots(own))
      const reference = new Set(run ? members.filter(member => member.countStated === run.length).map(member => member.origin) : [])
      const equals = new Set(run ? members.filter(member => (member.score ?? 0) >= run.tier).map(member => member.origin) : [])
      const backingWeight = run
        ? members.filter(member => member.countStated === run.length).reduce((total, member) => total + (member.score ?? 0), 0)
        : 0
      const renumber = new Map<string, Renumbering>()
      for (const episode of own) {
        const onto = renumberOnto.get(episode.uri)
        // a renumbering counts only onto a REFERENCE member's row: the source that agrees about the
        // length is the one to measure another source's numbering against (`consensus.ts:247-251`)
        if (onto && own.some(other => other.uri === onto.toUri && reference.has(other.origin))) {
          renumber.set(episode.uri, { number: onto.number, key: onto.key })
        }
      }

      // THE TWO BARS EVERY FILL MEETS, member and aligned alike (5.4 P5): the source's own list may
      // not contradict itself, and the row has to sit inside the window the cluster's length sets
      const admits = (episode: EpisodeRow, number: number | null): boolean => {
        const member = byUri.get(episode.mediaUri)
        // a list the source itself duplicated numbers every later position wrong, and no exchange
        // rate defends a button the source's own list contradicts (netflixid 80198505 season 3,
        // 14 rows over 10 epids, 2026-09-10). The rows stay; the count disagreement is an anomaly
        if (member && episode.numberSpace === 'position'
          && member.countDistinct !== null && member.countStated !== null
          && member.countDistinct !== member.countStated) return false
        if (!run) return true
        return !trimsRow({
          run,
          reference,
          equals,
          backingWeight,
          member: { origin: member?.origin ?? episode.origin, score: member?.score ?? episode.score },
          number,
        })
      }

      const fillable = fenced
        ? own.filter(episode => byUri.has(episode.mediaUri)
          && admits(episode, renumber.get(episode.uri)?.number ?? episode.number))
        : []

      const slots = slotsOf({ clusterId: id, episodes: fillable, renumber, links: episodeLinks })

      // THE ALIGNED FILLS (5.4 P5, 8.1's play buttons): the rows a proven pair places on a slot a
      // member already fills. `own` is the fence they are the one exception to, so a member's own
      // row is never offered here even when a pair also names it.
      const ownUris = new Set(own.map(episode => episode.uri))
      const candidates = fillable
        .flatMap(episode => alignedByTarget.get(episode.uri) ?? [])
        .filter(aligned => !ownUris.has(aligned.row.uri) && admits(aligned.row, aligned.toNumber))
      const alignedRowsByUri = new Map(candidates.map(aligned => [aligned.row.uri, aligned.row]))
      const fills = alignedFillsOf({
        slots: slots.map(slot => ({ id: slot.id, number: slot.number, filled: slot.rows.map(filled => filled.row.uri) })),
        runLength: run?.length ?? null,
        own: ownUris,
        pairs: candidates.map(aligned => ({
          uri: aligned.row.uri,
          toUri: aligned.toUri,
          toNumber: aligned.toNumber,
          // their hang and the pair, which is what a trace descends from a button by (3.2)
          supports: [aligned.row.hasEpisodeKey, aligned.linkKey].filter(Boolean),
        })),
      })
      const slotsById = new Map(slots.map(slot => [slot.id, slot]))
      for (const fill of fills) {
        slotsById.get(fill.slotId)?.rows.push({
          row: alignedRowsByUri.get(fill.uri)!,
          number: fill.number,
          via: 'aligned',
          supports: fill.supports,
        })
      }

      const episodeJson: unknown[] = []
      for (const slot of slots) {
        const rows: EpisodeMemberRow[] = slot.rows.map(filled => ({
          uri: filled.row.uri,
          origin: filled.row.origin,
          id: filled.row.id,
          score: filled.row.score,
          raw: filled.row.raw,
          fieldSeq: filled.row.fieldSeq,
          via: filled.via,
        }))
        const episode = aggregateEpisodeFields({ slot: { id: slot.id, number: slot.number }, clusterUri: aggUri, rows })
        episodeJson.push(episode)
        slotRows.push({ id: slot.id, clusterId: id, number: slot.number, episode })
        slotOfRows.push({ from: slot.id, to: id })
        for (const filled of slot.rows) {
          fillsRows.push({
            from: filled.row.uri,
            to: slot.id,
            via: filled.via,
            number: filled.number,
            supports: filled.supports,
          })
        }
      }

      // THE VIEW. One row per cluster, written by the policy of 6.3 and 6.4 and read by a lookup.
      const inside = new Set(component.members)
      const related: RelatedRow[] = containment
        .filter(link => inside.has(link.fromUri) && !inside.has(link.toUri))
        .map(link => {
          const target = byUri.get(link.toUri)
          return {
            uri: link.toUri,
            origin: target?.origin ?? link.toUri.slice(0, link.toUri.indexOf(':')),
            id: target?.id ?? link.toUri.slice(link.toUri.indexOf(':') + 1),
            url: (target?.owned ? asText(target.raw.url) : null) ?? claimedUrls.get(link.toUri) ?? null,
            relation: link.kind,
            via: link.reason,
            by: link.by,
          }
        })
      const clusterAnomalies = sortedUnique(
        component.members.flatMap(uri => (anomaliesByUri.get(uri) ?? []).map(anomaly => `${anomaly.rule}\u0000${anomaly.detail}`))
      ).map(entry => ({ rule: entry.slice(0, entry.indexOf('\u0000')), detail: entry.slice(entry.indexOf('\u0000') + 1) }))

      const media = aggregateFields({
        cluster: {
          id,
          aggUri,
          scope,
          ...length,
          anomalies: clusterAnomalies,
        },
        members: members.map(member => member.owned ? member : { ...member, raw: { url: claimedUrls.get(member.uri) ?? null } }),
        related,
        relations: relations.filter(edge => inside.has(edge.fromUri)),
        locationOrigin,
      })
      const owns = members.some(member => member.owned)

      clusterRows.push({
        id,
        scope,
        key: component.key,
        published,
        aggUri,
        aliases,
        hidden: verdict.hidden,
        hiddenBy: verdict.hiddenBy,
        kind: verdict.kind,
        ...length,
        preferredRun,
        card: owns ? cardOf(media, component.members) : null,
        media,
        episodes: episodeJson,
        anomalies: clusterAnomalies,
        anomalyCount: clusterAnomalies.length,
      })
      for (const alias of aliases) aliasRows.push({ id: alias, clusterId: id })
      for (const member of members) {
        memberRows.push({ from: member.uri, to: id, via: members.length > 1 ? 'same-as' : 'self' })
      }
    }

    return {
      // THE 2C HOOK. 5.4 P5 declares membership `scope.full` and the slots and JSON per dirty
      // cluster; with no `delta` there is no dirty set, so one full scope carries both halves.
      scope: { full: true },
      nodes: [
        { table: 'Cluster', rows: clusterRows },
        { table: 'Alias', rows: aliasRows },
        { table: 'Slot', rows: slotRows },
      ],
      edges: [
        { table: 'MEMBER_OF', rows: memberRows },
        { table: 'SLOT_OF', rows: slotOfRows },
        { table: 'FILLS', rows: fillsRows },
      ],
      links: [],
      episodeLinks: [],
    }
  },
}
