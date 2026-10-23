import type { Answer, Preview } from '../src/preview'

import { siteOf, type Site } from '../src/site'
import { routeMediaUri } from '../src/utils/uri'
import { createPreview } from '../functions-lib/preview.js'
import frizbee from '../functions-lib/frizbee_wasm_bg.wasm'
import sacha from '../functions-lib/sacha_bg.wasm'

type Context = { request: Request, next: () => Promise<Response>, waitUntil: (promise: Promise<unknown>) => void }

const CRAWLER = /discordbot|slackbot|telegrambot|twitterbot|facebookexternalhit|whatsapp|linkedinbot|redditbot|mastodon|skypeuripreview|microsoftpreview|embedly|vkshare|pinterestbot|pinterest\/0\./i
const TITLE_PATH = /^\/(?:title|media|watch)\/([^/]+)/
const SITE_NAMES: Record<Site, string> = { anime: 'Stub Anime', movie: 'Stub Movies', series: 'Stub Series', stub: 'Stub' }
// from the request; no unfurler documents how long it waits for a page
const DEADLINE_MS = 2_500
// against an isolate's 128 MB: a long series' copy alone reached 132 and 167 MB of live heap (Detective Conan, One
// Piece), a current season's 28 to 35 MB (Black Clover), measured in workerd 2026-10-24, 1 run each
const AT_ONCE = 1
// a copy still asking here is stopped, and holds its turn until it has unwound (src/preview)
const SETTLE_MS = 20_000
// a turn is given back when its copy ends; the runtime ends `waitUntil` work 30 s after the response at the latest,
// and work it cancels never reaches its `finally`, so a turn also lapses on its own
const TURN_MS = 35_000
const DAY_S = 86_400
// short, since a copy that reached no source (the relays restarting, or metering this data centre's address) ends
// the same way as a link stub cannot name
const PLAIN_S = 300

let turns: number[] = []

const take = (now: number) => {
  turns = turns.filter(until => until > now)
  if (turns.length >= AT_ONCE) return undefined
  const until = now + TURN_MS
  turns.push(until)
  return () => {
    const index = turns.indexOf(until)
    if (index !== -1) turns.splice(index, 1)
  }
}

// a title with no preview is kept too, as `null`, so a link stub cannot name does not take a turn on every fetch
const keep = (cache: Cache, key: Request, preview?: Preview) =>
  cache.put(key, new Response(JSON.stringify(preview ?? null), { headers: { 'cache-control': `max-age=${preview ? DAY_S : PLAIN_S}` } }))

const lookup = async (segment: string, site: Site, started: number, waitUntil: Context['waitUntil']): Promise<Preview | undefined> => {
  const cache = (caches as CacheStorage & { default: Cache }).default
  const key = new Request(`https://preview.cache/${site}/${segment}`)
  const cached = await cache.match(key)
  if (cached) return (await cached.json() as Preview | null) ?? undefined
  const release = take(Date.now())
  if (!release) return undefined
  let answer: Answer
  try {
    answer = createPreview().answer(routeMediaUri(segment), site, { frizbee, sacha }, { deadline: DEADLINE_MS - (Date.now() - started), settleBy: SETTLE_MS })
  } catch (error) {
    release()
    throw error
  }
  const { first, last } = answer
  waitUntil(last.then(async preview => keep(cache, key, preview ?? await first)).catch(() => {}).finally(release))
  return await first
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
 * Gives a link-preview crawler's GET on a title, media or watch address the title, description and art stub itself
 * draws for it, from stub's own sources run here (src/preview), and every other request the page untouched. Reads
 * nothing about the requester but its user agent, logs nothing about it, and keeps only a title's public preview in
 * the edge cache. Any failure answers the page as is.
 */
export const onRequest = async ({ request, next, waitUntil }: Context) => {
  const started = Date.now()
  const url = new URL(request.url)
  const segment = TITLE_PATH.exec(url.pathname)?.[1]
  if (request.method !== 'GET' || !segment || !CRAWLER.test(request.headers.get('user-agent') ?? '')) return next()
  try {
    const site = siteOf(url.hostname)
    const preview = await lookup(segment, site, started, waitUntil)
    return await withPreview(await next(), url, site, preview)
  } catch {
    return next()
  }
}
