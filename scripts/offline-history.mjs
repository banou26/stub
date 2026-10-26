#!/usr/bin/env node
// The Offline history workflow's job (HOR-915, .github/workflows/offline-history.yml): gathers what the offline
// history holds and publishes it as release assets (./history-files.mjs), which every data build reads. What it asks
// is also kept in the private source store (HOR-994, ./source-store.mjs) when the workflow has its secrets.
//
// The only code that asks AniDB, and the only code that asks Kitsu for the history. It refuses to run outside that
// workflow, so a local run, a test or a Pages build cannot reach AniDB through it.
//
// AniDB allows one download of its titles file a day, and asking again the same day can get the address refused.
// So the attempt is recorded in an asset of its own BEFORE the request, and the next request waits until that
// record is 24 hours old: a 304 morning followed by a manual run, a run that fails after asking and is re-run, or
// two manual runs, can never ask twice in a day.

import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

import { SEASON_ORDER, catalogIds, downloadDump } from './build-anime-data.mjs'
import { MANIFEST, REPOSITORY, TAG, decodeHistory, encodeHistory, manifestCopy, readManifest } from './history-files.mjs'
import { errorText } from './season-popularity.mjs'
import { SECRETS, keepAnswers, r2, readStore } from './source-store.mjs'

const WORKFLOW = 'Offline history'
const API = `https://api.github.com/repos/${REPOSITORY}`
const UPLOADS = `https://uploads.github.com/repos/${REPOSITORY}`
export const ATTEMPT = 'anidb-attempt.json'
const USER_AGENT = 'stub-offline-history (+https://github.com/banou26/stub)'
const GITHUB_TIMEOUT_MS = 120_000

const ANIDB_TITLES = 'https://anidb.net/api/anime-titles.xml.gz'
const ANIDB_TIMEOUT_MS = 60_000
const ANIDB_MIN_SHOWS = 15_000
const DAY_MS = 86_400_000

const KITSU = 'https://kitsu.io/api/edge/anime'
const KITSU_FIELDS = ['titles', 'canonicalTitle', 'synopsis', 'posterImage', 'coverImage', 'subtype', 'status', 'startDate', 'endDate', 'episodeCount']
// the sizes kitsu's `normalizeMedia` takes, in its order
const KITSU_IMAGES = { posterImage: ['original', 'large', 'medium'], coverImage: ['original', 'large'] }
// Kitsu's largest page
const KITSU_IDS = 20
const KITSU_PAUSE_MS = 1_000
const KITSU_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000]

// A checkpoint closes once the dump's cut is this many seasons after it, since Kitsu's synopses and posters keep
// being edited while a show airs. One season would ask 32 requests a refresh on 2026-43 instead of 52.
const SEASONS_OPEN = 4

const log = (...args) => console.log('[offline-history]', ...args)
const warn = text => console.log(`::warning::[offline-history] ${text}`)
const sleeping = ms => new Promise(resolve => setTimeout(resolve, ms))

/* --------------------------------------------------------------------------------------------- */
/* AniDB                                                                                            */
/* --------------------------------------------------------------------------------------------- */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' }

// One level, as an XML parser decodes. The file escapes some titles twice, and api.ani.zip passes the second level
// on as written, so it is left for the anizip source's own decode, which the history's pick runs too.
const xmlText = text => text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi, (_, hex, decimal, name) =>
  hex ? String.fromCodePoint(parseInt(hex, 16)) : decimal ? String.fromCodePoint(Number(decimal)) : ENTITIES[name.toLowerCase()])

/**
 * AniDB's titles file as `{ shows, titles }`: how many shows it lists, and a Map of each one's English and Japanese
 * titles as `[type, language, title]`, in the file's order, which is what api.ani.zip's choice reads.
 */
export const parseAnidbTitles = xml => {
  const titles = new Map()
  let shows = 0
  for (const [, aid, body] of xml.matchAll(/<anime aid="(\d+)">([\s\S]*?)<\/anime>/g)) {
    shows++
    const own = []
    for (const [, attributes, text] of body.matchAll(/<title ([^>]*)>([^<]*)<\/title>/g)) {
      const language = /xml:lang="([^"]*)"/.exec(attributes)?.[1]
      if (language === 'en' || language === 'ja') own.push([/type="([^"]*)"/.exec(attributes)?.[1] ?? '', language, xmlText(text)])
    }
    if (own.length) titles.set(Number(aid), own)
  }
  return { shows, titles }
}

/**
 * Whether this run may ask AniDB: `ask`; `wait`, when the last attempt is under 24 hours old; or `record`, when the
 * release holds no readable record of one, which is then written and nothing asked, so a lost record fails closed.
 * Only a release that does not exist yet asks with no record, since no record can exist there.
 */
export const anidbTurn = ({ released, attempt, now }) => {
  if (!released) return 'ask'
  const at = Date.parse(attempt?.attemptedAt)
  if (!Number.isFinite(at)) return 'record'
  return now - at >= DAY_MS ? 'ask' : 'wait'
}

/**
 * The one request for AniDB's titles file: `If-Modified-Since` when a copy's date is known, a user agent naming
 * stub, no retry. `{ outcome }`, with `titles`, `lastModified`, the file's `xml` and its gzip `file` only on a 200
 * that parses to enough shows.
 */
export const askAnidb = async ({ get = fetch, lastModified } = {}) => {
  try {
    const response = await get(ANIDB_TITLES, {
      headers: { 'user-agent': USER_AGENT, ...lastModified && { 'if-modified-since': lastModified } },
      signal: AbortSignal.timeout(ANIDB_TIMEOUT_MS),
    })
    if (response.status === 304) return { outcome: '304' }
    if (response.status !== 200) return { outcome: `HTTP ${response.status}` }
    const bytes = Buffer.from(await response.arrayBuffer())
    // gzip unless something on the way already decoded it
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b
    const xml = (gzip ? gunzipSync(bytes) : bytes).toString('utf8')
    const { shows, titles } = parseAnidbTitles(xml)
    if (shows < ANIDB_MIN_SHOWS) return { outcome: `only ${shows} shows` }
    return { outcome: '200', titles, lastModified: response.headers.get('last-modified'), xml, file: gzip ? bytes : gzipSync(bytes) }
  } catch (error) {
    return { outcome: errorText(error) }
  }
}

/* --------------------------------------------------------------------------------------------- */
/* Kitsu                                                                                            */
/* --------------------------------------------------------------------------------------------- */

/** A Kitsu resource as the history keeps it: the attributes the kitsu source and the checkpoints read. */
export const kitsuRow = ({ id, attributes = {} }, fetchedAt) => {
  const kept = {}
  for (const field of KITSU_FIELDS) {
    const value = attributes[field]
    if (value === null || value === undefined) continue
    kept[field] = KITSU_IMAGES[field]
      ? Object.fromEntries(KITSU_IMAGES[field].filter(size => value[size]).map(size => [size, value[size]]))
      : value
  }
  return { id: String(id), fetchedAt, attributes: kept }
}

/** A Kitsu resource as the source store keeps it: a JSON:API document of its own, with the resources it links. */
export const kitsuBody = (resource, included = []) => {
  const linked = new Set(Object.values(resource.relationships ?? {}).flatMap(({ data }) => [data ?? []].flat()).map(({ type, id }) => `${type}/${id}`))
  return JSON.stringify({ data: resource, included: included.filter(({ type, id }) => linked.has(`${type}/${id}`)) })
}

const transient = status => typeof status !== 'number' || status === 429 || status >= 500

/**
 * Kitsu's whole resources for `ids` with their mappings, 20 a request, one request at a time and `pauseMs` apart:
 * `rows` as the history keeps them, `answers` as the source store does. A 429, a 5xx or a failed request is asked
 * again after each wait of `backoff`, and after the last nothing more is asked this run: `complete` says whether
 * every id was asked.
 */
export const askKitsu = async (ids, { get = fetch, sleep = sleeping, pauseMs = KITSU_PAUSE_MS, backoff = KITSU_BACKOFF_MS } = {}) => {
  const rows = []
  const answers = []
  let requests = 0
  for (let start = 0; start < ids.length; start += KITSU_IDS) {
    if (start) await sleep(pauseMs)
    const url = `${KITSU}?filter%5Bid%5D=${ids.slice(start, start + KITSU_IDS).join(',')}&page%5Blimit%5D=${KITSU_IDS}&include=mappings`
    for (let attempt = 0; ; attempt++) {
      requests++
      const response = await get(url, {
        headers: { accept: 'application/vnd.api+json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      }).catch(error => ({ ok: false, status: errorText(error) }))
      if (response.ok) {
        const fetchedAt = new Date().toISOString()
        const { data, included } = await response.json()
        for (const resource of data ?? []) {
          rows.push(kitsuRow(resource, fetchedAt))
          answers.push({ id: String(resource.id), fetchedAt, body: kitsuBody(resource, included) })
        }
        break
      }
      if (!transient(response.status) || attempt >= backoff.length) return { rows, answers, requests, complete: false, stopped: String(response.status) }
      await sleep(backoff[attempt])
    }
  }
  return { rows, answers, requests, complete: true }
}

/* --------------------------------------------------------------------------------------------- */
/* the checkpoints                                                                                  */
/* --------------------------------------------------------------------------------------------- */

const seasonNumber = key => {
  const [year, season] = key.split('-')
  return Number(year) * 4 + SEASON_ORDER.indexOf(season)
}

const bucketOf = season => (season?.year && SEASON_ORDER.includes(season.season) ? `${season.year}-${season.season}` : 'NONE')

const keyOf = ids => (ids.mal ? `mal-${ids.mal}` : ids.anilist ? `anilist-${ids.anilist}` : ids.kitsu ? `kitsu-${ids.kitsu}` : undefined)

/**
 * A dump's YEAR-SEASON checkpoints. One closes once the dump's cut is `SEASONS_OPEN` seasons after it, and records
 * the dump it closed with (`previous` carries that across runs). Shows with no season share `NONE`, which never
 * closes. A show of a closed season that the dump or its own Kitsu row does not call finished is carried in `open`
 * rather than holding its season open, since One Piece is FALL 1999. `refresh` is the Kitsu ids a new dump asks
 * again: the open checkpoints' and the carried shows'. Nothing is ever reopened, and nothing is frozen either: every
 * build reads the dump itself anew.
 */
export const checkpointsOf = ({ entries, cut, tag, kitsu, previous = {} }) => {
  const now = cut.getUTCFullYear() * 4 + Math.floor(cut.getUTCMonth() / 3)
  const checkpoints = {}
  const open = []
  const refresh = new Set()
  const seen = new Set()
  for (const entry of entries) {
    const ids = catalogIds(entry)
    const key = keyOf(ids)
    if (!key || !entry.title || seen.has(key)) continue
    seen.add(key)
    const bucket = bucketOf(entry.animeSeason)
    const closed = bucket !== 'NONE' && seasonNumber(bucket) <= now - SEASONS_OPEN
    const checkpoint = checkpoints[bucket] ??= closed ? { shows: 0, closedWith: previous[bucket]?.closedWith ?? tag } : { shows: 0 }
    checkpoint.shows++
    const row = ids.kitsu ? kitsu.get(ids.kitsu) : undefined
    const finished = entry.status === 'FINISHED' && (!row || row.attributes.status === 'finished')
    if (closed && !finished) open.push(key)
    if (ids.kitsu && (!closed || !finished)) refresh.add(ids.kitsu)
  }
  return { checkpoints: Object.fromEntries(Object.entries(checkpoints).sort(([a], [b]) => a.localeCompare(b))), open, refresh: [...refresh] }
}

/* --------------------------------------------------------------------------------------------- */
/* GitHub                                                                                           */
/* --------------------------------------------------------------------------------------------- */

const named = (release, name) => release.assets.find(asset => asset.name === name)

/** The release's REST calls, keeping `release.assets` current as assets are uploaded and removed. */
export const github = (token, get = fetch) => {
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, 'x-github-api-version': '2022-11-28' }
  const ask = async (url, init = {}) => {
    const response = await get(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} answered HTTP ${response.status}`)
    return response
  }
  const upload = async (release, name, body) => {
    const response = await ask(`${UPLOADS}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body })
    release.assets.push(await response.json())
  }
  const remove = async (release, asset) => {
    await ask(`${API}/releases/assets/${asset.id}`, { method: 'DELETE' })
    release.assets = release.assets.filter(other => other !== asset)
  }
  return {
    /**
     * The release, or null only when GitHub answers 404 for its tag. Any other failure throws, so an outage is
     * never read as "no history yet", which would start a full crawl over.
     */
    release: async () => {
      const response = await get(`${API}/releases/tags/${TAG}`, { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`GET ${API}/releases/tags/${TAG} answered HTTP ${response.status}`)
      return response.json()
    },
    create: async () => (await ask(`${API}/releases`, {
      method: 'POST',
      // never the repository's latest release, which `releases/latest` would then name
      body: JSON.stringify({ tag_name: TAG, name: 'Offline history', body: 'Rolling assets, replaced by .github/workflows/offline-history.yml. Not a version.', make_latest: 'false' }),
    })).json(),
    download: async asset => Buffer.from(await (await ask(asset.url, { headers: { accept: 'application/octet-stream' } })).arrayBuffer()),
    upload,
    remove,
    /** Removes the asset of that name, then uploads the new one, as `gh release upload --clobber` does. */
    replace: async (release, name, body) => {
      const old = named(release, name)
      if (old) await remove(release, old)
      await upload(release, name, body)
    },
  }
}

/**
 * The published history as `{ files, history }`, or nothing when no publish ever finished. A manifest.json a failed
 * publish left missing is restored from its newest copy first, so neither this job nor a data build is stuck on it.
 */
const readPublished = async (gh, release) => {
  let manifest
  const current = named(release, MANIFEST)
  if (current) {
    manifest = (await gh.download(current)).toString('utf8')
  } else {
    const copy = release.assets
      .filter(asset => /^manifest-[0-9a-f]+\.json$/.test(asset.name))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    if (!copy) return undefined
    manifest = (await gh.download(copy)).toString('utf8')
    log(`${MANIFEST} is missing, restored from ${copy.name}`)
    await gh.replace(release, MANIFEST, manifest)
  }
  const assets = {}
  for (const { name } of Object.values(readManifest(manifest).assets)) {
    const asset = named(release, name)
    if (asset) assets[name] = await gh.download(asset)
  }
  const files = { manifest, assets }
  return { files, history: decodeHistory(files) }
}

const readAttempt = async (gh, release) => {
  const asset = named(release, ATTEMPT)
  if (!asset) return undefined
  try {
    return JSON.parse((await gh.download(asset)).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * New assets under their own names, then the manifest's copy, then manifest.json, then the removal of whatever
 * neither this manifest nor the one before names, so a reader sees the old set or the new one, never a mix.
 */
const publish = async (gh, release, files, previousManifest) => {
  for (const [name, bytes] of Object.entries(files.assets)) if (!named(release, name)) await gh.upload(release, name, bytes)
  const copy = manifestCopy(files.manifest)
  if (!named(release, copy)) await gh.upload(release, copy, files.manifest)
  await gh.replace(release, MANIFEST, files.manifest)
  const keep = new Set([MANIFEST, ATTEMPT, copy, ...Object.keys(files.assets)])
  if (previousManifest) {
    keep.add(manifestCopy(previousManifest))
    for (const { name } of Object.values(readManifest(previousManifest).assets)) keep.add(name)
  }
  for (const asset of release.assets) if (!keep.has(asset.name)) await gh.remove(release, asset)
}

/* --------------------------------------------------------------------------------------------- */
/* the run                                                                                          */
/* --------------------------------------------------------------------------------------------- */

/**
 * The If-Modified-Since that brings every copy of AniDB's file up to date: the oldest copy's date, or none when a
 * copy has none, as a release started over or a store not yet written has.
 */
export const anidbSince = dates => (dates.every(Boolean) ? dates.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : undefined)

/**
 * One run: read the published history (a build from scratch only when the release answers 404), take the newest
 * dump, ask AniDB when its turn has come and Kitsu when a new dump has, and publish only what changed. Then, when
 * `store` is given, keep what was asked in the source store, as `writer`'s run: a store that cannot be read or
 * written is skipped with a warning, and never fails the run.
 */
export const runHistory = async ({ token, get = fetch, dump = downloadDump, now = Date.now, sleep, pauseMs, backoff, store, writer }) => {
  const gh = github(token, get)
  let release = await gh.release()
  const previous = release ? await readPublished(gh, release) : undefined
  const { tag, meta, entries, sha256 } = await dump()
  log(`dump ${tag}, ${previous ? `history of dump ${previous.history.manifest.dump?.tag}` : 'no history yet, from scratch'}`)
  const stored = store && await readStore(store).catch(error => warn(`the source store is skipped this run: ${errorText(error)}`))

  let anidb = previous?.history.anidb ?? { fetchedAt: null, lastModified: null, titles: new Map() }
  let anidbAnswer
  const attempt = release ? await readAttempt(gh, release) : undefined
  const turn = anidbTurn({ released: Boolean(release), attempt, now: now() })
  if (turn === 'wait') {
    log(`AniDB: asked ${attempt.attemptedAt}, not again before 24 hours have passed`)
  } else {
    release ??= await gh.create()
    const record = { attemptedAt: new Date(now()).toISOString(), outcome: turn === 'ask' ? 'asking' : 'not asked: no readable record' }
    const recorded = await gh.replace(release, ATTEMPT, JSON.stringify(record)).then(() => true, error => {
      log(`AniDB: not asked, the attempt could not be recorded (${errorText(error)})`)
      return false
    })
    if (turn === 'ask' && recorded) {
      // the copies' date, so a 200 whose publish or store write then failed is asked for again rather than answered 304
      const answer = await askAnidb({ get, lastModified: anidbSince([anidb.lastModified, ...stored ? [stored.manifest.job['anidb-titles']?.lastModified] : []]) })
      log(`AniDB: ${answer.outcome}${answer.titles ? `, ${answer.titles.size} shows with an English or Japanese title` : ''}`)
      if (answer.titles) anidb = { fetchedAt: record.attemptedAt, lastModified: answer.lastModified, titles: answer.titles }
      anidbAnswer = { ...answer, fetchedAt: record.attemptedAt }
      await gh.replace(release, ATTEMPT, JSON.stringify({ ...record, outcome: answer.outcome }))
        .catch(error => log(`AniDB: the outcome could not be recorded (${errorText(error)})`))
    }
  }

  const kitsu = new Map(previous?.history.kitsu ?? [])
  const cut = new Date(`${meta.lastUpdate}T00:00:00Z`)
  const checkpoints = previous?.history.manifest.checkpoints
  let refreshedFor = previous?.history.manifest.kitsu?.refreshedFor ?? null
  let kitsuAnswers = []
  if (refreshedFor !== tag) {
    const { refresh } = checkpointsOf({ entries, cut, tag, kitsu, previous: checkpoints })
    const lacking = entries.map(entry => catalogIds(entry).kitsu).filter(id => id && !kitsu.has(id))
    const ids = [...new Set([...lacking, ...refresh])]
    const asked = await askKitsu(ids, { get, sleep, pauseMs, backoff })
    for (const row of asked.rows) kitsu.set(Number(row.id), row)
    kitsuAnswers = asked.answers
    log(`Kitsu: ${ids.length} ids asked in ${asked.requests} requests, ${asked.rows.length} rows${asked.complete ? '' : `, stopped on ${asked.stopped}, the next run goes on`}`)
    if (asked.complete) refreshedFor = tag
  }

  const plan = checkpointsOf({ entries, cut, tag, kitsu, previous: checkpoints })
  const files = encodeHistory({ anidb, kitsu, fields: { dump: { tag, sha256 }, kitsu: { refreshedFor }, checkpoints: plan.checkpoints, open: plan.open } })
  if (files.manifest === previous?.files.manifest) {
    log('nothing changed, nothing published')
  } else {
    release ??= await gh.create()
    await publish(gh, release, files, previous?.files.manifest)
    log(`published ${Object.keys(files.assets).join(', ')} and ${MANIFEST}`)
  }

  if (stored) {
    await keepAnswers(store, stored, { anidb: anidbAnswer, kitsu: kitsuAnswers, writer })
      .then(outcome => log(`the source store: ${outcome}`), error => warn(`the source store was not written: ${errorText(error)}`))
  }
}

/** `runHistory`'s options from the workflow's environment: the store only when every secret of `SECRETS` is set. */
export const runOptions = env => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return {
    token: env.GH_TOKEN,
    store: r2(env),
    writer: { by: 'offline-history', run: env.GITHUB_RUN_ID ?? null, stub: version, commit: env.GITHUB_SHA?.slice(0, 8) ?? null },
  }
}

const main = async () => {
  if (process.env.GITHUB_WORKFLOW !== WORKFLOW) {
    console.error(`[offline-history] REFUSING: this asks AniDB and Kitsu, so it runs only as the "${WORKFLOW}" workflow.`)
    process.exit(1)
  }
  if (!process.env.GH_TOKEN) {
    console.error('[offline-history] REFUSING: no GH_TOKEN to publish with.')
    process.exit(1)
  }
  const options = runOptions(process.env)
  if (!options.store) console.log(`::notice::[offline-history] the source store is skipped: ${SECRETS.filter(name => !process.env[name]).join(', ')} not set`)
  await runHistory(options)
}

if (import.meta.main) await main()
