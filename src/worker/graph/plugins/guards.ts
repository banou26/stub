/**
 * The nine guards of 5.2, the downgrade they write instead, and the `partOf` guards beside them.
 *
 * Union-find logic lives in `./union-find.ts` and joint Guard 4/5 claim settlement lives in
 * `./ledger.ts`; this module caches the per-epoch snapshots, builds batches for `./writer.ts`,
 * and re-exports every public type and helper.
 */
import { onGraphWrite } from '../engine'

import type { Refusal } from './contract'
import {
  DOWNGRADE_REASONS,
  asBoolean,
  asNumber,
  asText,
  buildLedger,
  contestVerdict,
  countOf,
  disagree,
  disagreeingVerdict,
  downgradeTo,
  identityOf,
  identitySpaceOf,
  originOf,
  postSettlementVerdict,
  runSideLength,
  settleLedger,
  straddlingDisagreement,
  toProfileFacts,
  unknownProfile,
  type ClaimRow,
  type ContestLedger,
  type Downgrade,
  type Guard4Refusal,
  type GuardQuery,
  type PartOfVerdict,
  type ProfileFacts,
  type ProfileRow,
  type SameAsSubject,
  type SameAsVerdict,
} from './ledger'
import { apart, componentsOf, pairKey, type Components } from './union-find'

export type {
  ClaimRow,
  Components,
  ContestLedger,
  Downgrade,
  Guard4Refusal,
  GuardQuery,
  PartOfVerdict,
  ProfileFacts,
  ProfileRow,
  SameAsSubject,
  SameAsVerdict,
}
export {
  DOWNGRADE_REASONS,
  apart,
  countOf,
  disagree,
  identityOf,
  identitySpaceOf,
  pairKey,
  runSideLength,
  settleLedger,
}

/** The guards in the order 5.2 states them. Exported so a test walks the rule rather than a list. */
export const SAME_AS_GUARDS = [
  'unknown-scope', 'cross-scope', 'address-only', 'disagreeing-ids', 'contested',
  'contained', 'count-mismatch', 'no-length', 'kind-mismatch',
] as const satisfies readonly Refusal[]

type ContainedInfo = { keys: Set<string>, key: string }
type ActiveSnapshot = {
  components: Components
  edges: [string, string][]
  contained: ContainedInfo
  filteredActive: WeakMap<ContestLedger, Components>
}

const LEDGER_TABLES = new Set(['CLAIMS', 'MediaProfile', 'Media', 'Cluster', 'MEMBER_OF'])
const MAX_LEDGER_CACHE_KEYS = 2

let componentsEpoch = 0
let activeCache: { epoch: number, value: ActiveSnapshot } | undefined
let ledgerEpoch = 0
let ledgerCache: { epoch: number, byKey: Map<string, ContestLedger> } | undefined
let componentsLive = false

/** Called by the writer after it writes, and by the ingest's events. The next read is fresh. */
export const invalidateComponents = (_cypher?: string, tables?: ReadonlySet<string>): void => {
  componentsEpoch += 1
  activeCache = undefined
  const affectsLedger = tables ? [...tables].some(table => LEDGER_TABLES.has(table)) : true
  if (affectsLedger) {
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
    filteredActive: new WeakMap(),
  }
  if (componentsEpoch === epoch) activeCache = { epoch, value: built }
  return built
}

const activeForLedger = (activeSnap: ActiveSnapshot, ledger: ContestLedger): Components => {
  if (!ledger.refused.size) return activeSnap.components
  let filtered = activeSnap.filteredActive.get(ledger)
  if (!filtered) {
    filtered = componentsOf(activeSnap.edges.filter(([a, b]) => !ledger.refused.has(pairKey(a, b))))
    activeSnap.filteredActive.set(ledger, filtered)
  }
  return filtered
}

export const readComponents = async (query: GuardQuery): Promise<Components> =>
  (await readActiveSnapshot(query)).components

/** Read and cache the joint claim-settled guard ledger for the current claim and profile epoch. */
export const readLedger = async (
  query: GuardQuery,
  contained: ContainedInfo = { keys: new Set(), key: '' },
): Promise<ContestLedger> => {
  watchWrites()
  if (ledgerCache && ledgerCache.epoch === ledgerEpoch) {
    const cached = ledgerCache.byKey.get(contained.key)
    if (cached) return cached
  }
  const epoch = ledgerEpoch
  const built = await buildLedger(query, contained.keys)
  if (ledgerEpoch === epoch) {
    if (!ledgerCache || ledgerCache.epoch !== epoch) ledgerCache = { epoch, byKey: new Map() }
    if (!ledgerCache.byKey.has(contained.key) && ledgerCache.byKey.size >= MAX_LEDGER_CACHE_KEYS) {
      const oldest = ledgerCache.byKey.keys().next().value
      if (oldest !== undefined) ledgerCache.byKey.delete(oldest)
    }
    ledgerCache.byKey.set(contained.key, built)
  }
  return built
}

/**
 * Checks whether a cross-origin `SAME_AS` pair previously refused for `disagreeing-ids` or `contested`
 * would still be refused under the current warm settlement ledger and active component snapshot.
 */
export const filterFlippedRefusals = async (
  query: GuardQuery,
  pairs: readonly { fromUri: string, toUri: string }[],
): Promise<string[]> => {
  if (pairs.length === 0) return []
  const activeSnap = await readActiveSnapshot(query)
  const ledger = await readLedger(query, activeSnap.contained)
  const active = activeForLedger(activeSnap, ledger)
  const contested = ledger.contested
  const flipped: string[] = []
  for (const { fromUri, toUri } of pairs) {
    let refused = false
    for (const relation of [ledger.components, active]) {
      const settled = contested.size ? relation.without(contested) : relation
      if (settled.keyOf(fromUri) === settled.keyOf(toUri)) continue
      if (straddlingDisagreement(settled.membersOf(fromUri), settled.membersOf(toUri), ledger.parentOf)) {
        refused = true
        break
      }
    }
    if (!refused && (contestVerdict(fromUri, toUri, ledger) || ledger.refused4.has(pairKey(fromUri, toUri)))) {
      refused = true
    }
    if (!refused) flipped.push(fromUri, toUri)
  }
  return flipped
}

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

/** Read everything the nine guards need for `subjects`, then answer each of them without a round trip. */
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
  const active = activeForLedger(activeSnap, ledger)

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
      profiles.set(uri, toProfileFacts(uri, {
        origin: asText(row.origin) ?? originOf(uri),
        scope: asText(row.scope),
        idParent: asText(row.idParent),
        folding: asBoolean(row.folding),
        countStated: asNumber(row.countStated),
        countDistinct: asNumber(row.countDistinct),
        format: asText(row.format),
        showLevelOrigin: asBoolean(row.showLevelOrigin),
        status: asText(row.status),
      }))
    }
  }

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

export type GuardsFactory = (query: GuardQuery, subjects: SameAsSubject[]) => Promise<GuardPass>

export const acceptEveryPair: GuardsFactory = async () => ({
  profileOf: uri => unknownProfile(uri),
  components: apart,
  sameAs: () => ({ ok: true }),
  partOf: () => ({ ok: true }),
})

type Facts = {
  profileOf: (uri: string) => ProfileFacts
  parentOf: (uri: string) => string | null
  active: Components
  ledger: ContestLedger
  addressKeys: Set<string>
  contained: Set<string>
}

const sameAsVerdict = (subject: SameAsSubject, facts: Facts): SameAsVerdict => {
  const a = facts.profileOf(subject.fromUri)
  const b = facts.profileOf(subject.toUri)

  if (a.scope === null || b.scope === null) {
    return {
      ok: false,
      reason: 'unknown-scope',
      write: false,
      evidence: { theirs: b.scope, ours: a.scope },
    }
  }

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

  const address = subject.supports.filter(key => facts.addressKeys.has(key))
  if (address.length) {
    return { ok: false, reason: 'address-only', write: true, evidence: { theirs: address, ours: subject.supports } }
  }

  const contested = facts.ledger.contested
  for (const relation of [facts.ledger.components, facts.active]) {
    const settled = contested.size ? relation.without(contested) : relation
    if (settled.keyOf(a.uri) === settled.keyOf(b.uri)) continue
    const straddle = straddlingDisagreement(settled.membersOf(a.uri), settled.membersOf(b.uri), facts.parentOf)
    if (straddle) return disagreeingVerdict(a, b, straddle[0], straddle[1])
  }

  const contest = contestVerdict(a.uri, b.uri, facts.ledger)
  if (contest) return contest

  const refused4 = facts.ledger.refused4.get(pairKey(a.uri, b.uri))
  if (refused4) {
    const [ours, theirs] = a.uri === refused4.from ? [refused4.ours, refused4.theirs] : [refused4.theirs, refused4.ours]
    return disagreeingVerdict(a, b, ours, theirs)
  }

  return postSettlementVerdict(a, b, facts.contained) ?? { ok: true }
}

/**
 * The `partOf` guards (5.2): `unknown-scope`, `self` and `inverted`.
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
