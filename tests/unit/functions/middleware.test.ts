import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { onRequest } from '../../../functions/_middleware'

const ROOT = resolve(import.meta.dirname, '../../..')
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

const DISCORD = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const BANNER = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/195604.jpg'
const ANILIST: Record<string, object> = {
  'id:195604': { title: { english: 'Black Clover Season 2', romaji: 'Black Clover 2' }, description: 'Asta<br>returns. (Source: Crunchyroll)', coverImage: { extraLarge: 'https://s4.anilist.co/cover/195604.jpg', color: '#e4a15d' }, bannerImage: BANNER },
  'idMal:61469': { title: { english: null, romaji: 'STEEL BALL RUN' }, description: null, coverImage: { extraLarge: 'https://s4.anilist.co/cover/61469.jpg', color: null }, bannerImage: null },
}

const node = (title: string, imdbVotes: number, backdrop = true) => ({
  objectType: 'MOVIE',
  content: { title, shortDescription: `${title}, told short.`, posterUrl: `/poster/1/s718/${imdbVotes}.jpg`, backdrops: backdrop ? [{ backdropUrl: `/backdrop/2/s1920/${imdbVotes}.jpg` }] : [], scoring: { imdbVotes } },
})
const JUSTWATCH: Record<string, object> = {
  tm985864: node('Coyote vs. Acme', 5_000),
  ts985864: node('An Unrelated Show', 40),
  tm128715: node('Batman Returns', 330_000),
  ts128715: node('Whitetail Country', 12),
  tm131317: node('An Obscure Short', 3),
  ts131317: node('Slow Horses', 90_000),
  tm555: node('A Film Nobody Rated', 0),
  ts555: node('A Show Nobody Rated', 0),
  tm395707: node('An Unrelated Film', 900_000),
  ts395707: node('The Apothecary Diaries', 20_000),
  tm777: node('A Film Without Art', 120, false),
  tss511393: { content: { title: 'Season 3' } },
}

const BLACK_CLOVER = { titles: { en: 'Black Clover Season 2' }, canonicalTitle: 'Black Clover 2', synopsis: 'Asta returns.', coverImage: { original: 'https://media.kitsu.app/cover/50024.jpg' }, posterImage: { original: 'https://media.kitsu.app/poster/50024.jpg' } }

type Answer = (url: URL, body: any, signal?: AbortSignal | null) => unknown
const ANSWERS: Record<string, Answer> = {
  'graphql.anilist.co': (_, { query, variables }) => {
    const media = ANILIST[`${/Media\((\w+):/.exec(query)?.[1]}:${variables.v}`]
    return media ? { data: { Media: media } } : new Response('{"data":{"Media":null}}', { status: 404 })
  },
  'apis.justwatch.com': (_, { query }) => ({ data: Object.fromEntries([...query.matchAll(/(\w+):node\(id:"(\w+)"\)/g)].map(([, alias, id]) => [alias, JUSTWATCH[id] ?? null])) }),
  'v3.sg.media-imdb.com': url => ({ d: url.pathname.endsWith('/tt0386676.json') ? [{ id: 'tt0386676', l: 'The Office', y: 2005, s: 'Steve Carell, Jenna Fischer', i: { imageUrl: 'https://m.media-amazon.com/office.jpg' } }] : [] }),
  'api.tvmaze.com': url => url.pathname === '/shows/1292' ? { name: 'The Office', summary: '<p>A mockumentary.</p>', image: { original: 'https://static.tvmaze.com/office.jpg' } } : new Response('', { status: 404 }),
  'kitsu.io': url => {
    if (url.pathname === '/api/edge/anime/50024') return { data: { attributes: BLACK_CLOVER } }
    const mapped = `${url.searchParams.get('filter[externalSite]')}:${url.searchParams.get('filter[externalId]')}`
    if (url.pathname === '/api/edge/mappings' && url.searchParams.get('include') === 'item') {
      return ['anilist/anime:195604', 'myanimelist/anime:61967'].includes(mapped)
        ? { data: [{ type: 'mappings' }], included: [{ type: 'anime', attributes: BLACK_CLOVER }] }
        : { data: [] }
    }
    return new Response('', { status: 404 })
  },
}

let answers: Record<string, Answer>
let fetches: { url: string, body: any }[]
let cache: Map<string, Response>

const late = (ms: number, answer: Answer): Answer => (url, body, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(answer(url, body)), ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) })
})

beforeEach(() => {
  answers = { ...ANSWERS }
  fetches = []
  cache = new Map()
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    fetches.push({ url: url.href, body })
    const answer = await answers[url.hostname]?.(url, body, init?.signal)
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('caches', {
    default: {
      match: async (key: Request) => cache.get(key.url)?.clone(),
      put: async (key: Request, value: Response) => { cache.set(key.url, value) },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const call = async (address: string, userAgent = DISCORD) => {
  const pages: Response[] = []
  const next = vi.fn(async () => {
    const page = new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    pages.push(page)
    return page
  })
  const pending: Promise<unknown>[] = []
  const request = new Request(address, { headers: { 'user-agent': userAgent } })
  const response = await onRequest({ request, next, waitUntil: promise => { pending.push(promise) } })
  await Promise.all(pending)
  return { response, html: await response.clone().text(), next, pages }
}

const meta = (html: string, key: string) =>
  [...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].filter(([, name]) => name === key).map(([, , content]) => content)

const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1]

test.each([
  { address: 'https://anime.fkn.app/title/ag:(anilist:195604,kitsu:50024,mal:61967)', site: 'Stub Anime', name: 'Black Clover Season 2', image: BANNER, card: 'summary_large_image', asked: ['graphql.anilist.co'] },
  { address: 'https://stub.fkn.app/media/ag:(mal:61469,offline:mal-61469)', site: 'Stub', name: 'STEEL BALL RUN', image: 'https://s4.anilist.co/cover/61469.jpg', card: 'summary', asked: ['graphql.anilist.co'] },
  { address: 'https://anime.fkn.app/watch/ag:(anilist:195604)/ag:(anizip:19444-1)', site: 'Stub Anime', name: 'Black Clover Season 2', image: BANNER, card: 'summary_large_image', asked: ['graphql.anilist.co'] },
  { address: 'https://movies.fkn.app/title/ag:(jw:985864)', site: 'Stub Movies', name: 'Coyote vs. Acme', image: 'https://images.justwatch.com/backdrop/2/s1920/5000.jpg', card: 'summary_large_image', asked: ['apis.justwatch.com'] },
  { address: 'https://movies.fkn.app/title/ag:(anilist:999,jw:985864)', site: 'Stub Movies', name: 'Coyote vs. Acme', image: 'https://images.justwatch.com/backdrop/2/s1920/5000.jpg', card: 'summary_large_image', asked: ['graphql.anilist.co', 'apis.justwatch.com'] },
  { address: 'https://movies.fkn.app/title/ag:(jw:777)', site: 'Stub Movies', name: 'A Film Without Art', image: 'https://images.justwatch.com/poster/1/s718/120.jpg', card: 'summary', asked: ['apis.justwatch.com'] },
  { address: 'https://series.fkn.app/media/ag:(jw:395707-511393)', site: 'Stub Series', name: 'The Apothecary Diaries, Season 3', image: 'https://images.justwatch.com/backdrop/2/s1920/20000.jpg', card: 'summary_large_image', asked: ['apis.justwatch.com'] },
  { address: 'https://anime.fkn.app/media/ag:(jw:395707-511393)', site: 'Stub Anime', name: 'The Apothecary Diaries, Season 3', image: 'https://images.justwatch.com/backdrop/2/s1920/20000.jpg', card: 'summary_large_image', asked: ['apis.justwatch.com'] },
  { address: 'https://series.fkn.app/title/ag:(imdb:tt0386676,trakt:the-office)', site: 'Stub Series', name: 'The Office (2005)', image: 'https://m.media-amazon.com/office.jpg', card: 'summary', asked: ['v3.sg.media-imdb.com'] },
  { address: 'https://series.fkn.app/title/ag:(omdb:tt0386676)', site: 'Stub Series', name: 'The Office (2005)', image: 'https://m.media-amazon.com/office.jpg', card: 'summary', asked: ['v3.sg.media-imdb.com'] },
  { address: 'https://series.fkn.app/title/ag:(tvmaze:1292)', site: 'Stub Series', name: 'The Office', image: 'https://static.tvmaze.com/office.jpg', card: 'summary', asked: ['api.tvmaze.com'] },
  { address: 'https://series.fkn.app/watch/ag:(tvmaze:1292-s2)/ag:(tvmaze:1292-s2-e1)', site: 'Stub Series', name: 'The Office', image: 'https://static.tvmaze.com/office.jpg', card: 'summary', asked: ['api.tvmaze.com'] },
  { address: 'https://anime.fkn.app/title/ag:(kitsu:50024)', site: 'Stub Anime', name: 'Black Clover Season 2', image: 'https://media.kitsu.app/cover/50024.jpg', card: 'summary_large_image', asked: ['kitsu.io'] },
])('a crawler on $address gets "$name" from its ids', async ({ address, site, name, image, card, asked }) => {
  const { response, html } = await call(address)
  expect(response.status).toBe(200)
  expect(title(html)).toBe(`${name} - ${site}`)
  expect(meta(html, 'og:title')).toEqual([name])
  expect(meta(html, 'og:image')).toEqual([image])
  expect(meta(html, 'og:site_name')).toEqual([site])
  expect(meta(html, 'og:type')).toEqual(['video.other'])
  expect(meta(html, 'og:url')).toEqual([address])
  expect(meta(html, 'twitter:card')).toEqual([card])
  expect(fetches.map(({ url }) => new URL(url).hostname)).toEqual(asked)
})

test('a known colour replaces the shell\'s theme-color, and an unknown one keeps it', async () => {
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:195604)')).html, 'theme-color')).toEqual(['#e4a15d'])
  expect(meta((await call('https://movies.fkn.app/title/ag:(jw:985864)')).html, 'theme-color')).toEqual(['#0f0f0f'])
})

test('the description is plain text, without markup or a source credit, and at most 200 characters', async () => {
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:195604)')).html, 'og:description')).toEqual(['Asta returns.'])
  answers['graphql.anilist.co'] = () => ({ data: { Media: { title: { english: 'Long' }, description: 'word '.repeat(60) } } })
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:1)')).html, 'og:description')).toEqual([`${'word '.repeat(39)}word…`])
})

test.each([
  'https://movies.fkn.app/title/ag%3A(jw%3A985864)',
  'https://movies.fkn.app/title/ag%3A%28jw%3A985864%29',
])('a percent-encoded segment resolves as the plain one: %s', async address => {
  expect(meta((await call(address)).html, 'og:title')).toEqual(['Coyote vs. Acme'])
})

test('JustWatch is asked for the film on movies.fkn.app, the show on series.fkn.app, and both in one query elsewhere', async () => {
  const kinds = async (address: string) => {
    fetches = []
    await call(address)
    return fetches.map(({ body }) => [...body.query.matchAll(/node\(id:"(t[ms])985864"\)/g)].map(([, kind]) => kind))
  }
  expect(await kinds('https://movies.fkn.app/title/ag:(jw:985864)')).toEqual([['tm']])
  expect(await kinds('https://series.fkn.app/title/ag:(jw:985864)')).toEqual([['ts']])
  expect(await kinds('https://stub.fkn.app/title/ag:(jw:985864)')).toEqual([['tm', 'ts']])
  expect(await kinds('https://anime.fkn.app/title/ag:(jw:985864)')).toEqual([['tm', 'ts']])
})

test('a bare JustWatch number off movies. and series. is the node with more IMDb votes, and a tie is the plain card', async () => {
  expect(meta((await call('https://stub.fkn.app/media/ag:(jw:128715)')).html, 'og:title')).toEqual(['Batman Returns'])
  expect(meta((await call('https://stub.fkn.app/media/ag:(jw:131317)')).html, 'og:title')).toEqual(['Slow Horses'])

  const tie = await call('https://stub.fkn.app/media/ag:(jw:555)')
  expect(tie.response.status).toBe(200)
  expect(title(tie.html)).toBe('Stub')
  expect(meta(tie.html, 'og:title')).toEqual(['Stub'])
  expect(meta(tie.html, 'og:image')).toEqual([])
})

test('an address no source here can name gets the plain site card, asking nothing', async () => {
  const { response, html } = await call('https://movies.fkn.app/media/ag:(nf:81365135)')
  expect(response.status).toBe(200)
  expect(title(html)).toBe('Stub Movies')
  expect(meta(html, 'og:site_name')).toEqual(['Stub Movies'])
  expect(meta(html, 'og:title')).toEqual(['Stub Movies'])
  expect(meta(html, 'og:image')).toEqual([])
  expect(fetches).toEqual([])
})

test.each([
  ['stub.fkn.app/title/ag:(mal:61469))', 'Stub'],
  ['stub.fkn.app/title/ag:(mal:abc)', 'Stub'],
  ['anime.fkn.app/title/ag:(anilist:1x)', 'Stub Anime'],
  ['movies.fkn.app/title/ag%3A(jw%3A985864%22)', 'Stub Movies'],
])('an id that is not a number on %s asks no upstream and gets the plain card', async (address, site) => {
  const { response, html } = await call(`https://${address}`)
  expect(response.status).toBe(200)
  expect(title(html)).toBe(site)
  expect(fetches).toEqual([])
})

test('an anime named only by its AniList or MAL id is found through Kitsu when AniList refuses', async () => {
  // what AniList answered Cloudflare's edge on 2026-10-23
  answers['graphql.anilist.co'] = () => new Response('', { status: 403 })
  for (const address of ['https://anime.fkn.app/title/ag:(anilist:195604)', 'https://anime.fkn.app/watch/ag:(mal:61967)']) {
    const { html } = await call(address)
    expect(meta(html, 'og:title'), address).toEqual(['Black Clover Season 2'])
    expect(meta(html, 'og:image'), address).toEqual(['https://media.kitsu.app/cover/50024.jpg'])
  }
})

test('an id goes into an upstream\'s path encoded', async () => {
  await call('https://series.fkn.app/title/ag%3A(imdb%3Att0386676%3Fx)')
  expect(fetches.map(({ url }) => url)).toEqual(['https://v3.sg.media-imdb.com/suggestion/x/tt0386676%3Fx.json'])
})

test('an answer that is not ok is a miss, whatever its body, and the next id is asked', async () => {
  answers['graphql.anilist.co'] = () => new Response('<html>403</html>', { status: 403 })
  const { html } = await call('https://movies.fkn.app/title/ag:(anilist:1,jw:985864)')
  expect(meta(html, 'og:title')).toEqual(['Coyote vs. Acme'])
})

test('the whole lookup has one deadline, so slow misses cannot add up, and the crawler gets the shell', async () => {
  answers['graphql.anilist.co'] = late(1_500, ANSWERS['graphql.anilist.co']!)
  answers['kitsu.io'] = late(1_500, ANSWERS['kitsu.io']!)
  const started = performance.now()
  const { html, pages, response } = await call('https://anime.fkn.app/title/ag:(anilist:1,kitsu:50024)')
  expect(performance.now() - started).toBeLessThan(2_900)
  expect(response).toBe(pages.at(-1))
  expect(html).toBe(SHELL)
}, 10_000)

test('a resolver that throws answers next() unchanged', async () => {
  answers['graphql.anilist.co'] = () => ({ data: { Media: { title: null } } })
  const { html, pages, response } = await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(response).toBe(pages.at(-1))
  expect(html).toBe(SHELL)
})

test('upstream text is escaped in every attribute and in the title', async () => {
  answers['graphql.anilist.co'] = () => ({ data: { Media: { title: { english: 'Tom & "Jerry" <Live> $& $\'' }, description: 'A "cat" & <i>a</i> mouse', coverImage: { color: '#fff" onload="x' }, bannerImage: 'https://s4.anilist.co/b.jpg?w=1&h="2"' } } })
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

test('the answer is kept a day per site and title, so a second crawler asks nothing', async () => {
  await call('https://stub.fkn.app/title/ag:(anilist:195604)')
  expect(fetches).toHaveLength(1)
  expect([...cache.values()].map(entry => entry.headers.get('cache-control'))).toEqual(['max-age=86400'])

  const again = await call('https://stub.fkn.app/title/ag:(anilist:195604)', 'TelegramBot (like TwitterBot)')
  expect(fetches).toHaveLength(1)
  expect(meta(again.html, 'og:title')).toEqual(['Black Clover Season 2'])

  await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(fetches).toHaveLength(2)
})

test.each([
  ['a desktop browser on a title', 'https://anime.fkn.app/title/ag:(anilist:195604)', CHROME],
  ['a desktop browser on a watch address', 'https://movies.fkn.app/watch/ag:(jw:985864)/ag:(jw:985864)', CHROME],
  ['a crawler on the home', 'https://anime.fkn.app/', DISCORD],
  ['a crawler on a party', 'https://anime.fkn.app/party', DISCORD],
  ['Pinterest\'s in-app browser', 'https://anime.fkn.app/title/ag:(anilist:195604)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]'],
])('%s gets next() byte for byte, asking no upstream', async (_, address, userAgent) => {
  const { html, next, pages, response } = await call(address, userAgent)
  expect(next).toHaveBeenCalledTimes(1)
  expect(response).toBe(pages[0])
  expect(html).toBe(SHELL)
  expect(fetches).toEqual([])
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

test('the Function runs on title, media and watch addresses alone, so assets and the home never invoke it', () => {
  expect(JSON.parse(readFileSync(resolve(ROOT, 'public/_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/title/*', '/media/*', '/watch/*'], exclude: [] })
})
