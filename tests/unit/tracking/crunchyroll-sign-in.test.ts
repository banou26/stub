// Signing in to Crunchyroll to watch turns its tracking on, as Log in on its chip does: from Accounts, in
// the app's own page, and from the player, in the embed's own document, whose sign in reaches the app's
// page as a storage event, or on a BroadcastChannel when Crunchyroll was connected already. Over the real
// session frames, Accounts wiring and Crunchyroll tracker, with only FKN's attachFrame, the built page
// scripts and the page's globals replaced. The chip is `targetOf` the tracker's answer with no choice
// stored, as tracking-compact.tsx draws it.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { expose } from 'osra'

import { crunchyrollTrackerResolvers } from '../../../src/sources/crunchyroll/tracker-resolvers'
import { targetOf } from '../../../src/tracking/compact'
import { CONNECTED_CHANNEL, CONNECTED_KEY } from '../../../src/tracking/connections'
import { SESSION_PORT_MESSAGE } from '../../../src/tracking/session-frames'
import { TRACKING_DOCUMENT } from '../../../src/worker/tracking-document'
import { SEASON_ID, SERIES_ID, SIGNED_OUT } from '../sources/crunchyroll/watched-fixtures'
import { providerServer, subscribe } from '../worker/yoga-client'
import { fakeBroadcastChannel } from './broadcast-channel'

const attach = vi.hoisted(() => vi.fn())
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: attach,
  isExtensionExposed: () => false,
}))
vi.mock('../../../src/sources/anilist/session-page.ts?page-script', () => ({ default: 'function () {}' }))
vi.mock('../../../src/sources/mal/session-page.ts?page-script', () => ({ default: 'function () {}' }))
vi.mock('../../../src/sources/crunchyroll/session-page.ts?page-script', () => ({ default: 'function () {}' }))

const URI = `ag:(anilist:154587,cr:${SERIES_ID},cr:${SERIES_ID}-${SEASON_ID})`
const NOTHING_WATCHED = { status: 200, body: null, held: { progress: 0, stars: null, watchlisted: false } }

const stored = new Map<string, string>()
// the window's own events, where another document's write to storage arrives
const page = new EventTarget()
// what the session page answers, signed in until a test says otherwise
const answers = { watched: NOTHING_WATCHED as unknown }
const ports: MessagePort[] = []

/** What `attach` opens: the sign-in window, the session page, or the frame a sign out clears cookies through. */
const attached = (options: { window?: unknown, blank?: unknown }) => {
  if (options.window) return { goto: async () => {}, closed: new Promise(() => {}), close: async () => {}, locator: () => ({ exists: async () => true }) }
  if (!options.blank) return { clearCookies: async () => {} }
  return {
    evaluate: async () => 'installed',
    goto: async () => {},
    on: () => {},
    url: () => (options.blank as { url: string }).url,
    postMessage: async (message: { type: string }, _origin: string, [port]: MessagePort[]) => {
      ports.push(port!)
      if (message.type === SESSION_PORT_MESSAGE) void expose({ watched: async () => answers.watched }, { transport: port! })
    },
  }
}

const live: { close: () => void }[] = []

const load = async () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } })
  vi.stubGlobal('location', { origin: 'https://anime.fkn.app' })
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('BroadcastChannel', fakeBroadcastChannel())
  const { sessionResolvers } = await import('../../../src/tracking/site-sessions')
  const { crunchyroll } = await import('../../../src/router/settings/wiring')
  // after the imports: FKN's lib reads the real global as it loads, and only the hidden iframes need this one
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {} }), body: { appendChild: () => {} }, readyState: 'complete' })

  // the worker's way to the session (src/worker/site-sessions.ts), without the osra hop
  const session = {
    call: (method: string, arg: unknown) => sessionResolvers.call('cr', method, arg),
    onChange: (listener: () => void) => { sessionResolvers.watch('cr', listener); return () => {} },
  }
  const tracker = providerServer('cr', crunchyrollTrackerResolvers({ wait: () => new Promise(() => {}) }), { session: () => session })
  const subscription = subscribe(tracker, TRACKING_DOCUMENT, { input: { uri: URI } })
  live.push(subscription)
  const chip = async () => targetOf((await subscription.next()).data.tracking.answers[0], undefined)
  return { crunchyroll, chip }
}

beforeEach(() => {
  vi.resetModules()
  attach.mockImplementation(async options => attached(options))
})

afterEach(() => {
  while (live.length) live.pop()!.close()
  while (ports.length) ports.pop()!.close()
  attach.mockReset()
  stored.clear()
  answers.watched = NOTHING_WATCHED
  vi.unstubAllGlobals()
})

test("a sign in from Accounts turns Crunchyroll's tracking on, so its chip reads signed in and checked, and its sign out turns it off", async () => {
  const { crunchyroll, chip } = await load()
  expect(await chip()).toEqual({ kind: 'login' })

  expect(await crunchyroll.signIn()).toBe('authed')
  expect(await chip()).toEqual({ kind: 'check', checked: true, sendable: true })

  await crunchyroll.signOut()
  expect(await chip()).toEqual({ kind: 'login' })
  expect(JSON.parse(stored.get(CONNECTED_KEY)!)).toEqual([])
})

test("a sign in from the player, in the embed's own document, turns Crunchyroll's tracking on in the app's page", async () => {
  const { chip } = await load()
  expect(await chip()).toEqual({ kind: 'login' })

  // what the player writes once its sign in ends (tests/unit/sources/crunchyroll/player.test.tsx), as this page hears it
  stored.set(CONNECTED_KEY, JSON.stringify(['cr']))
  page.dispatchEvent(Object.assign(new Event('storage'), { key: CONNECTED_KEY, oldValue: null, newValue: JSON.stringify(['cr']) }))

  expect(await chip()).toEqual({ kind: 'check', checked: true, sendable: true })
})

test("a sign in from the player with Crunchyroll's tracking already on and its session gone reads it again in the app's page", async () => {
  stored.set(CONNECTED_KEY, JSON.stringify(['cr']))
  answers.watched = { status: 400, body: SIGNED_OUT }
  const { chip } = await load()
  expect(await chip()).toEqual({ kind: 'login' })

  answers.watched = NOTHING_WATCHED
  // what the player posts once that sign in ends (tests/unit/sources/crunchyroll/player.test.tsx)
  new BroadcastChannel(CONNECTED_CHANNEL).postMessage('cr')

  expect(await chip()).toEqual({ kind: 'check', checked: true, sendable: true })
})
