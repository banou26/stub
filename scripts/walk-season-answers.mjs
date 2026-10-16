#!/usr/bin/env node
/**
 * Record every source answer for a whole anime season, as a replayable corpus.
 *
 *   npm run corpus:walk -- --limit 3            # the smoke run
 *   npm run corpus:walk                         # the current season, which the owner runs
 *   npm run corpus:walk -- --season summer-2026 --resume
 *
 * WHAT IT RECORDS. One page load per run of the season, at `/media/<aggregated uri>?graph=1&export=answers`,
 * which is the same address a card on the listing links to. `?graph=1` fills the worker's `Answer`
 * log (src/worker/graph/answers.ts: every resolver return value, byte for byte, keyed by a content
 * hash) and `?export=answers` installs `window.__stubExportAnswers()` (src/answers-export.ts), which
 * hands the log back as `{key, seq, uri, origin, kind, operation, selection, raw}` rows in `seq`
 * order. The walk waits for the fan-out to settle, reads the log, and appends what it has not seen.
 *
 * THE FILE LAYOUT, under `corpus/season/<season>-<year>/`:
 *
 *   answers.jsonl   one row per line, deduped on `key` ACROSS pages, in the order the pages yielded
 *                   them. `seq` is assigned per page session, so it orders rows inside one page and
 *                   says nothing across two: `key` is the only identity, and the file's own order is
 *                   the only global one.
 *   manifest.json   the season, the walk's start and end, the app commit and version, and one entry
 *                   per run: its uri, the rows it yielded, the distinct origins, the settle time and
 *                   any page error. `origins` counts every origin that wrote a row; `answerOrigins`
 *                   counts only those that said something about the WORK, which is the number worth
 *                   reading (see THE CONTROL).
 *
 * `corpus/` is gitignored. A full season is 200 to 500 MB raw (about 800 rows of 2.5 kB per run, 223 runs
 * in summer 2026), tens once compressed, and belongs in a release asset; this script only leaves the
 * layout ready for one.
 *
 * HOW THE SEASON IS ENUMERATED, reusing what already knows:
 *
 *   current season   the LIVE home listing, opened with `?export=store` and settled. Every cluster is
 *                    one run, ordered by its most popular member, and its aggregated uri is built
 *                    from its members the way `buildAggregatedIdentity` does (worker/store/aggregate.ts).
 *   another season   the bundled catalogue, `src/generated/anime-seasons.ts`, which is what the
 *                    offline source ships. The listing only ever shows the season the clock is in
 *                    (src/router/home/index.tsx pins it to `mediaSeasonNow()`), so a past or future
 *                    season has no live enumeration to reuse.
 *
 * THE CONTROL. The first page of a walk must yield rows about the WORK from at least 3 distinct
 * origins, or the walk stops and says the recording path is not working. A walk that records nothing
 * writes an empty file and would otherwise report success: an empty corpus and a broken hook look
 * identical afterwards.
 *
 * "About the work" is the load bearing half. Every source also writes ONE `kind: 'origin'` row
 * describing itself, so counting rows by origin alone reports 24 on a page where all 24 refused to
 * answer anything (measured 2026-09-12: 24 origins wrote a row, 8 of them wrote a media or episode
 * one). Proven able to fire: with `?graph=1` stripped from the navigation the first page recorded 0
 * rows, the control stopped the walk naming `graph: the answer log is off`, and the script exited 2.
 *
 * FLAGS.
 *   --season <name>-<year>   default: the season the clock is in
 *   --limit N                walk the first N runs, most popular first (the smoke run)
 *   --resume                 skip runs already in the manifest, keep the rows already recorded
 *   --fresh                  discard an existing recording of this season and start over
 *   --build                  run `vp build` first
 *   --pages N                page pool size, default 3
 *   --out <dir>              where the season directory goes, default corpus/season
 *   --quiet-ms / --floor-ms / --cap-ms / --poll-ms   the settle window, see SETTLE below
 *
 * Talks to the real sources over the network, one browser, headless and muted.
 *
 * EXIT CODES. 0 clean, 2 a control failed (the build is missing, the enumeration answered nothing,
 * the first page did not record).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

// Every value import from src/ carries an explicit .ts extension: node's type stripping refuses a
// bare './a' specifier with ERR_MODULE_NOT_FOUND. Only modules whose own imports obey that rule can
// be reached from here, which is why the two uri helpers below are inlined rather than imported from
// src/utils/uri.ts (it imports './group-by' with no extension), and the season key and record id
// rather than imported from src/sources/offline/normalize.ts (it imports '../utils').
import seasonBundle from '../src/generated/anime-seasons.ts'
import { ANIME_SEASONS, animeSeasonOf } from '../src/sources/season.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = resolve(ROOT, 'build')

/* --------------------------------------------------------------------------------------------- */
/* flags                                                                                           */
/* --------------------------------------------------------------------------------------------- */

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 || at + 1 >= argv.length ? fallback : argv[at + 1]
}
const has = name => argv.includes(`--${name}`)

const LIMIT = flag('limit', undefined) === undefined ? Infinity : Number(flag('limit'))
const POOL = Math.max(1, Number(flag('pages', 3)))
const OUT_BASE = resolve(ROOT, String(flag('out', 'corpus/season')))
const RESUME = has('resume')
const FRESH = has('fresh')

/**
 * SETTLE: the fan-out has stopped when the row count has not moved for `quiet`, and never before
 * `floor`. The floor is not decoration. A season walk on 2026-09-05 settled at a median of 5264 ms
 * with zero runs capped, because sources answer in bursts with gaps longer than a short quiet window,
 * and it recorded a median identity of one. The same sources answer these pages.
 */
const QUIET_MS = Number(flag('quiet-ms', 5_000))
const FLOOR_MS = Number(flag('floor-ms', 12_000))
const CAP_MS = Number(flag('cap-ms', 45_000))
const POLL_MS = Number(flag('poll-ms', 1_000))
const HOOK_TIMEOUT_MS = 20_000
const PACE_MS = 3_000
// the listing is enumeration, not corpus, so it gets a shorter quiet and cap than these
const LISTING_QUIET_MS = 3_000
const LISTING_FLOOR_MS = 12_000
const LISTING_CAP_MS = 30_000
const MIN_LISTING_CLUSTERS = 20
/** The control: a first page that reaches fewer origins than this has not recorded a fan-out. */
const MIN_CONTROL_ORIGINS = 3

const parseSeason = raw => {
  const [name, year] = String(raw).toLowerCase().split('-')
  if (!ANIME_SEASONS.includes(name) || !/^\d{4}$/.test(year ?? '')) {
    console.error(`[corpus] --season wants <name>-<year>, one of ${ANIME_SEASONS.join('/')}, got "${raw}"`)
    process.exit(2)
  }
  return { season: name, year: Number(year) }
}

const CURRENT = animeSeasonOf()
const SEASON = flag('season', undefined) === undefined ? CURRENT : parseSeason(flag('season'))
const seasonKeyOf = ({ season, year }) => `${year}-${season.toUpperCase()}`
const SEASON_KEY = seasonKeyOf(SEASON)
const SEASON_DIR = `${SEASON.season}-${SEASON.year}`
const IS_CURRENT = SEASON_KEY === seasonKeyOf(CURRENT)

const OUT_DIR = resolve(OUT_BASE, SEASON_DIR)
const ANSWERS_FILE = resolve(OUT_DIR, 'answers.jsonl')
const MANIFEST_FILE = resolve(OUT_DIR, 'manifest.json')

const log = (...args) => console.log('[corpus]', ...args)
const die = message => {
  console.error(`[corpus] ${message}`)
  process.exit(2)
}

/* --------------------------------------------------------------------------------------------- */
/* the uri a card links to                                                                         */
/* --------------------------------------------------------------------------------------------- */

// mirrors UNROUTABLE_IN_ID in src/utils/uri.ts: a ',' splits the handle list inside `ag:(...)` and a
// '/' splits one segment of a route path, so either turns a working uri into one no route matches
const UNROUTABLE_IN_ID = /[,/()]/
const isRoutableUri = uri => {
  const colon = uri.indexOf(':')
  return colon > 0 && !UNROUTABLE_IN_ID.test(uri.slice(colon + 1))
}

/**
 * The aggregated uri for a set of member uris, as `buildAggregatedIdentity` spells it
 * (src/worker/store/aggregate.ts): routable members only, sorted, joined on ','.
 *
 * Asking for a run by this form rather than by one member's uri is the point of the walk: a single
 * `origin:id` address pins the page to one source, where `ag:(...)` is the same work asked as a
 * CLUSTER, which is what fans out to the other 23 and what the merge implementation will be replayed
 * against.
 */
const aggregatedUriOf = uris => {
  const routable = [...new Set(uris)].filter(isRoutableUri)
  const sorted = [...(routable.length ? routable : [...new Set(uris)])].sort()
  return sorted.length ? `ag:(${sorted.join(',')})` : undefined
}

/* --------------------------------------------------------------------------------------------- */
/* the static server, as scripts/check-graph-engine.mjs serves the same build                      */
/* --------------------------------------------------------------------------------------------- */

const TYPES = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

const fileFor = pathname => {
  const candidate = join(BUILD_DIR, normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  try {
    if (statSync(candidate).isFile()) return candidate
  } catch {}
  // clean URLs: every route falls back to the app shell, as Pages does. A media route's uri can
  // carry a '.', so extension is not the test here; only /assets/ is allowed to 404.
  return pathname.startsWith('/assets/') ? undefined : join(BUILD_DIR, 'index.html')
}

const serveBuild = async () => {
  const server = createServer((request, response) => {
    const file = fileFor(new URL(request.url, 'http://localhost').pathname)
    if (!file) {
      response.writeHead(404).end()
      return
    }
    response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

/* --------------------------------------------------------------------------------------------- */
/* browser hygiene                                                                                 */
/* --------------------------------------------------------------------------------------------- */

const BLOCKED_TYPES = new Set(['image', 'media', 'font'])
const BLOCKED_HOSTS = [
  'www.youtube.com', 'i.ytimg.com', 'googleads.g.doubleclick.net', 'static.doubleclick.net',
  'www.google.com', 'play.google.com', 'jnn-pa.googleapis.com',
]
const BLOCKED_SUFFIXES = ['.googlevideo.com']

// The allow list wins over both abort rules: the relay iframe and its scripts ARE the source path,
// so an over-broad type rule taking one of their responses would look exactly like every upstream
// refusing at once. None of what is aborted reaches a resolver's return value, which is all the
// answer log holds.
// Returns the set of urls it aborted, so a page's console errors can be told apart from the noise
// this rule makes: every abort logs `Failed to load resource: net::ERR_FAILED`, and a manifest that
// recorded those would report a page error on every run of a healthy walk.
const installRoutes = async (context, appHost) => {
  const aborted = new Set()
  await context.route('**/*', route => {
    const request = route.request()
    let host = ''
    try { host = new URL(request.url()).hostname } catch { host = '' }
    if (host === appHost || host === 'fkn.app' || host.endsWith('.fkn.app')) return route.continue()
    const blocked = BLOCKED_HOSTS.includes(host)
      || BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix))
      || BLOCKED_TYPES.has(request.resourceType())
    if (!blocked) return route.continue()
    aborted.add(request.url())
    return route.abort()
  })
  return aborted
}

/* --------------------------------------------------------------------------------------------- */
/* enumeration                                                                                     */
/* --------------------------------------------------------------------------------------------- */

/**
 * The version and commit the served bytes name, off the footer, so the manifest says what produced
 * the corpus rather than what the working tree happens to be on.
 */
const readFooter = page =>
  page
    .waitForFunction(() => document.body.innerText.match(/v([\d.]+) ([0-9a-f]{7}|dev)/)?.slice(1) ?? null, { timeout: HOOK_TIMEOUT_MS })
    .then(handle => handle.jsonValue(), () => null)

/** Poll a page's own summary of itself until it holds still, then say how long that took. */
const settleOn = async (page, read, { quietMs, floorMs, capMs, pollMs }) => {
  const started = Date.now()
  let previous
  let stableSince = 0
  let failed
  for (;;) {
    const seen = await read()
    const elapsed = Date.now() - started
    if (seen.failed !== undefined) {
      // early in a cold load the worker has not been handed the `?graph` flag yet and the read
      // throws. That is not a settled page, and it is only a failure if it is still true at the cap.
      failed = seen.failed
      stableSince = 0
    } else {
      failed = undefined
      if (seen.signature === previous && seen.filled) {
        stableSince ||= Date.now()
        if (Date.now() - stableSince >= quietMs && elapsed >= floorMs) return { ms: elapsed, capped: false }
      } else {
        previous = seen.signature
        stableSince = 0
      }
    }
    if (elapsed >= capMs) return { ms: elapsed, capped: true, failed }
    await page.waitForTimeout(pollMs)
  }
}

/**
 * The live listing's clusters, ranked by popularity, plus the commit of the bytes that answered.
 *
 * The home page is opened with `?export=store` alone: this load enumerates, it does not record. Every
 * media page re-runs the listing fan-out anyway (the media route renders the home listing), so the
 * listing's own answers reach the corpus through the runs.
 */
const enumerateFromListing = async (browser, origin, appHost) => {
  const context = await browser.newContext()
  await installRoutes(context, appHost)
  const page = await context.newPage()
  try {
    await page.goto(`${origin}/?export=store`, { waitUntil: 'domcontentloaded' })
    const hooked = await page
      .waitForFunction(() => typeof window.__stubExportStore === 'function', { timeout: HOOK_TIMEOUT_MS })
      .then(() => true, () => false)
    if (!hooked) die('CONTROL FAILED: window.__stubExportStore never appeared on the listing, so the flag never reached the app and the season could not be enumerated.')

    const footer = await readFooter(page)

    const read = async () => {
      const snapshot = await page
        .evaluate(() => window.__stubExportStore({ excludeOrigins: [] }))
        .catch(error => ({ failed: String(error?.message ?? error) }))
      if (snapshot?.failed) return { failed: snapshot.failed }
      const clusters = snapshot?.clusters ?? []
      return {
        filled: clusters.length > 0,
        signature: JSON.stringify(clusters.map(cluster => cluster.members.map(member => member.uri).sort())),
      }
    }
    const settled = await settleOn(page, read, {
      quietMs: LISTING_QUIET_MS, floorMs: LISTING_FLOOR_MS, capMs: LISTING_CAP_MS, pollMs: POLL_MS,
    })

    const snapshot = await page.evaluate(() => window.__stubExportStore({ excludeOrigins: [] })).catch(() => undefined)
    const clusters = snapshot?.clusters ?? []
    log(`listing: ${clusters.length} clusters in ${settled.ms} ms${settled.capped ? ' (capped)' : ''}`)
    if (clusters.length < MIN_LISTING_CLUSTERS) {
      die(`CONTROL FAILED: the listing exported ${clusters.length} clusters, under ${MIN_LISTING_CLUSTERS}. It never answered, so there is no season to walk.`)
    }

    const popularity = cluster => cluster.members.reduce((highest, member) => Math.max(highest, member.popularity ?? -1), -1)
    const items = []
    const seen = new Set()
    for (const cluster of [...clusters].sort((a, b) => popularity(b) - popularity(a))) {
      const members = cluster.members.map(member => member.uri).sort()
      const uri = aggregatedUriOf(members)
      if (!uri || seen.has(uri)) continue
      seen.add(uri)
      items.push({ uri, members, title: cluster.members.find(member => member.titles?.length)?.titles?.[0]?.title })
    }
    return { items, commit: footer?.[1] ?? 'unknown', appVersion: footer?.[0] ?? 'unknown' }
  } finally {
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}

/**
 * The bundled catalogue's season bucket, for a season the live listing cannot show.
 *
 * The bundle names a run by its mal, anilist and kitsu ids; the offline source itself joins the
 * cluster as `offline:<runKey>` (src/sources/offline/index-lookup.ts `rowId`), so that member is
 * included and the address matches the one a card would carry.
 */
const enumerateFromBundle = async (browser, origin, appHost) => {
  const context = await browser.newContext()
  await installRoutes(context, appHost)
  const page = await context.newPage()
  const footer = await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' }).then(() => readFooter(page), () => null)
  await page.close().catch(() => {})
  await context.close().catch(() => {})

  const rows = seasonBundle.seasons?.[SEASON_KEY] ?? []
  const items = []
  const seen = new Set()
  for (const row of [...rows].sort((a, b) => (b.pop ?? -1) - (a.pop ?? -1))) {
    const members = []
    if (row.al) members.push(`anilist:${row.al}`)
    if (row.ku) members.push(`kitsu:${row.ku}`)
    if (row.ml) members.push(`mal:${row.ml}`)
    const key = row.ml ? `mal-${row.ml}` : row.al ? `anilist-${row.al}` : row.ku ? `kitsu-${row.ku}` : undefined
    if (key) members.push(`offline:${key}`)
    const uri = aggregatedUriOf(members)
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    items.push({ uri, members: [...members].sort(), title: row.t })
  }
  return { items, commit: footer?.[1] ?? 'unknown', appVersion: footer?.[0] ?? 'unknown' }
}

/* --------------------------------------------------------------------------------------------- */
/* one run                                                                                         */
/* --------------------------------------------------------------------------------------------- */

const walkRun = async (context, origin, item, aborted) => {
  aborted.clear()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error?.message ?? error)))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (aborted.has(message.location()?.url ?? '')) return
    errors.push(message.text())
  })
  try {
    // RAW uri, never encodeURIComponent: a percent-encoded segment blinded three probes on 2026-09-05.
    await page.goto(`${origin}/media/${item.uri}?graph=1&export=answers`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const installed = await page
      .waitForFunction(() => typeof window.__stubExportAnswers === 'function', { timeout: HOOK_TIMEOUT_MS })
      .then(() => true, () => false)
    if (!installed) return { rows: [], settleMs: 0, capped: false, error: 'window.__stubExportAnswers never installed', errors }

    // The poll asks the page to summarize its own log rather than hand it over: a full read is one
    // worker round trip plus every row crossing it as a string, which is 1.6 to 1.9 MB a page.
    const read = () => page.evaluate(async () => {
      try {
        const rows = await window.__stubExportAnswers()
        return { filled: rows.length > 0, signature: String(rows.length) }
      } catch (error) {
        return { failed: String(error?.message ?? error) }
      }
    })
    const settled = await settleOn(page, read, { quietMs: QUIET_MS, floorMs: FLOOR_MS, capMs: CAP_MS, pollMs: POLL_MS })

    const rows = await page.evaluate(() => window.__stubExportAnswers()).catch(() => undefined)
    if (!rows) {
      return { rows: [], settleMs: settled.ms, capped: settled.capped, error: settled.failed ?? 'the log could not be read', errors }
    }
    return { rows, settleMs: settled.ms, capped: settled.capped, error: rows.length ? undefined : (settled.failed ?? 'the page answered no rows'), errors }
  } catch (error) {
    return { rows: [], settleMs: 0, capped: false, error: String(error?.message ?? error), errors }
  } finally {
    await page.close().catch(() => {})
  }
}

/* --------------------------------------------------------------------------------------------- */
/* the recording                                                                                   */
/* --------------------------------------------------------------------------------------------- */

/** Every `key` already on disk, so `--resume` cannot write a row the file holds. */
const keysOnDisk = async () => {
  const keys = new Set()
  if (!existsSync(ANSWERS_FILE)) return keys
  const lines = createInterface({ input: createReadStream(ANSWERS_FILE), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line) continue
    try { keys.add(JSON.parse(line).key) } catch {}
  }
  return keys
}

const readManifest = () => {
  if (!existsSync(MANIFEST_FILE)) return undefined
  try { return JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8')) } catch { return undefined }
}

/* --------------------------------------------------------------------------------------------- */

const main = async () => {
  if (has('build')) {
    log('building')
    execFileSync(resolve(ROOT, 'node_modules/.bin/vp'), ['build'], { cwd: ROOT, stdio: 'inherit' })
  }
  if (!existsSync(join(BUILD_DIR, 'index.html'))) {
    die(`CONTROL FAILED: no build at ${BUILD_DIR}. Run node_modules/.bin/vp build, or pass --build.`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const previous = RESUME ? readManifest() : undefined
  if (existsSync(ANSWERS_FILE) && statSync(ANSWERS_FILE).size && !RESUME && !FRESH) {
    die(`${ANSWERS_FILE} already holds a recording. Pass --resume to continue it, or --fresh to discard it.`)
  }
  if (!RESUME) writeFileSync(ANSWERS_FILE, '')

  const seenKeys = RESUME ? await keysOnDisk() : new Set()
  /**
   * What `--resume` skips ON, and it is not the uri.
   *
   * A cluster's membership grows as sources answer, so the same run enumerates under a different
   * `ag:(...)` address on a later walk: measured 2026-09-12, Youjo Senki II came back first as
   * `ag:(anilist:135865,kitsu:44778,mal:49233,offline:mal-49233)` and an hour later as a nine member
   * uri carrying cr and jw handles. Matching on the address alone re-walked it. A member uri is
   * stable, so a run is done when any member of it has been walked.
   */
  const doneMembers = new Set((previous?.runs ?? []).filter(run => !run.error).flatMap(run => run.members ?? [run.uri]))
  if (RESUME) log(`resuming: ${(previous?.runs ?? []).length} runs already recorded, ${seenKeys.size} rows on disk`)

  const { server, origin } = await serveBuild()
  const appHost = new URL(origin).hostname
  const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()
  const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })

  const startedAt = new Date().toISOString()
  const runs = [...(previous?.runs ?? [])]
  const originsSeen = new Set((previous?.totals?.origins ?? []))
  let rowsWritten = previous?.totals?.rows ?? 0
  let enumeration

  const flushManifest = (endedAt) => {
    writeFileSync(MANIFEST_FILE, `${JSON.stringify({
      season: SEASON_KEY,
      seasonDir: SEASON_DIR,
      enumeration: enumeration?.kind,
      startedAt: previous?.startedAt ?? startedAt,
      resumedAt: previous ? startedAt : undefined,
      endedAt,
      commit: enumeration?.commit ?? previous?.commit,
      appVersion: enumeration?.appVersion ?? previous?.appVersion,
      settle: { quietMs: QUIET_MS, floorMs: FLOOR_MS, capMs: CAP_MS, pollMs: POLL_MS },
      runsPlanned: enumeration?.planned ?? previous?.runsPlanned,
      totals: {
        runs: runs.length,
        rows: rowsWritten,
        bytes: existsSync(ANSWERS_FILE) ? statSync(ANSWERS_FILE).size : 0,
        origins: [...originsSeen].sort(),
      },
      runs,
    }, null, 2)}\n`)
  }

  try {
    const found = IS_CURRENT
      ? await enumerateFromListing(browser, origin, appHost)
      : await enumerateFromBundle(browser, origin, appHost)
    enumeration = { kind: IS_CURRENT ? 'listing' : 'bundle', commit: found.commit, appVersion: found.appVersion }
    log(`${SEASON_KEY}: ${found.items.length} runs from the ${enumeration.kind}, app v${found.appVersion} ${found.commit}`)
    if (!found.items.length) die(`CONTROL FAILED: ${SEASON_KEY} enumerated no runs.`)

    let items = found.items.filter(item => !(item.members ?? [item.uri]).some(member => doneMembers.has(member)))
    if (Number.isFinite(LIMIT)) items = items.slice(0, LIMIT)
    enumeration.planned = found.items.length
    log(`walking ${items.length} run(s) with ${POOL} page(s)`)

    /** Append what this run found that the corpus does not already hold. */
    const record = (item, outcome) => {
      const fresh = []
      const origins = new Set()
      // ANSWER origins, and the distinction is what makes the control mean anything. Every source
      // also answers ONE `kind: 'origin'` row describing itself, so a page where all 24 refused to
      // say anything about the work still reports 24 origins. Only a row about the media or its
      // episodes is evidence that a source answered the question the page asked.
      const answerOrigins = new Set()
      for (const row of outcome.rows) {
        origins.add(row.origin)
        originsSeen.add(row.origin)
        if (row.kind !== 'origin') answerOrigins.add(row.origin)
        if (seenKeys.has(row.key)) continue
        seenKeys.add(row.key)
        fresh.push(JSON.stringify(row))
      }
      if (fresh.length) appendFileSync(ANSWERS_FILE, `${fresh.join('\n')}\n`)
      rowsWritten += fresh.length
      const entry = {
        uri: item.uri,
        members: item.members,
        title: item.title,
        rows: outcome.rows.length,
        newRows: fresh.length,
        origins: [...origins].sort(),
        answerOrigins: [...answerOrigins].sort(),
        settleMs: outcome.settleMs,
        capped: outcome.capped,
        error: outcome.error,
        consoleErrors: outcome.errors?.length ? outcome.errors.slice(0, 3) : undefined,
      }
      runs.push(entry)
      flushManifest()
      log(`[${runs.length}/${(previous?.runs?.length ?? 0) + items.length}] ${item.uri.slice(0, 64)}${item.uri.length > 64 ? '...' : ''} ${entry.rows} rows (+${entry.newRows}), ${entry.answerOrigins.length}/${entry.origins.length} origins, ${(entry.settleMs / 1000).toFixed(1)} s${entry.capped ? ' capped' : ''}${entry.error ? ` ERROR ${entry.error}` : ''}`)
      return entry
    }

    const newContext = async () => {
      const context = await browser.newContext()
      const aborted = await installRoutes(context, appHost)
      return { context, aborted }
    }

    /* the control runs alone, before the pool: a walk that records nothing must not spend a season */
    if (items.length) {
      const { context, aborted } = await newContext()
      const entry = record(items[0], await walkRun(context, origin, items[0], aborted))
      await context.close().catch(() => {})
      if (entry.answerOrigins.length < MIN_CONTROL_ORIGINS) {
        flushManifest(new Date().toISOString())
        die(`CONTROL FAILED: the first page recorded ${entry.rows} row(s), and only ${entry.answerOrigins.length} origin(s) answered about the work itself, under ${MIN_CONTROL_ORIGINS}. The recording path is not working, so the walk stops rather than filling a file with nothing.${entry.error ? ` The page said: ${entry.error}` : ''}`)
      }
      log(`control: ${entry.answerOrigins.length} origins answered about the work (${entry.answerOrigins.join(', ')})`)
    }

    /* the pool, paced so 24 upstreams are not asked three times a second */
    let next = 1
    let lastGoto = 0
    const worker = async () => {
      const { context, aborted } = await newContext()
      for (;;) {
        const at = next++
        if (at >= items.length) break
        const wait = PACE_MS - (Date.now() - lastGoto)
        if (wait > 0) await new Promise(done => setTimeout(done, wait))
        lastGoto = Date.now()
        record(items[at], await walkRun(context, origin, items[at], aborted))
      }
      await context.close().catch(() => {})
    }
    await Promise.all(Array.from({ length: Math.min(POOL, Math.max(0, items.length - 1)) }, worker))
  } finally {
    await browser.close().catch(() => {})
    server.close()
  }

  flushManifest(new Date().toISOString())

  const walked = runs.filter(run => !run.error)
  const thin = runs.filter(run => (run.answerOrigins ?? run.origins).length < MIN_CONTROL_ORIGINS)
  const bytes = statSync(ANSWERS_FILE).size
  const settleTimes = walked.map(run => run.settleMs).sort((a, b) => a - b)
  log('')
  log(`${SEASON_KEY}: ${runs.length} run(s), ${rowsWritten} rows, ${(bytes / 1e6).toFixed(2)} MB, ${originsSeen.size} origins`)
  log(`origins: ${[...originsSeen].sort().join(', ')}`)
  if (settleTimes.length) {
    log(`settle: median ${(settleTimes[Math.floor(settleTimes.length / 2)] / 1000).toFixed(1)} s, slowest ${(settleTimes[settleTimes.length - 1] / 1000).toFixed(1)} s, ${runs.filter(run => run.capped).length} capped`)
  }
  log(`${thin.length} run(s) had fewer than ${MIN_CONTROL_ORIGINS} origins answer about the work, which are the ones to look at`)
  for (const run of thin.slice(0, 20)) log(`  ${(run.answerOrigins ?? run.origins).length} origins  ${run.uri}${run.error ? `  ${run.error}` : ''}`)
  log(`wrote ${ANSWERS_FILE}`)
  log(`wrote ${MANIFEST_FILE}`)
}

await main()
