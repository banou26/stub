// The one place the app asks `similarMedia`: on a run's page, after aggregation, per (run cluster,
// container) pair, re-asked only when the question changes.
//
// The ask lives HERE rather than inside each source's resolver because a source sees only its own
// view (kitsu has titles, a date and a count but no episode titles at handle time; justwatch would ask
// with JustWatch's numbering, the very collision under repair), asks on every operation unless it
// remembers the policy, and asks only for the pointers it happens to hold. The worker sees the whole
// cluster: the best day-precise date across members, every title, the highest-scored episode count,
// ani.zip's episode titles, and every container the run is PART_OF whatever source or fuzzy pass
// produced the edge. `Subscription.media` is the only caller, which is what keeps this off listings.
//
// Pure of the extractor on purpose: worker/extractor.ts cannot load under vitest, so the asking and
// the claiming are here and the resolver only wires them.
//
// Every question that is SENT, and what it came to, goes into the `Ask` log (`./graph/asks.ts`,
// section 7.3) behind the `?graph` flag, so a page with no Crunchyroll button can say whether the
// origin was never asked, asked and refused, or asked and declined. The log is fire and forget and
// changes nothing the consumer does: see `note`.
//
// An answer the consumer ACCEPTS is additionally written into the graph as a claim stamped
// `provenance: 'ask'` (3.3, 4.4, migration step 4): `SAME_AS` for an answer that IS the run, `PART_OF`
// for a `containing` answer that merely holds it. The log row is not the claim and the claim is not
// the log row: a declined or refused ask writes its row and no claim, which is how "asked and turned
// down" stays a different fact from "never asked". See `claim`.
import type { SimilarMediaInput } from '../generated/schema/types.generated'
import type { AskOutcome } from './graph/asks'
import type { Media } from './store/types'
import type { RequestContext } from './request-context'

import { findAggregatedEpisodesForMedia, findAggregatedMedia, findClaimedMedia, findClaimedShows, findPartOfMedia, upsertMedia } from './store/db'
import { clusterRunsOf, writeAskClaim } from './graph/ingest'
import { graphEnabled } from './graph/engine'
import { readStore } from './graph/read'
import { recordAsk } from './graph/asks'
import { toAggregatedUri } from '../utils/uri'
import { runLength } from './store/consensus'
import {
  answerNamesOurShow,
  bestRunStartDate,
  describeEvidence,
  hasEvidence,
  similarAskKey,
  SHOW_TITLE_THRESHOLD,
  type RunEvidence,
  type SimilarAnswerMedia,
  type SimilarOutcome,
} from '../sources/similar'
import { isOnlySeasonLabel } from '../sources/season'
import { simplifyTitle, TITLE_MATCH_THRESHOLD } from '../sources/utils'
import { policyFor } from './request-context'

export type SimilarAsk = { runUri: string, origin: string, showId: string, containerUri: string }

export type SimilarDeps = {
  ask: (origin: string, input: SimilarMediaInput) => Promise<SimilarOutcome>
  implemented: (origin: string) => boolean
  /** Called when a pair already has an ask in flight from another run, which this run then waits out. */
  wait?: () => void
}

/** How many times one (run cluster, container) pair is asked in a session; see `drive` for the count. */
export const MAX_ASKS_PER_PAIR = 4

type Question = {
  /** the source's question, `similarAskKey`: everything the answering source reads */
  fingerprint: string
  /** the run's titles as one key, which only the which-show check reads */
  titles: string
  /** the cluster this question was built from, as its aggregated uri; the `Ask` log's `clusterId` */
  clusterId: string
  evidence: RunEvidence
  ask: SimilarAsk
}

type AskRecord = {
  /** every uri seen in this run cluster, unioned over reads and over cluster merges, never replaced */
  members: Set<string>
  /** questions already put to this container and REFUSED by the source, so the same one is not asked twice */
  fingerprints: Set<string>
  /**
   * title sets an answer was checked against and did not name our show. Kept apart from the
   * fingerprints: more evidence about the SEASON cannot change the show an answer names, so it asks
   * nothing, while a title landing later can, so it asks again
   */
  refusedTitles: Set<string>
  /** asks that reached `deps.ask`, declines included; the cap reads this */
  asks: number
  /** an answer was claimed, another run of the origin is already in the cluster, or the cap was reached */
  settled: boolean
  /**
   * the driver holding this record's one ask in flight, so two answers can never be claimed for one
   * run; it settles once that driver is done
   */
  driver?: Promise<void>
  /** the record this one was folded into by `recordFor`; a driver resumed on the old record follows it */
  mergedInto?: AskRecord
  /** the newest question a read computed, asked once the in-flight ask settles if it is still new */
  latest?: Question
  /** the one-time skip line was printed */
  skipLogged: boolean
}

/** keyed by container uri; one record per run cluster hanging off that container */
const records = new Map<string, AskRecord[]>()

const ownerOf = (record: AskRecord): AskRecord => {
  while (record.mergedInto) record = record.mergedInto
  return record
}

// A record is found by MEMBER INTERSECTION rather than by `graph.componentId`: `carryComponentId`
// keeps one of the two ids on a union, so a record keyed on the id that did not survive would be
// orphaned and re-asked. Two records both intersecting the cluster are two clusters that were
// unioned since they were last read, and they merge here. The absorbed record keeps a pointer to the
// survivor: its driver, if one is mid-ask, resumes on the survivor and clears the survivor's flag,
// where a copied boolean stayed set for the session and the merged pair was never asked again.
const recordFor = (containerUri: string, cluster: Media[]): AskRecord => {
  let list = records.get(containerUri)
  if (!list) {
    list = []
    records.set(containerUri, list)
  }
  const hits = list.filter(record => cluster.some(media => record.members.has(media.uri)))
  if (!hits.length) {
    const fresh: AskRecord = {
      members: new Set(cluster.map(media => media.uri)),
      fingerprints: new Set(),
      refusedTitles: new Set(),
      asks: 0,
      settled: false,
      skipLogged: false,
    }
    list.push(fresh)
    return fresh
  }
  const [record, ...others] = hits as [AskRecord, ...AskRecord[]]
  for (const other of others) {
    for (const member of other.members) record.members.add(member)
    for (const fingerprint of other.fingerprints) record.fingerprints.add(fingerprint)
    for (const titles of other.refusedTitles) record.refusedTitles.add(titles)
    record.asks += other.asks
    record.settled = record.settled || other.settled
    record.driver = record.driver ?? other.driver
    record.latest = record.latest ?? other.latest
    other.mergedInto = record
    list.splice(list.indexOf(other), 1)
  }
  for (const media of cluster) record.members.add(media.uri)
  if (others.length) console.warn(`similarMedia: consumer merged ${hits.length} records under ${containerUri} (${record.members.size} members)`)
  return record
}

const dedupe = <T>(values: readonly T[]): T[] => [...new Set(values)]

const questionFor = (ask: SimilarAsk, evidence: RunEvidence, clusterId: string): Question => ({
  fingerprint: similarAskKey(ask.origin, ask.showId, evidence),
  clusterId,
  titles: [...(evidence.titles ?? [])].sort().join('\u0001'),
  evidence,
  ask,
})

/**
 * Write one question and what it came to into the `Ask` log, and never make the consumer wait on it
 * or answer for it.
 *
 * Section 7.3: the log is what tells "never asked" apart from "asked and refused" on a page with no
 * Netflix button, and nothing else in the store records that. Fire and forget on purpose, and behind
 * `graphEnabled` so a session with the flag down does not even build a row. A throw is logged here:
 * a graph that cannot take a row must not change which questions the consumer asks.
 *
 * One row per question, written once the outcome is known, so an ask still in flight has no row yet.
 * A question the consumer never SENT (the cap, a pair that settled, a run with no titles) writes
 * nothing at all, which is what keeps "never asked" honest.
 */
const note = (question: Question, outcome: AskOutcome, reason: string): void => {
  if (!graphEnabled()) return
  const failed = (cause: unknown) => console.error(new Error('similarMedia consumer could not record an ask', { cause }))
  try {
    void recordAsk({
      clusterId: question.clusterId,
      // the run's own uri, which is the column 7.5's ask query reads and the only spelling of this
      // cluster that a later fold cannot change (`Ask.runUri`)
      runUri: question.ask.runUri,
      origin: question.ask.origin,
      showId: question.ask.showId,
      question: question.fingerprint,
      outcome,
      reason,
    })?.catch(failed)
  } catch (cause) {
    failed(cause)
  }
}

/**
 * The relation an accepted answer asserts: a sameness answer is the run, a `containing` answer holds
 * it (4.4). Named here because the two writes below, the old store's and the graph's, must never
 * disagree about which one an answer was.
 */
type AcceptedKind = 'SAME_AS' | 'PART_OF'

/**
 * Write what the consumer accepted into the graph as a claim, stamped `provenance: 'ask'` (3.3).
 *
 * This is the claim, not the log: the `Ask` row says a question was put and what it came to, and this
 * says what the graph may now derive from the answer. `PART_OF` for a `containing` answer and
 * `SAME_AS` for a sameness one, and never the other way round: a wrong containment costs a badge and
 * a hidden card, a wrong sameness welds two works.
 *
 * Behind `graphEnabled` and total, the same as `note`: the old store's claim is written either way,
 * and a graph that cannot take an edge must not change what the consumer asks or claims.
 */
const claim = async (ask: SimilarAsk, media: SimilarAnswerMedia, kind: AcceptedKind): Promise<void> => {
  if (!graphEnabled()) return
  try {
    // the node is the claimer's description of the target (`CLAIMS.node`), built from the fields an
    // answer is typed to carry rather than from the whole row: the answering extractor's own answer
    // describes it in full, and this one must be expressible as JSON without a guess
    const { uri, origin, id, scope, titles } = media
    await writeAskClaim({
      fromUri: ask.runUri,
      toUri: media.uri,
      kind,
      claimer: ask.origin,
      targetScope: scope ?? null,
      node: { uri, origin, id, scope: scope ?? null, titles: titles ? [...titles] : null },
    })
  } catch (cause) {
    console.error(new Error('similarMedia consumer could not claim an answer', { cause }))
  }
}

/**
 * Every RUN the cluster already holds, read from the store the answer would be WRITTEN into.
 *
 * The whole of 1b, and it is read at BOTH points that used to consult the old store: which origins
 * are worth asking at all (`planSimilarAsks`), and whether an answer that arrived names a run the
 * cluster already has. The old store unions a row in off the route's ADDRESS; the graph refuses the
 * same row entry because an address asserts nothing (3.3). A gate on the old store therefore reported
 * "this cluster already holds a Netflix run" about a graph that held none, so the question was never
 * put and the claim that would have made the row a member was never written. A route uri naming
 * `nf:80987039-3` must not silence the Netflix ask; the uri is where the page was addressed from.
 *
 * A graph that cannot answer falls back to the old store rather than refusing: the gate exists to
 * prevent a weld, and a gate that throws would settle no pair and ask forever.
 */
const heldRuns = async (runUri: string): Promise<{ uri: string, origin: string }[]> => {
  if (graphEnabled() && readStore() === 'graph') {
    try {
      return await clusterRunsOf(runUri)
    } catch (cause) {
      console.error(new Error('similarMedia consumer could not read the graph cluster', { cause }))
    }
  }
  return (await findAggregatedMedia(runUri)).filter(media => media.scope !== 'CONTAINER')
}

/**
 * The uri one cluster's asks are keyed on: the first NAMED non-container member, sorted, and the
 * first of any member when nothing is named.
 *
 * A MEMBER NOBODY HAS DESCRIBED IS NOT AN ANCHOR, and a title is how that is read here: the old
 * store makes a row out of every uri a claim names, so the offline source's `anidb:14758` handle is
 * a member with no titles, no dates and no counts, and it sorts ahead of `anilist:108465`. The graph
 * makes the same uri a PLACEHOLDER and clusters nothing onto it (4.3), so anchoring an ask there costs
 * two things, both measured on `ag:(anilist:108465)` on 2026-09-13:
 *
 * - `clusterRunsOf` answers NOTHING for a uri that is in no cluster, so the gate that stops a second
 *   run of one origin joining reads "this cluster holds no run of any origin" and every container
 *   origin is asked again.
 * - the `ask` claim hangs off a row the cluster does not contain, so a `containing` answer's `PART_OF`
 *   reaches no cluster and nothing is attached. A sameness answer survives it, because the answering
 *   extractor's own row carries the identity too; a containment answer has no second route.
 *
 * The fallback keeps a cluster of nothing but undescribed rows asking as it did, since an anchor that
 * is no worse than the only one available is the honest choice.
 */
const runUriOf = (cluster: Media[]): string | undefined => {
  const runs = cluster.filter(media => media.scope !== 'CONTAINER')
  const named = runs.filter(media => (media.titles ?? []).some(title => title.title?.trim()))
  return (named.length ? named : runs).map(media => media.uri).sort()[0]
}

/**
 * The rows of a cluster that agree on the show.
 *
 * The old store joins everything an address names, and no text tells a link naming two shows from a real one:
 * `ag:(jw:34435,mal:6)` put Cowboy Bebop's JustWatch season in Trigun's cluster, whose titles then vouched for Cowboy
 * Bebop's answers, and its JustWatch and Netflix seasons were claimed as Trigun's (through the relays, 2026-10-31). So a
 * row stays on what sources said themselves, every row read with the shows its source hangs it off:
 *
 * - a row a source's own claims join to the run;
 * - a row a search could have found: the loosest gate a catalogue hit clears, on any rung of those rows' titles;
 * - a season of a show a source hangs a kept row off, whatever its title: JustWatch's offer names Netflix's show on Dahmer,
 *   whose season Netflix titles "DAHMER", and that row in the evidence is what passes its own answer.
 *
 * NOT the 0.9 an answer is held to, nor a row's titles alone, as real merges rest on both: Netflix's "Frieren: Beyond the
 * Journey's End" scores 0.842, and JustWatch titles Avatar's first season "Book One: Water", which is the run's anchor on a
 * page with no AniList row. Two shows titled alike clear this gate, as a search can confuse them.
 */
const agreeingRows = async (cluster: Media[], runUri: string): Promise<Media[]> => {
  const claimed = new Set(findClaimedMedia(runUri).map(media => media.uri))
  const ours = cluster.filter(media => claimed.has(media.uri))
  const titles = (runEvidence([...ours, ...findClaimedShows(ours)], []).titles ?? [])
    .flatMap(title => [title, ...simplifyTitle(title)])
  const agrees = await Promise.all(cluster.map(async media => {
    if (claimed.has(media.uri)) return true
    const named = [media, ...findClaimedShows([media])].flatMap(row => (row.titles ?? []).map(title => title.title))
    return (await answerNamesOurShow(titles, named, TITLE_MATCH_THRESHOLD)).ok
  }))
  const shows = findClaimedShows(cluster.filter((_, index) => agrees[index]))
  return cluster.filter((media, index) => agrees[index] || shows.some(show => media.uri.startsWith(`${show.uri}-`)))
}

const isAsked = (record: AskRecord, question: Question): boolean =>
  record.fingerprints.has(question.fingerprint) || record.refusedTitles.has(question.titles)

/**
 * The asks a run page owes right now: one per CONTAINER-scoped origin that can answer and has no run
 * in the cluster. Whether each is actually asked is decided per record in `resolveSimilarRuns`.
 */
export const planSimilarAsks = (
  cluster: Media[],
  containers: Media[],
  implemented: (origin: string) => boolean,
  /**
   * The origins whose run the cluster already holds, when the caller reads a store this one is not.
   * Defaults to the handed cluster's own origins, which is what every caller but `resolveSimilarRuns`
   * wants; that one reads the graph when the graph is what the page is served from (see `heldRuns`).
   */
  heldOrigins?: ReadonlySet<string>
): SimilarAsk[] => {
  const runUri = runUriOf(cluster)
  if (!runUri) return []
  const origins = heldOrigins ?? new Set(cluster.map(media => media.origin))
  const asks: SimilarAsk[] = []
  const seen = new Set<string>()
  for (const container of containers) {
    if (seen.has(container.uri)) continue
    seen.add(container.uri)
    // ONLY A CONTAINER IS A SHOW, and `container.id` is put to the source as a show id. Every
    // `PART_OF` target used to be taken for one, which was true until this file started minting them:
    // a `containing` answer hangs a season-scoped RUN off the cluster, and the next read then asked
    // Netflix about show `80987039-1`, an id only this app has ever spelled. unOGS answers `{}` for
    // it (measured 2026-09-12) so the round trip is refused at the far end of two network calls, and
    // a source more lenient about ids would answer the question rather than the premise. Measured on
    // the 6 arm Mushoku Tensei run, 2026-09-13: 4 of 11 `containingMedia` asks were about that id,
    // each behind a `similarMedia` ask, so 8 walks of a show nobody asked about.
    if (container.scope !== 'CONTAINER') continue
    if (!implemented(container.origin)) continue
    if (origins.has(container.origin)) continue
    asks.push({ runUri, origin: container.origin, showId: container.id, containerUri: container.uri })
  }
  return asks
}

const byScoreDescending = (a: Media, b: Media) => {
  if (a.score == null) return b.score == null ? 0 : 1
  if (b.score == null) return -1
  return b.score - a.score
}

/** What the cluster knows about its run, in the shape the answering source reads. */
export const runEvidence = (cluster: Media[], episodeTitles: readonly string[]): RunEvidence => {
  const sorted = [...cluster].sort(byScoreDescending)
  return {
    titles: dedupe(sorted.flatMap(media => (media.titles ?? []).map(title => title.title))).filter(title => !isOnlySeasonLabel(title)),
    startDate: bestRunStartDate(sorted.map(media => media.startDate)),
    // the same number the aggregate publishes, so a source is asked against what the page shows
    // rather than a second opinion assembled here (store/consensus.ts)
    episodeCount: runLength(cluster) ?? undefined,
    episodeTitles: dedupe(episodeTitles).slice(0, 200),
  }
}

/**
 * Ask a record's newest question until the pair settles or the question repeats. One driver per
 * record at a time; a read landing while an ask is in flight only moves `latest` and waits for that
 * driver, whose loop re-checks it when the ask settles. A decline never reached the source, so
 * nothing is recorded and the next read retries it; a refusal did, so the same evidence is not put
 * again; an answer naming another show is recorded with the titles it was checked against, so a
 * title landing later (the English one after a romaji-only first read, which scores 0.44 against
 * Crunchyroll's English series title) asks again and the same answer is checked again.
 */
const drive = async (start: AskRecord, context: RequestContext, deps: SimilarDeps): Promise<void> => {
  if (start.driver) {
    const { ask } = start.latest!
    console.warn(`similarMedia: consumer deferred ${ask.origin} ${ask.showId} for ${ask.runUri} (an ask is in flight; asked when it settles if still new)`)
    deps.wait?.()
    return start.driver
  }
  let finish = () => {}
  const driver = new Promise<void>(resolve => { finish = resolve })
  start.driver = driver
  let record = start
  // the question `deps.ask` is answering right now, so a throw anywhere on the asking path is
  // recorded against the question that was in flight rather than lost
  let asked: Question | undefined
  try {
    for (;;) {
      // the record may have been folded into another since the last iteration: follow it, and take
      // it over if nobody is driving it, else leave the loop to the driver that is
      record = ownerOf(record)
      record.driver ??= driver
      if (record.driver !== driver) return
      if (record.settled || !record.latest || isAsked(record, record.latest)) return
      const question = record.latest
      const { evidence, ask } = question
      if (record.asks >= MAX_ASKS_PER_PAIR) {
        record.settled = true
        console.warn(`similarMedia: consumer settled ${ask.origin} ${ask.showId} for ${ask.runUri} (cap ${MAX_ASKS_PER_PAIR} reached)`)
        return
      }
      record.asks += 1
      asked = question
      console.warn(`similarMedia: consumer asked ${ask.origin} ${ask.showId} for ${ask.runUri} (ask ${record.asks} of ${MAX_ASKS_PER_PAIR}) with ${describeEvidence(evidence)}`)
      const result = await deps.ask(ask.origin, {
        showId: ask.showId,
        context,
        startDate: evidence.startDate ?? undefined,
        titles: evidence.titles ? [...evidence.titles] : undefined,
        episodeCount: evidence.episodeCount ?? undefined,
        episodeTitles: evidence.episodeTitles ? [...evidence.episodeTitles] : undefined,
      })
      record = ownerOf(record)
      if (record.settled) {
        console.warn(`similarMedia: consumer dropped ${ask.origin} ${ask.showId} for ${ask.runUri} (the pair settled while the ask was in flight)`)
        // whatever the source said, the pair had settled and the answer was never considered
        note(question, 'refused', 'dropped')
        return
      }
      if (result.outcome === 'declined') {
        console.warn(`similarMedia: consumer declined ${ask.origin} ${ask.showId} for ${ask.runUri} (${result.reason}); retries on the next read`)
        note(question, 'declined', result.reason)
        return
      }
      if (result.outcome === 'refused') {
        record.fingerprints.add(question.fingerprint)
        console.warn(`similarMedia: consumer refused ${ask.origin} ${ask.showId} for ${ask.runUri} (${result.reason}); re-asks on new evidence`)
        note(question, 'refused', result.reason)
        continue
      }
      // the answer's own shape, read once: the two writes below and the log row must agree about it
      const accepted: AskOutcome = result.outcome === 'containing' ? 'containing' : 'answered'
      // the ONE place the answer's shape decides what is asserted: `containing` holds the run, and
      // claiming it SAME_AS would weld the fold it exists to describe (4.4)
      const kind: AcceptedKind = accepted === 'containing' ? 'PART_OF' : 'SAME_AS'
      // another caller (anilist's own mapping, or a merged record's ask) may have named this origin's
      // run while the ask was in flight; a second run of one origin in one cluster is two seasons
      // welded, so the cluster is re-read and an answer that is not the run already there is refused
      const present = (await heldRuns(ask.runUri)).find(run => run.origin === ask.origin)
      if (present) {
        record.settled = true
        // the two spellings of the design's `refused-other-run` (7.3): the answer either names the
        // run the cluster already holds, which is an answer about a row already here, or names a
        // second run of one origin, which is the weld the ask exists to avoid
        if (present.uri === result.media.uri) {
          // CLAIMED IN THIS ARM TOO, which is 1a, and the two shapes mean OPPOSITE things here.
          //
          // A SAME_AS answer is confirmation: the row the cluster already holds is held on somebody
          // else's evidence, and this ask is a second, independent source of it. The claim is what
          // makes that a fact the rules may use, where the log row only records that it was given.
          //
          // A CONTAINING answer is a CONTRADICTION, and is written for that reason rather than in
          // spite of it. The source has just said the row HOLDS our run, and the cluster says it IS
          // our run, so the two cannot both stand. The claim is how the disagreement gets into the
          // graph at all: `containing` is not in `DOWNGRADE_REASONS` (graph/plugins/guards.ts), so
          // `invariantRepairs` (graph/plugins/containment.ts) reads the resulting `PART_OF` between
          // two members of one cluster and retracts the `SAME_AS` that joined them, which is 3.5's
          // repair and the outcome this arm exists to reach. Swallowing it would leave the weld
          // standing on evidence the source itself has withdrawn. Reachable as the evidence grows: a
          // cold ask answers a season by date with no count, the count arrives, the fold veto then
          // fires and the second ask answers that same season as a container.
          //
          // `writeAskClaim` reads its own key back, so a pair already carrying this claim writes and
          // emits nothing and the arm costs one lookup.
          const shape = accepted === 'containing' ? 'contradicted' : 'settled'
          console.warn(`similarMedia: consumer ${shape} ${ask.origin} ${ask.showId} for ${ask.runUri} (${present.uri} is already the cluster's ${ask.origin} run, claimed ${kind})`)
          await claim(ask, result.media, kind)
          note(question, accepted, result.media.uri)
        } else {
          console.warn(`similarMedia: consumer refused-by-origin ${result.media.uri} for ${ask.runUri} (${present.uri} is already the cluster's ${ask.origin} run)`)
          note(question, 'refused', 'other-run')
        }
        return
      }
      const runTitles = evidence.titles ?? []
      const answerTitles = (result.media.titles ?? []).map(title => title.title)
      const verdict = await answerNamesOurShow(runTitles, answerTitles)
      if (!verdict.ok) {
        record.refusedTitles.add(question.titles)
        console.warn(`similarMedia: consumer refused-by-title ${result.media.uri} for ${ask.runUri} (best ${verdict.score.toFixed(3)} of ${runTitles.length} run titles against ${answerTitles.length} answer titles, threshold ${SHOW_TITLE_THRESHOLD}); re-asks on a new title`)
        note(question, 'refused', 'by-title')
        continue
      }
      record.settled = true
      // THE OLD STORE TAKES SAMENESS AND NOTHING ELSE, which is what it took before `containing`
      // existed. A containment is this migration's own fact: the graph is where it is read, and the
      // old store is the CONTROL every measurement of the graph is made against, so landing a new
      // kind of handle there moves the arm the comparison is against for a fact nothing over there
      // reads. Measured 2026-09-13 on `ag:(anilist:108465)`: writing it gave the legacy page
      // `PART_OF:nf:80987039 PART_OF:nf:80987039-1` where it had carried the first alone, at 0 of 11
      // Netflix episodes either way, since the old store has no placement that reads a container.
      // Same reason `resolveSimilarRuns` reads `heldRuns` only when the graph is what is served.
      if (kind === 'SAME_AS') await upsertMedia([], [{ mediaUri: ask.runUri, handleUri: result.media.uri, relation: kind }])
      await claim(ask, result.media, kind)
      console.warn(`similarMedia: consumer claimed ${result.media.uri} as ${kind} of ${ask.runUri}`)
      note(question, accepted, result.media.uri)
      return
    }
  } catch (cause) {
    console.error(new Error('similarMedia consumer failed', { cause }))
    if (asked) note(asked, 'error', cause instanceof Error ? cause.message : String(cause))
  } finally {
    for (let held: AskRecord | undefined = start; held; held = held.mergedInto) {
      if (held.driver === driver) held.driver = undefined
    }
    finish()
  }
}

/**
 * Ask every owed container origin and claim each answer it accepts. Never throws, and resolves once
 * every pair it asked, or found another run asking, is done.
 *
 * Only a root whose policy spends cross-source work asks (a listing never does). A read with no
 * evidence records nothing, and a read whose run has no title asks nothing, since an answer could not
 * be checked against the show. The claim goes through `upsertMedia` with no rows: the answer's own
 * row lands through the answering extractor's insertion, the claim waits for it under
 * `pendingClaims`, and a RUN x RUN union emits `media:changed`, which re-runs the page's read, whose
 * re-ask of the newly named origin is how the answer's episodes reach the store. The container edge is
 * never touched. The graph takes the same claim through `claim`, where the answer's row is an
 * anchoring placeholder until the answering extractor describes it (4.3).
 */
export const resolveSimilarRuns = async (read: Media[], context: RequestContext, deps: SimilarDeps): Promise<void> => {
  try {
    if (!policyFor({ context }).crossSource) return
    const runUri = runUriOf(read)
    if (!runUri) return
    const cluster = await agreeingRows(read, runUri)
    // ONLY when the graph is what the page is served from. On the old store the plan keeps reading
    // the cluster it was handed, byte for byte the behaviour every legacy page already has, so this
    // fix cannot move a number on the store it is not about.
    const held = graphEnabled() && readStore() === 'graph'
      ? new Set((await heldRuns(runUri)).map(run => run.origin))
      : undefined
    const asks = planSimilarAsks(cluster, findPartOfMedia(cluster), deps.implemented, held)
    if (!asks.length) return
    const episodes = await findAggregatedEpisodesForMedia(cluster.map(media => media.uri))
    const evidence = runEvidence(cluster, episodes.flat().flatMap(episode => (episode.titles ?? []).map(title => title.title)))
    if (!hasEvidence(evidence)) return
    // The cluster as ONE id, for the `Ask` log alone: the aggregated uri is the address this page
    // carries and the only cluster id that exists today. The `Cluster` table's minted ids arrive
    // with `plugin:aggregate` (5.4 P5), and `Ask.clusterId` takes them when they do.
    const clusterId = toAggregatedUri(cluster.map(media => media.uri))
    await Promise.all(asks.map(ask => {
      const record = recordFor(ask.containerUri, cluster)
      if (record.settled) return
      if (!evidence.titles?.length) {
        if (!record.skipLogged) {
          record.skipLogged = true
          console.warn(`similarMedia: consumer skipped ${ask.origin} ${ask.showId} for ${ask.runUri} (no run titles to verify the show against)`)
        }
        return
      }
      record.latest = questionFor(ask, evidence, clusterId)
      return drive(record, context, deps)
    }))
  } catch (cause) {
    console.error(new Error('similarMedia consumer failed', { cause }))
  }
}

/** TESTS ONLY: forget every (cluster, container) record. */
export const resetSimilarAsks = () => { records.clear() }
