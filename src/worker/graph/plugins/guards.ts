/**
 * The nine guards of 5.2, the downgrade they write instead, and the `partOf` guards beside them.
 *
 * EVERY `SAME_AS` PROPOSAL PASSES THESE, whatever plugin made it, and the writer is the one caller
 * (`./writer.ts`). A guard never edits a proposal: it returns a verdict, and a refusal carries both
 * the row that records it (`LINK {status: 'refused', reason}`) and, for six of the nine, the
 * containment edge the writer writes instead. A wrong CONTAINER is a missing `SAME_AS`, recoverable
 * by a later proof; a wrong `SAME_AS` is a lie about what the user is about to watch
 * (`db.ts:142-145`), so a refusal costs a button and never a badge.
 *
 * WHAT IS READ, AND WHEN. A batch is PREPARED once (`prepareGuards`) with every pair the writer is
 * about to weigh: five reads, then every verdict is computed in JS off that snapshot. Two of the
 * guards say what they read in their own rule:
 * - guard 4 is evaluated against the GRAPH AS IT STANDS, never within one pass, so the snapshot is
 *   taken before the first verdict and no proposal of this pass can move it,
 * - guard 5 is evaluated over every CLAIM rather than over active links, so two claimants landing in
 *   different flushes meet anyway and the verdict is the same on every later pass.
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

/** The read handle the guards are given: Cypher in, rows out, exactly the writer's own handle. */
export type GuardQuery = (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>

/** One pair the writer is about to weigh, with the claim and link keys it was derived from. */
export type SameAsSubject = { fromUri: string, toUri: string, supports: string[] }

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
const BORROWED = /^([a-z]+)-\d+$/

/**
 * The space a uri's id is unique in, which is the origin for every source but one.
 *
 * TWO IDS OF ONE ORIGIN DISAGREE ONLY IF THE ORIGIN ISSUES THEM. `offline` does not: an
 * anime offline database row has no id of its own and is named by whichever foreign id reached it
 * first, `mal` before `anilist` before `kitsu` before `anidb` (`offline/index-lookup.ts` `rowId`), so
 * `offline:anilist-103303` and `offline:mal-62856` are routinely ONE row under two addresses.
 *
 * Read as a plain origin they look like two rows that cannot both be this show, which is what guards
 * 4 and 5 are built to refuse. Measured on the recorded page 2026-09-14: every one of the 57 corpus
 * lines that guard 5 newly split was an `offline:` pair borrowing from two different catalogues, and
 * the labels say all of them are one show. Splitting on the borrowed source instead leaves a real
 * offline disagreement (`offline:mal-100` against `offline:mal-200`) reported exactly as before.
 */
const identitySpaceOf = (uri: string): string => {
  const origin = originOf(uri)
  if (origin !== 'offline') return origin
  const borrowed = BORROWED.exec(idOf(uri))
  return borrowed ? `offline/${borrowed[1]}` : origin
}

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
export const prefixRelated = (a: string, b: string, parentOf: (uri: string) => string | null): boolean => {
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

/** The first pair of one origin's ids in `uris` that are not one id at two precisions. */
const disagreementIn = (uris: string[], parentOf: (uri: string) => string | null): [string, string] | undefined => {
  const byOrigin = new Map<string, string[]>()
  for (const uri of [...new Set(uris)].sort()) {
    const space = identitySpaceOf(uri)
    const list = byOrigin.get(space)
    if (list) list.push(uri)
    else byOrigin.set(space, [uri])
  }
  for (const [, list] of [...byOrigin].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (!prefixRelated(list[i]!, list[j]!, parentOf)) return [list[i]!, list[j]!]
      }
    }
  }
  return undefined
}

/** The same test across two sides: only a pair that STRADDLES them is a disagreement the union adds. */
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
      if (identitySpaceOf(a) !== identitySpaceOf(b)) continue
      if (!prefixRelated(a, b, parentOf)) return [a, b]
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
let componentsEpoch = 0
let componentsCache: { epoch: number, value: Components } | undefined
let componentsLive = false

/** Called by the writer after it writes, and by the ingest's events. The next read is fresh. */
export const invalidateComponents = (): void => {
  componentsEpoch += 1
  componentsCache = undefined
}

export const readComponents = async (query: GuardQuery): Promise<Components> => {
  if (!componentsLive) {
    componentsLive = true
    onGraphWrite(invalidateComponents)
  }
  if (componentsCache && componentsCache.epoch === componentsEpoch) return componentsCache.value
  const built = await buildComponents(query)
  componentsCache = { epoch: componentsEpoch, value: built }
  return built
}

const buildComponents = async (query: GuardQuery): Promise<Components> => {
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
  const rows = await query(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.kind = 'SAME_AS' AND l.status = 'active'
     RETURN a.uri AS fromUri, b.uri AS toUri`
  )
  const edges: [string, string][] = []
  for (const row of rows) {
    const pair: [string, string] = [String(row.fromUri), String(row.toUri)]
    edges.push(pair)
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
    for (const [from, to] of edges) {
      if (cut.has(from) || cut.has(to)) continue
      if (!local.has(from) || !local.has(to)) continue
      const rootA = localFind(from)
      const rootB = localFind(to)
      if (rootA === rootB) continue
      if (rootA < rootB) localParent.set(rootB, rootA)
      else localParent.set(rootA, rootB)
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

  return { keyOf, membersOf, without }
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
 * Five statements, each written once and parameterized, and none of them ever runs with an empty
 * `UNWIND` list (that dies at runtime on this engine, 2026-09-12).
 */
export const prepareGuards = async (
  query: GuardQuery,
  subjects: { fromUri: string, toUri: string, supports: string[] }[]
): Promise<GuardPass> => {
  const endpoints = new Set<string>()
  const supports = new Set<string>()
  for (const subject of subjects) {
    endpoints.add(subject.fromUri)
    endpoints.add(subject.toUri)
    for (const key of subject.supports) supports.add(key)
  }

  // (4) the component relation, over the graph as it stands. Read FIRST, because the claims read
  // below is over the endpoints AND their component members (see there).
  const components = await readComponents(query)

  // (5) the claims INTO each endpoint, which is guard 5's whole evidence: every consumed SAME_AS
  // claim in the graph, never the active links, so two claimants in different flushes still meet.
  //
  // OVER THE COMPONENT MEMBERS TOO, not only the endpoints. Guard 4 has to know whether a row it is
  // about to refuse over reached the other side through a CONTESTED target (`contested` below), and
  // that row is a member of an endpoint's component rather than an endpoint itself.
  const claimSubjects = new Set(endpoints)
  for (const uri of endpoints) for (const member of components.membersOf(uri)) claimSubjects.add(member)
  const claimsInto = new Map<string, ClaimIn[]>()
  for (const chunk of chunked([...claimSubjects], CHUNK)) {
    if (!chunk.length) continue
    const rows = await query(
      `UNWIND $uris AS u
       MATCH (a:Media)-[c:CLAIMS]->(b:Media {uri: u})
       WHERE c.kind = 'SAME_AS' AND c.provenance <> 'address'
       RETURN DISTINCT u AS target, a.uri AS claimant, c.claimer AS claimer ORDER BY target, claimant, claimer`,
      { uris: chunk }
    )
    for (const row of rows) {
      const target = String(row.target)
      const list = claimsInto.get(target) ?? []
      list.push({ claimant: String(row.claimant), claimer: String(row.claimer) })
      claimsInto.set(target, list)
    }
  }

  // (1, 2, 7, 8, 9) one profile read over every uri a verdict can name: the endpoints, every member
  // of their components and every claimant guard 5 will weigh
  const profileSubjects = new Set(endpoints)
  for (const uri of endpoints) {
    for (const member of components.membersOf(uri)) profileSubjects.add(member)
    for (const claim of claimsInto.get(uri) ?? []) {
      profileSubjects.add(claim.claimant)
      for (const member of components.membersOf(claim.claimant)) profileSubjects.add(member)
    }
  }
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

  // (6) the containment edges already joining a pair, the query of 3.5 with the one exclusion the
  // writer's own downgrade forces (see DOWNGRADE_REASONS)
  const contained = new Set<string>()
  const pairs = subjects.map(subject => ({ a: subject.fromUri, b: subject.toUri }))
  for (const chunk of chunked(pairs, CHUNK)) {
    if (!chunk.length) continue
    const rows = await query(
      `UNWIND $pairs AS p
       MATCH (a:Media {uri: p.a})-[l:LINK {status: 'active'}]-(b:Media {uri: p.b})
       WHERE l.kind IN ['PART_OF', 'INCLUDES']
       RETURN DISTINCT p.a AS a, p.b AS b, l.reason AS reason`,
      { pairs: chunk }
    )
    for (const row of rows) {
      if (DOWNGRADE_REASONS.has(String(row.reason))) continue
      contained.add(pairKey(String(row.a), String(row.b)))
    }
  }

  const profileOf = (uri: string): ProfileFacts => profiles.get(uri) ?? unknownProfile(uri)
  const parentOf = (uri: string): string | null => profiles.get(uri)?.idParent ?? null

  /**
   * The rows that are the ONLY thing holding two or more of their own claimants in one component.
   *
   * GUARD 4 HAS TO KNOW THESE, or it decides by arrival order. Guard 4 refuses a proposal that would
   * ADD a disagreement to a component, and a contested target puts every one of its claimants into
   * one component, so a row that arrives afterwards is measured against a membership that guard 5 is
   * going to retract. Whichever of the two arrives first then wins: the whole point of guard 5 is
   * that neither should (5.2, and `plugins/arrival-order.test.ts`).
   *
   * Its own set rather than a flag on the verdict, because guard 4 asks about a row that is not one
   * of the pair it is weighing and may not be an endpoint of any pair in this batch.
   */
  const contested = new Set<string>()
  for (const [target, claims] of claimsInto) {
    const claimants = [...new Set(claims.map(claim => claim.claimant))].filter(uri => uri !== target).sort()
    if (claimants.length < 2) continue
    // NOT "a disagreement is already visible", which is the version that does not work: at the moment
    // guard 4 asks, the disagreement is usually contingent on the very link it is about to refuse.
    // The test is whether the target is the ONLY thing holding its claimants together, since that is
    // exactly when a membership read through it is evidence about the target rather than about them.
    const view = components.without(target)
    const keys = new Set(claimants.map(uri => view.keyOf(uri)))
    if (keys.size > 1) contested.add(target)
  }

  return {
    profileOf,
    components,
    sameAs: subject => sameAsVerdict(subject, { profileOf, parentOf, components, claimsInto, addressKeys, contained, contested }),
    partOf: (part, whole) => partOfVerdict(part, whole, profileOf),
  }
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

/** How the writer builds one batch of verdicts. `prepareGuards` is the only one that reads a rule. */
export type GuardsFactory = (query: GuardQuery, subjects: SameAsSubject[]) => Promise<GuardPass>

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
  components: {
    keyOf: uri => uri,
    membersOf: uri => [uri],
    without: () => ({ keyOf: uri => uri, membersOf: uri => [uri] }),
  },
})

type Facts = {
  profileOf: (uri: string) => ProfileFacts
  parentOf: (uri: string) => string | null
  components: Components
  claimsInto: Map<string, ClaimIn[]>
  addressKeys: Set<string>
  contained: Set<string>
  /** The rows two disagreeing claimants both claim to BE. Guard 4 does not weigh through one. */
  contested: Set<string>
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

  // 4. disagreeing-ids (anomalies.ts:18-25, similar-consumer.ts:239-245). Evaluated against the graph
  // as it stands: the target's current active SAME_AS component is what the union is tested against.
  //
  // A pair already in ONE component is NOT refused here, and that is the difference between a guard
  // and a cycle: the disagreement it would report is not one this proposal adds, the rule is about
  // what the union WOULD put together, and refusing every link of a component whose ids disagree
  // empties the component, which passes the same guard on the next iteration and welds it back. The
  // shape that must retract is two claimants into one row, and guard 5 catches that over CLAIMS,
  // where no link status can move it. The standing disagreement is reported by 5.5 instead.
  // THE CONTESTED ROWS ARE CUT OUT of both sides first. A component that only holds together through
  // a row two disagreeing claimants both claim is a component guard 5 is about to take apart, so a
  // disagreement measured across it is one this proposal does not add.
  const settled = facts.contested.size ? facts.components.without(facts.contested) : facts.components
  const membersA = settled.membersOf(a.uri)
  const membersB = settled.membersOf(b.uri)
  if (settled.keyOf(a.uri) !== settled.keyOf(b.uri)) {
    const straddle = straddlingDisagreement(membersA, membersB, facts.parentOf)
    if (straddle) {
      const [ours, theirs] = straddle
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
  }

  // 5. contested (NEW as a store rule): two or more components hold consumed SAME_AS claims into one
  // target and disagree with each other by guard 4. Every such proposal is refused and downgraded,
  // and the active link among them is retracted, because every pass re-proposes it and meets this.
  for (const target of [b, a]) {
    const other = target === a ? b : a
    const claimants = [...new Set((facts.claimsInto.get(target.uri) ?? []).map(claim => claim.claimant))]
      .filter(uri => uri !== target.uri)
      .sort()
    if (claimants.length < 2) continue
    const contesting = facts.components.without(target.uri)
    const otherKey = contesting.keyOf(other.uri)
    for (let i = 0; i < claimants.length; i += 1) {
      for (let j = i + 1; j < claimants.length; j += 1) {
        const left = contesting.membersOf(claimants[i]!)
        const right = contesting.membersOf(claimants[j]!)
        if (contesting.keyOf(claimants[i]!) === contesting.keyOf(claimants[j]!)) continue
        const straddle = straddlingDisagreement(left, right, facts.parentOf)
        if (!straddle) continue
        // this proposal is one of the contesting claims only when its other end is one of the two
        // components: a third row that agrees with neither is refused on its own evidence, not here
        const ourSideIsLeft = contesting.keyOf(claimants[i]!) === otherKey
        const ourSideIsRight = contesting.keyOf(claimants[j]!) === otherKey
        if (!ourSideIsLeft && !ourSideIsRight) continue
        const evidence = {
          theirs: ourSideIsLeft ? straddle[1] : straddle[0],
          ours: ourSideIsLeft ? straddle[0] : straddle[1],
        }
        return {
          ok: false,
          reason: 'contested',
          write: true,
          evidence,
          downgrade: downgradeTo(target, other, 'contested', evidence),
        }
      }
    }
  }

  // 6. contained (the owner's rule, 3.5): the containment edge already exists, so the downgrade is a
  // no-op and none is written
  if (facts.contained.has(pairKey(a.uri, b.uri))) {
    return { ok: false, reason: 'contained', write: true, evidence: { theirs: b.uri, ours: a.uri } }
  }

  // 7. count-mismatch (foldVetoed, similar.ts:147-150). The run side's length is `Cluster.runLength`,
  // the witnessed figure of 5.4 P5, and its own profile count only where no cluster holds it yet
  // (`runSideLength`). The folding side is weighed on its OWN count, because the whole question is
  // what that one packaging claims.
  const folding = a.folding && b.folding ? containerSideOf(a, b) : a.folding ? a : b.folding ? b : null
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

  return { ok: true }
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
