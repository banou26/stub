/**
 * The nine guards of 5.2, the downgrade they write instead, and the `partOf` guards beside them.
 *
 * EVERY `SAME_AS` PROPOSAL PASSES THESE, whatever plugin made it, and the writer is the one caller
 * (`./writer.ts`). A guard never edits a proposal: it returns a verdict, and a refusal carries both
 * the row that records it (`LINK {status: 'refused', reason}`) and, for six of the nine, the
 * containment edge the writer writes instead. A wrong CONTAINER is a missing `SAME_AS`, recoverable
 * by a later proof; a wrong `SAME_AS` is a lie about what the user is about to watch
 * (`db.ts:142-145`), so a refusal costs a button and never a badge. The one refusal that costs the
 * badge too is a claim the contested row's own claims say is wrong (guard 5).
 *
 * WHAT IS READ, AND WHEN. A batch is PREPARED once (`prepareGuards`) with every pair the writer is
 * about to weigh: a few reads, then every verdict is computed in JS off that snapshot. Two of the
 * guards share one claim-settled ledger (`readLedger`):
 * - guards 4 and 5 settle jointly from every consumed `SAME_AS` claim and profile in the graph,
 *   never from link statuses, with Offline claims ranked ahead of other origins so tracker ids win;
 * - guard 4 checks that claim-settled relation and the active `SAME_AS` links (with settled
 *   contested hubs cut out) so neither arrival order nor a contested hub decides a refusal.
 *
 * THE SNAPSHOT IS TAKEN BEFORE THE DIFF, so it holds rows this same apply is about to delete. That is
 * the rule's own wording ("the graph as it stands") and it is deliberate, but it surprises a reader
 * twice: a pair the previous apply joined with a `PART_OF` is `contained` in the apply that retracts
 * that `PART_OF`, and a weld the previous apply wrote can move the verdict on a neighbouring pair
 * from guard 7 to guard 4. Neither is a cycle, because the next iteration reads the moved graph and
 * agrees with itself; the pass's own fixed-point loop is what absorbs them (2 iterations on a
 * recorded page, 2026-09-12).
 *
 * THE COMPONENT READ IS AN EDGE LIST, NOT A WALK PER URI. `MATCH (a)-[e:LINK*0..8 (r, _ | WHERE
 * r.kind = 'SAME_AS' AND r.status = 'active')]-(b)` is the spelling of 3.5 and it is what the test
 * asserts this agrees with, uri by uri; issuing it once per endpoint would be one recursive walk per
 * proposal (6.8 ms each on a session sized graph, 2026-09-11). One read of the active `SAME_AS`
 * edges plus a union-find in JS is the same relation for the whole batch.
 *
 * THE REMAINING 2C HOOK: the component read is whole-graph and becomes a delta-scoped read when
 * `delta` arrives. Guard 7 now reads `Cluster.runLength`, the witnessed figure of 5.4 P5, wherever a
 * cluster holds the run side, and falls back to that row's own profile count where none does yet,
 * which is every row on the first iteration of a pass.
 */
import { onGraphWrite } from '../engine'

import type { Refusal } from './contract'
import { PER_RUN_ORIGINS, SEASON_SCOPED_ORIGINS } from './sameness'

/** The read handle the guards are given: Cypher in, rows out, exactly the writer's own handle. */
export type GuardQuery = (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>

/**
 * One pair the writer is about to weigh, with the claim and link keys it was derived from. `joins` is
 * true for a `SAME_AS` the plugin did not already refuse, which is a pair accepting it would join.
 */
export type SameAsSubject = { fromUri: string, toUri: string, supports: string[], joins?: boolean }

/** The containment edge a refusal is written as (5.2, "the downgrade"). */
export type Downgrade = { fromUri: string, toUri: string, reason: Refusal, evidence: { theirs: unknown, ours: unknown } }

/**
 * What a guard concluded about one proposal.
 *
 * `write` is false for `unknown-scope` alone: the proposal WAITS for the next pass and nothing is
 * written, so a claim whose endpoint has no effective scope yet leaves no row behind to explain
 * (5.2 guard 1, the mermaid's "the claim edge stays, nothing is written, replayed next pass").
 */
export type SameAsVerdict =
  | { ok: true }
  | { ok: false, reason: Refusal, write: boolean, evidence: unknown, downgrade?: Downgrade }

/** The `partOf` guards: `unknown-scope`, `self` and `inverted`, and nothing else (5.2). */
export type PartOfVerdict =
  | { ok: true }
  | { ok: false, reason: 'unknown-scope' | 'self' | 'inverted', write: boolean, evidence: unknown }

/** Every fact a guard reads about one row, all of it off `MediaProfile` and its own `Media` row. */
export type ProfileFacts = {
  uri: string
  origin: string
  scope: 'RUN' | 'CONTAINER' | null
  idParent: string | null
  folding: boolean
  countStated: number | null
  countDistinct: number | null
  format: string | null
  showLevelOrigin: boolean
  /** `Media.status`, which is what the FINISHED gate of guard 7 reads. Not a profile column (2.2). */
  status: string | null
  /**
   * `Cluster.runLength` of the cluster this row is in, when one exists: the WITNESSED figure of
   * 5.4 P5, which is what guard 7 weighs a folding season against. NULL before `plugin:aggregate`
   * has run over this row, and the row's own profile count then stands in for it.
   */
  clusterRunLength: number | null
}

/** The guards in the order 5.2 states them. Exported so a test walks the rule rather than a list. */
export const SAME_AS_GUARDS = [
  'unknown-scope', 'cross-scope', 'address-only', 'disagreeing-ids', 'contested',
  'contained', 'count-mismatch', 'no-length', 'kind-mismatch',
] as const satisfies readonly Refusal[]

/**
 * The refusal reasons the writer itself puts on a downgrade edge.
 *
 * Guard 6 must not read one: a `PART_OF` written BECAUSE a `SAME_AS` was refused is the refusal, not
 * an independent containment fact, and treating it as one flips the reason of the refused row from
 * `cross-scope` to `contained` on the next pass, drops the downgrade, and puts the pair back to
 * `cross-scope` on the pass after that. That is a cycle the state hash reports rather than a verdict.
 */
export const DOWNGRADE_REASONS = new Set<string>([
  'cross-scope', 'disagreeing-ids', 'contested', 'count-mismatch', 'no-length', 'kind-mismatch',
])

const asBoolean = (value: unknown): boolean => value === true
const asText = (value: unknown): string | null => typeof value === 'string' && value ? value : null
const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null

const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))
const idOf = (uri: string): string => uri.slice(uri.indexOf(':') + 1)

/** An `offline:` id is borrowed from another catalogue, as `<source>-<id>` (`offline/index-lookup.ts`). */
const BORROWED = /^([a-z]+)-(\d+)$/

/**
 * The id a uri names, which is the uri itself for every source but one.
 *
 * `offline` issues no ids: an anime offline database row is named by whichever foreign id reached it
 * first, `mal` before `anilist` before `kitsu` before `anidb` (`offline/index-lookup.ts` `rowId`), so
 * `offline:mal-61469` IS MyAnimeList 61469, and `offline:anilist-103303` and `offline:mal-62856` are
 * routinely ONE row under two addresses.
 *
 * Read as a plain origin they look like two rows that cannot both be this show. Measured on the
 * recorded page 2026-09-14: every one of the 57 corpus lines that guard 5 newly split was an `offline:`
 * pair borrowing from two different catalogues, and the labels say all of them are one show. Read as
 * nothing at all, the same row lets a cluster hold two runs of one catalogue: Steel Ball Run's second
 * stage, `offline:mal-63825`, welded to `mal:61469` through AniList's wrong `idMal` (2026-10-16).
 */
export const identityOf = (uri: string): string => {
  if (originOf(uri) !== 'offline') return uri
  const borrowed = BORROWED.exec(idOf(uri))
  return borrowed ? `${borrowed[1]}:${borrowed[2]}` : uri
}

/** The space a uri's id is unique in: its origin, or the catalogue an `offline` id borrows from. */
export const identitySpaceOf = (uri: string): string => originOf(identityOf(uri))

const unknownProfile = (uri: string): ProfileFacts => ({
  uri,
  origin: originOf(uri),
  scope: null,
  idParent: null,
  folding: false,
  countStated: null,
  countDistinct: null,
  format: null,
  showLevelOrigin: false,
  status: null,
  clusterRunLength: null,
})

/**
 * Whether two ids of one origin are one id at two precisions, which is not a disagreement.
 *
 * `idParent` first, because that is the column 5.2 guard 4 names, and it is the CONFIRMED form: the
 * profile writes it only when the parent row exists, so `offline:mal-59193` never claims a parent
 * nobody named. The literal test beside it is the specificity rule itself (`src/utils/uri.ts:23-34`,
 * prefix extension and never length), and it is what answers `cr:A-1-2` against `cr:A` when the
 * intermediate `cr:A-1` was never a row: with no chain to climb the two ids still stand in the one
 * relation the rule is about.
 */
const prefixRelated = (a: string, b: string, parentOf: (uri: string) => string | null): boolean => {
  if (a === b) return true
  if (originOf(a) !== originOf(b)) return false
  const climbs = (from: string, to: string): boolean => {
    let current: string | null = from
    for (let hop = 0; hop < 8 && current; hop += 1) {
      current = parentOf(current)
      if (current === to) return true
    }
    return false
  }
  if (climbs(a, b) || climbs(b, a)) return true
  return idOf(a).startsWith(`${idOf(b)}-`) || idOf(b).startsWith(`${idOf(a)}-`)
}

/** Whether two uris name ids that disagree: one space, and not one id at two precisions. */
export const disagree = (a: string, b: string, parentOf: (uri: string) => string | null): boolean =>
  identitySpaceOf(a) === identitySpaceOf(b) && !prefixRelated(identityOf(a), identityOf(b), parentOf)

/** Only a pair that STRADDLES the two sides is a disagreement their union adds. */
const straddlingDisagreement = (
  left: string[],
  right: string[],
  parentOf: (uri: string) => string | null
): [string, string] | undefined => {
  const rightSet = new Set(right)
  for (const a of [...new Set(left)].sort()) {
    // a uri on both sides carries no disagreement ACROSS them: it is one row, in one component
    if (rightSet.has(a)) continue
    for (const b of [...new Set(right)].sort()) {
      if (disagree(a, b, parentOf)) return [a, b]
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// The component relation: active SAME_AS, both directions, and nothing else (3.5).

/** A union-find over the active `SAME_AS` edges: the closure of 3.5, computed once for a batch. */
export type Components = {
  /** The component key of one uri: its lowest member, so two uris agree iff their keys do. */
  keyOf: (uri: string) => string
  /** Every member of one uri's component, the uri included. */
  membersOf: (uri: string) => string[]
  /**
   * The same relation with every active `SAME_AS` edge INCIDENT TO the excluded uris removed.
   *
   * GUARDS 4 AND 5 BOTH NEED IT, because without it each asks a question whose answer it has already
   * decided. Guard 5 skips a pair of claimants that share a component, and once both their claims are
   * accepted they share one THROUGH THE TARGET, so the merge erases the evidence that it should never
   * have happened. Guard 4 refuses a proposal that would ADD a disagreement to a component, and a
   * component held together only by a contested row is one guard 5 is about to take apart, so the
   * disagreement it measures is not one the proposal adds.
   *
   * Left plain, both are decided by arrival order: `plugins/arrival-order.test.ts` builds four claims
   * that cannot all be true and gets two different graphs out of six orderings of the same answers.
   *
   * Cheap because the exclusion is LOCAL. Only the excluded uris' own components can come apart, so
   * this re-runs the union-find over those components' edges and delegates every other uri to the
   * full relation. Memoized for the life of the snapshot, which is one write.
   */
  without: (excluded: string | Iterable<string>) => Pick<Components, 'keyOf' | 'membersOf'>
  /** The same relation with `edges` added: the components a write accepting them would leave. */
  joined: (edges: [string, string][]) => Components
}

/**
 * Read every active `SAME_AS` link and group the rows it joins.
 *
 * THE 2C HOOK: this is the whole-graph form. With `delta` the read narrows to the links an endpoint
 * of the delta touches, which is the scoping 5.2's last paragraph describes, and `runPlugin` then
 * asserts the two forms retract the same links.
 */
/**
 * The component snapshot, taken once per WRITE rather than once per proposal.
 *
 * WHY IT HAS TO BE CACHED. `graphGuards()` is the plugin-facing surface, and a plugin asks about ONE
 * pair at a time (`writer.ts` `sameAs`, `partOf`), so every proposal was paying for a whole-graph read
 * of the active `SAME_AS` edges. Measured on a Mushoku Tensei modal, 2026-09-13: 165 calls carrying
 * 44,283 rows for 2.0 s, which was the single hottest statement of the page. The file's own header
 * already says this read is a batch ("one read of the active SAME_AS edges plus a union-find in JS is
 * the same relation for the whole batch"); the batch just never reached it.
 *
 * WHY IT IS STILL CORRECT. The rule this file states is that the snapshot is "the graph as it
 * stands", taken BEFORE the diff an apply is about to write. Between two writes the active `SAME_AS`
 * edges cannot move, so every reader in that window is entitled to the same answer. The cache is
 * therefore keyed on WRITES, and the hook is at the ENGINE (`onGraphWrite`), which no write can get
 * around. Hooking the writer instead was tried first and was wrong: anything holding a query handle
 * can write, and a test that retracts a `SAME_AS` row directly was answered from before its delete.
 *
 * The returned object is two closures whose `membersOf` hands back a fresh sorted array, so sharing
 * one instance cannot let a caller mutate another's view.
 */
type ContainedInfo = { keys: Set<string>, key: string }
type ActiveSnapshot = { components: Components, edges: [string, string][], contained: ContainedInfo }

// Keep the ledger warm across SAME_AS link writes; rebuild on claims, profiles, status, clusters or PART_OF/INCLUDES changes.
const LEDGER_WRITES = /\b(CLAIMS|MediaProfile|Cluster|MEMBER_OF)\b|(?:CREATE|MERGE)\s*\([^)]*:Media\b|\.status\b|DETACH\s+DELETE|\bDROP\b/i

let componentsEpoch = 0
let activeCache: { epoch: number, value: ActiveSnapshot } | undefined
let ledgerEpoch = 0
let ledgerCache: { epoch: number, containedKey: string, value: ContestLedger } | undefined
let componentsLive = false

/** Called by the writer after it writes, and by the ingest's events. The next read is fresh. */
export const invalidateComponents = (cypher?: string): void => {
  componentsEpoch += 1
  activeCache = undefined
  if (!cypher || LEDGER_WRITES.test(cypher)) {
    ledgerEpoch += 1
    ledgerCache = undefined
  }
}

const watchWrites = (): void => {
  if (componentsLive) return
  componentsLive = true
  onGraphWrite(invalidateComponents)
}

const readActiveSnapshot = async (query: GuardQuery): Promise<ActiveSnapshot> => {
  watchWrites()
  if (activeCache && activeCache.epoch === componentsEpoch) return activeCache.value
  // THE EPOCH IS TAKEN BEFORE THE AWAIT, and a read the graph moved under is answered but not cached.
  // Stamping the post-write epoch onto a pre-write snapshot serves a graph that no longer exists to
  // every later reader in the batch, and nothing re-queries because the epochs then agree.
  const epoch = componentsEpoch
  const rows = await query(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'active' AND l.kind IN ['SAME_AS', 'PART_OF', 'INCLUDES']
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.reason AS reason`
  )
  const edges: [string, string][] = []
  const contained = new Set<string>()
  for (const row of rows) {
    const fromUri = String(row.fromUri)
    const toUri = String(row.toUri)
    if (row.kind === undefined || String(row.kind) === 'SAME_AS') edges.push([fromUri, toUri])
    else if (!DOWNGRADE_REASONS.has(String(row.reason))) contained.add(pairKey(fromUri, toUri))
  }
  const built: ActiveSnapshot = {
    components: componentsOf(edges),
    edges,
    contained: { keys: contained, key: [...contained].sort().join('\n') },
  }
  if (componentsEpoch === epoch) activeCache = { epoch, value: built }
  return built
}

export const readComponents = async (query: GuardQuery): Promise<Components> =>
  (await readActiveSnapshot(query)).components

const componentsOf = (edges: [string, string][]): Components => {
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
  const union = (a: string, b: string) => {
    parent.set(a, parent.get(a) ?? a)
    parent.set(b, parent.get(b) ?? b)
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return
    // the lower uri is always the root, so a component key is stable whatever order the edges arrive
    if (rootA < rootB) parent.set(rootB, rootA)
    else parent.set(rootA, rootB)
  }
  // INDEXED BY ENDPOINT, because `without` walks only the edges inside the cut. Iterating the whole
  // active SAME_AS list and filtering made one memo miss O(|E|) however small the cut: measured on the
  // recorded page 2026-09-14, 7,781 `without` calls, 802 of them misses, 380,757 edge visits against
  // 628 active rows. Free at that size and not at page scale, and `contested` below calls it per
  // multi-claimant target per proposal.
  const incident = new Map<string, [string, string][]>()
  const index = (uri: string, pair: [string, string]) => {
    const list = incident.get(uri)
    if (list) list.push(pair)
    else incident.set(uri, [pair])
  }
  for (const pair of edges) {
    index(pair[0], pair)
    index(pair[1], pair)
    union(pair[0], pair[1])
  }

  const members = new Map<string, string[]>()
  for (const uri of parent.keys()) {
    const root = find(uri)
    const list = members.get(root)
    if (list) list.push(uri)
    else members.set(root, [uri])
  }
  const keyOf = (uri: string): string => (parent.has(uri) ? find(uri) : uri)
  const membersOf = (uri: string): string[] => (parent.has(uri) ? [...members.get(find(uri))!].sort() : [uri])

  const excluding = new Map<string, Pick<Components, 'keyOf' | 'membersOf'>>()
  const without = (excluded: string | Iterable<string>): Pick<Components, 'keyOf' | 'membersOf'> => {
    const cut = typeof excluded === 'string' ? new Set([excluded]) : new Set(excluded)
    const memo = [...cut].sort().join('\u0000')
    const cached = excluding.get(memo)
    if (cached) return cached
    const local = new Set<string>()
    for (const uri of cut) for (const member of membersOf(uri)) local.add(member)
    const localParent = new Map<string, string>()
    const localFind = (uri: string): string => {
      let root = uri
      while (localParent.get(root) && localParent.get(root) !== root) root = localParent.get(root)!
      return root
    }
    for (const uri of local) if (!cut.has(uri)) localParent.set(uri, uri)
    const seen = new Set<[string, string]>()
    for (const uri of local) {
      if (cut.has(uri)) continue
      for (const pair of incident.get(uri) ?? []) {
        if (seen.has(pair)) continue
        seen.add(pair)
        const [from, to] = pair
        if (cut.has(from) || cut.has(to)) continue
        const rootA = localFind(from)
        const rootB = localFind(to)
        if (rootA === rootB) continue
        if (rootA < rootB) localParent.set(rootB, rootA)
        else localParent.set(rootA, rootB)
      }
    }
    const localMembers = new Map<string, string[]>()
    for (const uri of localParent.keys()) {
      const root = localFind(uri)
      const list = localMembers.get(root)
      if (list) list.push(uri)
      else localMembers.set(root, [uri])
    }
    const view = {
      keyOf: (uri: string) => (localParent.has(uri) ? localFind(uri) : cut.has(uri) ? uri : keyOf(uri)),
      membersOf: (uri: string) => (
        localParent.has(uri)
          ? [...localMembers.get(localFind(uri))!].sort()
          : cut.has(uri) ? [uri] : membersOf(uri)
      ),
    }
    excluding.set(memo, view)
    return view
  }

  return { keyOf, membersOf, without, joined: more => componentsOf([...edges, ...more]) }
}

// ---------------------------------------------------------------------------------------------
// The prepared batch.

/** One consumed `SAME_AS` claim into a row: who made it, and from which row. */
type ClaimIn = { claimant: string, claimer: string }

/** The snapshot every verdict in one batch is computed against. */
export type GuardPass = {
  sameAs: (subject: SameAsSubject) => SameAsVerdict
  partOf: (part: string, whole: string) => PartOfVerdict
  /** What the batch read, so a test can assert on the evidence rather than only on the verdict. */
  profileOf: (uri: string) => ProfileFacts
  components: Components
}

const chunked = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

const CHUNK = 2000

/**
 * Read everything the nine guards need for `subjects`, then answer each of them without a round trip.
 *
 * Each statement is written once and parameterized, and none of them ever runs with an empty
 * `UNWIND` list (that dies at runtime on this engine, 2026-09-12).
 */
export const prepareGuards = async (query: GuardQuery, subjects: SameAsSubject[]): Promise<GuardPass> => {
  const endpoints = new Set<string>()
  const supports = new Set<string>()
  for (const subject of subjects) {
    endpoints.add(subject.fromUri)
    endpoints.add(subject.toUri)
    for (const key of subject.supports) supports.add(key)
  }

  const activeSnap = await readActiveSnapshot(query)
  const ledger = await readLedger(query, activeSnap.contained)
  // Exclude claim-settled refusals from the active-link view so an accepted earlier claim
  // overridden by a later Offline row does not hide the contradiction when re-checked.
  const active = ledger.refused.size
    ? componentsOf(activeSnap.edges.filter(([a, b]) => !ledger.refused.has(pairKey(a, b))))
    : activeSnap.components

  // (1, 2, 7, 8, 9) one profile read over every uri a verdict can name: the endpoints and every
  // member of their active components
  const profileSubjects = new Set(endpoints)
  for (const uri of endpoints) for (const member of active.membersOf(uri)) profileSubjects.add(member)
  const profiles = new Map<string, ProfileFacts>()
  for (const chunk of chunked([...profileSubjects], CHUNK)) {
    if (!chunk.length) continue
    const rows = await query(
      `UNWIND $uris AS u
       MATCH (p:MediaProfile {uri: u}), (m:Media {uri: u})
       RETURN p.uri AS uri, m.origin AS origin, p.scope AS scope, p.idParent AS idParent,
         p.folding AS folding, p.countStated AS countStated, p.countDistinct AS countDistinct,
         p.format AS format, p.showLevelOrigin AS showLevelOrigin, m.status AS status`,
      { uris: chunk }
    )
    for (const row of rows) {
      const uri = String(row.uri)
      profiles.set(uri, {
        uri,
        origin: asText(row.origin) ?? originOf(uri),
        scope: asText(row.scope) === 'CONTAINER' ? 'CONTAINER' : asText(row.scope) === 'RUN' ? 'RUN' : null,
        idParent: asText(row.idParent),
        folding: asBoolean(row.folding),
        countStated: asNumber(row.countStated),
        countDistinct: asNumber(row.countDistinct),
        format: asText(row.format),
        showLevelOrigin: asBoolean(row.showLevelOrigin),
        status: asText(row.status),
        clusterRunLength: null,
      })
    }
  }

  // (7) the witnessed length of the cluster each subject is in, where one exists. Its own statement
  // rather than an `OPTIONAL MATCH` beside the profile read: the two comma-separated patterns above
  // are the exercised spelling (2026-09-12), and a row with no cluster must come back as a row with
  // no length rather than not come back at all.
  for (const chunk of chunked([...profileSubjects], CHUNK)) {
    if (!chunk.length) continue
    const rows = await query(
      `UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster)
       RETURN u AS uri, c.runLength AS runLength`,
      { uris: chunk }
    )
    for (const row of rows) {
      const facts = profiles.get(String(row.uri))
      if (facts) facts.clusterRunLength = asNumber(row.runLength)
    }
  }

  // (3) which of the supports are ADDRESS claims: a pointer, whoever the claimer (3.3)
  const addressKeys = new Set<string>()
  for (const chunk of chunked([...supports], CHUNK)) {
    if (!chunk.length) continue
    const rows = await query(
      `UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media)
       WHERE c.provenance = 'address' RETURN DISTINCT c.key AS key`,
      { keys: chunk }
    )
    for (const row of rows) addressKeys.add(String(row.key))
  }

  // (6) the containment edges already joining a pair, read once with active links (see DOWNGRADE_REASONS)
  const contained = activeSnap.contained.keys

  const profileOf = (uri: string): ProfileFacts => profiles.get(uri) ?? unknownProfile(uri)
  const parentOf = (uri: string): string | null => profiles.get(uri)?.idParent ?? ledger.parentOf(uri)
  const facts: Facts = { profileOf, parentOf, active, ledger, addressKeys, contained }

  return {
    profileOf,
    components: activeSnap.components,
    sameAs: subject => sameAsVerdict(subject, facts),
    partOf: (part, whole) => partOfVerdict(part, whole, profileOf),
  }
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

/** How the writer builds one batch of verdicts. `prepareGuards` is the only one that reads a rule. */
export type GuardsFactory = (query: GuardQuery, subjects: SameAsSubject[]) => Promise<GuardPass>

const apart: Components = { keyOf: uri => uri, membersOf: uri => [uri], without: () => apart, joined: () => apart }

/**
 * A prepared batch that accepts every pair, for the one caller that wants a `LINK` row written with
 * no rule applied: a test pinning the DIFF itself rather than a verdict.
 *
 * It is the default nowhere. The writer guards unless a caller hands this over, because a chokepoint
 * a plugin cannot route around is the whole argument for having one (5.2).
 */
export const acceptEveryPair: GuardsFactory = async () => ({
  sameAs: () => ({ ok: true }),
  partOf: () => ({ ok: true }),
  profileOf: unknownProfile,
  components: apart,
})

type Facts = {
  profileOf: (uri: string) => ProfileFacts
  parentOf: (uri: string) => string | null
  active: Components
  ledger: ContestLedger
  addressKeys: Set<string>
  contained: Set<string>
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A non-address `SAME_AS` claim row weighed during claim-level settlement. */
export type ClaimRow = { claimant: string, target: string, claimer: string, provenance: string }

/** A profile row read during claim-level settlement. */
export type ProfileRow = {
  uri?: string
  origin?: string
  scope: string | null
  idParent: string | null
  folding?: boolean
  countStated?: number | null
  countDistinct?: number | null
  format?: string | null
  showLevelOrigin?: boolean
  status?: string | null
  clusterRunLength?: number | null
}

const toProfileFacts = (uri: string, row?: ProfileRow): ProfileFacts =>
  row ? {
    uri,
    origin: row.origin ?? originOf(uri),
    scope: row.scope === 'CONTAINER' ? 'CONTAINER' : row.scope === 'RUN' ? 'RUN' : null,
    idParent: row.idParent,
    folding: row.folding ?? false,
    countStated: row.countStated ?? null,
    countDistinct: row.countDistinct ?? null,
    format: row.format ?? null,
    showLevelOrigin: row.showLevelOrigin ?? false,
    status: row.status ?? null,
    clusterRunLength: row.clusterRunLength ?? null,
  } : unknownProfile(uri)

/** A guard 4 refusal decided during joint settlement, oriented on the settled pair. */
export type Guard4Refusal = { from: string, to: string, ours: string, theirs: string }

/** Joint guard 4 and guard 5 settlement computed solely from claims and profiles. */
export type ContestLedger = {
  components: Components
  claimsInto: Map<string, ClaimIn[]>
  claims: Map<string, Set<string>>
  ownClaims: Map<string, string[]>
  parentOf: (uri: string) => string | null
  conflictSites: Set<string>
  contested: Set<string>
  unsettled: Set<string>
  refused4: Map<string, Guard4Refusal>
  refused: Set<string>
}

const SETTLE_CAP = 50

const namesASeason = (uri: string): boolean => {
  if (!SEASON_SCOPED_ORIGINS.has(originOf(uri))) return false
  const id = idOf(uri)
  const dash = id.lastIndexOf('-')
  return dash > 0 && dash < id.length - 1
}

const claimRank = (claimant: string, target: string, provenance: string): number => {
  const offset = originOf(claimant) === 'offline' ? 0 : 10
  if (provenance === 'ask') return offset + 2
  if (provenance === 'seed') return offset + 3
  if (provenance !== 'source') return offset + 5
  if (PER_RUN_ORIGINS.has(originOf(claimant)) && PER_RUN_ORIGINS.has(originOf(target))) return offset
  if (namesASeason(claimant) || namesASeason(target)) return offset + 1
  return offset + 4
}

const hasDisagreement = (members: string[], parentOf: (uri: string) => string | null): boolean => {
  if (members.length < 2) return false
  const bySpace = new Map<string, string[]>()
  for (const uri of members) {
    const space = identitySpaceOf(uri)
    const seen = bySpace.get(space)
    if (!seen) {
      bySpace.set(space, [uri])
      continue
    }
    for (const other of seen) if (disagree(other, uri, parentOf)) return true
    seen.push(uri)
  }
  return false
}

/**
 * Settle guards 4 and 5 jointly from `profiles` and `rows` (`CLAIMS`), with no `LINK` status input.
 *
 * Claim components with no identity disagreement anywhere in their connected claim region are left
 * untouched. Conflicting regions alternate guard 5 (ordered topologically by contest target) and
 * greedy guard 4 (Offline claims first, then 5.2 precedence, then `pairKey`) until neither adds a
 * refusal. Cyclic guard 5 contests break at the lowest moving pair (`unsettled`).
 */
export const settleLedger = (
  profiles: ReadonlyMap<string, ProfileRow>,
  rows: readonly ClaimRow[],
  contained: ReadonlySet<string> = new Set()
): ContestLedger => {
  const parentOf = (uri: string): string | null => profiles.get(uri)?.idParent ?? null
  const profileFacts = new Map<string, ProfileFacts>()
  const factsOf = (uri: string): ProfileFacts => {
    let facts = profileFacts.get(uri)
    if (!facts) {
      facts = toProfileFacts(uri, profiles.get(uri))
      profileFacts.set(uri, facts)
    }
    return facts
  }
  const claimsInto = new Map<string, ClaimIn[]>()
  const claims = new Map<string, Set<string>>()
  const ownClaims = new Map<string, string[]>()
  const allClaimEdges: [string, string][] = []
  const counted = new Map<string, { pair: [string, string], rank: number }>()

  for (const row of rows) {
    const { claimant, target, claimer, provenance } = row
    if (claimant === target) continue
    const held = claims.get(claimant)
    if (held) held.add(target)
    else claims.set(claimant, new Set([target]))
    if (claimer === originOf(claimant)) {
      const own = ownClaims.get(claimant) ?? []
      if (!own.includes(target)) ownClaims.set(claimant, [...own, target])
    }
    const aFacts = factsOf(claimant)
    const bFacts = factsOf(target)
    // Skip claims refused by pairwise guards (1, 2, 6, 7, 8, 9) so they never join components or contest siblings.
    if (!aFacts.scope || aFacts.scope !== bFacts.scope || postSettlementVerdict(aFacts, bFacts, contained)) {
      continue
    }
    allClaimEdges.push([claimant, target])
    const into = claimsInto.get(target) ?? []
    if (!into.some(entry => entry.claimant === claimant && entry.claimer === claimer)) {
      into.push({ claimant, claimer })
      claimsInto.set(target, into)
    }
    if (originOf(claimant) === originOf(target) || disagree(claimant, target, parentOf)) {
      continue
    }
    const key = pairKey(claimant, target)
    const rank = claimRank(claimant, target, provenance)
    const existing = counted.get(key)
    if (!existing || rank < existing.rank) counted.set(key, { pair: [claimant, target], rank })
  }

  const regions = componentsOf(allClaimEdges)
  const byRegion = new Map<string, string[]>()
  const seenUris = new Set<string>()
  for (const [a, b] of allClaimEdges) {
    for (const uri of [a, b]) {
      if (seenUris.has(uri)) continue
      seenUris.add(uri)
      const root = regions.keyOf(uri)
      const list = byRegion.get(root)
      if (list) list.push(uri)
      else byRegion.set(root, [uri])
    }
  }
  const conflictingRoots = new Set<string>()
  for (const [root, members] of byRegion) {
    if (hasDisagreement(members, parentOf)) conflictingRoots.add(root)
  }

  if (!conflictingRoots.size) {
    return {
      components: componentsOf([...counted.values()].map(entry => entry.pair)),
      claimsInto,
      claims,
      ownClaims,
      parentOf,
      conflictSites: new Set(),
      contested: new Set(),
      unsettled: new Set(),
      refused4: new Map(),
      refused: new Set(),
    }
  }

  const cleanPairs: [string, string][] = []
  const conflictCounted = new Map<string, { pair: [string, string], rank: number }>()
  for (const [key, entry] of counted) {
    if (conflictingRoots.has(regions.keyOf(entry.pair[0]))) conflictCounted.set(key, entry)
    else cleanPairs.push(entry.pair)
  }

  const claimantsOf = (target: string) => new Set((claimsInto.get(target) ?? []).map(claim => claim.claimant))
  const conflictSites = new Set(
    [...claimsInto.keys()].filter(target => conflictingRoots.has(regions.keyOf(target)) && claimantsOf(target).size >= 2)
  )

  const order: string[] = []
  const after = new Map<string, string[]>()
  const waiting = new Map([...conflictSites].map(site => [site, 0]))
  for (const site of conflictSites) {
    for (const claimant of claimantsOf(site)) {
      if (!conflictSites.has(claimant)) continue
      after.set(claimant, [...after.get(claimant) ?? [], site])
      waiting.set(site, waiting.get(site)! + 1)
    }
  }
  for (const left = new Set(conflictSites); left.size;) {
    const next = [...left].sort(compare).find(site => waiting.get(site) === 0) ?? [...left].sort(compare)[0]!
    left.delete(next)
    order.push(next)
    for (const site of after.get(next) ?? []) waiting.set(site, waiting.get(site)! - 1)
  }

  const touching = new Map<string, [string, string][]>()
  for (const { pair } of conflictCounted.values()) {
    for (const end of new Set(pair)) {
      if (!conflictSites.has(end)) continue
      const list = touching.get(end)
      if (list) list.push(pair)
      else touching.set(end, [pair])
    }
  }

  const refused4 = new Map<string, Guard4Refusal>()
  const unsettled = new Set<string>()
  let refused5 = new Set<string>()
  const conflictRelation = (excluded5: Set<string>) =>
    componentsOf(
      [...conflictCounted]
        .filter(([key]) => !refused4.has(key) && !excluded5.has(key) && !unsettled.has(key))
        .map(([, entry]) => entry.pair)
    )

  const work: ContestLedger = {
    components: conflictRelation(refused5),
    claimsInto,
    claims,
    ownClaims,
    parentOf,
    conflictSites,
    contested: new Set(),
    unsettled,
    refused4,
    refused: new Set(),
  }

  for (let round = 0; round <= conflictCounted.size; round += 1) {
    refused5 = new Set()
    work.components = conflictRelation(refused5)
    const states: string[] = []
    const moves: string[][] = []

    for (let sweep = 0; sweep < SETTLE_CAP; sweep += 1) {
      const moving: string[] = []
      for (const site of order) {
        const verdicts = (touching.get(site) ?? [])
          .filter(([a, b]) => {
            const key = pairKey(a, b)
            return !refused4.has(key) && !unsettled.has(key)
          })
          .map(([a, b]) => [pairKey(a, b), Boolean(contestVerdict(a, b, work))] as const)
        const moved = verdicts.filter(([key, refuse]) => refuse !== refused5.has(key))
        for (const [key, refuse] of moved) {
          if (refuse) refused5.add(key)
          else refused5.delete(key)
          moving.push(key)
        }
        if (moved.length) work.components = conflictRelation(refused5)
      }
      if (!moving.length) break
      const state = [...refused5].sort(compare).join('\n')
      const earlier = states.indexOf(state)
      states.push(state)
      moves.push(moving)
      if (earlier >= 0) {
        const lowest = moves.slice(earlier + 1).flat().sort(compare)[0]!
        unsettled.add(lowest)
        refused5.delete(lowest)
        work.components = conflictRelation(refused5)
        states.length = 0
        moves.length = 0
        continue
      }
      if (sweep === SETTLE_CAP - 1) {
        for (const key of refused5) unsettled.add(key)
        refused5.clear()
        work.components = conflictRelation(refused5)
      }
    }

    const dirtyRoots = new Set<string>()
    for (const [key, { pair: [a] }] of conflictCounted) {
      if (refused4.has(key) || refused5.has(key) || unsettled.has(key)) continue
      const root = work.components.keyOf(a)
      if (dirtyRoots.has(root)) continue
      if (hasDisagreement(work.components.membersOf(a), parentOf)) dirtyRoots.add(root)
    }
    if (!dirtyRoots.size) break

    const dirtyEdges = [...conflictCounted]
      .filter(([key, { pair: [a] }]) =>
        !refused4.has(key) && !refused5.has(key) && !unsettled.has(key) && dirtyRoots.has(work.components.keyOf(a)))
      .sort(([keyA, entryA], [keyB, entryB]) => entryA.rank - entryB.rank || compare(keyA, keyB))

    const ufParent = new Map<string, string>()
    const ufMembers = new Map<string, string[]>()
    const ufFind = (uri: string): string => {
      let root = uri
      while (ufParent.get(root) && ufParent.get(root) !== root) root = ufParent.get(root)!
      let walk = uri
      while (ufParent.get(walk) && ufParent.get(walk) !== walk) {
        const next = ufParent.get(walk)!
        ufParent.set(walk, root)
        walk = next
      }
      return root
    }
    const ufMembersOf = (uri: string): string[] => ufMembers.get(ufFind(uri)) ?? [uri]

    let added4 = 0
    for (const [key, { pair: [a, b] }] of dirtyEdges) {
      const rootA = ufFind(a)
      const rootB = ufFind(b)
      if (rootA === rootB) continue
      const left = ufMembersOf(a)
      const right = ufMembersOf(b)
      const straddle = straddlingDisagreement(left, right, parentOf)
      if (straddle) {
        refused4.set(key, { from: a, to: b, ours: straddle[0], theirs: straddle[1] })
        added4 += 1
        continue
      }
      const merged = [...left, ...right]
      if (rootA < rootB) {
        ufParent.set(rootA, rootA)
        ufParent.set(rootB, rootA)
        ufMembers.set(rootA, merged)
        ufMembers.delete(rootB)
      } else {
        ufParent.set(rootB, rootB)
        ufParent.set(rootA, rootB)
        ufMembers.set(rootB, merged)
        ufMembers.delete(rootA)
      }
    }
    if (!added4) break
  }

  const contested = new Set<string>()
  for (const target of conflictSites) {
    const claimants = [...claimantsOf(target)].filter(uri => uri !== target).sort(compare)
    for (let i = 0; i < claimants.length; i += 1) {
      for (let j = i + 1; j < claimants.length; j += 1) {
        const view = work.components.without(sharedCut(claimants[i]!, claimants[j]!, target, claims))
        if (view.keyOf(claimants[i]!) === view.keyOf(claimants[j]!)) continue
        if (!straddlingDisagreement(view.membersOf(claimants[i]!), view.membersOf(claimants[j]!), parentOf)) continue
        contested.add(target)
        break
      }
      if (contested.has(target)) break
    }
  }

  const acceptedConflictPairs = [...conflictCounted]
    .filter(([key]) => !refused4.has(key) && !refused5.has(key) && !unsettled.has(key))
    .map(([, entry]) => entry.pair)

  return {
    components: componentsOf([...cleanPairs, ...acceptedConflictPairs]),
    claimsInto,
    claims,
    ownClaims,
    parentOf,
    conflictSites,
    contested,
    unsettled,
    refused4,
    refused: new Set([...refused4.keys(), ...refused5, ...unsettled]),
  }
}

/** Read and cache the joint claim-settled guard ledger for the current claim and profile epoch. */
export const readLedger = async (
  query: GuardQuery,
  contained: ContainedInfo = { keys: new Set(), key: '' }
): Promise<ContestLedger> => {
  watchWrites()
  if (ledgerCache && ledgerCache.epoch === ledgerEpoch && ledgerCache.containedKey === contained.key) {
    return ledgerCache.value
  }
  const epoch = ledgerEpoch
  const built = await buildLedger(query, contained.keys)
  if (ledgerEpoch === epoch) ledgerCache = { epoch, containedKey: contained.key, value: built }
  return built
}

const buildLedger = async (query: GuardQuery, contained: ReadonlySet<string>): Promise<ContestLedger> => {
  const profiles = new Map<string, ProfileRow>()
  for (const row of await query(
    `MATCH (p:MediaProfile)
     RETURN p.uri AS uri, p.scope AS scope, p.idParent AS idParent, p.folding AS folding,
       p.countStated AS countStated, p.countDistinct AS countDistinct,
       p.format AS format, p.showLevelOrigin AS showLevelOrigin`
  )) {
    const uri = String(row.uri)
    profiles.set(uri, {
      uri,
      origin: originOf(uri),
      scope: asText(row.scope),
      idParent: asText(row.idParent),
      folding: asBoolean(row.folding),
      countStated: asNumber(row.countStated),
      countDistinct: asNumber(row.countDistinct),
      format: asText(row.format),
      showLevelOrigin: asBoolean(row.showLevelOrigin),
      status: null,
      clusterRunLength: null,
    })
  }
  for (const row of await query('MATCH (m:Media) RETURN m.uri AS uri, m.origin AS origin, m.status AS status')) {
    const profile = profiles.get(String(row.uri))
    if (!profile) continue
    profile.origin = asText(row.origin) ?? profile.origin
    profile.status = asText(row.status)
  }
  for (const row of await query('MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN m.uri AS uri, c.runLength AS runLength')) {
    const profile = profiles.get(String(row.uri))
    if (profile) profile.clusterRunLength = asNumber(row.runLength)
  }
  const rows = await query(
    `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
     WHERE c.kind = 'SAME_AS' AND c.provenance <> 'address'
     RETURN DISTINCT a.uri AS claimant, b.uri AS target, c.claimer AS claimer, c.provenance AS provenance
     ORDER BY claimant, target, claimer, provenance`
  )
  const claims = rows.map((row): ClaimRow => ({
    claimant: String(row.claimant),
    target: String(row.target),
    claimer: String(row.claimer),
    provenance: String(row.provenance),
  }))
  return settleLedger(profiles, claims, contained)
}

/**
 * The rows to cut when weighing two claimants of one target against each other.
 *
 * EVERY ROW THEY BOTH CLAIM, not only the target in hand. Two claimants that both claim two rows stay
 * joined through the second whichever one is cut, so the guard reads them as agreeing and the contest
 * is invisible: measured 2026-09-14, six orderings of one such answer set built three different
 * graphs, one of them welding two `mal` runs with nothing refused at all.
 */
const sharedCut = (left: string, right: string, target: string, claims: Map<string, Set<string>>): string[] | string => {
  const shared = [...(claims.get(left) ?? [])].filter(uri => claims.get(right)?.has(uri))
  return shared.length ? shared : target
}

/** The episode figure a count guard reads: what the graph holds, else what the source stated (5.2). */
export const countOf = (facts: ProfileFacts): number | null => facts.countDistinct ?? facts.countStated

/**
 * How long the RUN side is, as guard 7 weighs it: the cluster's witnessed length, else its own count.
 *
 * `Cluster.runLength` is a vote of the whole cluster's members with the provenance classes read first
 * (5.4 P5), so it is the better figure wherever it exists: one row's `episodes.length` is not a claim
 * about the run, and a cluster that holds the metadata catalogues has already weighed those. The
 * fallback is what 2b shipped, and it is still what a row with no cluster yet is weighed on, which is
 * every row on the FIRST iteration of a pass, before `plugin:aggregate` has run at all.
 */
export const runSideLength = (facts: ProfileFacts): number | null => facts.clusterRunLength ?? countOf(facts)

/**
 * Which endpoint a downgrade points AT when the rule itself does not name one.
 *
 * The run or shorter side goes to the container or longer side (5.2), and `kind-mismatch` is the one
 * refusal where neither side is a container and neither is longer (`tmdb:550` is a film to one
 * answer and a series to another). The order below is the rule's own, and the last step is a
 * tie-break rather than a reading: it only has to be the SAME answer on every pass, since a
 * containment edge that changed direction between passes would be written twice forever.
 */
const containerSideOf = (a: ProfileFacts, b: ProfileFacts): ProfileFacts => {
  if (a.scope !== b.scope) return a.scope === 'CONTAINER' ? a : b
  const countA = countOf(a)
  const countB = countOf(b)
  if (countA !== null && countB !== null && countA !== countB) return countA > countB ? a : b
  if (a.showLevelOrigin !== b.showLevelOrigin) return a.showLevelOrigin ? a : b
  return a.uri > b.uri ? a : b
}

const downgradeTo = (
  whole: ProfileFacts,
  part: ProfileFacts,
  reason: Refusal,
  evidence: { theirs: unknown, ours: unknown }
): Downgrade => ({ fromUri: part.uri, toUri: whole.uri, reason, evidence })

const disagreeingVerdict = (
  a: ProfileFacts,
  b: ProfileFacts,
  ours: string,
  theirs: string
): SameAsVerdict => {
  // the shared row is the endpoint that INHERITED the disagreeing id from its component rather
  // than being it: `mal:51535` holding AoT Part 1 while Part 2's own anilist id arrives (8.6).
  // When both inherited it, or neither did, no side is the claimant and the stable tie-break
  // decides, the same one `kind-mismatch` uses.
  const shared =
    a.uri === ours && b.uri !== theirs ? b
    : b.uri === theirs && a.uri !== ours ? a
    : containerSideOf(a, b)
  const claimant = shared === a ? b : a
  return {
    ok: false,
    reason: 'disagreeing-ids',
    write: true,
    evidence: { theirs, ours },
    downgrade: downgradeTo(shared, claimant, 'disagreeing-ids', { theirs, ours }),
  }
}

const contestVerdict = (aUri: string, bUri: string, ledger: ContestLedger): SameAsVerdict | undefined => {
  for (const [target, other] of [[bUri, aUri], [aUri, bUri]] as const) {
    if (!ledger.conflictSites.has(target)) continue
    const claimants = [...new Set((ledger.claimsInto.get(target) ?? []).map(claim => claim.claimant))]
      .filter(uri => uri !== target)
      .sort(compare)
    if (claimants.length < 2) continue
    for (let i = 0; i < claimants.length; i += 1) {
      for (let j = i + 1; j < claimants.length; j += 1) {
        const contesting = ledger.components.without(sharedCut(claimants[i]!, claimants[j]!, target, ledger.claims))
        const otherKey = contesting.keyOf(other)
        const left = contesting.membersOf(claimants[i]!)
        const right = contesting.membersOf(claimants[j]!)
        if (contesting.keyOf(claimants[i]!) === contesting.keyOf(claimants[j]!)) continue
        const straddle = straddlingDisagreement(left, right, ledger.parentOf)
        if (!straddle) continue
        // this proposal is one of the contesting claims only when its other end is one of the two
        // components: a third row that agrees with neither is refused on its own evidence, not here
        const ourSideIsLeft = contesting.keyOf(claimants[i]!) === otherKey
        const ourSideIsRight = contesting.keyOf(claimants[j]!) === otherKey
        if (!ourSideIsLeft && !ourSideIsRight) continue
        // THE TARGET'S OWN CLAIMS SETTLE IT, counting only a claimed row in an id space both sides
        // hold: when every such row sits on one and the same side, that side keeps the target and the
        // other side's claim is refused with no downgrade, since the target itself says it is wrong.
        const own = [target, ...ledger.ownClaims.get(target) ?? []].filter(row =>
          left.some(uri => identitySpaceOf(uri) === identitySpaceOf(row))
          && right.some(uri => identitySpaceOf(uri) === identitySpaceOf(row)))
        const holds = (side: string[], row: string) => side.some(uri => identityOf(uri) === identityOf(row))
        const settledLeft = own.length > 0 && own.every(row => holds(left, row))
        const settledRight = own.length > 0 && own.every(row => holds(right, row))
        if (ourSideIsLeft ? settledLeft : settledRight) continue
        const evidence = {
          theirs: ourSideIsLeft ? straddle[1] : straddle[0],
          ours: ourSideIsLeft ? straddle[0] : straddle[1],
        }
        return {
          ok: false,
          reason: 'contested',
          write: true,
          evidence,
          downgrade: settledLeft || settledRight ? undefined : { fromUri: other, toUri: target, reason: 'contested', evidence },
        }
      }
    }
  }
  if (ledger.unsettled.has(pairKey(aUri, bUri))) {
    return { ok: false, reason: 'contested', write: true, evidence: { theirs: bUri, ours: aUri } }
  }
  return undefined
}

/** Guards 6 through 9 depend only on pairwise facts (containment, counts, kind), not on SAME_AS components. */
const postSettlementVerdict = (
  a: ProfileFacts,
  b: ProfileFacts,
  contained: ReadonlySet<string>
): SameAsVerdict | undefined => {
  // 6. contained (the owner's rule, 3.5): the containment edge already exists, so the downgrade is a
  // no-op and none is written
  if (contained.has(pairKey(a.uri, b.uri))) {
    return { ok: false, reason: 'contained', write: true, evidence: { theirs: b.uri, ours: a.uri } }
  }

  // 7. count-mismatch (foldVetoed, similar.ts:147-150). The run side's length is `Cluster.runLength`,
  // the witnessed figure of 5.4 P5, and its own profile count only where no cluster holds it yet
  // (`runSideLength`). The folding side is weighed on its OWN count, because the whole question is
  // what that one packaging claims.
  // OF TWO FOLDING SEASONS, ONE WITH NO COUNT IS THE RUN SIDE, so guard 8 refuses it whichever uri sorts
  // first. Left to the tie-break of `containerSideOf`, a season welded the other while it was still a
  // bare handle, and the weld then held through the cluster it built: arrival order picked the card.
  // Shows are exempt: Netflix states no count for a show, so the rule would refuse every JustWatch show
  // that names a Netflix title and split the BAKI-DOU pair jw:495174 and nf:81922765. Two shows are
  // still weighed by the tie-break, so a weld between them can still follow arrival order.
  const uncounted = a.scope === 'RUN' ? [a, b].filter(side => countOf(side) === null) : []
  const folding =
    a.folding && b.folding
      ? uncounted.length === 1 ? (uncounted[0] === a ? b : a) : containerSideOf(a, b)
      : a.folding ? a : b.folding ? b : null
  if (folding) {
    const run = folding === a ? b : a
    const theirs = countOf(folding)
    const ours = runSideLength(run)
    if (theirs !== null && ours !== null && theirs !== ours) {
      // LONGER always, zero tolerance; SHORTER only on a FINISHED run, because twelve sources set
      // `episodeCount = episodes.length` and a short fetched list on a RELEASING run is not evidence
      // (consensus.ts:164-168, and the Elusive Samurai row with 8 of 12 aired stays a member)
      const longer = theirs > ours ? folding : run
      const shorter = longer === folding ? run : folding
      if (theirs > ours || run.status === 'FINISHED') {
        return {
          ok: false,
          reason: 'count-mismatch',
          write: true,
          evidence: { theirs, ours },
          downgrade: downgradeTo(longer, shorter, 'count-mismatch', { theirs, ours }),
        }
      }
    }

    // 8. no-length: "no count" is not zero (2026-09-09), so a folding season facing a run with no
    // length at all is never welded on a guess
    if (ours === null) {
      return {
        ok: false,
        reason: 'no-length',
        write: true,
        evidence: { theirs, ours },
        downgrade: downgradeTo(folding, run, 'no-length', { theirs, ours }),
      }
    }
  }

  // 9. kind-mismatch (NEW as a guard on id claims): `tmdb:550` is Fight Club as a film and Till Death
  // Us Do Part as a series, and one uri whose answers disagree about its kind is an anomaly (5.5)
  if (a.format && b.format && a.format !== b.format && (a.format === 'MOVIE' || b.format === 'MOVIE')) {
    const whole = containerSideOf(a, b)
    const part = whole === a ? b : a
    const evidence = { theirs: whole.format, ours: part.format }
    return {
      ok: false,
      reason: 'kind-mismatch',
      write: true,
      evidence,
      downgrade: downgradeTo(whole, part, 'kind-mismatch', evidence),
    }
  }

  return undefined
}

/** The nine guards, in the order of 5.2's table, over one prepared batch. */
const sameAsVerdict = (subject: SameAsSubject, facts: Facts): SameAsVerdict => {
  const a = facts.profileOf(subject.fromUri)
  const b = facts.profileOf(subject.toUri)

  // 1. unknown-scope (db.ts:113-123): the claim that took the RUN default before its row landed
  if (a.scope === null || b.scope === null) {
    return {
      ok: false,
      reason: 'unknown-scope',
      write: false,
      evidence: { theirs: b.scope, ours: a.scope },
    }
  }

  // 2. cross-scope (db.ts:166-169): an edge run to container, whatever was claimed
  if (a.scope !== b.scope) {
    const container = a.scope === 'CONTAINER' ? a : b
    const run = container === a ? b : a
    return {
      ok: false,
      reason: 'cross-scope',
      write: true,
      evidence: { theirs: container.scope, ours: run.scope },
      downgrade: downgradeTo(container, run, 'cross-scope', { theirs: container.scope, ours: run.scope }),
    }
  }

  // 3. address-only (3.3): a pointer, whoever the claimer. Refused and NOT downgraded, because the
  // address asserts nothing about how its uris relate; the row still renders as a badge (6.2)
  const address = subject.supports.filter(key => facts.addressKeys.has(key))
  if (address.length) {
    return { ok: false, reason: 'address-only', write: true, evidence: { theirs: address, ours: subject.supports } }
  }

  // 4. disagreeing-ids, over both the claim-settled components and the active links (with settled
  // contested hubs cut out so neither arrival order nor a contested hub decides a refusal).
  const contested = facts.ledger.contested
  for (const relation of [facts.ledger.components, facts.active]) {
    const settled = contested.size ? relation.without(contested) : relation
    if (settled.keyOf(a.uri) === settled.keyOf(b.uri)) continue
    const straddle = straddlingDisagreement(settled.membersOf(a.uri), settled.membersOf(b.uri), facts.parentOf)
    if (straddle) return disagreeingVerdict(a, b, straddle[0], straddle[1])
  }

  // 5. contested, over the claim-settled ledger rather than active links
  const contest = contestVerdict(a.uri, b.uri, facts.ledger)
  if (contest) return contest

  // If cutting a contested endpoint hid an underlying settled guard 4 refusal above, enforce it here
  // after guard 5 so genuinely contested proposals still receive `contested`.
  const refused4 = facts.ledger.refused4.get(pairKey(a.uri, b.uri))
  if (refused4) {
    const [ours, theirs] = a.uri === refused4.from ? [refused4.ours, refused4.theirs] : [refused4.theirs, refused4.ours]
    return disagreeingVerdict(a, b, ours, theirs)
  }

  return postSettlementVerdict(a, b, facts.contained) ?? { ok: true }
}

/**
 * The `partOf` guards (5.2): `unknown-scope`, `self` and `inverted`.
 *
 * A CONTAINER proposed as a part of a RUN is refused rather than flipped, because "a caller that got
 * the order wrong may have the scopes wrong too" (`db.ts:244-245`). A catalogue season as a part of a
 * longer run is RUN into RUN, which passes.
 */
const partOfVerdict = (part: string, whole: string, profileOf: (uri: string) => ProfileFacts): PartOfVerdict => {
  if (part === whole) {
    return { ok: false, reason: 'self', write: true, evidence: { theirs: whole, ours: part } }
  }
  const partFacts = profileOf(part)
  const wholeFacts = profileOf(whole)
  if (partFacts.scope === null || wholeFacts.scope === null) {
    return { ok: false, reason: 'unknown-scope', write: false, evidence: { theirs: wholeFacts.scope, ours: partFacts.scope } }
  }
  if (partFacts.scope === 'CONTAINER' && wholeFacts.scope === 'RUN') {
    return { ok: false, reason: 'inverted', write: true, evidence: { theirs: wholeFacts.scope, ours: partFacts.scope } }
  }
  return { ok: true }
}
