
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

const ROUTES = {
  [Route.HOME]: () => '/',
  [Route.MEDIA]: ({ uri }: { uri: string }) => `/media/${uri}`,
  [Route.MEDIA_EPISODE]: ({ uri, mediaUri }: { uri: string, mediaUri: string }) => `/media/${uri}/${mediaUri}`,
  [Route.TITLE]: ({ uri }: { uri: string }) => `/title/${uri}`,
  // The filters ride in the QUERY STRING, so the href is built by `searchPath` in ./search/params.ts,
  // which knows the param names. This module stays dependency-free because the WORKER imports it
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
    `/watch/${mediaUri}/${episodeUri}${sourceUri ? `/${sourceUri}`: ''}`,
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
