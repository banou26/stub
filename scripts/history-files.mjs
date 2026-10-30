// The offline history's release assets (HOR-915): what the Offline history workflow publishes
// (./offline-history.mjs) and every data build reads (./build-anime-data.mjs).
//
// Three assets of gathered inputs, each a file of its own and none holding any ODbL data: AniDB's titles, Kitsu's
// rows, and what link previews' answers of anizip and Kitsu may add, folded from the private source store's inbox
// (./source-store.mjs). A fourth, the picks, is what stub's merge of all of that and of every answer the
// store keeps chose per show, stamped with the merge's version and the dump it read. A manifest names them with their
// sha256 and row count, which dump the checkpoints came from, and the YEAR-SEASON checkpoints themselves. Asset names
// are content addressed and the manifest is replaced last, so a reader sees the old set or the new one, never a mix.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

export const REPOSITORY = 'banou26/stub'
export const TAG = 'offline-history'
export const MANIFEST = 'manifest.json'
/** github.com, not api.github.com: no unauthenticated 60-an-hour budget, as for the dump's direct download. */
export const DOWNLOAD = `https://github.com/${REPOSITORY}/releases/download/${TAG}`

// `gh release upload --clobber` deletes before it uploads, so manifest.json is missing for a few seconds a publish
const MANIFEST_RETRY_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 120_000

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** `manifest-<sha>.json`, the copy of a manifest a missing manifest.json is restored from. */
export const manifestCopy = text => `manifest-${sha256(text).slice(0, 16)}.json`

const compress = text => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_compressionLevel]: 19 } })

const asset = (prefix, extension, bytes, rows) => ({ name: `${prefix}-${sha256(bytes).slice(0, 16)}${extension}`, sha256: sha256(bytes), bytes: bytes.length, rows })

// what stub's merge reads of an answer for the history's four fields
const MERGED = ['score', 'titles', 'covers', 'banners', 'descriptions']
// The fields of a link preview's answer the public `previews` asset may hold, by source: only the sources whose terms
// allow publishing their data, and of anizip its titles alone, since its images are TheTVDB's, whose terms do not.
const PREVIEW_FIELDS = { anizip: ['score', 'titles'], kitsu: MERGED }
const rank = kind => (kind === 'full' ? 1 : 0)

/** Whether answer `line` stands over `held`, of the same source and id: a full answer over a list hit, then the newest. */
export const newer = (line, held) => !held || rank(line.class) > rank(held.class) || (line.class === held.class && line.fetchedAt > held.fetchedAt)

/** What stub's merge reads of `media`, an answer of `source`: of anizip its titles alone, since its images are TheTVDB's. */
export const mergedFields = (source, media) => Object.fromEntries((PREVIEW_FIELDS[source] ?? MERGED).filter(field => field in media).map(field => [field, media[field]]))

/**
 * `previews`, a Map by uri of `{ source, id, class, fetchedAt, media }`, with the inbox `lines` of the private source
 * store (scripts/source-store.mjs's `readInbox`) folded in: per uri the newest full answer, else the newest list hit,
 * of PREVIEW_FIELDS' sources only, with only their fields.
 */
export const foldPreviews = (previews, lines) => {
  const folded = new Map(previews)
  for (const { index, body } of lines) {
    if (!PREVIEW_FIELDS[index.source]) continue
    const uri = `${index.source}:${index.id}`
    if (!newer(index, folded.get(uri))) continue
    folded.set(uri, { source: index.source, id: index.id, class: index.class, fetchedAt: index.fetchedAt, media: mergedFields(index.source, JSON.parse(body.body)) })
  }
  return folded
}

/**
 * The files of one history: `{ manifest, assets }`, the manifest as text and each asset's bytes by name.
 *
 * `anidb` is `{ fetchedAt, lastModified, titles }`, `titles` a Map of AniDB id to its English and Japanese
 * titles as `[type, language, title]` in the file's order. `kitsu` is a Map of Kitsu id to `{ id, fetchedAt,
 * attributes }`. `previews` is a Map as `foldPreviews` answers it. `fields` is the rest of the manifest: `dump`,
 * `kitsu`, `checkpoints`, `open`.
 */
export const encodeHistory = ({ anidb, kitsu, previews = new Map(), fields }) => {
  const titles = Object.fromEntries([...anidb.titles].sort(([a], [b]) => a - b))
  const anidbBytes = compress(JSON.stringify({ fetchedAt: anidb.fetchedAt ?? null, lastModified: anidb.lastModified ?? null, titles }))
  const kitsuBytes = compress([...kitsu.values()].sort((a, b) => Number(a.id) - Number(b.id)).map(row => `${JSON.stringify(row)}\n`).join(''))
  const previewsBytes = compress([...previews.values()].sort((a, b) => a.source.localeCompare(b.source) || Number(a.id) - Number(b.id)).map(row => `${JSON.stringify(row)}\n`).join(''))
  const assets = {
    anidb: asset('anidb-titles', '.json.zst', anidbBytes, anidb.titles.size),
    kitsu: asset('kitsu', '.jsonl.zst', kitsuBytes, kitsu.size),
    previews: asset('previews', '.jsonl.zst', previewsBytes, previews.size),
  }
  return {
    manifest: `${JSON.stringify({ assets, ...fields }, null, 1)}\n`,
    assets: { [assets.anidb.name]: anidbBytes, [assets.kitsu.name]: kitsuBytes, [assets.previews.name]: previewsBytes },
  }
}

/**
 * The picks' asset, for `withPicks`: `{ entry, bytes }`. `picks` is a Map of key to entry as scripts/offline-pick.ts's
 * `historyPicks` answers it, and `stamp` is `{ merge, dump }`, which `entry` carries: the merge's version and the
 * dump's `{ tag, sha256 }`. The same picks of the same merge and dump give the same entry, whatever commit made them.
 */
export const encodePicks = (picks, stamp) => {
  const bytes = compress([...picks].sort(([a], [b]) => (a < b ? -1 : 1)).map(row => `${JSON.stringify(row)}\n`).join(''))
  return { entry: { ...asset('picks', '.jsonl.zst', bytes, picks.size), ...stamp }, bytes }
}

/** `files`, as `encodeHistory` answers them, also naming `picks`, as `encodePicks` answers them. */
export const withPicks = ({ manifest, assets }, { entry, bytes }) => {
  const fields = JSON.parse(manifest)
  return {
    manifest: `${JSON.stringify({ ...fields, assets: { ...fields.assets, picks: entry } }, null, 1)}\n`,
    assets: { ...assets, [entry.name]: bytes },
  }
}

/**
 * The job's picks in a history read back, when a build holding this merge's version and this dump's sha256 may ship
 * them: `{ picks }`, or `{ why }` saying why not. Picks of another dump are keyed to records that may have moved, and
 * another merge's are not what this build's code would choose.
 */
export const picksFor = ({ manifest, picks, picksUnread }, { merge, dump }) => {
  const entry = manifest.assets.picks
  if (!entry) return { why: 'no picks published yet' }
  if (entry.merge !== merge) return { why: `the picks are of merge ${entry.merge}, this build's is ${merge}` }
  if (entry.dump?.sha256 !== dump.sha256) return { why: `the picks are of dump ${entry.dump?.tag}, this build's is ${dump.tag}` }
  return picks ? { picks } : { why: picksUnread }
}

/** A hash of `files` under `root`, by their path in it and their bytes, so any checkout of the same code gives the same. */
export const mergeVersion = (root, files) => {
  const hash = createHash('sha256')
  const paths = [...new Set(files.map(file => relative(root, file)))].filter(path => !path.startsWith('src/generated/')).sort((a, b) => (a < b ? -1 : 1))
  for (const path of paths) hash.update(path).update(readFileSync(resolve(root, path)))
  return hash.digest('hex').slice(0, 16)
}

/**
 * Stub's merge as a build and the job run it: `module`, scripts/offline-pick.ts, and `version`, `mergeVersion` over it
 * and every file it loads but the generated ones. Through vite's module runner, since node cannot load those modules
 * on its own (enums, extensionless imports), and after `npm run gql-generate`, whose enums they import.
 */
export const loadMerge = async root => {
  const { runnerImport } = await import('vite-plus')
  const entry = resolve(root, 'scripts/offline-pick.ts')
  const { module, dependencies } = await runnerImport(entry, { root, configFile: false, logLevel: 'error' })
  return { module, version: mergeVersion(root, [entry, ...dependencies]) }
}

const unreadable = detail => new Error(`the offline history is unreadable: ${detail}`)

/** The manifest's own fields, or a loud failure when it is not one. */
export const readManifest = text => {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw unreadable(`${MANIFEST} is not JSON`)
  }
  // a history published before previews were kept names none
  for (const kind of ['anidb', 'kitsu', ...(manifest?.assets?.previews ? ['previews'] : [])]) {
    const entry = manifest?.assets?.[kind]
    if (typeof entry?.name !== 'string' || typeof entry.sha256 !== 'string' || !Number.isInteger(entry.rows)) throw unreadable(`${MANIFEST} names no ${kind} asset`)
  }
  return manifest
}

const assetText = (files, entry) => {
  const bytes = files.assets[entry.name]
  if (!bytes) throw unreadable(`${entry.name} is missing`)
  if (sha256(bytes) !== entry.sha256) throw unreadable(`${entry.name} does not match its sha256`)
  try {
    return zstdDecompressSync(bytes).toString('utf8')
  } catch {
    throw unreadable(`${entry.name} is not zstd`)
  }
}

const rowsChecked = (entry, size) => {
  if (size !== entry.rows) throw unreadable(`${entry.name} holds ${size} rows, its manifest says ${entry.rows}`)
}

const lines = (files, entry) => assetText(files, entry).split('\n').filter(Boolean).map(line => JSON.parse(line))

const readPicks = (files, entry) => {
  try {
    const picks = new Map(lines(files, entry))
    rowsChecked(entry, picks.size)
    return { picks }
  } catch (error) {
    return { picksUnread: error.message }
  }
}

/**
 * A history read back from its files: `{ manifest, anidb, kitsu, previews }` as `encodeHistory` takes them. Fails loudly
 * on any of those that is missing, does not match its sha256, does not parse, or holds another row count than its own
 * manifest entry records, so a damaged history is never read as a smaller one. When the manifest names picks, also
 * `picks`, a Map of key to entry, or `picksUnread`, saying what is wrong with them, and nothing fails on those: a
 * build holds its own merge, and the job makes them again.
 */
export const decodeHistory = files => {
  const manifest = readManifest(files.manifest)
  let anidb
  let kitsu
  let previews
  try {
    anidb = JSON.parse(assetText(files, manifest.assets.anidb))
    kitsu = lines(files, manifest.assets.kitsu)
    previews = manifest.assets.previews ? lines(files, manifest.assets.previews) : []
  } catch (error) {
    throw error.message.startsWith('the offline history') ? error : unreadable(`an asset does not parse (${error.message})`)
  }
  const titles = new Map(Object.entries(anidb.titles ?? {}).map(([aid, list]) => [Number(aid), list]))
  rowsChecked(manifest.assets.anidb, titles.size)
  rowsChecked(manifest.assets.kitsu, kitsu.length)
  if (manifest.assets.previews) rowsChecked(manifest.assets.previews, previews.length)
  return {
    manifest,
    anidb: { fetchedAt: anidb.fetchedAt, lastModified: anidb.lastModified, titles },
    kitsu: new Map(kitsu.map(row => [Number(row.id), row])),
    previews: new Map(previews.map(row => [`${row.source}:${row.id}`, row])),
    ...manifest.assets.picks && readPicks(files, manifest.assets.picks),
  }
}

const download = async (get, url) => {
  const response = await get(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * The published manifest's text, from github.com. Asked again once after `pauseMs` when the first answer fails,
 * which covers the seconds a publish replaces it. Throws, saying why, when it cannot be read.
 */
export const downloadManifest = async ({ get = fetch, pauseMs = MANIFEST_RETRY_MS } = {}) => {
  try {
    return (await download(get, `${DOWNLOAD}/${MANIFEST}`)).toString('utf8')
  } catch {
    await new Promise(resolve => setTimeout(resolve, pauseMs))
    return (await download(get, `${DOWNLOAD}/${MANIFEST}`)).toString('utf8')
  }
}

/** Each asset a manifest names, from github.com. Throws when one cannot be fetched, other than the picks, left out. */
export const downloadAssets = async (manifestText, get = fetch) => {
  const { assets } = readManifest(manifestText)
  const files = {}
  for (const [kind, { name }] of Object.entries(assets)) {
    const bytes = await download(get, `${DOWNLOAD}/${name}`).catch(error => {
      if (kind !== 'picks') throw error
    })
    if (bytes) files[name] = bytes
  }
  return files
}
