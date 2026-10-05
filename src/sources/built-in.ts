// The sources stub ships with, for the settings page to list on the main thread: the extractors pull in
// wasm, so they are never bundled there (see ./key-configs.ts). tests/unit/sources/built-in.test.ts pins
// this to what ./index.ts actually runs, origin, name and site, in the same order.

export type BuiltInSource = {
  origin: string
  name: string
  url: string
}

export const builtInSources: BuiltInSource[] = [
  { origin: 'mal', name: 'MyAnimeList', url: 'https://myanimelist.net' },
  { origin: 'anilist', name: 'Anilist', url: 'https://anilist.co' },
  { origin: 'anizip', name: 'AniZip', url: 'https://api.ani.zip/' },
  { origin: 'cr', name: 'Crunchyroll', url: 'https://www.crunchyroll.com' },
  { origin: 'nf', name: 'Netflix', url: 'https://www.netflix.com' },
  { origin: 'jw', name: 'JustWatch', url: 'https://www.justwatch.com' },
  { origin: 'appletv', name: 'Apple TV+', url: 'https://tv.apple.com' },
  { origin: 'paramount', name: 'Paramount+', url: 'https://www.paramountplus.com' },
  { origin: 'disney', name: 'Disney+', url: 'https://www.disneyplus.com' },
  { origin: 'amazon', name: 'Prime Video', url: 'https://www.primevideo.com' },
  { origin: 'hulu', name: 'Hulu', url: 'https://www.hulu.com' },
  { origin: 'peacock', name: 'Peacock', url: 'https://www.peacocktv.com' },
  { origin: 'hbo', name: 'Max', url: 'https://www.max.com' },
  { origin: 'fubo', name: 'Fubo', url: 'https://www.fubo.tv' },
  { origin: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org' },
  { origin: 'tvmaze', name: 'TVmaze', url: 'https://www.tvmaze.com' },
  { origin: 'kitsu', name: 'Kitsu', url: 'https://kitsu.io' },
  { origin: 'omdb', name: 'OMDb', url: 'https://www.omdbapi.com' },
  { origin: 'trakt', name: 'Trakt', url: 'https://trakt.tv' },
  { origin: 'simkl', name: 'Simkl', url: 'https://simkl.com' },
  { origin: 'tvdb', name: 'TheTVDB', url: 'https://www.thetvdb.com' },
  { origin: 'offline', name: 'Offline database', url: 'https://github.com/manami-project/anime-offline-database' },
  { origin: 'imdb', name: 'IMDb', url: 'https://www.imdb.com' },
  { origin: 'watchmode', name: 'Watchmode', url: 'https://www.watchmode.com' },
]
