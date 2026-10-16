import { describe, expect, test } from 'vite-plus/test'

import { MAX_RETRIES, MAX_RETRY_DELAY_MS, RETRYABLE_STATUSES, retryDelay, withBackoff } from '../../../src/worker/backoff'

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : 'body', { status, headers })

/** A fetch that replays a fixed script, and records how many times it was called. */
const scripted = (...script: (number | Error)[]) => {
  const calls: string[] = []
  const fetchImpl = async (input: RequestInfo | URL) => {
    const step = script[Math.min(calls.length, script.length - 1)]!
    calls.push(String(input))
    if (step instanceof Error) throw step
    return res(step)
  }
  return { fetchImpl, calls }
}

/** withBackoff with the sleeping removed, so a test costs no wall clock. */
const noWait = (fetchImpl: Parameters<typeof withBackoff>[0], now = 0) => {
  const waited: number[] = []
  const fetch = withBackoff(fetchImpl, { wait: async ms => { waited.push(ms) }, now: () => now })
  return { fetch, waited }
}

describe('RETRYABLE_STATUSES', () => {
  // The regression this whole module exists for: Jikan answers 504 "Jikan failed to connect to
  // MyAnimeList" while the host itself is up, and 504 used to be absent, so one flaky request
  // emptied stub's season listing.
  test('a gateway failure is asked again', () => {
    for (const status of [408, 429, 502, 503, 504, 522, 524]) {
      expect(RETRYABLE_STATUSES.has(status), `${status} must retry`).toBe(true)
    }
  })

  // Deliberate, not an oversight: a 500 is as often a deterministic upstream bug as a blip.
  test('a plain server error and every success are not', () => {
    for (const status of [200, 204, 301, 400, 401, 403, 404, 410, 500, 501]) {
      expect(RETRYABLE_STATUSES.has(status), `${status} must not retry`).toBe(false)
    }
  })
})

describe('withBackoff', () => {
  test('a 504 that recovers returns the good response', async () => {
    const { fetchImpl, calls } = scripted(504, 504, 200)
    const { fetch } = noWait(fetchImpl)
    expect((await fetch('https://api.jikan.moe/v4/seasons/now')).status).toBe(200)
    expect(calls).toHaveLength(3)
  })

  test('a 200 is returned without a second request', async () => {
    const { fetchImpl, calls } = scripted(200)
    const { fetch } = noWait(fetchImpl)
    expect((await fetch('https://x')).status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  // The test that proves the suite can fail: flip 404 into RETRYABLE_STATUSES and this breaks.
  test('a 404 is not retried, because asking again cannot change it', async () => {
    const { fetchImpl, calls } = scripted(404)
    const { fetch } = noWait(fetchImpl)
    expect((await fetch('https://x')).status).toBe(404)
    expect(calls).toHaveLength(1)
  })

  test('an upstream that never recovers gives up and hands back the failure', async () => {
    const { fetchImpl, calls } = scripted(503)
    const { fetch } = noWait(fetchImpl)
    expect((await fetch('https://x')).status).toBe(503)
    expect(calls).toHaveLength(MAX_RETRIES + 1)
  })

  // A dropped connection never arrives as a Response at all, so a status-only policy is blind to it.
  test('a rejected fetch is retried like a failing status', async () => {
    const { fetchImpl, calls } = scripted(new TypeError('network error'), new TypeError('network error'), 200)
    const { fetch } = noWait(fetchImpl)
    expect((await fetch('https://x')).status).toBe(200)
    expect(calls).toHaveLength(3)
  })

  test('a rejected fetch that never recovers rethrows the original error', async () => {
    const { fetchImpl, calls } = scripted(new TypeError('network error'))
    const { fetch } = noWait(fetchImpl)
    await expect(fetch('https://x')).rejects.toThrow('network error')
    expect(calls).toHaveLength(MAX_RETRIES + 1)
  })

  // A search the page has replaced stops its reads, and a refused one must not be sent again.
  test('a request its caller stopped is not asked again', async () => {
    const stop = new AbortController()
    const { fetchImpl, calls } = scripted(429)
    const fetch = withBackoff(fetchImpl, { wait: async () => { stop.abort() }, now: () => 0 })
    await expect(fetch('https://x', { signal: stop.signal })).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  test('a request stopped while it is out gives up at once, with no wait', async () => {
    const stop = new AbortController()
    const { fetchImpl, calls } = scripted(new DOMException('stopped', 'AbortError'))
    const { fetch, waited } = noWait(async input => {
      stop.abort()
      return fetchImpl(input)
    })
    await expect(fetch('https://x', { signal: stop.signal })).rejects.toThrow('stopped')
    expect(calls).toHaveLength(1)
    expect(waited).toEqual([])
  })

  test('backoff grows between attempts', async () => {
    const { fetchImpl } = scripted(503)
    const { fetch, waited } = noWait(fetchImpl)
    await fetch('https://x')
    expect(waited).toEqual([1_000, 2_000, 4_000])
  })
})

describe('retryDelay', () => {
  test('retry-after in seconds wins over the backoff', () => {
    expect(retryDelay(res(429, { 'retry-after': '5' }), 0)).toBe(5_000)
  })

  test('retry-after as an http date is read against the given now', () => {
    const now = Date.parse('2026-08-16T00:00:00Z')
    const delay = retryDelay(res(429, { 'retry-after': 'Sun, 16 Aug 2026 00:00:07 GMT' }), 0, now)
    expect(delay).toBe(7_000)
  })

  // A source asking for an hour must not hold a page load open for an hour.
  test('an absurd retry-after is capped', () => {
    expect(retryDelay(res(429, { 'retry-after': '3600' }), 0)).toBe(MAX_RETRY_DELAY_MS)
  })

  // A retry-after already in the past, or unparseable, must not produce a negative or NaN wait.
  test('a stale or unreadable retry-after falls back to the backoff', () => {
    const now = Date.parse('2026-08-16T00:00:00Z')
    expect(retryDelay(res(429, { 'retry-after': 'Sun, 16 Aug 2026 00:00:00 GMT' }), 2, now)).toBe(4_000)
    expect(retryDelay(res(429, { 'retry-after': 'not a date' }), 1, now)).toBe(2_000)
    expect(retryDelay(res(429), 3)).toBe(8_000)
  })
})

// The `spread` flag rides `init` from an extractor through this wrapper, an osra hop and the main
// thread to cloud.fetch, and every hop is typed loosely enough to drop it without a compile error.
// This pins the one hop that has logic in it: a retry must carry the same init as the first attempt,
// or a request that asked to spread would be retried on the tied node.
describe('init travels with the request', () => {
  test('every attempt carries the init it was called with, spread included', async () => {
    const inits: unknown[] = []
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => { inits.push(init); return res(inits.length < 3 ? 504 : 200) }
    const { fetch } = noWait(fetchImpl)
    await fetch('https://api.jikan.moe/v4/seasons/now', { spread: true, method: 'GET' })
    expect(inits).toHaveLength(3)
    for (const init of inits) expect(init).toEqual({ spread: true, method: 'GET' })
  })
})
