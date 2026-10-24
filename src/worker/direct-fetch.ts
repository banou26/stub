// Which upstreams this app asks from the VIEWER'S OWN BROWSER instead of through the FKN relay, and
// why that exception exists at all. No imports beyond a type, for the reason on backoff.ts: fetch.ts
// calls osra's expose() at module scope and cannot be loaded by a test.
//
// THE DEFAULT IS THE RELAY AND STAYS THE RELAY. `ctx.fetch` goes worker -> osra -> src/utils/fetch.ts
// -> `cloud.fetch`, which asks the upstream server-side from an FKN node. That is what gets past a
// CORS-closed upstream, and it is the reason nearly every source in src/sources works at all.
//
// WHAT IT COSTS, and the whole of why this file exists: the relay asks from ITS address, not the
// viewer's, so an upstream that answers per country answers about the RELAY's country. Measured
// 2026-09-13 from this machine, one page, both paths side by side:
//
// | ask                                        | through the relay          | from the browser |
// | ------------------------------------------ | -------------------------- | ---------------- |
// | egress address                             | 152.233.49.59, Hong Kong   | 59.138.72.110, Tokyo |
// | Mushoku Tensei (80987039) landing query     | isAvailable false, 0 seasons | isAvailable true, 3 seasons |
// | season 82941638 episodes                    | 200, 0 edges               | 200, 12 edges    |
// | season 82984815 episodes                    | 200, videos: [null]        | 200, 11 edges    |
// | Stranger Things season 80077209 (the control) | 200, 8 edges, 11627 bytes | 200, 8 edges, 11627 bytes |
//
// Read the control row first: a title available in both countries comes back BYTE FOR BYTE the same
// through either path, same persisted query, same body, same count. The relay carries this request
// perfectly. Nothing is mangled, no header is dropped, the host is not refused. The single difference
// is which country's catalogue the answer is about, and Netflix's answer about Hong Kong is a correct
// answer to the wrong question: the viewer is in Tokyo and it is their catalogue the page shows.
//
// So this is not a workaround for a broken relay. It is a statement that for these hosts the viewer's
// own address is part of the question, which no relay can supply.
//
// THE SECOND REASON, api.trace.moe: its answer is the same from any address, but its free
// allowance is not. It counts 100 searches a day and one at a time PER ASKING ADDRESS, and its own
// docs advise a distributed app to "send the API request directly from your clients". Through the
// relay each node is one caller (measured 2026-10-24: Prague asks as 79.127.204.69, Hong Kong as
// 152.233.49.59), so every viewer on a node would share those 100, one search at a time. Its CORS
// reflects the page's origin on the preflight and the GET (measured 2026-10-24, from anime.fkn.app).
//
// WHAT THE EXCEPTION COSTS THE VIEWER, stated rather than implied:
//
//  - The viewer's address reaches the upstream directly. For www.netflix.com that is an address which
//    already loads netflix.com's images on any page that shows a Netflix badge; api.trace.moe logs it
//    for its rate limit, its terms say.
//  - It only works where the upstream opens CORS. www.netflix.com/graphql answers
//    `access-control-allow-origin` reflecting a foreign origin on both the preflight and the POST
//    (measured 2026-09-12 and again 2026-09-13 from a page on 127.0.0.1). An upstream that closes
//    CORS cannot be added here, and adding it would fail as a network error rather than as an answer.
//  - Every request to a host in this set MUST carry `credentials: 'omit'`. The viewer may well be
//    signed in to Netflix in this very browser, and the relay's own isolation is what used to make
//    that impossible by construction. `netflix.ts` sets it explicitly on both of its calls, and
//    src/scene/search.ts on its one.
//
// Adding a host here is a deliberate decision with all three costs above, never a fix for a request
// that failed once.
import type { FetchLike } from './backoff'

/**
 * The origins asked from the browser rather than through the relay.
 *
 * Exact origins, never suffixes: `endsWith('netflix.com')` would also match a host somebody else
 * controls, and the point of the set is that it names what was measured.
 */
export const DIRECT_FETCH_ORIGINS: ReadonlySet<string> = new Set(['https://www.netflix.com', 'https://api.trace.moe'])

/**
 * Whether this request goes straight to the upstream from the viewer's browser.
 *
 * Anything unparseable, or any input this cannot read an origin off, answers false: the relay is the
 * default and an unreadable input must fall back to it rather than to the exception.
 */
export const asksViewerDirectly = (input: RequestInfo | URL): boolean => {
  const href =
    typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : typeof (input as Request)?.url === 'string' ? (input as Request).url
    : undefined
  if (href === undefined) return false
  try {
    return DIRECT_FETCH_ORIGINS.has(new URL(href).origin)
  } catch {
    return false
  }
}

/**
 * One fetch over the two paths: `direct` for the origins above, `relay` for everything else.
 *
 * Both are injected so a test can tell which one ran, which is the only thing about this worth
 * pinning: a rule that routed everything to one path would still look like it worked.
 */
export const withDirectFetch = (relay: FetchLike, direct: FetchLike): FetchLike =>
  (input, init) => asksViewerDirectly(input) ? direct(input, init) : relay(input, init)
