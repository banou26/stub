/**
 * `plugin:containment`, P2 of 5.4: the RUN versus CONTAINER exchange, as edges between CLUSTERS.
 *
 * It attaches and it never mints sameness. That is the whole fence: "a catalogue that folds two cours
 * into one season premieres on the SAME DAY as the first of them, so neither axis can see the fold"
 * (`similar.ts:143-146`), so a season that covers a run's start is drawn as a container and never
 * merged into it. A wrong attachment costs a badge; a wrong weld costs the user the wrong episode.
 *
 * WHAT IT PRODUCES.
 * - `ATTACHED_TO(run cluster, container cluster, via, supports)` for every active `PART_OF` out of a
 *   member, expanded to the TARGET'S OWN CLUSTER, which is the one hop of 3.5 materialized once per
 *   pass instead of walked per read.
 * - `LINK PART_OF` reason `span`: a folding origin's season whose own episode days cover a run's
 *   start and which is longer than the run. Exactly one season may qualify per run; two is a refusal,
 *   written as a refused row so it can be queried, and zero is silence.
 * - `LINK PART_OF` reason `inside`: the repair of the invariant of 3.5, below.
 *
 * WHAT IT DOES NOT WRITE, AND WHY. `Cluster.preferredRun`, `Cluster.hidden`, `Cluster.hiddenBy` and
 * `Cluster.kind` are columns of a row `plugin:aggregate` owns, and the writer diffs a table per plugin
 * (`WHERE by = $id`, 5.2), so a second plugin writing `Cluster` would be a second row for one primary
 * key rather than a column. The RULES are here, exported as pure functions, and `plugin:aggregate`
 * calls them over the same active `PART_OF` list this plugin turns into `ATTACHED_TO`, so the verdict
 * costs no round trip, needs no second iteration and cannot drift from the edges the read walks.
 *
 * A REQUESTED URI IS NEVER HIDDEN, and that is the read path's job rather than this one's (6.1, 6.2).
 * `Cluster.hidden` is the store-wide truth about whether a cluster belongs in a LISTING; the resolve
 * of 6.2 answers with the cluster holding the asked row whatever the flag says. Writing the flag per
 * request would make the column depend on who is looking.
 *
 * DELTAS ARE NOT BUILT YET (step 2c's hook, still open): `ctx.delta.full` is true on every call, so
 * every scan below runs over the WHOLE graph and the output declares `scope.full`. The delta forms
 * are the same queries with `UNWIND $clusters AS cid` in front, which is how 5.4 P2 states them.
 */
import type { LinkProposal, Plugin, PluginContext, PluginOutput, PluginRow } from './contract'

import { DOWNGRADE_REASONS } from './guards'
import { PER_RUN_ORIGINS, precedenceClassOf } from './sameness'

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const CONTAINMENT_VERSION = 1

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(compare)

const asText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null

const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))

// ---------------------------------------------------------------------------------------------
// The shapes the rules read. Every one of them is what a query returned, never a handle.

/** One cluster as this plugin and `plugin:aggregate` both see it. */
export type ClusterFacts = {
  id: string
  scope: 'RUN' | 'CONTAINER'
  /** The lowest member uri, which is the tie-break `preferredRun` falls to (5.4 P2). */
  key: string
  members: string[]
  /** Whether any member's own origin answered about it: an unowned cluster is never a card (6.1). */
  owned: boolean
  /** The earliest day-precise start among its members, or NULL when no member carries one. */
  startDay: number | null
  runLength: number | null
}

/** One active containment edge, as the scans read it back. */
export type ContainmentLink = {
  fromUri: string
  toUri: string
  kind: 'PART_OF' | 'INCLUDES'
  reason: string
  key: string
}

/** One `ATTACHED_TO` edge: which run cluster hangs off which container, and on what evidence. */
export type Attachment = { from: string, to: string, via: string, supports: string[] }

/** One active `SAME_AS` edge as the invariant repair weighs it (5.2 precedence, 3.5's rule). */
export type SameAsFacts = {
  fromUri: string
  toUri: string
  key: string
  /** The precedence class of 5.2, reconstructed from the row's own evidence. */
  className: string
  /** The highest `CLAIMS.seq` among the row's supports: "the later seq" of the tie-break. */
  seq: number
}

// ---------------------------------------------------------------------------------------------
// `via`, and the one it is never allowed to be.

/**
 * The order a `via` is chosen in when several `PART_OF` links back one attachment.
 *
 * `via` is what the page prints beside the badge (6.5: "ATTACHED_TO via cross-scope / asserted",
 * "via containing"), so it has to be the most specific statement about the attachment rather than
 * whichever link the array happened to hold first. The downgrade reasons keep 5.2's own table order,
 * and anything unlisted sorts last by name so a new reason is still deterministic.
 */
export const VIA_PRECEDENCE = [
  'containing', 'span', 'asserted', 'prefix',
  'cross-scope', 'count-mismatch', 'no-length', 'kind-mismatch', 'disagreeing-ids', 'contested',
  'inside',
]

const viaRank = (reason: string): number => {
  const index = VIA_PRECEDENCE.indexOf(reason)
  return index < 0 ? VIA_PRECEDENCE.length : index
}

/**
 * The `via` one attachment carries: `show-show` for a container pointing at another container, `part`
 * for a catalogue season that is a piece of a longer run, else the best reason among its links.
 *
 * `show-show` is "never rendered as a run link" (`db.ts:300-301`): a show that names another show says
 * nothing about which RUN a page should follow to, so `preferredRun` refuses it below and a reader
 * that draws the runs of a container filters it out. `part` is the other direction of 5.4 P2: a
 * shorter season downgraded onto a FINISHED run is listed as a link and never as episodes.
 */
export const viaOf = (options: {
  fromScope: 'RUN' | 'CONTAINER'
  toScope: 'RUN' | 'CONTAINER'
  reasons: readonly string[]
}): string => {
  if (options.toScope === 'RUN') return 'part'
  if (options.fromScope === 'CONTAINER') return 'show-show'
  const [best] = [...options.reasons].sort((a, b) => viaRank(a) - viaRank(b) || compare(a, b))
  return best ?? 'asserted'
}

/**
 * The attachments of the whole store: one row per (run cluster, container cluster) pair.
 *
 * ANCHORED ON AN EXISTING EDGE, never a cartesian product (5.4 P2): the input is the active `PART_OF`
 * list, and the cluster of each endpoint is a lookup. A link whose two endpoints landed in ONE cluster
 * attaches nothing, because a cluster is not attached to itself; that pair is the invariant of 3.5 and
 * is repaired below rather than drawn.
 */
export const attachmentsOf = (options: {
  links: readonly ContainmentLink[]
  clusterOf: (uri: string) => string | undefined
  clusters: Map<string, ClusterFacts>
}): Attachment[] => {
  const grouped = new Map<string, { from: string, to: string, reasons: string[], supports: string[] }>()
  for (const link of options.links) {
    if (link.kind !== 'PART_OF') continue
    const from = options.clusterOf(link.fromUri)
    const to = options.clusterOf(link.toUri)
    if (!from || !to || from === to) continue
    const key = `${from} ${to}`
    const entry = grouped.get(key) ?? { from, to, reasons: [], supports: [] }
    entry.reasons.push(link.reason)
    entry.supports.push(link.key)
    grouped.set(key, entry)
  }
  return [...grouped.values()]
    .map(entry => ({
      from: entry.from,
      to: entry.to,
      via: viaOf({
        fromScope: options.clusters.get(entry.from)?.scope ?? 'RUN',
        toScope: options.clusters.get(entry.to)?.scope ?? 'CONTAINER',
        reasons: entry.reasons,
      }),
      supports: sortedUnique(entry.supports),
    }))
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to))
}

/**
 * A container cluster's `preferredRun`: the attached run with the earliest parseable start day, ties
 * by cluster key (`preferAttachedRun`, `db.ts:319-323,338`).
 *
 * "A show page with no episode and no offer is what splitting the spaces cost", so a container that
 * has a run follows to it (6.2) and mints no slots of its own (5.4 P5). A cluster with no parseable
 * day sorts after every cluster that has one rather than being dropped: a show whose only run carries
 * no date still has somewhere to follow to.
 */
export const preferredRunOf = (options: {
  container: string
  attachments: readonly Attachment[]
  clusters: Map<string, ClusterFacts>
}): string | null => {
  const runs = options.attachments
    .filter(attachment => attachment.to === options.container && attachment.via !== 'show-show')
    .map(attachment => options.clusters.get(attachment.from))
    .filter((cluster): cluster is ClusterFacts => Boolean(cluster) && cluster!.scope === 'RUN')
  if (!runs.length) return null
  const [earliest] = [...runs].sort((a, b) =>
    (a.startDay ?? Number.MAX_SAFE_INTEGER) - (b.startDay ?? Number.MAX_SAFE_INTEGER)
    || compare(a.key, b.key))
  return earliest!.id
}

// ---------------------------------------------------------------------------------------------
// The span scan: which catalogue season HOLDS this run.

/** One season a run's start day falls inside, with the numbers the evidence records. */
export type SpanCandidate = {
  runCluster: string
  runUri: string
  seasonUri: string
  first: number
  last: number
  startDay: number
  theirCount: number
  runLength: number
}

/** What the exactly-one rule came to for one run cluster. */
export type SpanVerdict =
  | { ok: true, candidates: SpanCandidate[] }
  | { ok: false, reason: 'ambiguous', candidates: SpanCandidate[] }

/**
 * The exactly-one rule of 5.4 P2 and 4.4: one season may hold a run, two is a refusal, zero is silence.
 *
 * `lendContainingSeason`'s rule as a verdict (`crunchyroll/extractor.ts:402`): the season whose own
 * episode days cover the run's start AND which is longer than the run. Two seasons covering one start
 * day means the catalogue's seasons overlap, which no reading of them can resolve, and picking either
 * would put a container badge and a hidden season card on a guess. Candidates are grouped by SEASON
 * URI first, so two members of one run naming the same season is one candidate rather than two.
 */
export const spanVerdict = (candidates: readonly SpanCandidate[]): SpanVerdict => {
  const seasons = sortedUnique(candidates.map(candidate => candidate.seasonUri))
  const ordered = [...candidates].sort((a, b) => compare(a.runUri, b.runUri) || compare(a.seasonUri, b.seasonUri))
  if (seasons.length > 1) return { ok: false, reason: 'ambiguous', candidates: ordered }
  return { ok: true, candidates: ordered }
}

// ---------------------------------------------------------------------------------------------
// The listing hide rule of 6.1, and the cluster kind of 6.5.

/** What the hide rule and the kind read, indexed once for the whole store. */
export type ListingIndex = {
  clusters: Map<string, ClusterFacts>
  clusterOf: (uri: string) => string | undefined
  /** uri -> the RUN cluster ids holding it as a `PART_OF` target (6.1, clause 1). */
  partTarget: Map<string, string[]>
  /** uri -> the RUN cluster ids it is an `INCLUDES` source onto (6.1, clause 2). */
  includesSource: Map<string, string[]>
  /** uri -> the RUN cluster ids reaching it through an attached container (6.1, clause 3). */
  throughContainer: Map<string, string[]>
  /** container cluster id -> the RUN cluster ids `ATTACHED_TO` it, which is clause 1 expanded. */
  containerRuns: Map<string, string[]>
  /** uri -> the claimants of a row whose every active link is a `contested` downgrade (6.1, 5.2). */
  onlyContested: Map<string, string[]>
}

/** The verdict for one cluster: whether a listing draws it, what it hides behind, and what it is. */
export type ListingVerdict = {
  hidden: boolean
  hiddenBy: string[]
  kind: 'RUN' | 'CONTAINER' | 'FOLD'
}

/**
 * Build the index the hide rule reads, in one walk of the containment and attachment edges.
 *
 * A run cluster is never allowed to hide a cluster BEHIND ITSELF, which is the one clause 6.1's prose
 * leaves to the reader: `anilist:600` is a `PART_OF` source into a container its own cluster is the
 * only run of, and a cluster that hid behind itself would take its own card off the listing.
 */
export const listingIndexOf = (options: {
  clusters: Map<string, ClusterFacts>
  clusterOf: (uri: string) => string | undefined
  links: readonly ContainmentLink[]
  attachments: readonly Attachment[]
}): ListingIndex => {
  const { clusters, clusterOf } = options
  const partTarget = new Map<string, string[]>()
  const includesSource = new Map<string, string[]>()
  const throughContainer = new Map<string, string[]>()
  const onlyContested = new Map<string, string[]>()

  const add = (map: Map<string, string[]>, uri: string, cluster: string) => {
    map.set(uri, [...map.get(uri) ?? [], cluster])
  }
  const isRun = (id: string | undefined): boolean => Boolean(id && clusters.get(id)?.scope === 'RUN')

  // the containers a run reaches, so clause 3 can ask "which runs is this container attached from"
  const runsOfContainer = new Map<string, string[]>()
  for (const attachment of options.attachments) {
    if (attachment.via === 'show-show') continue
    if (!isRun(attachment.from)) continue
    add(runsOfContainer, attachment.to, attachment.from)
  }

  // a row whose every active link POINTING AT IT is a contested or disagreeing-ids downgrade is hidden
  // whatever its origin (5.2, 6.1): `mal:51535` holds both Attack on Titan parts and is a card for
  // neither (8.6). Its own links out, a PART_OF to its show, relate it to no other run.
  const linksOn = new Map<string, ContainmentLink[]>()
  for (const link of options.links) {
    linksOn.set(link.toUri, [...linksOn.get(link.toUri) ?? [], link])
  }

  for (const link of options.links) {
    const fromCluster = clusterOf(link.fromUri)
    const toCluster = clusterOf(link.toUri)
    if (link.kind === 'INCLUDES') {
      // an INCLUDES source onto a run cluster's member: the container proved which episodes are the run
      if (isRun(toCluster) && toCluster !== fromCluster) add(includesSource, link.fromUri, toCluster!)
      continue
    }
    // a PART_OF target of a run cluster's member: the folded season, `nf:80987039-1` under the cours
    if (isRun(fromCluster) && fromCluster !== toCluster) add(partTarget, link.toUri, fromCluster!)
    // a PART_OF source into a container that some OTHER run is attached from: the season row hanging
    // off its own title by `prefix`, `nf:80987039-1` under `nf:80987039`
    if (toCluster && clusters.get(toCluster)?.scope === 'CONTAINER') {
      for (const run of runsOfContainer.get(toCluster) ?? []) {
        if (run !== fromCluster) add(throughContainer, link.fromUri, run)
      }
    }
  }

  for (const [uri, links] of linksOn) {
    const downgrades = links.filter(link =>
      link.toUri === uri && link.kind === 'PART_OF' && (link.reason === 'contested' || link.reason === 'disagreeing-ids'))
    if (!downgrades.length || downgrades.length !== links.length) continue
    const cluster = clusterOf(uri)
    // only a row nothing else relates to: an active SAME_AS would have put it in a bigger cluster,
    // and then the cluster's own members are what the rule weighs
    if (cluster && (clusters.get(cluster)?.members.length ?? 1) > 1) continue
    onlyContested.set(uri, sortedUnique(
      downgrades.map(link => clusterOf(link.fromUri)).filter((id): id is string => isRun(id))
    ))
  }

  return { clusters, clusterOf, partTarget, includesSource, throughContainer, containerRuns: runsOfContainer, onlyContested }
}

/** Whether a cluster carries a per-run metadata row, which 6.1 never hides (mal, anilist, kitsu ...). */
const hasPerRunOrigin = (cluster: ClusterFacts): boolean =>
  cluster.members.some(uri => PER_RUN_ORIGINS.has(originOf(uri)))

/**
 * The hide rule of 6.1 and the cluster kind of 6.5, for one cluster.
 *
 * A cluster is hidden from a LISTING when no member is from a per-run metadata origin AND every member
 * is one of: a `PART_OF` target of some run cluster's member; an `INCLUDES` source onto one; or a
 * `PART_OF` source into a container attached from some run. `hiddenBy` names the runs those clauses
 * found, which is what lets a search answered only by hidden rows draw the runs in their place (6.1,
 * the second statement of `mediaPage`).
 *
 * Two verdicts sit beside the rule and both are 6.1's own words: a cluster none of whose members is
 * OWNED is hidden whatever its links ("a placeholder cluster is never a card"), and a row whose every
 * link is a `contested` or `disagreeing-ids` downgrade is hidden whatever its origin.
 *
 * `kind` is the page 6.5 draws rather than the visibility: `FOLD` is a catalogue season cluster whose
 * members are all `INCLUDES` sources or `PART_OF` targets of runs, which is the page that lists its
 * OWN rows in its OWN numbering (`nf:80987039-1`, 24 rows with Netflix buttons). A per-run metadata
 * row is never a fold, which is what separates the folded Netflix season from a contested `mal:` row.
 */
export const listingVerdict = (cluster: ClusterFacts, index: ListingIndex): ListingVerdict => {
  // clause 1 EXPANDED the way 5.4 P2 expands an attachment: a container cluster some run is attached
  // to holds that run whichever of its members carries the `PART_OF`, so the cluster is the subject
  // there rather than the row. A RUN cluster is never a container, so the strict per-member reading
  // is what a mixed cluster still meets.
  const attachedTo = cluster.scope === 'CONTAINER'
    ? (index.containerRuns.get(cluster.id) ?? []).filter(id => id !== cluster.id)
    : []
  const runsFor = (uri: string, clauses: readonly Map<string, string[]>[]): string[] =>
    [...attachedTo, ...clauses.flatMap(clause => (clause.get(uri) ?? []).filter(id => id !== cluster.id))]

  const foldClauses = [index.partTarget, index.includesSource]
  const foldRuns = cluster.members.map(uri => runsFor(uri, foldClauses))
  const folded = foldRuns.every(runs => runs.length) && foldRuns.some(runs => runs.length)
  const perRun = hasPerRunOrigin(cluster)
  const kind: ListingVerdict['kind'] =
    cluster.scope === 'CONTAINER' ? 'CONTAINER'
    : !perRun && folded ? 'FOLD'
    : 'RUN'

  if (!cluster.owned) return { hidden: true, hiddenBy: [], kind }

  const contested = cluster.members.map(uri => index.onlyContested.get(uri))
  if (contested.every(claimants => claimants?.length)) {
    return { hidden: true, hiddenBy: sortedUnique(contested.flatMap(claimants => claimants!)), kind }
  }

  if (perRun) return { hidden: false, hiddenBy: [], kind }

  const clauses = [index.partTarget, index.includesSource, index.throughContainer]
  const perMember = cluster.members.map(uri => runsFor(uri, clauses))
  if (!perMember.length || !perMember.every(runs => runs.length)) return { hidden: false, hiddenBy: [], kind }
  return { hidden: true, hiddenBy: sortedUnique(perMember.flat()), kind }
}

// ---------------------------------------------------------------------------------------------
// The invariant of 3.5, repaired rather than reported.

/** One `SAME_AS` the containment edge above it beats, and the edge written to say so. */
export type InvariantRepair = {
  part: string
  member: string
  whole: string
  /** The `LINK.key` of the `SAME_AS` this repair retracts, named so a trace can descend to it. */
  retracts: string
  className: string
  seq: number
}

/** The precedence classes of 5.2, strongest first: the order `weakerSameAs` reads backwards. */
const CLASS_ORDER = ['run-id', 'season-id', 'ask', 'seed', 'source-other', 'title']

/**
 * Which of two `SAME_AS` links is the WEAKER, by the declared precedence of 5.2 and then by age.
 *
 * A lower precedence class loses to a higher one, and within a class the LATER row loses, so the
 * answer never depends on which plugin ran first, which is what 3.5 asks of it. Returns a comparator
 * value: negative when `a` is the weaker and should be named first.
 */
export const weakerSameAs = (a: SameAsFacts, b: SameAsFacts): number =>
  CLASS_ORDER.indexOf(b.className) - CLASS_ORDER.indexOf(a.className)
  || b.seq - a.seq
  || compare(a.key, b.key)

/**
 * The repair of the invariant of 3.5: a `PART_OF` or `INCLUDES` between two members of one cluster
 * retracts the `SAME_AS` that joined them, never the containment edge.
 *
 * HOW A PLUGIN RETRACTS ANOTHER PLUGIN'S LINK, which it may not do directly (the writer diffs per
 * `by`, 5.2): it writes the containment edge the weld contradicts, and guard 6 (`contained`) then
 * refuses that `SAME_AS` on its owner's next re-proposal, which every plugin makes every pass. So the
 * precedence is enforced through the one chokepoint rather than around it, and the outcome does not
 * depend on which plugin ran first.
 *
 * WHAT IS EMITTED, and why it is every one of them. A part is not a member of the whole's cluster, so
 * every `SAME_AS` joining the part to that cluster loses: retracting only the weakest would leave the
 * part welded through the next one. They are emitted weakest first, which is the order the log names.
 *
 * WHAT IT NEVER READS: a `PART_OF` that IS a downgrade (5.2). Those sit inside a cluster by design,
 * because guard 4 refuses to retract a standing disagreement and 5.5 reports it instead, so repairing
 * one would empty the component and weld it back on the next pass. Measured on the corpus, 2026-09-12:
 * without this exclusion, three `offline:` ids of one origin in one cluster tore four cases apart and
 * took 179 further `SPLIT` lines with them.
 *
 * THE TRIGGER IS STABLE ACROSS THE SPLIT IT CAUSES, and that is load bearing rather than defensive: a
 * rule reading "the two are in one cluster" would stop firing the moment the cluster split, the guard
 * would stop refusing, the weld would come back and the pass would oscillate until the state hash
 * caught it (5.3). So the trigger is "the part is joined to a member of the whole's cluster by a
 * `SAME_AS` that is active OR refused as `contained`", and the refusal this repair causes is itself
 * what keeps it true.
 */
export const invariantRepairs = (options: {
  links: readonly ContainmentLink[]
  clusters: Map<string, ClusterFacts>
  clusterOf: (uri: string) => string | undefined
  /** Active `SAME_AS` edges, and the ones already refused as `contained` by this repair. */
  sameAs: readonly SameAsFacts[]
  containedRefusals: readonly { fromUri: string, toUri: string }[]
}): InvariantRepair[] => {
  const joined = new Map<string, SameAsFacts>()
  const pairKey = (a: string, b: string): string => (a < b ? `${a} ${b}` : `${b} ${a}`)
  for (const link of options.sameAs) joined.set(pairKey(link.fromUri, link.toUri), link)
  const refused = new Set(options.containedRefusals.map(row => pairKey(row.fromUri, row.toUri)))

  const repairs = new Map<string, InvariantRepair>()
  for (const link of options.links) {
    // A DOWNGRADE IS NOT AN INDEPENDENT CONTAINMENT FACT, which is the same exclusion guard 6 makes
    // and for the same measured reason (`DOWNGRADE_REASONS`, guards.ts): a `PART_OF` written BECAUSE
    // a `SAME_AS` was refused would otherwise be read back as the reason to refuse it, and guard 4's
    // own rule is that a standing disagreement inside a component is REPORTED (5.5) and never
    // retracted, since refusing every link of such a component empties it and welds it back next pass
    if (DOWNGRADE_REASONS.has(link.reason)) continue
    const whole = options.clusterOf(link.toUri)
    if (!whole) continue
    for (const member of options.clusters.get(whole)?.members ?? []) {
      if (member === link.fromUri || member === link.toUri) continue
      const key = pairKey(link.fromUri, member)
      const same = joined.get(key)
      if (!same && !refused.has(key)) continue
      repairs.set(`${link.fromUri} ${member}`, {
        part: link.fromUri,
        member,
        whole: link.toUri,
        retracts: same?.key ?? '',
        className: same?.className ?? 'title',
        seq: same?.seq ?? 0,
      })
    }
  }
  return [...repairs.values()].sort((a, b) =>
    weakerSameAs(
      { fromUri: a.part, toUri: a.member, key: a.retracts, className: a.className, seq: a.seq },
      { fromUri: b.part, toUri: b.member, key: b.retracts, className: b.className, seq: b.seq }
    )
    || compare(a.part, b.part) || compare(a.member, b.member))
}

// ---------------------------------------------------------------------------------------------
// What the pass reads.

/** Every cluster with its members, in one statement: the scan every rule below is anchored on. */
export const readClusters = async (ctx: PluginContext): Promise<{
  clusters: Map<string, ClusterFacts>
  clusterOf: (uri: string) => string | undefined
  folding: Map<string, { folding: boolean, count: number | null }>
  startDayOf: Map<string, number>
}> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster)
     MATCH (p:MediaProfile)-[:PROFILE_OF]->(m)
     RETURN c.id AS id, c.scope AS scope, c.key AS key, c.runLength AS runLength,
       m.uri AS uri, m.owned AS owned, p.startDay AS startDay, p.folding AS folding,
       p.countStated AS countStated, p.countDistinct AS countDistinct
     ORDER BY id, uri`
  )
  const clusters = new Map<string, ClusterFacts>()
  const membership = new Map<string, string>()
  const folding = new Map<string, { folding: boolean, count: number | null }>()
  const startDayOf = new Map<string, number>()
  for (const row of rows) {
    const id = String(row.id)
    const uri = String(row.uri)
    const startDay = asNumber(row.startDay)
    const existing = clusters.get(id) ?? {
      id,
      scope: asText(row.scope) === 'CONTAINER' ? 'CONTAINER' as const : 'RUN' as const,
      key: asText(row.key) ?? id,
      members: [],
      owned: false,
      startDay: null,
      runLength: asNumber(row.runLength),
    }
    existing.members.push(uri)
    existing.owned = existing.owned || row.owned === true
    if (startDay !== null) existing.startDay = existing.startDay === null ? startDay : Math.min(existing.startDay, startDay)
    clusters.set(id, existing)
    membership.set(uri, id)
    folding.set(uri, { folding: row.folding === true, count: asNumber(row.countDistinct) ?? asNumber(row.countStated) })
    if (startDay !== null) startDayOf.set(uri, startDay)
  }
  return { clusters, clusterOf: uri => membership.get(uri), folding, startDayOf }
}

/** Every active containment edge, which is what the attachments and the invariant are anchored on. */
export const readContainmentLinks = async (ctx: PluginContext): Promise<ContainmentLink[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'active' AND l.kind IN ['PART_OF', 'INCLUDES']
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.reason AS reason, l.key AS linkKey
     ORDER BY fromUri, toUri, kind, reason`
  )
  return rows.map(row => ({
    fromUri: String(row.fromUri),
    toUri: String(row.toUri),
    kind: String(row.kind) === 'INCLUDES' ? 'INCLUDES' as const : 'PART_OF' as const,
    reason: asText(row.reason) ?? '',
    key: asText(row.linkKey) ?? '',
  }))
}

/** The first and last day a row's OWN episodes carry, which is the only span 5.4 P2 will read. */
const readEpisodeSpans = async (ctx: PluginContext): Promise<Map<string, { first: number, last: number }>> => {
  // read from the row's OWN list: a Crunchyroll season row carries no start date at all
  // (`crunchyroll/extractor.ts:189` sets `startDate` only on the series row), so the season's days are
  // its episodes' days and nothing else
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode)
     MATCH (p:EpisodeProfile)-[:EPISODE_PROFILE_OF]->(e)
     WHERE h.claimer = m.origin AND p.day IS NOT NULL
     RETURN m.uri AS uri, p.day AS day ORDER BY uri`
  )
  const spans = new Map<string, { first: number, last: number }>()
  for (const row of rows) {
    const uri = String(row.uri)
    const day = asNumber(row.day)
    if (day === null) continue
    const span = spans.get(uri)
    spans.set(uri, span ? { first: Math.min(span.first, day), last: Math.max(span.last, day) } : { first: day, last: day })
  }
  return spans
}

const parseRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** The active `SAME_AS` edges with the precedence class and the seq the repair weighs them by. */
const readSameAs = async (ctx: PluginContext): Promise<SameAsFacts[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'active' AND l.kind = 'SAME_AS'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.key AS linkKey, l.evidence AS evidence, l.supports AS supports
     ORDER BY fromUri, toUri`
  )
  if (!rows.length) return []
  const seqs = new Map<string, number>()
  for (const row of await ctx.query<Record<string, unknown>>('MATCH (a:Media)-[c:CLAIMS]->(b:Media) RETURN c.key AS claimKey, c.seq AS seq')) {
    seqs.set(String(row.claimKey), asNumber(row.seq) ?? 0)
  }
  return rows.map(row => {
    const supports = Array.isArray(row.supports) ? row.supports.map(String) : []
    return {
      fromUri: String(row.fromUri),
      toUri: String(row.toUri),
      key: asText(row.linkKey) ?? '',
      className: precedenceClassOf({
        kind: 'SAME_AS',
        fromUri: String(row.fromUri),
        toUri: String(row.toUri),
        reason: '',
        confidence: 1,
        evidence: parseRecord(row.evidence),
        supports,
      }),
      seq: Math.max(0, ...supports.map(key => seqs.get(key) ?? 0)),
    }
  })
}

/** The pairs this repair already refused, which is what keeps its own trigger true after the split. */
const readContainedRefusals = async (ctx: PluginContext): Promise<{ fromUri: string, toUri: string }[]> => {
  const rows = await ctx.query<Record<string, unknown>>(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'refused' AND l.kind = 'SAME_AS' AND l.reason = 'contained'
     RETURN a.uri AS fromUri, b.uri AS toUri ORDER BY fromUri, toUri`
  )
  return rows.map(row => ({ fromUri: String(row.fromUri), toUri: String(row.toUri) }))
}

// ---------------------------------------------------------------------------------------------

const proposal = (options: {
  fromUri: string
  toUri: string
  reason: string
  evidence: unknown
  supports: string[]
  status?: 'refused'
}): LinkProposal => ({
  kind: 'PART_OF',
  fromUri: options.fromUri,
  toUri: options.toUri,
  ...options.status ? { status: options.status } : {},
  reason: options.reason,
  confidence: 1.0,
  evidence: options.evidence,
  supports: options.supports,
})

/**
 * `plugin:containment`, P2 of 5.4.
 *
 * Consumes `Cluster`, `MEMBER_OF`, `LINK` (`PART_OF`), `MediaProfile`, `HAS_EPISODE` and
 * `EpisodeProfile`; produces `ATTACHED_TO` and `LINK` `PART_OF`; `after: [plugin:aggregate]`, because
 * every edge it writes is between CLUSTERS and a cluster is that plugin's row.
 */
export const containmentPlugin: Plugin = {
  id: 'plugin:containment',
  consumes: {
    nodes: ['Cluster', 'Media', 'Episode', 'MediaProfile', 'EpisodeProfile'],
    edges: ['MEMBER_OF', 'LINK', 'HAS_EPISODE'],
    kinds: ['PART_OF', 'INCLUDES'],
  },
  produces: { nodes: [], edges: ['ATTACHED_TO', 'LINK'], kinds: ['PART_OF'] },
  after: ['plugin:aggregate'],
  version: CONTAINMENT_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    const [{ clusters, clusterOf, folding, startDayOf }, links, spans, sameAs, containedRefusals] = await Promise.all([
      readClusters(ctx),
      readContainmentLinks(ctx),
      readEpisodeSpans(ctx),
      readSameAs(ctx),
      readContainedRefusals(ctx),
    ])

    const attachments = attachmentsOf({ links, clusterOf, clusters })
    const edges: PluginRow[] = attachments.map(attachment => ({
      from: attachment.from,
      to: attachment.to,
      via: attachment.via,
      supports: attachment.supports,
    }))

    // THE SPAN SCAN, anchored on the `PART_OF` a run's member already carries (5.4 P2): a folding
    // origin's season whose own episode days cover the run's start and which is LONGER than the run
    const byRunCluster = new Map<string, SpanCandidate[]>()
    for (const link of links) {
      if (link.kind !== 'PART_OF') continue
      const runCluster = clusterOf(link.fromUri)
      const cluster = runCluster ? clusters.get(runCluster) : undefined
      if (!cluster || cluster.scope !== 'RUN' || cluster.runLength === null) continue
      const startDay = startDayOf.get(link.fromUri)
      if (startDay === undefined) continue
      const season = folding.get(link.toUri)
      if (!season?.folding || season.count === null || season.count <= cluster.runLength) continue
      const span = spans.get(link.toUri)
      if (!span || span.first > startDay || startDay > span.last) continue
      const candidate: SpanCandidate = {
        runCluster: cluster.id,
        runUri: link.fromUri,
        seasonUri: link.toUri,
        first: span.first,
        last: span.last,
        startDay,
        theirCount: season.count,
        runLength: cluster.runLength,
      }
      byRunCluster.set(cluster.id, [...byRunCluster.get(cluster.id) ?? [], candidate])
    }

    const proposals: LinkProposal[] = []
    for (const [runCluster, candidates] of [...byRunCluster].sort(([a], [b]) => compare(a, b))) {
      const verdict = spanVerdict(candidates)
      if (!verdict.ok) {
        // two seasons covering one start day is a catalogue whose seasons overlap: refused, WRITTEN,
        // so the next reader sees a decision rather than a silence (5.4 P2)
        ctx.log({
          level: 'warn',
          rule: 'span-ambiguous',
          detail: `${runCluster} is covered by ${sortedUnique(candidates.map(candidate => candidate.seasonUri)).join(', ')}, so no season holds it`,
          uris: sortedUnique(candidates.map(candidate => candidate.seasonUri)),
        })
        for (const candidate of verdict.candidates) {
          proposals.push(proposal({
            fromUri: candidate.runUri,
            toUri: candidate.seasonUri,
            reason: 'span',
            status: 'refused',
            evidence: {
              first: candidate.first, last: candidate.last, startDay: candidate.startDay,
              theirCount: candidate.theirCount, runLength: candidate.runLength,
              candidates: sortedUnique(candidates.map(other => other.seasonUri)),
            },
            supports: [],
          }))
        }
        continue
      }
      for (const candidate of verdict.candidates) {
        proposals.push(proposal({
          fromUri: candidate.runUri,
          toUri: candidate.seasonUri,
          reason: 'span',
          evidence: {
            first: candidate.first, last: candidate.last, startDay: candidate.startDay,
            theirCount: candidate.theirCount, runLength: candidate.runLength,
          },
          supports: [],
        }))
      }
    }

    // THE INVARIANT OF 3.5, repaired rather than reported: the containment edge stands and the
    // `SAME_AS` that welded the part into the whole's cluster loses, through guard 6 (5.2)
    const repairs = invariantRepairs({ links, clusters, clusterOf, sameAs, containedRefusals })
    for (const repair of repairs) {
      proposals.push(proposal({
        fromUri: repair.part,
        toUri: repair.member,
        reason: 'inside',
        evidence: { whole: repair.whole, retracts: repair.retracts, class: repair.className, seq: repair.seq },
        supports: repair.retracts ? [repair.retracts] : [],
      }))
    }
    if (repairs.length) {
      ctx.log({
        level: 'warn',
        rule: 'part-of-inside',
        detail: `${repairs.length} containment edge(s) sat inside one cluster; the weaker SAME_AS loses (3.5), weakest first: ${repairs[0]!.part} to ${repairs[0]!.member}`,
        uris: sortedUnique(repairs.flatMap(repair => [repair.part, repair.member])),
      })
    }

    return {
      // THE 2C HOOK: with `delta` this is the dirty clusters and their one-hop containers; today the
      // scans are whole-graph, so the scope has to be too or a retraction would be confined to a set
      // the scan never read
      scope: { full: true },
      nodes: [],
      edges: [{ table: 'ATTACHED_TO', rows: edges }],
      links: proposals,
      episodeLinks: [],
    }
  },
}
