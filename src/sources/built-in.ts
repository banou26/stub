// The sources stub ships with, for the settings page to list on the main thread, where the extractors
// (and the wasm they pull in) are never bundled. tests/unit/sources/built-in.test.ts pins it to what
// ./index.ts runs. `imdb` is left out: it answers nothing, and `omdb` is the source that reads IMDb.

export type BuiltInSource = {
  origin: string
  name: string
  url: string
}

export const builtInSources: BuiltInSource[] = [
  { origin: 'mal', name: 'MyAnimeList', url: 'https://myanimelist.net' },
  { origin: 'anilist', name: 'AniList', url: 'https://anilist.co' },
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
  { origin: 'hidive', name: 'HIDIVE', url: 'https://www.hidive.com' },
  { origin: 'tubi', name: 'Tubi', url: 'https://tubitv.com' },
  { origin: 'roku', name: 'The Roku Channel', url: 'https://therokuchannel.roku.com' },
  { origin: 'pluto', name: 'Pluto TV', url: 'https://pluto.tv' },
  { origin: 'plex', name: 'Plex', url: 'https://watch.plex.tv' },
  { origin: 'hoopla', name: 'Hoopla', url: 'https://www.hoopladigital.com' },
  { origin: 'starz', name: 'Starz', url: 'https://www.starz.com' },
  { origin: 'amcplus', name: 'AMC+', url: 'https://www.amcplus.com' },
  { origin: 'philo', name: 'Philo', url: 'https://www.philo.com' },
  { origin: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org' },
  { origin: 'tvmaze', name: 'TVmaze', url: 'https://www.tvmaze.com' },
  { origin: 'kitsu', name: 'Kitsu', url: 'https://kitsu.io' },
  { origin: 'livechart', name: 'LiveChart', url: 'https://www.livechart.me' },
  { origin: 'omdb', name: 'IMDb', url: 'https://www.imdb.com' },
  { origin: 'trakt', name: 'Trakt', url: 'https://trakt.tv' },
  { origin: 'simkl', name: 'Simkl', url: 'https://simkl.com' },
  { origin: 'tvdb', name: 'TheTVDB', url: 'https://www.thetvdb.com' },
  { origin: 'offline', name: 'Offline database', url: 'https://github.com/manami-project/anime-offline-database' },
  { origin: 'animethemes', name: 'AnimeThemes', url: 'https://animethemes.moe' },
  { origin: 'ann', name: 'Anime News Network', url: 'https://www.animenewsnetwork.com' },
  { origin: 'watchmode', name: 'Watchmode', url: 'https://www.watchmode.com' },
]

// api only sources are never drawn; IMDb is drawn as the `imdb` origin, which answers nothing and has no row above
const NEVER_DRAWN = new Set(['anizip', 'jw', 'kitsu', 'livechart', 'offline', 'simkl', 'trakt', 'tvmaze', 'watchmode'])

/** The sources whose icon stub draws, on every site, each under the origin its icon is drawn as. */
export const iconSources: BuiltInSource[] = builtInSources
  .filter(source => !NEVER_DRAWN.has(source.origin))
  .map(source => source.origin === 'omdb' ? { ...source, origin: 'imdb' } : source)
