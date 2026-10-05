// The main thread's wiring of each site's session: which page its hidden frame holds, which page script
// runs there, where its sign-in window opens, and which jar both run on. Over the real session frames and
// sign-in window, with only FKN's attachFrame and exposure, the built page scripts and the page's globals
// replaced.
import { afterEach, describe, expect, test, vi } from 'vitest'

import { expose } from 'osra'

import { SESSION_PORT_MESSAGE } from '../../../src/tracking/session-frames'

const attach = vi.hoisted(() => vi.fn())
const extension = vi.hoisted(() => ({ exposed: false }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: attach,
  isExtensionExposed: () => extension.exposed,
}))
vi.mock('../../../src/sources/anilist/session-page.ts?page-script', () => ({ default: 'function () { return "the AniList page script" }' }))
vi.mock('../../../src/sources/mal/session-page.ts?page-script', () => ({ default: 'function () { return "the MyAnimeList page script" }' }))

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

/** A hidden frame whose page serves `whoami` on the port it is sent, and records what it was asked. */
const hiddenFrame = () => {
  const evaluate = vi.fn(async (_source: string, _arg: unknown) => 'installed')
  const goto = vi.fn(async (_url: string, _options?: unknown) => {})
  const postMessage = vi.fn(async (message: { type: string }, _origin: string, transfer: MessagePort[]) => {
    ports.push(transfer[0]!)
    if (message.type === SESSION_PORT_MESSAGE) void expose({ whoami: async () => 'the page answered' }, { transport: transfer[0]! })
  })
  return { frame: { evaluate, goto, postMessage, on: () => {} }, evaluate, goto, postMessage }
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

  test('its hidden frame holds the hover fragment and runs the MyAnimeList page script, addressed to myanimelist.net', async () => {
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
      permissions: [{ category: 'evaluation', reason: 'Read and update your MyAnimeList list with your own myanimelist.net session' }],
    }))
    expect(page.goto).toHaveBeenCalledWith('https://myanimelist.net/includes/ajax.inc.php?t=64&id=1', { waitUntil: 'commit' })
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the MyAnimeList page script" }', expect.objectContaining({ kind: 'serve', appOrigin: 'https://anime.fkn.app' }))
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_PORT_MESSAGE }), 'https://myanimelist.net', expect.any(Array))
  })

  test("the control: AniList's frame is its own, on anilist.co", async () => {
    const { sessionResolvers, trackerSignIns } = await load()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)

    await sessionResolvers.call('anilist', 'whoami', {})
    expect(page.goto).toHaveBeenCalledWith('https://anilist.co/terms', { waitUntil: 'commit' })
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the AniList page script" }', expect.anything())
    expect(Object.keys(trackerSignIns).sort()).toEqual(['anilist', 'mal'])
  })
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
    expect(attach).toHaveBeenLastCalledWith(expect.objectContaining({ domains: ['anilist.co'], cookies: 'persistent' }))
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
  })
})
