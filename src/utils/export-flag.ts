import { isSeedAssetUrl } from '../sources/offline/seed'

export const EXPORT_PARAM = 'export'
export const EXPORT_VALUE = 'store'
export const EXPORT_ANSWERS_VALUE = 'answers'

const asks = (url: string, value: string, base?: string): boolean => {
  try {
    return new URL(url, base).searchParams.getAll(EXPORT_PARAM).includes(value)
  } catch {
    return false
  }
}

/**
 * Whether this url asks for the store export hook. Exactly `?export=store`, never mere presence, so a
 * stray `?export=1` in a shared link cannot attach anything. Never throws: an unparseable url reads
 * false. `base` resolves a relative url, the same way `readPluginUris` takes one.
 */
export const readExportFlag = (url: string, base?: string): boolean => asks(url, EXPORT_VALUE, base)

/**
 * Whether this url asks for the ANSWER LOG export hook, exactly `?export=answers`.
 *
 * A separate value on the same param, so one page can carry both (`?export=store&export=answers`)
 * and neither reads the other's flag. The log itself only fills behind `?graph=1`; this flag decides
 * whether the page publishes a way to read it.
 */
export const readAnswersExportFlag = (url: string, base?: string): boolean => asks(url, EXPORT_ANSWERS_VALUE, base)

export const EXPORT_QUERY_VALUE = 'query'

/**
 * Whether this url asks for the GRAPHQL PROBE hook, exactly `?export=query`.
 *
 * Its own value on the same param, so a page can carry it beside the other two and none reads
 * another's flag. What it publishes is a way to put a document through the worker exactly as the
 * app's own client does, which is the only way to compare the two read stores on what they ANSWER
 * rather than on what a page happens to render.
 */
export const readQueryProbeFlag = (url: string, base?: string): boolean => asks(url, EXPORT_QUERY_VALUE, base)

export const STORE_PARAM = 'store'
export const STORE_LEGACY_VALUE = 'legacy'

/**
 * Which store this url reads. THE GRAPH IS THE DEFAULT, and `?store=legacy` is the only way back.
 *
 * It was inverted until 2026-09-13, when the graph became the store the app ships on: `?store=graph`
 * was the switch and its absence meant the old store. Anything written before that date describing
 * `?store=graph` as "turning the graph on" is describing the old default rather than a flag that
 * still does something, and `?store=graph` remains harmless because only the explicit opt out is read.
 *
 * ONLY THE EXACT OPT OUT COUNTS, never mere presence of the param, so a typo (`?store=legcy`,
 * `?store=1`) lands on the default rather than silently on the store being retired. That asymmetry is
 * deliberate: a page that quietly reads the old store looks like a page whose data is stale, which is
 * the hardest kind of wrong to notice.
 *
 * Never throws: an unparseable url reads as the default, the same as every other reader here.
 */
export const readsLegacyStore = (url: string, base?: string): boolean => {
  try {
    return new URL(url, base).searchParams.get(STORE_PARAM) === STORE_LEGACY_VALUE
  } catch {
    return false
  }
}

export const TRACE_PARAM = 'trace'
export const TRACE_VALUE = '1'

/**
 * Whether this url asks for the GRAPH TRACE link, exactly `?trace=1`.
 *
 * The trace page itself is a route and needs no flag: this is only about whether a media view puts a
 * link to it on screen, which is section 7.5's "behind `?trace=1` on the modal". Its own param rather
 * than a value on `export`, because the other three publish a window function to a walk while this
 * one is a link a person clicks. Never throws: an unparseable url reads false.
 */
export const readTraceFlag = (url: string, base?: string): boolean => {
  try {
    return new URL(url, base).searchParams.getAll(TRACE_PARAM).includes(TRACE_VALUE)
  } catch {
    return false
  }
}

export const NO_SEED_PARAM = 'seed'
export const NO_SEED_VALUE = 'off'

/**
 * Whether this url asks the offline source's SEEDED half to stay off, exactly `?seed=off`.
 *
 * Read per request rather than once, so a client-side navigation that keeps the query keeps the
 * answer. Never throws: an unparseable url reads false, which leaves the seed on.
 */
export const readNoSeedFlag = (url: string, base?: string): boolean => {
  try {
    return new URL(url, base).searchParams.getAll(NO_SEED_PARAM).includes(NO_SEED_VALUE)
  } catch {
    return false
  }
}

const requestUrlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/**
 * Whether the page must refuse a worker fetch of the published season seed.
 *
 * A walk drives the app with `?seed=off` so it never reads its own previous output. Without that a
 * seeded id is stored, joins the cluster's aggregated uri, and the next live source to read that uri
 * re-asserts SAME_AS across the whole membership (`mergeHandles` in sources/utils.ts), so the next
 * export publishes the id as though a source had checked it, permanently and with no inverse.
 *
 * It lives on the PAGE because a worker cannot see the page's url and an announcement over the port
 * would race the first resolver, and because the page already owns every byte the worker fetches.
 */
export const refusesSeedAsset = (pageUrl: string, request: RequestInfo | URL): boolean =>
  readNoSeedFlag(pageUrl) && isSeedAssetUrl(requestUrlOf(request))
