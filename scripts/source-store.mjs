// The private dump of every source's own answers (HOR-994): the R2 bucket `stub-sources`. The Offline history job
// (./offline-history.mjs) writes it through R2's S3 API, and link previews write only its `inbox/`
// (src/preview/inbox.ts), which the job folds in and then removes. Nothing public reads it, and it holds public show
// data and dates only. What stub's merge chooses from it is published as the picks (./offline-history.mjs), and
// nothing else of it.
//
// manifest.json names each file with the sha256 of its decompressed text and its row count:
//   job/anidb-titles-<sha>.xml.gz   AniDB's titles file as fetched, every language
//   job/kitsu-<sha>.jsonl.zst       the newest Kitsu resource of each id asked, with its mappings, one line each
//   job/tvmaze-<sha>.jsonl.zst      the newest TVmaze show of each id, as its show index serves it
//   job/ann-<sha>.jsonl.zst         the newest `<item>` of each id in ANN's title report
//   job/animethemes-<sha>.jsonl.zst the newest AnimeThemes anime of each id, with its themes and external ids
//   answers/<source>-<sha>.jsonl.zst the newest answer a link preview got of each id, region and class of a source,
//                                   as stub's source made it
//   index-<sha>.jsonl.zst           one line per (source, id, region, class, form): when the source last answered,
//                                   when its answer last changed, the answer's sha256, and the run that last asked.
//                                   `form` is `upstream` for the job's files (absent on lines written before
//                                   previews were folded) and `answer` for `answers/`, so the job's Kitsu resource
//                                   and a preview's Kitsu answer of a show, which hash differently, keep a line each
// The job's TVmaze, ANN and AnimeThemes entries also carry what their next ask starts from (`nextPage`, `askedAt`).
// Names are content addressed and manifest.json is written last, so a reader sees the old set or the new one.

import { AwsClient } from 'aws4fetch'
import { constants, gunzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

import { mergedFields, sha256 } from './history-files.mjs'

export const BUCKET = 'stub-sources'
export const MANIFEST = 'manifest.json'
const INBOX = 'inbox/'
// the objects a run folds at most, and one list request's most; the rest wait for the next run
const INBOX_OBJECTS = 1_000
/** The workflow secrets the store is reached with. With any of them unset, the job skips the store. */
export const SECRETS = ['STUB_SOURCES_ACCOUNT_ID', 'STUB_SOURCES_ACCESS_KEY_ID', 'STUB_SOURCES_SECRET_ACCESS_KEY']
const TIMEOUT_MS = 120_000
const TYPES = { kitsu: 'application/vnd.api+json', tvmaze: 'application/json', ann: 'text/xml', animethemes: 'application/json' }

const short = text => sha256(text).slice(0, 16)
const compress = text => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_compressionLevel]: 19 } })
const jsonl = rows => rows.map(row => `${JSON.stringify(row)}\n`).join('')
const parsed = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line))
const keyOf = ({ source, id, region, class: kind, form = 'upstream' }) => [source, id, region, kind, form].join('\t')
const ordered = rows => rows.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id, 'en', { numeric: true }) || keyOf(a).localeCompare(keyOf(b)))
const names = manifest => new Set([manifest.index?.name, ...[manifest.job, manifest.answers ?? {}].flatMap(files => Object.values(files).map(file => file.name))].filter(Boolean))

/**
 * The bucket through R2's S3 API, or undefined when a secret of `SECRETS` is unset. `get` answers an object's
 * bytes, or null when the bucket holds no such key; `list` at most `max` keys under `prefix` in key order, from where
 * the list whose `next` is passed stopped, and `next` when there are others (R2 may answer fewer than `max`, even
 * none, before the end); every other answer that is not a success throws.
 */
export const r2 = (env, send = fetch) => {
  if (SECRETS.some(name => !env[name])) return undefined
  const signer = new AwsClient({ accessKeyId: env.STUB_SOURCES_ACCESS_KEY_ID, secretAccessKey: env.STUB_SOURCES_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
  const bucket = `https://${env.STUB_SOURCES_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}`
  const ask = async (method, key, body) => {
    const response = await send(await signer.sign(`${bucket}/${key}`, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS) }))
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
    list: async (prefix, max, next) => {
      const url = `${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${max}${next ? `&continuation-token=${encodeURIComponent(next)}` : ''}`
      const response = await send(await signer.sign(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }))
      if (!response.ok) throw new Error(`the list of ${prefix} answered HTTP ${response.status}`)
      const xml = await response.text()
      return { keys: [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(([, key]) => key), next: xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] }
    },
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

/** The rows of a file by id (or by `key`), or none when `file` (its manifest entry) is undefined. */
export const rowsOf = async (client, file, key = row => row.id) => new Map(file ? parsed(await readText(client, file)).map(row => [key(row), row]) : [])

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
export const dated = (before, { source, id, region = null, class: kind = 'full', form = 'upstream', sha256: hash, fetchedAt, partial = false, role = null, writer }) => ({
  source,
  id,
  region,
  class: kind,
  form,
  sha256: hash,
  fetchedAt,
  changedAt: before?.sha256 === hash ? before.changedAt : fetchedAt,
  partial,
  role,
  body: true,
  writer,
})

const inboxLine = ({ index, body }) =>
  ['source', 'id', 'class', 'sha256', 'fetchedAt'].every(field => typeof index[field] === 'string') && typeof JSON.parse(body.body) === 'object'

/**
 * The link previews' inbox: the `lines` of the objects named in `keys`, each `{ index, body }` as
 * src/preview/inbox.ts writes them, at most INBOX_OBJECTS objects a run (`more` when there are others), and
 * `unreadable`, the keys of objects that are no inbox object, which stay in the bucket. Those are listed past, not
 * counted, so however many there are, they never hold back the objects after them.
 */
export const readInbox = async client => {
  const keys = []
  const lines = []
  const unreadable = []
  let next
  do {
    const page = await client.list(INBOX, INBOX_OBJECTS - keys.length, next)
    next = page.next
    for (const key of page.keys) {
      try {
        const own = parsed(gunzipSync(await client.get(key)).toString('utf8'))
        if (!own.every(inboxLine)) throw new Error('not an inbox line')
        lines.push(...own)
        keys.push(key)
      } catch {
        unreadable.push(key)
      }
    }
  } while (next && keys.length < INBOX_OBJECTS)
  return { keys, lines, unreadable, more: Boolean(next) }
}

/**
 * Every answer link previews left in the store, for stub's merge (scripts/offline-pick.ts's `storedAnswers`):
 * `{ source, id, class, fetchedAt, role, run, media }`, the date and the role from its index line and only what the
 * merge reads of it. Never an answer of the offline source, which is the floor this merge makes: read back, the last
 * pick, or a bundled season's MyAnimeList synopsis under the offline origin, would re-enter the merge on every run.
 */
export const readAnswers = async (client, { manifest, index }) => {
  const answers = []
  for (const [source, file] of Object.entries(manifest.answers ?? {})) {
    if (source === 'offline') continue
    for (const [key, row] of await rowsOf(client, file, keyOf)) {
      const { fetchedAt, role } = index.get(key)
      answers.push({ source, id: row.id, class: row.class, fetchedAt, role, run: row.run, media: mergedFields(source, JSON.parse(row.body)) })
    }
  }
  return answers
}

/** Each show's sha256 in AniDB's titles file, over the whole `<anime>` element, by AniDB id. */
export const anidbShows = xml => new Map([...xml.matchAll(/<anime aid="(\d+)">[\s\S]*?<\/anime>/g)].map(([element, aid]) => [aid, sha256(element)]))

/**
 * Keeps what one run asked. `anidb` is AniDB's answer when it was asked (`{ outcome, fetchedAt }`, plus `xml`, the
 * gzip `file` and `lastModified` on a 200, which drops the lines of shows the file no longer lists); a 304 moves its
 * shows' `fetchedAt` and `writer` only. `kitsu` is Kitsu's answers as `{ id, fetchedAt, body }`, and `pulls` each
 * other source's, by source, as `{ answers, state, rows }`: `state` joins its manifest entry, and `rows`, when given,
 * is its file's rows as `rowsOf` read them, so keeping it reads no file. `inbox` is what `readInbox` read, whose
 * every answer replaces only an older one of its key, with its own writer, region, class, partial and role, but for
 * an answer that was a member of its run: only a later member takes its role and run, since a run that merely met the
 * id says nothing of the show it belongs to, and that run is the one join a source with no catalogue id has. New
 * files go up, then the index, then manifest.json, then whatever only the previous manifest named is removed.
 * Writes nothing when the manifest would not change. Answers what it did, for the log.
 */
export const keepAnswers = async (client, stored, { anidb, kitsu = [], pulls = {}, inbox, writer }) => {
  const index = new Map(stored.index)
  const job = { ...stored.manifest.job }
  const answers = { ...stored.manifest.answers }
  const files = []
  const date = answer => {
    const key = keyOf({ ...answer, region: null, class: 'full' })
    index.set(key, dated(index.get(key), answer))
  }

  if (anidb?.xml) {
    const shows = anidbShows(anidb.xml)
    for (const [key, line] of index) if (line.source === 'anidb-titles' && !shows.has(line.id)) index.delete(key)
    for (const [id, hash] of shows) date({ source: 'anidb-titles', id, sha256: hash, fetchedAt: anidb.fetchedAt, writer })
    job['anidb-titles'] = { name: `job/anidb-titles-${short(anidb.xml)}.xml.gz`, sha256: sha256(anidb.xml), rows: shows.size, lastModified: anidb.lastModified ?? null }
    files.push([job['anidb-titles'].name, anidb.file])
  } else if (anidb?.outcome === '304') {
    for (const [key, line] of index) if (line.source === 'anidb-titles') index.set(key, { ...line, fetchedAt: anidb.fetchedAt, writer })
  }

  const keep = async (source, asked, state, rows) => {
    const bodies = rows ?? await rowsOf(client, job[source])
    for (const { id, fetchedAt, body } of asked) {
      const hash = sha256(body)
      bodies.set(id, { source, id, form: 'upstream', type: TYPES[source], sha256: hash, body })
      date({ source, id, sha256: hash, fetchedAt, writer })
    }
    const text = jsonl(ordered([...bodies.values()]))
    job[source] = { ...job[source], name: `job/${source}-${short(text)}.jsonl.zst`, sha256: sha256(text), rows: bodies.size, ...state }
    files.push([job[source].name, text])
  }
  if (kitsu.length) await keep('kitsu', kitsu)
  for (const [source, pull] of Object.entries(pulls)) await keep(source, pull.answers, pull.state, pull.rows)

  const sorted = (inbox?.lines ?? []).toSorted((a, b) => Number(a.index.fetchedAt > b.index.fetchedAt) - Number(a.index.fetchedAt < b.index.fetchedAt))
  for (const [source, lines] of Map.groupBy(sorted, line => line.index.source)) {
    const rows = await rowsOf(client, answers[source], keyOf)
    for (const { index: line, body } of lines) {
      const answer = { ...line, form: 'answer' }
      const key = keyOf(answer)
      const held = index.get(key)
      if (held && held.fetchedAt >= line.fetchedAt) continue
      const member = held?.role === 'member' && line.role !== 'member' && rows.get(key)
      index.set(key, dated(held, member ? { ...answer, role: 'member' } : answer))
      rows.set(key, { source, id: line.id, region: line.region, class: line.class, form: 'answer', sha256: line.sha256, run: (member || body).run, operation: body.operation, selection: body.selection, body: body.body })
    }
    const text = jsonl(ordered([...rows.values()]))
    answers[source] = { name: `answers/${source}-${short(text)}.jsonl.zst`, sha256: sha256(text), rows: rows.size }
    files.push([answers[source].name, text])
  }

  const indexText = jsonl(ordered([...index.values()]))
  const manifest = { index: { name: `index-${short(indexText)}.jsonl.zst`, sha256: sha256(indexText), rows: index.size }, job, answers }
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
