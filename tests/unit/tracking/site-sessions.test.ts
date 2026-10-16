// The main thread's wiring of each site's session: which page its hidden frame holds, which page script
// runs there, where its sign-in window opens, and which jar both run on. Over the real session frames and
// sign-in window, with only FKN's attachFrame and exposure, the built page scripts and the page's globals
// replaced.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { expose } from 'osra'

import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL } from '../../../src/sources/crunchyroll/session'
import { SESSION_PORT_MESSAGE } from '../../../src/tracking/session-frames'

const CRUNCHYROLL_REASON = 'Read and update your Crunchyroll history, ratings and Watchlist with your crunchyroll.com session'
const SEASON = { seriesId: 'GT00399001', seasonId: 'GS00399002' }

const attach = vi.hoisted(() => vi.fn())
const extension = vi.hoisted(() => ({ exposed: false }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: attach,
  isExtensionExposed: () => extension.exposed,
}))
vi.mock('../../../src/sources/anilist/session-page.ts?page-script', () => ({ default: 'function () { return "the AniList page script" }' }))
vi.mock('../../../src/sources/mal/session-page.ts?page-script', () => ({ default: 'function () { return "the MyAnimeList page script" }' }))
vi.mock('../../../src/sources/crunchyroll/session-page.ts?page-script', () => ({ default: 'function () { return "the Crunchyroll page script" }' }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } })
vi.stubGlobal('location', { origin: 'https://anime.fkn.app' })

// imported afresh for each test, since a sign in connects its site for the rest of the module's life
const load = async () => {
  vi.resetModules()
  const module = await import('../../../src/tracking/site-sessions')
  // after the import: FKN's lib reads the real global as it loads, and only the hidden iframe's mount needs this one
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {} }),
    body: { appendChild: () => {} },
    readyState: 'complete',
  })
  return module
}

const ports: MessagePort[] = []
afterEach(() => {
  while (ports.length) ports.pop()!.close()
  attach.mockReset()
  extension.exposed = false
  stored.clear()
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } })
  vi.stubGlobal('location', { origin: 'https://anime.fkn.app' })
})

/**
 * A hidden frame whose page serves `api` on the port it is sent, and records what it was asked. Its
 * `url()` answers the blank page's url it was attached on, as FKN's does, and nothing otherwise.
 */
const hiddenFrame = (api: Record<string, (arg: never) => Promise<unknown>> = { whoami: async () => 'the page answered' }) => {
  const evaluate = vi.fn(async (_source: string, _arg: unknown) => 'installed')
  const goto = vi.fn(async (_url: string, _options?: unknown) => {})
  const postMessage = vi.fn(async (message: { type: string }, _origin: string, transfer: MessagePort[]) => {
    ports.push(transfer[0]!)
    if (message.type === SESSION_PORT_MESSAGE) void expose(api, { transport: transfer[0]! })
  })
  const url = () => (attach.mock.lastCall?.[0] as { blank?: { url: string } } | undefined)?.blank?.url ?? ''
  return { frame: { evaluate, goto, postMessage, on: () => {}, url }, evaluate, goto, postMessage }
}

/** A sign-in window the viewer closes at once. */
const closedWindow = () => {
  const goto = vi.fn(async (_url: string, _options?: unknown) => {})
  return { login: { goto, closed: Promise.resolve(), close: async () => {} }, goto }
}

describe("MyAnimeList's session on this device", () => {
  test('its sign in opens myanimelist.net\'s own sign-in form in an FKN window, asking for evaluation up front', async () => {
    const { trackerSignIns } = await load()
    const window = closedWindow()
    attach.mockResolvedValueOnce(window.login)

    expect(await trackerSignIns.mal!()).toBe('closed')

    // 1080 wide: myanimelist.net's desktop pages are laid out fixed at about 1060 pixels
    expect(attach).toHaveBeenCalledWith({
      window: { width: 1080 },
      domains: ['myanimelist.net'],
      cookies: 'persistent',
      permissions: [{ category: 'evaluation', reason: 'Read and update your MyAnimeList list with your own myanimelist.net session' }],
    })
    expect(window.goto).toHaveBeenCalledWith('https://myanimelist.net/login.php?from=%2Fabout.php', { waitUntil: 'commit' })
    expect(JSON.parse(stored.get('stub.sessions')!), 'connected here, so its answer is read').toEqual(['mal'])
  })

  test('on the cloud its hidden frame is an empty page at the hover fragment, running the MyAnimeList page script, addressed to myanimelist.net', async () => {
    const { sessionResolvers } = await load()
    expect(await sessionResolvers.call('mal', 'whoami', {}), 'nothing attached before a sign in').toEqual({ kind: 'not-connected' })
    expect(attach).not.toHaveBeenCalled()

    stored.set('stub.sessions', JSON.stringify(['mal']))
    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)

    expect(await sessionResolvers.call('mal', 'whoami', {})).toEqual({ kind: 'response', response: 'the page answered' })
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({
      domains: ['myanimelist.net'],
      cookies: 'persistent',
      blank: { url: 'https://myanimelist.net/includes/ajax.inc.php?t=64&id=1' },
      permissions: [{ category: 'evaluation', reason: 'Read and update your MyAnimeList list with your own myanimelist.net session' }],
    }))
    // a goto would add a history entry the browser's Back then spends on the hidden frame
    expect(page.goto).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the MyAnimeList page script" }', expect.objectContaining({ kind: 'serve', appOrigin: 'https://anime.fkn.app' }))
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_PORT_MESSAGE }), 'https://myanimelist.net', expect.any(Array))
  })

  test("the control: AniList's frame is its own, on anilist.co", async () => {
    const { sessionResolvers, trackerSignIns } = await load()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)

    await sessionResolvers.call('anilist', 'whoami', {})
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ domains: ['anilist.co'], blank: { url: 'https://anilist.co/terms' } }))
    expect(page.goto).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the AniList page script" }', expect.anything())
    expect(Object.keys(trackerSignIns).sort()).toEqual(['anilist', 'cr', 'mal'])
  })
})

describe("Crunchyroll's session on this device", () => {
  test("its Log in opens Crunchyroll's own sign in in an FKN window, asking for evaluation up front, connects it here and remembers a sign in", async () => {
    const { trackerSignIns } = await load()
    const goto = vi.fn(async (_url: string, _options?: unknown) => {})
    attach.mockResolvedValueOnce({ goto, closed: new Promise(() => {}), close: async () => {}, locator: () => ({ exists: async () => true }) })

    expect(await trackerSignIns.cr!()).toBe('authed')
    expect(attach).toHaveBeenCalledWith({
      window: {},
      domains: CRUNCHYROLL_DOMAINS,
      cookies: 'persistent',
      permissions: [{ category: 'evaluation', reason: CRUNCHYROLL_REASON }],
    })
    expect(goto).toHaveBeenCalledWith(CRUNCHYROLL_LOGIN_URL, { waitUntil: 'commit' })
    expect(JSON.parse(stored.get('stub.sessions')!)).toEqual(['cr'])
    expect(JSON.parse(stored.get('stub.site-status')!).crunchyroll.state).toBe('signed-in')
  })

  test('on the cloud its hidden frame is an empty page at www.crunchyroll.com, running the Crunchyroll page script, addressed to that origin', async () => {
    const { sessionResolvers } = await load()
    expect(await sessionResolvers.call('cr', 'watched', SEASON), 'nothing attached for a viewer stub never saw sign in').toEqual({ kind: 'not-connected' })
    expect(attach).not.toHaveBeenCalled()

    stored.set('stub.sessions', JSON.stringify(['cr']))
    const read = { status: 200, body: null, held: { progress: 1, stars: null, watchlisted: false } }
    const page = hiddenFrame({ watched: async () => read })
    attach.mockResolvedValueOnce(page.frame)

    expect(await sessionResolvers.call('cr', 'watched', SEASON)).toEqual({ kind: 'response', response: read })
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({
      domains: CRUNCHYROLL_DOMAINS,
      cookies: 'persistent',
      blank: { url: 'https://www.crunchyroll.com/' },
      permissions: [{ category: 'evaluation', reason: CRUNCHYROLL_REASON }],
    }))
    expect(page.goto).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the Crunchyroll page script" }', expect.objectContaining({ kind: 'serve' }))
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_PORT_MESSAGE }), 'https://www.crunchyroll.com', expect.any(Array))
  })

  test('a sign in from its player or the Accounts section connects nothing: only Log in on its chip does', async () => {
    const { sessionResolvers } = await load()
    stored.set('stub.site-status', JSON.stringify({ crunchyroll: { state: 'signed-in', checkedAt: 1 } }))

    expect(await sessionResolvers.call('cr', 'watched', SEASON)).toEqual({ kind: 'not-connected' })
    expect(attach).not.toHaveBeenCalled()
  })

  test("its sign out from the Accounts section stops the tracker reaching it at once, then removes its cookies from FKN's jar and remembers it", async () => {
    const { sessionResolvers, signOutOfCrunchyroll } = await load()
    stored.set('stub.sessions', JSON.stringify(['cr', 'anilist']))
    attach.mockResolvedValueOnce(hiddenFrame({ watched: async () => 'read' }).frame)
    expect(await sessionResolvers.call('cr', 'watched', SEASON)).toEqual({ kind: 'response', response: 'read' })

    const clearCookies = vi.fn(async () => {})
    attach.mockResolvedValueOnce({ clearCookies })
    await signOutOfCrunchyroll()

    expect(await sessionResolvers.call('cr', 'watched', SEASON)).toEqual({ kind: 'not-connected' })
    expect(JSON.parse(stored.get('stub.sessions')!), 'the other site stays connected').toEqual(['anilist'])
    expect(attach).toHaveBeenLastCalledWith({ iframe: expect.anything(), domains: CRUNCHYROLL_DOMAINS, cookies: 'persistent' })
    expect(clearCookies).toHaveBeenCalledTimes(1)
    expect(JSON.parse(stored.get('stub.site-status')!).crunchyroll.state).toBe('signed-out')
  })

  test('its sign out disconnects even when FKN cannot remove the cookies, and then remembers nothing', async () => {
    const { sessionResolvers, signOutOfCrunchyroll } = await load()
    stored.set('stub.sessions', JSON.stringify(['cr']))
    attach.mockRejectedValueOnce(new Error('FKN is not reachable'))

    await expect(signOutOfCrunchyroll()).rejects.toThrow('FKN is not reachable')
    expect(await sessionResolvers.call('cr', 'watched', SEASON)).toEqual({ kind: 'not-connected' })
    expect(stored.has('stub.site-status')).toBe(false)
  })
})

// @fkn/lib refuses a permission reason over MAX_REASON_LENGTH with a TypeError, and that refusal fails
// the attach itself: the sign in, and every read and save through the frame
test("every site's sign in and hidden frame give FKN a reason it takes", async () => {
  const { MAX_REASON_LENGTH } = await vi.importActual<typeof import('@fkn/lib')>('@fkn/lib')
  const { sessionResolvers, trackerSignIns } = await load()
  const sites = ['anilist', 'mal', 'cr'] as const
  for (const site of sites) {
    attach.mockResolvedValueOnce(closedWindow().login)
    await trackerSignIns[site]!()
  }
  stored.set('stub.sessions', JSON.stringify(sites))
  for (const site of sites) {
    attach.mockResolvedValueOnce(hiddenFrame().frame)
    await sessionResolvers.call(site, 'whoami', {})
  }

  const reasons = attach.mock.calls.flatMap(([options]) => (options as { permissions?: { reason: string }[] }).permissions ?? []).map(({ reason }) => reason)
  expect(reasons).toHaveLength(sites.length * 2)
  // counted as FKN counts it, in code points of the trimmed reason
  for (const reason of reasons) expect(Array.from(reason.trim()).length, reason).toBeLessThanOrEqual(MAX_REASON_LENGTH)
})

// Since @fkn/lib 0.9.42 the jar picks the backend, so the sign-in and the frame that reads its session
// each name it: the app's kept cloud jar on the cloud, the browser's own cookies on the extension.
describe('which jar a session runs on', () => {
  test("with the extension, the sign-in window and the hidden frame both ask for the browser's own cookies", async () => {
    extension.exposed = true
    const { sessionResolvers, trackerSignIns } = await load()
    const window = closedWindow()
    attach.mockResolvedValueOnce(window.login)
    await trackerSignIns.anilist!()
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({ window: {}, cookies: 'native' }))

    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)
    await sessionResolvers.call('anilist', 'whoami', {})
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({ domains: ['anilist.co'], cookies: 'native' }))
    // only the render proxy presents a page without loading it, so the extension's frame is sent there
    expect(attach.mock.lastCall?.[0]).not.toHaveProperty('blank')
    expect(page.goto).toHaveBeenCalledWith('https://anilist.co/terms', { waitUntil: 'commit' })
  })

  test('the control: with no extension, both run on the cloud jar', async () => {
    const { sessionResolvers, trackerSignIns } = await load()
    const window = closedWindow()
    attach.mockResolvedValueOnce(window.login)
    await trackerSignIns.anilist!()
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({ window: {}, cookies: 'persistent' }))

    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)
    await sessionResolvers.call('anilist', 'whoami', {})
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({ domains: ['anilist.co'], cookies: 'persistent', blank: { url: 'https://anilist.co/terms' } }))
    expect(page.goto).not.toHaveBeenCalled()
  })
})

// The way out of a site sign in, from the settings page (HOR-225).
describe('signing out of a site', () => {
  const recordFrames = () => {
    const iframes: { removed: boolean }[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const iframe = { style: {}, removed: false, setAttribute: () => {}, remove: () => { iframe.removed = true } }
        iframes.push(iframe)
        return iframe
      },
      body: { appendChild: () => {} },
      readyState: 'complete',
    })
    return iframes
  }

  test("on the cloud, disconnects the site here, drops its frame, and removes the site's cookies from FKN's jar", async () => {
    const { sessionResolvers, signOutOfSite, isSiteConnected } = await load()
    const iframes = recordFrames()
    stored.set('stub.sessions', JSON.stringify(['anilist', 'mal']))
    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)
    await sessionResolvers.call('anilist', 'whoami', {})
    expect(isSiteConnected('anilist')).toBe(true)

    const clearCookies = vi.fn(async () => {})
    attach.mockResolvedValueOnce({ clearCookies })
    await signOutOfSite('anilist', 'cloud')

    expect(isSiteConnected('anilist')).toBe(false)
    expect(isSiteConnected('mal'), 'the other site stays connected').toBe(true)
    expect(JSON.parse(stored.get('stub.sessions')!)).toEqual(['mal'])
    expect(attach).toHaveBeenLastCalledWith({ iframe: expect.anything(), domains: ['anilist.co'], cookies: 'persistent' })
    expect(clearCookies).toHaveBeenCalledTimes(1)
    expect(iframes.every(iframe => iframe.removed), "the session frame and the sign out's own frame are both gone").toBe(true)
    expect(await sessionResolvers.call('anilist', 'whoami', {})).toEqual({ kind: 'not-connected' })
  })

  test("with the extension, only disconnects: the session is the browser's own and FKN clears none of it", async () => {
    extension.exposed = true
    const { signOutOfSite, isSiteConnected } = await load()
    recordFrames()
    stored.set('stub.sessions', JSON.stringify(['mal']))

    await signOutOfSite('mal', 'extension')
    expect(isSiteConnected('mal')).toBe(false)
    expect(attach).not.toHaveBeenCalled()
  })

  test('tells whoever watches the site, so a page showing it reads it again', async () => {
    const { signOutOfSite, watchSite } = await load()
    recordFrames()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    const heard = vi.fn()
    watchSite('anilist', heard)
    attach.mockResolvedValueOnce({ clearCookies: async () => {} })

    await signOutOfSite('anilist', 'cloud')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  test('disconnects even when FKN cannot remove the cookies, and says the removal failed', async () => {
    const { signOutOfSite, isSiteConnected } = await load()
    recordFrames()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    attach.mockRejectedValueOnce(new Error('FKN is not reachable'))

    await expect(signOutOfSite('anilist', 'cloud')).rejects.toThrow('FKN is not reachable')
    expect(isSiteConnected('anilist')).toBe(false)
    expect(stored.has('stub.site-status'), 'the session may still be there, so nothing is remembered').toBe(false)
  })

  test('on the cloud, a sign out is remembered as signed out once the cookies are gone', async () => {
    const { signOutOfSite } = await load()
    recordFrames()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    attach.mockResolvedValueOnce({ clearCookies: async () => {} })

    await signOutOfSite('anilist', 'cloud')
    expect(JSON.parse(stored.get('stub.site-status')!).anilist.state).toBe('signed-out')
  })

  test("with the extension, a disconnect remembers nothing: the browser's session is still there", async () => {
    extension.exposed = true
    const { signOutOfSite } = await load()
    recordFrames()
    stored.set('stub.sessions', JSON.stringify(['mal']))

    await signOutOfSite('mal', 'extension')
    expect(stored.has('stub.site-status')).toBe(false)
  })
})

describe('signing in to a site', () => {
  test('a sign-in that ends signed in is remembered as signed in', async () => {
    const { trackerSignIns } = await load()
    const close = vi.fn(async () => {})
    attach.mockResolvedValueOnce({
      goto: async () => {},
      closed: new Promise(() => {}),
      close,
      locator: () => ({ exists: async () => false }),
      evaluate: async () => true,
    })

    expect(await trackerSignIns.mal!()).toBe('authed')
    expect(close).toHaveBeenCalledTimes(1)
    expect(JSON.parse(stored.get('stub.site-status')!).mal.state).toBe('signed-in')
  })

  test('a sign-in window the viewer closed remembers nothing', async () => {
    const { trackerSignIns } = await load()
    attach.mockResolvedValueOnce(closedWindow().login)

    expect(await trackerSignIns.anilist!()).toBe('closed')
    expect(stored.has('stub.site-status')).toBe(false)
  })
})
