// The sources stub ships with, for the settings page to list on the main thread, where the extractors
// (and the wasm they pull in) are never bundled. tests/unit/sources/built-in.test.ts pins it to what
// ./index.ts runs. `imdb` is left out: it answers nothing, and `omdb` is the source that reads IMDb.

export type BuiltInSource = {
  origin: string
  name: string
  url: string
  icon?: string
}

export const builtInSources: BuiltInSource[] = [
  { origin: 'mal', name: 'MyAnimeList', url: 'https://myanimelist.net', icon: 'https://cdn.myanimelist.net/images/favicon.ico' },
  { origin: 'anilist', name: 'AniList', url: 'https://anilist.co', icon: 'https://anilist.co/img/icons/favicon-32x32.png' },
  { origin: 'anizip', name: 'AniZip', url: 'https://api.ani.zip/' },
  { origin: 'cr', name: 'Crunchyroll', url: 'https://www.crunchyroll.com', icon: 'https://static.crunchyroll.com/cxweb/assets/img/favicons/favicon-96x96.png' },
  { origin: 'nf', name: 'Netflix', url: 'https://www.netflix.com', icon: 'https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2023.ico' },
  { origin: 'jw', name: 'JustWatch', url: 'https://www.justwatch.com', icon: 'https://www.justwatch.com/appasset/img/favicon/favicon-32x32.png' },
  { origin: 'appletv', name: 'Apple TV+', url: 'https://tv.apple.com', icon: 'https://tv.apple.com/favicon.ico' },
  { origin: 'paramount', name: 'Paramount+', url: 'https://www.paramountplus.com', icon: 'https://www.paramountplus.com/favicon.ico' },
  { origin: 'disney', name: 'Disney+', url: 'https://www.disneyplus.com', icon: 'https://www.disneyplus.com/favicon.ico' },
  { origin: 'amazon', name: 'Prime Video', url: 'https://www.primevideo.com', icon: 'https://www.primevideo.com/favicon.ico' },
  { origin: 'hulu', name: 'Hulu', url: 'https://www.hulu.com', icon: 'https://www.hulu.com/favicon.ico' },
  { origin: 'peacock', name: 'Peacock', url: 'https://www.peacocktv.com', icon: 'https://www.peacocktv.com/favicon.ico' },
  { origin: 'hbo', name: 'Max', url: 'https://www.max.com', icon: 'https://www.max.com/favicon.ico' },
  { origin: 'fubo', name: 'Fubo', url: 'https://www.fubo.tv', icon: 'https://www.fubo.tv/favicon.ico' },
  { origin: 'hidive', name: 'HIDIVE', url: 'https://www.hidive.com', icon: 'https://static.diceplatform.com/prod/original/dce.hidive/settings/HIDIVE_Logo_iOS_1024x1024_281_29.Y3YMf.vMQ59.png' },
  { origin: 'tubi', name: 'Tubi', url: 'https://tubitv.com', icon: 'https://corporate.tubitv.com/favicon.ico' },
  { origin: 'roku', name: 'The Roku Channel', url: 'https://therokuchannel.roku.com', icon: 'https://therokuchannel.roku.com/favicon.ico' },
  { origin: 'pluto', name: 'Pluto TV', url: 'https://pluto.tv', icon: 'https://pluto.tv/favicon.ico' },
  { origin: 'plex', name: 'Plex', url: 'https://watch.plex.tv', icon: 'https://watch.plex.tv/icons/favicon.ico' },
  { origin: 'hoopla', name: 'Hoopla', url: 'https://www.hoopladigital.com', icon: 'https://www.hoopladigital.com/images/h-favicon.png' },
  { origin: 'starz', name: 'Starz', url: 'https://www.starz.com', icon: 'https://www.starz.com/assets/starz/images/favicon.ico' },
  { origin: 'amcplus', name: 'AMC+', url: 'https://www.amcplus.com', icon: 'https://www.amcplus.com/favicon.ico' },
  { origin: 'philo', name: 'Philo', url: 'https://www.philo.com', icon: 'https://www.philo.com/favicon.ico' },
  { origin: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org', icon: 'https://www.themoviedb.org/favicon.ico' },
  { origin: 'tvmaze', name: 'TVmaze', url: 'https://www.tvmaze.com', icon: 'https://www.tvmaze.com/favicon.ico' },
  { origin: 'kitsu', name: 'Kitsu', url: 'https://kitsu.io', icon: 'https://kitsu.io/favicon.ico' },
  { origin: 'livechart', name: 'LiveChart', url: 'https://www.livechart.me' },
  { origin: 'omdb', name: 'IMDb', url: 'https://www.imdb.com', icon: 'https://www.imdb.com/favicon.ico' },
  { origin: 'trakt', name: 'Trakt', url: 'https://trakt.tv', icon: 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico' },
  { origin: 'simkl', name: 'Simkl', url: 'https://simkl.com', icon: 'https://simkl.com/favicon.ico' },
  { origin: 'tvdb', name: 'TheTVDB', url: 'https://www.thetvdb.com', icon: 'https://www.thetvdb.com/images/icon.png' },
  { origin: 'offline', name: 'Offline database', url: 'https://github.com/manami-project/anime-offline-database' },
  { origin: 'animethemes', name: 'AnimeThemes', url: 'https://animethemes.moe', icon: 'https://animethemes.moe/favicon-32x32.png' },
  { origin: 'ann', name: 'Anime News Network', url: 'https://www.animenewsnetwork.com', icon: 'https://www.animenewsnetwork.com/favicon.ico' },
  { origin: 'watchmode', name: 'Watchmode', url: 'https://www.watchmode.com', icon: 'https://api.watchmode.com/favicon.ico' },
]

// api only sources are never drawn; IMDb is drawn as the `imdb` origin, which answers nothing and has no row above
const NEVER_DRAWN = new Set(['anizip', 'jw', 'kitsu', 'livechart', 'offline', 'simkl', 'trakt', 'tvmaze', 'watchmode'])

/** The origin a built-in source's icon is drawn as, on every site, or undefined when stub never draws it. */
export const drawnAs = (origin: string): string | undefined =>
  NEVER_DRAWN.has(origin) ? undefined : origin === 'omdb' ? 'imdb' : origin
