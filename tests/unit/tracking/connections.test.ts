// A site is reached with the viewer's session only once they connected it on this device, and a sign in
// is what connects it.
import { describe, expect, test, vi } from 'vitest'

import type { SessionPageApi } from '../../../src/sources/anilist/session-page'
import type { SessionFrames } from '../../../src/tracking/session-frames'

import { CONNECTED_KEY, createConnections, signInAndConnect, siteSessionResolvers } from '../../../src/tracking/connections'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

const RESPONSE = { status: 200, body: { data: { Viewer: { id: 7 } } }, rateLimit: { limit: null, remaining: null, reset: null, retryAfter: null } }

const fakeFrames = () => {
  const use = vi.fn(async <T>(_site: string, call: (api: SessionPageApi) => Promise<T>) => call({ graphql: async () => RESPONSE }))
  const reload = vi.fn()
  const watch = vi.fn(() => () => {})
  return { frames: { use, reload, watch } as unknown as SessionFrames<SessionPageApi>, use, reload }
}

describe('the sessions the worker reaches', () => {
  test('answer not-connected, and attach nothing, until the viewer connected the site here', async () => {
    const { frames, use } = fakeFrames()
    const connections = createConnections(() => memoryStorage())
    const resolvers = siteSessionResolvers(frames, connections)

    expect(await resolvers.graphql('anilist', { query: 'query { Viewer { id } }' })).toEqual({ kind: 'not-connected' })
    expect(use).not.toHaveBeenCalled()

    connections.connect('anilist')
    expect(await resolvers.graphql('anilist', { query: 'query { Viewer { id } }' })).toEqual({ kind: 'response', response: RESPONSE })
    expect(use).toHaveBeenCalledTimes(1)
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
