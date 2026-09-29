// The main thread's wiring of each site's session: which page its hidden frame holds, which page script
// runs there, and where its sign-in window opens. Over the real session frames and sign-in window, with
// only FKN's attachFrame, the built page scripts and the page's globals replaced.
import { afterEach, describe, expect, test, vi } from 'vitest'

import { expose } from 'osra'

import { SESSION_PORT_MESSAGE } from '../../../src/tracking/session-frames'

const attach = vi.hoisted(() => vi.fn())
vi.mock('@fkn/lib', async importOriginal => ({ ...await importOriginal<typeof import('@fkn/lib')>(), attachFrame: attach }))
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
  })
  return module
}

const ports: MessagePort[] = []
afterEach(() => {
  while (ports.length) ports.pop()!.close()
  attach.mockReset()
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
  return { frame: { evaluate, goto, postMessage, addEventListener: () => {} }, evaluate, goto, postMessage }
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

    expect(attach).toHaveBeenCalledWith({
      window: {},
      domains: ['myanimelist.net'],
      permissions: [{ category: 'evaluation', reason: 'Read and update your MyAnimeList list with your own myanimelist.net session' }],
    })
    expect(window.goto).toHaveBeenCalledWith('https://myanimelist.net/login.php?from=%2Fabout.php', { waitUntil: 'documentstart' })
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
      permissions: [{ category: 'evaluation', reason: 'Read and update your MyAnimeList list with your own myanimelist.net session' }],
    }))
    expect(page.goto).toHaveBeenCalledWith('https://myanimelist.net/includes/ajax.inc.php?t=64&id=1', { waitUntil: 'documentstart' })
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the MyAnimeList page script" }', expect.objectContaining({ kind: 'serve', appOrigin: 'https://anime.fkn.app' }))
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_PORT_MESSAGE }), 'https://myanimelist.net', expect.any(Array))
  })

  test("the control: AniList's frame is its own, on anilist.co", async () => {
    const { sessionResolvers, trackerSignIns } = await load()
    stored.set('stub.sessions', JSON.stringify(['anilist']))
    const page = hiddenFrame()
    attach.mockResolvedValueOnce(page.frame)

    await sessionResolvers.call('anilist', 'whoami', {})
    expect(page.goto).toHaveBeenCalledWith('https://anilist.co/terms', { waitUntil: 'documentstart' })
    expect(page.evaluate).toHaveBeenCalledWith('function () { return "the AniList page script" }', expect.anything())
    expect(Object.keys(trackerSignIns).sort()).toEqual(['anilist', 'mal'])
  })
})
