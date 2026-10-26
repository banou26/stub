// The private source store (HOR-994): each source's own answers as the Offline history job asked them, and per show
// when the source last answered and when its answer last changed. Against a fake R2 bucket and recorded answers;
// nothing is asked of R2, AniDB or Kitsu.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { expect, test } from 'vite-plus/test'

import { askKitsu } from '../../../../scripts/offline-history.mjs'
import { SECRETS, anidbShows, dated, keepAnswers, r2, readStore } from '../../../../scripts/source-store.mjs'
import { STORE_ENV, fakeBucket } from './fake-bucket'

const WRITER = { by: 'offline-history', run: '42', stub: '0.0.62', commit: '0dcc4455' }
const T1 = '2026-10-25T05:41:00.000Z'
const T2 = '2026-10-26T05:41:00.000Z'
const T3 = '2026-10-27T05:41:00.000Z'
const T4 = '2026-10-28T05:41:00.000Z'
const LAST_MODIFIED = 'Sat, 24 Oct 2026 04:00:00 GMT'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const lines = (bytes: Buffer) => zstdDecompressSync(bytes).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

// shaped as AniDB's titles file, as the job's own tests quote it
const titlesFile = (crest = 'Crest of the Stars') => `<?xml version="1.0" encoding="UTF-8"?>
<animetitles>
<anime aid="1"><title xml:lang="x-jat" type="main">Seikai no Monshou</title><title type="official" xml:lang="ja">星界の紋章</title><title type="official" xml:lang="en">${crest}</title></anime>
<anime aid="9242"><title type="official" xml:lang="ja">ナイン &amp;lt;オリジナル版&amp;gt;</title></anime>
</animetitles>`
const anidb200 = (xml: string, fetchedAt: string) => ({ outcome: '200', fetchedAt, lastModified: LAST_MODIFIED, xml, file: gzipSync(xml) })

const state = async (bucket: ReturnType<typeof fakeBucket>) => {
  const { manifest, index } = await readStore(bucket.client)
  return { manifest, lines: [...index.values()] }
}
const unsha = (lines: string[]) => lines.map(line => line.replace(/-[0-9a-f]{16}\./, '-<sha>.'))
// the bucket holds what manifest.json names and nothing else
const holdsOnly = (bucket: ReturnType<typeof fakeBucket>, manifest: { index: { name: string }, job: Record<string, { name: string }> }) =>
  expect(new Set(bucket.objects.keys())).toEqual(new Set(['manifest.json', manifest.index.name, ...Object.values(manifest.job).map(file => file.name)]))

// Mutations: build a client with a secret unset; send a request unsigned; address another endpoint.
test('the bucket is reached only with all three secrets, at R2\'s S3 endpoint, each request signed for its auto region', async () => {
  for (const name of SECRETS) expect(r2({ ...STORE_ENV, [name]: '' })).toBeUndefined()
  const seen: Request[] = []
  const answers = [new Response('stored'), new Response('', { status: 404 }), new Response('', { status: 500 })]
  const client = r2(STORE_ENV, async (request: Request) => {
    seen.push(request)
    return answers.shift()!
  })
  expect((await client.get('manifest.json')).toString()).toBe('stored')
  expect(await client.get('index-0.jsonl.zst')).toBeNull()
  await expect(client.put('job/kitsu-0.jsonl.zst', Buffer.from('rows'))).rejects.toThrow(/PUT job\/kitsu-0\.jsonl\.zst answered HTTP 500/)
  expect(seen.map(request => `${request.method} ${request.url}`)).toEqual([
    'GET https://acct.r2.cloudflarestorage.com/stub-sources/manifest.json',
    'GET https://acct.r2.cloudflarestorage.com/stub-sources/index-0.jsonl.zst',
    'PUT https://acct.r2.cloudflarestorage.com/stub-sources/job/kitsu-0.jsonl.zst',
  ])
  for (const request of seen) expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request, /)
})

// Mutation: set changedAt to fetchedAt on every answer.
test('a first answer is its own change, an unchanged hash keeps its changedAt, and a changed one moves it', () => {
  const first = dated(undefined, { source: 'kitsu', id: '1', sha256: 'a', fetchedAt: T1, writer: WRITER })
  expect(first).toEqual({ source: 'kitsu', id: '1', region: null, class: 'full', sha256: 'a', fetchedAt: T1, changedAt: T1, partial: false, role: null, body: true, writer: WRITER })
  const same = dated(first, { source: 'kitsu', id: '1', sha256: 'a', fetchedAt: T2, writer: WRITER })
  expect([same.fetchedAt, same.changedAt]).toEqual([T2, T1])
  const changed = dated(same, { source: 'kitsu', id: '1', sha256: 'b', fetchedAt: T3, writer: WRITER })
  expect([changed.sha256, changed.fetchedAt, changed.changedAt]).toEqual(['b', T3, T3])
})

// Mutation: hash only a show's titles' text, which leaves out a title's type or language changing.
test('each AniDB show is hashed over its whole element', () => {
  const shows = anidbShows(titlesFile())
  expect([...shows.keys()]).toEqual(['1', '9242'])
  expect(anidbShows(titlesFile().replace('type="official" xml:lang="en"', 'type="syn" xml:lang="en"')).get('1')).not.toBe(shows.get('1'))
})

// Mutations: name a file by anything but its content; write manifest.json before a file it names; recompress AniDB's file.
test('AniDB\'s file as fetched, Kitsu\'s answers and the index go up under content addressed names, manifest.json last', async () => {
  const bucket = fakeBucket()
  const xml = titlesFile()
  const answer = anidb200(xml, T1)
  const kitsu = [{ id: '5', fetchedAt: T1, body: '{"data":{"id":"5","type":"anime"},"included":[]}' }]
  await keepAnswers(bucket.client, await readStore(bucket.client), { anidb: answer, kitsu, writer: WRITER })

  const puts = unsha(bucket.log.filter(line => line.startsWith('PUT ')))
  expect(puts).toEqual(['PUT job/anidb-titles-<sha>.xml.gz', 'PUT job/kitsu-<sha>.jsonl.zst', 'PUT index-<sha>.jsonl.zst', 'PUT manifest.json'])
  const { manifest, lines: index } = await state(bucket)
  expect(manifest.job['anidb-titles']).toEqual({ name: `job/anidb-titles-${sha(xml).slice(0, 16)}.xml.gz`, sha256: sha(xml), rows: 2, lastModified: LAST_MODIFIED })
  expect(bucket.objects.get(manifest.job['anidb-titles'].name)).toEqual(answer.file)
  const kitsuText = `${JSON.stringify({ source: 'kitsu', id: '5', form: 'upstream', type: 'application/vnd.api+json', sha256: sha(kitsu[0]!.body), body: kitsu[0]!.body })}\n`
  expect(manifest.job.kitsu).toEqual({ name: `job/kitsu-${sha(kitsuText).slice(0, 16)}.jsonl.zst`, sha256: sha(kitsuText), rows: 1 })
  expect(manifest.index).toMatchObject({ name: expect.stringMatching(/^index-[0-9a-f]{16}\.jsonl\.zst$/), rows: 3 })
  holdsOnly(bucket, manifest)
  expect(index.map(line => [line.source, line.id, line.sha256, line.fetchedAt, line.changedAt])).toEqual([
    ['anidb-titles', '1', anidbShows(xml).get('1'), T1, T1],
    ['anidb-titles', '9242', anidbShows(xml).get('9242'), T1, T1],
    ['kitsu', '5', sha(kitsu[0]!.body), T1, T1],
  ])
})

// Mutations: move changedAt or the hash on a 304; move another source's lines or keep the old writer on one; upload
// an unchanged file again; keep a file no manifest names; remove one the new manifest names; remove before writing it.
test('a 304 moves AniDB\'s fetchedAt and writer only, the same file again keeps its name, and a changed show moves its own changedAt', async () => {
  const bucket = fakeBucket()
  const keep = async (anidb: object, more: object = {}) => keepAnswers(bucket.client, await readStore(bucket.client), { anidb, writer: WRITER, ...more })
  const writes = () => unsha(bucket.log.filter(line => !line.startsWith('GET ')))
  const anidbLines = <T extends { source: string }>(lines: T[]) => lines.filter(line => line.source === 'anidb-titles')
  await keep(anidb200(titlesFile(), T1), { kitsu: [{ id: '5', fetchedAt: T1, body: '{"data":{"id":"5","type":"anime"},"included":[]}' }] })
  const first = await state(bucket)
  const file = first.manifest.job['anidb-titles'].name

  const next = { ...WRITER, run: '43' }
  await keep({ outcome: '304', fetchedAt: T2 }, { writer: next })
  const unchanged = await state(bucket)
  expect(unchanged.lines).toEqual(first.lines.map(line => (line.source === 'anidb-titles' ? { ...line, fetchedAt: T2, writer: next } : line)))
  expect(unchanged.manifest.job).toEqual(first.manifest.job)
  holdsOnly(bucket, unchanged.manifest)

  bucket.log.length = 0
  await keep(anidb200(titlesFile(), T3))
  const again = await state(bucket)
  // control: the run did write: the index, manifest.json, and then the removal of the index it replaced
  expect(writes()).toEqual(['PUT index-<sha>.jsonl.zst', 'PUT manifest.json', 'DELETE index-<sha>.jsonl.zst'])
  expect(again.manifest.job['anidb-titles'].name).toBe(file)
  expect(anidbLines(again.lines).map(line => [line.fetchedAt, line.changedAt])).toEqual([[T3, T1], [T3, T1]])
  holdsOnly(bucket, again.manifest)

  bucket.log.length = 0
  await keep(anidb200(titlesFile('Crest of the Stars (TV)'), T4))
  const changed = await state(bucket)
  expect(anidbLines(changed.lines).map(line => [line.id, line.fetchedAt, line.changedAt])).toEqual([['1', T4, T4], ['9242', T4, T1]])
  expect(changed.manifest.job['anidb-titles'].name).not.toBe(file)
  // the old files go only once manifest.json no longer names them, and the Kitsu file it still names stays
  expect(writes()).toEqual(['PUT job/anidb-titles-<sha>.xml.gz', 'PUT index-<sha>.jsonl.zst', 'PUT manifest.json', 'DELETE index-<sha>.jsonl.zst', 'DELETE job/anidb-titles-<sha>.xml.gz'])
  holdsOnly(bucket, changed.manifest)
})

// Mutations: keep the lines of shows AniDB's file no longer lists; drop another source's lines with them.
test('a show AniDB\'s file no longer lists loses its line, so a later 304 dates only the shows the kept file holds', async () => {
  const bucket = fakeBucket()
  const keep = async (anidb: object, kitsu: object[] = []) => keepAnswers(bucket.client, await readStore(bucket.client), { anidb, kitsu, writer: WRITER })
  await keep(anidb200(titlesFile(), T1), [{ id: '5', fetchedAt: T1, body: '{"data":{"id":"5","type":"anime"},"included":[]}' }])
  const withoutNine = titlesFile().replace(/<anime aid="9242">.*\n/, '')
  // control: the file the next 200 serves lists the first show only
  expect([...anidbShows(withoutNine).keys()]).toEqual(['1'])
  await keep(anidb200(withoutNine, T2))
  await keep({ outcome: '304', fetchedAt: T3 })
  expect((await state(bucket)).lines.map(line => [line.source, line.id, line.fetchedAt, line.changedAt])).toEqual([['anidb-titles', '1', T3, T1], ['kitsu', '5', T1, T1]])
})

const recorded = JSON.parse(readFileSync(new URL('../kitsu/__fixtures__/kitsu-season-summer-2026.json', import.meta.url), 'utf8')) as { data: { id: string }[], included: { id: string }[] }[]
// Kitsu answering `filter[id]` from its recorded season pages, every page's mappings included as one page would
const recordedKitsu = async (url: string) => {
  const ids = new URL(url).searchParams.get('filter[id]')!.split(',')
  return Response.json({ data: recorded.flatMap(page => page.data).filter(resource => ids.includes(resource.id)), included: recorded.flatMap(page => page.included) })
}

// Mutations: keep the page's whole `included` with each resource; forget the ids an earlier run kept.
test('Kitsu\'s recorded resources are kept whole with their own mappings, and a later run adds to what is kept', async () => {
  const bucket = fakeBucket()
  const keep = async (ids: number[]) => {
    const { answers } = await askKitsu(ids, { get: recordedKitsu, sleep: async () => {} })
    await keepAnswers(bucket.client, await readStore(bucket.client), { kitsu: answers, writer: WRITER })
  }
  await keep([44778, 49002])
  await keep([50635])
  const { manifest, lines: index } = await state(bucket)
  const kept = lines(bucket.objects.get(manifest.job.kitsu.name)!)
  expect(kept.map(row => row.id)).toEqual(['44778', '49002', '50635'])
  const tanya = JSON.parse(kept[0].body)
  expect(tanya.data).toEqual(recorded[0]!.data[0])
  expect(tanya.included.map((mapping: { id: string }) => mapping.id)).toEqual(['304501', '304502'])
  expect(tanya.included[0].attributes).toMatchObject({ externalSite: 'anilist/anime', externalId: '135865' })
  expect(index.map(line => [line.source, line.id, line.sha256])).toEqual(kept.map(row => ['kitsu', row.id, sha(row.body)]))
})

// Mutation: write manifest.json when nothing changed.
test('keeping nothing new writes nothing', async () => {
  const bucket = fakeBucket()
  await keepAnswers(bucket.client, await readStore(bucket.client), { anidb: anidb200(titlesFile(), T1), writer: WRITER })
  const objects = new Map(bucket.objects)
  bucket.log.length = 0
  expect(await keepAnswers(bucket.client, await readStore(bucket.client), { writer: WRITER })).toBe('nothing changed')
  expect(bucket.log.filter(line => !line.startsWith('GET '))).toEqual([])
  expect(bucket.objects).toEqual(objects)
})

// Mutation: read an index that does not match its manifest as an empty one.
test('a store whose index does not match its manifest is unreadable, never read as an empty one', async () => {
  const bucket = fakeBucket()
  await keepAnswers(bucket.client, await readStore(bucket.client), { anidb: anidb200(titlesFile(), T1), writer: WRITER })
  const { manifest } = await state(bucket)
  bucket.objects.set(manifest.index.name, zstdCompressSync(Buffer.from('')))
  await expect(readStore(bucket.client)).rejects.toThrow(/does not match its sha256/)
  bucket.objects.delete(manifest.index.name)
  await expect(readStore(bucket.client)).rejects.toThrow(/is missing/)
})
