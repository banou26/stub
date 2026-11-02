// STUB-319 (My list said it could not read AniList and MyAnimeList): the lists the page reads, from the real
// AniList and MyAnimeList trackers through the main thread's sessions, over fake session frames. The page draws
// its "Could not read the list" line for a list in ERROR or PAUSED and for no other (tests/unit/router/list-page).
import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { Tracker } from '../../../src/generated/schema/types.generated'
import type { SessionFrames } from '../../../src/tracking/session-frames'
import type { PageApi } from '../../../src/tracking/site-session'

import { anilistTrackerResolvers } from '../../../src/sources/anilist/tracker-resolvers'
import { malTrackerResolvers } from '../../../src/sources/mal/tracker-resolvers'
import { trackingResolvers, type TrackerProvider } from '../../../src/tracking/app-resolvers'
import { createConnections, siteSessionResolvers } from '../../../src/tracking/connections'
import { providerServer, subscribe, yogaClient } from '../worker/yoga-client'
import { AIRING_LIST_ENTRY, VIEWER, listBody } from '../sources/anilist/list-fixtures'
import { fakeMal } from '../sources/mal/fake-mal'

const NO_LIMIT = { limit: null, remaining: null, reset: null, retryAfter: null }

// anilist.co's page, answering the viewer and the list
const anilistPage: PageApi = {
  graphql: async ({ query }: { query: string }) => ({
    status: 200,
    body: query.includes('StubViewer') ? { data: { Viewer: VIEWER } } : listBody([AIRING_LIST_ENTRY]),
    rateLimit: NO_LIMIT,
  }),
} as never

const malPage = (): PageApi => {
  const mal = fakeMal()
  return Object.fromEntries(['whoami', 'list', 'write', 'anime'].map(method =>
    [method, async (arg: unknown) => ((await mal.call(method, arg)) as { response: unknown }).response])) as never
}

/** What @fkn/lib rejects with when the viewer answered Not now to its card for a site (cloud, 0.9.68). */
const refusal = () => Object.assign(new Error('frame.evaluate: the user did not grant evaluation here'), { name: 'LocatorDeniedError' })

/** The pages a frame reaches, or the error it fails with instead, by site. */
const setup = ({ connected, fails = {} }: { connected: string[], fails?: Record<string, () => Error> }) => {
  const pages: Record<string, PageApi> = { anilist: anilistPage, mal: malPage() }
  const use = vi.fn(async <T>(site: string, call: (api: PageApi) => Promise<T>) => {
    const failure = fails[site]
    if (failure) throw failure()
    return await call(pages[site]!)
  })
  const frames = { use, reload: () => {}, watch: () => () => {} } as unknown as SessionFrames<PageApi>
  const values = new Map<string, string>()
  const connections = createConnections(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }), { postMessage: () => {} })
  for (const site of connected) connections.connect(site)
  const sessions = siteSessionResolvers(frames, connections)
  // the worker's half of the channel, as src/worker/site-sessions.ts makes it
  const session = (site: string) => ({ call: (method: string, arg: unknown, options?: object) => sessions.call(site, method, arg, options), onChange: () => () => {} })
  // a failed read waits RETRY_MS before it reads again, which no test here waits out
  const clock = { wait: () => new Promise<void>(() => {}) }
  const context = { catalog: async () => ({ lookup: () => undefined }), session }
  const entry = (origin: string, resolvers: object): TrackerProvider =>
    ({ name: origin, extractor: { origin }, client: yogaClient(providerServer(origin, resolvers, context)) })
  const trackerOf = (provider: TrackerProvider): Tracker =>
    ({ id: provider.extractor.origin, name: provider.extractor.origin, icon: null, color: null, signedIn: false, account: null, canWrite: false, scoreScale: 'POINT_100' })
  const app = providerServer('app', trackingResolvers([entry('anilist', anilistTrackerResolvers(clock)), entry('mal', malTrackerResolvers(clock))], trackerOf))
  return { app, use }
}

const LISTS = `
  subscription {
    viewerLists {
      _id
      lists { state tracker { id } }
      rows { uri }
    }
  }
`

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const listsOf = async (app: ReturnType<typeof setup>['app']) => {
  const lists = subscribe(app, LISTS, {})
  live.push(lists)
  const settled = await lists.until(result => result.data.viewerLists.lists.every((list: { state: string }) => list.state !== 'LOADING'))
  return Object.fromEntries(settled.data.viewerLists.lists.map((list: { tracker: { id: string }, state: string }) => [list.tracker.id, list.state]))
}

test('a viewer who never connected either tracker has both signed out, and no page is asked', async () => {
  const { app, use } = setup({ connected: [] })
  expect(await listsOf(app)).toEqual({ anilist: 'SIGNED_OUT', mal: 'SIGNED_OUT' })
  expect(use).not.toHaveBeenCalled()
})

test('connected trackers read their lists whole', async () => {
  const { app } = setup({ connected: ['anilist', 'mal'] })
  expect(await listsOf(app)).toEqual({ anilist: 'LISTED', mal: 'LISTED' })
})

test("connected trackers whose site FKN was not let run stub's page on read as signed out, not as failed", async () => {
  const { app } = setup({ connected: ['anilist', 'mal'], fails: { anilist: refusal, mal: refusal } })
  expect(await listsOf(app)).toEqual({ anilist: 'SIGNED_OUT', mal: 'SIGNED_OUT' })
})

test('a connected tracker whose page fails still reads as failed, beside one that reads', async () => {
  const { app } = setup({ connected: ['anilist', 'mal'], fails: { mal: () => new Error('https://myanimelist.net did not answer within 30 s') } })
  expect(await listsOf(app)).toEqual({ anilist: 'LISTED', mal: 'ERROR' })
})
