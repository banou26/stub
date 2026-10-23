// The Offline history workflow's job: AniDB at most once a day, Kitsu only for new shows and open seasons, and a
// publish a reader can never catch half done. Driven against a fake GitHub, AniDB and Kitsu; nothing is asked.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { expect, test } from 'vite-plus/test'

import { ATTEMPT, anidbTurn, askAnidb, askKitsu, checkpointsOf, github, kitsuRow, parseAnidbTitles, runHistory } from '../../../../scripts/offline-history.mjs'
import { decodeHistory } from '../../../../scripts/history-files.mjs'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const HOUR = 3_600_000
const NOW = Date.parse('2026-10-25T05:41:00Z')
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

const kitsuResource = (id: number, status = 'finished') => ({
  id: String(id),
  type: 'anime',
  attributes: { canonicalTitle: `Show ${id}`, status, synopsis: null, userCount: 9, posterImage: { tiny: 't', small: 's', medium: 'm', large: 'l', original: 'o', meta: {} } },
})

test('a Kitsu row keeps the attributes the kitsu source and the checkpoints read, and the image sizes it takes', () => {
  expect(kitsuRow(kitsuResource(5), '2026-10-25T05:41:00.000Z')).toEqual({
    id: '5', fetchedAt: '2026-10-25T05:41:00.000Z', attributes: { canonicalTitle: 'Show 5', status: 'finished', posterImage: { original: 'o', large: 'l', medium: 'm' } },
  })
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

/** A fake GitHub release API, AniDB and Kitsu, recording every request in order. */
const world = ({ release = true, assets = {} as Record<string, string | Buffer>, anidb = () => new Response(null, { status: 304 }) as Response, failUploads = false } = {}) => {
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
  const listed = () => [...store.values()].map(({ id, name, created_at }) => ({ id, name, created_at, url: `https://api.github.com/repos/banou26/stub/releases/assets/${id}` }))
  const kitsu = kitsuApi()
  const get = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === ANIDB) {
      log.push('anidb')
      return anidb()
    }
    if (url.startsWith('https://kitsu.io/')) {
      log.push('kitsu')
      return kitsu.get(url)
    }
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
      if (failUploads) return new Response('', { status: 500 })
      put(name, init.body as string | Buffer)
      return Response.json(listed().find(asset => asset.name === name))
    }
    const assetId = /^https:\/\/api\.github\.com\/repos\/banou26\/stub\/releases\/assets\/(\d+)$/.exec(url)?.[1]
    if (assetId && method === 'DELETE') {
      log.push(`delete ${store.get(assetId)?.name}`)
      store.delete(assetId)
      return new Response(null, { status: 204 })
    }
    if (assetId) return store.has(assetId) ? new Response(new Uint8Array(store.get(assetId)!.bytes)) : new Response('', { status: 404 })
    throw new Error(`the fake world has no ${method} ${url}`)
  }
  const named = (name: string) => [...store.values()].find(asset => asset.name === name)?.bytes
  const kitsuIds = () => kitsu.asked.flatMap(url => new URL(url).searchParams.get('filter[id]')!.split(',').map(Number)).sort((a, b) => a - b)
  return { log, get, named, kitsuIds, names: () => [...store.values()].map(asset => asset.name).sort() }
}

const dumpOf = (tag: string, entries = ENTRIES) => async () => ({ tag, meta: { lastUpdate: '2026-10-19' }, entries, sha256: `sha-of-${tag}` })

const run = (w: ReturnType<typeof world>, tag = '2026-43', now = NOW) =>
  runHistory({ token: 't', get: w.get, dump: dumpOf(tag), now: () => now, sleep: async () => {}, pauseMs: 0, backoff: [] })

/** A published history, as a first run from scratch leaves it, with its attempt record `hoursAgo` old. */
const published = async (hoursAgo: number) => {
  const first = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))) })
  await run(first, '2026-43', NOW - hoursAgo * HOUR)
  return Object.fromEntries(first.names().map(name => [name, first.named(name)!]))
}

// Mutations: start over on any failure to read the release; publish manifest.json before the assets it names.
test('from scratch, only on a 404: the release is made, the attempt recorded before AniDB is asked, the assets go up before the manifest', async () => {
  const w = world({ release: false, anidb: () => new Response(new Uint8Array(anidbFile(15_000))) })
  await run(w)
  const uploads = w.log.filter(line => line.startsWith('upload')).map(line => line.replace(/-[0-9a-f]{16}\./, '-<sha>.'))
  expect(w.log.slice(0, 3)).toEqual(['create', `upload ${ATTEMPT}`, 'anidb'])
  expect(uploads).toEqual([`upload ${ATTEMPT}`, `upload ${ATTEMPT}`, 'upload anidb-titles-<sha>.json.zst', 'upload kitsu-<sha>.jsonl.zst', 'upload manifest-<sha>.json', 'upload manifest.json'])
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
  const w = world({ assets: await published(25), failUploads: true })
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
  const { GITHUB_WORKFLOW: _, GH_TOKEN: __, ...rest } = process.env
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

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? (name === 'generated' ? [] : files(path)) : [path]
  })

// Mutation: name AniDB's address in another script.
test('only the job names AniDB\'s titles address', () => {
  const naming = [...files(join(ROOT, 'scripts')), ...files(join(ROOT, 'src'))]
    .filter(path => readFileSync(path, 'utf8').includes('anidb.net/api/anime-titles'))
    .map(path => path.slice(ROOT.length))
  // control: the search does find it where it is
  expect(naming).toEqual(['scripts/offline-history.mjs'])
})
