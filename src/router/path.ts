import { builtInSources } from '../sources/built-in'
import { nameSegment, slugOf } from '../utils/slug'
import { fromAggregatedUri, fromUri, isAggregatedUri, joinUris, matchAggregatedUris, routeMediaUri, shouldRewriteAddress } from '../utils/uri'

export enum Route {
  HOME = 'HOME',
  MEDIA = 'MEDIA',
  TITLE = 'TITLE',
  SEARCH = 'SEARCH',
  SEARCH_LEGACY = 'SEARCH_LEGACY',
  LEGAL = 'LEGAL',
  PRIVACY = 'PRIVACY',
  SETTINGS = 'SETTINGS',
  LIST = 'LIST',
  CONTINUE = 'CONTINUE',
  WATCH = 'WATCH',
  PARTY = 'PARTY',
  DEBUG_TRACE = 'DEBUG_TRACE',
  LOGIN_CALLBACK = 'LOGIN_CALLBACK',
}

const BUILT_IN_ORIGINS = new Set(builtInSources.map(source => source.origin))

/**
 * An episode's uri as a watch address names it: without the rows of added sources, which say where to watch and not
 * which episode this is. An indexer files each release as a row of the episode (28 on Frieren's second season's third
 * episode, 2026-10-31), and those rows reach only a viewer who added it, where stub's own sources answer every viewer.
 * Origin is the only test that holds: a plugin marks no release, a release's url can be a web page, and an origin
 * repeating in an episode is not one listing releases, as JustWatch files a service's row beside the service's own.
 *
 * An episode none of stub's sources knows keeps its first id, so the address still names something. Anything else comes
 * back as it came, byte for byte. Any one id in common finds the episode (`matchAggregatedUris`), so an address that
 * names every row opens as it always did, and comes out short when it is next written.
 */
export const watchEpisodeUri = (uri: string): string => {
  const handles = isAggregatedUri(uri) ? fromAggregatedUri(uri)?.handleUris ?? [] : []
  const own = handles.filter(handle => BUILT_IN_ORIGINS.has(fromUri(handle).origin))
  return own.length === handles.length ? uri : `ag:(${joinUris(own.length ? own : handles.slice(0, 1))})`
}

const ROUTES = {
  [Route.HOME]: () => '/',
  // the work's name rides after its uri, which a link without it, or with an old one, still opens (`movedAddress`)
  [Route.MEDIA]: ({ uri, name }: { uri: string, name?: string | null }) => `/media/${uri}${nameSegment(name)}`,
  [Route.TITLE]: ({ uri, name }: { uri: string, name?: string | null }) => `/title/${uri}${nameSegment(name)}`,
  // The filters ride in the QUERY STRING, so the href is built by `searchPath` in ./search/params.ts,
  // which knows the param names. This module stays light because the WORKER imports it
  // (store/aggregate.ts builds a media's canonical url with it), so it cannot reach the generated
  // enums that validate those params.
  [Route.SEARCH]: () => '/search',
  [Route.SEARCH_LEGACY]: ({ query }: { query: string }) => `/search/${encodeURIComponent(query)}`,
  [Route.LEGAL]: () => '/legal',
  [Route.PRIVACY]: () => '/privacy',
  [Route.SETTINGS]: () => '/settings',
  [Route.LIST]: () => '/list',
  [Route.CONTINUE]: () => '/continue',
  [Route.WATCH]: ({ mediaUri, episodeUri, sourceUri }: { mediaUri: string, episodeUri: string, sourceUri?: string }) =>
    `/watch/${mediaUri}/${watchEpisodeUri(episodeUri)}${sourceUri ? `/${sourceUri}`: ''}`,
  // the invite rides in the FRAGMENT (see party/invite.ts), so the path itself names nothing
  [Route.PARTY]: () => '/party',
  // the traced uri rides in the QUERY STRING, so the href is built by `debugTracePath` in
  // ./debug/trace.ts, the same way the search page's filters are
  [Route.DEBUG_TRACE]: () => '/debug/trace',
  [Route.LOGIN_CALLBACK]: () => '/login/callback',
}

export type RouteParams = {
  [K in Route]: Parameters<typeof ROUTES[K]>[0]
}

const RouterRoutes = {
  [Route.HOME]: '/',
  [Route.MEDIA]: '/media/:uri/:slug?',
  [Route.TITLE]: '/title/:uri/:slug?',
  [Route.SEARCH]: '/search',
  [Route.SEARCH_LEGACY]: '/search/:query',
  [Route.LEGAL]: '/legal',
  [Route.PRIVACY]: '/privacy',
  [Route.SETTINGS]: '/settings',
  [Route.LIST]: '/list',
  [Route.CONTINUE]: '/continue',
  [Route.WATCH]: '/watch/:mediaUri/:episodeUri/:sourceUri?',
  [Route.PARTY]: '/party',
  [Route.DEBUG_TRACE]: '/debug/trace',
  [Route.LOGIN_CALLBACK]: '/login/callback',
}

export const getRouterRoutePath =
  (route: Route) =>
    RouterRoutes[route]

export const getRoutePath = <
  T extends Route
> (
  route: T,
  args?: Parameters<(typeof ROUTES)[T]>[0]
) =>
  ROUTES[route](<any>args)

/** What the preview's and the title page's routes hand their page: the uri and the name as the address spells them. */
export type MediaParams = { uri: string, slug?: string }

/**
 * The address a preview or a title page replaces its own with, or undefined to keep it. The uri grows to the cluster's
 * as `shouldRewriteAddress` says, else stays as the address spells it. The name follows the work in hand once the page
 * holds the work the address names (on a navigation it holds the one being left for a beat), and with no name yet the
 * address keeps its own. `grown` says the uri is now the cluster's, which the page keeps as `written`.
 */
export const movedAddress = (
  route: Route.MEDIA | Route.TITLE,
  params: Partial<MediaParams>,
  media: { uri: string, name?: string } | null | undefined,
  written?: string,
): { path: string, grown: boolean } | undefined => {
  const uri = routeMediaUri(params.uri)
  if (!media || !uri || !isAggregatedUri(media.uri) || !isAggregatedUri(uri) || !matchAggregatedUris(media.uri, uri)) return undefined
  const grown = shouldRewriteAddress(media.uri, uri, written)
  const slug = media.name === undefined ? params.slug ?? '' : slugOf(media.name)
  if (!grown && slug === (params.slug ?? '')) return undefined
  return { path: `${getRoutePath(route, { uri: grown ? media.uri : params.uri! })}${slug && `/${encodeURIComponent(slug)}`}`, grown }
}
