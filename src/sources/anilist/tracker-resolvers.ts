// The AniList tracker's resolvers over whatever session and clock they are handed, so a test serves
// them over recorded answers; ./tracker.ts hands them the worker's.

import type { ListItem, Resolvers, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { CatalogLookup, CatalogueTarget } from '../../tracking/identity'
import type { PageApi, SiteSession, SiteSessionResult } from '../../tracking/site-session'
import type { SessionPageApi, SessionRequest, SessionResponse } from './session-page'

import { forPage, saidOf, type Said } from '../../i18n/said'
import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer, failedReadAnswer, rereads } from '../../tracking/collect'
import { catalogFor, catalogueTargetOf } from '../../tracking/identity'
import { ownList } from '../../tracking/lists'
import {
  ANILIST_TRACKER_ID, DELETE_MUTATION, ENTRY_ID_QUERY, LIST_QUERY, TRACKING_QUERY, VIEWER_QUERY,
  anilistTracker, listEntryOf, listItemOf, readResponse, saveRequest,
  type AnilistViewer, type DeleteData, type EntryIdData, type ListData, type Read, type SaveData, type TrackingData, type ViewerData,
} from './list-api'
import { createPacer } from './pacing'

/** What the tracker reads off its request context, beside what every provider gets. */
export type AnilistTrackerContext = {
  catalog: () => Promise<CatalogLookup>
  /** The viewer's session on a site, by stub's name for it (`anilist`), typed by its page's api. */
  session: <Api extends PageApi>(site: string) => SiteSession<Api>
  request: { signal: AbortSignal }
}

/** How long one read of a media answers every later ask for it. */
export const READ_MEMORY_MS = 60_000

/** How long one read of the whole list answers every later ask for it, as MyAnimeList's index does. */
export const LIST_MEMORY_MS = 10 * 60_000

/**
 * A whole list is read 500 entries a chunk, chunks counted from 1, and at most 20 chunks, so an answer that
 * always says there is more cannot read on for ever. Neither the size nor the count from 1 was measured: only
 * a first chunk was (LIST_QUERY).
 */
const PER_CHUNK = 500
const MAX_CHUNKS = 20

type Remembered = { read: Promise<Read<TrackingData>>, at?: number }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const outcome = (state: WriteOutcome['outcome'], error: Said | null, entry: WriteOutcome['entry'] = null): WriteOutcome[] =>
  [{ tracker: ANILIST_TRACKER_ID, outcome: state, entry, error }]

const waitMessage = (until: number | undefined) =>
  until
    ? forPage.formatMessage({ id: 'AniList asked stub to wait until {time}', defaultMessage: 'AniList asked stub to wait until {time}' }, { time: { time: until } })
    : forPage.formatMessage({ id: 'AniList asked stub to wait a minute', defaultMessage: 'AniList asked stub to wait a minute' })

const SIGN_IN = forPage.formatMessage({ id: 'Sign in to AniList to save to it', defaultMessage: 'Sign in to AniList to save to it' })

/**
 * The viewer's own AniList list, through the anilist.co page the main thread keeps open with their
 * session. Every call goes through one pacer, and every answer names the viewer the last read found.
 * One read of a media answers every ask for it while on its way, and READ_MEMORY_MS after when AniList
 * answered it for a signed in viewer, unless a write, a sign in or out, or a read finding the viewer
 * signed out came since.
 *
 * The media is keyed on the AniList id stub's own tracker keys it on (`catalogueTargetOf`). Wherever
 * that tracker answers AMBIGUOUS so does this one, and nothing is asked or written.
 */
export const anilistTrackerResolvers = ({ now = Date.now, wait = sleep }: { now?: () => number, wait?: (ms: number) => Promise<void> } = {}) => {
  const pacer = createPacer({ now, wait })
  let viewer: AnilistViewer | undefined
  // every open answer reads again after a write through this tracker
  const written = new Set<() => void>()
  // by AniList id, the read on its way or the last one answered with data: a title's address grows a
  // few times while its modal opens, and each growth subscribes again
  const remembered = new Map<number, Remembered>()
  // the whole list, as `remembered` holds one media's read
  let listed: { read: Promise<Read<ListItem[]>>, at?: number } | undefined
  let watching = false

  const forget = () => {
    remembered.clear()
    listed = undefined
  }

  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}): TrackerAnswer =>
    ({ _id: answerId(ANILIST_TRACKER_ID, uri), tracker: anilistTracker(viewer), state, entry: null, candidates: [], error: null, ...extra })

  const targetOf = async (uri: string, ctx: AnilistTrackerContext) => catalogueTargetOf(uri, 'anilist', await catalogFor(uri, ctx.catalog))

  const refusalOf = (target: CatalogueTarget) =>
    target.kind === 'none' ? forPage.formatMessage({ id: 'This media names no AniList id', defaultMessage: 'This media names no AniList id' })
    : target.kind === 'ambiguous' ? forPage.formatMessage({ id: 'This media names {candidates}, and AniList cannot tell which one is meant', defaultMessage: 'This media names {candidates}, and AniList cannot tell which one is meant' }, { candidates: { list: target.candidates, join: 'and' } })
    : undefined

  const ask = async <T>(ctx: AnilistTrackerContext, request: SessionRequest, signal?: AbortSignal): Promise<Read<T>> => {
    const result = await pacer.run<SiteSessionResult<SessionResponse>>(
      () => ctx.session<SessionPageApi>(ANILIST_TRACKER_ID).call('graphql', request),
      result => result.kind === 'response' ? result.response : undefined,
      signal,
    )
    if (result.kind === 'not-connected') return { kind: 'signed-out' }
    const read = readResponse<T>(result.response.status, result.response.body as never)
    if (read.kind === 'signed-out') {
      viewer = undefined
      forget()
    }
    return read
  }

  // one watch for the whole tracker, since what it remembers outlives every subscription
  const watchSession = (ctx: AnilistTrackerContext) => {
    if (watching) return
    watching = true
    ctx.session(ANILIST_TRACKER_ID).onChange(forget)
  }

  // forgetting before the write is queued is enough, whatever it answers: the pacer sends every read
  // asked after it once it has settled
  const write = <T>(ctx: AnilistTrackerContext, request: SessionRequest): Promise<Read<T>> => {
    forget()
    return ask<T>(ctx, request)
  }

  const trackingRead = async (ctx: AnilistTrackerContext, mediaId: number): Promise<Read<TrackingData>> => {
    for (;;) {
      const held = remembered.get(mediaId)
      if (!held || (held.at !== undefined && now() - held.at >= READ_MEMORY_MS)) break
      try {
        return await held.read
      } catch {
        // failed, or given up in the pacer by the subscription that sent it: the first waiter to get here
        // reads again, and the others wait on that read
      }
    }
    const mine: Remembered = { read: ask<TrackingData>(ctx, { query: TRACKING_QUERY, variables: { mediaId } }, ctx.request.signal) }
    remembered.set(mediaId, mine)
    const drop = () => { if (remembered.get(mediaId) === mine) remembered.delete(mediaId) }
    mine.read.then(result => { if (result.kind === 'data' && result.data.Viewer) mine.at = now(); else drop() }, drop)
    return await mine.read
  }

  const read = async (ctx: AnilistTrackerContext, uri: string, mediaId: number): Promise<TrackerAnswer> => {
    let result: Read<TrackingData>
    try {
      result = await trackingRead(ctx, mediaId)
    } catch (error) {
      return failedReadAnswer(uri, anilistTracker(viewer), error)
    }
    if (result.kind === 'signed-out') return answer(uri, 'SIGNED_OUT')
    if (result.kind === 'rate-limited') return answer(uri, 'PAUSED', { error: waitMessage(pacer.pausedUntil()) })
    if (result.kind === 'error') return errorAnswer(uri, anilistTracker(viewer), result.message)
    viewer = result.data.Viewer ?? undefined
    if (!viewer) return answer(uri, 'SIGNED_OUT')
    const media = result.data.Media
    if (!media) return errorAnswer(uri, anilistTracker(viewer), forPage.formatMessage({ id: 'AniList has no anime {id}', defaultMessage: 'AniList has no anime {id}' }, { id: mediaId }))
    // AniList's count even with nothing listed, so the row can tell whether progress means the same there
    const episodeCount = media.episodes ?? null
    if (!media.mediaListEntry) return answer(uri, 'NOT_LISTED', { episodeCount })
    return answer(uri, 'LISTED', { episodeCount, entry: listEntryOf(media, media.mediaListEntry) })
  }

  const readWholeList = async (ctx: AnilistTrackerContext): Promise<Read<ListItem[]>> => {
    const who = await ask<ViewerData>(ctx, { query: VIEWER_QUERY }, ctx.request.signal)
    if (who.kind !== 'data') return who
    const found = who.data.Viewer
    if (!found) return { kind: 'signed-out' }
    viewer = found
    // by entry id: a custom list holds entries its status list holds too
    const items = new Map<number, ListItem>()
    for (let chunk = 1; chunk <= MAX_CHUNKS; chunk++) {
      const page = await ask<ListData>(ctx, { query: LIST_QUERY, variables: { userId: found.id, chunk, perChunk: PER_CHUNK } }, ctx.request.signal)
      if (page.kind !== 'data') return page
      const collection = page.data.MediaListCollection
      for (const list of collection?.lists ?? []) {
        for (const entry of list.entries ?? []) if (entry.media) items.set(entry.id, listItemOf(entry.media, entry))
      }
      if (!collection?.hasNextChunk) break
    }
    return { kind: 'data', data: [...items.values()] }
  }

  // one read of the whole list at a time, kept as `trackingRead` keeps one media's
  const listRead = async (ctx: AnilistTrackerContext): Promise<Read<ListItem[]>> => {
    for (;;) {
      const held = listed
      if (!held || (held.at !== undefined && now() - held.at >= LIST_MEMORY_MS)) break
      try {
        return await held.read
      } catch {
        // given up by the subscription that sent it: read again
      }
    }
    const mine: { read: Promise<Read<ListItem[]>>, at?: number } = { read: readWholeList(ctx) }
    listed = mine
    const drop = () => { if (listed === mine) listed = undefined }
    mine.read.then(result => { if (result.kind === 'data') mine.at = now(); else drop() }, drop)
    return await mine.read
  }

  const readList = async (ctx: AnilistTrackerContext) => {
    let result: Read<ListItem[]>
    try {
      result = await listRead(ctx)
    } catch {
      return ownList(anilistTracker(viewer), 'ERROR')
    }
    if (result.kind === 'signed-out') return ownList(anilistTracker(undefined), 'SIGNED_OUT')
    if (result.kind === 'rate-limited') return ownList(anilistTracker(viewer), 'PAUSED')
    if (result.kind === 'error') return ownList(anilistTracker(viewer), 'ERROR')
    return ownList(anilistTracker(viewer), 'LISTED', result.data)
  }

  const notWritten = (result: Exclude<Read<unknown>, { kind: 'data' }>): WriteOutcome[] =>
    result.kind === 'signed-out' ? outcome('REFUSED', SIGN_IN)
    : result.kind === 'rate-limited' ? outcome('FAILED', waitMessage(pacer.pausedUntil()))
    : outcome('FAILED', result.message)

  const changed = () => { for (const listener of written) listener() }

  return {
    Subscription: {
      tracking: {
        subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }, ctx: AnilistTrackerContext) {
          const { uri } = input
          let target: CatalogueTarget
          try {
            target = await targetOf(uri, ctx)
          } catch (error) {
            yield trackingOf(uri, errorAnswer(uri, anilistTracker(viewer), saidOf(error)))
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
          const session = ctx.session(ANILIST_TRACKER_ID)
          // a sign in, or a write through this tracker, and the answer is read again
          const wakes = changes(listener => {
            const stop = session.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          const next = rereads(wakes, wait)
          let last: TrackerAnswer | undefined
          try {
            for (;;) {
              // said before the pacer holds the read back, so a paused tracker is not a silent one
              const until = pacer.pausedUntil()
              if (until && last?.state !== 'PAUSED') {
                last = answer(uri, 'PAUSED', { error: waitMessage(until) })
                yield trackingOf(uri, last)
              }
              last = await read(ctx, uri, target.id)
              // asked again once the pause is over, which the pacer waits out. With no pause set nothing
              // would hold the next read back, so it waits like a failed read.
              const retry = last.state === 'PAUSED' && pacer.pausedUntil() !== undefined
              yield trackingOf(uri, last)
              if (retry) continue
              if (!await next(last.state === 'PAUSED' || last.state === 'ERROR')) return
            }
          } finally {
            await wakes.return?.()
          }
        }
      },
      // read and read again exactly as `tracking` is
      viewerLists: {
        subscribe: async function* (_parent: unknown, _args: unknown, ctx: AnilistTrackerContext) {
          watchSession(ctx)
          const session = ctx.session(ANILIST_TRACKER_ID)
          const wakes = changes(listener => {
            const stop = session.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          const next = rereads(wakes, wait)
          let last: TrackerState | undefined
          try {
            for (;;) {
              if (pacer.pausedUntil() && last !== 'PAUSED') {
                last = 'PAUSED'
                yield ownList(anilistTracker(viewer), 'PAUSED')
              }
              const list = await readList(ctx)
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
        { input }: { input: { uri: string, entry: Parameters<typeof saveRequest>[1] } },
        ctx: AnilistTrackerContext,
      ): Promise<WriteOutcome[]> => {
        try {
          const target = await targetOf(input.uri, ctx)
          const why = refusalOf(target)
          if (why || target.kind !== 'id') return outcome('REFUSED', why ?? null)
          const built = saveRequest(target.id, input.entry)
          if ('error' in built) return outcome('REFUSED', built.error)
          const result = await write<SaveData>(ctx, built.request)
          if (result.kind !== 'data') return notWritten(result)
          const saved = result.data.SaveMediaListEntry
          if (!saved) return outcome('FAILED', forPage.formatMessage({ id: 'AniList answered the save with no entry', defaultMessage: 'AniList answered the save with no entry' }))
          changed()
          return outcome('SAVED', null, saved.media ? listEntryOf(saved.media, saved) : null)
        } catch (error) {
          return outcome('FAILED', saidOf(error))
        }
      },
      deleteListEntry: async (_parent: unknown, { input }: { input: { uri: string } }, ctx: AnilistTrackerContext): Promise<WriteOutcome[]> => {
        try {
          const target = await targetOf(input.uri, ctx)
          const why = refusalOf(target)
          if (why || target.kind !== 'id') return outcome('REFUSED', why ?? null)
          const found = await ask<EntryIdData>(ctx, { query: ENTRY_ID_QUERY, variables: { mediaId: target.id } })
          if (found.kind !== 'data') return notWritten(found)
          const id = found.data.Media?.mediaListEntry?.id
          // nothing listed is what a delete asks for
          if (id == null) return outcome('SAVED', null)
          const deleted = await write<DeleteData>(ctx, { query: DELETE_MUTATION, variables: { id } })
          if (deleted.kind !== 'data') return notWritten(deleted)
          if (!deleted.data.DeleteMediaListEntry?.deleted) return outcome('FAILED', forPage.formatMessage({ id: 'AniList did not delete the entry', defaultMessage: 'AniList did not delete the entry' }))
          changed()
          return outcome('SAVED', null)
        } catch (error) {
          return outcome('FAILED', saidOf(error))
        }
      },
    },
  } satisfies Resolvers
}
