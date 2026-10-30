import type { Answer, Preview } from '../../../src/preview'
import type { InboxObject, Run } from '../../../src/preview/inbox'
import type { AnswerRow } from '../../../src/worker/graph'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { offlineShow } from '../../../src/preview'
import { shortenPath, SHORT_PATH } from '../../../src/utils/share-link'
import { inboxLines, inboxObject } from '../../../src/preview/inbox'
import wasmModule from './stub-wasm'

// stub's offline data as the build bundles it: Cowboy Bebop with a title, MyAnimeList's cover, and Kitsu's banner and
// synopsis; its film with a title and no picture; a show stub's merge chose every value of from other sources; a film
// of a bundled season
vi.mock('../../../src/generated/anime-index', () => ({ default: { mal: [1], anilist: [0], kitsu: [1], anidb: [23], ann: [13] } }))
vi.mock('../../../src/generated/anime-seasons', () => ({
  default: { tag: 'test', updated: '', seasons: { '2026-FALL': [{ t: 'Sekiro: No Defeat', ty: 'MOVIE', p: '1/62312.jpg', ml: 62312 }] } },
}))
vi.mock('../../../src/sources/offline/history-shards', () => {
  const sets: Record<string, Record<number, Record<string, unknown>>> = {
    dump: { 1: { 'mal-1': ['Cowboy Bebop', '4/19644.jpg'] }, 5: { 'mal-5': ['Cowboy Bebop: Tengoku no Tobira', ''] }, 6: { 'mal-6': ['Trigun', '7/20310.jpg'] } },
    stub: {
      1: { 'mal-1': { b: 'cover_images/1/original.jpg', d: 'In the year 2071, humanity has colonized several of the planets.' } },
      6: { 'mal-6': { t: 'Trigun as AniList titles it', p: 'https://img.anili.st/media/6', d: 'A synopsis the job kept from AniList.' } },
    },
  }
  return { loadShard: async (set: string, shard: number) => sets[set]?.[shard] && { records: sets[set]![shard] } }
})
// what a copy boots to ask the sources, which an offline answer must not reach
const booted = vi.hoisted(() => [] as string[])
vi.mock('../../../src/worker/resolvers', () => {
  booted.push('resolvers')
  return { resolvers: {} }
})
vi.mock('../../../src/worker/graph', () => {
  booted.push('graph')
  return {}
})

const ROOT = resolve(import.meta.dirname, '../../..')
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

const DISCORD = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const SETTLED: Preview = { title: 'Black Clover Season 2', description: 'Asta returns.', image: 'https://artworks.thetvdb.com/banners/331753.jpg', wide: true, color: '#f1a143' }
// what the merge reads before every source has answered (measured 2026-10-23)
const INTERIM: Preview = { ...SETTLED, title: 'Black Clover Second Season' }

type Options = { deadline: number, settleBy?: number, after?: Promise<unknown> }
type Asked = Options & { uri: string, site: string, wasm: unknown }
type Put = { key: string, value: ArrayBuffer, options: unknown, cached: string[] }

// what a copy hands the inbox, as src/preview/inbox.ts builds it
const OBJECT: InboxObject = { key: 'inbox/2026-10-26/6f1c2a4e-9b0d-4e8a-a1f3-5c7d9e2b4a60.jsonl.gz', body: new Uint8Array([31, 139, 8]).buffer }

let onRequest: typeof import('../../../functions/_middleware').onRequest
let createPreview: ReturnType<typeof vi.fn>
let asked: Asked[]
let cache: Map<string, Response>
let matching: () => Promise<void>
let putting: () => Promise<void>
let fetched: ReturnType<typeof vi.fn>
let inboxes: number

const deferred = <T>() => {
  let settle!: (value: T) => void
  const promise = new Promise<T>(resolve => { settle = resolve })
  return { promise, settle }
}

/** A copy of stub's worker with its own offline answer, whose sources' answer is the one given, and its inbox `object` (null: none). */
const copy = (first?: Preview | Promise<Preview | undefined>, last: Preview | undefined | Promise<Preview | undefined> = first, object: InboxObject | null = OBJECT) => ({
  offlineShow,
  answer: (uri: string, site: string, wasm: unknown, options: Options): Answer => {
    asked.push({ uri, site, wasm, ...options })
    const settled = Promise.resolve(last)
    return {
      first: Promise.resolve(first),
      last: settled,
      inbox: async () => {
        await settled
        inboxes++
        return object ?? undefined
      },
    }
  },
})

/** A `STUB_SOURCES` binding whose puts are kept in `puts`, each with the edge cache's keys at the time, and answered by `answer`. */
const bucket = (answer: () => Promise<unknown> = async () => ({})) => {
  const puts: Put[] = []
  const STUB_SOURCES = {
    put: async (key: string, value: ArrayBuffer, options: unknown) => {
      puts.push({ key, value, options, cached: [...cache.keys()] })
      return answer()
    },
  }
  return { puts, env: { STUB_SOURCES } }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ onRequest } = await import('../../../functions/_middleware'))
  ;({ createPreview } = await import('./stub-preview'))
  createPreview.mockImplementation(() => copy(SETTLED))
  asked = []
  inboxes = 0
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
  fetched = vi.fn(async () => { throw new Error('nothing is fetched here') })
  vi.stubGlobal('fetch', fetched)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const call = async (address: string, userAgent = DISCORD, method = 'GET', env: Parameters<typeof onRequest>[0]['env'] = {}) => {
  const pages: Response[] = []
  const next = vi.fn(async () => {
    const page = new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    pages.push(page)
    return page
  })
  const pending: Promise<unknown>[] = []
  const request = new Request(address, { method, headers: { 'user-agent': userAgent } })
  const response = await onRequest({ request, next, waitUntil: promise => { pending.push(promise) }, env })
  return { response, html: await response.clone().text(), next, pages, kept: Promise.all(pending) }
}

const meta = (html: string, key: string) =>
  [...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].filter(([, name]) => name === key).map(([, , content]) => content)

const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1]

const kept = (site: string, segment: string) => cache.get(`https://preview.cache/${site}/${segment}`)

const BEBOP = 'https://anime.fkn.app/title/ag:(mal:1)'
const COPY = { wasm: { frizbee: wasmModule, sacha: wasmModule }, deadline: expect.any(Number), settleBy: 20_000 }

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

// Mutation: restore `if (known) return known` ahead of the run.
test.each([
  ['its Kitsu id', 'https://anime.fkn.app/title/ag:(kitsu:1)', 'anime', 'Stub Anime'],
  ['its Kitsu id, percent-encoded', 'https://anime.fkn.app/title/ag%3A(kitsu%3A1)', 'anime', 'Stub Anime'],
  ['its offline record', 'https://stub.fkn.app/media/ag:(offline:mal-1)', 'stub', 'Stub'],
])('a show the offline data holds with a title and a cover, named by %s, is answered from it, its sources behind it', async (_, address, site, name) => {
  const { html } = await call(address)
  expect(title(html)).toBe(`Cowboy Bebop - ${name}`)
  expect(meta(html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(meta(html, 'og:description')).toEqual(['In the year 2071, humanity has colonized several of the planets.'])
  expect(meta(html, 'og:image')).toEqual(['https://media.kitsu.app/anime/cover_images/1/original.jpg'])
  expect(meta(html, 'twitter:card')).toEqual(['summary_large_image'])
  expect(asked).toEqual([{ uri: 'ag:(offline:mal-1)', site, ...COPY, after: expect.any(Promise) }])
  expect(fetched).not.toHaveBeenCalled()
})

// Mutations: read only the dump's set in `historyEntry`; give the media the dump's title or picture over the pick's.
test('a link preview draws what stub\'s merge chose, the same data a page starts from, its sources behind it', async () => {
  const { html } = await call('https://anime.fkn.app/title/ag:(mal:6)')
  expect(meta(html, 'og:title')).toEqual(['Trigun as AniList titles it'])
  expect(meta(html, 'og:description')).toEqual(['A synopsis the job kept from AniList.'])
  expect(meta(html, 'og:image')).toEqual(['https://img.anili.st/media/6'])
  expect(asked.map(({ uri }) => uri)).toEqual(['ag:(offline:mal-6)'])
})

test('the offline card boots none of what asks the sources', async () => {
  expect(meta((await call('https://anime.fkn.app/title/ag:(mal:1)')).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(booted).toEqual([])
})

// Mutation: read the offline data ahead of the edge cache, or skip the read.
test('a cache hit answers the settled card and runs nothing, with no copy of stub built', async () => {
  await (await call(BEBOP)).kept
  expect(createPreview).toHaveBeenCalledTimes(1)
  const again = await call(BEBOP, 'TelegramBot (like TwitterBot)')
  expect(meta(again.html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(createPreview).toHaveBeenCalledTimes(1)
  expect(asked).toHaveLength(1)
})

// Mutations: answer `await first`; keep nothing; put nothing; hand the run to nothing but the request.
test('on a miss the offline card answers without waiting on the run, and the run keeps the card and writes the inbox', async () => {
  const settles = deferred<Preview | undefined>()
  createPreview.mockImplementation(() => copy(settles.promise))
  const { puts, env } = bucket()
  const started = performance.now()
  const miss = await call(BEBOP, DISCORD, 'GET', env)
  expect(performance.now() - started).toBeLessThan(2_000)
  expect(meta(miss.html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(asked).toHaveLength(1)
  expect(kept('anime', 'ag:(mal:1)')).toBeUndefined()
  expect(puts).toEqual([])

  settles.settle(SETTLED)
  await miss.kept
  expect(await kept('anime', 'ag:(mal:1)')!.clone().json()).toEqual(SETTLED)
  expect(kept('anime', 'ag:(mal:1)')!.headers.get('cache-control')).toBe('max-age=86400')
  expect(puts.map(({ key }) => key)).toEqual([OBJECT.key])
  expect(meta((await call(BEBOP)).html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(asked).toHaveLength(1)
})

// Mutation: restore `if (known) return known` ahead of the run.
test('a bundled-season show runs on a miss', async () => {
  const { html, kept: done } = await call('https://anime.fkn.app/title/ag:(offline:mal-62312)')
  expect(meta(html, 'og:title')).toEqual(['Sekiro: No Defeat'])
  expect(asked).toEqual([{ uri: 'ag:(offline:mal-62312)', site: 'anime', ...COPY, after: expect.any(Promise) }])
  await done
  expect(await kept('anime', 'ag:(offline:mal-62312)')!.json()).toEqual(SETTLED)
})

// Mutations: answer no card when the turn is taken; take no turn for an offline card.
test('a busy turn skips the run, and the offline card still answers', async () => {
  const settles = deferred<Preview | undefined>()
  createPreview.mockImplementationOnce(() => copy(SETTLED, settles.promise))
  const one = await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  // control: the one turn is taken
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Stub Anime'])

  const busy = await call(BEBOP)
  expect(meta(busy.html, 'og:title')).toEqual(['Cowboy Bebop'])
  await busy.kept
  expect(asked).toHaveLength(1)
  expect(kept('anime', 'ag:(mal:1)')).toBeUndefined()

  settles.settle(SETTLED)
  await one.kept
  await call(BEBOP)
  expect(asked).toHaveLength(2)
})

// Mutation: keep the run's card whatever its inbox holds.
test('a run behind the offline card that reached no source keeps no card, so the offline card answers with no run for five minutes', async () => {
  createPreview.mockImplementation(() => copy(SETTLED, SETTLED, null))
  const { puts, env } = bucket()
  await (await call(BEBOP, DISCORD, 'GET', env)).kept
  expect([inboxes, puts.length]).toEqual([1, 0])
  expect(await kept('anime', 'ag:(mal:1)')!.clone().json()).toBeNull()
  expect(kept('anime', 'ag:(mal:1)')!.headers.get('cache-control')).toBe('max-age=300')
  expect(meta((await call(BEBOP, DISCORD, 'GET', env)).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(asked).toHaveLength(1)
})

// Mutation: pass `uri` to `answer` rather than the show's address.
test.each([
  ['another catalogue\'s id, which names another show or none', 'https://anime.fkn.app/title/ag:(anilist:30,mal:1)', 'ag:(offline:mal-1)'],
  ['another source\'s show', 'https://anime.fkn.app/title/ag:(jw:34435,mal:1)', 'ag:(offline:mal-1)'],
  ['a season of another source', 'https://anime.fkn.app/title/ag:(mal:1,nf:80001305-1)', 'ag:(offline:mal-1)'],
  ['a show it holds with no cover, and another source\'s show', 'https://anime.fkn.app/title/ag:(jw:34435,mal:5)', 'ag:(offline:mal-5)'],
])('a run asks the show the offline data holds and nothing else the address names: %s', async (_, address, uri) => {
  await call(address)
  expect(asked.map(({ uri }) => uri)).toEqual([uri])
})

// Mutations: drop `after`; give the run its start with no timer.
test('the run starts only once the crawler has its answer', async () => {
  let page = false
  let started = false
  const answered = onRequest({
    request: new Request(BEBOP, { headers: { 'user-agent': DISCORD } }),
    next: async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      void asked[0]!.after!.then(() => { started = true })
      await new Promise(resolve => setTimeout(resolve, 5))
      page = !started
      return new Response(SHELL)
    },
    waitUntil: () => {},
    env: {},
  })
  await answered
  expect(page).toBe(true)
  expect(started).toBe(false)
  await asked[0]!.after
  expect(started).toBe(true)
})

// Mutation: hold back every copy of a show the offline data holds, with a card or not.
test.each([
  ['the offline data lacks', 'https://anime.fkn.app/title/ag:(anilist:195604)'],
  ['it holds with no cover', 'https://anime.fkn.app/title/ag:(mal:5)'],
])('a crawler waiting on the sources of a show %s is not held back', async (_, address) => {
  await call(address)
  expect(asked[0]!.after).toBeUndefined()
})

// Mutation: answer `undefined` on a kept `null`.
test('a run that ends with no card leaves the offline card answering, with no second run for five minutes', async () => {
  createPreview.mockImplementation(() => copy(undefined))
  await (await call(BEBOP)).kept
  expect(await kept('anime', 'ag:(mal:1)')!.clone().json()).toBeNull()
  expect(kept('anime', 'ag:(mal:1)')!.headers.get('cache-control')).toBe('max-age=300')
  expect(meta((await call(BEBOP)).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(asked).toHaveLength(1)
})

// Mutations: rethrow a failed answer; let `last`'s rejection skip `first`.
test.each([
  ['its answer throws', () => ({ offlineShow, answer: () => { throw new Error('the answer failed') } })],
  ['its reads reject', () => ({ offlineShow, answer: () => ({ first: Promise.reject(new Error('read')), last: Promise.reject(new Error('read')), inbox: () => Promise.reject(new Error('read')) }) })],
])('when %s behind the offline card, the card answers and the turn is given back', async (_, failing) => {
  createPreview.mockImplementationOnce(failing)
  const { html, kept: done } = await call(BEBOP)
  expect(meta(html, 'og:title')).toEqual(['Cowboy Bebop'])
  await done
  expect(cache.size).toBe(0)
  await call(BEBOP)
  expect(asked).toHaveLength(1)
})

test('a run the runtime cancels leaves the offline card answering, and the show runs again once its turn lapses', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  const { puts, env } = bucket()
  await call(BEBOP, DISCORD, 'GET', env)
  vi.setSystemTime(Date.now() + 34_000)
  expect(meta((await call(BEBOP, DISCORD, 'GET', env)).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(asked).toHaveLength(1)
  vi.setSystemTime(Date.now() + 1_001)
  expect(meta((await call(BEBOP, DISCORD, 'GET', env)).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(asked).toHaveLength(2)
  expect(cache.size).toBe(0)
  expect(puts).toEqual([])
})

test.each([
  ['a show the offline data lacks', 'https://anime.fkn.app/title/ag:(mal:999)', 'ag:(mal:999)', 'anime'],
  ['a show it holds with a title and no cover', 'https://anime.fkn.app/title/ag:(mal:5)', 'ag:(offline:mal-5)', 'anime'],
  ['a film it holds, on movies, which never asks it', 'https://movies.fkn.app/title/ag:(offline:mal-62312)', 'ag:(offline:mal-62312)', 'movie'],
  ['a show it holds, on series, which never asks it', 'https://series.fkn.app/title/ag:(mal:1)', 'ag:(mal:1)', 'series'],
])('%s is answered by stub\'s sources, from the same copy', async (_, address, uri, site) => {
  const { html } = await call(address)
  expect(asked).toEqual([{ uri, site, wasm: { frizbee: wasmModule, sacha: wasmModule }, deadline: expect.any(Number), settleBy: 20_000 }])
  expect(meta(html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(createPreview).toHaveBeenCalledTimes(1)
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
  vi.useFakeTimers({ toFake: ['Date'] })
  matching = async () => { vi.setSystemTime(Date.now() + 400) }
  await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(asked[0]!.deadline).toBe(2_100)
})

test('the settled preview is what is kept for a day, and a later crawler gets it with no source asked', async () => {
  createPreview.mockImplementation(() => copy(INTERIM, SETTLED))
  const first = await call('https://anime.fkn.app/title/ag:(anilist:195604)')
  expect(meta(first.html, 'og:title')).toEqual(['Black Clover Second Season'])
  await first.kept
  expect(await kept('anime', 'ag:(anilist:195604)')!.clone().json()).toEqual(SETTLED)
  expect(kept('anime', 'ag:(anilist:195604)')!.headers.get('cache-control')).toBe('max-age=86400')

  const later = await call('https://anime.fkn.app/title/ag:(anilist:195604)', 'TelegramBot (like TwitterBot)')
  expect(meta(later.html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(asked).toHaveLength(1)

  await call('https://stub.fkn.app/title/ag:(anilist:195604)')
  expect(asked).toHaveLength(2)
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
  expect(asked).toHaveLength(1)
})

test('the copy\'s work is handed to waitUntil before the crawler is answered, so a crawler that leaves cannot cut it', async () => {
  const atDeadline = deferred<Preview | undefined>()
  createPreview.mockImplementation(() => copy(atDeadline.promise, new Promise(() => {})))
  const handed: Promise<unknown>[] = []
  const answered = onRequest({
    request: new Request('https://anime.fkn.app/title/ag:(anilist:195604)', { headers: { 'user-agent': DISCORD } }),
    next: async () => new Response(SHELL),
    waitUntil: promise => { handed.push(promise) },
    env: {},
  })
  await vi.waitFor(() => expect(asked).toHaveLength(1))
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
  expect(asked).toHaveLength(1)
  await second.kept
  expect(kept('anime', 'ag:(anilist:2)')).toBeUndefined()

  settles.settle(SETTLED)
  await one.kept
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(asked).toHaveLength(2)
})

test('a crawler answered from the edge cache takes no turn, its preview or its plain card', async () => {
  createPreview.mockImplementationOnce(() => copy(SETTLED)).mockImplementationOnce(() => copy(undefined))
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)')).kept
  await (await call('https://series.fkn.app/title/ag:(tmdb:52762)')).kept
  await call('https://anime.fkn.app/title/ag:(anilist:1)')
  await call('https://series.fkn.app/title/ag:(tmdb:52762)')
  expect(asked).toHaveLength(2)

  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('an edge cache that will not keep the preview still has the run\'s object put, and the turn given back', async () => {
  putting = async () => { throw new Error('put') }
  const { puts, env } = bucket()
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)', DISCORD, 'GET', env)).kept
  expect(cache.size).toBe(0)
  expect(puts.map(({ key }) => key)).toEqual([OBJECT.key])
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test.each([
  ['building the copy throws', () => { throw new Error('the copy failed') }],
  ['its answer throws', () => ({ offlineShow, answer: () => { throw new Error('the answer failed') } })],
  ['its reads reject', () => ({ offlineShow, answer: () => ({ first: Promise.reject(new Error('read')), last: Promise.reject(new Error('read')), inbox: () => Promise.reject(new Error('read')) }) })],
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
  expect(asked).toHaveLength(2)
})

// Mutation: let a failed read reach the crawler's catch.
test('an edge cache that cannot be read runs nothing, and the offline card still answers', async () => {
  matching = async () => { throw new Error('cache') }
  expect(meta((await call(BEBOP)).html, 'og:title')).toEqual(['Cowboy Bebop'])
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:195604)')).html, 'og:title')).toEqual(['Stub Anime'])
  expect(asked).toEqual([])
})

test('with the STUB_SOURCES binding, a run\'s object goes to the inbox once its preview is kept, and the card is the same', async () => {
  createPreview.mockImplementation(() => copy(INTERIM, SETTLED))
  const plain = await call('https://anime.fkn.app/title/ag:(anilist:1)')
  await plain.kept
  const { puts, env } = bucket()
  const kept = await call('https://anime.fkn.app/title/ag:(anilist:2)', DISCORD, 'GET', env)
  expect(kept.html).toBe(plain.html.replace('ag:(anilist:1)', 'ag:(anilist:2)'))
  await kept.kept
  expect(puts).toEqual([{ key: OBJECT.key, value: OBJECT.body, options: { httpMetadata: { contentType: 'application/gzip' } }, cached: expect.arrayContaining(['https://preview.cache/anime/ag:(anilist:2)']) }])
})

test('without the binding the run\'s answers are never read, and the card is the same', async () => {
  createPreview.mockImplementation(() => copy(INTERIM, SETTLED))
  const { html, kept: done } = await call('https://anime.fkn.app/title/ag:(anilist:1)')
  await done
  expect(inboxes).toBe(0)
  expect(meta(html, 'og:title')).toEqual(['Black Clover Second Season'])
  expect(await kept('anime', 'ag:(anilist:1)')!.json()).toEqual(SETTLED)
})

test('a run whose sources answered no media puts nothing, and with no offline card its card is still kept a day', async () => {
  createPreview.mockImplementation(() => copy(SETTLED, SETTLED, null))
  const { puts, env } = bucket()
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)', DISCORD, 'GET', env)).kept
  expect(inboxes).toBe(1)
  expect(puts).toEqual([])
  expect(kept('anime', 'ag:(anilist:1)')!.headers.get('cache-control')).toBe('max-age=86400')
})

// Mutation: let a failed read of the run's answers skip the keep.
test('a run whose answers cannot be read still keeps its card, and puts nothing', async () => {
  createPreview.mockImplementation(() => ({ offlineShow, answer: () => ({ first: Promise.resolve(SETTLED), last: Promise.resolve(SETTLED), inbox: () => Promise.reject(new Error('read')) }) }))
  const { puts, env } = bucket()
  await (await call('https://anime.fkn.app/title/ag:(anilist:1)', DISCORD, 'GET', env)).kept
  expect(await kept('anime', 'ag:(anilist:1)')!.json()).toEqual(SETTLED)
  expect(puts).toEqual([])
})

test.each([
  ['refuses the object', () => Promise.reject(new Error('put'))],
  ['throws as it is called', () => { throw new Error('put') }],
])('a store that %s leaves the card and the kept preview, and gives the turn back', async (_, answer) => {
  createPreview.mockImplementation(() => copy(SETTLED))
  const { puts, env } = bucket(answer as () => Promise<unknown>)
  const { html, response, kept: done } = await call('https://anime.fkn.app/title/ag:(anilist:1)', DISCORD, 'GET', env)
  expect(response.status).toBe(200)
  expect(meta(html, 'og:title')).toEqual(['Black Clover Season 2'])
  await done
  expect(puts).toHaveLength(1)
  expect(await kept('anime', 'ag:(anilist:1)')!.json()).toEqual(SETTLED)
  createPreview.mockImplementation(() => copy(SETTLED, new Promise(() => {})))
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('the crawler is answered while the object is still being put, and the copy holds its turn until it is', async () => {
  const stored = deferred<unknown>()
  createPreview.mockImplementation(() => copy(SETTLED))
  const { puts, env } = bucket(() => stored.promise)
  const one = await call('https://anime.fkn.app/title/ag:(anilist:1)', DISCORD, 'GET', env)
  expect(meta(one.html, 'og:title')).toEqual(['Black Clover Season 2'])
  await vi.waitFor(() => expect(puts).toHaveLength(1))

  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Stub Anime'])
  stored.settle({})
  await one.kept
  expect(meta((await call('https://anime.fkn.app/title/ag:(anilist:2)')).html, 'og:title')).toEqual(['Black Clover Season 2'])
})

test('nothing from the request reaches the copy, the object or its key', async () => {
  const run: Run = { run: 'ag:(anilist:195604)', handles: [], settled: true, fetchedAt: '2026-10-26T14:05:31.000Z', writer: { by: 'stub-preview', stub: '0.0.62', commit: 'bdd2430e' }, regionOf: () => null }
  const rows: AnswerRow[] = [{ key: 'sha-1', seq: 1, uri: 'anilist:195604', origin: 'anilist', kind: 'media', operation: 'MEDIA', selection: ['id'], raw: '{"id":"195604"}' }]
  const object = (await inboxObject(inboxLines(rows, run), run.fetchedAt))!
  createPreview.mockImplementation(() => copy(SETTLED, SETTLED, object))
  const { puts, env } = bucket()
  const requester = {
    'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com) requester-agent',
    'cf-connecting-ip': '203.0.113.71',
    'x-forwarded-for': '198.51.100.23',
    'x-real-ip': '192.0.2.45',
    'cf-ipcountry': 'NZ',
    cookie: 'session=requester-cookie',
    authorization: 'Bearer requester-token',
    'accept-language': 'mi-NZ',
    referer: 'https://requester-referer.example/',
  }
  const pending: Promise<unknown>[] = []
  await onRequest({
    request: new Request('https://anime.fkn.app/title/ag:(anilist:195604)?ref=requester-query', { headers: requester }),
    next: async () => new Response(SHELL),
    waitUntil: promise => { pending.push(promise) },
    env,
  })
  await Promise.all(pending)
  expect(puts).toHaveLength(1)
  const stored = `${puts[0]!.key}\n${gunzipSync(Buffer.from(puts[0]!.value)).toString('utf8')}\n${JSON.stringify(asked)}`
  // control: what the run answered is there
  expect(stored).toContain('"source":"anilist"')
  for (const value of [...Object.values(requester), 'requester', 'NZ', 'mi-NZ', '203.0.113', '198.51.100', '192.0.2']) expect(stored).not.toContain(value)
})

test('the Function runs on title, media and watch addresses and short links alone, so assets and the home never invoke it', () => {
  expect(JSON.parse(readFileSync(resolve(ROOT, 'public/_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/title/*', '/media/*', '/watch/*', '/s/*'], exclude: [] })
})

test('a crawler on a short link gets its address\'s card, kept under the same key, with the short link as its url', async () => {
  const watch = '/watch/ag:(anilist:195604,mal:61967)/ag:(anizip:19444-1)/nyaa:2166874?plugins=https:stub.plugins.banou.dev'
  const address = `https://anime.fkn.app${SHORT_PATH}${shortenPath(watch)}`
  const { html, kept: done } = await call(address)
  await done
  expect(asked.map(({ uri, site }) => ({ uri, site }))).toEqual([{ uri: 'ag:(anilist:195604,mal:61967)', site: 'anime' }])
  expect(meta(html, 'og:title')).toEqual(['Black Clover Season 2'])
  expect(meta(html, 'og:url')).toEqual([address])
  expect(kept('anime', 'ag:(anilist:195604,mal:61967)')).toBeDefined()
})

test('a short link that does not open gets the page untouched', async () => {
  const { html, next } = await call(`https://anime.fkn.app${SHORT_PATH}AAAA`)
  expect(next).toHaveBeenCalledTimes(1)
  expect(html).toBe(SHELL)
  expect(asked).toEqual([])
})
