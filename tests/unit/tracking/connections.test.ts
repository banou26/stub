// A site is reached with the viewer's session only once they connected it on this device, and a sign in
// is what connects it.
import { describe, expect, test, vi } from 'vitest'

import type { SessionFrames } from '../../../src/tracking/session-frames'
import type { PageApi } from '../../../src/tracking/site-session'

import { CONNECTED_KEY, createConnections, disconnectAndReload, signInAndConnect, siteSessionResolvers } from '../../../src/tracking/connections'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

const RESPONSE = { status: 200, body: { data: { Viewer: { id: 7 } } }, rateLimit: { limit: null, remaining: null, reset: null, retryAfter: null } }

/** Frames holding one page per site, each serving the api `pages` gives it. */
const fakeFrames = (pages: Record<string, PageApi> = { anilist: { graphql: async () => RESPONSE } }) => {
  const use = vi.fn(async <T>(site: string, call: (api: PageApi) => Promise<T>, _options?: unknown) => call(pages[site]!))
  const reload = vi.fn()
  const watch = vi.fn(() => () => {})
  return { frames: { use, reload, watch } as unknown as SessionFrames<PageApi>, use, reload }
}

describe('the sessions the worker reaches', () => {
  test('answer not-connected, and attach nothing, until the viewer connected the site here', async () => {
    const { frames, use } = fakeFrames()
    const connections = createConnections(() => memoryStorage())
    const resolvers = siteSessionResolvers(frames, connections)

    expect(await resolvers.call('anilist', 'graphql', { query: 'query { Viewer { id } }' })).toEqual({ kind: 'not-connected' })
    expect(use).not.toHaveBeenCalled()

    connections.connect('anilist')
    expect(await resolvers.call('anilist', 'graphql', { query: 'query { Viewer { id } }' })).toEqual({ kind: 'response', response: RESPONSE })
    expect(use).toHaveBeenCalledTimes(1)
  })

  test("a call runs the named method on the named site's page, and on no other site's", async () => {
    const whoami = vi.fn(async (arg: object) => ({ answered: 'mal', arg }))
    const graphql = vi.fn(async () => RESPONSE)
    const { frames, use } = fakeFrames({ anilist: { graphql }, mal: { whoami } })
    const connections = createConnections(() => memoryStorage())
    connections.connect('mal')
    connections.connect('anilist')
    const resolvers = siteSessionResolvers(frames, connections)

    expect(await resolvers.call('mal', 'whoami', { a: 1 }, { once: true })).toEqual({ kind: 'response', response: { answered: 'mal', arg: { a: 1 } } })
    expect(use).toHaveBeenCalledWith('mal', expect.any(Function), { once: true })
    expect(graphql).not.toHaveBeenCalled()

    await expect(resolvers.call('anilist', 'whoami', {}), "a method the site's page does not serve").rejects.toThrow('The anilist page serves no whoami')
    expect(whoami).toHaveBeenCalledTimes(1)
  })

  test('a connection is kept for the next page, and a site stays apart from another', () => {
    const storage = memoryStorage()
    createConnections(() => storage).connect('anilist')
    expect(JSON.parse(storage.values.get(CONNECTED_KEY)!)).toEqual(['anilist'])

    const nextPage = createConnections(() => storage)
    expect(nextPage.isConnected('anilist')).toBe(true)
    expect(nextPage.isConnected('mal')).toBe(false)
  })

  test('a storage that refuses still connects for this page', () => {
    const connections = createConnections(() => { throw new Error('SecurityError: storage is blocked') })
    connections.connect('anilist')
    expect(connections.isConnected('anilist')).toBe(true)
  })
})

describe('a sign in', () => {
  test('connects the site and loads its page afresh once the window says signed in', async () => {
    const { frames, reload } = fakeFrames()
    const connections = createConnections(() => memoryStorage())

    expect(await signInAndConnect('anilist', async () => 'authed', { frames, connections })).toBe('authed')
    expect(connections.isConnected('anilist')).toBe(true)
    expect(reload).toHaveBeenCalledWith('anilist')
  })

  // a read can still be pending when the viewer closes a window they already signed in through; the
  // extension opens no window at all and its frame runs on the browser's own session
  test.each(['closed', 'unsupported'] as const)('connects on %s too, and the answer read next says which', async outcome => {
    const { frames, reload } = fakeFrames()
    const connections = createConnections(() => memoryStorage())

    await signInAndConnect('anilist', async () => outcome, { frames, connections })
    expect(connections.isConnected('anilist')).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('a window the browser refused connects nothing', async () => {
    const { frames, reload } = fakeFrames()
    const connections = createConnections(() => memoryStorage())

    expect(await signInAndConnect('anilist', async () => 'blocked', { frames, connections })).toBe('blocked')
    expect(connections.isConnected('anilist')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  test('opens the window before anything is awaited, inside the click', () => {
    const { frames } = fakeFrames()
    const signIn = vi.fn(() => new Promise<'authed'>(() => {}))
    void signInAndConnect('anilist', signIn, { frames, connections: createConnections(() => memoryStorage()) })
    expect(signIn).toHaveBeenCalledTimes(1)
  })
})

// The way back from a sign in (HOR-225): stub stops reaching the site with the viewer's session on this
// device, and every tracker answer is read again.
describe('a disconnect', () => {
  test('forgets the site on this device and keeps every other one', () => {
    const storage = memoryStorage({ [CONNECTED_KEY]: JSON.stringify(['anilist', 'mal']) })
    const connections = createConnections(() => storage)
    connections.disconnect('anilist')

    expect(connections.isConnected('anilist')).toBe(false)
    expect(connections.isConnected('mal')).toBe(true)
    expect(JSON.parse(storage.values.get(CONNECTED_KEY)!)).toEqual(['mal'])
    expect(createConnections(() => storage).isConnected('anilist'), 'the next page reads it gone too').toBe(false)
  })

  test('undoes a connection made on this page, and a sign in after it connects again', () => {
    const storage = memoryStorage()
    const connections = createConnections(() => storage)
    connections.connect('anilist')
    connections.disconnect('anilist')
    expect(connections.isConnected('anilist')).toBe(false)

    connections.connect('anilist')
    expect(connections.isConnected('anilist')).toBe(true)
    expect(JSON.parse(storage.values.get(CONNECTED_KEY)!)).toEqual(['anilist'])
  })

  test('a storage that refuses the write still disconnects for this page', () => {
    const values = new Map([[CONNECTED_KEY, JSON.stringify(['anilist'])]])
    const connections = createConnections(() => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => { throw new Error('QuotaExceededError') },
    }))
    connections.disconnect('anilist')
    expect(connections.isConnected('anilist')).toBe(false)
  })

  test('drops the frame, so the worker hears it and asks again, and attaches nothing after', async () => {
    const { frames, use, reload } = fakeFrames()
    const storage = memoryStorage({ [CONNECTED_KEY]: JSON.stringify(['anilist']) })
    const connections = createConnections(() => storage)
    const resolvers = siteSessionResolvers(frames, connections)

    disconnectAndReload('anilist', { frames, connections })
    expect(reload).toHaveBeenCalledWith('anilist')
    expect(await resolvers.call('anilist', 'graphql', { query: 'query { Viewer { id } }' })).toEqual({ kind: 'not-connected' })
    expect(use).not.toHaveBeenCalled()
  })
})
