#!/usr/bin/env node
// The Offline history workflow's job (HOR-915, .github/workflows/offline-history.yml): gathers what the offline
// history holds and publishes it as release assets (./history-files.mjs), which every data build reads. What it asks
// is also kept in the private source store (HOR-994, ./source-store.mjs) when the workflow has its secrets, with three
// sources only the store keeps: TVmaze's show index, ANN's title report and AnimeThemes' catalogue. It also folds the
// store's inbox, what link previews' sources answered, into the store, and what anizip and Kitsu answered there into
// the history. Last, it runs stub's own merge and publishes what it chose per show, the picks, which a data build ships
// when they are of its own merge and dump (HOR-1029).
//
// The only code that asks AniDB, the only code that asks Kitsu for the history, and the only code that asks those
// three for their whole catalogues. It refuses to run outside that workflow, so a local run, a test or a Pages build
// cannot reach any of them through it.
//
// AniDB allows one download of its titles file a day, and asking again the same day can get the address refused.
// So the attempt is recorded in an asset of its own BEFORE the request, and the next request waits until that
// record is 24 hours old: a 304 morning followed by a manual run, a run that fails after asking and is re-run, or
// two manual runs, can never ask twice in a day.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

import { SEASON_ORDER, buildExtract, catalogIds, downloadDump } from './build-anime-data.mjs'
import { MANIFEST, REPOSITORY, TAG, decodeHistory, encodeHistory, encodePicks, foldPreviews, loadMerge, manifestCopy, readManifest, withPicks } from './history-files.mjs'
import { errorText } from './season-popularity.mjs'
import { SECRETS, keepAnswers, r2, readAnswers, readInbox, readStore, rowsOf } from './source-store.mjs'

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

const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000]
const REQUEST_TIMEOUT_MS = 60_000

// A checkpoint closes once the dump's cut is this many seasons after it, since Kitsu's synopses and posters keep
// being edited while a show airs. One season would ask 32 requests a refresh on 2026-43 instead of 52.
const SEASONS_OPEN = 4

const log = (...args) => console.log('[offline-history]', ...args)
const warn = text => console.log(`::warning::[offline-history] ${text}`)
const sleeping = ms => new Promise(resolve => setTimeout(resolve, ms))

const transient = status => typeof status !== 'number' || status === 429 || status >= 500

/**
 * One source's requests for a run, one at a time and `pauseMs` apart. `ask` asks a 429, a 5xx or a failed request
 * again after each wait of `backoff`, and answers the last response, or `{ ok: false, status }` with the error's text
 * for a request that failed. `requests` counts every attempt.
 */
export const asking = ({ get = fetch, sleep = sleeping, pauseMs, backoff = BACKOFF_MS }) => {
  const asker = {
    requests: 0,
    ask: async (url, init) => {
      if (asker.requests) await sleep(pauseMs)
      for (let attempt = 0; ; attempt++) {
        asker.requests++
        const response = await get(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(error => ({ ok: false, status: errorText(error) }))
        if (response.ok || !transient(response.status) || attempt >= backoff.length) return response
        await sleep(backoff[attempt])
      }
    },
  }
  return asker
}

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

/**
 * Kitsu's whole resources for `ids` with their mappings, 20 a request, as `asking` asks: `rows` as the history keeps
 * them, `answers` as the source store does, and `complete`, whether every id was asked before Kitsu stopped it.
 */
export const askKitsu = async (ids, { pauseMs = KITSU_PAUSE_MS, ...options } = {}) => {
  const asker = asking({ pauseMs, ...options })
  const rows = []
  const answers = []
  for (let start = 0; start < ids.length; start += KITSU_IDS) {
    const url = `${KITSU}?filter%5Bid%5D=${ids.slice(start, start + KITSU_IDS).join(',')}&page%5Blimit%5D=${KITSU_IDS}&include=mappings`
    const response = await asker.ask(url, { headers: { accept: 'application/vnd.api+json', 'user-agent': USER_AGENT } })
    if (!response.ok) return { rows, answers, requests: asker.requests, complete: false, stopped: String(response.status) }
    const fetchedAt = new Date().toISOString()
    const { data, included } = await response.json()
    for (const resource of data ?? []) {
      rows.push(kitsuRow(resource, fetchedAt))
      answers.push({ id: String(resource.id), fetchedAt, body: kitsuBody(resource, included) })
    }
  }
  return { rows, answers, requests: asker.requests, complete: true }
}

/* --------------------------------------------------------------------------------------------- */
/* the sources only the source store keeps                                                          */
/* --------------------------------------------------------------------------------------------- */

const TVMAZE_INDEX = 'https://api.tvmaze.com/shows?page='
const TVMAZE_UPDATES = 'https://api.tvmaze.com/updates/shows'
const TVMAZE_SHOW = 'https://api.tvmaze.com/shows/'
// TVmaze allows at least 20 calls every 10 seconds
const TVMAZE_PAUSE_MS = 500
// about 13 minutes of asking; the rest stay older than the updates list, so the next run asks them
const TVMAZE_SHOWS = 1_000

const ANN_REPORT = 'https://cdn.animenewsnetwork.com/encyclopedia/reports.xml?id=155&type=anime&nlist='
// the whole report listed 12,863 anime on 2026-10-25, so one far shorter is not ANN's report
const ANN_MIN_TITLES = 10_000

const ANIMETHEMES = 'https://graphql.animethemes.moe/'
// AnimeThemes allows 90 requests a minute
const ANIMETHEMES_PAUSE_MS = 1_000
// the animethemes source's own selection, plus each anime's titles, season and external ids
const ANIMETHEMES_CATALOGUE = `
  query ($page: Int!) {
    animePagination(first: 100, page: $page, sort: ID) {
      paginatorInfo { hasMorePages }
      data {
        id
        slug
        title { romaji english native }
        format
        season
        year
        synopsis
        updatedAt
        resources { nodes { site externalId link } }
        animethemes {
          id
          type
          sequence
          slug
          song {
            title { romaji native }
            performances { as alias artist { name { main } } }
          }
          animethemeentries {
            version
            episodes
            nsfw
            spoiler
            videos { nodes { link resolution } }
          }
        }
      }
    }
  }
`

/** How many UTC days have begun since `at`, Infinity when there is none. */
export const daysSince = (at, now) => (at ? Math.floor(now / DAY_MS) - Math.floor(Date.parse(at) / DAY_MS) : Infinity)

const stamp = now => new Date(now()).toISOString()
const ACCEPT_JSON = { accept: 'application/json', 'user-agent': USER_AGENT }

/**
 * TVmaze's show index, as `asking` asks, given `kept`, its manifest entry, and `rows`, which reads the stored shows.
 * Until a page answers the 404 that ends the index, its pages from `nextPage` on, 250 show ids each. After that, once
 * a UTC day, the updates list, and each show it dates later than the stored copy's `updated`, or that the store
 * lacks, at most TVMAZE_SHOWS a run. `askedAt` is when what the store holds was known current: the index read's first
 * page, or the last list whose every show was asked. The list is the last week's while that is fewer than 6 UTC days
 * back, which leaves a day for the index's 24 hours of caching, and the whole one otherwise. Answers
 * `{ answers, state }` and `stopped` when TVmaze stopped it, or undefined when not due.
 */
export const askTvmaze = async ({ kept, rows, now, ...options }) => {
  const asker = asking({ pauseMs: TVMAZE_PAUSE_MS, ...options })
  const answers = []
  const stopped = (response, state) => ({ answers, state, stopped: String(response.status), requests: asker.requests })
  if (!kept || kept.nextPage !== null) {
    const askedAt = kept?.askedAt ?? stamp(now)
    for (let page = kept?.nextPage ?? 0; ; page++) {
      const response = await asker.ask(`${TVMAZE_INDEX}${page}`, { headers: ACCEPT_JSON })
      if (response.status === 404) return { answers, state: { nextPage: null, askedAt }, requests: asker.requests }
      if (!response.ok) return stopped(response, { nextPage: page, askedAt })
      const fetchedAt = stamp(now)
      for (const show of await response.json()) answers.push({ id: String(show.id), fetchedAt, body: JSON.stringify(show) })
    }
  }
  const days = daysSince(kept.askedAt, now())
  if (days < 1) return undefined
  const updated = new Map([...await rows()].map(([id, row]) => [id, JSON.parse(row.body).updated]))
  const listedAt = stamp(now)
  const listed = await asker.ask(`${TVMAZE_UPDATES}${days < 6 ? '?since=week' : ''}`, { headers: ACCEPT_JSON })
  if (!listed.ok) return stopped(listed)
  const changed = Object.entries(await listed.json())
    .filter(([id, at]) => !(updated.get(id) >= at))
    .map(([id]) => id)
    .sort((a, b) => a - b)
  for (const id of changed.slice(0, TVMAZE_SHOWS)) {
    const response = await asker.ask(`${TVMAZE_SHOW}${id}`, { headers: ACCEPT_JSON })
    // gone since the list was made
    if (response.status === 404) continue
    if (!response.ok) return stopped(response)
    answers.push({ id, fetchedAt: stamp(now), body: JSON.stringify(await response.json()) })
  }
  return { answers, state: changed.length > TVMAZE_SHOWS ? undefined : { askedAt: listedAt }, requests: asker.requests }
}

/**
 * ANN's title report, given `kept`, its manifest entry: the whole report first, then once a UTC day the titles added
 * since, 50 a day as ANN's API page asks (`nlist`). Each `<item>` is an answer, by its id. Answers `{ answers, state }`
 * and `stopped` when ANN stopped it, or undefined when not due.
 */
export const askAnn = async ({ kept, now, ...options }) => {
  const days = daysSince(kept?.askedAt, now())
  if (days < 1) return undefined
  const asker = asking({ pauseMs: 0, ...options })
  const response = await asker.ask(`${ANN_REPORT}${kept ? 50 * days : 'all'}`, { headers: { accept: 'text/xml', 'user-agent': USER_AGENT } })
  if (!response.ok) return { answers: [], stopped: String(response.status), requests: asker.requests }
  const fetchedAt = stamp(now)
  const answers = [...(await response.text()).matchAll(/<item><id>(\d+)<\/id>[\s\S]*?<\/item>/g)].map(([body, id]) => ({ id, fetchedAt, body }))
  if (!kept && answers.length < ANN_MIN_TITLES) return { answers: [], stopped: `only ${answers.length} titles`, requests: asker.requests }
  return { answers, state: { askedAt: fetchedAt }, requests: asker.requests }
}

/**
 * AnimeThemes' whole catalogue, given `kept`, its manifest entry: every anime in id order, 100 a request, once every
 * 7 UTC days. A pull cut short keeps what came and is asked whole again the next run. Answers `{ answers, state }`
 * and `stopped` when AnimeThemes stopped it, or undefined when not due.
 */
export const askAnimethemes = async ({ kept, now, ...options }) => {
  if (daysSince(kept?.askedAt, now()) < 7) return undefined
  const asker = asking({ pauseMs: ANIMETHEMES_PAUSE_MS, ...options })
  const answers = []
  const headers = { ...ACCEPT_JSON, 'content-type': 'application/json' }
  for (let page = 1; ; page++) {
    const response = await asker.ask(ANIMETHEMES, { method: 'POST', headers, body: JSON.stringify({ query: ANIMETHEMES_CATALOGUE, variables: { page } }) })
    if (!response.ok) return { answers, stopped: String(response.status), requests: asker.requests }
    // GraphQL answers its errors with a 200
    const { data, errors } = await response.json()
    const listing = data?.animePagination
    if (errors?.length || !listing) return { answers, stopped: errors?.[0]?.message ?? 'no data', requests: asker.requests }
    const fetchedAt = stamp(now)
    for (const anime of listing.data) answers.push({ id: String(anime.id), fetchedAt, body: JSON.stringify(anime) })
    if (!listing.paginatorInfo.hasMorePages || !listing.data.length) return { answers, state: { askedAt: fetchedAt }, requests: asker.requests }
  }
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
 * The published history as `{ files, history, picks }`, `picks` as `encodePicks` answers them when it names any it can
 * read, or nothing when no publish ever finished. A manifest.json a failed publish left missing is restored from its newest
 * copy first, so neither this job nor a data build is stuck on it.
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
  const history = decodeHistory(files)
  if (history.picksUnread) warn(`the published picks are dropped: ${history.picksUnread}`)
  const entry = history.manifest.assets.picks
  return { files, history, picks: history.picks && { entry, bytes: assets[entry.name] } }
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
 * Asks each source only the store keeps when its change signal says so, and keeps what came in one write. A source's
 * stored rows are read within its own asking, so one that fails to be asked or read is skipped with a warning and
 * leaves the others as they are. Answers what the write did, or undefined when nothing came.
 */
const keepSources = async (store, { writer, ...options }) => {
  const stored = await readStore(store)
  const pulls = {}
  for (const [source, ask] of Object.entries({ tvmaze: askTvmaze, ann: askAnn, animethemes: askAnimethemes })) {
    const kept = stored.manifest.job[source]
    let reading
    const rows = () => (reading ??= rowsOf(store, kept))
    try {
      const pulled = await ask({ ...options, kept, rows })
      if (!pulled) {
        log(`${source}: not due`)
        continue
      }
      log(`${source}: ${pulled.answers.length} answers in ${pulled.requests} requests${pulled.stopped ? `, stopped on ${pulled.stopped}, the next run goes on` : ''}`)
      if (pulled.answers.length || pulled.state) pulls[source] = { ...pulled, rows: await rows() }
    } catch (error) {
      warn(`${source} is skipped this run: ${errorText(error)}`)
    }
  }
  return Object.keys(pulls).length ? keepAnswers(store, stored, { pulls, writer }) : undefined
}

/**
 * Stub's merge of what this run holds and of every answer `store` keeps, as `encodePicks` answers it, stamped with the
 * merge's version and `dump`. Only the winning values leave the store.
 */
const makePicks = async ({ merge, store, dump, anidb, kitsu, previews }) => {
  const { module, version } = await merge()
  const records = buildExtract(dump).history
  const answers = await readAnswers(store, await readStore(store))
  const { picks, counts } = module.historyPicks(records, anidb.titles, kitsu, previews, module.storedAnswers(records, answers))
  log(`the picks: ${picks.size} of ${counts.records} shows, ${counts.stored} of them with some of the store's ${answers.length} answers, merge ${version}`)
  return encodePicks(picks, { merge: version, dump: { tag: dump.tag, sha256: dump.sha256 } })
}

/**
 * One run: read the published history (a build from scratch only when the release answers 404), take the newest
 * dump, ask AniDB when its turn has come and Kitsu when a new dump has, fold in what the store's inbox holds of anizip
 * and Kitsu, and publish only what changed. Then, when `store` is given, keep what AniDB and Kitsu answered and the
 * inbox in the source store, as `writer`'s run, remove the inbox objects it folded, and only then ask the sources
 * only the store keeps, which can take 20 minutes, and keep theirs in a second write. A store that cannot be read or
 * written is skipped with a warning, and never fails the run; an inbox it did not keep stays for the next run, whose
 * fold gives the same history. AniDB's file comes back to such a store with the next 200, but that run's Kitsu
 * answers do not, since Kitsu is asked again only for open seasons and unfinished shows; a warning counts them.
 * Last, with `merge` and a store this run could read, run the merge over what the store now holds and publish its
 * picks when they or their stamp changed. Until then the release keeps naming the last picks, and a merge that fails
 * is skipped with a warning, so a data build goes on shipping those, or its own merge when they are stale.
 */
export const runHistory = async ({ token, get = fetch, dump = downloadDump, now = Date.now, sleep, pauseMs, backoff, store, writer, merge }) => {
  const gh = github(token, get)
  let release = await gh.release()
  const previous = release ? await readPublished(gh, release) : undefined
  const newest = await dump()
  const { tag, meta, entries, sha256 } = newest
  log(`dump ${tag}, ${previous ? `history of dump ${previous.history.manifest.dump?.tag}` : 'no history yet, from scratch'}`)
  const stored = store && await readStore(store).catch(error => warn(`the source store is skipped this run: ${errorText(error)}`))
  const inbox = stored && await readInbox(store).catch(error => warn(`the previews' inbox is skipped this run: ${errorText(error)}`))
  if (inbox) {
    log(`the previews' inbox: ${inbox.lines.length} answers in ${inbox.keys.length} objects${inbox.more ? ', more the next run' : ''}`)
    for (const key of inbox.unreadable) warn(`${key} is no inbox object, left in the store`)
  }

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
  const previews = foldPreviews(previous?.history.previews ?? new Map(), inbox?.lines ?? [])
  const encoded = encodeHistory({ anidb, kitsu, previews, fields: { dump: { tag, sha256 }, kitsu: { refreshedFor }, checkpoints: plan.checkpoints, open: plan.open } })
  const files = previous?.picks ? withPicks(encoded, previous.picks) : encoded
  if (files.manifest === previous?.files.manifest) {
    log('nothing changed, nothing published')
  } else {
    release ??= await gh.create()
    await publish(gh, release, files, previous?.files.manifest)
    log(`published ${Object.keys(files.assets).join(', ')} and ${MANIFEST}`)
  }

  if (!store) return
  const outcome = stored && await keepAnswers(store, stored, { anidb: anidbAnswer, kitsu: kitsuAnswers, inbox, writer })
    .catch(error => warn(`the source store was not written: ${errorText(error)}`))
  if (outcome) log(`the source store: ${outcome}`)
  else if (kitsuAnswers.length) warn(`the source store lacks the ${kitsuAnswers.length} Kitsu answers this run asked, and only open seasons and unfinished shows are asked again`)
  if (!stored) return
  if (outcome && inbox?.keys.length) {
    try {
      for (const key of inbox.keys) await store.remove(key)
      log(`the previews' inbox: removed the ${inbox.keys.length} objects folded`)
    } catch (error) {
      warn(`the previews' inbox keeps objects already folded, which the next run folds again: ${errorText(error)}`)
    }
  }
  const kept = await keepSources(store, { get, sleep, backoff, now, writer })
    .catch(error => warn(`TVmaze, ANN and AnimeThemes were not kept this run: ${errorText(error)}`))
  if (kept) log(`the source store: ${kept}`)
  const picks = merge && await makePicks({ merge, store, dump: newest, anidb, kitsu, previews })
    .catch(error => warn(`the picks were not made this run: ${errorText(error)}`))
  if (!picks) return
  const picked = withPicks(encoded, picks)
  if (picked.manifest === files.manifest) {
    log('the picks did not change, nothing published')
  } else {
    await publish(gh, release, picked, files.manifest)
    log(`published ${picks.entry.name} and ${MANIFEST}`)
  }
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `runHistory`'s options from the workflow's environment: the store only when every secret of `SECRETS` is set. */
export const runOptions = env => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return {
    token: env.GH_TOKEN,
    store: r2(env),
    writer: { by: 'offline-history', run: env.GITHUB_RUN_ID ?? null, stub: version, commit: env.GITHUB_SHA?.slice(0, 8) ?? null },
    merge: () => loadMerge(ROOT),
  }
}

const main = async () => {
  if (process.env.GITHUB_WORKFLOW !== WORKFLOW) {
    console.error(`[offline-history] REFUSING: this asks AniDB, Kitsu, TVmaze, ANN and AnimeThemes, so it runs only as the "${WORKFLOW}" workflow.`)
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
