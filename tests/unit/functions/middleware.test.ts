import type { Answer, Preview } from '../../../src/preview'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import wasmModule from './stub-wasm'

const ROOT = resolve(import.meta.dirname, '../../..')
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

const DISCORD = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const SETTLED: Preview = { title: 'Black Clover Season 2', description: 'Asta returns.', image: 'https://artworks.thetvdb.com/banners/331753.jpg', wide: true, color: '#f1a143' }
// what the merge reads before every source has answered (measured 2026-10-23)
const INTERIM: Preview = { ...SETTLED, title: 'Black Clover Second Season' }

type Options = { deadline: number, settleBy?: number }
type Asked = Options & { uri: string, site: string, wasm: unknown }

let onRequest: typeof import('../../../functions/_middleware').onRequest
let createPreview: ReturnType<typeof vi.fn>
let asked: Asked[]
let cache: Map<string, Response>
let matching: () => Promise<void>
let putting: () => Promise<void>

const deferred = <T>() => {
  let settle!: (value: T) => void
  const promise = new Promise<T>(resolve => { settle = resolve })
  return { promise, settle }
}

/** A copy of stub's worker whose answer, at the deadline and once settled, is the one given. */
const copy = (first?: Preview | Promise<Preview | undefined>, last: Preview | undefined | Promise<Preview | undefined> = first) => ({
  answer: (uri: string, site: string, wasm: unknown, options: Options): Answer => {
    asked.push({ uri, site, wasm, ...options })
    return { first: Promise.resolve(first), last: Promise.resolve(last) }
  },
})

beforeEach(async () => {
  vi.resetModules()
  ;({ onRequest } = await import('../../../functions/_middleware'))
  ;({ createPreview } = await import('./stub-preview'))
  createPreview.mockImplementation(() => copy(SETTLED))
  asked = []
  cache = new Map()
  matching = async () => {}
  putting = async () => {}
  vi.stubGlobal('caches', {
    default: {
      match: async (key: Request) => {
        await matching()
        return cache.get(key.url)?.clone()
      },
      put: async (key: Request, value: Response) => {
        await putting()
        cache.set(key.url, value)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const call = async (address: string, userAgent = DISCORD, method = 'GET') => {
  const pages: Response[] = []
  const next = vi.fn(async () => {
    const page = new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    pages.push(page)
    return page
  })
  const pending: Promise<unknown>[] = []
  const request = new Request(address, { method, headers: { 'user-agent': userAgent } })
  const response = await onRequest({ request, next, waitUntil: promise => { pending.push(promise) } })
  return { response, html: await response.clone().text(), next, pages, kept: Promise.all(pending) }
}

const meta = (html: string, key: string) =>
  [...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].filter(([, name]) => name === key).map(([, , content]) => content)

const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1]

const kept = (site: string, segment: string) => cache.get(`https://preview.cache/${site}/${segment}`)

test.each([
  { address: 'https://anime.fkn.app/title/ag:(anilist:195604,mal:61967)', uri: 'ag:(anilist:195604,mal:61967)', site: 'anime', name: 'Stub Anime' },
  { address: 'https://stub.fkn.app/media/ag:(mal:61469,offline:mal-61469)', uri: 'ag:(mal:61469,offline:mal-61469)', site: 'stub', name: 'Stub' },
  { address: 'https://anime.fkn.app/watch/ag:(anilist:195604)/ag:(anizip:19444-1)', uri: 'ag:(anilist:195604)', site: 'anime', name: 'Stub Anime' },
  { address: 'https://movies.fkn.app/title/ag%3A(nf%3A70125365)', uri: 'ag:(nf:70125365)', site: 'movie', name: 'Stub Movies' },
  { address: 'https://series.fkn.app/media/jw:131317', uri: 'ag:(jw:131317)', site: 'series', name: 'Stub Series' },
])('a crawler on $address gets what stub draws for $uri on $site', async ({ address, uri, site, name }) => {
  const { response, html } = await call(address)
  expect(response.status).toBe(200)
  expect(asked).toEqual([{ uri, site, wasm: { frizbee: wasmModule, sacha: wasmModule }, deadline: expect.any(Number), settleBy: 20_000 }])
  expect(title(html)).toBe(`Black Clover Season 2 - ${name}`)
  expect(meta(html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(meta(html, 'og:description')).toEqual(['Asta returns.'])
  expect(meta(html, 'og:image')).toEqual([SETTLED.image])
  expect(meta(html, 'og:site_name')).toEqual([name])
  expect(meta(html, 'og:type')).toEqual(['video.other'])
  expect(meta(html, 'og:url')).toEqual([address])
  expect(meta(html, 'twitter:card')).toEqual(['summary_large_image'])
  expect(meta(html, 'theme-color')).toEqual(['#f1a143'])
})

test('a cover rather than a banner is the small card, and no colour keeps the shell\'s theme-color', async () => {
  createPreview.mockImplementation(() => copy({ title: 'I Am Love', image: 'https://occ.nflxso.net/cover.jpg', wide: false }))
  const { html } = await call('https://movies.fkn.app/title/ag:(nf:70125365)')
  expect(meta(html, 'twitter:card')).toEqual(['summary'])
  expect(meta(html, 'og:description')).toEqual([])
  expect(meta(html, 'theme-color')).toEqual(['#0f0f0f'])
})

test('a source\'s text is escaped in every attribute and in the title', async () => {
  createPreview.mockImplementation(() => copy({ title: 'Tom & "Jerry" <Live> $& $\'', description: 'A "cat" & a mouse', image: 'https://s4.anilist.co/b.jpg?w=1&h="2"', wide: true, color: '#fff" onload="x' }))
  const { html } = await call('https://anime.fkn.app/title/ag:(anilist:1)')
  const name = 'Tom &amp; &quot;Jerry&quot; &lt;Live&gt; $&amp; $\''
  expect(html).toContain(`<title>${name} - Stub Anime</title>`)
  expect(html).toContain(`<meta property="og:title" content="${name}">`)
  expect(html).toContain('<meta property="og:description" content="A &quot;cat&quot; &amp; a mouse">')
  expect(html).toContain('<meta property="og:image" content="https://s4.anilist.co/b.jpg?w=1&amp;h=&quot;2&quot;">')
  expect(html).toContain('<meta name="theme-color" content="#fff&quot; onload=&quot;x">')
  expect(html).not.toContain('<Live>')
  expect(html.match(/<title>/g)).toHaveLength(1)
})

test.each([
  ['a desktop browser on a title', 'https://anime.fkn.app/title/ag:(anilist:195604)', CHROME],
  ['a desktop browser on a watch address', 'https://movies.fkn.app/watch/ag:(jw:985864)/ag:(jw:985864)', CHROME],
  ['a crawler on the home', 'https://anime.fkn.app/', DISCORD],
  ['a crawler on a party', 'https://anime.fkn.app/party', DISCORD],
  ['Pinterest\'s in-app browser', 'https://anime.fkn.app/title/ag:(anilist:195604)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]'],
])('%s gets next() byte for byte, and no copy of stub is built', async (_, address, userAgent) => {
  const { html, next, pages, response } = await call(address, userAgent)
  expect(next).toHaveBeenCalledTimes(1)
  expect(response).toBe(pages[0])
  expect(html).toBe(SHELL)
  expect(createPreview).not.toHaveBeenCalled()
  expect(cache.size).toBe(0)
})

test('a crawler\'s HEAD gets next(), and no copy of stub is built', async () => {
  const { next, pages, response } = await call('https://series.fkn.app/title/ag:(tmdb:52762)', DISCORD, 'HEAD')
  expect(next).toHaveBeenCalledTimes(1)
  expect(response).toBe(pages[0])
  expect(createPreview).not.toHaveBeenCalled()
  expect(cache.size).toBe(0)
})

test.each([
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'TelegramBot (like TwitterBot)',
  'Twitterbot/1.0',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  'WhatsApp/2.23.20.0',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  'Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)',
  'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)',
  'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.10136 MicrosoftPreview/2.0',
  'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
  'vkShare; +http://vk.com/dev/Share',
  'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
  'Mozilla/5.0 (compatible; Pinterestbot/1.0; +https://www.pinterest.com/bot.html)',
])('%s is a link-preview crawler', async userAgent => {
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:195604)', userAgent)).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('the deadline counts from the request, so time spent before the copy is not added to it', async () => {
  matching = () => new Promise(resolve => setTimeout(resolve, 400))
  await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(asked[0]!.deadline).toBeGreaterThan(1_900)
  expect(asked[0]!.deadline).toBeLessThanOrEqual(2_100)
})

test('the settled preview is what is kept for a day, and a later crawler gets it with no copy built', async () => {
  createPreview.mockImplementation(() => copy(INTERIM, SETTLED))
  const first = await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(meta(first.html, 'og:title')).toEqual(['Black Clover Second Season'])
  await first.kept
  expect(await kept('anime', 'ag:(anilist:195604)')!.clone().json()).toEqual(SETTLED)
  expect(kept('anime', 'ag:(anilist:195604)')!.headers.get('cache-control')).toBe('max-age=86400')

  const later = await call('https://anime.fkn.app/title/ag:(anilist:195604)', 'TelegramBot (like TwitterBot)')
  expect(meta(later.html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(createPreview).toHaveBeenCalledTimes(1)

  await call('https://stub.fkn.app/title/ag:(anilist:195604)')
  expect(createPreview).toHaveBeenCalledTimes(2)
})

test('when the read ends with no title, the deadline\'s preview is kept', async () => {
  createPreview.mockImplementation(() => copy(INTERIM, Promise.resolve(undefined)))
  await (await call('https://anime.fkn.app/title/ag:(anilist:195604)')).kept
  expect(await kept('anime', 'ag:(anilist:195604)')!.json()).toEqual(INTERIM)
})

test('a link with no title, as a copy that reached no source ends too, gets the plain card, kept five minutes', async () => {
  createPreview.mockImplementation(() => copy(undefined))
  const first = await call('https://series.fkn.app/title/ag:(tmdb:52762)')
  expect(first.response.status).toBe(200)
  expect(title(first.html)).toBe('Stub Series')
  expect(meta(first.html, 'og:title')).toEqual(['Stub Series'])
  expect(meta(first.html, 'og:image')).toEqual([])
  await first.kept
  expect(await kept('series', 'ag:(tmdb:52762)')!.clone().json()).toBeNull()
  expect(kept('series', 'ag:(tmdb:52762)')!.headers.get('cache-control')).toBe('max-age=300')

  const later = await call('https://series.fkn.app/title/ag:(tmdb:52762)')
  expect(meta(later.html, 'og:title')).toEqual(['Stub Series'])
  expect(createPreview).toHaveBeenCalledTimes(1)
})

test('the copy\'s work is handed to waitUntil before the crawler is answered, so a crawler that leaves cannot cut it', async () => {
  const atDeadline = deferred<Preview | undefined>()
  createPreview.mockImplementation(() => copy(atDeadline.promise, new Promise(() => {})))
  const handed: Promise<unknown>[] = []
  const answered = onRequest({
    request: new Request('https://anime.fkn.app/title/ag:(anilist:195604)', { headers: { 'user-agent': DISCORD } }),
    next: async () => new Response(SHELL),
    waitUntil: promise => { handed.push(promise) },
  })
  await vi.waitFor(() => expect(createPreview).toHaveBeenCalledTimes(1))
  expect(handed).toHaveLength(1)
  atDeadline.settle(SETTLED)
  expect(title(await (await answered).text())).toBe('Black Clover Season 2 - Stub Anime')
})

test('while a copy answers, a second crawler gets the plain card at once, and the copy gives its turn back as it ends', async () => {
  const settles = deferred<Preview | undefined>()
  createPreview.mockImplementationOnce(() => copy(SETTLED, settles.promise))
  const one = await call('https://anime.fkn.app/title/ag:(anilist:1)')
  expect(meta(one.html, 'og:title')).toEqual(['Black Clover Season 2'])

  const started = performance.now()
  const second = await call('https://anime.fkn.app/title/ag:(anilist:2)')
  expect(performance.now() - started).toBeLessThan(200)
  expect(meta(second.html, 'og:title')).toEqual(['Stub Anime'])
  expect(createPreview).toHaveBeenCalledTimes(1)
  await second.kept
  expect(kept('anime', 'ag:(anilist:2)')).toBeUndefined()

  settles.settle(SETTLED)
  await one.kept
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(createPreview).toHaveBeenCalledTimes(2)
})

test('a crawler answered from the edge cache takes no turn, its preview or its plain card', async () => {
  createPreview.mockImplementationOnce(() => copy(SETTLED)).mockImplementationOnce(() => copy(undefined))
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)')).kept
  await (await call('https://series.fkn.app/title/ag:(tmdb:52762)')).kept
  await call('https://anime.fkn.app/title/ag:(anilist:1)')
  await call('https://series.fkn.app/title/ag:(tmdb:52762)')
  expect(createPreview).toHaveBeenCalledTimes(2)

  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('an edge cache that will not keep the preview still has the turn given back', async () => {
  putting = async () => { throw new Error('put') }
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)')).kept
  expect(cache.size).toBe(0)
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test.each([
  ['building the copy throws', () => { throw new Error('the copy failed') }],
  ['its answer throws', () => ({ answer: () => { throw new Error('the answer failed') } })],
  ['its reads reject', () => ({ answer: () => ({ first: Promise.reject(new Error('read')), last: Promise.reject(new Error('read')) }) })],
])('when %s, the crawler gets the page as is and the turn is given back', async (_, failing) => {
  createPreview.mockImplementationOnce(failing).mockImplementationOnce(failing)
  for (const id of [1, 2]) {
    const { html, pages, response, kept: done } = await call(`https://anime.fkn.app/title/ag:(anilist:${id})`)
    expect(response).toBe(pages.at(-1))
    expect(html).toBe(SHELL)
    await done
  }
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:3)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('a turn whose work the runtime cancelled lapses on its own after 35 s', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  await call('https://anime.fkn.app/title/ag:(anilist:1)')

  vi.setSystemTime(Date.now() + 34_000)
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Stub Anime'])
  vi.setSystemTime(Date.now() + 1_001)
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(createPreview).toHaveBeenCalledTimes(2)
})

test('an edge cache that fails answers the page as is', async () => {
  matching = async () => { throw new Error('cache') }
  const { html, pages, response } = await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(response).toBe(pages.at(-1))
  expect(html).toBe(SHELL)
})

test('the Function runs on title, media and watch addresses alone, so assets and the home never invoke it', () => {
  expect(JSON.parse(readFileSync(resolve(ROOT, 'public/_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/title/*', '/media/*', '/watch/*'], exclude: [] })
})
