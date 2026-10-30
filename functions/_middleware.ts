import type { Answer, Preview } from '../src/preview'

import { siteOf, type Site } from '../src/site'
import { routeMediaUri } from '../src/utils/uri'
import { expandPath, SHORT_PATH } from '../src/utils/share-link'
import { createPreview } from '../functions-lib/preview.js'
import frizbee from '../functions-lib/frizbee_wasm_bg.wasm'
import sacha from '../functions-lib/sacha_bg.wasm'

/** As much of an R2 bucket binding as the Function uses. */
type Bucket = { put: (key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => Promise<unknown> }

/** `STUB_SOURCES`, bound on the Pages project, is the private source store's bucket; unbound, nothing is kept there. */
type Env = { STUB_SOURCES?: Bucket }

type Context = { request: Request, next: () => Promise<Response>, waitUntil: (promise: Promise<unknown>) => void, env: Env }

const CRAWLER = /discordbot|slackbot|telegrambot|twitterbot|facebookexternalhit|whatsapp|linkedinbot|redditbot|mastodon|skypeuripreview|microsoftpreview|embedly|vkshare|pinterestbot|pinterest\/0\./i
const TITLE_PATH = /^\/(?:title|media|watch)\/([^/]+)/
const SITE_NAMES: Record<Site, string> = { anime: 'Stub Anime', movie: 'Stub Movies', series: 'Stub Series', stub: 'Stub' }
// from the request; no unfurler documents how long it waits for a page
const DEADLINE_MS = 2_500
// against an isolate's 128 MB: with no episodes kept (src/preview), a long series' copy alone completes under a 100 MiB
// V8 heap and peaks at 93 to 123 MB with no cap, garbage included (Detective Conan, One Piece; workerd, 1 run each,
// 2026-10-24)
const AT_ONCE = 1
// a copy still asking here is stopped, and holds its turn until it has unwound (src/preview)
const SETTLE_MS = 20_000
// a turn is given back when its copy ends; the runtime ends `waitUntil` work 30 s after the response at the latest,
// and work it cancels never reaches its `finally`, so a turn also lapses on its own
const TURN_MS = 35_000
const DAY_S = 86_400
// short, since a copy that reached no source (the relays restarting, or metering this data centre's address) ends
// the same way as a link stub cannot name, and a run behind the offline card that reached none gathered nothing
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

const lookup = async (segment: string, site: Site, started: number, answered: Promise<void>, waitUntil: Context['waitUntil'], bucket?: Bucket): Promise<Preview | undefined> => {
  const cache = (caches as CacheStorage & { default: Cache }).default
  const key = new Request(`https://preview.cache/${site}/${segment}`)
  // `null`, a run with no card or nothing gathered, or a cache that cannot be read, says not to run: the offline card
  // may still answer
  const settled = await cache.match(key).then(hit => hit?.json() as Promise<Preview | null> | undefined).catch(() => null)
  if (settled) return settled
  const uri = routeMediaUri(segment)
  const copy = createPreview()
  const show = await copy.offlineShow(uri, site)
  const known = show?.preview
  if (settled === null) return known
  const release = take(Date.now())
  if (!release) return known
  let answer: Answer
  try {
    answer = copy.answer(show?.address ?? uri, site, { frizbee, sacha }, { deadline: DEADLINE_MS - (Date.now() - started), settleBy: SETTLE_MS, after: known && answered })
  } catch (error) {
    release()
    if (known) return known
    throw error
  }
  const { first, last, inbox } = answer
  // the run's answers go to the store once the card is kept, and the copy's turn is held until they have, so two
  // copies never meet in the isolate; a store that refuses them costs that run's answers, never the card
  waitUntil(last.catch(() => undefined).then(async preview => {
    const object = bucket && await inbox().catch(() => undefined)
    // unbound, the run's answers are never read, so nothing says it gathered none
    const gathered = !known || !bucket || object
    await keep(cache, key, gathered ? preview ?? await first : undefined).catch(() => {})
    if (object) await bucket.put(object.key, object.body, { httpMetadata: { contentType: 'application/gzip' } })
  }).catch(() => {}).finally(release))
  return known ?? await first
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
 * Gives a link-preview crawler's GET on a title, media or watch address, or a short link to one, the title,
 * description and art stub itself draws for it, and every other request the page untouched: the settled card the last
 * run kept in the edge cache, else stub's offline data when it holds a title and a cover for the address, else stub's
 * own sources run here (src/preview). On that cache miss the sources run behind the offline card too, holding the
 * isolate's one turn, once the crawler has its answer, and what they settle on is kept for the next. Reads nothing
 * about the requester but its user agent, logs nothing about it, and keeps only public show data: a title's preview in
 * the edge cache, and what the sources answered for it in the private source store. An edge cache that cannot be read
 * runs nothing, so the offline card or the plain one answers; any other failure answers the offline card when there is
 * one, else the page as is.
 */
export const onRequest = async ({ request, next, waitUntil, env }: Context) => {
  const started = Date.now()
  const url = new URL(request.url)
  // a short link gets its address's card, kept under the same key
  const short = url.pathname.startsWith(SHORT_PATH) ? expandPath(url.pathname.slice(SHORT_PATH.length)) : undefined
  const segment = TITLE_PATH.exec(short ? new URL(short, url).pathname : url.pathname)?.[1]
  if (request.method !== 'GET' || !segment || !CRAWLER.test(request.headers.get('user-agent') ?? '')) return next()
  const { promise: answered, resolve } = Promise.withResolvers<void>()
  try {
    const site = siteOf(url.hostname)
    const preview = await lookup(segment, site, started, answered, waitUntil, env.STUB_SOURCES)
    return await withPreview(await next(), url, site, preview)
  } catch {
    return next()
  } finally {
    // a timer, since a microtask would boot the copy before the runtime had the response
    setTimeout(resolve)
  }
}
