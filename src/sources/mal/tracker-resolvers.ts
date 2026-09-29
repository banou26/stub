// The MyAnimeList tracker's resolvers over whatever session and clock they are handed, so a test serves
// them over a fake MyAnimeList; ./tracker.ts hands them the worker's.

import type { ListEntryInput, Resolvers, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { CatalogLookup, CatalogueTarget } from '../../tracking/identity'
import type { PageApi, SiteSession } from '../../tracking/site-session'
import type { MalListRequest, MalListStatus, MalPageApi, MalWrite } from './session-page'
import type { SaveTurn } from './pacing'

import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer } from '../../tracking/collect'
import { catalogueTargetOf } from '../../tracking/identity'
import {
  LIST_PAGE_SIZE, MAL_TRACKER_ID, listEntryOf, listsFor, listsHolding, malTracker, mismatchOf, planWrite,
  readCard, readListPage, readWhoAmI, readWriteAnswer, replaceLists, showsNoChange, upsertRows,
  type MalExpect, type MalListRow, type MalRead, type MalRows,
} from './list-api'
import { createMalPacer, createSaveQueue } from './pacing'

/** What the tracker reads off its request context, beside what every provider gets. */
export type MalTrackerContext = {
  catalog: () => Promise<CatalogLookup>
  /** The viewer's session on a site, by stub's name for it (`mal`), typed by its page's api. */
  session: <Api extends PageApi>(site: string) => SiteSession<Api>
  request: { signal: AbortSignal }
}

/** How long the list read serves every media before it is read again: the original design's list TTL. */
export const INDEX_TTL_MS = 10 * 60_000
/** How long a list over one page is kept current by its recent changes before it is read whole again, which is what finds an entry deleted on myanimelist.net. */
export const FULL_TTL_MS = 60 * 60_000
/** How recent the list a save is planned on has to be, so add or edit and the rewatch rules see the entry as it is. */
export const FRESH_FOR_WRITE_MS = 60_000
/** How long a save whose list shows nothing of it yet waits before looking once more. */
export const CONFIRM_RETRY_MS = 2_000

type ListIndex = MalRows & { kind: 'list', user: string, fullAt: number, checkedAt: number }
type Index = ListIndex | { kind: 'signed-out', checkedAt: number }

/** What a write through the page did. `refused`: its first step was not accepted, so nothing changed. */
type Sent =
  | { kind: 'not-sent', read: MalRead<string> }
  | { kind: 'refused', read: Exclude<MalRead<null>, { kind: 'data' }> }
  | { kind: 'sent', complete: boolean, stopped?: Exclude<MalRead<null>, { kind: 'data' }> }
  | { kind: 'unknown', message: string }

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const outcome = (state: WriteOutcome['outcome'], error: string | null, entry: WriteOutcome['entry'] = null): WriteOutcome[] =>
  [{ tracker: MAL_TRACKER_ID, outcome: state, entry, error }]

const waitMessage = (until: number | undefined) =>
  until
    ? `MyAnimeList asked stub to wait until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'MyAnimeList asked stub to wait a few minutes'

const SIGN_IN = 'Sign in to MyAnimeList to save to it'

// one waiter giving up does not give up the read other waiters share
const raced = <T>(promise: Promise<T>, signal?: AbortSignal) =>
  !signal ? promise : new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })

/**
 * The viewer's own MyAnimeList list, through the myanimelist.net page the main thread keeps open with
 * their session.
 *
 * The whole list is read into one index, which every media looks up: MyAnimeList has no read of one
 * entry, and its list reads are what FKN's shared egress spends. The index serves for INDEX_TTL_MS;
 * after that a list over one page is brought up to date by its most recent page alone, and read whole
 * again after FULL_TTL_MS. Every call goes through one pacer.
 *
 * A save is checked by reading the entry back, never by what MyAnimeList answered it: those answers
 * were never measured, and the read also catches a write that never arrived. The media is keyed on the
 * MyAnimeList id stub's own tracker keys it on (`catalogueTargetOf`). Wherever that tracker answers
 * AMBIGUOUS so does this one, and nothing is asked or written.
 */
export const malTrackerResolvers = ({ now = Date.now, wait = sleep }: { now?: () => number, wait?: (ms: number) => Promise<void> } = {}) => {
  const pacer = createMalPacer({ now, wait })
  const saves = createSaveQueue({ now, wait })
  let index: Index | undefined
  let loading: { epoch: number, promise: Promise<MalRead<ListIndex>> } | undefined
  // bumped by a sign in and by every write, so a read that started before one is never kept
  let epoch = 0
  let watching = false
  // every open answer reads again after a write through this tracker
  const written = new Set<() => void>()
  // MyAnimeList's count for each anime its list does not hold, off its hover card, once per worker
  const cards = new Map<number, number | null>()

  const session = (ctx: MalTrackerContext) => ctx.session<MalPageApi>(MAL_TRACKER_ID)

  const userOf = () => index?.kind === 'list' ? index.user : undefined

  // `user` null: the answer names nobody, whoever the last read found
  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}, user: string | null = userOf() ?? null): TrackerAnswer =>
    ({ _id: answerId(MAL_TRACKER_ID, uri), tracker: malTracker(user ?? undefined), state, entry: null, candidates: [], error: null, pending: 0, ...extra })

  const targetOf = async (uri: string, ctx: MalTrackerContext) => catalogueTargetOf(uri, 'mal', await ctx.catalog())

  const refusalOf = (target: CatalogueTarget) =>
    target.kind === 'none' ? 'This media names no MyAnimeList id'
    : target.kind === 'ambiguous' ? `This media names ${target.candidates.join(' and ')}, and MyAnimeList cannot tell which one is meant`
    : undefined

  const changed = () => { for (const listener of written) listener() }

  const forget = () => {
    index = undefined
    epoch++
  }

  // one watch for the whole tracker: a sign in makes everything read before it stale
  const watchSession = (ctx: MalTrackerContext) => {
    if (watching) return
    watching = true
    session(ctx).onChange(forget)
  }

  const paced = <T>(call: () => Promise<T>, readOf: (result: T) => MalRead<unknown> | undefined, signal?: AbortSignal) =>
    pacer.run(call, result => {
      const read = readOf(result)
      return read?.kind === 'blocked' ? { blocked: true, retryAfter: read.retryAfter } : { blocked: false, retryAfter: null }
    }, signal)

  const whoami = (ctx: MalTrackerContext) =>
    paced(async (): Promise<MalRead<string>> => {
      const result = await session(ctx).call('whoami', {})
      return result.kind === 'not-connected' ? { kind: 'signed-out' } : readWhoAmI(result.response)
    }, read => read)

  const listPage = (ctx: MalTrackerContext, request: MalListRequest) =>
    paced(async (): Promise<MalRead<MalListRow[]>> => {
      const result = await session(ctx).call('list', request)
      return result.kind === 'not-connected' ? { kind: 'signed-out' } : readListPage(result.response)
    }, read => read)

  /** MyAnimeList's episode count for an anime, or undefined when its card could not be read. */
  const cardCount = async (ctx: MalTrackerContext, animeId: number): Promise<number | null | undefined> => {
    try {
      const card = await paced(async (): Promise<MalRead<number | null>> => {
        const result = await session(ctx).call('anime', { id: animeId })
        return result.kind === 'not-connected' ? { kind: 'signed-out' } : readCard(result.response)
      }, read => read, ctx.request.signal)
      if (card.kind !== 'data') return undefined
      cards.set(animeId, card.data)
      return card.data
    } catch {
      return undefined
    }
  }

  /** The entries changed most recently, whatever their status: the newest `updated_at` first. */
  const readRecent = (ctx: MalTrackerContext, user: string) => listPage(ctx, { user, status: 7, order: 5, offset: 0 })

  /**
   * The whole of each list, by title. Paged the way MyAnimeList's own list page pages it: each offset
   * moves on by the rows the page held, and an empty page ends it. A page that adds no id not already
   * read ends it too, since reading on past an offset MyAnimeList did not honour would never end.
   */
  const readWhole = async (ctx: MalTrackerContext, user: string, statuses: readonly MalListStatus[]): Promise<MalRead<MalListRow[]>> => {
    const rows = new Map<number, MalListRow>()
    for (const status of statuses) {
      const seen = new Set<number>()
      for (let offset = 0; ;) {
        const page = await listPage(ctx, { user, status, order: 1, offset })
        if (page.kind !== 'data') return page
        let added = 0
        for (const row of page.data) {
          if (!seen.has(row.animeId)) added++
          seen.add(row.animeId)
          rows.set(row.animeId, row)
        }
        if (!page.data.length || !added) break
        offset += page.data.length
      }
    }
    return { kind: 'data', data: [...rows.values()] }
  }

  const load = async (ctx: MalTrackerContext, at: number): Promise<MalRead<ListIndex>> => {
    const who = await whoami(ctx)
    if (who.kind === 'signed-out') {
      if (at === epoch) index = { kind: 'signed-out', checkedAt: now() }
      return who
    }
    if (who.kind !== 'data') return who
    const user = who.data
    const held = index?.kind === 'list' && index.user === user ? index : undefined
    let next: ListIndex | undefined
    if (held && held.rows.size > LIST_PAGE_SIZE && now() - held.fullAt < FULL_TTL_MS) {
      const recent = await readRecent(ctx, user)
      if (recent.kind !== 'data') return recent
      const last = recent.data.at(-1)
      // with every row of the page changed since the last read, more may have changed beyond it
      if (last && (last.updatedAt ?? 0) < held.watermark) next = { ...held, ...upsertRows(held, recent.data), checkedAt: now() }
    }
    if (!next) {
      const whole = await readWhole(ctx, user, [7])
      if (whole.kind !== 'data') return whole
      const readAt = now()
      next = { kind: 'list', user, ...replaceLists(undefined, [7], whole.data), fullAt: readAt, checkedAt: readAt }
    }
    if (at === epoch) index = next
    return { kind: 'data', data: next }
  }

  /**
   * The list, read at most `freshWithin` ago. One read at a time, shared by everyone who asks while it
   * runs and owned by none of them: `signal` gives up this caller's wait, never the read. A read that
   * a sign in or a write overtook is not kept, and is made again.
   */
  const indexOf = async (ctx: MalTrackerContext, freshWithin: number, signal?: AbortSignal): Promise<MalRead<ListIndex>> => {
    for (;;) {
      const held = index
      if (held && now() - held.checkedAt < freshWithin) return held.kind === 'list' ? { kind: 'data', data: held } : { kind: 'signed-out' }
      if (!loading || loading.epoch !== epoch) {
        const started = { epoch, promise: load(ctx, epoch) }
        const done = () => { if (loading === started) loading = undefined }
        started.promise.then(done, done)
        loading = started
      }
      const flight = loading
      const result = await raced(flight.promise, signal)
      if (flight.epoch === epoch || result.kind === 'blocked' || result.kind === 'error') return result
    }
  }

  /** Brings rows read after a write into the index, unless a sign in or another write came first. */
  const patch = (mine: number, user: string, update: (held: MalRows) => MalRows) => {
    if (epoch === mine && index?.kind === 'list' && index.user === user) index = { ...index, ...update(index) }
  }

  const read = async (ctx: MalTrackerContext, uri: string, animeId: number): Promise<TrackerAnswer> => {
    let result: MalRead<ListIndex>
    try {
      result = await indexOf(ctx, INDEX_TTL_MS, ctx.request.signal)
    } catch (error) {
      return errorAnswer(uri, malTracker(userOf()), messageOf(error))
    }
    if (result.kind === 'signed-out') return answer(uri, 'SIGNED_OUT', {}, null)
    if (result.kind === 'blocked') return answer(uri, 'PAUSED', { error: waitMessage(pacer.pausedUntil()) })
    if (result.kind === 'error') return errorAnswer(uri, malTracker(userOf()), result.message)
    const { user, rows } = result.data
    const row = rows.get(animeId)
    return row
      ? answer(uri, 'LISTED', { entry: listEntryOf(user, row), episodeCount: row.episodes }, user)
      : answer(uri, 'NOT_LISTED', { episodeCount: cards.get(animeId) ?? null }, user)
  }

  /** Posts one phase of a save, once: a write the page lost is never sent again. */
  const send = async (ctx: MalTrackerContext, user: string, steps: MalWrite[]): Promise<Sent> => {
    try {
      return await paced(async (): Promise<Sent> => {
        const result = await session(ctx).call('write', { user, steps }, { once: true })
        if (result.kind === 'not-connected') return { kind: 'not-sent', read: { kind: 'signed-out' } }
        const answered = result.response
        if (answered.kind === 'not-sent') return { kind: 'not-sent', read: readWhoAmI(answered.whoami) }
        const reads = answered.answers.map(readWriteAnswer)
        const first = reads[0] ?? { kind: 'error', message: 'MyAnimeList was sent nothing' }
        if (first.kind !== 'data') return { kind: 'refused', read: first }
        const stopped = reads.find(read => read.kind !== 'data')
        return stopped ? { kind: 'sent', complete: false, stopped } : { kind: 'sent', complete: reads.length === steps.length }
      }, sent => sent.kind === 'not-sent' || sent.kind === 'refused' ? sent.read : sent.kind === 'sent' ? sent.stopped : undefined)
    } catch (error) {
      // the page went away mid call, or never answered: the write may or may not have arrived
      return { kind: 'unknown', message: messageOf(error) }
    }
  }

  /** Why nothing was written, when the first thing sent was refused or nothing was sent at all. */
  const unwritten = (read: Exclude<Sent, { kind: 'sent' | 'unknown' }>['read'], user: string): WriteOutcome[] => {
    if (read.kind === 'blocked') return outcome('FAILED', waitMessage(pacer.pausedUntil()))
    if (read.kind === 'error') return outcome('FAILED', read.message)
    if (read.kind === 'data' && read.data === user) return outcome('FAILED', "MyAnimeList's page carried no token for the save")
    // signed out, or somebody else signed in: every answer is read again, for whoever it is now
    forget()
    changed()
    return read.kind === 'data'
      ? outcome('REFUSED', 'MyAnimeList is signed in as someone else now; the list is read again')
      : outcome('REFUSED', SIGN_IN)
  }

  const notReadable = (result: Exclude<MalRead<unknown>, { kind: 'data' }>): WriteOutcome[] =>
    result.kind === 'signed-out' ? outcome('REFUSED', SIGN_IN)
    : result.kind === 'blocked' ? outcome('FAILED', waitMessage(pacer.pausedUntil()))
    : outcome('FAILED', result.message)

  /**
   * Where the entry stands after a phase: the recent page, which leads with the entry just written
   * whatever status it landed in; the lists it should be in when the page does not have it though every
   * step was accepted; and once more after CONFIRM_RETRY_MS when the list shows nothing of the write
   * yet. A pause is never waited out here: it is reported, and the list is read after it.
   */
  const confirm = async (ctx: MalTrackerContext, user: string, mine: number, animeId: number, expect: MalExpect, before: MalListRow | undefined, accepted: boolean): Promise<MalRead<MalListRow | undefined>> => {
    try {
      if (pacer.pausedUntil()) return { kind: 'blocked', retryAfter: null }
      const look = async (): Promise<MalRead<MalListRow | undefined>> => {
        const recent = await readRecent(ctx, user)
        if (recent.kind !== 'data') return recent
        patch(mine, user, held => upsertRows(held, recent.data))
        return { kind: 'data', data: recent.data.find(row => row.animeId === animeId) }
      }
      const first = await look()
      if (first.kind !== 'data') return first
      let after = first.data
      if (!after && accepted) {
        const statuses = listsFor(expect.status)
        const whole = await readWhole(ctx, user, statuses)
        if (whole.kind !== 'data') return whole
        patch(mine, user, held => replaceLists(held, statuses, whole.data))
        after = whole.data.find(row => row.animeId === animeId)
      }
      if (mismatchOf(expect, after, before) && showsNoChange(after, before)) {
        await wait(CONFIRM_RETRY_MS)
        const again = await look()
        if (again.kind !== 'data') return again
        after = again.data ?? after
      }
      return { kind: 'data', data: after }
    } catch (error) {
      return { kind: 'error', message: messageOf(error) }
    }
  }

  const save = async (ctx: MalTrackerContext, animeId: number, input: ListEntryInput, turn: SaveTurn): Promise<WriteOutcome[]> => {
    const until = pacer.pausedUntil()
    if (until) return outcome('FAILED', waitMessage(until))
    const found = await indexOf(ctx, FRESH_FOR_WRITE_MS)
    if (found.kind !== 'data') return notReadable(found)
    const { user } = found.data
    let before = found.data.rows.get(animeId)
    const plan = planWrite(animeId, before, input)
    if ('error' in plan) return outcome('REFUSED', plan.error)
    if ('noop' in plan) return outcome('SAVED', null, before ? listEntryOf(user, before) : null)

    await turn.ready()
    const mine = ++epoch
    let sentAny = false
    let accepted = true
    try {
      for (const phase of plan.phases) {
        const sent = await send(ctx, user, phase.steps)
        if (sent.kind === 'not-sent' || sent.kind === 'refused') {
          if (!sentAny) return unwritten(sent.read, user)
          return outcome('FAILED', sent.read.kind === 'error' ? sent.read.message : 'MyAnimeList took only part of the save')
        }
        sentAny = true
        if (sent.kind !== 'sent' || !sent.complete) accepted = false
        const after = await confirm(ctx, user, mine, animeId, phase.expect, before, sent.kind === 'sent' && sent.complete)
        if (after.kind !== 'data') {
          index = undefined
          if (accepted) return outcome('SAVED', null)
          return outcome('FAILED', after.kind === 'blocked'
            ? 'MyAnimeList did not confirm the save; it is read again after the pause'
            : `MyAnimeList did not confirm the save${after.kind === 'error' ? `: ${after.message}` : ''}`)
        }
        const mismatch = mismatchOf(phase.expect, after.data, before)
        if (mismatch) return outcome('FAILED', mismatch)
        before = after.data
      }
      return outcome('SAVED', null, before ? listEntryOf(user, before) : null)
    } finally {
      turn.wrote()
      // whatever the answer, the open answers read what MyAnimeList holds now
      if (sentAny) changed()
    }
  }

  const remove = async (ctx: MalTrackerContext, animeId: number, turn: SaveTurn): Promise<WriteOutcome[]> => {
    const until = pacer.pausedUntil()
    if (until) return outcome('FAILED', waitMessage(until))
    const found = await indexOf(ctx, FRESH_FOR_WRITE_MS)
    if (found.kind !== 'data') return notReadable(found)
    const { user } = found.data
    const before = found.data.rows.get(animeId)
    // nothing listed is what a delete asks for
    if (!before) return outcome('SAVED', null)

    await turn.ready()
    const mine = ++epoch
    const sent = await send(ctx, user, [{ kind: 'delete', animeId }])
    turn.wrote()
    if (sent.kind === 'not-sent' || sent.kind === 'refused') return unwritten(sent.read, user)
    try {
      // the delete endpoint is known only from MAL-Sync's code of 2021, so an accepted answer proves
      // nothing: the lists that may serve the entry are read whole
      const statuses = listsHolding(before)
      let whole: MalRead<MalListRow[]>
      try {
        whole = pacer.pausedUntil() ? { kind: 'blocked', retryAfter: null } : await readWhole(ctx, user, statuses)
      } catch (error) {
        whole = { kind: 'error', message: messageOf(error) }
      }
      if (whole.kind !== 'data') {
        index = undefined
        return outcome('FAILED', whole.kind === 'blocked'
          ? 'MyAnimeList did not confirm the removal; it is read again after the pause'
          : `MyAnimeList did not confirm the removal${whole.kind === 'error' ? `: ${whole.message}` : ''}`)
      }
      patch(mine, user, held => replaceLists(held, statuses, whole.data))
      if (whole.data.some(row => row.animeId === animeId)) return outcome('FAILED', 'MyAnimeList still lists it')
      return outcome('SAVED', null)
    } finally {
      changed()
    }
  }

  return {
    Subscription: {
      tracking: {
        subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }, ctx: MalTrackerContext) {
          const { uri } = input
          let target: CatalogueTarget
          try {
            target = await targetOf(uri, ctx)
          } catch (error) {
            yield trackingOf(uri, errorAnswer(uri, malTracker(userOf()), messageOf(error)))
            return
          }
          if (target.kind === 'none') {
            yield trackingOf(uri, answer(uri, 'NO_ID'))
            return
          }
          if (target.kind === 'ambiguous') {
            yield trackingOf(uri, answer(uri, 'AMBIGUOUS', { candidates: target.candidates }))
            return
          }
          watchSession(ctx)
          const own = session(ctx)
          // a sign in, or a write through this tracker, and the answer is read again
          const wakes = changes(listener => {
            const stop = own.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          let last: TrackerAnswer | undefined
          try {
            for (;;) {
              // said before the pacer holds the read back, so a paused tracker is not a silent one
              const pausedUntil = pacer.pausedUntil()
              if (pausedUntil && last?.state !== 'PAUSED') {
                last = answer(uri, 'PAUSED', { error: waitMessage(pausedUntil) })
                yield trackingOf(uri, last)
              }
              last = await read(ctx, uri, target.id)
              // asked again once the pause is over, which the pacer waits out. With no pause set nothing
              // would hold the next read back, so the answer waits for a change like any other.
              const retry = last.state === 'PAUSED' && pacer.pausedUntil() !== undefined
              yield trackingOf(uri, last)
              if (retry) continue
              // asked once the answer is on screen, so a sync onto an anime the list does not hold can
              // tell whether progress means the same on MyAnimeList
              if (last.state === 'NOT_LISTED' && !cards.has(target.id)) {
                const episodeCount = await cardCount(ctx, target.id)
                if (episodeCount != null) {
                  last = { ...last, episodeCount }
                  yield trackingOf(uri, last)
                }
              }
              if ((await wakes.next()).done) return
            }
          } finally {
            await wakes.return?.()
          }
        },
      },
    },
    Mutation: {
      saveListEntry: async (
        _parent: unknown,
        { input }: { input: { uri: string, entry: ListEntryInput } },
        ctx: MalTrackerContext,
      ): Promise<WriteOutcome[]> => {
        try {
          watchSession(ctx)
          const target = await targetOf(input.uri, ctx)
          const why = refusalOf(target)
          if (why || target.kind !== 'id') return outcome('REFUSED', why ?? null)
          return await saves.run(turn => save(ctx, target.id, input.entry, turn))
        } catch (error) {
          return outcome('FAILED', messageOf(error))
        }
      },
      deleteListEntry: async (_parent: unknown, { input }: { input: { uri: string } }, ctx: MalTrackerContext): Promise<WriteOutcome[]> => {
        try {
          watchSession(ctx)
          const target = await targetOf(input.uri, ctx)
          const why = refusalOf(target)
          if (why || target.kind !== 'id') return outcome('REFUSED', why ?? null)
          return await saves.run(turn => remove(ctx, target.id, turn))
        } catch (error) {
          return outcome('FAILED', messageOf(error))
        }
      },
    },
  } satisfies Resolvers
}
