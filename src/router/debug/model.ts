// Everything the debug page works out from a bundle before any of it is drawn.
//
// Pure and preact-free, because all of the parts that can be quietly wrong are arithmetic or
// bookkeeping: which uris become nodes, which of several rows between one pair is which, and what a
// support key points at. A page cannot be asked those questions, and a function can.

import type {
  TraceBundle, TraceClaim, TraceEpisodeClaim, TraceEpisodeLink, TraceEpisodeSource, TraceLink,
  TraceMember, TraceReason,
} from './trace'

import { layoutFranchise } from '../../utils/franchise-layout'

/**
 * How a node got into the picture, which is the whole difference a reader is looking for.
 *
 * THREE, and they are `Media.owned` plus one derived case, not four. `owned` is a uri its own origin
 * described; `placeholder` is one no origin has (`schema.ts`: "false = placeholder"), whether or not
 * a pass has since clustered it. `named` is a uri in NO member list that appears only at the end of a
 * claim or a link, which is what a refused neighbour looks like: it has to be drawn, or the page
 * answers "why is this not here" with a blank.
 *
 * There was a fourth, `unowned`, read as "a row another scope owns". That is a misreading of the
 * column: an unowned row IS the placeholder. It drew a fourth box style that the legend had no entry
 * for, and it is `via` (in the node's meta line) that says whether a placeholder is a cluster member.
 */
export type TraceNodeKind = 'owned' | 'placeholder' | 'named'

/** One drawn node. `title` stays null when nothing carries one: the page renders that as null. */
export type TraceNode = {
  uri: string
  kind: TraceNodeKind
  origin: string | null
  scope: string | null
  title: string | null
  episodeCount: number | null
  startDate: string | null
  member: TraceMember | null
}

const memberKind = (member: TraceMember): TraceNodeKind => member.owned ? 'owned' : 'placeholder'

/**
 * Every uri the bundle names, members first and in their own order, then the strangers.
 *
 * The second half is the point: a uri that only ever appears at the end of a link or a claim is still
 * a node, so a refused relation is drawn as a refused edge to a visible box rather than vanishing.
 *
 * DEDUPLICATED BY URI, FOR EVERY PASS, and the first row for a uri wins, which makes it the member.
 * The worker no longer sends a uri as both a member and a placeholder, and this enforces the same
 * invariant at the place that draws it: when it did (20.7% of clusters, 2026-09-13) both boxes landed
 * at one position and the meta lines overstruck, so the last one painted decided whether a reader saw
 * a member or a non-member. The `seen` set used to be built AFTER the members were mapped straight
 * through, so the promise in this comment covered only the `named` pass below.
 */
export const traceNodes = (bundle: TraceBundle): TraceNode[] => {
  const nodes: TraceNode[] = []
  const seen = new Set<string>()
  for (const member of bundle.members ?? []) {
    if (!member.uri || seen.has(member.uri)) continue
    seen.add(member.uri)
    nodes.push({
      uri: member.uri,
      kind: memberKind(member),
      origin: member.origin,
      scope: member.scope,
      title: member.title,
      episodeCount: member.episodeCount,
      startDate: member.startDate,
      member,
    })
  }
  const named = [
    ...(bundle.links ?? []).flatMap(link => [link.fromUri, link.toUri]),
    ...(bundle.claims ?? []).flatMap(claim => [claim.fromUri, claim.toUri]),
  ]
  for (const uri of named) {
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    nodes.push({
      uri,
      kind: 'named',
      origin: null,
      scope: null,
      title: null,
      episodeCount: null,
      startDate: null,
      member: null,
    })
  }
  return nodes
}

/** A node with its place on the grid. Column and row are cells, not pixels: the drawing scales them. */
export type PlacedTraceNode = TraceNode & { column: number, row: number }

export type TraceGraphLayout = { nodes: PlacedTraceNode[], columns: number, rows: number }

/**
 * Where each node sits, laid out by RELATION DEPTH through the app's existing franchise layout.
 *
 * It is the same job, so it is the same code: `layoutFranchise` in graph mode already packs a node
 * set into as few columns as the edges allow, survives a cycle (iterated to a fixed point rather than
 * recursed) and compacts the columns it actually uses, which is what keeps thirty nodes inside a
 * screen instead of spread over fifty columns.
 *
 * Only the POSITIONS come from there. Its edge list is canonicalised and deduplicated by
 * from/to/relation, which would merge an active link and a refused link of the same kind between the
 * same pair into one arrow: exactly the two rows this page exists to show apart. So the drawing reads
 * `bundle.links` itself and this function is asked for nothing but a column and a row.
 */
export const traceGraphLayout = (bundle: TraceBundle): TraceGraphLayout => {
  const nodes = traceNodes(bundle)
  const layout = layoutFranchise({
    nodes: nodes.map(node => ({
      uri: node.uri,
      titles: [{ title: node.title ?? node.uri }],
      startDate: node.startDate,
    })),
    edges: (bundle.links ?? []).map(link => ({ from: link.fromUri, to: link.toUri, relation: link.kind })),
  }, 'graph')
  const placed = new Map(layout.nodes.map(node => [node.uri, node]))
  return {
    nodes: nodes.map(node => ({
      ...node,
      column: placed.get(node.uri)?.column ?? 0,
      row: placed.get(node.uri)?.row ?? 0,
    })),
    columns: layout.columns,
    rows: layout.rows,
  }
}

/** Which of the arrows between one pair this is, and how many there are. Both are needed to fan them. */
export type EdgeLane = { lane: number, lanes: number }

const pairKey = (from: string, to: string) => [from, to].sort().join(' ')

/**
 * One lane per row between the same two uris, so several rows are several arrows.
 *
 * Keyed on the UNORDERED pair, because A to B and B to A are drawn along the same line and would sit
 * on top of each other. Lane order follows the order the rows arrive in, so the picture is the same
 * every draw.
 */
export const edgeLanes = (
  edges: readonly { fromUri: string, toUri: string, key: string }[],
): Map<string, EdgeLane> => {
  const groups = new Map<string, string[]>()
  for (const edge of edges) {
    const pair = pairKey(edge.fromUri, edge.toUri)
    const group = groups.get(pair) ?? []
    group.push(edge.key)
    groups.set(pair, group)
  }
  const lanes = new Map<string, EdgeLane>()
  for (const group of groups.values()) {
    group.forEach((key, lane) => lanes.set(key, { lane, lanes: group.length }))
  }
  return lanes
}

/** A row the page can select and inspect, tagged with which table it came from. */
export type TraceRef =
  | { kind: 'link', row: TraceLink }
  | { kind: 'claim', row: TraceClaim }
  | { kind: 'episode-link', row: TraceEpisodeLink }
  | { kind: 'episode-claim', row: TraceEpisodeClaim }
  | { kind: 'episode-source', row: TraceEpisodeSource }

/**
 * Every keyed row in the bundle, by key.
 *
 * This is what makes `supports` a descent rather than a list of strings: a link names the keys it was
 * derived from, each key resolves here to the claim or link it names, and a claim names an answer
 * sequence. Nothing walks a path to find them.
 */
export const traceIndex = (bundle: TraceBundle): Map<string, TraceRef> => {
  const index = new Map<string, TraceRef>()
  for (const row of bundle.links ?? []) index.set(row.key, { kind: 'link', row })
  for (const row of bundle.claims ?? []) index.set(row.key, { kind: 'claim', row })
  for (const row of bundle.episodeLinks ?? []) index.set(row.key, { kind: 'episode-link', row })
  for (const row of bundle.episodeClaims ?? []) index.set(row.key, { kind: 'episode-claim', row })
  // a `via: member` fill's supports name these, so without them every such descent dead-ended
  for (const row of bundle.episodeSources ?? []) index.set(row.key, { kind: 'episode-source', row })
  return index
}

/** Every edge key in this store is a sha-256 hex digest, so anything else is not one. */
const EDGE_KEY = /^[0-9a-f]{64}$/

/**
 * Why a support key resolved to nothing, which is not one fact but two.
 *
 * `missing` is a key shaped like an edge key that this bundle does not carry: a finding about the
 * bundle. `not-an-edge-key` is a string that could never be one, which is a finding about the WRITER
 * (`plugin:title` puts a folded title in `LINK.supports`, where `schema.ts` declares edge keys).
 * Reported apart because "not in this bundle" sends a reader to look for a row that was never there.
 */
export type SupportGap = 'missing' | 'not-an-edge-key'

/** One support key beside the row it names, or beside the reason it names none. */
export type TraceSupport = { key: string, ref: TraceRef | null, gap: SupportGap | null }

/**
 * Each support key beside what it points at, keeping the keys that point at nothing.
 *
 * A key the bundle does not carry is reported with a null ref rather than dropped: a support naming a
 * row that is not in the bundle is a finding about the bundle, and hiding it would make the descent
 * look complete when it is not.
 */
export const resolveSupports = (
  index: Map<string, TraceRef>,
  keys: readonly string[] | undefined,
): TraceSupport[] =>
  (keys ?? []).map(key => {
    const ref = index.get(key) ?? null
    return { key, ref, gap: ref ? null : EDGE_KEY.test(key) ? 'missing' : 'not-an-edge-key' }
  })

/** The stored answer a claim names, or null when the bundle does not carry that sequence. */
export const answerFor = (bundle: TraceBundle, seq: number) =>
  (bundle.answers ?? []).find(answer => answer.seq === seq) ?? null

/** One field of a parsed evidence or gates blob. A null value is the JSON's own null. */
export type TraceField = { field: string, value: string | null }

/**
 * What the inspector renders for an `evidence` or `gates` blob.
 *
 * Three outcomes and they are not interchangeable: there was nothing on the edge, it parsed into
 * fields, or it is text that is not JSON. The third case keeps the raw string, because an edge
 * carrying something unparseable is worth seeing rather than being reported as empty.
 */
export type TraceBlob =
  | { kind: 'absent' }
  | { kind: 'fields', fields: TraceField[] }
  | { kind: 'raw', raw: string }

const asFieldValue = (value: unknown): string | null =>
  value === null
    ? null
    : typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value)

/**
 * An evidence or gates JSON string turned into fields.
 *
 * A JSON object becomes one field per key, in the order the blob wrote them. Anything else that
 * parses (an array, a number, a bare string) becomes a single field named for its own shape, so the
 * value is still shown rather than being called unparseable.
 */
export const traceBlob = (json: string | null | undefined): TraceBlob => {
  if (json === null || json === undefined || json === '') return { kind: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { kind: 'raw', raw: json }
  }
  if (parsed === null) return { kind: 'fields', fields: [{ field: 'value', value: null }] }
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      kind: 'fields',
      fields: Object.entries(parsed as Record<string, unknown>)
        .map(([field, value]) => ({ field, value: asFieldValue(value) })),
    }
  }
  return { kind: 'fields', fields: [{ field: Array.isArray(parsed) ? 'values' : 'value', value: asFieldValue(parsed) }] }
}

/**
 * Why nothing resolved, in words a reader can act on.
 *
 * One message per reason, because the four are four different jobs: turn the engine on, wait while
 * the sources are asked, check the uri, or wait for a pass. A bundle with no cluster and no reason
 * gets the last line, which says exactly that rather than guessing which of the four it was.
 *
 * NO MESSAGE HERE ADVISES AN ACTION THAT PRODUCES ANOTHER OF THESE STATES. The `not-enabled` line
 * used to say "reload with ?graph to warm it", and a reload does exactly that and lands on
 * `graph-empty`, whose line then said "nothing has been ingested yet" and sent the reader to the
 * ingest: the two formed a loop that no pasted link could ever get out of (measured 2026-09-13). So
 * `not-enabled` names the flag the page's own reload link carries, and `graph-empty` states the fact
 * that an engine lives and dies with its tab, while the page warms the uri it was asked about and
 * says so on its own line.
 */
export const reasonMessage = (reason: TraceReason | undefined): string => {
  if (reason === 'not-enabled') {
    return 'The graph engine is switched off for this page, so there is nothing to read.'
      + ' Reloading with ?graph=1 turns it on, and this page then asks the sources about the uri'
      + ' itself. The only way a page gets here now is ?store=legacy, which pins it to the old store;'
      + ' dropping that flag puts the whole app back on the graph, which is the default.'
  }
  if (reason === 'graph-empty') {
    return 'The engine is on and the graph is empty. A graph is built inside one tab and never'
      + ' outlives it, so a link opened cold always starts here: what fills it is a page asking the'
      + ' sources, which is what this page does with the uri it was given.'
  }
  if (reason === 'no-row') {
    return 'No media row exists for that uri, so there is nothing to cluster. Either no source has'
      + ' answered for it in this tab yet, or the uri is not one any source recognises.'
  }
  if (reason === 'no-cluster') {
    return 'A media row exists for that uri, but no cluster holds it yet: either a pass has not run'
      + ' since it arrived, or it is a placeholder no pass will ever cluster on its own.'
  }
  return 'That uri reached no cluster, and the bundle carries no reason for it.'
}

/** An active row is drawn as a fact, anything else as a refusal. Status is the worker's own word. */
export const isActive = (status: string): boolean => status === 'active'
