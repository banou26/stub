export * as jikan from './jikan/extractor'
export * as anilist from './anilist/extractor'
export * as anizip from './anizip/extractor'
export * as crunchyroll from './crunchyroll/extractor'
export * as unogs from './unogs/extractor'
export * as justwatch from './justwatch/extractor'
export * as appletv from './appletv/extractor'
export * as paramount from './paramount/extractor'
export * as disney from './disney/extractor'
export * as amazon from './amazon/extractor'
export * as hulu from './hulu/extractor'
export * as peacock from './peacock/extractor'
export * as hbo from './hbo/extractor'
export * as fubo from './fubo/extractor'
export * as tmdb from './tmdb/extractor'
export * as tvmaze from './tvmaze/extractor'
export * as kitsu from './kitsu/extractor'
export * as livechart from './livechart/extractor'
export * as omdb from './omdb/extractor'
export * as trakt from './trakt/extractor'
export * as simkl from './simkl/extractor'
export * as tvdb from './tvdb/extractor'
export * as offline from './offline/extractor'
// answers nothing on purpose: it exists so an `imdb:` handle has an origin to render against
export * as imdb from './imdb/extractor'

// Watchmode was DISABLED on 2026-09-04 and is back on 2026-09-05, unchanged in what it knows and
// changed in what it claims. Every provider handle it mints is show level, because its record is a
// show and it has no season concept anywhere in the file. As SAME_AS each of those welded two runs
// together, and refusing them individually left it contributing nothing, so it was unplugged.
//
// It now mints them PART_OF: the url survives, the claim does not. That is what this source was always
// for. See `MediaHandleRelation` in worker/resolvers/media/schema.gql.
export * as watchmode from './watchmode/extractor'
