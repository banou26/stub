/**
 * Six of the anomaly rules of 5.5, as rules and nothing else.
 *
 * A rule here needs NO EXPECTED ANSWER: it reads the graph after a pass and says what disagrees with
 * itself. `disagreeing-ids` and `contested` read what the guards of 5.2 already decided, so the two
 * cannot drift apart; `kind-disagrees` and `constant-id` read the source tables directly, because
 * both are properties of what the sources said rather than of what a rule concluded. `over-length` and
 * `count-disagrees` are the two that read a COUNT: the first weighs what a page would draw against
 * what the sources voted, the second is one source disagreeing with its own list.
 *
 * THE REPORTING SURFACE. 5.5 writes these to `Cluster.anomalies` with `anomalyCount` and the trace
 * panel prints them (7.5); `plugin:aggregate` reads every rule here once per pass and files each
 * finding under the clusters holding the uris it names. Every rule ships with a control fixture that
 * must report zero, so a rule that cannot fire in its failure state is caught by its own test (5.5's
 * own words).
 */
import type { GuardQuery } from './guards'

import { formatOf } from './profile'
import { identitySpaceOf, prefixRelated, readComponents } from './guards'

/** One finding: the rule that fired, a line a human reads, and the rows it names. */
export type Anomaly = { rule: string, detail: string, uris: string[] }

const parseJson = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}


/**
 * `disagreeing-ids`: two ids of one origin inside one component that are not one id at two
 * precisions (`anomalies.ts:18-25`, one-way at `:38` so `[A, A-1, A-2]` reports).
 *
 * The component is the closure of 3.5 over active `SAME_AS`, which is what a cluster will be, so the
 * rule does not wait for `plugin:aggregate` to have an answer. The refused links of that reason are
 * reported beside it: a guard that FIRED is the same fact caught one step earlier, and a reader
 * wanting to know why a row is not in a cluster needs the refusal as much as the weld.
 */
export const disagreeingIds = async (query: GuardQuery): Promise<Anomaly[]> => {
  const components = await readComponents(query)
  const rows = await query('MATCH (p:MediaProfile) RETURN p.uri AS uri, p.idParent AS idParent')
  const parents = new Map<string, string | null>()
  for (const row of rows) parents.set(String(row.uri), typeof row.idParent === 'string' ? row.idParent : null)
  const parentOf = (uri: string): string | null => parents.get(uri) ?? null

  const found: Anomaly[] = []
  const seen = new Set<string>()
  for (const uri of parents.keys()) {
    const key = components.keyOf(uri)
    if (seen.has(key)) continue
    seen.add(key)
    const members = components.membersOf(uri)
    if (members.length < 2) continue
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i]!
        const b = members[j]!
        // THE IDENTITY SPACE, which is the guards' own test and not the origin. This file's header
        // says 5.5 reads what 5.2 already decided "so the two cannot drift apart", and the origin is
        // exactly where they drifted: `offline` borrows its ids, so two offline rows disagree only
        // when they borrow from the same catalogue. Measured on the recorded page 2026-09-14, this
        // reported 21 `disagreeing-ids` of which 18 were offline pairs the guards accept as one row
        // under two addresses, so the store called a defect the thing it had just been taught to allow.
        if (identitySpaceOf(a) !== identitySpaceOf(b)) continue
        if (prefixRelated(a, b, parentOf)) continue
        found.push({
          rule: 'disagreeing-ids',
          detail: `${a} and ${b} are two ids of ${identitySpaceOf(a)} in one component, and neither extends the other`,
          uris: [...members],
        })
      }
    }
  }

  const refused = await query(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.status = 'refused' AND l.reason = 'disagreeing-ids'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.evidence AS evidence ORDER BY fromUri, toUri`
  )
  for (const row of refused) {
    found.push({
      rule: 'disagreeing-ids',
      detail: `${String(row.fromUri)} was refused sameness with ${String(row.toUri)}: ${String(row.evidence ?? '{}')}`,
      uris: [String(row.fromUri), String(row.toUri)],
    })
  }
  return found
}

/**
 * `contested`: a target refused to two components under guard 5, both claimants named
 * (`nf:81091393-3` holding two Demon Slayer runs of eleven episodes each, 2026-09-04).
 *
 * Read off the DOWNGRADE, which is where the direction lives: every `PART_OF {reason: 'contested'}`
 * points at the shared row, so grouping by its target names the row and its claimants at once.
 */
export const contested = async (query: GuardQuery): Promise<Anomaly[]> => {
  const rows = await query(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.kind = 'PART_OF' AND l.status = 'active' AND l.reason = 'contested'
     RETURN b.uri AS target, a.uri AS claimant ORDER BY target, claimant`
  )
  const byTarget = new Map<string, string[]>()
  for (const row of rows) {
    const target = String(row.target)
    byTarget.set(target, [...new Set([...byTarget.get(target) ?? [], String(row.claimant)])])
  }
  return [...byTarget]
    .filter(([, claimants]) => claimants.length >= 2)
    .map(([target, claimants]) => ({
      rule: 'contested',
      detail: `${target} is claimed by ${claimants.length} components that disagree: ${claimants.join(', ')}`,
      uris: [target, ...claimants],
    }))
}

/**
 * `kind-disagrees`: one uri whose ANSWERS disagree about MOVIE against SERIES (`tmdb:550` is Fight
 * Club as a film and Till Death Us Do Part as a series, 2026-09-04).
 *
 * Read per ANSWER rather than off the profile, and that is the whole rule: the profile is silent when
 * a row's own fields disagree (5.4 P0 writes NULL rather than picking one), so a reading of the
 * profile alone would report nothing exactly where the disagreement is.
 */
export const kindDisagrees = async (query: GuardQuery): Promise<Anomaly[]> => {
  const rows = await query(
    `MATCH (a:Answer)-[:ABOUT]->(m:Media) WHERE a.kind = 'media'
     RETURN m.uri AS uri, a.origin AS origin, a.raw AS raw ORDER BY uri, a.seq`
  )
  const formats = new Map<string, Map<string, string[]>>()
  for (const row of rows) {
    const raw = parseJson(row.raw)
    const format = formatOf(raw.type, raw.categories)
    if (!format) continue
    const uri = String(row.uri)
    const seen = formats.get(uri) ?? new Map<string, string[]>()
    seen.set(format, [...new Set([...seen.get(format) ?? [], String(row.origin)])])
    formats.set(uri, seen)
  }
  const found: Anomaly[] = []
  for (const [uri, seen] of [...formats].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (seen.size < 2) continue
    const detail = [...seen].map(([format, origins]) => `${format} from ${origins.join(', ')}`).join(' against ')
    found.push({ rule: 'kind-disagrees', detail: `${uri} is ${detail}`, uris: [uri] })
  }
  return found
}

/** The threshold of 5.5: two claimants is a contest, three is never right. */
export const CONSTANT_ID_CLAIMANTS = 3

/**
 * `constant-id`: one target uri claimed `SAME_AS` by three or more distinct CLAIMANTS, before
 * membership is considered (`hbo:watch` on 25 titles, `anidb:animedb.pl` on every record with a
 * missing `aid`, 2026-09-04).
 *
 * Counted over claimants and never over clusters, because a constant that welded its claimants leaves
 * ONE cluster and a cluster count is silent exactly then (f096e7d, a4eea19).
 */
export const constantId = async (query: GuardQuery): Promise<Anomaly[]> => {
  const rows = await query(
    `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
     WHERE c.kind = 'SAME_AS' AND c.provenance <> 'address'
     RETURN b.uri AS target, count(DISTINCT a.uri) AS claimants ORDER BY target`
  )
  return rows
    .filter(row => Number(row.claimants) >= CONSTANT_ID_CLAIMANTS)
    .map(row => ({
      rule: 'constant-id',
      detail: `${String(row.target)} is claimed the same as ${Number(row.claimants)} distinct rows`,
      uris: [String(row.target)],
    }))
}

/**
 * `over-length`: a cluster draws more slots than its own `runLength`, with the witnesses recounted
 * (`anomalies.ts:49-59`, the detail line kept word for word).
 *
 * It is read off the SLOTS rather than off the member rows, because a slot is what a page renders
 * (6.4) and the trim of 5.4 P5 sits between the two: a member numbered beyond the length that the
 * trim spared is exactly what this has to report. Unnumbered slots (anizip's `S1`) are not beyond
 * anything and are not counted, which is the same rule `trimsRow` keeps for them.
 *
 * The count it reads is the previous iteration's, since `plugin:aggregate` calls this before it
 * writes the slots of this one. That costs the rule one iteration on a first pass and nothing after,
 * and the pass's own fixed point is what carries it (5.3).
 */
export const overLength = async (query: GuardQuery): Promise<Anomaly[]> => {
  // the numbered slots per cluster, counted in JS: `listed` is the whole list and the test is on its
  // HIGHEST number, which is two aggregations over one group that no measured spelling covers
  const rows = await query(
    `MATCH (s:Slot)-[:SLOT_OF]->(c:Cluster)
     WHERE s.number IS NOT NULL AND c.runLength IS NOT NULL
     RETURN c.id AS cluster, c.runLength AS runLength, c.runLengthWitnesses AS witnesses,
       s.number AS number ORDER BY cluster, number`
  )
  const counted = new Map<string, { length: number, witnesses: number, listed: number, highest: number }>()
  for (const row of rows) {
    const cluster = String(row.cluster)
    const number = Number(row.number)
    const entry = counted.get(cluster)
      ?? { length: Number(row.runLength), witnesses: Number(row.witnesses ?? 0), listed: 0, highest: 0 }
    entry.listed += 1
    entry.highest = Math.max(entry.highest, number)
    counted.set(cluster, entry)
  }

  const found: Anomaly[] = []
  for (const [cluster, entry] of counted) {
    if (entry.highest <= entry.length) continue
    const members = await query(
      'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $id}) RETURN m.uri AS uri ORDER BY uri',
      { id: cluster }
    )
    found.push({
      rule: 'over-length',
      detail: `${entry.listed} listed against a length of ${entry.length} that ${entry.witnesses} of its sources agree on`,
      uris: members.map(member => String(member.uri)),
    })
  }
  return found
}

/**
 * `count-disagrees`: a row whose own list contradicts its own figure (netflixid 80198505 season 3,
 * 14 rows over 10 epids, 2026-09-10).
 *
 * `countDistinct` is `count(DISTINCT HAS_EPISODE targets)` and `countStated` is the source's own
 * number (2.2), so a difference between them is the source disagreeing with itself rather than two
 * sources disagreeing. It is what withholds a `position` row's button in 5.4 P5, and the rule is here
 * so the withholding is visible as a reason rather than as a missing button.
 *
 * `distinct` is a RESERVED WORD as a column alias on this engine (0.20.4, 2026-09-12): `AS distinct`
 * dies with a parser exception naming every keyword it expected instead, which reads as a broken
 * statement rather than as a name collision.
 */
export const countDisagrees = async (query: GuardQuery): Promise<Anomaly[]> => {
  const rows = await query(
    `MATCH (p:MediaProfile)
     WHERE p.countStated IS NOT NULL AND p.countDistinct IS NOT NULL AND p.countStated <> p.countDistinct
     RETURN p.uri AS uri, p.countStated AS stated, p.countDistinct AS listed ORDER BY uri`
  )
  return rows.map(row => ({
    rule: 'count-disagrees',
    detail: `${String(row.uri)} states ${Number(row.stated)} episodes and lists ${Number(row.listed)} distinct ones`,
    uris: [String(row.uri)],
  }))
}

/** Every rule in this file, run in one go. */
export const readAnomalies = async (query: GuardQuery): Promise<Anomaly[]> => [
  ...await disagreeingIds(query),
  ...await contested(query),
  ...await kindDisagrees(query),
  ...await constantId(query),
  ...await overLength(query),
  ...await countDisagrees(query),
]
