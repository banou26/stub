// Which of stub's four sites this page or worker serves, read once from its own address. No imports,
// so the page, the worker and the tests share it.

export type Site = 'anime' | 'movie' | 'series' | 'stub'

const SITE_HOST = /^(anime|movies|series|stub)\.(fkn\.app|localhost)$/

/**
 * The site an address serves: anime.fkn.app, movies.fkn.app and series.fkn.app by their first label,
 * and `movies.localhost` the same way in development. Any other host, stub.fkn.app, a pages.dev preview
 * or a sandbox tenant, is `stub`, which shows everything.
 */
export const siteOf = (hostname: string): Site => {
  const label = hostname.match(SITE_HOST)?.[1]
  return label === 'movies' ? 'movie' : (label as Site | undefined) ?? 'stub'
}

export const site: Site = siteOf(globalThis.location?.hostname ?? '')

const SITE_LINKS: { site: Site, host: string, label: string }[] = [
  { site: 'movie', host: 'movies', label: 'Movies' },
  { site: 'series', host: 'series', label: 'Series' },
  { site: 'anime', host: 'anime', label: 'Anime' },
  { site: 'stub', host: 'stub', label: 'All' },
]

/**
 * The four sites' homes as seen from an address, in the header's order: the same domain, protocol and
 * port with the first label swapped. Only on the four sites' own hosts, on fkn.app or `localhost`;
 * anywhere else (a pages.dev preview, a sandbox tenant, an IP) there are none, since a link there would
 * leave a preview for production or navigate an embedded frame away.
 */
export const siteLinksOf = ({ protocol, hostname, port }: Pick<URL, 'protocol' | 'hostname' | 'port'>) => {
  const domain = hostname.match(SITE_HOST)?.[2]
  if (!domain) return []
  return SITE_LINKS.map(({ site: to, host, label }) => ({ site: to, label, href: `${protocol}//${host}.${domain}${port ? `:${port}` : ''}/` }))
}

export const siteLinks = globalThis.location ? siteLinksOf(globalThis.location) : []

/**
 * Whether a site keeps a title with these categories. Anime keeps anime, film or series; movie keeps
 * every film, anime films included; series keeps every series but anime.
 */
export const siteAllows = (categories: readonly string[], current: Site = site): boolean =>
  current === 'anime' ? categories.includes('ANIME')
  : current === 'movie' ? categories.includes('MOVIE')
  : current === 'series' ? categories.includes('SERIES') && !categories.includes('ANIME')
  : true

/** The sources that catalogue anime alone: movie and series never ask them. */
export const ANIME_CATALOGUES = ['anilist', 'mal', 'kitsu', 'livechart', 'anizip', 'offline', 'cr']

/** Whether a site asks a built-in source anything: movie and series never ask the anime catalogues. */
export const siteAsks = (origin: string, current: Site = site): boolean =>
  (current !== 'movie' && current !== 'series') || !ANIME_CATALOGUES.includes(origin)
