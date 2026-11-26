import type { Refusal } from './contract'
import { PER_RUN_ORIGINS, SEASON_SCOPED_ORIGINS } from './sameness'
import { componentsOf, pairKey, type Components } from './union-find'

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

export const asBoolean = (value: unknown): boolean => value === true
export const asText = (value: unknown): string | null => typeof value === 'string' && value ? value : null
export const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))
export const idOf = (uri: string): string => uri.slice(uri.indexOf(':') + 1)

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

export const unknownProfile = (uri: string): ProfileFacts => ({
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
export const straddlingDisagreement = (
  left: string[],
  right: string[],
  parentOf: (uri: string) => string | null,
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

/** One consumed `SAME_AS` claim into a row: who made it, and from which row. */
export type ClaimIn = { claimant: string, claimer: string }

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

export const toProfileFacts = (uri: string, row?: ProfileRow): ProfileFacts =>
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

/** How long the RUN side is, as guard 7 weighs it: the cluster's witnessed length, else its own count. */
export const runSideLength = (facts: ProfileFacts): number | null => facts.clusterRunLength ?? countOf(facts)

export const containerSideOf = (a: ProfileFacts, b: ProfileFacts): ProfileFacts => {
  if (a.scope !== b.scope) return a.scope === 'CONTAINER' ? a : b
  const countA = countOf(a)
  const countB = countOf(b)
  if (countA !== null && countB !== null && countA !== countB) return countA > countB ? a : b
  if (a.showLevelOrigin !== b.showLevelOrigin) return a.showLevelOrigin ? a : b
  return a.uri > b.uri ? a : b
}

export const downgradeTo = (
  whole: ProfileFacts,
  part: ProfileFacts,
  reason: Refusal,
  evidence: { theirs: unknown, ours: unknown },
): Downgrade => ({ fromUri: part.uri, toUri: whole.uri, reason, evidence })

export const disagreeingVerdict = (
  a: ProfileFacts,
  b: ProfileFacts,
  ours: string,
  theirs: string,
): SameAsVerdict => {
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

const weighClaimants = (leftUri: string, rightUri: string, target: string, ledger: ContestLedger) => {
  const contesting = ledger.components.without(sharedCut(leftUri, rightUri, target, ledger.claims))
  if (contesting.keyOf(leftUri) === contesting.keyOf(rightUri)) return undefined
  const left = contesting.membersOf(leftUri)
  const right = contesting.membersOf(rightUri)
  const straddle = straddlingDisagreement(left, right, ledger.parentOf)
  if (!straddle) return undefined
  const own = [target, ...ledger.ownClaims.get(target) ?? []].filter(row =>
    left.some(uri => identitySpaceOf(uri) === identitySpaceOf(row))
    && right.some(uri => identitySpaceOf(uri) === identitySpaceOf(row)))
  const holds = (side: string[], row: string) => side.some(uri => identityOf(uri) === identityOf(row))
  const settledLeft = own.length > 0 && own.every(row => holds(left, row))
  const settledRight = own.length > 0 && own.every(row => holds(right, row))
  return { contesting, left, right, straddle, settledLeft, settledRight }
}

/**
 * Whether `site` is held in an unsettled contest by a claimant sitting on `side` against a rival
 * outside `side`. Non-recursive by design so healthy multi-claimant hubs cannot cascade across neighbors.
 */
const unsettledWithSide = (site: string, side: string[], ledger: ContestLedger): boolean => {
  if (!ledger.conflictSites.has(site)) return false
  const claimants = [...new Set((ledger.claimsInto.get(site) ?? []).map(claim => claim.claimant))]
    .filter(uri => uri !== site && !ledger.refused4.has(pairKey(uri, site)))
    .sort(compare)
  if (claimants.length < 2) return false
  const sideSet = new Set(side)
  for (const claimant of claimants) {
    if (!sideSet.has(claimant)) continue
    let refuted = false
    let unsettled = false
    for (const rival of claimants) {
      if (rival === claimant || sideSet.has(rival)) continue
      const weighed = weighClaimants(claimant, rival, site, ledger)
      if (!weighed) continue
      if (weighed.settledRight) {
        refuted = true
        break
      }
      if (!weighed.settledLeft) unsettled = true
    }
    if (unsettled && !refuted) return true
  }
  return false
}

export const contestVerdict = (aUri: string, bUri: string, ledger: ContestLedger): SameAsVerdict | undefined => {
  for (const [target, other] of [[bUri, aUri], [aUri, bUri]] as const) {
    if (!ledger.conflictSites.has(target)) continue
    const claimants = [...new Set((ledger.claimsInto.get(target) ?? []).map(claim => claim.claimant))]
      .filter(uri => uri !== target)
      .sort(compare)
    if (claimants.length < 2) continue
    for (let i = 0; i < claimants.length; i += 1) {
      for (let j = i + 1; j < claimants.length; j += 1) {
        const weighed = weighClaimants(claimants[i]!, claimants[j]!, target, ledger)
        if (!weighed) continue
        const { contesting, left, right, straddle, settledLeft, settledRight } = weighed
        const otherKey = contesting.keyOf(other)
        let ourSideIsLeft = contesting.keyOf(claimants[i]!) === otherKey
        let ourSideIsRight = contesting.keyOf(claimants[j]!) === otherKey
        if (!ourSideIsLeft && !ourSideIsRight) {
          const otherMembers = contesting.membersOf(other)
          const onLeft = otherMembers.some(uri => unsettledWithSide(uri, left, ledger))
          const onRight = otherMembers.some(uri => unsettledWithSide(uri, right, ledger))
          if (onLeft === onRight) continue
          ourSideIsLeft = onLeft
          ourSideIsRight = onRight
        }
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
export const postSettlementVerdict = (
  a: ProfileFacts,
  b: ProfileFacts,
  contained: ReadonlySet<string>,
): SameAsVerdict | undefined => {
  if (contained.has(pairKey(a.uri, b.uri))) {
    return { ok: false, reason: 'contained', write: true, evidence: { theirs: b.uri, ours: a.uri } }
  }

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

/**
 * Settle guards 4 and 5 jointly from `profiles` and `rows` (`CLAIMS`), with no `LINK` status input.
 */
export const settleLedger = (
  profiles: ReadonlyMap<string, ProfileRow>,
  rows: readonly ClaimRow[],
  contained: ReadonlySet<string> = new Set(),
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

/** Reads `MediaProfile`, `Media.status`, `Cluster.runLength`, and non-address `SAME_AS` claims into a settled ledger. */
export const buildLedger = async (query: GuardQuery, contained: ReadonlySet<string>): Promise<ContestLedger> => {
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
