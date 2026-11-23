// The Trakt tracker's resolvers over whatever session, public reads and clock they are handed, so a
// test serves them over a fake Trakt; ./tracker.ts hands them the worker's.

import type { ListEntryInput, Resolvers, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { ExtractorServerContext } from '../../worker/extractor'
import type { Said } from '../../i18n/said'
import type { CatalogLookup } from '../../tracking/identity'
import type { PageApi, SiteSession, SiteSessionResult } from '../../tracking/site-session'
import type { SaveTurn } from '../mal/pacing'
import type { TraktKey, TraktKeyResult, TraktTarget, TraktTargetResult } from './identity'
import type { TraktPageAnswer, TraktPageApi } from './session-page'

import { forPage, saidOf } from '../../i18n/said'
import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer, failedReadAnswer, rereads } from '../../tracking/collect'
import { catalogFor } from '../../tracking/identity'
import { ownList } from '../../tracking/lists'
import { fetchAnizipJsonMappings } from '../anizip/extractor'
import { createMalPacer, createSaveQueue } from '../mal/pacing'
import { traktApi } from './api'
import { keyId, targetOfKey, traktKeyOf } from './identity'
import {
  TRAKT_TRACKER_ID, activitiesOf, buildLists, droppedOf, listEntryOf, listEntryOfMovie, listItemsOf,
  planMovieRemove, planMovieWrite, planShowRemove, planShowWrite, readAnswer, readList, traktTracker,
  type TraktLists, type TraktRead, type TraktWritePlan, type TraktWriteStep,
} from './list-api'

/** What the tracker reads off its request context, beside what every provider gets. */
export type TraktTrackerContext = {
  catalog: () => Promise<CatalogLookup>
  /** The viewer's session on a site, by stub's name for it (`trakt`), typed by its page's api. */
  session: <Api extends PageApi>(site: string) => SiteSession<Api>
  /** The worker's public fetch, for ani.zip and Trakt's catalogue, which need no session. */
  fetch: ExtractorServerContext['fetch']
  request: { signal: AbortSignal }
}

/** How long the lists serve every media before `/sync/last_activities` is asked whether they changed. */
export const INDEX_TTL_MS = 10 * 60_000
/** `/users/hidden/dropped` is paged, a low default limit when none is named. */
export const DROPPED_PAGE_LIMIT = 100
/** The most pages read for paginated lists, whatever page count Trakt names. */
export const DROPPED_MAX_PAGES = 20
export const LIST_MAX_PAGES = 20

type ListIndex = { kind: 'lists', user: string, activities: string | undefined, lists: TraktLists, watchedShows?: unknown[], checkedAt: number }
type Index = ListIndex | { kind: 'signed-out', checkedAt: number }

const PROGRESS_QUERY = '?specials=false&count_specials=false'

const messageOf = (error: unknown) => saidOf(error)

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const outcome = (state: WriteOutcome['outcome'], error: Said | null, entry: WriteOutcome['entry'] = null): WriteOutcome[] =>
  [{ tracker: TRAKT_TRACKER_ID, outcome: state, entry, error }]

const SIGN_IN = forPage.formatMessage({ id: 'Sign in to Trakt to save to it', defaultMessage: 'Sign in to Trakt to save to it' })
const NO_ID = forPage.formatMessage({ id: 'This media names no Trakt id', defaultMessage: 'This media names no Trakt id' })

const waitMessage = (until: number | undefined) =>
  until
    ? forPage.formatMessage({ id: 'Trakt asked stub to wait until {time}', defaultMessage: 'Trakt asked stub to wait until {time}' }, { time: { time: until } })
    : forPage.formatMessage({ id: 'Trakt asked stub to wait a few minutes', defaultMessage: 'Trakt asked stub to wait a few minutes' })

/**
 * The viewer's own Trakt list, read and written through the app.trakt.tv page the main thread keeps
 * open with their session. Reads of the lists serve for INDEX_TTL_MS before checking `/sync/last_activities`.
 * All writes go serially through one queue, never auto-retrying a dispatched POST (`once: true`), and
 * confirm by refreshing state afterward.
 */
export const traktTrackerResolvers = ({ now = Date.now, wait = sleep }: { now?: () => number, wait?: (ms: number) => Promise<void> } = {}) => {
  const pacer = createMalPacer({ now, wait })
  const saves = createSaveQueue({ now, wait }, 0)
  let index: Index | undefined
  let loading: { epoch: number, promise: Promise<TraktRead<ListIndex>> } | undefined
  let epoch = 0
  let watching = false
  const written = new Set<() => void>()
  const targets = new Map<string, Promise<TraktTargetResult>>()

  const session = (ctx: TraktTrackerContext) => ctx.session<TraktPageApi>(TRAKT_TRACKER_ID)

  const userOf = () => index?.kind === 'lists' ? index.user : undefined

  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}, user: string | null = userOf() ?? null): TrackerAnswer =>
    ({ _id: answerId(TRAKT_TRACKER_ID, uri), tracker: traktTracker(user ?? undefined), state, entry: null, candidates: [], error: null, ...extra })

  const forget = () => {
    index = undefined
    loading = undefined
    epoch++
  }

  const changed = () => { for (const listener of written) listener() }

  const watchSession = (ctx: TraktTrackerContext) => {
    if (watching) return
    watching = true
    session(ctx).onChange(forget)
  }

  const call = <T>(ask: () => Promise<SiteSessionResult<TraktPageAnswer<T>>>, signal?: AbortSignal) =>
    pacer.run(async (): Promise<TraktPageAnswer<T>> => {
      const result = await ask()
      return result.kind === 'not-connected' ? { kind: 'signed-out' } : result.response
    }, page => {
      const read = readAnswer(page)
      return read.kind === 'blocked' ? { blocked: true, retryAfter: read.retryAfter } : { blocked: false, retryAfter: null }
    }, signal)

  const get = async (ctx: TraktTrackerContext, path: string, signal?: AbortSignal) =>
    readAnswer(await call(() => session(ctx).call('get', { path }), signal))

  const getList = async (ctx: TraktTrackerContext, path: string): Promise<TraktRead<unknown[]>> => {
    const first = await call(() => session(ctx).call('get', { path }))
    const read = readList(first)
    if (read.kind !== 'data') return read
    const pages = first.kind === 'answer' ? first.pageCount ?? 1 : 1
    if (pages <= 1) return read
    const items = [...read.data]
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 2; page <= Math.min(pages, LIST_MAX_PAGES); page++) {
      const more = readList(await call(() => session(ctx).call('get', { path: `${path}${sep}page=${page}` })))
      if (more.kind !== 'data') return more
      items.push(...more.data)
    }
    return { kind: 'data', data: items }
  }

  const post = async (ctx: TraktTrackerContext, step: TraktWriteStep) =>
    readAnswer(await pacer.run(async (): Promise<TraktPageAnswer> => {
      const result = await session(ctx).call('post', step, { once: true })
      return result.kind === 'not-connected' ? { kind: 'signed-out' } : result.response
    }, page => {
      const read = readAnswer(page)
      return read.kind === 'blocked' ? { blocked: true, retryAfter: read.retryAfter } : { blocked: false, retryAfter: null }
    }))

  const readDropped = async (ctx: TraktTrackerContext): Promise<TraktRead<{ ids: number[], raw: unknown[] }>> => {
    const ids: number[] = []
    const raw: unknown[] = []
    for (let page = 1; ; page++) {
      const answered = await call(() => session(ctx).call('get', { path: `/users/hidden/dropped?page=${page}&limit=${DROPPED_PAGE_LIMIT}` }))
      const read = readList(answered)
      if (read.kind !== 'data') return read
      ids.push(...droppedOf(read.data))
      raw.push(...read.data)
      const pages = answered.kind === 'answer' ? answered.pageCount ?? 1 : 1
      if (page >= Math.min(pages, DROPPED_MAX_PAGES)) return { kind: 'data', data: { ids, raw } }
    }
  }

  const readLists = async (ctx: TraktTrackerContext): Promise<TraktRead<TraktLists>> => {
    const ratingsSeasons = await getList(ctx, '/sync/ratings/seasons')
    if (ratingsSeasons.kind !== 'data') return ratingsSeasons
    const ratingsMovies = await getList(ctx, '/sync/ratings/movies')
    if (ratingsMovies.kind !== 'data') return ratingsMovies
    const watchlistShows = await getList(ctx, '/sync/watchlist/shows')
    if (watchlistShows.kind !== 'data') return watchlistShows
    const watchlistSeasons = await getList(ctx, '/sync/watchlist/seasons')
    if (watchlistSeasons.kind !== 'data') return watchlistSeasons
    const watchlistMovies = await getList(ctx, '/sync/watchlist/movies')
    if (watchlistMovies.kind !== 'data') return watchlistMovies
    const dropped = await readDropped(ctx)
    if (dropped.kind !== 'data') return dropped
    const watchedMovies = await getList(ctx, '/sync/watched/movies')
    if (watchedMovies.kind !== 'data') return watchedMovies
    return {
      kind: 'data',
      data: buildLists({
        ratingsSeasons: ratingsSeasons.data,
        ratingsMovies: ratingsMovies.data,
        watchlistShows: watchlistShows.data,
        watchlistSeasons: watchlistSeasons.data,
        watchlistMovies: watchlistMovies.data,
        dropped: dropped.data.ids,
        droppedItems: dropped.data.raw,
        watchedMovies: watchedMovies.data,
      }),
    }
  }

  const load = async (ctx: TraktTrackerContext, at: number, force = false): Promise<TraktRead<ListIndex>> => {
    const who = readAnswer(await call(() => session(ctx).call('whoami', {})))
    if (who.kind === 'signed-out') {
      if (at === epoch) index = { kind: 'signed-out', checkedAt: now() }
      return who
    }
    if (who.kind !== 'data') return who
    const user = who.data
    const changedRes = await get(ctx, '/sync/last_activities')
    if (changedRes.kind !== 'data') return changedRes
    const activities = activitiesOf(changedRes.data)
    const held = index?.kind === 'lists' ? index : undefined
    const canReuse = !force && held && held.user === user && activities !== undefined && held.activities === activities
    let lists = canReuse ? held.lists : undefined
    const watchedShows = canReuse ? held.watchedShows : undefined
    if (!lists) {
      const read = await readLists(ctx)
      if (read.kind !== 'data') return read
      lists = read.data
    }
    const next: ListIndex = { kind: 'lists', user, activities, lists, watchedShows, checkedAt: now() }
    if (at === epoch) index = next
    return { kind: 'data', data: next }
  }

  const indexOf = async (ctx: TraktTrackerContext, ttl = INDEX_TTL_MS): Promise<TraktRead<ListIndex>> => {
    for (;;) {
      const held = index
      if (held && now() - held.checkedAt < ttl) return held.kind === 'lists' ? { kind: 'data', data: held } : { kind: 'signed-out' }
      if (!loading || loading.epoch !== epoch) {
        const started = { epoch, promise: load(ctx, epoch) }
        const done = () => { if (loading === started) loading = undefined }
        started.promise.then(done, done)
        loading = started
      }
      const flight = loading
      const result = await flight.promise
      if (flight.epoch === epoch || result.kind === 'blocked' || result.kind === 'error') return result
    }
  }

  const targetForKey = (ctx: TraktTrackerContext, key: TraktKey) => {
    const id = keyId(key)
    let asked = targets.get(id)
    if (!asked) {
      asked = targetOfKey(key, {
        trakt: path => traktApi(path, ctx),
        anizip: (by, run) => fetchAnizipJsonMappings(by, run, ctx),
      })
      targets.set(id, asked)
      const failed = asked
      failed.catch(() => { if (targets.get(id) === failed) targets.delete(id) })
    }
    return asked
  }

  const resolveUri = async (ctx: TraktTrackerContext, uri: string): Promise<
    | { kind: 'target', target: TraktTarget }
    | { kind: 'none', why?: Said }
    | { kind: 'ambiguous', candidates: string[] }
  > => {
    const keyResult = traktKeyOf(uri, await catalogFor(uri, ctx.catalog))
    if (keyResult.kind === 'none') return { kind: 'none' }
    if (keyResult.kind === 'ambiguous') return { kind: 'ambiguous', candidates: keyResult.candidates }
    const placed = await targetForKey(ctx, keyResult.key)
    if (placed.kind === 'none') return { kind: 'none', why: placed.why }
    return { kind: 'target', target: placed.target }
  }

  const refusalOf = (resolved: Awaited<ReturnType<typeof resolveUri>>): Said | undefined =>
    resolved.kind === 'none' ? (resolved.why ?? NO_ID)
    : resolved.kind === 'ambiguous'
      ? forPage.formatMessage(
          { id: 'This media names {candidates}, and Trakt cannot tell which one is meant', defaultMessage: 'This media names {candidates}, and Trakt cannot tell which one is meant' },
          { candidates: { list: resolved.candidates, join: 'and' } },
        )
    : undefined

  const read = async (ctx: TraktTrackerContext, uri: string, key: TraktKey): Promise<TrackerAnswer> => {
    let resolved: TraktTarget
    let found: ListIndex
    try {
      const result = await indexOf(ctx)
      if (result.kind === 'signed-out') return answer(uri, 'SIGNED_OUT', {}, null)
      if (result.kind === 'blocked') return answer(uri, 'PAUSED', { error: waitMessage(pacer.pausedUntil()) })
      if (result.kind === 'error') return errorAnswer(uri, traktTracker(userOf()), result.message)
      found = result.data
      const placed = await targetForKey(ctx, key)
      if (placed.kind === 'none') return answer(uri, 'NO_ID', { error: placed.why }, found.user)
      resolved = placed.target
    } catch (error) {
      return failedReadAnswer(uri, traktTracker(userOf()), error)
    }

    if (resolved.kind === 'movie') {
      const entry = listEntryOfMovie(found.user, resolved.movie, found.lists)
      return entry
        ? answer(uri, 'LISTED', { entry, episodeCount: 1 }, found.user)
        : answer(uri, 'NOT_LISTED', { episodeCount: 1 }, found.user)
    }

    const range = resolved.range
    const episodeCount = range.to - range.from + 1
    let progress: TraktRead<unknown>
    try {
      progress = await get(ctx, `/shows/${range.show.trakt}/progress/watched${PROGRESS_QUERY}`, ctx.request.signal)
    } catch (error) {
      return failedReadAnswer(uri, traktTracker(found.user), error)
    }
    if (progress.kind === 'signed-out') {
      forget()
      return answer(uri, 'SIGNED_OUT', {}, null)
    }
    if (progress.kind === 'blocked') return answer(uri, 'PAUSED', { error: waitMessage(pacer.pausedUntil()) }, found.user)
    if (progress.kind === 'error') return errorAnswer(uri, traktTracker(found.user), progress.message)
    const entry = listEntryOf(found.user, range, progress.data, found.lists)
    return entry
      ? answer(uri, 'LISTED', { entry, episodeCount }, found.user)
      : answer(uri, 'NOT_LISTED', { episodeCount }, found.user)
  }

  const readListPage = async (ctx: TraktTrackerContext) => {
    try {
      const idx = await indexOf(ctx)
      if (idx.kind === 'signed-out') return ownList(traktTracker(undefined), 'SIGNED_OUT')
      if (idx.kind === 'blocked') return ownList(traktTracker(userOf()), 'PAUSED')
      if (idx.kind === 'error') return ownList(traktTracker(userOf()), 'ERROR')
      const found = idx.data
      let watchedShows = found.watchedShows
      if (!watchedShows) {
        const res = await getList(ctx, '/sync/watched/shows')
        if (res.kind === 'signed-out') {
          forget()
          return ownList(traktTracker(undefined), 'SIGNED_OUT')
        }
        if (res.kind === 'blocked') return ownList(traktTracker(found.user), 'PAUSED')
        if (res.kind === 'error') return ownList(traktTracker(found.user), 'ERROR')
        watchedShows = res.data
        if (index?.kind === 'lists' && index.user === found.user) index.watchedShows = watchedShows
      }
      return ownList(traktTracker(found.user), 'LISTED', listItemsOf(found.user, found.lists, watchedShows))
    } catch {
      return ownList(traktTracker(userOf()), 'ERROR')
    }
  }

  const notWritten = (result: Exclude<TraktRead<unknown>, { kind: 'data' }>): WriteOutcome[] =>
    result.kind === 'signed-out' ? outcome('REFUSED', SIGN_IN)
    : result.kind === 'blocked' ? outcome('FAILED', waitMessage(pacer.pausedUntil()))
    : outcome('FAILED', result.message)

  const applySteps = async (ctx: TraktTrackerContext, steps: TraktWriteStep[], turn: SaveTurn): Promise<{ ok: true } | { outcomes: WriteOutcome[], sentAny: boolean }> => {
    await turn.ready()
    let sentAny = false
    try {
      for (const step of steps) {
        let sent: TraktRead<unknown>
        try {
          sent = await post(ctx, step)
        } catch (error) {
          return {
            sentAny: true,
            outcomes: outcome('FAILED', forPage.formatMessage(
              { id: 'Trakt did not confirm the save: {error}', defaultMessage: 'Trakt did not confirm the save: {error}' },
              { error: messageOf(error) },
            )),
          }
        }
        if (sent.kind !== 'data') {
          if (!sentAny) return { sentAny: false, outcomes: notWritten(sent) }
          return {
            sentAny: true,
            outcomes: outcome('FAILED', sent.kind === 'error' ? sent.message : forPage.formatMessage({ id: 'Trakt took only part of the save', defaultMessage: 'Trakt took only part of the save' })),
          }
        }
        sentAny = true
      }
      return { ok: true }
    } finally {
      turn.wrote()
    }
  }

  const save = async (ctx: TraktTrackerContext, target: TraktTarget, input: ListEntryInput, turn: SaveTurn): Promise<WriteOutcome[]> => {
    const until = pacer.pausedUntil()
    if (until) return outcome('FAILED', waitMessage(until))
    const found = await indexOf(ctx, 0)
    if (found.kind !== 'data') return notWritten(found)
    const current = found.data

    let showProgressData: unknown
    if (target.kind === 'show') {
      const prog = await get(ctx, `/shows/${target.range.show.trakt}/progress/watched${PROGRESS_QUERY}`)
      if (prog.kind !== 'data') return notWritten(prog)
      showProgressData = prog.data
    }

    const nowIso = new Date(now()).toISOString()
    const plan: TraktWritePlan = target.kind === 'show'
      ? planShowWrite(target.range, showProgressData, current.lists, input, nowIso)
      : planMovieWrite(target.movie, current.lists, input, nowIso)

    if ('error' in plan) return outcome('REFUSED', plan.error)
    if ('noop' in plan) {
      const entry = target.kind === 'show'
        ? listEntryOf(current.user, target.range, showProgressData, current.lists)
        : listEntryOfMovie(current.user, target.movie, current.lists)
      return outcome('SAVED', null, entry)
    }

    const applied = await applySteps(ctx, plan.steps, turn)
    if (!('ok' in applied)) {
      if (applied.sentAny) {
        forget()
        changed()
      }
      return applied.outcomes
    }

    const historyOnly = target.kind === 'show' && plan.steps.every(step => step.path === '/sync/history' || step.path === '/sync/history/remove')
    let latest = current
    if (historyOnly) {
      if (index?.kind === 'lists') index.watchedShows = undefined
    } else {
      const mine = ++epoch
      const refreshed = await load(ctx, mine, true)
      if (refreshed.kind !== 'data') {
        forget()
        changed()
        return outcome('SAVED', null)
      }
      latest = refreshed.data
    }

    let entry: ReturnType<typeof listEntryOf> = null
    if (target.kind === 'show') {
      const afterProg = await get(ctx, `/shows/${target.range.show.trakt}/progress/watched${PROGRESS_QUERY}`)
      if (afterProg.kind !== 'data') {
        changed()
        return outcome('SAVED', null)
      }
      entry = listEntryOf(latest.user, target.range, afterProg.data, latest.lists)
    } else {
      entry = listEntryOfMovie(latest.user, target.movie, latest.lists)
    }
    changed()
    return outcome('SAVED', null, entry)
  }

  const remove = async (ctx: TraktTrackerContext, target: TraktTarget, turn: SaveTurn): Promise<WriteOutcome[]> => {
    const until = pacer.pausedUntil()
    if (until) return outcome('FAILED', waitMessage(until))
    const found = await indexOf(ctx, 0)
    if (found.kind !== 'data') return notWritten(found)
    const steps = target.kind === 'show'
      ? planShowRemove(target.range, found.data.lists)
      : planMovieRemove(target.movie, found.data.lists)
    if (!steps.length) return outcome('SAVED', null)

    const applied = await applySteps(ctx, steps, turn)
    if (!('ok' in applied)) {
      if (applied.sentAny) {
        forget()
        changed()
      }
      return applied.outcomes
    }

    const mine = ++epoch
    await load(ctx, mine, true).catch(() => {})
    changed()
    return outcome('SAVED', null)
  }

  return {
    Subscription: {
      tracking: {
        subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }, ctx: TraktTrackerContext) {
          const { uri } = input
          let keyResult: TraktKeyResult
          try {
            keyResult = traktKeyOf(uri, await catalogFor(uri, ctx.catalog))
          } catch (error) {
            yield trackingOf(uri, errorAnswer(uri, traktTracker(userOf()), messageOf(error)))
            return
          }
          if (keyResult.kind === 'none') {
            yield trackingOf(uri, answer(uri, 'NO_ID'))
            return
          }
          if (keyResult.kind === 'ambiguous') {
            yield trackingOf(uri, answer(uri, 'AMBIGUOUS', { candidates: keyResult.candidates }))
            return
          }
          watchSession(ctx)
          const own = session(ctx)
          const wakes = changes(listener => {
            const stop = own.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          const next = rereads(wakes, wait)
          let last: TrackerAnswer | undefined
          try {
            for (;;) {
              const pausedUntil = pacer.pausedUntil()
              if (pausedUntil && last?.state !== 'PAUSED') {
                last = answer(uri, 'PAUSED', { error: waitMessage(pausedUntil) })
                yield trackingOf(uri, last)
              }
              last = await read(ctx, uri, keyResult.key)
              const retry = last.state === 'PAUSED' && pacer.pausedUntil() !== undefined
              yield trackingOf(uri, last)
              if (retry) continue
              if (!await next(last.state === 'PAUSED' || last.state === 'ERROR')) return
            }
          } finally {
            await wakes.return?.()
          }
        },
      },
      viewerLists: {
        subscribe: async function* (_parent: unknown, _args: unknown, ctx: TraktTrackerContext) {
          watchSession(ctx)
          const own = session(ctx)
          const wakes = changes(listener => {
            const stop = own.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          const next = rereads(wakes, wait)
          let last: TrackerState | undefined
          try {
            for (;;) {
              if (pacer.pausedUntil() && last !== 'PAUSED') {
                last = 'PAUSED'
                yield ownList(traktTracker(userOf()), 'PAUSED')
              }
              const list = await readListPage(ctx)
              last = list.viewerLists.lists[0]!.state
              yield list
              if (last === 'PAUSED' && pacer.pausedUntil() !== undefined) continue
              if (!await next(last === 'PAUSED' || last === 'ERROR')) return
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
        ctx: TraktTrackerContext,
      ): Promise<WriteOutcome[]> => {
        try {
          watchSession(ctx)
          const resolved = await resolveUri(ctx, input.uri)
          const why = refusalOf(resolved)
          if (why || resolved.kind !== 'target') return outcome('REFUSED', why ?? null)
          return await saves.run(turn => save(ctx, resolved.target, input.entry, turn))
        } catch (error) {
          return outcome('FAILED', messageOf(error))
        }
      },
      deleteListEntry: async (_parent: unknown, { input }: { input: { uri: string } }, ctx: TraktTrackerContext): Promise<WriteOutcome[]> => {
        try {
          watchSession(ctx)
          const resolved = await resolveUri(ctx, input.uri)
          const why = refusalOf(resolved)
          if (why || resolved.kind !== 'target') return outcome('REFUSED', why ?? null)
          return await saves.run(turn => remove(ctx, resolved.target, turn))
        } catch (error) {
          return outcome('FAILED', messageOf(error))
        }
      },
    },
  } satisfies Resolvers
}
