// The private dump of every source's own answers (HOR-994): the R2 bucket `stub-sources`, which only the Offline
// history job (./offline-history.mjs) writes, through R2's S3 API. Nothing public reads it, and it holds public show
// data and dates only.
//
// manifest.json names each file with the sha256 of its decompressed text and its row count:
//   job/anidb-titles-<sha>.xml.gz  AniDB's titles file as fetched, every language
//   job/kitsu-<sha>.jsonl.zst      the newest Kitsu resource of each id asked, with its mappings, one line each
//   index-<sha>.jsonl.zst          one line per (source, id, region, class): when the source last answered, when
//                                  its answer last changed, the answer's sha256, and the run that last asked
// Names are content addressed and manifest.json is written last, so a reader sees the old set or the new one.

import { AwsClient } from 'aws4fetch'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

import { sha256 } from './history-files.mjs'

export const BUCKET = 'stub-sources'
export const MANIFEST = 'manifest.json'
/** The workflow secrets the store is reached with. With any of them unset, the job skips the store. */
export const SECRETS = ['STUB_SOURCES_ACCOUNT_ID', 'STUB_SOURCES_ACCESS_KEY_ID', 'STUB_SOURCES_SECRET_ACCESS_KEY']
const TIMEOUT_MS = 120_000

const short = text => sha256(text).slice(0, 16)
const compress = text => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_compressionLevel]: 19 } })
const jsonl = rows => rows.map(row => `${JSON.stringify(row)}\n`).join('')
const parsed = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line))
const ordered = rows => rows.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id, 'en', { numeric: true }))
const keyOf = ({ source, id, region, class: kind }) => [source, id, region, kind].join('\t')
const names = manifest => new Set([manifest.index?.name, ...Object.values(manifest.job).map(file => file.name)].filter(Boolean))

/**
 * The bucket through R2's S3 API, or undefined when a secret of `SECRETS` is unset. `get` answers an object's
 * bytes, or null when the bucket holds no such key; every other answer that is not a success throws.
 */
export const r2 = (env, send = fetch) => {
  if (SECRETS.some(name => !env[name])) return undefined
  const signer = new AwsClient({ accessKeyId: env.STUB_SOURCES_ACCESS_KEY_ID, secretAccessKey: env.STUB_SOURCES_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
  const ask = async (method, key, body) => {
    const url = `https://${env.STUB_SOURCES_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`
    const response = await send(await signer.sign(url, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS) }))
    if (method === 'GET' && response.status === 404) return null
    if (!response.ok) throw new Error(`${method} ${key} answered HTTP ${response.status}`)
    return response
  }
  return {
    get: async key => {
      const response = await ask('GET', key)
      return response && Buffer.from(await response.arrayBuffer())
    },
    put: async (key, bytes) => { await ask('PUT', key, bytes) },
    remove: async key => { await ask('DELETE', key) },
  }
}

const unreadable = detail => new Error(`the source store is unreadable: ${detail}`)

const readText = async (client, file) => {
  const bytes = await client.get(file.name)
  if (!bytes) throw unreadable(`${file.name} is missing`)
  const text = zstdDecompressSync(bytes).toString('utf8')
  if (sha256(text) !== file.sha256) throw unreadable(`${file.name} does not match its sha256`)
  return text
}

/**
 * The store as the last run left it: manifest.json's `text` and fields, and the index's lines by key. An empty
 * store when the bucket holds no manifest yet; throws when a file it names is missing or damaged.
 */
export const readStore = async client => {
  const text = (await client.get(MANIFEST))?.toString('utf8') ?? null
  if (!text) return { text, manifest: { index: null, job: {} }, index: new Map() }
  const manifest = JSON.parse(text)
  const lines = manifest.index ? parsed(await readText(client, manifest.index)) : []
  return { text, manifest, index: new Map(lines.map(line => [keyOf(line), line])) }
}

/**
 * The index line for an answer of hash `sha256` that `writer`'s run got at `fetchedAt`, given the line `before` it
 * for the same key. `changedAt` stays while the hash does, and moves to `fetchedAt` on a first or a changed answer.
 */
export const dated = (before, { source, id, sha256: hash, fetchedAt, writer }) => ({
  source,
  id,
  region: null,
  class: 'full',
  sha256: hash,
  fetchedAt,
  changedAt: before?.sha256 === hash ? before.changedAt : fetchedAt,
  partial: false,
  role: null,
  body: true,
  writer,
})

/** Each show's sha256 in AniDB's titles file, over the whole `<anime>` element, by AniDB id. */
export const anidbShows = xml => new Map([...xml.matchAll(/<anime aid="(\d+)">[\s\S]*?<\/anime>/g)].map(([element, aid]) => [aid, sha256(element)]))

/**
 * Keeps what one run asked. `anidb` is AniDB's answer when it was asked (`{ outcome, fetchedAt }`, plus `xml`, the
 * gzip `file` and `lastModified` on a 200); a 304 moves its shows' `fetchedAt` only. `kitsu` is Kitsu's answers as
 * `{ id, fetchedAt, body }`. New files go up, then the index, then manifest.json, then whatever only the previous
 * manifest named is removed. Writes nothing when the manifest would not change. Answers what it did, for the log.
 */
export const keepAnswers = async (client, stored, { anidb, kitsu = [], writer }) => {
  const index = new Map(stored.index)
  const job = { ...stored.manifest.job }
  const files = []
  const date = answer => {
    const key = keyOf({ ...answer, region: null, class: 'full' })
    index.set(key, dated(index.get(key), answer))
  }

  if (anidb?.xml) {
    const shows = anidbShows(anidb.xml)
    for (const [id, hash] of shows) date({ source: 'anidb-titles', id, sha256: hash, fetchedAt: anidb.fetchedAt, writer })
    job['anidb-titles'] = { name: `job/anidb-titles-${short(anidb.xml)}.xml.gz`, sha256: sha256(anidb.xml), rows: shows.size, lastModified: anidb.lastModified ?? null }
    files.push([job['anidb-titles'].name, anidb.file])
  } else if (anidb?.outcome === '304') {
    for (const [key, line] of index) if (line.source === 'anidb-titles') index.set(key, { ...line, fetchedAt: anidb.fetchedAt, writer })
  }

  if (kitsu.length) {
    const bodies = new Map(job.kitsu ? parsed(await readText(client, job.kitsu)).map(row => [row.id, row]) : [])
    for (const { id, fetchedAt, body } of kitsu) {
      const hash = sha256(body)
      bodies.set(id, { source: 'kitsu', id, form: 'upstream', type: 'application/vnd.api+json', sha256: hash, body })
      date({ source: 'kitsu', id, sha256: hash, fetchedAt, writer })
    }
    const text = jsonl(ordered([...bodies.values()]))
    job.kitsu = { name: `job/kitsu-${short(text)}.jsonl.zst`, sha256: sha256(text), rows: bodies.size }
    files.push([job.kitsu.name, text])
  }

  const indexText = jsonl(ordered([...index.values()]))
  const manifest = { index: { name: `index-${short(indexText)}.jsonl.zst`, sha256: sha256(indexText), rows: index.size }, job }
  const text = `${JSON.stringify(manifest, null, 1)}\n`
  if (text === stored.text) return 'nothing changed'
  files.push([manifest.index.name, indexText])

  const before = names(stored.manifest)
  const written = []
  for (const [name, content] of files) {
    if (before.has(name)) continue
    await client.put(name, typeof content === 'string' ? compress(content) : content)
    written.push(name)
  }
  await client.put(MANIFEST, text)
  const after = names(manifest)
  for (const name of before) if (!after.has(name)) await client.remove(name)
  return `${index.size} lines, wrote ${[...written, MANIFEST].join(', ')}`
}
