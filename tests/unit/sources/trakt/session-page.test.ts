// The page script's half, as it runs inside an app.trakt.tv page: what it asks app.trakt.tv and Trakt's
// API, against a fake fetch.
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vite-plus/test'

import { TRAKT_CLIENT_ID } from '../../../../src/sources/trakt/api'
import { createTraktPage, hasViewer, run, tokenOf } from '../../../../src/sources/trakt/session-page'

const SIGNED_OUT_DATA = readFileSync(`${__dirname}/__fixtures__/tracker/data-signed-out.json`, 'utf8')

/** The recorded answer with the token at its own index, as the app's layout would flatten it. */
const signedInData = (token: string, expiresAt: number | null = null) => {
  const body = JSON.parse(SIGNED_OUT_DATA)
  const data = body.nodes[0].data
  data.push(token)
  const tokenIdx = data.length - 1
  if (expiresAt !== null) {
    data.push(expiresAt)
    data[2] = { ...data[2], token: tokenIdx, expiresAt: data.length - 1 }
  } else {
    data[2] = { ...data[2], token: tokenIdx }
  }
  return JSON.stringify(body)
}

const memoryStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    map,
  }
}

type Call = { input: string, init?: RequestInit }

const respond = (body: string, { status = 200, headers = {} }: { status?: number, headers?: Record<string, string> } = {}) => () =>
  new Response(body, { status, headers })

const SETTINGS = JSON.stringify({ user: { username: 'viewer', email: 'viewer@example.com', ids: { slug: 'viewer', uuid: 'u' } }, permissions: {} })

/** A fetch that answers from a script and records what it was asked. */
const fakeFetch = (steps: (() => Response)[]) => {
  const calls: Call[] = []
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ input, init })
    return (steps.shift() ?? respond('nothing scripted', { status: 500 }))()
  }
  return { fetch, calls, inputs: () => calls.map(call => call.input) }
}

const counter = () => {
  let n = 0
  return () => `n${++n}`
}

const headersOf = (call: Call) => call.init?.headers as Record<string, string>

describe("the session's token", () => {
  test('is null in the recorded signed-out answer, and found by following its indices once signed in', () => {
    expect(tokenOf(JSON.parse(SIGNED_OUT_DATA))).toBeNull()
    expect(tokenOf(JSON.parse(signedInData('tok-1')))).toBe('tok-1')
  })

  test('is not read out of an answer that is not the root layout data', () => {
    expect(tokenOf(null)).toBeUndefined()
    expect(tokenOf({ type: 'data', nodes: [{ type: 'data', data: [{ theme: 1 }, 'system'] }] }), 'no oidcAuth').toBeUndefined()
    expect(tokenOf({ nodes: [{ data: [{ oidcAuth: 1 }, 'not an object'] }] })).toBeUndefined()
    expect(tokenOf({ nodes: [{ data: [{ oidcAuth: 1 }, { token: 'tok-literal' }] }] })).toBeNull()
  })
})

describe('a read of Trakt', () => {
  test("reads the token from /__data.json with the cookies, then asks apiz.trakt.tv with it, the client id and a nonce", async () => {
    const { fetch, calls, inputs } = fakeFetch([respond(signedInData('tok-1')), respond('[]', { headers: { 'x-pagination-page-count': '3' } })])
    const page = createTraktPage({ fetch, nonce: counter() })

    const answer = await page.get({ path: '/users/hidden/dropped?page=1&limit=100' })

    expect(inputs()).toEqual(['/__data.json?_=n1', 'https://apiz.trakt.tv/users/hidden/dropped?page=1&limit=100&_=n2'])
    expect(calls[0]!.init).toMatchObject({ credentials: 'include' })
    expect(headersOf(calls[1]!)).toMatchObject({ authorization: 'Bearer tok-1', 'trakt-api-key': TRAKT_CLIENT_ID, 'trakt-api-version': '2' })
    expect(calls[1]!.init?.credentials).toBeUndefined()
    expect(answer).toEqual({ kind: 'answer', status: 200, body: [], retryAfter: null, pageCount: 3 })
  })

  test('keeps the token for the next read', async () => {
    const { fetch, inputs } = fakeFetch([respond(signedInData('tok-1')), respond('{}'), respond('{}')])
    const page = createTraktPage({ fetch, nonce: counter() })

    await page.get({ path: '/sync/last_activities' })
    await page.get({ path: '/sync/ratings/seasons' })
    expect(inputs().filter(input => input.startsWith('/__data.json'))).toHaveLength(1)
  })

  test('asks nothing of Trakt while the session holds no token, and asks the cookie again next time', async () => {
    const { fetch, inputs } = fakeFetch([respond(SIGNED_OUT_DATA), respond(signedInData('tok-1')), respond('{}')])
    const page = createTraktPage({ fetch, nonce: counter() })

    expect(await page.get({ path: '/sync/last_activities' })).toEqual({ kind: 'signed-out' })
    expect((await page.get({ path: '/sync/last_activities' })).kind).toBe('answer')
    expect(inputs()).toEqual(['/__data.json?_=n1', '/__data.json?_=n2', 'https://apiz.trakt.tv/sync/last_activities?_=n3'])
  })

  test('after a 401 reads the cookie afresh once and asks again, as the site does, and hands a second 401 back', async () => {
    const { fetch, calls } = fakeFetch([
      respond(signedInData('old')), respond('', { status: 401 }),
      respond(signedInData('renewed')), respond('{"aired":1}'),
    ])
    const page = createTraktPage({ fetch, nonce: counter() })
    expect(await page.get({ path: '/sync/last_activities' })).toMatchObject({ status: 200, body: { aired: 1 } })
    expect(calls.map(call => headersOf(call)?.authorization ?? call.input.split('?')[0])).toEqual(['/__data.json', 'Bearer old', '/__data.json', 'Bearer renewed'])

    const stale = fakeFetch([respond(signedInData('old')), respond('', { status: 401 }), respond(signedInData('old')), respond('', { status: 401 }), respond('{}')])
    expect(await createTraktPage({ fetch: stale.fetch, nonce: counter() }).get({ path: '/sync/last_activities' })).toMatchObject({ status: 401 })
    expect(stale.calls, 'one retry, never more').toHaveLength(4)
  })

  test("a /__data.json that is not app.trakt.tv's session data is no session, and asks nothing of Trakt", async () => {
    const { fetch, inputs } = fakeFetch([respond('<html>Just a moment...</html>', { status: 403 })])
    expect(await createTraktPage({ fetch, nonce: counter() }).get({ path: '/sync/last_activities' })).toEqual({ kind: 'no-session', status: 403 })
    expect(inputs()).toHaveLength(1)
  })

  test('a /__data.json read that failed is not kept, so the next read asks it again', async () => {
    const { fetch, inputs } = fakeFetch([() => { throw new TypeError('Failed to fetch') }, respond(signedInData('tok-1')), respond('{}')])
    const page = createTraktPage({ fetch, nonce: counter() })

    await expect(page.get({ path: '/sync/last_activities' })).rejects.toThrow('Failed to fetch')
    expect((await page.get({ path: '/sync/last_activities' })).kind).toBe('answer')
    expect(inputs()).toEqual(['/__data.json?_=n1', '/__data.json?_=n2', 'https://apiz.trakt.tv/sync/last_activities?_=n3'])
  })

  test("hands a 429 back with its Retry-After", async () => {
    const { fetch } = fakeFetch([respond(signedInData('tok')), respond('', { status: 429, headers: { 'retry-after': '20' } })])
    expect(await createTraktPage({ fetch, nonce: counter() }).get({ path: '/sync/last_activities' })).toEqual({ kind: 'answer', status: 429, body: null, retryAfter: 20, pageCount: null })
  })

  test('refuses a path that would leave apiz.trakt.tv', async () => {
    const { fetch, calls } = fakeFetch([])
    await expect(createTraktPage({ fetch, nonce: counter() }).get({ path: '@elsewhere.example/x' })).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('a write to Trakt', () => {
  test('posts JSON with the bearer token once and never retries even on 401', async () => {
    const payload = { movies: [{ ids: { trakt: 500 } }] }
    const { fetch, calls } = fakeFetch([respond(signedInData('tok-1')), respond('', { status: 401 }), respond('{"added":{"movies":1}}', { status: 201 })])
    const page = createTraktPage({ fetch, nonce: counter() })

    const first = await page.post({ path: '/sync/watchlist', body: payload })
    expect(first).toMatchObject({ kind: 'answer', status: 401 })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.input).toBe('https://apiz.trakt.tv/sync/watchlist')
    expect(calls[1]!.init).toMatchObject({ method: 'POST', body: JSON.stringify(payload) })
    expect(headersOf(calls[1]!)).toMatchObject({ authorization: 'Bearer tok-1', 'trakt-api-key': TRAKT_CLIENT_ID })
  })

  test('asks nothing when signed out and rejects non-root paths', async () => {
    const signedOut = fakeFetch([respond(SIGNED_OUT_DATA)])
    expect(await createTraktPage({ fetch: signedOut.fetch, nonce: counter() }).post({ path: '/sync/watchlist', body: {} })).toEqual({ kind: 'signed-out' })
    expect(signedOut.calls).toHaveLength(1)

    const { fetch, calls } = fakeFetch([])
    await expect(createTraktPage({ fetch, nonce: counter() }).post({ path: 'https://evil.example/x', body: {} })).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

test("who the session is: /users/settings, of which only the username leaves the page", async () => {
  const { fetch, inputs } = fakeFetch([respond(signedInData('tok')), respond(SETTINGS)])
  const page = createTraktPage({ fetch, nonce: counter() })

  const answer = await page.whoami({})

  expect(inputs()[1]).toBe('https://apiz.trakt.tv/users/settings?_=n2')
  expect(answer).toEqual({ kind: 'answer', status: 200, body: 'viewer', retryAfter: null, pageCount: null })
  expect(JSON.stringify(answer)).not.toContain('example.com')
})

test('the viewer check asks Trakt, so a token it no longer takes is not a viewer', async () => {
  const known = fakeFetch([respond(signedInData('tok')), respond(SETTINGS)])
  expect(await hasViewer(createTraktPage({ fetch: known.fetch, nonce: counter() }))).toBe(true)

  const expired = fakeFetch([respond(signedInData('tok')), respond('', { status: 401 }), respond(signedInData('tok')), respond('', { status: 401 })])
  expect(await hasViewer(createTraktPage({ fetch: expired.fetch, nonce: counter() }))).toBe(false)

  const signedOut = fakeFetch([respond(SIGNED_OUT_DATA)])
  expect(await hasViewer(createTraktPage({ fetch: signedOut.fetch, nonce: counter() }))).toBe(false)
})

describe('Cloudflare challenge 403 and session cache fallback', () => {
  const challengeHtml = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript</body></html>'
  const NOW = 1_800_000_000_000

  test('returns challenge on Cloudflare 403 or 503 header or HTML challenge when no fallback exists, while plain 403 stays no-session', async () => {
    const byHeader = fakeFetch([respond('blocked', { status: 403, headers: { 'cf-mitigated': 'challenge' } })])
    expect(await createTraktPage({ fetch: byHeader.fetch, nonce: counter() }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'challenge', status: 403 })

    const byHtml = fakeFetch([respond(challengeHtml, { status: 403 })])
    expect(await createTraktPage({ fetch: byHtml.fetch, nonce: counter() }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'challenge', status: 403 })

    const by503 = fakeFetch([respond(challengeHtml, { status: 503 })])
    expect(await createTraktPage({ fetch: by503.fetch, nonce: counter() }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'challenge', status: 503 })

    const plain403 = fakeFetch([respond('Forbidden', { status: 403 })])
    expect(await createTraktPage({ fetch: plain403.fetch, nonce: counter() }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'no-session', status: 403 })
  })

  test('persists token from 200 /__data.json (normalizing Unix seconds or ms) when persist is true and falls back on challenge', async () => {
    const storage = memoryStorage()
    const first = fakeFetch([respond(signedInData('tok-cached', Math.floor((NOW + 600_000) / 1000))), respond('{}')])
    const page1 = createTraktPage({ fetch: first.fetch, nonce: counter(), storage, now: () => NOW, persist: true })
    expect(await page1.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200 })
    expect(JSON.parse(storage.getItem('stub.trakt-session')!)).toMatchObject({ token: 'tok-cached', expiresAt: NOW + 600_000 })

    const challenged = fakeFetch([respond(challengeHtml, { status: 403 }), respond('{"ok":true}')])
    const page2 = createTraktPage({ fetch: challenged.fetch, nonce: counter(), storage, now: () => NOW + 1_000, persist: true })
    expect(await page2.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200, body: { ok: true } })
    expect(headersOf(challenged.calls[1]!)).toMatchObject({ authorization: 'Bearer tok-cached' })
  })

  test('falls back to Trakt OIDC user storage when unexpired and ignores expired entries', async () => {
    const expiredStorage = memoryStorage({
      [`oidc.user:https://auth.trakt.tv:${TRAKT_CLIENT_ID}`]: JSON.stringify({ access_token: 'tok-expired', expires_at: Math.floor((NOW - 10_000) / 1000) }),
    })
    const f1 = fakeFetch([respond(challengeHtml, { status: 403 })])
    expect(await createTraktPage({ fetch: f1.fetch, nonce: counter(), storage: expiredStorage, now: () => NOW, persist: true }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'challenge', status: 403 })

    const oidcStorage = memoryStorage({
      [`oidc.user:https://auth.trakt.tv:${TRAKT_CLIENT_ID}`]: JSON.stringify({ access_token: 'tok-oidc', expires_at: Math.floor((NOW + 60_000) / 1000) }),
    })
    const f2 = fakeFetch([respond(challengeHtml, { status: 403 }), respond('[]')])
    expect(await createTraktPage({ fetch: f2.fetch, nonce: counter(), storage: oidcStorage, now: () => NOW, persist: true }).get({ path: '/sync/last_activities' }))
      .toMatchObject({ kind: 'answer', status: 200, body: [] })
    expect(headersOf(f2.calls[1]!)).toMatchObject({ authorization: 'Bearer tok-oidc' })
  })

  test('drops cached token on 401 and returns challenge instead of looping on the rejected fallback token', async () => {
    const storage = memoryStorage({
      'stub.trakt-session': JSON.stringify({ token: 'tok-stale', expiresAt: NOW + 600_000, savedAt: NOW }),
    })
    const { fetch, calls } = fakeFetch([
      respond(challengeHtml, { status: 403 }),
      respond('', { status: 401 }),
      respond(challengeHtml, { status: 403 }),
    ])
    const page = createTraktPage({ fetch, nonce: counter(), storage, now: () => NOW, persist: true })
    expect(await page.get({ path: '/sync/last_activities' })).toEqual({ kind: 'challenge', status: 403 })
    expect(storage.getItem('stub.trakt-session')).toBeNull()
    expect(calls).toHaveLength(3)
  })

  test('clearSession clears held token and cached session while keeping valid OIDC fallback available on challenge', async () => {
    const storage = memoryStorage({
      'stub.trakt-session': JSON.stringify({ token: 'tok-old', expiresAt: NOW + 600_000, savedAt: NOW }),
      [`oidc.user:https://auth.trakt.tv:${TRAKT_CLIENT_ID}`]: JSON.stringify({ access_token: 'tok-oidc', expires_at: Math.floor((NOW + 600_000) / 1000) }),
    })
    const f1 = fakeFetch([
      respond(signedInData('tok-cached', NOW + 600_000)),
      respond('{"initial":true}'),
      respond(challengeHtml, { status: 403 }),
      respond('{"fallback":true}'),
    ])
    const page = createTraktPage({ fetch: f1.fetch, nonce: counter(), storage, now: () => NOW, persist: true })
    expect(await page.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200, body: { initial: true } })
    expect(JSON.parse(storage.getItem('stub.trakt-session')!)).toMatchObject({ token: 'tok-cached' })

    await page.clearSession()
    expect(storage.getItem('stub.trakt-session')).toBeNull()

    expect(await page.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200, body: { fallback: true } })
    expect(headersOf(f1.calls[3]!)).toMatchObject({ authorization: 'Bearer tok-oidc' })

    const storage2 = memoryStorage({
      'stub.trakt-session': JSON.stringify({ token: 'tok-old', expiresAt: NOW + 600_000, savedAt: NOW }),
    })
    const f2 = fakeFetch([respond(SIGNED_OUT_DATA)])
    expect(await createTraktPage({ fetch: f2.fetch, nonce: counter(), storage: storage2, now: () => NOW, persist: true }).get({ path: '/sync/last_activities' }))
      .toEqual({ kind: 'signed-out' })
    expect(storage2.getItem('stub.trakt-session')).toBeNull()
  })

  test('prunes expired or malformed stub.trakt-session entries immediately instead of leaving stale tokens in storage', async () => {
    const expired = memoryStorage({
      'stub.trakt-session': JSON.stringify({ token: 'tok-expired', expiresAt: NOW - 1_000, savedAt: NOW - 10_000 }),
    })
    createTraktPage({ fetch: fakeFetch([]).fetch, nonce: counter(), storage: expired, now: () => NOW, persist: true })
    expect(expired.getItem('stub.trakt-session')).toBeNull()

    const malformed = memoryStorage({ 'stub.trakt-session': '{bad-json' })
    const challenge = fakeFetch([respond(challengeHtml, { status: 403 })])
    const page = createTraktPage({ fetch: challenge.fetch, nonce: counter(), storage: malformed, now: () => NOW, persist: true })
    expect(await page.get({ path: '/sync/last_activities' })).toEqual({ kind: 'challenge', status: 403 })
    expect(malformed.getItem('stub.trakt-session')).toBeNull()
  })

  test('viewer mode uses null storage and refuses cached tokens on challenge', async () => {
    const storage = memoryStorage({
      'stub.trakt-session': JSON.stringify({ token: 'tok-stale', expiresAt: NOW + 600_000, savedAt: NOW, gen: 'g1' }),
    })
    const { fetch, calls } = fakeFetch([respond(challengeHtml, { status: 403 })])
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('localStorage', storage)
    try {
      expect(await run({ kind: 'viewer' })).toBe(false)
      expect(calls).toHaveLength(1)
      expect(storage.getItem('stub.trakt-session')).not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('stamps sessionGen on persisted tokens and invalidates cached entries on mismatch', async () => {
    const storage = memoryStorage()
    const first = fakeFetch([respond(signedInData('tok-g1', Math.floor((NOW + 600_000) / 1000))), respond('{}')])
    const page1 = createTraktPage({ fetch: first.fetch, nonce: counter(), storage, now: () => NOW, persist: true, sessionGen: 'gen-1' })
    expect(await page1.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200 })
    expect(JSON.parse(storage.getItem('stub.trakt-session')!)).toMatchObject({ token: 'tok-g1', gen: 'gen-1' })

    const sameGenFetch = fakeFetch([respond(challengeHtml, { status: 403 }), respond('{"same":true}')])
    const sameGenPage = createTraktPage({ fetch: sameGenFetch.fetch, nonce: counter(), storage, now: () => NOW + 1_000, persist: true, sessionGen: 'gen-1' })
    expect(await sameGenPage.get({ path: '/sync/last_activities' })).toMatchObject({ kind: 'answer', status: 200, body: { same: true } })

    const nextGenFetch = fakeFetch([respond(challengeHtml, { status: 403 })])
    const nextGenPage = createTraktPage({ fetch: nextGenFetch.fetch, nonce: counter(), storage, now: () => NOW + 2_000, persist: true, sessionGen: 'gen-2' })
    expect(await nextGenPage.get({ path: '/sync/last_activities' })).toEqual({ kind: 'challenge', status: 403 })
    expect(storage.getItem('stub.trakt-session')).toBeNull()
    expect(nextGenFetch.calls).toHaveLength(1)
  })
})
