// Which upstreams this app asks from the VIEWER'S OWN BROWSER instead of through the FKN relay. No imports beyond a
// type, for the reason on backoff.ts: fetch.ts calls osra's expose() at module scope and cannot be loaded by a test.
//
// The owner's rule, 2026-10-25: a request a browser can make, because its upstream opens CORS, is made from the
// viewer's browser, and the relay is only for upstreams a browser cannot read. So a host is listed here when the exact
// request its source sends works from a page on https://anime.fkn.app: the preflight, when the request needs one, and
// the answer both allow that origin, and nothing the request needs is a header a browser drops.
//
// Measured 2026-10-25 with headless Chrome on a page at that origin, each host asked as its source asks it: every host
// listed answered, and these did not, so they stay on the relay:
//
// | host                     | why                                                                                  |
// | ------------------------ | ------------------------------------------------------------------------------------ |
// | anilist.co               | no allow-origin on the answer, and the fallback needs a cookie and a user agent       |
// | www.crunchyroll.com      | the token POST's answer has no allow-origin; the catalogue GET has one, but needs it   |
// | static.crunchyroll.com   | no allow-origin                                                                       |
// | api.simkl.com            | allows any origin, but answers any request carrying an Origin 412 `client_id_failed`  |
// | simkl.com                | no allow-origin, and the search needs simkl.com as its origin and referer             |
// | www.paramountplus.com    | no allow-origin                                                                       |
// | apis.justwatch.com       | the preflight allows it, the POST's answer does not                                   |
// | caching.graphql.imdb.com | the preflight allows it, the POST's answer does not                                   |
// | gateway.watchmode.com    | no allow-origin, and it needs watchmode.com as its origin                             |
// | myanimelist.net          | no allow-origin                                                                       |
// | www.themoviedb.org       | no allow-origin                                                                       |
// | unogs.com                | no allow-origin, and it needs unogs.com as its referer                                |
//
// What a listed host costs: the viewer's address reaches it, so the privacy page names each one
// (tests/unit/router/privacy.test.tsx holds it to this list), and a limit it counts per address counts the viewer's
// requests rather than a relay node's: AniList's 30 a minute, trace.moe's 100 searches a day. For www.netflix.com the
// address is the point: its catalogue answer is about the asking address's country, and through the relay it was
// about Hong Kong's (Mushoku Tensei unavailable, 0 seasons) while the viewer's Tokyo had 3 seasons (2026-09-13).
//
// The link preview has no browser: src/preview/fetch.ts stands in for ./fetch.ts there and relays every host.
import type { FetchLike } from './backoff'

/**
 * The origins asked from the browser rather than through the relay.
 *
 * Exact origins, never suffixes: `endsWith('netflix.com')` would also match a host somebody else
 * controls, and the point of the set is that it names what was measured.
 */
export const DIRECT_FETCH_ORIGINS: ReadonlySet<string> = new Set([
  'https://api.ani.zip',
  'https://api.trace.moe',
  'https://api.tvmaze.com',
  'https://api4.thetvdb.com',
  'https://apiz.trakt.tv',
  'https://cdn.animenewsnetwork.com',
  'https://graphql.anilist.co',
  'https://graphql.animethemes.moe',
  'https://kitsu.io',
  'https://uts-api.itunes.apple.com',
  'https://www.livechart.me',
  'https://www.netflix.com',
])

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
 * A direct request never carries credentials, whatever the caller asked: the viewer may be signed in to one of these
 * sites in this very browser, and no request here needs it.
 */
export const withDirectFetch = (relay: FetchLike, direct: FetchLike): FetchLike =>
  (input, init) => asksViewerDirectly(input) ? direct(input, { ...init, credentials: 'omit' }) : relay(input, init)
