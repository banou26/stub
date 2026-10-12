// Retry policy for every upstream request an extractor makes, split out of fetch.ts with NO imports
// so it can be tested: fetch.ts calls osra's expose() at module scope, which needs a transport that
// does not exist outside the worker. Same reason src/sources/season.ts is its own module.

// Every status here means "ask again", never "this request was wrong". 502/504 and Cloudflare's
// 522/524 are a gateway failing to reach the thing behind it, which is the shape almost every
// upstream outage takes: api.jikan.moe answers 504 "Jikan failed to connect to MyAnimeList" while
// api.jikan.moe/v4/anime/1 stays 200, so the host is up and only the MAL-fetching endpoints flap.
// Leaving 504 out was the whole reason one flaky season request emptied stub's homepage.
//
// 500 is deliberately absent: it is as often a deterministic upstream bug as a blip, and retrying
// one costs three requests to reach the same answer.
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504, 522, 524])

// 4 attempts total. The homepage's season list is all-or-nothing on its first page, so at the
// roughly even odds measured against Jikan a third retry is what takes it from 88% to 94%.
export const MAX_RETRIES = 3
export const MAX_RETRY_DELAY_MS = 15_000

/**
 * How long to wait before attempt n+1, honouring `retry-after` in both of its legal spellings
 * (delta seconds, and an HTTP date) and falling back to exponential backoff.
 *
 * `now` is a parameter rather than a `Date.now()` call so the HTTP-date branch is testable.
 */
export const retryDelay = (response: Response, attempt: number, now = Date.now()): number => {
  const header = response.headers.get('retry-after')
  const seconds = Number(header)
  const headerMs =
    header && Number.isFinite(seconds) ? seconds * 1_000
    : header ? new Date(header).getTime() - now
    : NaN
  const delay = Number.isFinite(headerMs) && headerMs > 0 ? headerMs : backoffDelay(attempt)
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

export const backoffDelay = (attempt: number): number =>
  Math.min(1_000 * 2 ** attempt, MAX_RETRY_DELAY_MS)

/**
 * What an extractor may pass beside the platform's RequestInit, carried unchanged through the
 * backoff, the osra hop and the main thread to `cloud.fetch`.
 *
 * `spread` sends the request through any healthy FKN node in turn instead of the node the session is
 * on. For an upstream that meters per source address, and nothing else: AniList's public API answers
 * `x-ratelimit-limit: 30` a minute per address (scripts/measure-start-date-window.mjs), shared by
 * every user behind one node. An upstream that ties anything to the address a session was opened
 * from stays on the one node.
 */
export type FetchInit = RequestInit & { spread?: boolean }
export type FetchLike = (input: RequestInfo | URL, init?: FetchInit) => Promise<Response>

/**
 * Wrap a fetch so a transient upstream failure is asked again instead of surfacing as data.
 *
 * `wait` is injected so a test does not spend the real backoff, and `now` for the same reason.
 */
export const withBackoff = (
  fetchImpl: FetchLike,
  { wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), now = () => Date.now() } = {}
): FetchLike =>
  async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      // A rejected fetch is a dropped connection or a proxy hiccup, which is at least as transient
      // as any status this retries. Letting it through unretried made the backoff blind to the one
      // failure mode that never arrives as a Response at all.
      let response: Response
      try {
        response = await fetchImpl(input, init)
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error
        await wait(backoffDelay(attempt))
        continue
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_RETRIES) return response
      // the body is never read on a retried response, and an uncancelled one leaks the stream
      void response.body?.cancel().catch(() => {})
      await wait(retryDelay(response, attempt, now()))
    }
  }
