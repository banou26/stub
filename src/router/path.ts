import { builtInSources } from '../sources/built-in'
import { fromAggregatedUri, fromUri, isAggregatedUri, joinUris } from '../utils/uri'

export enum Route {
  HOME = 'HOME',
  MEDIA = 'MEDIA',
  MEDIA_EPISODE = 'MEDIA_EPISODE',
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
  [Route.MEDIA]: ({ uri }: { uri: string }) => `/media/${uri}`,
  [Route.MEDIA_EPISODE]: ({ uri, mediaUri }: { uri: string, mediaUri: string }) => `/media/${uri}/${mediaUri}`,
  [Route.TITLE]: ({ uri }: { uri: string }) => `/title/${uri}`,
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
  [Route.MEDIA]: '/media/:uri',
  [Route.MEDIA_EPISODE]: '/media/:uri/:mediaUri',
  [Route.TITLE]: '/title/:uri',
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
