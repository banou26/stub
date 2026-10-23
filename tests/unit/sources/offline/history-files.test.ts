// The offline history's release assets, as the Offline history workflow writes them and every data build reads
// them: a damaged or missing history fails the build loudly, an unreachable manifest falls back on the build cache.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vite-plus/test'

import { DOWNLOAD, decodeHistory, downloadManifest, encodeHistory, manifestCopy } from '../../../../scripts/history-files.mjs'
import { loadHistory } from '../../../../scripts/build-anime-data.mjs'

const history = () => encodeHistory({
  anidb: { fetchedAt: '2026-10-23T18:29:29.677Z', lastModified: null, titles: new Map([[23, [['official', 'en', 'Cowboy Bebop']]], [1, [['official', 'ja', 'エクスカイザー']]]]) },
  kitsu: new Map([[1, { id: '1', fetchedAt: '2026-10-23T19:19:32Z', attributes: { canonicalTitle: 'Cowboy Bebop', status: 'finished' } }]]),
  fields: { dump: { tag: '2026-43', sha256: 'abc' }, kitsu: { refreshedFor: '2026-43' }, checkpoints: {}, open: [] },
})

// a release serving these files, counting what is asked
const release = (files: { manifest: string, assets: Record<string, Buffer> } | undefined, { failFirst = 0 } = {}) => {
  const asked: string[] = []
  let failures = failFirst
  const get = async (url: string) => {
    asked.push(url)
    if (url === `${DOWNLOAD}/manifest.json`) {
      if (failures-- > 0 || !files) return new Response('Not Found', { status: 404 })
      return new Response(files.manifest)
    }
    const name = url.slice(DOWNLOAD.length + 1)
    const bytes = files?.assets[name]
    return bytes ? new Response(new Uint8Array(bytes)) : new Response('Not Found', { status: 404 })
  }
  return { asked, get }
}

// Mutation: name the assets by something other than their content.
test('the history round trips through its files, under content addressed names', () => {
  const files = history()
  const names = Object.keys(files.assets)
  expect(names).toEqual([expect.stringMatching(/^anidb-titles-[0-9a-f]{16}\.json\.zst$/), expect.stringMatching(/^kitsu-[0-9a-f]{16}\.jsonl\.zst$/)])
  expect(Object.keys(history().assets)).toEqual(names)
  const read = decodeHistory(files)
  expect([...read.anidb.titles.keys()]).toEqual([1, 23])
  expect(read.anidb.fetchedAt).toBe('2026-10-23T18:29:29.677Z')
  expect(read.kitsu.get(1)?.attributes.canonicalTitle).toBe('Cowboy Bebop')
  expect(read.manifest.kitsu.refreshedFor).toBe('2026-43')
  expect(manifestCopy(files.manifest)).toMatch(/^manifest-[0-9a-f]{16}\.json$/)
})

// Mutations: skip the sha256 check; skip the row count check; read a missing asset as empty.
test('a damaged history fails loudly rather than reading as a smaller one', () => {
  const files = history()
  const [anidb, kitsu] = Object.keys(files.assets) as [string, string]
  expect(() => decodeHistory({ ...files, assets: { ...files.assets, [anidb]: Buffer.from('x') } })).toThrow(/does not match its sha256/)
  expect(() => decodeHistory({ ...files, assets: { [anidb]: files.assets[anidb]! } })).toThrow(new RegExp(`${kitsu} is missing`))
  expect(() => decodeHistory({ ...files, manifest: files.manifest.replace('"rows": 2', '"rows": 3') })).toThrow(/holds 2 rows, its manifest says 3/)
  expect(() => decodeHistory({ ...files, manifest: '{' })).toThrow(/manifest.json is not JSON/)
})

// Mutation: ask the manifest only once.
test('a data build asks the manifest again once, after the pause a publish needs to replace it', async () => {
  const files = history()
  const { asked, get } = release(files, { failFirst: 1 })
  expect(await downloadManifest({ get, pauseMs: 0 })).toBe(files.manifest)
  expect(asked.filter(url => url.endsWith('/manifest.json'))).toHaveLength(2)
  await expect(downloadManifest({ get: release(files, { failFirst: 2 }).get, pauseMs: 0 })).rejects.toThrow(/manifest.json answered HTTP 404/)
})

const cacheWith = (files?: { manifest: string, assets: Record<string, Buffer> }) => {
  const cache = mkdtempSync(join(tmpdir(), 'stub-history-'))
  if (files) {
    for (const [name, bytes] of Object.entries(files.assets)) writeFileSync(join(cache, name), bytes)
    writeFileSync(join(cache, 'manifest.json'), files.manifest)
  }
  return cache
}

// Mutations: fall back on nothing; fall back on the cache when an asset is damaged.
test('an unreachable history falls back on the build cache, a damaged one fails the build', async () => {
  const files = history()
  const cache = cacheWith(files)
  expect((await loadHistory({ get: release(undefined).get, pauseMs: 0, cache })).anidb.titles.size).toBe(2)

  const [anidb] = Object.keys(files.assets) as [string]
  const damaged = release({ ...files, assets: { ...files.assets, [anidb]: Buffer.from('x') } })
  await expect(loadHistory({ get: damaged.get, pauseMs: 0, cache })).rejects.toThrow(/does not match its sha256/)
})

// Mutation: download the assets inside the try that falls back on the cache.
test('an asset the manifest names that answers 404 fails the build, even with a cache to fall back on', async () => {
  const files = history()
  const cache = cacheWith(files)
  const gone = release({ manifest: files.manifest, assets: {} })
  await expect(loadHistory({ get: gone.get, pauseMs: 0, cache })).rejects.toThrow(/anidb-titles-[0-9a-f]{16}\.json\.zst answered HTTP 404/)
  // control: the same cache serves a build whose manifest cannot be fetched
  expect((await loadHistory({ get: release(undefined).get, pauseMs: 0, cache })).anidb.titles.size).toBe(2)
})

// Mutation: build on with an empty history when there is neither a release nor a cache.
test('with no history to read and no cache, the data build refuses and names the workflow that makes one', async () => {
  await expect(loadHistory({ get: release(undefined).get, pauseMs: 0, cache: cacheWith() }))
    .rejects.toThrow(/no offline history at https:\/\/github\.com\/banou26\/stub\/releases\/download\/offline-history\/manifest\.json.*Run the Offline history workflow/)
})

// Mutation: ask the release with --offline.
test('--offline reads the cache and asks nothing', async () => {
  const { asked, get } = release(history())
  expect((await loadHistory({ offline: true, get, cache: cacheWith(history()) })).kitsu.size).toBe(1)
  expect(asked).toEqual([])
})

// Mutation: leave the cache as it was after a fresh read.
test('a fresh read replaces the cache', async () => {
  const cache = cacheWith()
  await loadHistory({ get: release(history()).get, pauseMs: 0, cache })
  expect((await loadHistory({ offline: true, cache })).anidb.titles.size).toBe(2)
})
