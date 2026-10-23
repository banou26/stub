// The offline history's release assets (HOR-915): what the Offline history workflow publishes
// (./offline-history.mjs) and every data build reads (./build-anime-data.mjs).
//
// Two assets of gathered inputs, each a file of its own and neither holding any ODbL data: AniDB's titles and
// Kitsu's rows. A manifest names them with their sha256 and row count, which dump the checkpoints came from, and the
// YEAR-SEASON checkpoints themselves. Asset names are content addressed and the manifest is replaced last, so a
// reader sees the old set or the new one, never a mix.

import { createHash } from 'node:crypto'
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

/**
 * The files of one history: `{ manifest, assets }`, the manifest as text and each asset's bytes by name.
 *
 * `anidb` is `{ fetchedAt, lastModified, titles }`, `titles` a Map of AniDB id to its English and Japanese
 * titles as `[type, language, title]` in the file's order. `kitsu` is a Map of Kitsu id to `{ id, fetchedAt,
 * attributes }`. `fields` is the rest of the manifest: `dump`, `kitsu`, `checkpoints`, `open`.
 */
export const encodeHistory = ({ anidb, kitsu, fields }) => {
  const titles = Object.fromEntries([...anidb.titles].sort(([a], [b]) => a - b))
  const anidbBytes = compress(JSON.stringify({ fetchedAt: anidb.fetchedAt ?? null, lastModified: anidb.lastModified ?? null, titles }))
  const kitsuBytes = compress([...kitsu.values()].sort((a, b) => Number(a.id) - Number(b.id)).map(row => `${JSON.stringify(row)}\n`).join(''))
  const assets = {
    anidb: asset('anidb-titles', '.json.zst', anidbBytes, anidb.titles.size),
    kitsu: asset('kitsu', '.jsonl.zst', kitsuBytes, kitsu.size),
  }
  return {
    manifest: `${JSON.stringify({ assets, ...fields }, null, 1)}\n`,
    assets: { [assets.anidb.name]: anidbBytes, [assets.kitsu.name]: kitsuBytes },
  }
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
  for (const kind of ['anidb', 'kitsu']) {
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

/**
 * A history read back from its files: `{ manifest, anidb, kitsu }` as `encodeHistory` takes them. Fails loudly on
 * any asset that is missing, does not match its sha256, does not parse, or holds another row count than its own
 * manifest entry records, so a damaged history is never read as a smaller one.
 */
export const decodeHistory = files => {
  const manifest = readManifest(files.manifest)
  let anidb
  let kitsu
  try {
    anidb = JSON.parse(assetText(files, manifest.assets.anidb))
    kitsu = assetText(files, manifest.assets.kitsu).split('\n').filter(Boolean).map(line => JSON.parse(line))
  } catch (error) {
    throw error.message.startsWith('the offline history') ? error : unreadable(`an asset does not parse (${error.message})`)
  }
  const titles = new Map(Object.entries(anidb.titles ?? {}).map(([aid, list]) => [Number(aid), list]))
  rowsChecked(manifest.assets.anidb, titles.size)
  rowsChecked(manifest.assets.kitsu, kitsu.length)
  return {
    manifest,
    anidb: { fetchedAt: anidb.fetchedAt, lastModified: anidb.lastModified, titles },
    kitsu: new Map(kitsu.map(row => [Number(row.id), row])),
  }
}

const download = async (get, url) => {
  const response = await get(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Each asset a manifest names, downloaded from the release. */
const downloadAssets = async (manifestText, get = fetch) => {
  const { assets } = readManifest(manifestText)
  const files = {}
  for (const { name } of Object.values(assets)) files[name] = await download(get, `${DOWNLOAD}/${name}`)
  return files
}

/**
 * The published history's files, from github.com. The manifest is asked again once after `pauseMs` when the first
 * answer fails, which covers the seconds a publish replaces it. Throws, saying why, when it cannot be read.
 */
export const downloadHistory = async ({ get = fetch, pauseMs = MANIFEST_RETRY_MS } = {}) => {
  let manifest
  try {
    manifest = await download(get, `${DOWNLOAD}/${MANIFEST}`)
  } catch {
    await new Promise(resolve => setTimeout(resolve, pauseMs))
    manifest = await download(get, `${DOWNLOAD}/${MANIFEST}`)
  }
  const text = manifest.toString('utf8')
  return { manifest: text, assets: await downloadAssets(text, get) }
}
