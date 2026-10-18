/**
 * The ingest: `Answer` rows become `Media`, `Episode`, `Origin`, `CLAIMS`, `HAS_EPISODE`,
 * `EPISODE_CLAIMS`, `RELATED` and `ABOUT` (section 4 of the representation design).
 *
 * ONE FUNCTION, `ingestAnswers`, and both callers feed it the same thing. The live hook reaches it
 * through the log's sink (`./answers.ts`), with the rows that flush wrote; a replay reaches it
 * through `replayAnswers` with rows read off a dump. There is no second code path, which is what
 * makes a recorded season replayable at all: what a page did and what a file replays are the same
 * decomposition, the same merge and the same statements.
 *
 * WHAT IT PROMISES.
 * - Every row it can address lands, and the ones it cannot are in `report.quarantined` with a reason.
 *   A malformed row never rejects the batch: on 2026-09-05 one bare row in `handles` made the shared
 *   insert batch reject for every extractor in it, first-party sources included, and the whole
 *   decomposition is total for that reason (4.2 step 1).
 * - Replaying a batch that already landed writes nothing, changes nothing and emits nothing. Newness
 *   is decided by content: a row's `hash` over its merged fields, a claim's key over its pair.
 * - It never invents a fact. Only the origin that owns a uri writes that uri's `raw`; every other
 *   mention of it is a placeholder plus a claim carrying the claimer's own description (4.3).
 *
 * WHAT IT REFUSES.
 * - `provenance: 'ask'` from a decomposed answer. An `ask` claim is the app consumer's, not a
 *   resolver's: it has no `Answer` to come out of, so nothing in the log expresses it and
 *   `writeAskClaim` below is the one writer of it, called by `src/worker/similar-consumer.ts` with
 *   the `Ask` row it belongs to. `address` IS written here, from the handle's own stamp or from
 *   `NATIVE_ID_SPACES` when a recording predates it (`provenanceOf`).
 * - Everything a plugin writes (2.2). The tables exist and this file never touches them.
 *
 * THE ENGINE FACTS THAT SHAPE EVERY WRITE, all measured on 0.20.4, 2026-09-12. Three of them, and
 * each one rejects or corrupts a whole batch rather than one row.
 *
 * - A param binds by JS type and a column refuses an implicit cast, so an `UNWIND` batch whose
 *   `episodeCount` is null in EVERY row binds that field as STRING and the statement dies with "has
 *   data type STRING but expected INT64". Worse, a mixed list mis-binds silently: a DOUBLE field
 *   holding `0.5` in one row and the integer `3` in the next reads back as `1.5e-323`, the bit
 *   pattern of 3 read as a double. So EVERY typed scalar travels as a STRING and is cast in the
 *   statement, which parses rather than reinterprets and carries a null through as a null. An INT64
 *   is only offered a SAFE integer, because `String(1e21)` is `1e+21` and the cast refuses it.
 * - AN `UNWIND` STRUCT FIELD IS TYPED FROM THE FIRST ROW ONLY. A list field that is empty in row one
 *   and filled in row two binds as `LIST(ANY)` and the statement dies at RUNTIME with "Trying to
 *   create a vector with ANY type", after the binder passed it; `cast(... AS STRING[])` does not
 *   save it, and the reverse order works, which is what made it look like a data problem. It cost a
 *   real page 148 of its 816 answers before the browser arm caught it. So no list travels as a list:
 *   every one is joined into a STRING and split in the statement, where the type is written down.
 * - An object param binds as a STRUCT and a `MAP` column refuses it, so `fieldSeq` is written
 *   `map(<keys>, <values>)` over two split lists.
 */
import type { AnswerRow } from './answers'

import { emit } from '../store/events'
import { contentHash, sha256Hex } from './hash'
import { ADDRESS_ECHOING_ORIGINS, NATIVE_ID_SPACES } from './plugins/origins'
import { graphReady } from './schema'

/** A row the decomposition could not express, kept with the reason rather than dropped in silence. */
export type IngestQuarantine = {
  /** The `Answer.key` the row arrived under, or '' when the row itself carried none. */
  key: string
  /** The uri, when one could be read at all. */
  uri: string
  reason: string
}

/** What moved, in the four classes 4.2 step 8 names. Empty everywhere means an idempotent batch. */
export type IngestChanged = {
  /**
   * Uris created, whose merged row changed in a projected column, or that a NEW answer was written
   * `ABOUT`.
   *
   * The third is not a row that moved and is a delta all the same: a profile reads the answers about
   * its subject (the effective scope of 5.4 P0 is partly a vote of who said what), and a source
   * answering about another origin's uri writes an `ABOUT` edge without touching the row it names,
   * since only the owning origin writes `raw` (4.3). A scan scoped to the rows that moved would miss
   * it, and a replay writes no new answer at all, so this costs an idempotent batch nothing.
   */
  media: string[]
  /** Keys of `CLAIMS` edges that were new. */
  claims: string[]
  /**
   * `Episode.uri` for every new `HAS_EPISODE`, never the edge key.
   *
   * A uri is what a scan looks a row up by (`UNWIND $uris AS u MATCH (e:Episode {uri: u})`), and an
   * edge key matches nothing there: `plugin:profile` unions this list into its subjects.
   */
  episodes: string[]
  /** Uris whose `raw` changed in an unprojected field only, and targets of a re-asserted claim. */
  raw: string[]
}

/** What one ingest did, and what it cost. */
export type IngestReport = {
  /** Rows in. */
  answers: number
  quarantined: IngestQuarantine[]
  changed: IngestChanged
  /**
   * Rows and edges written, by table, so a caller can say what a page produced. Placeholders are
   * counted apart (`MediaPlaceholder`, `EpisodePlaceholder`) because they are anchors rather than
   * descriptions, and a re-asserted claim apart from a new one (`CLAIMS_REASSERTED`). Every
   * statement runs only with rows the read-back proved absent or changed, so a number here is a
   * write that happened rather than one that was offered: an idempotent batch reports nothing.
   */
  written: Record<string, number>
  /**
   * Episodes of a FOREIGN nested node, counted and not written (4.2 step 6). They stay inside
   * `CLAIMS.node` byte for byte: a node contributing no field may not contribute an episode row
   * either, and this is the number that measurement is read off.
   */
  declinedEpisodes: number
  /** Handles that named no node, the shape a `stub-source@1` plugin still sends. */
  handlesWithNoNode: number
  ms: number
}

type Contribution = { seq: number, value: Record<string, unknown> }

type NodeDraft = {
  uri: string
  origin: string
  id: string
  /** True once an answer from this uri's OWN origin described it. */
  owned: boolean
  /** The scope stamped on the node the first time it was named, for a placeholder. */
  stamp: string | null
  /** The owner's answers about this uri, in the order they arrived. */
  contributions: Contribution[]
}

type EpisodeDraft = NodeDraft & { mediaUri: string | null }

type EdgeDraft = {
  fromUri: string
  toUri: string
  kind: string
  provenance: string
  claimer: string
  targetScope: string | null
  answerSeq: number
  contributions: Contribution[]
}

type EpisodeEdgeDraft = { fromUri: string, toUri: string, claimer: string, answerSeq: number }

type RelatedDraft = {
  fromUri: string
  toUri: string
  relation: string
  format: string | null
  claimer: string
  node: Record<string, unknown>
  answerSeq: number
}

type AboutDraft = { key: string, uri: string, kind: AnswerRow['kind'] }

type Batch = {
  answers: AnswerRow[]
  media: Map<string, NodeDraft>
  episodes: Map<string, EpisodeDraft>
  origins: Map<string, NodeDraft>
  claims: Map<string, EdgeDraft>
  episodeClaims: Map<string, EdgeDraft>
  hasEpisode: Map<string, EpisodeEdgeDraft>
  related: Map<string, RelatedDraft>
  about: AboutDraft[]
  quarantined: IngestQuarantine[]
  declinedEpisodes: number
  handlesWithNoNode: number
}

// The offline source's origin, spelled here rather than imported from
// `src/sources/offline/normalize.ts` so the ingest reaches no part of the source tree: that module
// pulls in the generated graphql module, and this one has to load under a bare node for a replay.
const SEED_ORIGIN = 'offline'

// `readPluginHandles`'s cap, for the same reason: it bounds a self-referencing payload
// (`plugin-sources.ts:123-128`).
const HANDLE_DEPTH = 4

// The `MediaHandleRelation` values a claim may carry (3.1). Anything else reads as SAME_AS, which is
// what a `stub-source@1` plugin's bare row already means (`plugin-sources.ts:100-103`).
const CLAIM_KINDS = new Set(['SAME_AS', 'PART_OF', 'INCLUDES'])

// A claim's key is a hash over its composite, and the separator is a character no uri, kind, claimer
// or provenance can carry, so two different composites cannot spell one key. One constant because
// `writeAskClaim` keys its own claim the same way the decomposition does.
const CLAIM_SEPARATOR = '\u0000'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const originOfUri = (uri: string): string => uri.slice(0, uri.indexOf(':'))
const idOfUri = (uri: string): string => uri.slice(uri.indexOf(':') + 1)

/** The three parts of an address, or nothing: a row no origin can be read from is not addressable. */
const addressOf = (value: Record<string, unknown>): { uri: string, origin: string, id: string } | undefined => {
  const uri = value.uri
  if (typeof uri !== 'string' || !uri || uri.indexOf(':') <= 0) return undefined
  const origin = typeof value.origin === 'string' && value.origin ? value.origin : originOfUri(uri)
  const id = typeof value.id === 'string' && value.id ? value.id : idOfUri(uri)
  return { uri, origin, id }
}

const scopeStampOf = (value: Record<string, unknown>): string | null =>
  typeof value.scope === 'string' && value.scope ? value.scope : null

// The offline source's IDENTITY handles, and only those: a container handle claims containment rather
// than identity, and stays `source`.
const isSeedIdentity = (claimer: string, kind: string): boolean => claimer === SEED_ORIGIN && kind === 'SAME_AS'

/**
 * The provenance of a media claim, from what the log can see (3.3).
 *
 * THREE RULES, applied in this order.
 *
 * 1. `seed`, unchanged, so the offline source's identity handles keep the class the precedence order
 *    gives them.
 * 2. `address` from the handle's OWN STAMP. `buildHandlesFromUri` writes it on every handle it mints
 *    (`sources/utils.ts`): the address names WHICH sources to ask and asserts nothing about how their
 *    rows relate, so the claim is a pointer. `plugin:direct` returns nothing for it and guard 3
 *    refuses any proposal it supports (3.3, 5.2).
 * 3. `address` DERIVED, for a claim carrying no stamp from a claimer that REBUILDS handles out of the
 *    asked uri (`ADDRESS_ECHOING_ORIGINS`), when the target's origin is outside the claimer's own set
 *    (`NATIVE_ID_SPACES`): a source whose own data cannot carry that id space, asked about an address
 *    that names it, is echoing the address back. Netflix publishes no AniList id anywhere, so `nf`
 *    naming `anilist:X` came from the uri it was asked about and nowhere else.
 *
 * THREE EXEMPTIONS inside rule 3, and each is a claim that CANNOT be an echo however unfamiliar the
 * target looks. A claimer that never reads the address: the premise does not hold, so the honest
 * reading is a mapping path nobody read rather than a rebroadcast, and `source` stands. A claim into
 * the claimer's OWN origin, since `buildHandlesFromUri` skips the caller's origin outright. And any
 * kind but `SAME_AS`, since that is the only relation it mints: JustWatch's `PART_OF` offers are its
 * own reading of a deep link (`justwatch/extractor.ts:400`), and unogs listing its own seasons as
 * `INCLUDES` (4.6) is a statement too.
 *
 * RULE 3 IS NOT BELT AND BRACES. Every recorded answer predates the stamp and a remote plugin source
 * may never send one, so without it the rule would apply to nothing already on disk: 89 of Netflix's
 * 156 handle-carrying `media` answers on the recorded season corpus are pure echoes, and 31 of
 * Crunchyroll's 52 (2026-09-12). It narrows only origins whose extractor was read line by line, and
 * an origin missing from either table is trusted.
 *
 * `ask` IS NEVER STAMPED HERE, and a handle claiming to be one does not become one. An ask claim is
 * the app consumer's own statement about an answer it accepted, written by `writeAskClaim` with the
 * `Ask` row it belongs to (4.4, step 4); it reaches no `Answer`, so a handle inside an answer that
 * carries `provenance: 'ask'` is a source calling itself the consumer, and it stays `source`. Only
 * `address` is read off the stamp, because that is the one class a source can honestly declare about
 * its own handle: that it rebuilt it from the address it was asked about.
 */
const provenanceOf = (claimer: string, kind: string, handle: Record<string, unknown>, targetOrigin: string): string => {
  if (isSeedIdentity(claimer, kind)) return 'seed'
  if (textOf(handle.provenance) === 'address') return 'address'
  if (kind !== 'SAME_AS' || targetOrigin === claimer || !ADDRESS_ECHOING_ORIGINS.has(claimer)) return 'source'
  const native = NATIVE_ID_SPACES[claimer]
  return native && !native.has(targetOrigin) ? 'address' : 'source'
}

/**
 * The provenance of an EPISODE claim: the seed rule, and nothing else.
 *
 * Neither of the other two rules can fire here, which is why this is a second function rather than
 * the same one called with an episode. `buildHandlesFromUri` mints MEDIA handles only, so no episode
 * handle can carry the stamp; and `NATIVE_ID_SPACES` records which MEDIA id spaces a source
 * republishes, which says nothing about whose episode rows it may name. No first-party extractor
 * emits an episode handle at all today (the only builders are `store/aggregate.ts:408,441`, at read
 * time), so every episode claim comes from a remote plugin's payload and is trusted exactly as before.
 */
const episodeProvenanceOf = (claimer: string, kind: string): string =>
  isSeedIdentity(claimer, kind) ? 'seed' : 'source'

/**
 * The field merge of 4.3, the rule `lastWriteLongestArray` states (`store/graph.ts:388-399`).
 *
 * Per top-level field the incoming value is taken when it is non-null and, for an array, not strictly
 * shorter than the current one; otherwise the current value survives, and a key absent from the
 * incoming row survives untouched. `airingSchedule` is the one array always taken, since a schedule
 * shrinks as its episodes air. Two differences from the old store: the loser is not destroyed, it is
 * in its own `Answer` row, and `fieldSeq[field]` records which answer supplied what survived, so the
 * search-row-after-media-page degradation is both prevented and visible if a rule change brings it
 * back.
 *
 * It is a copy of that rule rather than a call into it: the old store is deleted at step 6c and this
 * is the survivor. `tests/unit/worker/graph/ingest.test.ts` folds the same answers through both and
 * asserts the rows are identical, so the two cannot drift while both exist.
 */
const mergeFields = (
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
  seq: number,
  fieldSeq: Record<string, number>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...existing }
  for (const key in incoming) {
    const value = incoming[key]
    const current = merged[key]
    if (Array.isArray(value)) {
      if (key !== 'airingSchedule' && Array.isArray(current) && current.length > value.length) continue
      merged[key] = value
    } else {
      if (value === null || value === undefined) continue
      merged[key] = value
    }
    fieldSeq[key] = seq
  }
  return merged
}

/**
 * The same merge for an episode, with the one rule that makes a duplicated position deterministic.
 *
 * `episodeNumber` takes the LOWEST of the two, never the latest: netflixid 80198505 season 3 lists
 * `81244356` at positions 7 and 8 (2026-09-10), the two rows are one `Episode` node, and it has to
 * store 7 whatever order the batch arrived in or a replay would not reproduce the page (4.2 step 1).
 */
const mergeEpisodeFields = (
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
  seq: number,
  fieldSeq: Record<string, number>
): Record<string, unknown> => {
  const lowest = existing?.episodeNumber
  const lowestSeq = fieldSeq.episodeNumber
  const merged = mergeFields(existing, incoming, seq, fieldSeq)
  if (typeof lowest === 'number' && typeof merged.episodeNumber === 'number' && lowest < merged.episodeNumber) {
    merged.episodeNumber = lowest
    // the number that survived came from the earlier answer, so its seq survives with it
    if (lowestSeq === undefined) delete fieldSeq.episodeNumber
    else fieldSeq.episodeNumber = lowestSeq
  }
  return merged
}

const foldContributions = (
  contributions: Contribution[],
  existing: Record<string, unknown> | undefined,
  fieldSeq: Record<string, number>,
  merge = mergeFields
): Record<string, unknown> => {
  let merged = existing
  for (const { seq, value } of [...contributions].sort((a, b) => a.seq - b.seq)) {
    merged = merge(merged, value, seq, fieldSeq)
  }
  return merged ?? {}
}

// Every typed column travels as a string and is cast in the statement; see the header for the three
// measurements that force it. A value of the wrong JS type is left NULL rather than coerced: the
// truth is in `raw` either way, and a coerced projection is a fact no source stated.
const textOf = (value: unknown): string | null => typeof value === 'string' ? value : null
// SAFE integer, not merely integer: `String(1e21)` is '1e+21' and `cast('1e+21' AS INT64)` refuses it
const intOf = (value: unknown): string | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null
const doubleOf = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : null
const jsonOf = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value)

// A separator no field name, category or uri carries, the same convention `handlePairs` joins on
// (`extractor.ts:116`). It is passed as `$separator` rather than written into the statement so no
// escaping question arises.
const LIST_SEPARATOR = '\u0000'

const textsOf = (value: unknown): string =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').join(LIST_SEPARATOR)
    : ''

/** A `STRING[]` column read off a joined param. The empty case is NULL, which is how it reads back. */
const stringListOf = (field: string): string =>
  `CASE WHEN r.${field} = '' THEN cast(NULL AS STRING[]) ELSE string_split(r.${field}, $separator) END`

/** The `fieldSeq` MAP, from the two joined params that carry its keys and its values. */
const FIELD_SEQ = `CASE WHEN r.fieldKeys = '' THEN cast(NULL AS MAP(STRING, INT64))
   ELSE map(string_split(r.fieldKeys, $separator), cast(string_split(r.fieldSeqs, $separator) AS INT64[])) END`

/** The columns beside `raw`, copied verbatim from it so a WHERE clause can read them (2.1). */
const mediaProjection = (raw: Record<string, unknown>) => ({
  scope: textOf(raw.scope),
  score: doubleOf(raw.score),
  episodeCount: intOf(raw.episodeCount),
  startDate: textOf(raw.startDate),
  endDate: textOf(raw.endDate),
  type: textOf(raw.type),
  status: textOf(raw.status),
  season: textOf(raw.season),
  seasonYear: intOf(raw.seasonYear),
  titles: jsonOf(raw.titles),
  categories: textsOf(raw.categories),
})

const episodeProjection = (raw: Record<string, unknown>) => ({
  mediaUri: textOf(raw.mediaUri),
  episodeNumber: intOf(raw.episodeNumber),
  seasonNumber: intOf(raw.seasonNumber),
  absoluteEpisodeNumber: intOf(raw.absoluteEpisodeNumber),
  releaseDate: textOf(raw.releaseDate),
  titles: jsonOf(raw.titles),
})

const sameProjection = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  Object.keys(a).every(key => {
    const left = a[key]
    const right = b[key]
    return Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((entry, index) => entry === right[index])
      : left === right
  })

const draftOf = (batch: Batch, uri: string, origin: string, id: string): NodeDraft => {
  const existing = batch.media.get(uri)
  if (existing) return existing
  const draft: NodeDraft = { uri, origin, id, owned: false, stamp: null, contributions: [] }
  batch.media.set(uri, draft)
  return draft
}

const quarantine = (batch: Batch, key: string, uri: string, reason: string) => {
  batch.quarantined.push({ key, uri, reason })
}

const addClaim = (batch: Batch, map: Map<string, EdgeDraft>, draft: Omit<EdgeDraft, 'contributions'>, node: Record<string, unknown>) => {
  const key = [draft.fromUri, draft.toUri, draft.kind, draft.claimer, draft.provenance].join(CLAIM_SEPARATOR)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...draft, contributions: [{ seq: draft.answerSeq, value: node }] })
    return
  }
  existing.contributions.push({ seq: draft.answerSeq, value: node })
  existing.answerSeq = Math.max(existing.answerSeq, draft.answerSeq)
}

/**
 * One episode row, from a media answer's `episodes` or from an `episode` answer.
 *
 * The `HAS_EPISODE` edge runs from `mediaUri` AS RETURNED, never from the row that carried it: that
 * is how the transitional lend hangs `cr:` episodes on an `anilist:` uri (4.4), and re-pointing it at
 * the parent would invent a containment no source stated. An episode naming no media is quarantined
 * rather than hung on a guess.
 */
const visitEpisode = (batch: Batch, answer: AnswerRow, value: unknown, owned: boolean) => {
  if (!isRecord(value)) {
    quarantine(batch, answer.key, '', 'an episode entry is not a row')
    return
  }
  const address = addressOf(value)
  if (!address) {
    quarantine(batch, answer.key, typeof value.uri === 'string' ? value.uri : '', 'an episode carries no uri an origin can be read from')
    return
  }
  const mediaUri = typeof value.mediaUri === 'string' && value.mediaUri.indexOf(':') > 0 ? value.mediaUri : null
  const draft = batch.episodes.get(address.uri) ?? {
    ...address, owned: false, stamp: null, contributions: [], mediaUri: null,
  }
  batch.episodes.set(address.uri, draft)
  draft.mediaUri ??= mediaUri
  if (owned) {
    draft.owned = true
    draft.contributions.push({ seq: answer.seq, value })
  }

  if (!mediaUri) {
    quarantine(batch, answer.key, address.uri, 'an episode names no media, so no HAS_EPISODE could be written')
  } else {
    // the media an episode hangs on is named before it is described, so the edge never waits
    draftOf(batch, mediaUri, originOfUri(mediaUri), idOfUri(mediaUri))
    const key = `${mediaUri}\0${address.uri}\0${answer.origin}`
    if (!batch.hasEpisode.has(key)) {
      batch.hasEpisode.set(key, { fromUri: mediaUri, toUri: address.uri, claimer: answer.origin, answerSeq: answer.seq })
    }
  }

  for (const handle of Array.isArray(value.handles) ? value.handles : []) {
    if (!isRecord(handle) || !isRecord(handle.node)) {
      batch.handlesWithNoNode += 1
      continue
    }
    const target = addressOf(handle.node)
    if (!target) {
      quarantine(batch, answer.key, address.uri, 'an episode handle names no uri an origin can be read from')
      continue
    }
    if (!batch.episodes.has(target.uri)) {
      batch.episodes.set(target.uri, { ...target, owned: false, stamp: null, contributions: [], mediaUri: null })
    }
    const kind = typeof handle.relation === 'string' && CLAIM_KINDS.has(handle.relation) ? handle.relation : 'SAME_AS'
    addClaim(batch, batch.episodeClaims, {
      fromUri: address.uri,
      toUri: target.uri,
      kind,
      provenance: episodeProvenanceOf(answer.origin, kind),
      claimer: answer.origin,
      targetScope: scopeStampOf(handle.node),
      answerSeq: answer.seq,
    }, handle.node)
  }
}

/**
 * One media node and everything hanging off it, depth first, exactly as
 * `recursivelyUnwrapMediaHandles` walks today (`store/aggregate.ts:135`).
 *
 * OWNERSHIP DECIDES WHAT A NESTED NODE IS, not position (4.1). A node whose origin equals the
 * answering origin is that source's own statement, owned and written whole, which is how JustWatch's
 * `jw:<objectId>` container lands as a row whichever of its two arrivals comes first. A node of
 * another origin is the claimer's DESCRIPTION: a placeholder row plus a claim carrying the node, so a
 * partial selection can no longer truncate the owner's copy.
 *
 * THE WALK STOPS AT A PART_OF NODE, and that is the load bearing part. A PART_OF node is a container,
 * and its own handles are claims about the container rather than about the run that pointed at it.
 * Carried through, two runs each hanging PART_OF off one show each contribute a pair rooted at that
 * show, and a merge rooted there welds the two runs: the failure the relation exists to prevent
 * (`tests/unit/worker/store/part-of-subtree.test.ts`). The node itself still lands, so its url
 * renders; only its claims are dropped, and its stored copy carries `handles: []` so nothing
 * downstream can read them back out of `raw`.
 */
const visitMedia = (
  batch: Batch,
  answer: AnswerRow,
  value: unknown,
  options: { depth: number, viaPartOf: boolean }
): string | undefined => {
  if (!isRecord(value)) {
    quarantine(batch, answer.key, '', 'a handle names no media row')
    return undefined
  }
  const address = addressOf(value)
  if (!address) {
    quarantine(batch, answer.key, typeof value.uri === 'string' ? value.uri : '', 'a row carries no uri an origin can be read from')
    return undefined
  }

  const draft = draftOf(batch, address.uri, address.origin, address.id)
  draft.stamp ??= scopeStampOf(value)
  const owned = address.origin === answer.origin
  if (owned) {
    draft.owned = true
    // a container reached through PART_OF keeps every field and loses its claims, the same copy
    // `recursivelyUnwrapMediaHandles` makes, so the cut cannot be undone by a later reader of `raw`
    draft.contributions.push({ seq: answer.seq, value: options.viaPartOf ? { ...value, handles: [] } : value })
  }

  const episodes = Array.isArray(value.episodes) ? value.episodes : []
  if (owned) {
    for (const episode of episodes) visitEpisode(batch, answer, episode, true)
    for (const edge of Array.isArray(value.relations) ? value.relations : []) {
      if (!isRecord(edge) || !isRecord(edge.node)) continue
      const target = addressOf(edge.node)
      if (!target) continue
      // the narrative axis: stored flat, as the source stated it, and never walked by any merge
      draftOf(batch, target.uri, target.origin, target.id)
      const relation = textOf(edge.relation) ?? 'UNKNOWN'
      const key = `${address.uri}\0${target.uri}\0${relation}\0${answer.origin}`
      if (!batch.related.has(key)) {
        batch.related.set(key, {
          fromUri: address.uri, toUri: target.uri, relation, format: textOf(edge.format),
          claimer: answer.origin, node: edge.node, answerSeq: answer.seq,
        })
      }
    }
  } else {
    // a node contributing no field may contribute no episode row either: they stay inside the
    // claim's node, byte for byte, and are counted so the rule's cost is a number (4.2 step 6)
    batch.declinedEpisodes += episodes.length
  }

  if (options.viaPartOf || options.depth <= 0) return address.uri

  for (const handle of Array.isArray(value.handles) ? value.handles : []) {
    if (!isRecord(handle) || !isRecord(handle.node)) {
      // a handle naming no node claims nothing, and one of them must not fail the batch every
      // extractor's rows share (2026-09-05, the nyaa package on the deployed site)
      batch.handlesWithNoNode += 1
      continue
    }
    const kind = typeof handle.relation === 'string' && CLAIM_KINDS.has(handle.relation) ? handle.relation : 'SAME_AS'
    const toUri = visitMedia(batch, answer, handle.node, { depth: options.depth - 1, viaPartOf: kind === 'PART_OF' })
    if (!toUri) continue
    addClaim(batch, batch.claims, {
      fromUri: address.uri,
      toUri,
      kind,
      provenance: provenanceOf(answer.origin, kind, handle, originOfUri(toUri)),
      claimer: answer.origin,
      targetScope: scopeStampOf(handle.node),
      answerSeq: answer.seq,
    }, handle.node)
  }
  return address.uri
}

/**
 * Every answer in the batch as rows, claims and edges. Total: a row it cannot read is quarantined and
 * the rest of the batch lands.
 *
 * `raw` is read as text, which is what the log stores, and as an already-parsed value when a caller
 * hands one over. Either way it is proven expressible as JSON before anything is built from it: a
 * payload that points at itself, or carries a BigInt, cannot be stored as `Media.raw` at all, and the
 * log refused it for the same reason (`answers.ts`'s own catch), so it is one quarantined row rather
 * than a throw halfway through a batch.
 */
const decompose = (rows: AnswerRow[]): Batch => {
  const batch: Batch = {
    answers: [],
    media: new Map(), episodes: new Map(), origins: new Map(),
    claims: new Map(), episodeClaims: new Map(), hasEpisode: new Map(), related: new Map(),
    about: [], quarantined: [], declinedEpisodes: 0, handlesWithNoNode: 0,
  }

  for (const row of rows) {
    let value: unknown
    try {
      value = typeof row.raw === 'string' ? JSON.parse(row.raw) : JSON.parse(JSON.stringify(row.raw))
    } catch {
      quarantine(batch, row.key ?? '', row.uri ?? '', 'raw is not JSON')
      continue
    }
    if (!isRecord(value)) {
      quarantine(batch, row.key ?? '', row.uri ?? '', 'raw is not a row')
      continue
    }
    if (!row.key || typeof row.seq !== 'number') {
      quarantine(batch, row.key ?? '', row.uri ?? '', 'the answer carries no key or no seq')
      continue
    }

    if (row.kind === 'origin') {
      const id = typeof value.id === 'string' && value.id ? value.id : row.uri
      if (!id) {
        quarantine(batch, row.key, '', 'an origin carries no id')
        continue
      }
      const draft = batch.origins.get(id) ?? { uri: id, origin: id, id, owned: true, stamp: null, contributions: [] }
      draft.contributions.push({ seq: row.seq, value })
      batch.origins.set(id, draft)
      batch.answers.push(row)
      batch.about.push({ key: row.key, uri: id, kind: 'origin' })
      continue
    }

    if (row.kind === 'episode') {
      visitEpisode(batch, row, value, true)
      const address = addressOf(value)
      // an unaddressable row is already quarantined, and there is nothing for its answer to be ABOUT
      if (!address) continue
      batch.answers.push(row)
      batch.about.push({ key: row.key, uri: address.uri, kind: 'episode' })
      continue
    }

    const uri = visitMedia(batch, row, value, { depth: HANDLE_DEPTH, viaPartOf: false })
    if (!uri) continue
    batch.answers.push(row)
    batch.about.push({ key: row.key, uri, kind: 'media' })
  }

  return batch
}

type ExistingRow = { raw: string | null, hash: string | null, owned: boolean, fieldSeq: Record<string, number> | null }
type ExistingClaim = { key: string, node: string | null, hash: string | null, answerSeq: number | null }

const chunked = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

// One statement carries the whole batch, and a batch is the unwrapped row count rather than the
// loader's 250, so it is routinely thousands. Chunked only so one statement's param list stays a size
// the engine's binder is known to take: 2,000 rows measured at 434 ms through MERGE (2026-09-12).
const CHUNK = 2000

const runChunked = async (
  query: (cypher: string, params?: Record<string, unknown>) => Promise<unknown>,
  cypher: string,
  rows: Record<string, unknown>[],
  name = 'rows'
): Promise<number> => {
  // `$separator` rides every write: the list columns are split out of joined strings, and a param
  // the statement does not name is simply unused
  for (const chunk of chunked(rows, CHUNK)) await query(cypher, { separator: LIST_SEPARATOR, [name]: chunk })
  return rows.length
}

// One number per commit, on every row and edge the commit writes, so the audit of 5.3 can bound
// itself on a window the ingest is not still moving.
let commitSeq = 0

const ingestBatch = async (rows: AnswerRow[]): Promise<IngestReport> => {
  const started = Date.now()
  const batch = decompose(rows)
  const written: Record<string, number> = {}
  const changed: IngestChanged = { media: [], claims: [], episodes: [], raw: [] }
  const report = (): IngestReport => ({
    answers: rows.length,
    quarantined: batch.quarantined,
    changed,
    written,
    declinedEpisodes: batch.declinedEpisodes,
    handlesWithNoNode: batch.handlesWithNoNode,
    ms: Date.now() - started,
  })

  const empty = !batch.answers.length && !batch.media.size && !batch.episodes.size && !batch.origins.size
  if (empty) return report()

  const { query } = await graphReady()
  const seq = String(++commitSeq)

  // ONE READ PER TABLE, never per row (4.2 step 2). The engine's binder takes one statement per
  // prepare, so "one round trip" is spelled as one statement for each thing the batch touches, and
  // what comes back is what makes `changed` computable at all: MERGE reports no newness.
  const answerKeys = batch.answers.map(row => row.key)
  const seenAnswers = new Set<string>()
  for (const chunk of chunked(answerKeys, CHUNK)) {
    const seen = await query('UNWIND $keys AS k MATCH (a:Answer {key: k}) RETURN a.key AS key', { keys: chunk })
    for (const row of seen) seenAnswers.add(row.key as string)
  }

  const mediaUris = [...batch.media.keys()]
  const existingMedia = new Map<string, ExistingRow>()
  for (const chunk of chunked(mediaUris, CHUNK)) {
    const found = await query(
      'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri, m.raw AS raw, m.hash AS hash, m.owned AS owned, m.fieldSeq AS fieldSeq',
      { uris: chunk }
    )
    for (const row of found) {
      existingMedia.set(row.uri as string, {
        raw: (row.raw as string | null) ?? null,
        hash: (row.hash as string | null) ?? null,
        owned: row.owned === true,
        fieldSeq: (row.fieldSeq as Record<string, number> | null) ?? null,
      })
    }
  }

  const episodeUris = [...batch.episodes.keys()]
  const existingEpisodes = new Map<string, ExistingRow>()
  for (const chunk of chunked(episodeUris, CHUNK)) {
    const found = await query(
      'UNWIND $uris AS u MATCH (e:Episode {uri: u}) RETURN e.uri AS uri, e.raw AS raw, e.hash AS hash, e.fieldSeq AS fieldSeq',
      { uris: chunk }
    )
    for (const row of found) {
      existingEpisodes.set(row.uri as string, {
        raw: (row.raw as string | null) ?? null,
        hash: (row.hash as string | null) ?? null,
        owned: true,
        fieldSeq: (row.fieldSeq as Record<string, number> | null) ?? null,
      })
    }
  }

  const originIds = [...batch.origins.keys()]
  const existingOrigins = new Map<string, ExistingRow>()
  for (const chunk of chunked(originIds, CHUNK)) {
    const found = await query('UNWIND $ids AS i MATCH (o:Origin {id: i}) RETURN o.id AS id, o.raw AS raw, o.hash AS hash', { ids: chunk })
    for (const row of found) {
      existingOrigins.set(row.id as string, { raw: (row.raw as string | null) ?? null, hash: (row.hash as string | null) ?? null, owned: true, fieldSeq: null })
    }
  }

  // the edge keys are content hashes, computed once per unique edge rather than per mention
  const claimKeys = new Map<string, string>()
  await Promise.all([...batch.claims.keys()].map(async composite => {
    claimKeys.set(composite, await sha256Hex(composite))
  }))
  const episodeClaimKeys = new Map<string, string>()
  await Promise.all([...batch.episodeClaims.keys()].map(async composite => {
    episodeClaimKeys.set(composite, await sha256Hex(composite))
  }))
  const hasEpisodeKeys = new Map<string, string>()
  await Promise.all([...batch.hasEpisode.keys()].map(async composite => {
    hasEpisodeKeys.set(composite, await sha256Hex(composite))
  }))

  const existingClaims = new Map<string, ExistingClaim>()
  for (const chunk of chunked([...claimKeys.values()], CHUNK)) {
    const found = await query(
      'UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media) RETURN c.key AS key, c.node AS node, c.hash AS hash, c.answerSeq AS answerSeq',
      { keys: chunk }
    )
    for (const row of found) existingClaims.set(row.key as string, row as unknown as ExistingClaim)
  }
  const existingEpisodeClaims = new Set<string>()
  for (const chunk of chunked([...episodeClaimKeys.values()], CHUNK)) {
    const found = await query('UNWIND $keys AS k MATCH (a:Episode)-[c:EPISODE_CLAIMS {key: k}]->(b:Episode) RETURN c.key AS key', { keys: chunk })
    for (const row of found) existingEpisodeClaims.add(row.key as string)
  }
  const existingHasEpisode = new Set<string>()
  for (const chunk of chunked([...hasEpisodeKeys.values()], CHUNK)) {
    const found = await query('UNWIND $keys AS k MATCH (m:Media)-[h:HAS_EPISODE {key: k}]->(e:Episode) RETURN h.key AS key', { keys: chunk })
    for (const row of found) existingHasEpisode.add(row.key as string)
  }

  // ANSWERS. The live path wrote them a moment ago, so this is a no-op there; a replay from a dump
  // arrives with none of them in the table, and the log has to be there for `ABOUT` to attach to.
  const newAnswers = batch.answers.filter(row => !seenAnswers.has(row.key))
  if (newAnswers.length) {
    written.Answer = await runChunked(query,
      `UNWIND $rows AS r
       CREATE (:Answer {key: r.key, seq: cast(r.seq AS INT64), uri: r.uri, origin: r.origin, kind: r.kind,
                        operation: r.operation, selection: ${stringListOf('selection')}, raw: r.raw})`,
      newAnswers.map(row => ({
        key: row.key, seq: String(row.seq), uri: row.uri, origin: row.origin, kind: row.kind,
        operation: row.operation, selection: (row.selection ?? []).join(LIST_SEPARATOR), raw: row.raw,
      })))
  }

  // ORIGINS. `origin:changed` is deliberately NOT emitted here: the old store still owns that event
  // while the tee runs, and firing a second one would wake every origin subscription twice.
  const originRows: Record<string, unknown>[] = []
  for (const [id, draft] of batch.origins) {
    const existing = existingOrigins.get(id)
    const previous = existing?.raw ? JSON.parse(existing.raw) as Record<string, unknown> : undefined
    const fieldSeq: Record<string, number> = {}
    const merged = foldContributions(draft.contributions, previous, fieldSeq)
    const hash = await contentHash(merged)
    if (existing?.hash === hash) continue
    originRows.push({ id, raw: JSON.stringify(merged), hash, seq })
  }
  if (originRows.length) {
    written.Origin = await runChunked(query,
      `UNWIND $rows AS r
       MERGE (o:Origin {id: r.id})
       ON CREATE SET o.raw = r.raw, o.hash = r.hash, o.seq = cast(r.seq AS INT64)
       ON MATCH SET o.raw = r.raw, o.hash = r.hash, o.seq = cast(r.seq AS INT64)`,
      originRows)
  }

  // MEDIA. The owner's merged row first, then every uri this batch merely named, as a placeholder.
  const ownedRows: Record<string, unknown>[] = []
  const placeholderRows: Record<string, unknown>[] = []
  for (const [uri, draft] of batch.media) {
    const existing = existingMedia.get(uri)
    if (!draft.owned || !draft.contributions.length) {
      // A PLACEHOLDER IS WRITTEN ON FIRST NAMING AND NEVER OVERWRITTEN (4.3). It replaces
      // `pendingClaims` (`db.ts:124-130`): the row is an anchor so the claim edge can be written at
      // once, and arrival order decides nothing because every pass recomputes from the same evidence.
      if (existing) continue
      placeholderRows.push({ uri, origin: draft.origin, id: draft.id, scope: draft.stamp, seq })
      changed.media.push(uri)
      continue
    }
    const previous = existing?.raw ? JSON.parse(existing.raw) as Record<string, unknown> : undefined
    const fieldSeq: Record<string, number> = { ...existing?.fieldSeq }
    const merged = foldContributions(draft.contributions, previous, fieldSeq)
    const hash = await contentHash(merged)
    if (existing?.hash === hash && existing.owned) continue
    const projection = mediaProjection(merged)
    ownedRows.push({
      uri, origin: draft.origin, id: draft.id, owned: 'true', raw: JSON.stringify(merged),
      ...projection,
      fieldKeys: Object.keys(fieldSeq).join(LIST_SEPARATOR),
      fieldSeqs: Object.values(fieldSeq).map(String).join(LIST_SEPARATOR),
      hash, seq,
    })
    // a new row, or one whose typed columns moved, is what a plugin reads; a change confined to
    // `raw` only re-materializes the JSON a cluster already holds (4.5)
    const moved = !existing || !existing.owned || !previous || !sameProjection(projection, mediaProjection(previous))
    if (moved) changed.media.push(uri)
    else changed.raw.push(uri)
  }
  if (placeholderRows.length) {
    written.MediaPlaceholder = await runChunked(query,
      `UNWIND $rows AS r
       MERGE (m:Media {uri: r.uri})
       ON CREATE SET m.origin = r.origin, m.id = r.id, m.owned = false, m.scope = r.scope, m.seq = cast(r.seq AS INT64)`,
      placeholderRows)
  }
  if (ownedRows.length) {
    const columns = `m.origin = r.origin, m.id = r.id, m.owned = cast(r.owned AS BOOLEAN), m.scope = r.scope,
       m.raw = r.raw, m.score = cast(r.score AS DOUBLE), m.episodeCount = cast(r.episodeCount AS INT64),
       m.startDate = r.startDate, m.endDate = r.endDate, m.type = r.type, m.status = r.status,
       m.season = r.season, m.seasonYear = cast(r.seasonYear AS INT64), m.titles = r.titles,
       m.categories = ${stringListOf('categories')},
       m.fieldSeq = ${FIELD_SEQ},
       m.hash = r.hash, m.seq = cast(r.seq AS INT64)`
    written.Media = await runChunked(query,
      `UNWIND $rows AS r MERGE (m:Media {uri: r.uri}) ON CREATE SET ${columns} ON MATCH SET ${columns}`,
      ownedRows)
  }

  // EPISODES, the same shape: the owner's merged row, and a placeholder for an episode a handle names.
  const episodeRows: Record<string, unknown>[] = []
  const episodePlaceholders: Record<string, unknown>[] = []
  for (const [uri, draft] of batch.episodes) {
    const existing = existingEpisodes.get(uri)
    if (!draft.contributions.length) {
      if (existing) continue
      episodePlaceholders.push({ uri, origin: draft.origin, id: draft.id, mediaUri: draft.mediaUri, seq })
      continue
    }
    const previous = existing?.raw ? JSON.parse(existing.raw) as Record<string, unknown> : undefined
    const fieldSeq: Record<string, number> = { ...existing?.fieldSeq }
    const merged = foldContributions(draft.contributions, previous, fieldSeq, mergeEpisodeFields)
    const hash = await contentHash(merged)
    if (existing?.hash === hash) continue
    const projection = episodeProjection(merged)
    episodeRows.push({
      uri, origin: draft.origin, id: draft.id, raw: JSON.stringify(merged),
      ...projection,
      fieldKeys: Object.keys(fieldSeq).join(LIST_SEPARATOR),
      fieldSeqs: Object.values(fieldSeq).map(String).join(LIST_SEPARATOR),
      hash, seq,
    })
    if (!existing || !previous || !sameProjection(projection, episodeProjection(previous))) {
      if (projection.mediaUri) changed.media.push(projection.mediaUri)
    }
  }
  if (episodePlaceholders.length) {
    written.EpisodePlaceholder = await runChunked(query,
      `UNWIND $rows AS r
       MERGE (e:Episode {uri: r.uri})
       ON CREATE SET e.origin = r.origin, e.id = r.id, e.mediaUri = r.mediaUri, e.seq = cast(r.seq AS INT64)`,
      episodePlaceholders)
  }
  if (episodeRows.length) {
    const columns = `e.origin = r.origin, e.id = r.id, e.mediaUri = r.mediaUri, e.raw = r.raw,
       e.episodeNumber = cast(r.episodeNumber AS INT64), e.seasonNumber = cast(r.seasonNumber AS INT64),
       e.absoluteEpisodeNumber = cast(r.absoluteEpisodeNumber AS INT64), e.releaseDate = r.releaseDate,
       e.titles = r.titles, e.fieldSeq = ${FIELD_SEQ},
       e.hash = r.hash, e.seq = cast(r.seq AS INT64)`
    written.Episode = await runChunked(query,
      `UNWIND $rows AS r MERGE (e:Episode {uri: r.uri}) ON CREATE SET ${columns} ON MATCH SET ${columns}`,
      episodeRows)
  }

  // CLAIMS. Written in the exercised form, never by relationship MERGE: MATCH both ends, refuse the
  // pair that already carries this key, CREATE the rest.
  const newClaims: Record<string, unknown>[] = []
  const reasserted: Record<string, unknown>[] = []
  for (const [composite, draft] of batch.claims) {
    const key = claimKeys.get(composite)!
    const existing = existingClaims.get(key)
    const previous = existing?.node ? JSON.parse(existing.node) as Record<string, unknown> : undefined
    const fieldSeq: Record<string, number> = {}
    const node = foldContributions(draft.contributions, previous, fieldSeq)
    const hash = await contentHash(node)
    const row = {
      key, fromUri: draft.fromUri, toUri: draft.toUri, kind: draft.kind, provenance: draft.provenance,
      claimer: draft.claimer, targetScope: draft.targetScope, node: JSON.stringify(node), hash,
      answerSeq: String(draft.answerSeq), seq,
    }
    if (!existing) {
      newClaims.push(row)
      changed.claims.push(key)
      continue
    }
    // a claimer's second, richer answer about a pair refreshes its description rather than being
    // pinned to its first, poorest node; one whose node did not change fires nothing
    if (existing.hash === hash) continue
    // 4.2 step 6 spells the guard `c.answerSeq < h.answerSeq` in Cypher. Here the decision is already
    // made, above, by comparing the two hashes, and the stored node is what the incoming one was
    // folded onto, so the guard could only refuse a write the row still needs: a late answer with a
    // LOWER seq that added a field would leave the stored hash stale and make every later replay
    // report the same change again. The seq ratchets instead, and never moves backwards.
    reasserted.push({ ...row, answerSeq: String(Math.max(draft.answerSeq, existing.answerSeq ?? 0)) })
    changed.raw.push(draft.toUri)
  }
  if (newClaims.length) {
    written.CLAIMS = await runChunked(query,
      `UNWIND $rows AS h
       MATCH (a:Media {uri: h.fromUri}), (b:Media {uri: h.toUri})
       WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: h.key}]->(b) }
       CREATE (a)-[:CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer,
         targetScope: h.targetScope, node: h.node, hash: h.hash,
         answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)`,
      newClaims)
  }
  if (reasserted.length) {
    written.CLAIMS_REASSERTED = await runChunked(query,
      `UNWIND $rows AS h
       MATCH (a:Media {uri: h.fromUri})-[c:CLAIMS {key: h.key}]->(b:Media {uri: h.toUri})
       SET c.node = h.node, c.hash = h.hash, c.answerSeq = cast(h.answerSeq AS INT64), c.seq = cast(h.seq AS INT64)`,
      reasserted)
  }

  const newEpisodeClaims: Record<string, unknown>[] = []
  for (const [composite, draft] of batch.episodeClaims) {
    const key = episodeClaimKeys.get(composite)!
    if (existingEpisodeClaims.has(key)) continue
    const fieldSeq: Record<string, number> = {}
    const node = foldContributions(draft.contributions, undefined, fieldSeq)
    newEpisodeClaims.push({
      key, fromUri: draft.fromUri, toUri: draft.toUri, kind: draft.kind, provenance: draft.provenance,
      claimer: draft.claimer, node: JSON.stringify(node), answerSeq: String(draft.answerSeq), seq,
    })
  }
  if (newEpisodeClaims.length) {
    written.EPISODE_CLAIMS = await runChunked(query,
      `UNWIND $rows AS h
       MATCH (a:Episode {uri: h.fromUri}), (b:Episode {uri: h.toUri})
       WHERE NOT EXISTS { MATCH (a)-[:EPISODE_CLAIMS {key: h.key}]->(b) }
       CREATE (a)-[:EPISODE_CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer,
         node: h.node, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)`,
      newEpisodeClaims)
  }

  const newHasEpisode: Record<string, unknown>[] = []
  for (const [composite, draft] of batch.hasEpisode) {
    const key = hasEpisodeKeys.get(composite)!
    if (existingHasEpisode.has(key)) continue
    newHasEpisode.push({ key, fromUri: draft.fromUri, toUri: draft.toUri, claimer: draft.claimer, answerSeq: String(draft.answerSeq), seq })
    // the EPISODE's uri, which is what a scan looks its row up by; the media is a delta too, since
    // its own profile counts the episodes it owns
    changed.episodes.push(draft.toUri)
    changed.media.push(draft.fromUri)
  }
  if (newHasEpisode.length) {
    written.HAS_EPISODE = await runChunked(query,
      `UNWIND $rows AS h
       MATCH (m:Media {uri: h.fromUri}), (e:Episode {uri: h.toUri})
       WHERE NOT EXISTS { MATCH (m)-[:HAS_EPISODE {key: h.key}]->(e) }
       CREATE (m)-[:HAS_EPISODE {key: h.key, claimer: h.claimer, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(e)`,
      newHasEpisode)
  }

  // RELATED carries no key of its own (2.1), so the pair plus the relation plus the claimer is its
  // identity, and it is read back the same way everything else is: a statement that ran with nothing
  // to write would otherwise report a write it did not make, on every replay, forever.
  const newRelated: RelatedDraft[] = []
  if (batch.related.size) {
    const seenRelated = new Set<string>()
    const probes = [...batch.related.values()].map(draft => ({
      fromUri: draft.fromUri, toUri: draft.toUri, relation: draft.relation, claimer: draft.claimer,
    }))
    for (const chunk of chunked(probes, CHUNK)) {
      const found = await query(
        `UNWIND $rows AS r
         MATCH (a:Media {uri: r.fromUri})-[e:RELATED {relation: r.relation, claimer: r.claimer}]->(b:Media {uri: r.toUri})
         RETURN a.uri AS fromUri, b.uri AS toUri, e.relation AS relation, e.claimer AS claimer`,
        { rows: chunk }
      )
      for (const row of found) seenRelated.add(`${row.fromUri}\0${row.toUri}\0${row.relation}\0${row.claimer}`)
    }
    for (const [key, draft] of batch.related) if (!seenRelated.has(key)) newRelated.push(draft)
  }
  if (newRelated.length) {
    written.RELATED = await runChunked(query,
      `UNWIND $rows AS r
       MATCH (a:Media {uri: r.fromUri}), (b:Media {uri: r.toUri})
       WHERE NOT EXISTS { MATCH (a)-[:RELATED {relation: r.relation, claimer: r.claimer}]->(b) }
       CREATE (a)-[:RELATED {relation: r.relation, format: r.format, claimer: r.claimer, node: r.node,
         answerSeq: cast(r.answerSeq AS INT64)}]->(b)`,
      newRelated.map(draft => ({
        fromUri: draft.fromUri, toUri: draft.toUri, relation: draft.relation, format: draft.format,
        claimer: draft.claimer, node: JSON.stringify(draft.node), answerSeq: String(draft.answerSeq),
      })))
  }

  // ABOUT, one statement per FROM/TO pair the table declares, since the pattern has to name a label.
  // Which answers already carry one is read back rather than inferred from what THIS commit created:
  // on the live path the log wrote every `Answer` row a moment before the ingest saw it, so a filter
  // on newness writes no edge at all, and the table sat empty on a real page while every other one
  // filled (measured by the browser arm of `scripts/check-graph-engine.mjs`, 2026-09-12).
  const aboutTargets = [
    { kind: 'media' as const, label: 'Media', field: 'uri' },
    { kind: 'episode' as const, label: 'Episode', field: 'uri' },
    { kind: 'origin' as const, label: 'Origin', field: 'id' },
  ]
  const described = new Set<string>()
  for (const chunk of chunked(answerKeys, CHUNK)) {
    const found = await query('UNWIND $keys AS k MATCH (a:Answer {key: k})-[:ABOUT]->() RETURN a.key AS key', { keys: chunk })
    for (const row of found) described.add(row.key as string)
  }
  for (const target of aboutTargets) {
    const rowsFor = batch.about.filter(entry => entry.kind === target.kind && !described.has(entry.key))
    if (!rowsFor.length) continue
    written.ABOUT = (written.ABOUT ?? 0) + await runChunked(query,
      `UNWIND $rows AS r
       MATCH (a:Answer {key: r.key}), (n:${target.label} {${target.field}: r.uri})
       WHERE NOT EXISTS { MATCH (a)-[:ABOUT]->(n) }
       CREATE (a)-[:ABOUT]->(n)`,
      rowsFor.map(entry => ({ key: entry.key, uri: entry.uri })))
    // a new answer about a media row is a delta for it even when the row itself did not move, since
    // a profile reads the answers about its subject (`IngestChanged.media`). An episode profile
    // reads its own row only, and an origin has no profile, so only this target names one.
    if (target.kind === 'media') for (const entry of rowsFor) changed.media.push(entry.uri)
  }

  // EVENTS, inert while the flag is off because nothing listens yet (step 2 is the first listener).
  // A structural change wakes a pass; a change confined to `raw` wakes only the re-materialization,
  // so a uri that moved structurally is never also reported as raw-only.
  const structural = new Set(changed.media)
  changed.media = [...structural]
  changed.episodes = [...new Set(changed.episodes)]
  changed.raw = [...new Set(changed.raw)].filter(uri => !structural.has(uri))
  if (changed.media.length || changed.claims.length || changed.episodes.length) {
    // the three lists a scoped pass takes its subjects from, not the uris alone: a commit whose only
    // change is a claim or an episode carries an EMPTY `uris` and still has to say what moved
    emit('graph:changed', { seq: commitSeq, uris: changed.media, episodes: changed.episodes, claims: changed.claims })
  }
  if (changed.raw.length) emit('row:changed', { uris: changed.raw })

  return report()
}

// The serial queue of 4.2: one writer owns the source tables, so two flushes can never interleave on
// the one shared connection.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Write one batch of answers into the graph, and say what moved.
 *
 * The rows are the ones a flush WROTE: an answer already in the log is not handed here, which is why
 * a byte-identical re-fetch costs nothing. Feeding the same rows twice is safe and reports an empty
 * `changed`, which is what a replay of a recorded page asserts. It throws only when the engine
 * refuses a statement; a row it cannot read is quarantined, never thrown.
 */
export const ingestAnswers = (rows: AnswerRow[]): Promise<IngestReport> => {
  const next = queue.then(() => ingestBatch(rows))
  queue = next.catch(() => undefined)
  return next
}

/**
 * The replay half of the one code path: rows off a dump, through the same ingest.
 *
 * It exists as a name rather than as a second implementation, so a caller reading
 * `scripts/replay-answers.mjs` or the fixture corpus can see that nothing about a replay is special.
 */
export const replayAnswers = (rows: AnswerRow[]): Promise<IngestReport> => ingestAnswers(rows)

/**
 * One claim the app's own consumer made out of a `similarMedia` answer it accepted (3.3, 4.4).
 *
 * `kind` is the whole of the difference the answer carries: a sameness answer is `SAME_AS`, and a
 * `containing` answer is `PART_OF` from the run to the season that holds it and NEVER sameness.
 * `claimer` is the origin that answered, so the claim reads like any other statement of that origin's,
 * and `targetScope` is the scope that origin stamped on its own row rather than anything the consumer
 * inferred: a containing answer is an edge, not a re-scoping of the season it names.
 */
export type AskClaim = {
  /** The run the question was asked for (`Ask.runUri`). */
  fromUri: string
  /** The answering origin's row. */
  toUri: string
  kind: 'SAME_AS' | 'PART_OF'
  claimer: string
  targetScope: string | null
  /** The claimer's description of the target, as `CLAIMS.node` (2.1). */
  node: Record<string, unknown>
}

/** What one `writeAskClaim` did: false when the pair already carried this exact claim. */
export type AskClaimReport = { key: string, written: boolean, placeholders: string[] }

const askClaimBatch = async (claim: AskClaim): Promise<AskClaimReport> => {
  const { query } = await graphReady()
  // the same composite the ingest keys a claim on, so an ask claim and a source claim about one pair
  // are two rows rather than one, and re-asking writes neither twice
  const key = await sha256Hex([claim.fromUri, claim.toUri, claim.kind, claim.claimer, 'ask'].join(CLAIM_SEPARATOR))
  const [existing] = await query('MATCH (a:Media)-[c:CLAIMS {key: $key}]->(b:Media) RETURN c.key AS key', { key })
  if (existing) return { key, written: false, placeholders: [] }

  const seq = String(++commitSeq)
  // Both ends get a placeholder when no answer has described them yet, which is the owner rule of 4.3
  // read from the other side: a claim may name a row nobody owns, and the anchor is what the answer
  // merges onto when the answering extractor's own row lands. `scope` is the claimer's stamp and
  // NULL for the run, whose scope is its owner's word alone.
  const ends = [
    { uri: claim.fromUri, scope: null },
    { uri: claim.toUri, scope: claim.targetScope },
  ]
  const present = new Set((await query(
    'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri',
    { uris: ends.map(end => end.uri) }
  )).map(row => row.uri as string))
  const placeholders = ends.filter(end => !present.has(end.uri))
  if (placeholders.length) {
    await query(
      `UNWIND $rows AS r
       MERGE (m:Media {uri: r.uri})
       ON CREATE SET m.origin = r.origin, m.id = r.id, m.owned = false, m.scope = r.scope, m.seq = cast(r.seq AS INT64)`,
      { rows: placeholders.map(end => ({ uri: end.uri, origin: originOfUri(end.uri), id: idOfUri(end.uri), scope: end.scope, seq })) }
    )
  }

  await query(
    `UNWIND $rows AS h
     MATCH (a:Media {uri: h.fromUri}), (b:Media {uri: h.toUri})
     WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: h.key}]->(b) }
     CREATE (a)-[:CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer,
       targetScope: h.targetScope, node: h.node, hash: h.hash,
       answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)`,
    {
      rows: [{
        key, fromUri: claim.fromUri, toUri: claim.toUri, kind: claim.kind, provenance: 'ask',
        claimer: claim.claimer, targetScope: claim.targetScope, node: JSON.stringify(claim.node),
        hash: await contentHash(claim.node),
        // an ask claim came out of NO `Answer`: the consumer made it, and the `Ask` row is its record
        // (7.3). Zero says so, where any other number would point a trace at somebody else's answer
        answerSeq: '0',
        seq,
      }],
    }
  )
  emit('graph:changed', { seq: commitSeq, uris: placeholders.map(end => end.uri), episodes: [], claims: [key] })
  return { key, written: true, placeholders: placeholders.map(end => end.uri) }
}

/**
 * Every RUN this cluster already holds in the GRAPH, its own member included. Empty when no cluster
 * has formed for `runUri` yet.
 *
 * The gate on the claim above, and it lives beside the writer on purpose. The consumer's gate used to
 * be `findAggregatedMedia`, which reads the OLD store, so on `?store=graph` the decision and the write
 * were about two different stores: the old store unions a Netflix season in off the route's address
 * alone, the graph refuses the same row entry because an address asserts nothing (3.3), and the
 * consumer therefore concluded the cluster already had what the graph did not have and wrote no claim.
 * A gate and a writer that disagree about which store is authoritative is the bug; one module is how
 * it stays fixed.
 *
 * A cluster that does not exist yet answers an empty list, which is the safe direction: the question
 * is asked and the claim written, and the writer's own guards, not this, decide whether the graph
 * takes the edge.
 *
 * CONTAINERS ARE NOT RUNS. A show, the bare `nf:<id>`, is a member of nothing the run is in and is
 * excluded by scope besides, so a title hanging off the cluster never reads as an answer to "does
 * this cluster already hold a Netflix run".
 */
export const clusterRunsOf = async (runUri: string): Promise<{ uri: string, origin: string }[]> => {
  const { query } = await graphReady()
  const rows = await query(
    `MATCH (m:Media {uri: $runUri})-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(o:Media)
     WHERE o.scope IS NULL OR o.scope <> 'CONTAINER'
     RETURN o.uri AS uri, o.origin AS origin`,
    { runUri }
  )
  const seen = new Set<string>()
  return rows
    .map(row => ({ uri: String(row.uri), origin: String(row.origin) }))
    .filter(run => !seen.has(run.uri) && seen.add(run.uri))
    .sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)
}

/**
 * Write one `ask` claim, or report that the pair already carries it.
 *
 * The one write into the source tables that is NOT the ingest's, and it is here rather than in the
 * consumer so it shares the serial queue: two writers on the one connection interleave otherwise.
 * It promises that the claim is consumed exactly as a `source` claim is (`plugin:direct` reads only
 * `provenance = 'address'` as a reason to skip a claim, and `plugin:profile`'s scope vote counts
 * `source` and `ask` alike), that re-asking a settled pair writes nothing and emits nothing, and that
 * it never invents a row: an end no answer has described gets a placeholder and no fields.
 *
 * It throws only when the engine refuses a statement. The caller is the app's own consumer, whose
 * asking must not depend on a database being happy, so it catches.
 */
export const writeAskClaim = (claim: AskClaim): Promise<AskClaimReport> => {
  const next = queue.then(() => askClaimBatch(claim))
  queue = next.catch(() => undefined)
  return next
}
