// The page script's half, as it runs inside anilist.co's page: its GraphQL against a fake fetch and CSRF
// token. The port it serves on is tracking/page-install.ts's, pinned in tests/unit/tracking.
import { describe, expect, test } from 'vitest'

import { createPageApi, hasViewer } from '../../../../src/sources/anilist/session-page'

const TOKEN = 'T0kenRenderedForThisSession0000000000000'
const FRESH = 'FreshT0kenAfterTheSiteRotatedIt000000000'

const GATE_403 = { errors: [{ message: 'Forbidden. (Use graphql subdomain)', status: 403 }], data: { Viewer: null } }

type Call = { input: string, init?: RequestInit }

/** A fetch that answers from a script and records what it was asked. */
const fakeFetch = (steps: (() => Response)[]) => {
  const calls: Call[] = []
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ input, init })
    return (steps.shift() ?? (() => new Response('{}', { status: 500 })))()
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const homePage = (token: string) => () =>
  new Response(`<head><script>window.al_token = "${token}";</script></head>`, { status: 200 })

const counter = () => {
  let n = 0
  return () => `n${++n}`
}

const bodyOf = (call: Call) => JSON.parse(String(call.init?.body)) as { query: string, variables: unknown }

describe("the page's graphql", () => {
  test("asks the site's own endpoint the way the site's client does, with the page's token and cookies", async () => {
    const { fetch, calls } = fakeFetch([json({ data: { Viewer: { id: 7 } } }, 200, { 'x-ratelimit-remaining': '29', 'x-ratelimit-limit': '30' })])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    const answer = await api.graphql({ query: 'query { Viewer { id } }', variables: { a: 1 } })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.input).toBe('/graphql')
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': TOKEN, schema: 'default', 'content-type': 'application/json', accept: 'application/json' },
    })
    expect(bodyOf(calls[0]!)).toEqual({ query: '# stub n1\nquery { Viewer { id } }', variables: { a: 1 } })
    expect(answer).toEqual({
      status: 200,
      body: { data: { Viewer: { id: 7 } } },
      rateLimit: { limit: 30, remaining: 29, reset: null, retryAfter: null },
    })
  })

  // the FKN relay caches a POST for an hour keyed on its body, so two identical reads would be one
  test('carries a fresh nonce in every request, so no cache keyed on the body answers a read with an older one', async () => {
    const { fetch, calls } = fakeFetch([json({ data: {} }), json({ data: {} })])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    await api.graphql({ query: 'query { Viewer { id } }' })
    await api.graphql({ query: 'query { Viewer { id } }' })

    const [first, second] = calls.map(call => String(call.init?.body))
    expect(first).not.toBe(second)
    expect(bodyOf(calls[1]!).query).toBe('# stub n2\nquery { Viewer { id } }')
  })

  test('with no token in the page, reads the one the home page renders for this session, once', async () => {
    const { fetch, calls } = fakeFetch([homePage(TOKEN), json({ data: {} }), json({ data: {} })])
    const api = createPageApi({ fetch, pageToken: () => undefined, nonce: counter() })

    await api.graphql({ query: 'query { a }' })
    await api.graphql({ query: 'query { b }' })

    expect(calls.map(call => call.input)).toEqual(['/?_=n1', '/graphql', '/graphql'])
    expect(calls[0]!.init).toMatchObject({ credentials: 'include' })
    expect(calls.slice(1).map(call => (call.init?.headers as Record<string, string>)['x-csrf-token'])).toEqual([TOKEN, TOKEN])
  })

  test('a home page that rendered no token is asked again by the next call, not kept', async () => {
    const unavailable = () => new Response('<html><body>503 Service Temporarily Unavailable</body></html>', { status: 503 })
    const { fetch, calls } = fakeFetch([unavailable, homePage(TOKEN), json({ data: { a: 1 } }), json({ data: { b: 1 } })])
    const api = createPageApi({ fetch, pageToken: () => undefined, nonce: counter() })

    await expect(api.graphql({ query: 'query { a }' })).rejects.toThrow('served no CSRF token')
    expect((await api.graphql({ query: 'query { a }' })).body).toEqual({ data: { a: 1 } })
    expect((await api.graphql({ query: 'query { b }' })).body).toEqual({ data: { b: 1 } })
    expect(calls.map(call => call.input)).toEqual(['/?_=n1', '/?_=n2', '/graphql', '/graphql'])
  })

  test("answers a 403 from the CSRF gate once, with the token read afresh, as the site's client does", async () => {
    const { fetch, calls } = fakeFetch([json(GATE_403, 403), homePage(FRESH), json({ data: { Viewer: { id: 7 } } })])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    const answer = await api.graphql({ query: 'query { Viewer { id } }' })

    expect(answer.status).toBe(200)
    expect(calls.map(call => call.input)).toEqual(['/graphql', '/?_=n2', '/graphql'])
    expect((calls[2]!.init?.headers as Record<string, string>)['x-csrf-token']).toBe(FRESH)
  })

  test('hands a second refusal back rather than asking forever', async () => {
    const { fetch, calls } = fakeFetch([json(GATE_403, 403), homePage(FRESH), json(GATE_403, 403)])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    expect((await api.graphql({ query: 'query { a }' })).status).toBe(403)
    expect(calls).toHaveLength(3)
  })

  test('reads the rate headers AniList sends', async () => {
    const { fetch } = fakeFetch([json({ errors: [{ message: 'Too Many Requests.', status: 429 }] }, 429, {
      'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790467711', 'retry-after': '60',
    })])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    expect((await api.graphql({ query: 'query { a }' })).rateLimit).toEqual({ limit: 30, remaining: 0, reset: 1790467711, retryAfter: 60 })
  })

  test('says whether the session has a viewer, from the Viewer the site answers', async () => {
    // the 401 anilist.co/graphql answered a signed-out Viewer query with, recorded 2026-09-27
    const signedOut = { errors: [{ message: 'Unauthorized.', status: 401, locations: [{ line: 2, column: 25 }] }], data: { Viewer: null } }
    const { fetch } = fakeFetch([json(signedOut, 401), json({ data: { Viewer: { id: 7 } } })])
    const api = createPageApi({ fetch, pageToken: () => TOKEN, nonce: counter() })

    expect(await hasViewer(api)).toBe(false)
    expect(await hasViewer(api)).toBe(true)
  })
})
