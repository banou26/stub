import { siteOf, type Site } from '../src/site'
import { extractAggregatedUriOrigin, routeMediaUri } from '../src/utils/uri'

type Preview = { title: string, description?: string, image?: string, wide?: boolean, color?: string }

type Get = (url: string, init?: RequestInit) => Promise<any>

type Context = { request: Request, next: () => Promise<Response>, waitUntil: (promise: Promise<unknown>) => void }

const CRAWLER = /discordbot|slackbot|telegrambot|twitterbot|facebookexternalhit|whatsapp|linkedinbot|redditbot|mastodon|skypeuripreview|microsoftpreview|embedly|vkshare|pinterestbot|pinterest\/0\./i
const TITLE_PATH = /^\/(?:title|media|watch)\/([^/]+)/
const SITE_NAMES: Record<Site, string> = { anime: 'Stub Anime', movie: 'Stub Movies', series: 'Stub Series', stub: 'Stub' }
// one budget for the whole chain, so slow misses cannot add up; no unfurler documents how long it waits for a page
const DEADLINE_MS = 2_500

const text = (html?: string | null, max = 200) => {
  const plain = (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\(Source:[^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain || undefined
}

const anilist = async (get: Get, field: 'id' | 'idMal', id: string): Promise<Preview | undefined> => {
  // AniList reads `idMal: null`, which is what JSON makes of NaN, as no filter at all and answers some other anime
  if (!/^\d+$/.test(id)) return undefined
  const body = await get('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      query: `query($v:Int){Media(${field}:$v,type:ANIME){title{english romaji} description(asHtml:false) coverImage{extraLarge color} bannerImage}}`,
      variables: { v: Number(id) },
    }),
  })
  const m = body?.data?.Media
  return m && { title: m.title.english ?? m.title.romaji, description: text(m.description), image: m.bannerImage ?? m.coverImage?.extraLarge, wide: Boolean(m.bannerImage), color: m.coverImage?.color ?? undefined }
}

const NODE = 'content(country:US,language:"en"){title shortDescription posterUrl(profile:S718,format:JPG) backdrops(profile:S1920,format:JPG){backdropUrl} scoring{imdbVotes}}'

const justwatch = async (get: Get, id: string, site: Site): Promise<Preview | undefined> => {
  const [, node, season] = /^(\d+)(?:-(\d+))?$/.exec(id) ?? []
  if (!node) return undefined
  const kinds = season || site === 'series' ? ['ts'] : site === 'movie' ? ['tm'] : ['tm', 'ts']
  const seasonNode = season ? ` s:node(id:"tss${season}"){... on Season{content(country:US,language:"en"){title}}}` : ''
  const query = `{${kinds.map(kind => `${kind}:node(id:"${kind}${node}"){... on MovieOrShow{${NODE}}}`).join(' ')}${seasonNode}}`
  const body = await get('https://apis.justwatch.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
  // a bare number names an unrelated film and show at once (tm128715 Batman Returns, ts128715 Whitetail Country), and
  // off movies. and series. nothing says which: more IMDb votes was right on 29 of 30 such ids (2026-10-23), the 30th a tie
  const votes = (found: any): number => found.content.scoring?.imdbVotes ?? 0
  const [found, other] = kinds.map(kind => body?.data?.[kind]).filter(found => found?.content).sort((a, b) => votes(b) - votes(a))
  if (!found || (other && votes(other) === votes(found))) return undefined
  const { title, shortDescription, posterUrl, backdrops } = found.content
  const seasonTitle = body.data.s?.content?.title
  const image = backdrops?.[0]?.backdropUrl ?? posterUrl
  return { title: seasonTitle ? `${title}, ${seasonTitle}` : title, description: text(shortDescription), image: image && `https://images.justwatch.com${image}`, wide: Boolean(backdrops?.[0]) }
}

const imdb = async (get: Get, id: string): Promise<Preview | undefined> => {
  const found = (await get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(id)}.json`))?.d?.find((entry: any) => entry.id === id)
  return found && { title: found.y ? `${found.l} (${found.y})` : found.l, description: found.s, image: found.i?.imageUrl }
}

const tvmaze = async (get: Get, id: string): Promise<Preview | undefined> => {
  const show = await get(`https://api.tvmaze.com/shows/${encodeURIComponent(id.split('-')[0]!)}`)
  return show?.name && { title: show.name, description: text(show.summary), image: show.image?.original }
}

const fromKitsu = (anime: any): Preview | undefined =>
  anime && { title: anime.titles?.en ?? anime.canonicalTitle, description: text(anime.synopsis), image: anime.coverImage?.original ?? anime.posterImage?.original, wide: Boolean(anime.coverImage?.original) }

const kitsu = async (get: Get, id: string) => fromKitsu((await get(`https://kitsu.io/api/edge/anime/${encodeURIComponent(id)}`))?.data?.attributes)

// AniList refused every request from Cloudflare's edge on 2026-10-23 (8 of 8, each in about 0.1 s) while Kitsu answered,
// and Kitsu maps both AniList and MyAnimeList ids
const kitsuByMapping = async (get: Get, site: 'anilist/anime' | 'myanimelist/anime', id: string) => {
  if (!/^\d+$/.test(id)) return undefined
  const found = await get(`https://kitsu.io/api/edge/mappings?${new URLSearchParams({ 'filter[externalSite]': site, 'filter[externalId]': id, include: 'item' })}`)
  return fromKitsu(found?.included?.find((item: any) => item.type === 'anime')?.attributes)
}

const RESOLVERS: [string, (get: Get, id: string, site: Site) => Promise<Preview | undefined>][] = [
  ['anilist', (get, id) => anilist(get, 'id', id)],
  ['mal', (get, id) => anilist(get, 'idMal', id)],
  ['jw', justwatch],
  ['imdb', imdb],
  ['omdb', imdb],
  ['tvmaze', tvmaze],
  ['kitsu', kitsu],
  ['anilist', (get, id) => kitsuByMapping(get, 'anilist/anime', id)],
  ['mal', (get, id) => kitsuByMapping(get, 'myanimelist/anime', id)],
]

const lookup = async (segment: string, site: Site): Promise<Preview | undefined> => {
  const uri = routeMediaUri(segment)
  const signal = AbortSignal.timeout(DEADLINE_MS)
  const get: Get = (url, init) => fetch(url, { ...init, signal }).then(response => response.ok ? response.json() : undefined)
  for (const [origin, resolve] of RESOLVERS) {
    const id = extractAggregatedUriOrigin(uri, origin)?.id
    if (!id) continue
    const found = await resolve(get, id, site)
    if (found?.title) return found
  }
  return undefined
}

const cachedLookup = async (segment: string, site: Site, waitUntil: Context['waitUntil']) => {
  const cache = (caches as CacheStorage & { default: Cache }).default
  const key = new Request(`https://preview.cache/${site}/${segment}`)
  const cached = await cache.match(key)
  if (cached) return await cached.json() as Preview
  const preview = await lookup(segment, site)
  if (preview) waitUntil(cache.put(key, new Response(JSON.stringify(preview), { headers: { 'cache-control': 'max-age=86400' } })))
  return preview
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const tag = (attribute: 'property' | 'name', key: string, value: string) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`

const withPreview = async (page: Response, url: URL, site: Site, preview?: Preview) => {
  const name = SITE_NAMES[site]
  const tags = [
    tag('property', 'og:site_name', name),
    tag('property', 'og:type', 'video.other'),
    tag('property', 'og:url', url.href),
    tag('property', 'og:title', preview?.title ?? name),
    preview?.description && tag('property', 'og:description', preview.description),
    preview?.image && tag('property', 'og:image', preview.image),
    tag('name', 'twitter:card', preview?.wide ? 'summary_large_image' : 'summary'),
  ].filter(Boolean).join('')
  // replacer functions, since a `$&` in a title would otherwise splice the matched text back in
  let html = (await page.text())
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(preview ? `${preview.title} - ${name}` : name)}</title>`)
    .replace('</head>', () => `${tags}</head>`)
  if (preview?.color) html = html.replace(/<meta name="theme-color"[^>]*>/, () => tag('name', 'theme-color', preview.color!))
  return new Response(html, page)
}

/**
 * Gives a link-preview crawler on a title, media or watch address the title, description and art its ids name, read
 * from one public source, and every other request the page untouched. Reads nothing about the requester but its user
 * agent, logs nothing, and keeps only a title's public answer in the edge cache. Any failure answers the page as is.
 */
export const onRequest = async ({ request, next, waitUntil }: Context) => {
  const url = new URL(request.url)
  const segment = TITLE_PATH.exec(url.pathname)?.[1]
  if (!segment || !CRAWLER.test(request.headers.get('user-agent') ?? '')) return next()
  try {
    const site = siteOf(url.hostname)
    const preview = await cachedLookup(segment, site, waitUntil)
    return await withPreview(await next(), url, site, preview)
  } catch {
    return next()
  }
}
