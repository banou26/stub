/**
 * `plugin:direct`, P1 of 5.4: the claims a SOURCE made, turned into proposals and edges.
 *
 * It decides nothing about similarity. Every row it emits is one `CLAIMS` edge read through the
 * derivation table of `db.ts:166-169`, kept verbatim, plus the same-origin rule and the fenced
 * `INCLUDES`; the union-by-id pairs (mal, anilist, kitsu, anizip, offline, simkl agree by first-party
 * ids) need no matching at all. `supports` is the claim's own key, so a trace descends from the link
 * to the claim and from there to the `Answer` that carried it.
 *
 * WHAT IT PROMISES. Same graph, same output: the scan is ordered, the decision is a pure function of
 * the claim and the two profiles, and nothing here reads a clock, a score or another plugin's link.
 * Whether a `SAME_AS` proposal becomes an edge is not its call: the writer's guards decide, a refusal
 * is written with its reason, and six of the nine refusals write the containment edge instead (5.2).
 *
 * ITS FAILURE MODE, stated because it is the reason guards 4 and 5 exist. A per-run origin that is
 * show-level for a MINORITY of its ids welds two runs the moment both claim it: `mal:51535` sits on
 * both Attack on Titan Final Chapters parts, while `idMal` is per-run for about 99.7% of ids and
 * blocking `mal` outright would cost 3,184 correct merges (2026-09-01). The guards catch it when the
 * two parts' own anilist and kitsu ids meet, and both sides downgrade (8.6). Two wrong `SAME_AS`
 * between rows whose origins never disagree still weld, as today; the weld is an edge with a
 * `supports` list, deletable, and reported the moment a later id disagrees.
 */
import type { LinkProposal, Plugin, PluginContext, PluginOutput } from './contract'

import { claimEndpoints } from './profile'

/**
 * How much of the table a delta may name before the whole-graph scan is the cheaper one.
 *
 * A scoped scan is two keyed lookups PER SUBJECT and the whole-graph form is one statement, so a
 * delta naming most of the table is both cheaper and more honestly described as a full pass. Measured
 * on the 800 recorded rows of one real page, 2026-09-12: the by-uri form over ~778 subjects cost
 * 1,534 to 1,632 ms per iteration against 326 to 358 ms whole-graph, and the page's ingest ran 17.5 s
 * with the scoped form against 13.7 s with the whole-graph one. That is a crossover near a quarter of
 * the table, which is what this is.
 */
const WHOLE_GRAPH_FRACTION = 4

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const DIRECT_VERSION = 1

/** One row of the candidate scan of 5.4 P1: a claim and the two profiles the table reads. */
export type Candidate = {
  fromUri: string
  toUri: string
  fromOrigin: string
  toOrigin: string
  kind: string
  claimer: string
  provenance: string
  claimKey: string
  fromScope: string | null
  toScope: string | null
  fromParent: string | null
  toParent: string | null
}

const asText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/**
 * The candidate scan of 5.4 P1, verbatim, in its whole-graph form and its keyed form.
 *
 * A SCOPED run reads EVERY claim at every subject uri, in both directions, rather than the claims the
 * delta named. That is not thrift, it is the invariant: the scope this run declares is its subjects,
 * so the writer may retract any `LINK` with a subject at either end, and a run that read one claim at
 * a uri and re-derived one link would have the writer delete every other link that uri carries.
 * Reading by uri also covers the second consumer, `MediaProfile`: every decision below reads the
 * effective scope and the id parent off the two profiles, so a claim whose key never moved still has
 * to be re-decided when a profile at either end did.
 *
 * THE PROFILES ARE A SECOND STATEMENT, joined in JS, and only in the scoped form. Measured on the 800
 * recorded rows of one page, 2026-09-12: the claim read and the two `PROFILE_OF` joins in ONE
 * `UNWIND` statement cost 545 ms for 28 subjects, about 19 ms per subject, against 326 ms for the
 * whole-graph form over every claim in the graph. Split, the same 28 subjects cost single-digit ms.
 * It is the same reason `plugin:profile`'s own scan is one statement per relation: an `UNWIND` whose
 * MATCH carries three patterns multiplies before it aggregates.
 *
 * The two directions are merged on the claim key, which is unique (2.1), and the merged rows are
 * sorted back into the order each read was asked in.
 */
const scan = async (ctx: PluginContext, uris: string[] | undefined): Promise<Candidate[]> => {
  const claimColumns = `RETURN a.uri AS fromUri, b.uri AS toUri, a.origin AS fromOrigin, b.origin AS toOrigin,
       c.kind AS kind, c.claimer AS claimer, c.provenance AS provenance, c.key AS claimKey`
  const order = 'ORDER BY fromUri, toUri, kind, claimer'
  let rows: Record<string, unknown>[] = []
  const profiles = new Map<string, { scope: string | null, idParent: string | null }>()

  if (uris === undefined) {
    // the whole-graph form keeps the profiles in the one statement: there is no per-subject cost to
    // multiply, and the join is what makes it one read rather than two over the same rows
    rows = await ctx.query<Record<string, unknown>>(
      `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
       MATCH (pa:MediaProfile)-[:PROFILE_OF]->(a), (pb:MediaProfile)-[:PROFILE_OF]->(b)
       ${claimColumns}, pa.scope AS fromScope, pb.scope AS toScope,
         pa.idParent AS fromParent, pb.idParent AS toParent
       ${order}`
    )
  } else if (uris.length) {
    // an empty `UNWIND` list dies at runtime on this engine, so an empty scope asks nothing
    const found = new Map<string, Record<string, unknown>>()
    for (const end of ['(a:Media {uri: u})-[c:CLAIMS]->(b:Media)', '(a:Media)-[c:CLAIMS]->(b:Media {uri: u})']) {
      const touched = await ctx.query<Record<string, unknown>>(
        `UNWIND $uris AS u MATCH ${end} ${claimColumns} ${order}`,
        { uris }
      )
      for (const row of touched) found.set(String(row.claimKey), row)
    }
    rows = [...found.values()].sort((one, two) =>
      ['fromUri', 'toUri', 'kind', 'claimer', 'claimKey']
        .reduce((verdict, column) => verdict || String(one[column]).localeCompare(String(two[column])), 0))
    const ends = [...new Set(rows.flatMap(row => [String(row.fromUri), String(row.toUri)]))]
    if (ends.length) {
      const read = await ctx.query<{ uri: string, scope: string | null, idParent: string | null }>(
        `UNWIND $uris AS u MATCH (p:MediaProfile {uri: u})
         RETURN p.uri AS uri, p.scope AS scope, p.idParent AS idParent`,
        { uris: ends }
      )
      for (const row of read) profiles.set(row.uri, { scope: row.scope, idParent: row.idParent })
    }
    // a claim whose two rows are not BOTH profiled is not a candidate: the whole-graph form drops it
    // by not matching, and the scoped form has to drop it the same way or the two disagree
    rows = rows.filter(row => profiles.has(String(row.fromUri)) && profiles.has(String(row.toUri)))
  }

  return rows.map(row => {
    const from = profiles.get(String(row.fromUri))
    const to = profiles.get(String(row.toUri))
    return {
      fromUri: String(row.fromUri),
      toUri: String(row.toUri),
      fromOrigin: String(row.fromOrigin),
      toOrigin: String(row.toOrigin),
      kind: String(row.kind),
      claimer: String(row.claimer),
      provenance: String(row.provenance),
      claimKey: String(row.claimKey),
      fromScope: asText(from ? from.scope : row.fromScope),
      toScope: asText(to ? to.scope : row.toScope),
      fromParent: asText(from ? from.idParent : row.fromParent),
      toParent: asText(to ? to.idParent : row.toParent),
    }
  })
}

/**
 * The uris a scoped run recomputes, or `undefined` for a whole-graph run.
 *
 * The subjects are the rows whose profile moved plus both ends of every claim the delta named. The
 * SCOPE a run declares is exactly this set and never the endpoints of what the scan happened to
 * return: a uri outside it carries claims this run did not read, and every `LINK` it holds is one the
 * writer would then retract for never having been re-derived.
 *
 * A delta naming most of the table reads whole-graph instead (`WHOLE_GRAPH_FRACTION`), which is a
 * cheaper way to say the same thing: a full scope re-derives every row, so it is never narrower than
 * the scan.
 */
const subjectsOf = async (ctx: PluginContext): Promise<string[] | undefined> => {
  if (ctx.delta.full) return undefined
  const subjects = [...new Set([...ctx.delta.media, ...await claimEndpoints(ctx, ctx.delta.claims)])]
  const [row] = await ctx.query<{ total: number }>('MATCH (m:Media) RETURN count(m) AS total')
  return subjects.length * WHOLE_GRAPH_FRACTION >= Number(row?.total ?? 0) ? undefined : subjects
}

const proposal = (
  candidate: Candidate,
  kind: LinkProposal['kind'],
  fromUri: string,
  toUri: string,
  reason: string,
  extra: { status?: 'refused', evidence?: unknown } = {}
): LinkProposal => ({
  kind,
  fromUri,
  toUri,
  ...extra.status ? { status: extra.status } : {},
  reason,
  confidence: 1.0,
  // the claimer and the provenance travel on every row this plugin writes: they are what the
  // precedence classes of 5.2 read, and what a trace prints beside the claim key
  evidence: extra.evidence ?? { claimer: candidate.claimer, provenance: candidate.provenance },
  supports: [candidate.claimKey],
})

/**
 * One claim as the decision table of 5.4 P1 reads it, or nothing when it waits.
 *
 * The table, in the order it is applied:
 *
 * | claim | scopes | verdict |
 * | --- | --- | --- |
 * | any | `fromScope` or `toScope` NULL | no edge this pass; replayed next pass |
 * | any, `provenance = address` | | never consumed here (3.3) |
 * | `INCLUDES` | `fromOrigin = toOrigin` and `toParent = fromUri` | `PART_OF(toUri, fromUri)` reason `asserted` |
 * | `INCLUDES` | otherwise | refused `foreign-includes`, no downgrade |
 * | any, `fromOrigin = toOrigin` | `toUri = fromParent` or `fromUri = toParent` | `PART_OF` from the extending id to its prefix, reason `prefix` |
 * | any, `fromOrigin = toOrigin` | otherwise | refused `disagreeing-ids` and downgraded |
 * | `PART_OF` | RUN into RUN, or RUN into CONTAINER | `PART_OF` as claimed, reason `asserted` (an `ask` claim carries `containing`) |
 * | `PART_OF` | CONTAINER into RUN | refused `inverted` |
 * | `SAME_AS` | equal | propose `SAME_AS`: the writer's guards decide |
 * | `SAME_AS` | differ | `PART_OF` from the RUN side to the CONTAINER side, reason `cross-scope` |
 *
 * TWO ORDERING CHOICES the table's own rows do not fix, both made so a more specific rule keeps its
 * own reason: `INCLUDES` is read before the same-origin rule, since a show's own season list is
 * exactly a same-origin prefix pair and `asserted` says more than `prefix` about it; and the
 * same-origin rule is read before the kind rules, since `cr:<series>-<season>` claiming
 * `cr:<series>` is prefix containment whether it was offered as `SAME_AS` or as `PART_OF`.
 */
export const decide = (candidate: Candidate): LinkProposal[] => {
  const { fromUri, toUri, fromOrigin, toOrigin, kind, fromScope, toScope, fromParent, toParent } = candidate

  // a uri with no effective scope has no relation yet: the claim edge stays and the next pass, with
  // the row that describes it, decides (5.2 guard 1, `db.ts:113-123`)
  if (fromScope === null || toScope === null) return []
  // an address is a POINTER: it names which sources to ask and asserts nothing about how they relate
  if (candidate.provenance === 'address') return []

  if (kind === 'INCLUDES') {
    // fenced: a show row naming the season rows of its OWN origin, inside its own id space
    if (fromOrigin === toOrigin && toParent === fromUri) {
      return [proposal(candidate, 'PART_OF', toUri, fromUri, 'asserted', {
        evidence: { claimer: candidate.claimer, provenance: candidate.provenance, claimed: 'INCLUDES' },
      })]
    }
    // an ordinal or a season list is never portable between id spaces: JustWatch and Netflix disagree
    // on the season number for 6 of 31 shows (2026-09-04). No downgrade, because nothing was proven
    return [proposal(candidate, 'INCLUDES', fromUri, toUri, 'foreign-includes', { status: 'refused' })]
  }

  if (fromOrigin === toOrigin) {
    // specificity is PREFIX EXTENSION, never length (`src/utils/uri.ts:23-34`, fc36ffc)
    if (toUri === fromParent) return [proposal(candidate, 'PART_OF', fromUri, toUri, 'prefix')]
    if (fromUri === toParent) return [proposal(candidate, 'PART_OF', toUri, fromUri, 'prefix')]
    // two ids of one origin that are not one id at two precisions: refused, and downgraded, so the
    // url survives as containment while the identity does not. A claim that was already CONTAINMENT
    // is only the downgrade: writing a refused `PART_OF` beside an active one of the same reason
    // would be two rows fighting for one key, which the diff resolves by the array's order
    const downgrade = proposal(candidate, 'PART_OF', fromUri, toUri, 'disagreeing-ids', {
      evidence: { claimer: candidate.claimer, provenance: candidate.provenance, theirs: toUri, ours: fromUri },
    })
    if (kind === 'PART_OF') return [downgrade]
    return [proposal(candidate, 'SAME_AS', fromUri, toUri, 'disagreeing-ids', { status: 'refused' }), downgrade]
  }

  if (kind === 'PART_OF') {
    // a CONTAINER proposed as part of a RUN is refused rather than flipped (`db.ts:244-245`)
    if (fromScope === 'CONTAINER' && toScope === 'RUN') {
      return [proposal(candidate, 'PART_OF', fromUri, toUri, 'inverted', { status: 'refused' })]
    }
    // a `containing` answer is an ask, and it names the counts it read (4.4)
    const reason = candidate.provenance === 'ask' ? 'containing' : 'asserted'
    return [proposal(candidate, 'PART_OF', fromUri, toUri, reason)]
  }

  if (fromScope !== toScope) {
    // "an edge media to handle, whatever was claimed" (`db.ts:166-169`)
    const [run, container] = fromScope === 'RUN' ? [fromUri, toUri] : [toUri, fromUri]
    return [proposal(candidate, 'PART_OF', run, container, 'cross-scope', {
      evidence: { claimer: candidate.claimer, provenance: candidate.provenance, theirs: 'CONTAINER', ours: 'RUN' },
    })]
  }

  return [proposal(candidate, 'SAME_AS', fromUri, toUri, 'asserted')]
}

/**
 * `plugin:direct`, P1 of 5.4.
 *
 * Consumes `CLAIMS` and `MediaProfile`; produces `LINK` of kinds `SAME_AS` and `PART_OF` (and the
 * refused `INCLUDES` row a fenced claim leaves); `after: [plugin:profile]`, because every decision
 * reads the effective scope and the id parent off the profile rather than off `raw`.
 */
export const directPlugin: Plugin = {
  id: 'plugin:direct',
  // `LINK` IS CONSUMED THOUGH NOTHING HERE READS ONE, and it is the guards that need it: guard 4
  // measures a proposal against the active `SAME_AS` COMPONENTS and guard 5 against the claimants'
  // components with the target cut out, so a link this plugin itself writes can change the verdict for
  // a different pair. Left out, an iteration whose only writes are links hands direct nothing,
  // `deltaFor` skips it, and the pass reports a fixed point it has not reached
  // (`delta.test.ts`, 'a settled scheduler pass leaves nothing for a fresh full pass to write').
  consumes: { nodes: ['MediaProfile'], edges: ['CLAIMS', 'LINK'] },
  produces: { nodes: [], edges: ['LINK'], kinds: ['SAME_AS', 'PART_OF'] },
  after: ['plugin:profile'],
  version: DIRECT_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    const subjects = await subjectsOf(ctx)
    const candidates = await scan(ctx, subjects)
    const links: LinkProposal[] = []
    for (const candidate of candidates) links.push(...decide(candidate))

    return {
      scope: subjects === undefined ? { full: true } : { full: false, uris: subjects, clusters: [], pairs: [] },
      nodes: [],
      edges: [],
      links,
      episodeLinks: [],
    }
  },
}
