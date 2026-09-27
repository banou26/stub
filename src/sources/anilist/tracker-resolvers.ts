// The AniList tracker's resolvers over whatever session and clock they are handed, so a test serves
// them over recorded answers; ./tracker.ts hands them the worker's.

import type { Resolvers, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { CatalogLookup, CatalogueTarget } from '../../tracking/identity'
import type { SiteSession, SiteSessionResult } from '../../tracking/site-session'
import type { SessionRequest } from './session-page'

import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer } from '../../tracking/collect'
import { catalogueTargetOf } from '../../tracking/identity'
import {
  ANILIST_TRACKER_ID, DELETE_MUTATION, ENTRY_ID_QUERY, TRACKING_QUERY,
  anilistTracker, listEntryOf, readResponse, saveRequest, scoreFormatOf,
  type AnilistViewer, type DeleteData, type EntryIdData, type Read, type SaveData, type TrackingData,
} from './list-api'
import { createPacer } from './pacing'

/** What the tracker reads off its request context, beside what every provider gets. */
export type AnilistTrackerContext = {
  catalog: () => Promise<CatalogLookup>
  /** The viewer's session on a site, by stub's name for it (`anilist`). */
  session: (site: string) => SiteSession
  request: { signal: AbortSignal }
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const outcome = (state: WriteOutcome['outcome'], error: string | null, entry: WriteOutcome['entry'] = null): WriteOutcome[] =>
  [{ tracker: ANILIST_TRACKER_ID, outcome: state, entry, error }]

const waitMessage = (until: number | undefined) =>
  until
    ? `AniList asked stub to wait until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'AniList asked stub to wait a minute'

/**
 * The viewer's own AniList list, through the anilist.co page the main thread keeps open with their
 * session. Every call goes through one pacer, and every answer names the viewer the last read found.
 *
 * The media is keyed on the AniList id stub's own tracker keys it on (`catalogueTargetOf`). Wherever
 * that tracker answers AMBIGUOUS so does this one, and nothing is asked or written.
 */
export const anilistTrackerResolvers = ({ now = Date.now, wait = sleep }: { now?: () => number, wait?: (ms: number) => Promise<void> } = {}) => {
  const pacer = createPacer({ now, wait })
  let viewer: AnilistViewer | undefined
  // every open answer reads again after a write through this tracker
  const written = new Set<() => void>()

  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}): TrackerAnswer =>
    ({ _id: answerId(ANILIST_TRACKER_ID, uri), tracker: anilistTracker(viewer), state, entry: null, candidates: [], error: null, pending: 0, ...extra })

  const targetOf = async (uri: string, ctx: AnilistTrackerContext) => catalogueTargetOf(uri, 'anilist', await ctx.catalog())

  const refusalOf = (target: CatalogueTarget) =>
    target.kind === 'none' ? 'This media names no AniList id'
    : target.kind === 'ambiguous' ? `This media names ${target.candidates.join(' and ')}, and AniList cannot tell which one is meant`
    : undefined

  const ask = async <T>(ctx: AnilistTrackerContext, request: SessionRequest, signal?: AbortSignal): Promise<Read<T>> => {
    const result = await pacer.run<SiteSessionResult>(
      () => ctx.session(ANILIST_TRACKER_ID).graphql(request),
      result => result.kind === 'response' ? result.response : undefined,
      signal,
    )
    if (result.kind === 'not-connected') return { kind: 'signed-out' }
    const read = readResponse<T>(result.response.status, result.response.body as never)
    if (read.kind === 'signed-out') viewer = undefined
    return read
  }

  const read = async (ctx: AnilistTrackerContext, uri: string, mediaId: number): Promise<TrackerAnswer> => {
    let result: Read<TrackingData>
    try {
      result = await ask<TrackingData>(ctx, { query: TRACKING_QUERY, variables: { mediaId } }, ctx.request.signal)
    } catch (error) {
      return errorAnswer(uri, anilistTracker(viewer), messageOf(error))
    }
    if (result.kind === 'signed-out') return answer(uri, 'SIGNED_OUT')
    if (result.kind === 'rate-limited') return answer(uri, 'PAUSED', { error: waitMessage(pacer.pausedUntil()) })
    if (result.kind === 'error') return errorAnswer(uri, anilistTracker(viewer), result.message)
    viewer = result.data.Viewer ?? undefined
    if (!viewer) return answer(uri, 'SIGNED_OUT')
    const media = result.data.Media
    if (!media) return errorAnswer(uri, anilistTracker(viewer), `AniList has no anime ${mediaId}`)
    // AniList's count even with nothing listed, so a sync onto it holds progress counted differently
    const episodeCount = media.episodes ?? null
    if (!media.mediaListEntry) return answer(uri, 'NOT_LISTED', { episodeCount })
    return answer(uri, 'LISTED', { episodeCount, entry: listEntryOf(scoreFormatOf(viewer), media, media.mediaListEntry) })
  }

  const notWritten = (result: Exclude<Read<unknown>, { kind: 'data' }>): WriteOutcome[] =>
    result.kind === 'signed-out' ? outcome('REFUSED', 'Sign in to AniList to save to it')
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
            yield trackingOf(uri, errorAnswer(uri, anilistTracker(viewer), messageOf(error)))
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
          const session = ctx.session(ANILIST_TRACKER_ID)
          // a sign in, or a write through this tracker, and the answer is read again
          const wakes = changes(listener => {
            const stop = session.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
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
              // would hold the next read back, so the answer waits for a change like any other.
              const retry = last.state === 'PAUSED' && pacer.pausedUntil() !== undefined
              yield trackingOf(uri, last)
              if (retry) continue
              if ((await wakes.next()).done) return
            }
          } finally {
            await wakes.return?.()
          }
        }
      }
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
          const result = await ask<SaveData>(ctx, built.request)
          if (result.kind !== 'data') return notWritten(result)
          const saved = result.data.SaveMediaListEntry
          if (!saved) return outcome('FAILED', 'AniList answered the save with no entry')
          changed()
          return outcome('SAVED', null, saved.media ? listEntryOf(scoreFormatOf(viewer), saved.media, saved) : null)
        } catch (error) {
          return outcome('FAILED', messageOf(error))
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
          const deleted = await ask<DeleteData>(ctx, { query: DELETE_MUTATION, variables: { id } })
          if (deleted.kind !== 'data') return notWritten(deleted)
          if (!deleted.data.DeleteMediaListEntry?.deleted) return outcome('FAILED', 'AniList did not delete the entry')
          changed()
          return outcome('SAVED', null)
        } catch (error) {
          return outcome('FAILED', messageOf(error))
        }
      },
    },
  } satisfies Resolvers
}
