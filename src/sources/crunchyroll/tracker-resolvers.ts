// The Crunchyroll tracker's resolvers over whatever session they are handed, so a test serves them over
// recorded answers; ./tracker.ts hands them the worker's.

import type { ListEntryInput, ListStatus, Resolvers, Tracker, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { PageApi, SiteSession } from '../../tracking/site-session'
import type { CrunchyrollPageApi, Held, SaveRequest } from './session-page'

import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer, rereads } from '../../tracking/collect'
import { isScored, nativeScore } from '../../tracking/score-scale'
import { extractAggregatedUriOrigin } from '../../utils/uri'
import { CRUNCHYROLL_ICON, CRUNCHYROLL_TRACKER_ID } from './session'
import { crunchyrollSignInState } from './sign-in-check'

/** What the tracker reads off its request context, beside what every provider gets. */
export type CrunchyrollTrackerContext = {
  /** The viewer's session on a site, by stub's name for it (`cr`), typed by its page's api. */
  session: <Api extends PageApi>(site: string) => SiteSession<Api>
  request: { signal: AbortSignal }
}

/** Crunchyroll's 1 to 5 stars. */
export const SCORE_SCALE = 'POINT_5'

/** The one status Crunchyroll keeps a place for: its Watchlist. */
export const STATUSES: ListStatus[] = ['PLANNING']

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const crunchyrollTracker = (signedIn: boolean): Tracker => ({
  id: CRUNCHYROLL_TRACKER_ID,
  name: 'Crunchyroll',
  icon: CRUNCHYROLL_ICON,
  color: null,
  signedIn,
  account: null,
  canWrite: signedIn,
  statuses: STATUSES,
  scoreScale: SCORE_SCALE,
})

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const outcome = (state: WriteOutcome['outcome'], error: string | null = null): WriteOutcome[] =>
  [{ tracker: CRUNCHYROLL_TRACKER_ID, outcome: state, entry: null, error }]

type Season = { id: string, seriesId: string, seasonId: string }

/**
 * The `cr` id of the season the media plays on Crunchyroll, the one the Crunchyroll source answers
 * about. A show-level id names no season, and each season counts its own episodes.
 */
const seasonOf = (uri: string): Season | undefined => {
  const id = extractAggregatedUriOrigin(uri, CRUNCHYROLL_TRACKER_ID)?.id
  const [seriesId, seasonId] = id?.split('-') ?? []
  return id && seriesId && seasonId ? { id, seriesId, seasonId } : undefined
}

/**
 * What a save writes on Crunchyroll: progress, the score as stars (none for a cleared one), and Plan to
 * watch as the Watchlist. Any other status has no place there, so Completed sends the episodes alone.
 */
const saveOf = ({ status, progress, score }: ListEntryInput): Omit<SaveRequest, 'seriesId' | 'seasonId'> => ({
  ...progress != null ? { progress } : {},
  ...score !== undefined ? { stars: isScored(score) ? nativeScore(score, SCORE_SCALE) : null } : {},
  ...status === 'PLANNING' ? { watchlist: true } : {},
})

/**
 * The viewer's own Crunchyroll through the session frame at www.crunchyroll.com: how far they got in
 * the season, read off Crunchyroll's playheads, the series' stars as the score, and the Watchlist as
 * Plan to watch while nothing of the season is watched (a watched show on it is one being followed).
 * Read again after every sign in and every write, and nothing is kept. LISTED once any of those is
 * there, NOT_LISTED before.
 *
 * A save reads what Crunchyroll holds and writes what changes, in the page, once: a write cut short is
 * never sent again, and the read after it is the confirmation. Progress only rises (Crunchyroll has no
 * unmark). A removal takes the series off the Watchlist and leaves the episodes and the stars.
 *
 * It answers no episode count: Crunchyroll lists only the episodes aired so far, and a count short of
 * the run's would become the row's total and change what is written to the other trackers.
 */
export const crunchyrollTrackerResolvers = ({ wait = sleep }: { wait?: (ms: number) => Promise<void> } = {}) => {
  // every open answer reads again after a write through this tracker
  const written = new Set<() => void>()

  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}): TrackerAnswer =>
    ({ _id: answerId(CRUNCHYROLL_TRACKER_ID, uri), tracker: crunchyrollTracker(state === 'LISTED' || state === 'NOT_LISTED'), state, entry: null, candidates: [], error: null, ...extra })

  const listed = (uri: string, { id }: Season, { progress, stars, watchlisted }: Held): TrackerAnswer => {
    if (!progress && !stars && !watchlisted) return answer(uri, 'NOT_LISTED')
    const entryId = `${CRUNCHYROLL_TRACKER_ID}:${id}`
    const status = watchlisted && !progress ? 'PLANNING' : null
    return answer(uri, 'LISTED', { entry: { _id: entryId, tracker: CRUNCHYROLL_TRACKER_ID, mediaUri: entryId, status, progress, score: stars && stars * 20 } })
  }

  const read = async (ctx: CrunchyrollTrackerContext, uri: string, season: Season): Promise<TrackerAnswer> => {
    try {
      const result = await ctx.session<CrunchyrollPageApi>(CRUNCHYROLL_TRACKER_ID).call('watched', { seriesId: season.seriesId, seasonId: season.seasonId })
      if (result.kind === 'not-connected' || crunchyrollSignInState(result.response) === 'signed-out') return answer(uri, 'SIGNED_OUT')
      return listed(uri, season, result.response.held!)
    } catch (error) {
      return errorAnswer(uri, crunchyrollTracker(false), messageOf(error))
    }
  }

  const write = async (ctx: CrunchyrollTrackerContext, uri: string, fields: Omit<SaveRequest, 'seriesId' | 'seasonId'>): Promise<WriteOutcome[]> => {
    const season = seasonOf(uri)
    if (!season) return outcome('REFUSED', 'This media names no Crunchyroll season')
    if (!Object.keys(fields).length) return outcome('SAVED')
    try {
      const result = await ctx.session<CrunchyrollPageApi>(CRUNCHYROLL_TRACKER_ID)
        .call('save', { seriesId: season.seriesId, seasonId: season.seasonId, ...fields }, { once: true })
      if (result.kind === 'not-connected' || crunchyrollSignInState(result.response) === 'signed-out') return outcome('REFUSED', 'Sign in to Crunchyroll to save to it')
      return result.response.refused ? outcome('REFUSED', result.response.refused) : outcome('SAVED')
    } catch (error) {
      return outcome('FAILED', messageOf(error))
    } finally {
      for (const listener of written) listener()
    }
  }

  return {
    Subscription: {
      tracking: {
        subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }, ctx: CrunchyrollTrackerContext) {
          const { uri } = input
          const season = seasonOf(uri)
          if (!season) {
            yield trackingOf(uri, answer(uri, 'NO_ID'))
            return
          }
          const session = ctx.session(CRUNCHYROLL_TRACKER_ID)
          // a sign in, or a write through this tracker, and the answer is read again
          const wakes = changes(listener => {
            const stop = session.onChange(listener)
            written.add(listener)
            return () => { stop(); written.delete(listener) }
          }, { signal: ctx.request.signal })
          const next = rereads(wakes, wait)
          try {
            for (;;) {
              const last = await read(ctx, uri, season)
              yield trackingOf(uri, last)
              if (!await next(last.state === 'ERROR')) return
            }
          } finally {
            await wakes.return?.()
          }
        },
      },
    },
    Mutation: {
      saveListEntry: (_parent: unknown, { input }: { input: { uri: string, entry: ListEntryInput } }, ctx: CrunchyrollTrackerContext) =>
        write(ctx, input.uri, saveOf(input.entry)),
      deleteListEntry: (_parent: unknown, { input }: { input: { uri: string } }, ctx: CrunchyrollTrackerContext) =>
        write(ctx, input.uri, { watchlist: false }),
    },
  } satisfies Resolvers
}
