// The offline history's release assets, as the Offline history workflow writes them and every data build reads
// them: a damaged or missing history fails the build loudly, an unreachable manifest falls back on the build cache.
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { DOWNLOAD, decodeHistory, downloadManifest, encodeHistory, encodePicks, foldPreviews, loadMerge, manifestCopy, mergeVersion, picksFor, withPicks } from '../../../../scripts/history-files.mjs'
import { loadHistory } from '../../../../scripts/build-anime-data.mjs'
import { FRIEREN_ANILIST, FRIEREN_ANIZIP, FRIEREN_KITSU } from './fake-inbox'

const history = (previews?: Map<string, unknown>) => encodeHistory({
  anidb: { fetchedAt: '2026-10-23T18:29:29.677Z', lastModified: null, titles: new Map([[23, [['official', 'en', 'Cowboy Bebop']]], [1, [['official', 'ja', 'エクスカイザー']]]]) },
  kitsu: new Map([[1, { id: '1', fetchedAt: '2026-10-23T19:19:32Z', attributes: { canonicalTitle: 'Cowboy Bebop', status: 'finished' } }]]),
  previews,
  fields: { dump: { tag: '2026-43', sha256: 'abc' }, kitsu: { refreshedFor: '2026-43' }, checkpoints: {}, open: [] },
})

const PICKS = new Map([['mal-2', { t: 'B' }], ['mal-1', { t: 'A', d: 'Bounty hunters.' }]])
const STAMP = { merge: 'merge-1', dump: { tag: '2026-43', sha256: 'abc' } }

// Mutations: keep the picks in their Map's order; leave the stamp out of the entry.
test('the picks round trip through their file under a content addressed name, with their stamp, whatever their order', () => {
  const picks = encodePicks(PICKS, STAMP)
  expect(picks.entry).toMatchObject({ name: expect.stringMatching(/^picks-[0-9a-f]{16}\.jsonl\.zst$/), rows: 2, ...STAMP })
  expect(encodePicks(new Map([...PICKS].reverse()), STAMP)).toEqual(picks)
  const files = withPicks(history(), picks)
  expect(decodeHistory(files).picks).toEqual(new Map([['mal-1', PICKS.get('mal-1')], ['mal-2', PICKS.get('mal-2')]]))
  expect(JSON.parse(files.manifest).assets.picks).toEqual(picks.entry)
})

// Mutation: let `withPicks` lose a field of the manifest.
test('picks join a manifest and change nothing else in it, and a later set replaces the first', () => {
  const plain = JSON.parse(history().manifest)
  const first = withPicks(history(), encodePicks(PICKS, STAMP))
  const second = encodePicks(new Map([['mal-3', { t: 'C' }]]), STAMP)
  const { picks, ...rest } = JSON.parse(withPicks(first, second).manifest).assets
  expect(picks).toEqual(second.entry)
  expect(rest).toEqual(plain.assets)
  expect({ ...JSON.parse(first.manifest), assets: {} }).toEqual({ ...plain, assets: {} })
})

// Mutation: read a missing picks entry as an empty set.
test('a history published before the first picks reads with none', () => {
  expect(decodeHistory(history()).picks).toBeUndefined()
})

// Mutations: skip the picks' row count; skip their sha256.
test('damaged picks fail loudly, as any other asset does', () => {
  const files = withPicks(history(), encodePicks(PICKS, STAMP))
  const manifest = JSON.parse(files.manifest)
  const miscounted = { ...manifest, assets: { ...manifest.assets, picks: { ...manifest.assets.picks, rows: 3 } } }
  expect(() => decodeHistory({ ...files, manifest: JSON.stringify(miscounted) })).toThrow(/holds 2 rows, its manifest says 3/)
  expect(() => decodeHistory({ ...files, assets: { ...files.assets, [manifest.assets.picks.name]: Buffer.from('x') } })).toThrow(/does not match its sha256/)
  const { [manifest.assets.picks.name]: _, ...rest } = files.assets
  expect(() => decodeHistory({ ...files, assets: rest })).toThrow(/is missing/)
})

// Mutations: ship picks of another merge; ship picks of another dump; compare the dump's tag alone.
test('a build ships picks only of its own merge and its own dump, and says why not', () => {
  const read = decodeHistory(withPicks(history(), encodePicks(PICKS, STAMP)))
  const dump = STAMP.dump
  expect(picksFor(read, { merge: 'merge-1', dump }).picks).toBe(read.picks)
  expect(picksFor(read, { merge: 'merge-2', dump })).toEqual({ why: 'the picks are of merge merge-1, this build\'s is merge-2' })
  expect(picksFor(read, { merge: 'merge-1', dump: { tag: '2026-44', sha256: 'def' } })).toEqual({ why: 'the picks are of dump 2026-43, this build\'s is 2026-44' })
  // a tag whose file was replaced is another dump
  expect(picksFor(read, { merge: 'merge-1', dump: { tag: '2026-43', sha256: 'def' } }).picks).toBeUndefined()
  // a build cache from before the extract kept the dump's hash
  expect(picksFor(read, { merge: 'merge-1', dump: { tag: '2026-43' } }).picks).toBeUndefined()
  expect(picksFor(decodeHistory(history()), { merge: 'merge-1', dump })).toEqual({ why: 'no picks published yet' })
})

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'merge-version-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

// Mutations: hash absolute paths; hash the names alone; hash generated files; hash them in the order given.
test('a merge\'s version follows the bytes of its files, not where they are checked out, nor their order, nor generated ones', () => {
  const files = { 'scripts/a.ts': 'a', 'src/b.ts': 'b' }
  const paths = (root: string) => Object.keys(files).map(path => join(root, path))
  const one = tree(files)
  const version = mergeVersion(one, paths(one))
  const two = tree(files)
  expect(mergeVersion(two, paths(two))).toBe(version)
  expect(mergeVersion(two, paths(two).reverse())).toBe(version)
  expect(mergeVersion(two, [...paths(two), paths(two)[0]!])).toBe(version)
  writeFileSync(join(two, 'src/b.ts'), 'edited')
  expect(mergeVersion(two, paths(two))).not.toBe(version)
  const three = tree({ ...files, 'src/generated/graphql.ts': 'one build' })
  expect(mergeVersion(three, [...paths(three), join(three, 'src/generated/graphql.ts')])).toBe(version)
  for (const root of [one, two, three]) rmSync(root, { recursive: true })
})

// Mutations: hash the entry alone, not what it loads; hash nothing of a dependency.
test('stub\'s merge loads with a version that moves with a file it loads, and with no other, in any checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merge-checkout-'))
  mkdirSync(join(root, 'scripts'))
  for (const file of ['offline-pick.ts', 'history-files.mjs']) cpSync(join(REPO, 'scripts', file), join(root, 'scripts', file))
  cpSync(join(REPO, 'src'), join(root, 'src'), { recursive: true, filter: path => !path.includes('generated/history') })
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'))
  try {
    const { module, version } = await loadMerge(root)
    expect(module.historyPicks).toBeInstanceOf(Function)
    expect((await loadMerge(REPO)).version).toBe(version)
    appendFileSync(join(root, 'src/router/legal/index.tsx'), '// a file the merge does not load\n')
    appendFileSync(join(root, 'src/generated/graphql.ts'), '// generated again\n')
    expect((await loadMerge(root)).version).toBe(version)
    appendFileSync(join(root, 'src/worker/graph/plugins/fields.ts'), '// a change to the merge\n')
    expect((await loadMerge(root)).version).not.toBe(version)
  } finally {
    rmSync(root, { recursive: true })
  }
}, 60_000)

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
  expect(names).toEqual([expect.stringMatching(/^anidb-titles-[0-9a-f]{16}\.json\.zst$/), expect.stringMatching(/^kitsu-[0-9a-f]{16}\.jsonl\.zst$/), expect.stringMatching(/^previews-[0-9a-f]{16}\.jsonl\.zst$/)])
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

const T1 = '2026-10-25T05:41:00.000Z'
const T2 = '2026-10-26T05:41:00.000Z'
// an inbox line as the source store's `readInbox` hands it on, with what the fold reads of it
const line = (source: string, id: string, kind: 'full' | 'list', fetchedAt: string, media: object) => ({ index: { source, id, class: kind, fetchedAt }, body: { body: JSON.stringify(media) } })
const kitsu = (title: string) => ({ score: 0.3, titles: [{ language: 'en', title, score: 0.3 }], status: 'FINISHED' })
const LINES = [
  // only a list hit: it stands for the show
  line('kitsu', '1', 'list', T1, kitsu('Cowboy Bebop')),
  // a full answer, then a later list hit, which does not replace it
  line('kitsu', '2', 'full', T1, kitsu('Trigun')),
  line('kitsu', '2', 'list', T2, kitsu('Trigun Stampede')),
  // a list hit, then a later full answer, which does
  line('kitsu', '3', 'list', T1, kitsu('Excel Saga')),
  line('kitsu', '3', 'full', T2, kitsu('Excel Saga (TV)')),
  line('anizip', '17617', 'full', T1, FRIEREN_ANIZIP),
  // an offline answer carrying MyAnimeList's synopsis, and the restricted sources' own
  line('offline', 'mal-52991', 'full', T1, { titles: [{ language: 'en', title: 'Sousou no Frieren', score: 0.2 }], descriptions: [{ language: 'en', description: 'MyAnimeList\'s synopsis', score: 0.2 }] }),
  line('anilist', '154587', 'full', T1, FRIEREN_ANILIST),
  line('mal', '52991', 'list', T1, { titles: [{ language: 'en', title: 'Frieren', score: 0.9 }] }),
]

// Mutations: read full answers only; let the newest answer win whatever its class; publish every source; publish
// anizip's images or the fields Kitsu answers beyond the four the history picks.
test('previews add to the history per show the newest full answer, else the newest list hit, of anizip and Kitsu only', () => {
  const folded = foldPreviews(new Map(), LINES)
  expect([...folded.values()].map(({ source, id, class: kind, fetchedAt, media }) => [`${source}:${id}`, kind, fetchedAt, (media.titles as { title: string }[])[0]!.title])).toEqual([
    ['kitsu:1', 'list', T1, 'Cowboy Bebop'],
    ['kitsu:2', 'full', T1, 'Trigun'],
    ['kitsu:3', 'full', T2, 'Excel Saga (TV)'],
    ['anizip:17617', 'full', T1, 'Frieren: Beyond Journey\'s End'],
  ])
  expect(folded.get('anizip:17617')!.media).toEqual({ titles: FRIEREN_ANIZIP.titles })
  const { id, status, ...fields } = FRIEREN_KITSU
  // control: Kitsu answered an id and a status, which the history does not pick
  expect([id, status]).toEqual(['46474', 'FINISHED'])
  expect(foldPreviews(new Map(), [line('kitsu', '46474', 'full', T1, FRIEREN_KITSU)]).get('kitsu:46474')!.media).toEqual(fields)
  const published = JSON.stringify([...folded.values()])
  for (const text of ['artworks.thetvdb.com', 'MyAnimeList\'s synopsis', FRIEREN_ANILIST.descriptions[0]!.description]) expect(published).not.toContain(text)
})

// Mutation: read the published previews back under another key than the fold's.
test('folding the same lines into the history read back from its files gives the same files', () => {
  const once = history(foldPreviews(new Map(), LINES))
  const read = decodeHistory(once).previews
  expect(Object.keys(history(foldPreviews(read, LINES)).assets)).toEqual(Object.keys(once.assets))
  // control: a later answer does change them
  const later = foldPreviews(read, [line('kitsu', '1', 'list', T2, kitsu('Cowboy Bebop: The Movie'))])
  expect(Object.keys(history(later).assets)).not.toEqual(Object.keys(once.assets))
})

// Mutations: require a previews asset of every manifest; skip its row count check.
test('a history published before previews were kept reads with none, and kept ones round trip', () => {
  const files = history(foldPreviews(new Map(), LINES))
  expect([...decodeHistory(files).previews.keys()]).toEqual(['anizip:17617', 'kitsu:1', 'kitsu:2', 'kitsu:3'])
  expect(decodeHistory(files).previews.get('kitsu:2')).toEqual(foldPreviews(new Map(), LINES).get('kitsu:2'))
  const manifest = JSON.parse(files.manifest)
  expect(() => decodeHistory({ ...files, manifest: JSON.stringify({ ...manifest, assets: { ...manifest.assets, previews: { ...manifest.assets.previews, rows: 5 } } }) })).toThrow(/holds 4 rows, its manifest says 5/)
  const { previews: _, ...before } = manifest.assets
  expect(decodeHistory({ ...files, manifest: JSON.stringify({ ...manifest, assets: before }) }).previews).toEqual(new Map())
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
