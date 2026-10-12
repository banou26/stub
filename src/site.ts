// Which of stub's four sites this page or worker serves, read once from its own address. No imports,
// so the page, the worker and the tests share it.

export type Site = 'anime' | 'movie' | 'series' | 'stub'

/**
 * The site an address serves: anime.fkn.app, movie.fkn.app and series.fkn.app by their first label,
 * and `movie.localhost` the same way in development. Any other host, stub.fkn.app, a pages.dev preview
 * or a sandbox tenant, is `stub`, which shows everything.
 */
export const siteOf = (hostname: string): Site =>
  (hostname.match(/^(anime|movie|series)\.(fkn\.app|localhost)$/)?.[1] as Site | undefined) ?? 'stub'

export const site: Site = siteOf(globalThis.location?.hostname ?? '')

/**
 * Whether a site keeps a title with these categories. Anime keeps anime, film or series; movie keeps
 * every film, anime films included; series keeps every series but anime.
 */
export const siteAllows = (categories: readonly string[], current: Site = site): boolean =>
  current === 'anime' ? categories.includes('ANIME')
  : current === 'movie' ? categories.includes('MOVIE')
  : current === 'series' ? categories.includes('SERIES') && !categories.includes('ANIME')
  : true

const ANIME_CATALOGUES = ['anilist', 'mal', 'kitsu', 'livechart', 'anizip', 'offline', 'cr']

/** Whether a site asks a built-in source anything: movie and series never ask the anime catalogues. */
export const siteAsks = (origin: string, current: Site = site): boolean =>
  (current !== 'movie' && current !== 'series') || !ANIME_CATALOGUES.includes(origin)
