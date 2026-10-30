// The Offline history workflow's job: AniDB at most once a day, Kitsu only for new shows and open seasons, and a
// publish a reader can never catch half done. Driven against a fake GitHub, AniDB, Kitsu, TVmaze, ANN and AnimeThemes;
// nothing is asked.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync, zstdDecompressSync } from 'node:zlib'
import { expect, test, vi } from 'vite-plus/test'

import { ATTEMPT, anidbSince, anidbTurn, askAnidb, askKitsu, checkpointsOf, github, kitsuRow, parseAnidbTitles, runHistory, runOptions } from '../../../../scripts/offline-history.mjs'
import { decodeHistory } from '../../../../scripts/history-files.mjs'
import * as offlinePick from '../../../../scripts/offline-pick'
import { SECRETS, readStore, rowsOf } from '../../../../scripts/source-store.mjs'
import { STORE_ENV, fakeBucket } from './fake-bucket'
import { FRIEREN_ANILIST, FRIEREN_ANIZIP, FRIEREN_KITSU, frierenRun, inboxEntry } from './fake-inbox'
import { RECORDED_SHOWS, annItem, fakeSources } from './fake-sources'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-10-25T05:41:00Z')
const at = (ms: number) => new Date(ms).toISOString()
const ANIDB = 'https://anidb.net/api/anime-titles.xml.gz'

// Mutations: decode twice; keep other languages; read only one attribute order.
test('AniDB\'s file gives each show its English and Japanese titles in file order, decoded one level as XML is', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<animetitles>
<anime aid="1"><title xml:lang="x-jat" type="main">Seikai no Monshou</title><title type="official" xml:lang="ja">星界の紋章</title><title xml:lang="en" type="syn">Crest of the Stars</title><title type="official" xml:lang="en">Crest of the Stars</title></anime>
<anime aid="9242"><title type="official" xml:lang="ja">ナイン &amp;lt;オリジナル版&amp;gt;</title><title type="syn" xml:lang="en">Nine &#39;Original&#39; &amp; More</title></anime>
<anime aid="3"><title type="main" xml:lang="x-jat">Only Romaji</title></anime>
</animetitles>`
  const { shows, titles } = parseAnidbTitles(xml)
  expect(shows).toBe(3)
  expect(titles.get(1)).toEqual([['official', 'ja', '星界の紋章'], ['syn', 'en', 'Crest of the Stars'], ['official', 'en', 'Crest of the Stars']])
  expect(titles.get(9242)).toEqual([['official', 'ja', 'ナイン &lt;オリジナル版&gt;'], ['syn', 'en', 'Nine \'Original\' & More']])
  expect(titles.has(3)).toBe(false)
})

// Mutations: wait 20 hours; ask when the record is missing; wait on a release that does not exist.
test('AniDB is asked 24 hours after the last attempt at the soonest, and never on a release whose record is lost', () => {
  const attempt = (hoursAgo: number) => ({ attemptedAt: new Date(NOW - hoursAgo * HOUR).toISOString() })
  expect(anidbTurn({ released: true, attempt: attempt(23.99), now: NOW })).toBe('wait')
  expect(anidbTurn({ released: true, attempt: attempt(24), now: NOW })).toBe('ask')
  expect(anidbTurn({ released: true, attempt: undefined, now: NOW })).toBe('record')
  expect(anidbTurn({ released: true, attempt: { outcome: '200' }, now: NOW })).toBe('record')
  expect(anidbTurn({ released: false, attempt: undefined, now: NOW })).toBe('ask')
})

const anidbFile = (shows: number) => gzipSync(`<animetitles>${Array.from({ length: shows }, (_, aid) => `<anime aid="${aid + 1}"><title type="official" xml:lang="en">Show ${aid + 1}</title></anime>`).join('')}</animetitles>`)

// Mutations: retry a refusal; send no If-Modified-Since; accept a short file.
test('AniDB gets one request, with If-Modified-Since and a user agent naming stub, and no retry on any answer', async () => {
  const asked: { url: string, headers: Record<string, string> }[] = []
  const answering = (response: () => Response) => async (url: string, init: RequestInit) => {
    asked.push({ url, headers: init.headers as Record<string, string> })
    return response()
  }
  const big = anidbFile(15_000)
  const ok = await askAnidb({ get: answering(() => new Response(new Uint8Array(big), { headers: { 'last-modified': 'Fri, 23 Oct 2026 04:00:00 GMT' } })), lastModified: 'Thu, 22 Oct 2026 04:00:00 GMT' })
  expect([ok.outcome, ok.titles?.size, ok.lastModified]).toEqual(['200', 15_000, 'Fri, 23 Oct 2026 04:00:00 GMT'])
  expect(asked[0]).toEqual({ url: ANIDB, headers: { 'user-agent': 'stub-offline-history (+https://github.com/banou26/stub)', 'if-modified-since': 'Thu, 22 Oct 2026 04:00:00 GMT' } })
  expect((await askAnidb({ get: answering(() => new Response(null, { status: 304 })) })).outcome).toBe('304')
  expect((await askAnidb({ get: answering(() => new Response('banned', { status: 403 })) })).outcome).toBe('HTTP 403')
  expect((await askAnidb({ get: answering(() => { throw new TypeError('fetch failed') }) })).outcome).toBe('fetch failed')
  expect((await askAnidb({ get: answering(() => new Response(new Uint8Array(anidbFile(10)))) })).outcome).toBe('only 10 shows')
  expect(asked.map(({ url }) => url)).toEqual(Array(5).fill(ANIDB))
})

// Mutations: recompress the file AniDB served; keep a file that came decoded as it came.
test('AniDB\'s file is handed on as served for the source store, and gzipped when it came decoded', async () => {
  const xml = gunzipSync(anidbFile(15_000)).toString('utf8')
  const served = gzipSync(xml, { level: 1 })
  const gzip = await askAnidb({ get: async () => new Response(new Uint8Array(served)) })
  expect([gzip.xml === xml, Buffer.compare(gzip.file, served)]).toEqual([true, 0])
  const decoded = await askAnidb({ get: async () => new Response(xml) })
  expect([decoded.xml === xml, gunzipSync(decoded.file).toString('utf8') === xml]).toEqual([true, true])
})

const kitsuResource = (id: number, status = 'finished') => ({
  id: String(id),
  type: 'anime',
  attributes: { canonicalTitle: `Show ${id}`, status, synopsis: null, userCount: 9, posterImage: { tiny: 't', small: 's', medium: 'm', large: 'l', original: 'o', meta: {} } },
})

// Mutations: drop the synopsis; drop the banner.
test('a Kitsu row keeps the attributes the kitsu source and the checkpoints read, and the image sizes it takes', () => {
  expect(kitsuRow(kitsuResource(5), '2026-10-25T05:41:00.000Z')).toEqual({
    id: '5', fetchedAt: '2026-10-25T05:41:00.000Z', attributes: { canonicalTitle: 'Show 5', status: 'finished', posterImage: { original: 'o', large: 'l', medium: 'm' } },
  })
  const full = { ...kitsuResource(5), attributes: { ...kitsuResource(5).attributes, synopsis: 'Space bounty hunters.', coverImage: { tiny: 't', large: 'l', original: 'o' } } }
  expect(kitsuRow(full, '2026-10-25T05:41:00.000Z').attributes).toMatchObject({ synopsis: 'Space bounty hunters.', coverImage: { original: 'o', large: 'l' } })
})

const kitsuApi = (answers: (number | 'rows')[] = []) => {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    const answer = answers.shift() ?? 'rows'
    if (answer !== 'rows') return new Response('', { status: answer })
    const ids = new URL(url).searchParams.get('filter[id]')!.split(',').map(Number)
    return Response.json({ data: ids.map(id => kitsuResource(id)) })
  }
  return { asked, get }
}

// Mutations: ask more than 20 ids at once; no pause between requests; no back off on a 429.
test('Kitsu is asked 20 ids a request, one at a time with a pause, and a 429 waits before it is asked again', async () => {
  const { asked, get } = kitsuApi([429])
  const waits: number[] = []
  const result = await askKitsu(Array.from({ length: 45 }, (_, index) => index + 1), { get, sleep: async (ms: number) => { waits.push(ms) }, pauseMs: 1_000, backoff: [30_000, 60_000] })
  expect([result.complete, result.rows.length, result.requests]).toEqual([true, 45, 4])
  expect(asked.map(url => new URL(url).searchParams.get('filter[id]')!.split(',').length)).toEqual([20, 20, 20, 5])
  expect(new URL(asked[0]!).searchParams.get('page[limit]')).toBe('20')
  expect(waits).toEqual([30_000, 1_000, 1_000])
})

// Mutations: ask sparse fields; leave out the mappings.
test('Kitsu is asked for whole resources and their mappings, which the source store keeps', async () => {
  const { asked, get } = kitsuApi()
  const { rows } = await askKitsu([1], { get, sleep: async () => {} })
  const params = new URL(asked[0]!).searchParams
  expect([params.get('include'), params.has('fields[anime]')]).toEqual(['mappings', false])
  // the history's row is still only what it keeps
  expect(rows[0]).toEqual(kitsuRow(kitsuResource(1), rows[0].fetchedAt))
})

// Mutations: keep asking after the last back off; back off on a 404.
test('Kitsu answering 5xx past every back off, or a refusal, stops the asking for the run and keeps what came', async () => {
  const ids = Array.from({ length: 40 }, (_, index) => index + 1)
  const busy = await askKitsu(ids, { get: kitsuApi(['rows', 503, 503, 503]).get, sleep: async () => {}, backoff: [1, 2] })
  expect([busy.complete, busy.rows.length, busy.requests, busy.stopped]).toEqual([false, 20, 4, '503'])
  const refused = await askKitsu(ids, { get: kitsuApi([404]).get, sleep: async () => {}, backoff: [1, 2] })
  expect([refused.complete, refused.requests, refused.stopped]).toEqual([false, 1, '404'])
})

const entry = (title: string, ids: { mal?: number, kitsu?: number, anidb?: number }, animeSeason: { year?: number, season?: string }, status = 'FINISHED') => ({
  title,
  type: 'TV',
  picture: '',
  status,
  animeSeason,
  sources: [
    ...ids.mal ? [`https://myanimelist.net/anime/${ids.mal}`] : [],
    ...ids.kitsu ? [`https://kitsu.app/anime/${ids.kitsu}`] : [],
    ...ids.anidb ? [`https://anidb.net/anime/${ids.anidb}`] : [],
  ],
})

const ENTRIES = [
  entry('Closed and finished', { mal: 1, kitsu: 1 }, { year: 2025, season: 'FALL' }),
  entry('One Piece', { mal: 21, kitsu: 12 }, { year: 1999, season: 'FALL' }, 'ONGOING'),
  entry('Finished in the dump, airing on Kitsu', { mal: 3, kitsu: 3 }, { year: 2025, season: 'FALL' }),
  entry('Three seasons back', { mal: 4, kitsu: 4 }, { year: 2026, season: 'WINTER' }),
  entry('No season', { mal: 5, kitsu: 5 }, { year: 2020, season: 'UNDEFINED' }),
  entry('No year', { kitsu: 6 }, {}),
]
const CUT = new Date('2026-10-19T00:00:00Z')

// Mutations: close one season after the cut; carry only the dump's status; reopen a season for an airing show.
test('a season closes four seasons after the cut, and an unfinished show in it is carried rather than holding it open', () => {
  const kitsu = new Map([[3, { id: '3', attributes: { status: 'current' } }], [1, { id: '1', attributes: { status: 'finished' } }]])
  const { checkpoints, open, refresh } = checkpointsOf({ entries: ENTRIES, cut: CUT, tag: '2026-43', kitsu, previous: { '1999-FALL': { closedWith: '2026-30' } } })
  expect(checkpoints).toEqual({
    '1999-FALL': { shows: 1, closedWith: '2026-30' },
    '2025-FALL': { shows: 2, closedWith: '2026-43' },
    '2026-WINTER': { shows: 1 },
    NONE: { shows: 2 },
  })
  expect(open).toEqual(['mal-21', 'mal-3'])
  expect(refresh.sort((a: number, b: number) => a - b)).toEqual([3, 4, 5, 6, 12])
})

/**
 * A fake GitHub release API, AniDB and Kitsu, recording every request to them in order, and the sources only the
 * source store keeps, which record their own.
 */
const world = ({
  release = true,
  assets = {} as Record<string, string | Buffer>,
  anidb = (_init: RequestInit): Response => new Response(null, { status: 304 }),
  failUploads = (_name: string): boolean => false,
  kitsuAnswers = [] as (number | 'rows')[],
  gone = [] as string[],
  sources = fakeSources(),
} = {}) => {
  const log: string[] = []
  const store = new Map<string, { id: number, name: string, bytes: Buffer, created_at: string }>()
  let id = 0
  const put = (name: string, bytes: string | Buffer) => {
    for (const [key, asset] of store) if (asset.name === name) store.delete(key)
    const asset = { id: ++id, name, bytes: Buffer.from(bytes), created_at: new Date(Date.parse('2026-10-20T00:00:00Z') + id * 1000).toISOString() }
    store.set(String(asset.id), asset)
  }
  for (const [name, bytes] of Object.entries(assets)) put(name, bytes)
  let exists = release
  // listed by the release but answering 404, as a stale listing can
  let ghosts = gone.map((name, index) => ({ id: 900 + index, name, created_at: '2026-10-20T00:00:00Z', url: `https://api.github.com/repos/banou26/stub/releases/assets/${900 + index}` }))
  const listed = () => [...[...store.values()].map(({ id, name, created_at }) => ({ id, name, created_at, url: `https://api.github.com/repos/banou26/stub/releases/assets/${id}` })), ...ghosts]
  const kitsu = kitsuApi(kitsuAnswers)
  const get = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === ANIDB) {
      log.push('anidb')
      return anidb(init)
    }
    if (url.startsWith('https://kitsu.io/')) {
      log.push('kitsu')
      return kitsu.get(url)
    }
    if (/^https:\/\/(api\.tvmaze\.com|cdn\.animenewsnetwork\.com|graphql\.animethemes\.moe)\//.test(url)) return sources.get(url, init)
    if (url === 'https://api.github.com/repos/banou26/stub/releases/tags/offline-history') {
      return exists ? Response.json({ id: 1, assets: listed() }) : new Response('{"message":"Not Found"}', { status: 404 })
    }
    if (url === 'https://api.github.com/repos/banou26/stub/releases' && method === 'POST') {
      log.push('create')
      exists = true
      return Response.json({ id: 1, assets: [] })
    }
    const upload = /^https:\/\/uploads\.github\.com\/repos\/banou26\/stub\/releases\/1\/assets\?name=(.+)$/.exec(url)
    if (upload) {
      const name = decodeURIComponent(upload[1]!)
      log.push(`upload ${name}`)
      if (failUploads(name)) return new Response('', { status: 500 })
      put(name, init.body as string | Buffer)
      return Response.json(listed().find(asset => asset.name === name))
    }
    const assetId = /^https:\/\/api\.github\.com\/repos\/banou26\/stub\/releases\/assets\/(\d+)$/.exec(url)?.[1]
    if (assetId && method === 'DELETE') {
      log.push(`delete ${listed().find(asset => String(asset.id) === assetId)?.name}`)
      store.delete(assetId)
      ghosts = ghosts.filter(ghost => String(ghost.id) !== assetId)
      return new Response(null, { status: 204 })
    }
    if (assetId) return store.has(assetId) ? new Response(new Uint8Array(store.get(assetId)!.bytes)) : new Response('', { status: 404 })
    throw new Error(`the fake world has no ${method} ${url}`)
  }
  const named = (name: string) => [...store.values()].find(asset => asset.name === name)?.bytes
  const kitsuIds = () => kitsu.asked.flatMap(url => new URL(url).searchParams.get('filter[id]')!.split(',').map(Number)).sort((a, b) => a - b)
  const kitsuOrder = () => kitsu.asked.flatMap(url => new URL(url).searchParams.get('filter[id]')!.split(',').map(Number))
  return { log, get, named, kitsuIds, kitsuOrder, sources, names: () => [...store.values()].map(asset => asset.name).sort() }
}

const dumpOf = (tag: string, entries = ENTRIES) => async () => ({ tag, meta: { lastUpdate: '2026-10-19' }, entries, sha256: `sha-of-${tag}` })

const run = (w: ReturnType<typeof world>, tag = '2026-43', now = NOW) =>
  runHistory({ token: 't', get: w.get, dump: dumpOf(tag), now: () => now, sleep: async () => {}, pauseMs: 0, backoff: [] })

/** A published history, as a first run from scratch leaves it, with its attempt record `hoursAgo` old. */
const published = async (hoursAgo: number) => {
  const first = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000)), { headers: { 'last-modified': 'Mon, 19 Oct 2026 04:00:00 GMT' } }) })
  await run(first, '2026-43', NOW - hoursAgo * HOUR)
  return Object.fromEntries(first.names().map(name => [name, first.named(name)!]))
}

// Mutations: start over on any failure to read the release; publish manifest.json before the assets it names.
test('from scratch, only on a 404: the release is made, the attempt recorded before AniDB is asked, the assets go up before the manifest', async () => {
  const w = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))) })
  await run(w)
  const uploads = w.log.filter(line => line.startsWith('upload')).map(line => line.replace(/-[0-9a-f]{16}\./, '-<sha>.'))
  expect(w.log.slice(0, 3)).toEqual(['create', `upload ${ATTEMPT}`, 'anidb'])
  expect(uploads).toEqual([`upload ${ATTEMPT}`, `upload ${ATTEMPT}`, 'upload anidb-titles-<sha>.json.zst', 'upload kitsu-<sha>.jsonl.zst', 'upload previews-<sha>.jsonl.zst', 'upload manifest-<sha>.json', 'upload manifest.json'])
  const history = decodeHistory({ manifest: w.named('manifest.json')!.toString(), assets: Object.fromEntries(w.names().map(name => [name, w.named(name)!])) })
  expect([history.anidb.titles.size, history.kitsu.size, history.manifest.kitsu.refreshedFor]).toEqual([15_000, 6, '2026-43'])
  expect(JSON.parse(w.named(ATTEMPT)!.toString())).toMatchObject({ attemptedAt: '2026-10-25T05:41:00.000Z', outcome: '200' })

  const outage = world({ release: false })
  const failing = { ...outage, get: async (url: string, init?: RequestInit) => (url.endsWith('/releases/tags/offline-history') ? new Response('', { status: 502 }) : outage.get(url, init)) }
  await expect(run(failing as typeof outage)).rejects.toThrow(/answered HTTP 502/)
  expect(outage.log).toEqual([])
})

// Mutation: publish on every run.
test('a run under 24 hours after the last attempt, on the same dump, asks nothing and publishes nothing', async () => {
  const w = world({ assets: await published(2) })
  await run(w)
  expect(w.log).toEqual([])
})

// Mutation: ask AniDB before recording the attempt.
test('a day later AniDB is asked once, after the attempt is recorded, and a 304 publishes nothing else', async () => {
  const w = world({ assets: await published(25) })
  await run(w)
  expect(w.log).toEqual([`delete ${ATTEMPT}`, `upload ${ATTEMPT}`, 'anidb', `delete ${ATTEMPT}`, `upload ${ATTEMPT}`])
  expect(JSON.parse(w.named(ATTEMPT)!.toString())).toMatchObject({ attemptedAt: '2026-10-25T05:41:00.000Z', outcome: '304' })
})

// Mutation: ask AniDB when the record could not be written.
test('when the attempt cannot be recorded, AniDB is not asked', async () => {
  const w = world({ assets: await published(25), failUploads: () => true })
  await run(w)
  expect(w.log).not.toContain('anidb')
})

// Mutation: ask AniDB when the release holds no record.
test('a release that lost its attempt record writes one and asks AniDB nothing that run', async () => {
  const { [ATTEMPT]: _, ...assets } = await published(25)
  const w = world({ assets })
  await run(w)
  expect(w.log).toEqual([`upload ${ATTEMPT}`])
  expect(JSON.parse(w.named(ATTEMPT)!.toString()).attemptedAt).toBe('2026-10-25T05:41:00.000Z')
})

// Mutations: read a record that does not parse as an old one; read one that answers 404 as an old one.
test('an attempt record that cannot be read is written anew, and AniDB is asked nothing that run', async () => {
  const broken = world({ assets: { ...await published(25), [ATTEMPT]: 'not json' } })
  await run(broken)
  expect(broken.log).toEqual([`delete ${ATTEMPT}`, `upload ${ATTEMPT}`])
  expect(JSON.parse(broken.named(ATTEMPT)!.toString()).attemptedAt).toBe('2026-10-25T05:41:00.000Z')

  const { [ATTEMPT]: _, ...assets } = await published(25)
  const missing = world({ assets, gone: [ATTEMPT] })
  await run(missing)
  expect(missing.log).toEqual([`delete ${ATTEMPT}`, `upload ${ATTEMPT}`])
})

// Mutation: send If-Modified-Since from the attempt record, which a failed publish leaves ahead of the history.
test('If-Modified-Since is the published titles\' date, so a 200 whose publish failed is asked for again', async () => {
  const sent: (string | undefined)[] = []
  const anidb = (init: RequestInit) => {
    sent.push((init.headers as Record<string, string>)['if-modified-since'])
    return new Response(new Uint8Array(anidbFile(15_001)), { headers: { 'last-modified': 'Sat, 24 Oct 2026 04:00:00 GMT' } })
  }
  const w = world({ assets: await published(25), anidb, failUploads: name => name.startsWith('anidb-titles-') })
  await expect(run(w)).rejects.toThrow(/answered HTTP 500/)
  const retry = world({ assets: Object.fromEntries(w.names().map(name => [name, w.named(name)!])), anidb })
  await run(retry, '2026-43', NOW + 25 * HOUR)
  expect(sent).toEqual(['Mon, 19 Oct 2026 04:00:00 GMT', 'Mon, 19 Oct 2026 04:00:00 GMT'])
  const history = decodeHistory({ manifest: retry.named('manifest.json')!.toString(), assets: Object.fromEntries(retry.names().map(name => [name, retry.named(name)!])) })
  expect([history.anidb.titles.size, history.anidb.lastModified]).toEqual([15_001, 'Sat, 24 Oct 2026 04:00:00 GMT'])
})

// Mutation: read a release with no finished publish as one that does not exist.
test('a release a run from scratch left with only its attempt record starts over, without asking AniDB again that day', async () => {
  const { [ATTEMPT]: attempt } = await published(2)
  const w = world({ assets: { [ATTEMPT]: attempt! } })
  await run(w)
  expect(w.log).not.toContain('anidb')
  expect(w.kitsuIds()).toEqual([1, 3, 4, 5, 6, 12])
})

// Mutations: start over when manifest.json is missing; restore from the oldest copy.
test('a manifest.json a failed publish left missing is restored from its newest copy, and nothing starts over', async () => {
  const { 'manifest.json': manifest, ...assets } = await published(2)
  const w = world({ assets: { 'manifest-0000000000000000.json': '{"stale": true}', ...assets } })
  await run(w)
  expect(w.log).toEqual(['upload manifest.json'])
  expect(w.named('manifest.json')!.toString()).toBe(manifest!.toString())
})

// Mutations: ask Kitsu again for every show on a new dump; keep every asset forever.
test('a new dump asks Kitsu for new shows and open seasons only, and removes what no manifest names any more', async () => {
  const before = await published(2)
  const w = world({ assets: before })
  const dump = [...ENTRIES, entry('New this week', { mal: 7, kitsu: 77 }, { year: 2026, season: 'FALL' })]
  await runHistory({ token: 't', get: w.get, dump: dumpOf('2026-44', dump), now: () => NOW, sleep: async () => {}, pauseMs: 0, backoff: [] })
  // the new show, the open seasons' three and One Piece, carried, in one request: here Kitsu calls the rest finished
  expect(w.log.filter(line => line === 'kitsu')).toHaveLength(1)
  expect(w.kitsuIds()).toEqual([4, 5, 6, 12, 77])
  // the new show first, so a run Kitsu cuts short has asked it before refreshing what the history already holds
  expect(w.kitsuOrder()[0]).toBe(77)
  const manifest = JSON.parse(w.named('manifest.json')!.toString())
  expect([manifest.dump.tag, manifest.kitsu.refreshedFor]).toEqual(['2026-44', '2026-44'])
  const first = Object.keys(before).find(name => name.startsWith('kitsu-'))!
  // the previous manifest still names it, and a reader may be holding that one
  expect(w.names()).toContain(first)

  const third = [...dump, entry('Another', { mal: 8, kitsu: 88 }, { year: 2026, season: 'FALL' })]
  await runHistory({ token: 't', get: w.get, dump: dumpOf('2026-45', third), now: () => NOW, sleep: async () => {}, pauseMs: 0, backoff: [] })
  expect(w.names()).not.toContain(first)
  expect(w.names().filter(name => name.startsWith('kitsu-'))).toHaveLength(2)
  expect(w.names().filter(name => name.startsWith('manifest-'))).toHaveLength(2)
})

// Mutation: mark the refresh done when Kitsu stopped it.
test('a Kitsu refresh cut short leaves the history refreshed for the old dump, and the next run asks the rest', async () => {
  const dump = [...ENTRIES, entry('New this week', { mal: 7, kitsu: 77 }, { year: 2026, season: 'FALL' })]
  const cut = world({ assets: await published(2), kitsuAnswers: [503] })
  await runHistory({ token: 't', get: cut.get, dump: dumpOf('2026-44', dump), now: () => NOW, sleep: async () => {}, pauseMs: 0, backoff: [] })
  const stopped = JSON.parse(cut.named('manifest.json')!.toString())
  expect([stopped.dump.tag, stopped.kitsu.refreshedFor]).toEqual(['2026-44', '2026-43'])

  const next = world({ assets: Object.fromEntries(cut.names().map(name => [name, cut.named(name)!])) })
  await runHistory({ token: 't', get: next.get, dump: dumpOf('2026-44', dump), now: () => NOW, sleep: async () => {}, pauseMs: 0, backoff: [] })
  expect(next.kitsuIds()).toEqual([4, 5, 6, 12, 77])
  expect(JSON.parse(next.named('manifest.json')!.toString()).kitsu.refreshedFor).toBe('2026-44')
})

const WRITER = { by: 'offline-history', run: '42', stub: '0.0.62', commit: '0dcc4455' }
const keeping = (w: ReturnType<typeof world>, bucket: ReturnType<typeof fakeBucket>, tag = '2026-43', now = NOW) =>
  runHistory({ token: 't', get: w.get, dump: dumpOf(tag), now: () => now, sleep: async () => {}, pauseMs: 0, backoff: [], store: bucket.client, writer: WRITER })
const assetsOf = (w: ReturnType<typeof world>) => Object.fromEntries(w.names().map(name => [name, w.named(name)!]))
const historyOf = (w: ReturnType<typeof world>) => decodeHistory({ manifest: w.named('manifest.json')!.toString(), assets: assetsOf(w) })
const unsha = (lines: string[]) => lines.map(line => line.replace(/-[0-9a-f]{16}\./, '-<sha>.'))
// the run's own log lines, `::warning::` ones included
const logged = async (work: () => Promise<unknown>) => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await work()
    return spy.mock.calls.map(args => args.join(' '))
  } finally {
    spy.mockRestore()
  }
}
const lacking = (count: number) => `::warning::[offline-history] the source store lacks the ${count} Kitsu answers this run asked, and only open seasons and unfinished shows are asked again`

const wholeReport = (sources: ReturnType<typeof fakeSources>) => {
  for (let id = 1; sources.titles.length < 10_000; id++) sources.titles.push(annItem(id))
  return sources
}
const bySource = (index: Map<string, { source: string }>) => [...index.values()].reduce<Record<string, number>>((counts, line) => ({ ...counts, [line.source]: (counts[line.source] ?? 0) + 1 }), {})

// Mutations: publish nothing when a store is given; ask the store's own sources with no store; keep AniDB's file and
// Kitsu's answers only after the three are asked.
test('with the source store, the release gets what it gets without one, and the store dates every show asked', async () => {
  const anidb = () => new Response(new Uint8Array(anidbFile(15_000)), { headers: { 'last-modified': 'Mon, 19 Oct 2026 04:00:00 GMT' } })
  const plain = world({ release: false, anidb, sources: wholeReport(fakeSources()) })
  const without = await logged(() => run(plain))
  const bucket = fakeBucket()
  const sources = wholeReport(fakeSources())
  // what the store held when the first of the three was asked, which takes up to 20 minutes
  let heldFirst: string[] | undefined
  const watched = { ...sources, get: async (url: string, init?: RequestInit) => {
    heldFirst ??= Object.keys(JSON.parse(bucket.objects.get('manifest.json')?.toString() ?? '{"job":{}}').job)
    return sources.get(url, init)
  } }
  const kept = world({ release: false, anidb, sources: watched })
  const lines = await logged(() => keeping(kept, bucket))
  expect(heldFirst).toEqual(['anidb-titles', 'kitsu'])
  // control: both runs asked Kitsu, so each had answers a warning could have counted
  expect([plain.kitsuIds().length, kept.kitsuIds().length]).toEqual([6, 6])
  expect([...without, ...lines].filter(line => line.startsWith('::warning::'))).toEqual([])
  expect(unsha(kept.log)).toEqual(unsha(plain.log))
  expect(historyOf(kept).anidb.titles).toEqual(historyOf(plain).anidb.titles)
  expect([...historyOf(kept).kitsu.keys()]).toEqual([...historyOf(plain).kitsu.keys()])
  // the three sources only the store keeps, asked for it alone, each with its first ask
  expect(plain.sources.asked).toEqual([])
  expect(kept.sources.asked).toEqual(['tvmaze /shows?page=0', 'tvmaze /shows?page=1', 'ann /encyclopedia/reports.xml?id=155&type=anime&nlist=all', 'animethemes / page 1'])
  const { manifest, index } = await readStore(bucket.client)
  expect(bySource(index)).toEqual({ 'anidb-titles': 15_000, kitsu: 6, tvmaze: 2, ann: 10_000, animethemes: 2 })
  expect(new Set([...index.values()].map(line => JSON.stringify(line.writer)))).toEqual(new Set([JSON.stringify(WRITER)]))
  expect(manifest.job['anidb-titles'].lastModified).toBe('Mon, 19 Oct 2026 04:00:00 GMT')
})

// Mutations: let a source that throws end the others; let it fail the run.
test('a source that fails is skipped with a warning, and the others, the release and the store are kept', async () => {
  const sources = wholeReport(fakeSources())
  const broken = { ...sources, get: async (url: string, init?: RequestInit) => (url.startsWith('https://api.tvmaze.com/') ? new Response('<html>Bad gateway</html>') : sources.get(url, init)) }
  const w = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))), sources: broken })
  const bucket = fakeBucket()
  const lines = await logged(() => keeping(w, bucket))
  expect(lines.filter(line => line.startsWith('::warning::'))).toEqual([expect.stringMatching(/^::warning::\[offline-history\] tvmaze is skipped this run: .*JSON/)])
  expect(historyOf(w).anidb.titles.size).toBe(15_000)
  const { manifest, index } = await readStore(bucket.client)
  expect(manifest.job.tvmaze).toBeUndefined()
  expect(bySource(index)).toEqual({ 'anidb-titles': 15_000, kitsu: 6, ann: 10_000, animethemes: 2 })
})

// Mutations: fail the run when a source is stopped; stop the other sources with it; keep the stopped source's entry.
test('a source a 429 stops after its waits is not kept that run, the others are, and the next run asks it again', async () => {
  const sources = wholeReport(fakeSources())
  sources.refusing(line => (line.startsWith('ann ') ? 429 : undefined))
  const bucket = fakeBucket()
  const waits: number[] = []
  const first = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))), sources })
  await runHistory({ token: 't', get: first.get, dump: dumpOf('2026-43'), now: () => NOW, sleep: async (ms: number) => { waits.push(ms) }, pauseMs: 0, backoff: [30_000, 60_000], store: bucket.client, writer: WRITER })
  expect(sources.asked.filter(line => line.startsWith('ann '))).toHaveLength(3)
  expect(waits.filter(ms => ms >= 30_000)).toEqual([30_000, 60_000])
  expect(first.names()).toContain('manifest.json')
  const stopped = await readStore(bucket.client)
  expect(Object.keys(stopped.manifest.job).sort()).toEqual(['anidb-titles', 'animethemes', 'kitsu', 'tvmaze'])

  sources.refusing(() => undefined)
  sources.asked.length = 0
  await keeping(world({ assets: assetsOf(first), sources }), bucket, '2026-43', NOW + HOUR)
  expect(sources.asked).toEqual(['ann /encyclopedia/reports.xml?id=155&type=anime&nlist=all'])
  expect((await readStore(bucket.client)).manifest.job.ann).toMatchObject({ rows: 10_000, askedAt: '2026-10-25T06:41:00.000Z' })
})

// Mutations: compare TVmaze's updates with no stored shows, or with another source's rows; read the stored shows twice;
// keep the shows asked without the ones the store held.
test('TVmaze\'s updates are compared with the shows the store holds, read once, and kept beside them', async () => {
  const bucket = fakeBucket()
  const sources = wholeReport(fakeSources())
  // in the week's updates on both days, unchanged
  sources.shows.set(1, { ...RECORDED_SHOWS[0]!, updated: Math.floor((NOW - HOUR) / 1000) })
  const first = world({ assets: await published(25), sources })
  await keeping(first, bucket)
  const held = (await readStore(bucket.client)).manifest.job.tvmaze
  expect(held).toMatchObject({ rows: 2, nextPage: null })
  sources.asked.length = 0
  bucket.log.length = 0

  sources.shows.set(2, { ...RECORDED_SHOWS[1]!, updated: Math.floor((NOW + 12 * HOUR) / 1000) })
  await keeping(world({ assets: assetsOf(first), sources }), bucket, '2026-43', NOW + DAY)
  expect(sources.asked.filter(line => line.startsWith('tvmaze '))).toEqual(['tvmaze /updates/shows?since=week', 'tvmaze /shows/2'])
  expect(bucket.log.filter(line => line === `GET ${held.name}`)).toHaveLength(1)
  const { manifest } = await readStore(bucket.client)
  const shows = await rowsOf(bucket.client, manifest.job.tvmaze)
  expect([[...shows.keys()], JSON.parse(shows.get('2')!.body).updated, manifest.job.tvmaze.askedAt]).toEqual([['1', '2'], Math.floor((NOW + 12 * HOUR) / 1000), at(NOW + DAY)])
})

// Mutations: keep the three in the write that keeps AniDB and Kitsu; read a pulled source's file in the write that
// keeps the three.
test('a source whose stored file cannot be read is skipped with a warning, and Kitsu\'s answers and the others are kept', async () => {
  const bucket = fakeBucket()
  const sources = wholeReport(fakeSources())
  const first = world({ assets: await published(25), sources })
  await keeping(first, bucket)
  const before = await readStore(bucket.client)
  bucket.objects.delete(before.manifest.job.ann.name)
  // control: the store still reads, since only its manifest and index are read whole
  expect((await readStore(bucket.client)).manifest).toEqual(before.manifest)

  // a new dump, so Kitsu is asked again: the open seasons' three and One Piece, carried
  const next = world({ assets: assetsOf(first), sources })
  const lines = await logged(() => keeping(next, bucket, '2026-44', NOW + DAY))
  expect(next.kitsuIds()).toEqual([4, 5, 6, 12])
  expect(unsha(lines.filter(line => line.startsWith('::warning::')))).toEqual(['::warning::[offline-history] ann is skipped this run: the source store is unreadable: job/ann-<sha>.jsonl.zst is missing'])
  const { manifest, index } = await readStore(bucket.client)
  expect([...index.values()].filter(line => line.source === 'kitsu').map(line => line.id)).toEqual(['4', '5', '6', '12'])
  expect([manifest.job.tvmaze.askedAt, manifest.job.ann]).toEqual([at(NOW + DAY), before.manifest.job.ann])
})

// Mutations: send the newer copy's date; send a date when a copy has none.
test('If-Modified-Since is the older copy\'s date, and none when either copy has none', () => {
  expect(anidbSince(['Sat, 24 Oct 2026 04:00:00 GMT', 'Mon, 19 Oct 2026 04:00:00 GMT'])).toBe('Mon, 19 Oct 2026 04:00:00 GMT')
  expect(anidbSince(['Mon, 19 Oct 2026 04:00:00 GMT', 'Sat, 24 Oct 2026 04:00:00 GMT'])).toBe('Mon, 19 Oct 2026 04:00:00 GMT')
  // a release started over, beside a store that holds the file
  expect(anidbSince([null, 'Sat, 24 Oct 2026 04:00:00 GMT'])).toBeUndefined()
  expect(anidbSince(['Sat, 24 Oct 2026 04:00:00 GMT', undefined])).toBeUndefined()
  expect(anidbSince(['Sat, 24 Oct 2026 04:00:00 GMT'])).toBe('Sat, 24 Oct 2026 04:00:00 GMT')
})

// Mutation: send the release's date while the store holds no file.
test('a store with no AniDB file is sent no If-Modified-Since, so it gets the whole file, and then both copies\' date', async () => {
  const sent: (string | undefined)[] = []
  const anidb = (init: RequestInit) => {
    sent.push((init.headers as Record<string, string>)['if-modified-since'])
    return new Response(new Uint8Array(anidbFile(15_000)), { headers: { 'last-modified': 'Sat, 24 Oct 2026 04:00:00 GMT' } })
  }
  const bucket = fakeBucket()
  const first = world({ assets: await published(25), anidb })
  await keeping(first, bucket)
  await keeping(world({ assets: assetsOf(first), anidb }), bucket, '2026-43', NOW + 25 * HOUR)
  expect(sent).toEqual([undefined, 'Sat, 24 Oct 2026 04:00:00 GMT'])
  expect((await readStore(bucket.client)).manifest.job['anidb-titles']).toMatchObject({ rows: 15_000, lastModified: 'Sat, 24 Oct 2026 04:00:00 GMT' })
})

// Mutations: let a store write failure fail the run; say nothing of the Kitsu answers it lost.
test('a store that cannot be written leaves the release published and the run green, and counts the Kitsu answers it lacks', async () => {
  const w = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))) })
  const bucket = fakeBucket({ fail: method => method === 'PUT' })
  const lines = await logged(() => keeping(w, bucket))
  expect(unsha(lines.filter(line => line.startsWith('::warning::')))).toEqual([
    '::warning::[offline-history] the source store was not written: PUT job/anidb-titles-<sha>.xml.gz answered HTTP 500',
    lacking(6),
    '::warning::[offline-history] TVmaze, ANN and AnimeThemes were not kept this run: PUT job/tvmaze-<sha>.jsonl.zst answered HTTP 500',
  ])
  expect(w.names()).toContain('manifest.json')
  expect(historyOf(w).anidb.titles.size).toBe(15_000)
  // control: the store was written to, and refused it
  expect(bucket.log.some(line => line.startsWith('PUT '))).toBe(true)
  expect(bucket.objects.size).toBe(0)
})

// Mutations: let a store read failure fail the run; read a store that answered 500 as an empty one; say nothing of
// the Kitsu answers it lost; ask the three when the store could not be read.
test('a store that cannot be read is skipped for the run: AniDB gets the release\'s date and the store nothing', async () => {
  const sent: (string | undefined)[] = []
  const anidb = (init: RequestInit) => {
    sent.push((init.headers as Record<string, string>)['if-modified-since'])
    return new Response(null, { status: 304 })
  }
  const bucket = fakeBucket({ fail: method => method === 'GET' })
  const w = world({ assets: await published(25), anidb })
  const lines = await logged(() => keeping(w, bucket, '2026-44'))
  expect(sent).toEqual(['Mon, 19 Oct 2026 04:00:00 GMT'])
  expect(bucket.log).toEqual(['GET manifest.json'])
  // a new dump, so Kitsu was asked again: the open seasons' three and One Piece, carried
  expect(w.kitsuIds()).toEqual([4, 5, 6, 12])
  expect(lines.filter(line => line.startsWith('::warning::'))).toEqual(['::warning::[offline-history] the source store is skipped this run: GET manifest.json answered HTTP 500', lacking(4)])
  expect(w.sources.asked).toEqual([])
})

// Mutations: remove the folded objects before manifest.json names what they held; leave them; remove one that is no
// preview's, or say nothing of it; publish a restricted source's answer or anizip's images.
test('a run folds the previews\' inbox: every answer into the store, anizip\'s titles and Kitsu\'s fields into the release, then removes it', async () => {
  const bucket = fakeBucket()
  const [key, bytes] = await inboxEntry(frierenRun(at(NOW - HOUR)))
  bucket.objects.set(key, bytes)
  const stray = 'inbox/2026-10-25/stray.jsonl.gz'
  bucket.objects.set(stray, Buffer.from('not gzip'))
  const w = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))), sources: wholeReport(fakeSources()) })
  const lines = await logged(() => keeping(w, bucket))
  expect(lines.filter(line => line.startsWith('::warning::'))).toEqual([`::warning::[offline-history] ${stray} is no inbox object, left in the store`])

  const { previews } = historyOf(w)
  expect([...previews.keys()]).toEqual(['anizip:17617', 'kitsu:46474', 'kitsu:49240'])
  expect(previews.get('anizip:17617')).toEqual({ source: 'anizip', id: '17617', class: 'full', fetchedAt: at(NOW - HOUR), media: { titles: FRIEREN_ANIZIP.titles } })
  const { id: _, status: __, ...fields } = FRIEREN_KITSU
  expect(previews.get('kitsu:46474')!.media).toEqual(fields)
  const released = w.names().filter(name => name.startsWith('previews-')).map(name => zstdDecompressSync(w.named(name)!).toString()).join('')
  const kept = await readStore(bucket.client)
  const store = Object.values(kept.manifest.answers as Record<string, { name: string }>).map(({ name }) => zstdDecompressSync(bucket.objects.get(name)!).toString()).join('')
  for (const text of ['artworks.thetvdb.com', FRIEREN_ANILIST.descriptions[0]!.description, '81726714', '364792-373583']) {
    // control: the store keeps it
    expect(store).toContain(text)
    expect(released).not.toContain(text)
  }
  expect(Object.keys(kept.manifest.answers).sort()).toEqual(['anilist', 'anizip', 'jw', 'kitsu', 'nf'])

  const order = bucket.log.filter(line => /^(PUT manifest\.json|DELETE inbox\/)/.test(line))
  expect(order.slice(0, 2)).toEqual(['PUT manifest.json', `DELETE ${key}`])
  expect([...bucket.objects.keys()].filter(name => name.startsWith('inbox/'))).toEqual([stray])
})

// Mutations: remove the folded objects when the store was not written; publish the same fold again as a change.
test('an inbox the store did not keep stays for the next run, whose fold of it changes nothing in the release', async () => {
  let refusing = true
  const bucket = fakeBucket({ fail: method => refusing && method === 'PUT' })
  const [key, bytes] = await inboxEntry(frierenRun(at(NOW - HOUR)))
  bucket.objects.set(key, bytes)
  const first = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))), sources: wholeReport(fakeSources()) })
  await logged(() => keeping(first, bucket))
  expect([...historyOf(first).previews.keys()]).toEqual(['anizip:17617', 'kitsu:46474', 'kitsu:49240'])
  expect(bucket.objects.has(key)).toBe(true)

  refusing = false
  const next = world({ assets: assetsOf(first), sources: first.sources })
  await logged(() => keeping(next, bucket, '2026-43', NOW + DAY))
  // control: the run did ask AniDB, which answered 304, and kept the store
  expect(next.log).toContain('anidb')
  expect(next.log.filter(line => line.startsWith('upload'))).toEqual([`upload ${ATTEMPT}`, `upload ${ATTEMPT}`])
  expect(Object.keys((await readStore(bucket.client)).manifest.answers).sort()).toEqual(['anilist', 'anizip', 'jw', 'kitsu', 'nf'])
  expect(bucket.objects.has(key)).toBe(false)
})

// Mutations: write manifest.json again when nothing was asked; ask TVmaze or ANN again the same UTC day.
test('a rerun the same day asks nothing and writes nothing to the store', async () => {
  const bucket = fakeBucket()
  const sources = wholeReport(fakeSources())
  const first = world({ assets: await published(25), anidb: () => new Response(new Uint8Array(anidbFile(15_000))), sources })
  await keeping(first, bucket)
  // control: the first run asked each of the three
  expect(new Set(sources.asked.map(line => line.split(' ')[0]))).toEqual(new Set(['tvmaze', 'ann', 'animethemes']))
  const objects = new Map(bucket.objects)
  bucket.log.length = 0
  sources.asked.length = 0
  const rerun = world({ assets: assetsOf(first), sources })
  await keeping(rerun, bucket, '2026-43', NOW + HOUR)
  expect([rerun.log, sources.asked]).toEqual([[], []])
  expect(bucket.log.filter(line => !/^(GET|LIST) /.test(line))).toEqual([])
  expect(bucket.objects).toEqual(objects)
})

const MERGE = async () => ({ module: offlinePick, version: 'merge-1' })
const merging = (w: ReturnType<typeof world>, bucket: ReturnType<typeof fakeBucket>, { merge = MERGE, tag = '2026-43', now = NOW, entries = ENTRIES } = {}) =>
  runHistory({ token: 't', get: w.get, dump: dumpOf(tag, entries), now: () => now, sleep: async () => {}, pauseMs: 0, backoff: [], store: bucket.client, writer: WRITER, merge })
const firstRun = async (bucket = fakeBucket(), merge = MERGE) => {
  const w = world({ release: false })
  await logged(() => merging(w, bucket, { merge }))
  return { w, bucket, sources: w.sources }
}
const picksOf = (w: ReturnType<typeof world>) => JSON.parse(w.named('manifest.json')!.toString()).assets.picks

// Mutations: run the merge before the store's sources are kept; publish no second manifest; publish the manifest first.
test('once the store is kept the job publishes stub\'s merge as picks, stamped with the merge and the dump, the manifest last', async () => {
  const bucket = fakeBucket()
  let held: string[] | undefined
  const { w } = await firstRun(bucket, async () => {
    held = Object.keys(JSON.parse(bucket.objects.get('manifest.json')!.toString()).job)
    return MERGE()
  })
  expect(held).toEqual(['kitsu', 'tvmaze', 'animethemes'])
  expect(picksOf(w)).toMatchObject({ name: expect.stringMatching(/^picks-/), rows: 6, merge: 'merge-1', dump: { tag: '2026-43', sha256: 'sha-of-2026-43' } })
  const { picks } = historyOf(w)
  expect(picks!.size).toBe(6)
  expect(picks!.get('mal-21')).toEqual({ t: 'Show 12', p: 'o' })
  expect(unsha(w.log.filter(line => line.startsWith('upload'))).slice(-3)).toEqual(['upload picks-<sha>.jsonl.zst', 'upload manifest-<sha>.json', 'upload manifest.json'])
})

// Mutation: publish on every run.
test('a rerun with the same merge and the same data publishes nothing', async () => {
  const { w, bucket, sources } = await firstRun()
  const rerun = world({ assets: assetsOf(w), sources })
  const lines = await logged(() => merging(rerun, bucket, { now: NOW + HOUR }))
  expect(rerun.log).toEqual([])
  expect(lines).toContain('[offline-history] the picks did not change, nothing published')
})

// Mutations: compare the picks' bytes alone, so a new version never reaches the manifest; upload the same bytes again.
test('a new merge version with the same picks publishes the new stamp and no new file', async () => {
  const { w, bucket, sources } = await firstRun()
  const before = picksOf(w)
  const next = world({ assets: assetsOf(w), sources })
  await logged(() => merging(next, bucket, { merge: async () => ({ module: offlinePick, version: 'merge-2' }), now: NOW + HOUR }))
  expect(picksOf(next)).toEqual({ ...before, merge: 'merge-2' })
  expect(unsha(next.log.filter(line => line.startsWith('upload')))).toEqual(['upload manifest-<sha>.json', 'upload manifest.json'])
})

const FRIEREN_ENTRY = { ...entry('Sousou no Frieren', { mal: 52991, kitsu: 46474, anidb: 17617 }, { year: 2023, season: 'FALL' }), sources: ['https://myanimelist.net/anime/52991', 'https://anilist.co/anime/154587', 'https://kitsu.app/anime/46474', 'https://anidb.net/anime/17617'] }

// Mutations: merge what the store held before this run's fold; publish a field the merge did not choose; read anizip's
// images; let a related answer decide a value.
test('a run\'s picks carry what the store keeps of every source, the inbox it folded included, and nothing but the winning values', async () => {
  const bucket = fakeBucket()
  const inbox = await inboxEntry(frierenRun(at(NOW - HOUR)))
  bucket.objects.set(...inbox)
  const w = world({ release: false })
  const lines = await logged(() => merging(w, bucket, { entries: [...ENTRIES, FRIEREN_ENTRY] }))
  expect(lines.filter(line => line.startsWith('::warning::'))).toEqual([])
  // the cover is Kitsu's row, which this run asked after the preview's answer
  expect(historyOf(w).picks!.get('mal-52991')).toEqual({ t: FRIEREN_ANILIST.titles[0]!.title, p: 'o', d: FRIEREN_ANILIST.descriptions[0]!.description })
  const released = zstdDecompressSync(w.named(picksOf(w).name)!).toString()
  for (const text of ['artworks.thetvdb.com', '81726714', 'ag:(', 'stub-preview', '8ad2135c', 'writer']) expect(released).not.toContain(text)
  expect(lines).toContain(`[offline-history] the picks: 7 of 7 shows, 1 of them with some of the store's 6 answers, merge merge-1`)
})

// Mutation: leave the store's answers out of the second run's merge.
test('what the store kept from an earlier run stays in the picks of a run with an empty inbox', async () => {
  const bucket = fakeBucket()
  bucket.objects.set(...await inboxEntry(frierenRun(at(NOW - HOUR))))
  const entries = [...ENTRIES, FRIEREN_ENTRY]
  const first = world({ release: false })
  await logged(() => merging(first, bucket, { entries }))
  const next = world({ assets: assetsOf(first), sources: first.sources })
  await logged(() => merging(next, bucket, { entries, now: NOW + HOUR }))
  expect(next.log).toEqual([])
  expect(historyOf(next).picks!.get('mal-52991')?.d).toBe(FRIEREN_ANILIST.descriptions[0]!.description)
})

// Mutation: keep the first dump in the stamp.
test('a new dump stamps new picks, which name the new dump', async () => {
  const { w, bucket, sources } = await firstRun()
  const next = world({ assets: assetsOf(w), sources })
  await logged(() => merging(next, bucket, { tag: '2026-44', now: NOW + DAY }))
  expect(picksOf(next).dump).toEqual({ tag: '2026-44', sha256: 'sha-of-2026-44' })
})

// Mutations: let a failed merge fail the run; drop the last picks when the history changes before the merge.
test('a merge that fails warns and leaves the run green, and the release keeps naming the last picks through its own publish', async () => {
  const { w, bucket, sources } = await firstRun()
  const before = picksOf(w)
  const next = world({ assets: assetsOf(w), sources })
  const lines = await logged(() => merging(next, bucket, { merge: async () => { throw new Error('no generated enums') }, tag: '2026-44', now: NOW + DAY }))
  expect(lines).toContain('::warning::[offline-history] the picks were not made this run: no generated enums')
  // control: the new dump did publish a new manifest
  expect(JSON.parse(next.named('manifest.json')!.toString()).dump.tag).toBe('2026-44')
  expect(picksOf(next)).toEqual(before)
  expect(next.named(before.name)).toBeDefined()
})

// Mutations: merge with no store; merge with a store this run could not read.
test('with no store, or one that cannot be read, no merge runs', async () => {
  const merge = vi.fn(MERGE)
  const plain = world({ release: false })
  await runHistory({ token: 't', get: plain.get, dump: dumpOf('2026-43'), now: () => NOW, sleep: async () => {}, pauseMs: 0, backoff: [], merge })
  const unreadable = fakeBucket({ fail: method => method === 'GET' })
  const failing = world({ release: false })
  await logged(() => merging(failing, unreadable, { merge }))
  expect(merge).not.toHaveBeenCalled()
  expect(picksOf(plain)).toBeUndefined()
})

// Mutations: let picks that cannot be read fail the run; name them again in the run's first publish.
test('picks the release cannot give back never stop a run, and leave the manifest, for this run\'s merge to replace', async () => {
  const { w, bucket, sources } = await firstRun()
  const before = picksOf(w)
  const { [before.name]: _, ...assets } = assetsOf(w)

  const failing = world({ assets, sources })
  const lines = await logged(() => merging(failing, bucket, { merge: async () => { throw new Error('no generated enums') }, now: NOW + HOUR }))
  expect(lines).toContain(`::warning::[offline-history] the published picks are dropped: the offline history is unreadable: ${before.name} is missing`)
  expect(picksOf(failing)).toBeUndefined()

  const next = world({ assets, sources })
  await logged(() => merging(next, bucket, { now: NOW + HOUR }))
  expect(picksOf(next)).toEqual(before)
  expect(historyOf(next).picks!.size).toBe(6)
})

// Mutation: keep the replaced picks in `publish`'s set for good.
test('picks replaced are removed once neither the manifest nor the one before names them', async () => {
  const { w, bucket, sources } = await firstRun()
  const first = picksOf(w).name
  const changed = [...ENTRIES, entry('A new show', { mal: 77, kitsu: 77 }, { year: 2026, season: 'FALL' })]
  const second = world({ assets: assetsOf(w), sources })
  await logged(() => merging(second, bucket, { tag: '2026-44', now: NOW + DAY, entries: changed }))
  const third = world({ assets: assetsOf(second), sources })
  await logged(() => merging(third, bucket, { tag: '2026-44', now: NOW + 2 * DAY, entries: [...changed, entry('Another', { mal: 78, kitsu: 78 }, { year: 2026, season: 'FALL' })] }))
  expect(third.names()).not.toContain(first)
  expect(third.names()).toContain(picksOf(third).name)
})

// Mutation: a release answer of 500 read as no release.
test('GitHub answering 404 for the tag is the one answer that means there is no release', async () => {
  const answering = (status: number) => async () => new Response('{}', { status })
  expect(await github('t', answering(404)).release()).toBeNull()
  await expect(github('t', answering(500)).release()).rejects.toThrow(/HTTP 500/)
  await expect(github('t', async () => { throw new TypeError('fetch failed') }).release()).rejects.toThrow(/fetch failed/)
})

// a fetch that reports itself on stderr, to show whether the script asked anything
const TRAP = `data:text/javascript,globalThis.fetch = async url => { process.stderr.write('FETCHED ' + url + '\\n'); throw new Error('trapped') }`
const script = (env: Record<string, string>) => {
  const rest = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['GITHUB_WORKFLOW', 'GH_TOKEN', ...SECRETS].includes(name)))
  return spawnSync(process.execPath, ['--import', TRAP, join(ROOT, 'scripts/offline-history.mjs')], { cwd: ROOT, env: { ...rest, ...env }, encoding: 'utf8', timeout: 60_000 })
}

// Mutation: drop the workflow check.
test('the job refuses to run anywhere but its workflow, before it asks anything', () => {
  // with a token, so the workflow check is the only thing between this run and a request
  const local = script({ GH_TOKEN: 't' })
  expect([local.status, local.stderr.includes('REFUSING'), local.stderr.includes('FETCHED')]).toEqual([1, true, false])
  // control: inside the workflow it does ask, so the trap would have seen a request
  const workflow = script({ GITHUB_WORKFLOW: 'Offline history', GH_TOKEN: 't' })
  expect(workflow.stderr).toContain('FETCHED https://api.github.com/repos/banou26/stub/releases/tags/offline-history')
})

// Mutations: hand the run no store; drop the run id or the commit from the writer; hand the run no merge.
test('the workflow\'s environment gives the run its token, the store once every secret is set, the writer its lines name, and stub\'s merge', async () => {
  const env = { GH_TOKEN: 't', GITHUB_RUN_ID: '18800000001', GITHUB_SHA: '0dcc445515d01f83ed4f61a388e0530dcba472f7', ...STORE_ENV }
  const { token, store, writer, merge } = runOptions(env)
  expect([token, Object.keys(store ?? {})]).toEqual(['t', ['get', 'put', 'remove', 'list']])
  expect(writer).toEqual({ by: 'offline-history', run: '18800000001', stub: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, commit: '0dcc4455' })
  for (const name of SECRETS) expect(runOptions({ ...env, [name]: '' }).store).toBeUndefined()
  const { module, version } = await merge()
  expect([typeof module.historyPicks, version]).toEqual(['function', expect.stringMatching(/^[0-9a-f]{16}$/)])
}, 30_000)

// Mutation: run the job before the enums it merges with are generated.
test('the workflow generates the enums stub\'s merge imports before it runs the job', () => {
  const steps = [...readFileSync(join(ROOT, '.github/workflows/offline-history.yml'), 'utf8').matchAll(/- run: (.+)/g)].map(([, step]) => step)
  expect(steps).toEqual(['npm ci', 'npm run gql-generate', 'node scripts/offline-history.mjs'])
})

// Mutations: no notice when a secret is unset; a notice that reads the secrets while the run gets no store.
test('without the source store\'s secrets the job says so in a notice and goes on as before', () => {
  const skipped = script({ GITHUB_WORKFLOW: 'Offline history', GH_TOKEN: 't' })
  expect(skipped.stdout).toContain(`::notice::[offline-history] the source store is skipped: ${SECRETS.join(', ')} not set`)
  expect(skipped.stderr).toContain('FETCHED https://api.github.com/repos/banou26/stub/releases/tags/offline-history')
  // control: with them, no notice
  const stored = script({ GITHUB_WORKFLOW: 'Offline history', GH_TOKEN: 't', ...STORE_ENV })
  expect([stored.stdout.includes('::notice::'), stored.stderr.includes('FETCHED https://api.github.com/')]).toEqual([false, true])
})

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? (name === 'generated' ? [] : files(path)) : [path]
  })

// Mutation: name AniDB's address, or the address of a whole catalogue of TVmaze, ANN or AnimeThemes, in another script.
test('only the job names AniDB\'s titles address and the addresses of TVmaze\'s, ANN\'s and AnimeThemes\' whole catalogues', () => {
  const texts = [...files(join(ROOT, 'scripts')), ...files(join(ROOT, 'src'))].map(path => [path.slice(ROOT.length), readFileSync(path, 'utf8')] as const)
  for (const address of ['anidb.net/api/anime-titles', 'api.tvmaze.com/shows?page=', 'api.tvmaze.com/updates/shows', 'animenewsnetwork.com/encyclopedia/reports.xml', 'animePagination']) {
    // control: the search does find it where it is
    expect([address, texts.filter(([, text]) => text.includes(address)).map(([path]) => path)]).toEqual([address, ['scripts/offline-history.mjs']])
  }
})
