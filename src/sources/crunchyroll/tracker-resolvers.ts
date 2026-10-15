// The Crunchyroll tracker's resolvers over whatever session they are handed, so a test serves them over
// recorded answers; ./tracker.ts hands them the worker's.

import type { Resolvers, Tracker, TrackerAnswer, TrackerState, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { PageApi, SiteSession } from '../../tracking/site-session'
import type { CrunchyrollPageApi, WatchedEpisode } from './session-page'

import { trackingId } from '../../tracking/aggregate'
import { answerId, changes, errorAnswer, rereads } from '../../tracking/collect'
import { extractAggregatedUriOrigin } from '../../utils/uri'
import { CRUNCHYROLL_ICON, CRUNCHYROLL_TRACKER_ID } from './session'
import { crunchyrollSignInState } from './sign-in-check'

/** What the tracker reads off its request context, beside what every provider gets. */
export type CrunchyrollTrackerContext = {
  /** The viewer's session on a site, by stub's name for it (`cr`), typed by its page's api. */
  session: <Api extends PageApi>(site: string) => SiteSession<Api>
  request: { signal: AbortSignal }
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const crunchyrollTracker = (signedIn: boolean): Tracker => ({
  id: CRUNCHYROLL_TRACKER_ID,
  name: 'Crunchyroll',
  icon: CRUNCHYROLL_ICON,
  color: null,
  signedIn,
  account: null,
  canWrite: false,
  readOnly: true,
  scoreScale: 'POINT_100',
})

const trackingOf = (uri: string, answer: TrackerAnswer): { tracking: Tracking } =>
  ({ tracking: { _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] } })

const refused = (): WriteOutcome[] => [{ tracker: CRUNCHYROLL_TRACKER_ID, outcome: 'REFUSED', entry: null, error: 'Crunchyroll is read only' }]

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
 * How far the viewer got: the place among the season's numbered episodes of the last one fully
 * watched, since Crunchyroll may number a season on from the one before it.
 */
const progressOf = (episodes: readonly WatchedEpisode[]) => {
  const watched = episodes.filter(episode => episode.watched).map(episode => episode.number)
  const last = Math.max(...watched)
  return watched.length ? new Set(episodes.map(episode => episode.number).filter(number => number <= last)).size : 0
}

/**
 * How far the viewer got on Crunchyroll, read off Crunchyroll's own playheads through the session frame
 * at www.crunchyroll.com, again after every sign in. LISTED once an episode is fully watched there,
 * NOT_LISTED before. Read only: every write is refused, and nothing is kept.
 *
 * It answers no episode count: Crunchyroll lists only the episodes aired so far, and a count short of
 * the run's would become the row's total and change what is written to the other trackers.
 */
export const crunchyrollTrackerResolvers = ({ wait = sleep }: { wait?: (ms: number) => Promise<void> } = {}) => {
  const answer = (uri: string, state: TrackerState, extra: Partial<TrackerAnswer> = {}): TrackerAnswer =>
    ({ _id: answerId(CRUNCHYROLL_TRACKER_ID, uri), tracker: crunchyrollTracker(state === 'LISTED' || state === 'NOT_LISTED'), state, entry: null, candidates: [], error: null, ...extra })

  const read = async (ctx: CrunchyrollTrackerContext, uri: string, { id, seriesId, seasonId }: Season): Promise<TrackerAnswer> => {
    try {
      const result = await ctx.session<CrunchyrollPageApi>(CRUNCHYROLL_TRACKER_ID).call('watched', { seriesId, seasonId })
      if (result.kind === 'not-connected' || crunchyrollSignInState(result.response) === 'signed-out') return answer(uri, 'SIGNED_OUT')
      const progress = progressOf(result.response.episodes ?? [])
      if (!progress) return answer(uri, 'NOT_LISTED')
      const entryId = `${CRUNCHYROLL_TRACKER_ID}:${id}`
      return answer(uri, 'LISTED', { entry: { _id: entryId, tracker: CRUNCHYROLL_TRACKER_ID, mediaUri: entryId, status: null, progress, score: null } })
    } catch (error) {
      return errorAnswer(uri, crunchyrollTracker(false), messageOf(error))
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
          const wakes = changes(listener => ctx.session(CRUNCHYROLL_TRACKER_ID).onChange(listener), { signal: ctx.request.signal })
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
      saveListEntry: refused,
      deleteListEntry: refused,
    },
  } satisfies Resolvers
}
