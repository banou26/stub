#!/usr/bin/env node
// Build the two anime data artifacts stub loads lazily, by merging two independent id databases.
//
// Runs as part of `npm run build` (see the `data:build` script). It pulls the newest
// manami-project/anime-offline-database release so a deploy always carries current data, and merges
// it with the `@kawaiioverflow/arm` npm package, which is pinned by package-lock.json.
//
//   src/generated/anime-index.ts    cross-catalog ids: MyAnimeList, AniList, Kitsu, AniDB, Anime News Network
//   src/generated/anime-seasons.ts  seasonal listings with titles and covers
//   src/generated/history/          every listed show's title, cover, banner and description, as stub's own
//                                   rules pick them from the dump and the offline history (HOR-915)
//
// All are reached ONLY through a dynamic import, so they are separate content-hashed chunks and
// add nothing to the initial bundle.
//
// WHY TWO DATABASES RATHER THAN THE BEST ONE
//
// Not for coverage, though the union does win there (20,972 MyAnimeList to AniList pairs against
// arm's 20,754 and manami's 18,858). It is because a wrong pair is unrecoverable: the store's
// union-find has no unlink, so one bad row welds two unrelated shows together for the worker's
// lifetime and the merged cluster then goes on to weld a third through the fuzzy pass. That is the
// shape of the uNoGS Death Note incident already recorded in the knowledge base.
//
// Neither database is clean on its own, measured rather than assumed:
//
//   - manami carries 48 rows holding two ids from a SINGLE catalog, which can only mean it welded
//     two catalog entries that are not the same show. `Cosmic Break` is anilist/17295 and
//     anilist/206843 at once. Upstream's own README says the data is 65% reviewed.
//   - The two disagree outright on 12 MyAnimeList ids, so at least one is wrong in each case.
//
// Holding both is what makes those detectable at all. Either alone would assert every one of them
// silently. So a pair ships only when nothing contradicts it, and anything ambiguous is dropped.
//
// NETWORK POLICY
//
// Every build takes the newest release, so a deploy is never older than the last one published.
// Nothing generated is committed. A local build cache under node_modules/.cache keeps repeat builds
// off the network, and a CI checkout has no cache, so CI always fetches. On Cloudflare Pages the
// cache is not merely absent but unreachable: the build restores a dependency cache and THEN runs
// `npm clean-install`, which deletes node_modules, so nothing under it can ever survive into a
// build. The network paths below are the only ones that exist there.
//
// If the fetch fails with no cache to fall back on, the build FAILS rather than degrading. arm alone
// would still produce a plausible looking index, so a silent degrade would ship a build with no
// season listings and no Kitsu or AniDB ids while looking entirely healthy.
//
// The release is named through three independent paths, because they fail independently. See
// `newestRelease`: the list endpoint can answer 200 with an empty array during a GitHub incident,
// which reads as "this repo has no releases" and is not that at all, and BOTH api.github.com paths
// go down together whenever the runner's unauthenticated per-IP budget is spent, which is why the
// third one does not touch that host.
//
// LICENSING
//
// stub is MIT, and neither upstream is, so the derived data carries its own terms rather than the
// repo's. Attribution is per artifact and lists every contributor to THAT file: anime-seasons is
// manami with arm's AniList ids for the shows MyAnimeList adds, anime-index is arm and manami
// together. Each one repeats its credits in a header comment AND in a `sources` field, because ODbL
// section 4.2(b) wants the notice inside the database as well as in the documentation. The `sources`
// field below IS the attribution of record: it travels inside every artifact and names the license,
// its URI and the upstream url. ODbL 4.3 accepts that URI in place of a vendored copy of the text.

import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync, zstdDecompressSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { COLUMNS, encodeIndex, mergeIds } from './merge-ids.mjs'
import { errorText, seasonData } from './season-popularity.mjs'
import { DOWNLOAD, MANIFEST, decodeHistory, downloadAssets, downloadManifest, readManifest, sha256 } from './history-files.mjs'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = resolve(ROOT, 'data')
const OUT_DIR = resolve(ROOT, 'src/generated')

// A build cache, never a checked-in artifact. Nothing generated is committed: `data/` holds only the
// license and the attribution, and `src/generated/` is gitignored like the graphql codegen output.
// This exists so a local rebuild does not re-download 6 MB every time, and so a transient failure
// mid-session reuses what the last build already fetched. A fresh CI checkout has no cache and
// therefore always takes the live release, which is the point.
const CACHE = resolve(ROOT, 'node_modules/.cache/stub-anime-data.json')
// the offline history's files as last downloaded, for the same two reasons
const HISTORY_CACHE = resolve(ROOT, 'node_modules/.cache/stub-offline-history')

// manami-project's database was archived on 2026-07-04; cedya77's continues it, same asset, same ODbL terms, and asks
// that manami be credited, which the notice below does
const REPO = 'cedya77/anime-offline-database'
const ASSET = 'anime-offline-database.jsonl.zst'
// Two budgets, never one. Sharing a single allowance across naming the release and downloading it
// meant a slow api.github.com could spend all of it before the fallback below was even chosen, and
// the download then got an already-aborted signal: the route that exists for a refusing API died on
// the one shape of refusal that is not fast.
const NAME_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const RETRY_DELAY_MS = 2_000

// Attribution is PER ARTIFACT, not one blanket notice, because the two artifacts are not derived
// from the same things. anime-seasons is manami's, with arm naming the AniList id of each show
// MyAnimeList adds to a season. anime-index is a merge in which arm supplies the larger share (20,754
// of the MyAnimeList to AniList pairs against manami's 18,858), so an ODbL-only notice on it would
// credit the smaller contributor and omit the larger one entirely.
//
// The two licenses also want different things. ODbL section 4.2 wants its notice carried inside the
// database as well as in the docs, which is why every artifact repeats it in a header AND in a
// `sources` field. MIT wants its copyright line reproduced in any substantial portion.
const OFFLINE_DATABASE = {
  name: 'cedya77/anime-offline-database, continuing manami-project/anime-offline-database',
  url: `https://github.com/${REPO}`,
  license: 'ODbL-1.0',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  // ODbL 4.3 takes the license URI in place of a copy, which is why no license file is vendored
  notice: 'Full terms at https://opendatacommons.org/licenses/odbl/1-0/.',
}

const ARM = {
  name: '@kawaiioverflow/arm',
  url: 'https://github.com/kawaiioverflow/arm',
  license: 'MIT',
  licenseUrl: 'https://opensource.org/license/mit',
  notice: 'Copyright (c) P-Chan.',
}

// The history's shards credit one source each, so AniDB's and Kitsu's content is never presented as part of the
// ODbL database (its section 4.4 d). Their terms could not be read (2026-10-23), so no license is named for them.
const HISTORY_SOURCES = {
  dump: [OFFLINE_DATABASE],
  anidb: [{ name: 'AniDB', url: 'https://anidb.net/', notice: 'Titles from its anime titles file, as api.ani.zip passes them on.' }],
  kitsu: [{ name: 'Kitsu', url: 'https://kitsu.io/', notice: 'Titles, posters, banners and synopses from its API.' }],
}
const HISTORY_DIR = resolve(OUT_DIR, 'history')

// A season is carried for a while either side of the dump's own cut date, because the artifact has
// to stay useful as the clock moves past the season it was built in. manami lists seasons well
// ahead, so a forward window is nearly free.
const SEASONS_BACK = 1
const SEASONS_FORWARD = 4
export const SEASON_ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const seasonIndex = ({ year, season }) => year * 4 + SEASON_ORDER.indexOf(season)

const CATALOGS = [
  { key: 'anilist', host: 'anilist.co' },
  { key: 'mal', host: 'myanimelist.net' },
  { key: 'kitsu', host: 'kitsu.app' },
  { key: 'anidb', host: 'anidb.net' },
  { key: 'ann', host: 'animenewsnetwork.com' },
]

const log = (...args) => console.log('[anime-data]', ...args)
const warn = (...args) => console.warn('[anime-data] WARNING:', ...args)

const idIn = (sources, host) => {
  const matches = sources.filter(source => source.includes(host))
  // Two ids from one catalog means the upstream merged two entries that are not the same show, so
  // the row is not trustworthy for that catalog at all. Taking the first would be picking one of
  // two values already known to disagree.
  if (matches.length !== 1) return 0
  const id = /(\d+)\/?$/.exec(matches[0])?.[1]
  return id ? Number(id) : 0
}

/* --------------------------------------------------------------------------------------------- */
/* manami: fetch, trim, cache                                                                       */
/* --------------------------------------------------------------------------------------------- */

const assetIn = release => release?.assets?.find(candidate => candidate.name === ASSET)

const askGitHub = async path => {
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'stub-build' },
    signal: AbortSignal.timeout(NAME_TIMEOUT_MS),
  })
  if (!response.ok) {
    // A 403 here is almost always the UNAUTHENTICATED per-IP budget, 60 requests an hour, which a
    // shared CI runner can arrive with already spent by another tenant. "HTTP 403" alone cannot be
    // told apart from a block, an unusual user-agent or a private repo, all of which answer 403 too
    // but with an html body and no ratelimit headers. A Cloudflare Pages build died on 2026-08-30
    // with four of these and nothing to read, so carry out what the response actually said.
    const detail = await response.text().then(
      // One sentence of it. Upstream follows the useful half with a paragraph of boilerplate and
      // this ends up on a single log line. The ip in "exceeded for 1.2.3.4." survives, because the
      // split is on a full stop FOLLOWED BY A SPACE.
      body => { try { return String(JSON.parse(body).message ?? '').split('. ')[0] } catch { return '' } },
      () => ''
    )
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const error = new Error([
      `HTTP ${response.status}`,
      detail,
      remaining === null ? '' : `ratelimit remaining ${remaining}`,
      remaining === '0' && Number.isFinite(reset) && reset > 0
        ? `clears in ${Math.max(0, Math.round((reset * 1000 - Date.now()) / 60_000))} min`
        : '',
    ].filter(Boolean).join(', '))
    error.status = response.status
    // Read off the headers, never off the prose, which is not a contract. Both limiters answer 403:
    // the primary one exposes a spent budget, the secondary one hands back a retry-after.
    error.quotaSpent =
      (response.status === 403 || response.status === 429)
      && (remaining === '0' || response.headers.has('retry-after'))
    throw error
  }
  return response.json()
}

// The list endpoint names every dated release, so it is the only one that can pick the newest.
const fromReleaseList = async () => {
  const list = await askGitHub('releases?per_page=100')

  // A 200 carrying an empty array is what api.github.com answers during an incident, and nothing
  // about it looks wrong: there is no status to check and no exception to catch. It is NOT evidence
  // that the repo has no releases, so it must not be reported as "no release carries the asset",
  // which is a true sentence about a false premise. That message failed a stub deploy on
  // 2026-08-18 while every tag was still in place and releases/latest was answering normally.
  if (!Array.isArray(list) || !list.length) throw new Error('the release list answered 200 with nothing in it')

  // Ordered by the tag's own YYYY-WW, never by published_at: the repo carries a rolling `latest`
  // tag whose published_at is frozen at the date it was first created, more than a year before the
  // assets it currently points at, so "newest by date" picks the oldest thing in the list.
  const dated = list
    .filter(release => /^\d{4}-\d{2}$/.test(release.tag_name))
    .sort((a, b) => b.tag_name.localeCompare(a.tag_name))

  for (const release of dated) {
    const asset = assetIn(release)
    if (asset) return { tag: release.tag_name, url: asset.browser_download_url }
  }
  throw new Error(`none of the ${list.length} listed releases carries ${ASSET}`)
}

// One release, named by GitHub rather than chosen here, and served by a code path that stayed up
// through the incident above. It cannot pick the newest dated tag, which is why it is the fallback
// and not the primary. Whatever tag it names is accepted: GitHub resolves this to the newest
// non-draft non-prerelease release by created_at, which measured 2026-08-31 is the newest DATED tag
// and not the rolling `latest` one this repo also carries. Even an older dump would be taken, since
// it still yields a full season window (buildExtract anchors the window on the dump's own cut date
// rather than on today) and the alternative here is no deploy at all.
const fromLatestRelease = async () => {
  const release = await askGitHub('releases/latest')
  const asset = assetIn(release)
  if (!asset) throw new Error(`releases/latest (${release?.tag_name ?? 'untagged'}) does not carry ${ASSET}`)
  return { tag: release.tag_name, url: asset.browser_download_url }
}

const RELEASE_SOURCES = [
  { name: 'the release list', find: fromReleaseList },
  { name: 'releases/latest', find: fromLatestRelease },
]

// The same asset, named by nobody. github.com serves this path as a redirect to the latest release's
// asset, and github.com is a DIFFERENT service from api.github.com: it carries no unauthenticated
// 60-per-hour per-IP budget, so it still answers on a shared CI runner whose budget another tenant
// already spent. Not hypothetical. It failed a Cloudflare Pages build on 2026-08-30, four
// api.github.com attempts refusing with 403 inside two seconds, while githubstatus reported every
// system operational and a GitHub Actions run on the SAME commit reached the api fine.
//
// It costs nothing in freshness, and nothing in provenance either. Measured 2026-08-31 with the
// unauthenticated budget deliberately spent:
//
//   /releases/latest/download/anime-offline-database.jsonl.zst
//     -> 302 /releases/download/2026-27/anime-offline-database.jsonl.zst
//
// github.com resolves "latest" ITSELF, by created_at across releases that are neither draft nor
// prerelease, so it lands on the newest DATED release rather than on the rolling `latest` tag this
// repo also carries. The bytes are the ones the api names: sha256
// 9ed7e3fd8f0f47b63d977e915a555b7f6e552a7a25a465773451dbccd9cb8e03 either way.
//
// So it is last for one property only, not for freshness: fromReleaseList sorts by the dated tag
// name and walks PAST a release that does not carry the asset, which is the single case where the
// three can disagree. releases/latest and this path resolve identically to each other.
const DIRECT_DOWNLOAD = `https://github.com/${REPO}/releases/latest/download/${ASSET}`

// The failures are rendered by kind rather than by message, because the message now carries a
// decrementing ratelimit count and a Set of those dedupes nothing.
const reportFailures = failures =>
  [...failures.values()].map(({ text, n }) => (n > 1 ? `${text} (x${n})` : text)).join('; ')

// Two endpoints, twice, because the ways this fails are all transient and none of them are the
// repo actually lacking the asset. Every attempt is reported on the way out, so a build that took
// the fallback says so in its log rather than looking like an ordinary one.
//
// The direct download sits OUTSIDE the loop deliberately. As a third entry in RELEASE_SOURCES it
// would succeed on the first round without asking anything, and round 1 would then never run, so
// the two API endpoints would silently lose the retry that is the whole point of the loop.
const newestRelease = async () => {
  const failures = new Map()
  let quotaSpent = false
  for (const round of [0, 1]) {
    // A budget that just answered `remaining: 0` has not refilled two seconds later, since it resets
    // on the hour. Retrying into it buys nothing, and it is the hammering pattern that turns a
    // primary refusal into a SECONDARY one, which is keyed per IP across github.com as a whole and
    // would take the direct download down with it. The retry is for transient faults, not for this.
    if (round) {
      if (quotaSpent) break
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    }
    for (const source of RELEASE_SOURCES) {
      try {
        const release = await source.find()
        if (failures.size) warn(`named ${release.tag} through ${source.name}, after ${reportFailures(failures)}`)
        return release
      } catch (error) {
        quotaSpent ||= error.quotaSpent === true
        // Keyed on the source, since a timeout's message names no endpoint at all.
        const key = `${source.name}:${error.status ?? error.name}`
        const seen = failures.get(key)
        if (seen) seen.n += 1
        else failures.set(key, { n: 1, text: `${source.name}: ${errorText(error)}` })
      }
    }
  }
  warn(`api.github.com named nothing, falling back to the direct download: ${reportFailures(failures)}`)
  return { tag: 'latest', url: DIRECT_DOWNLOAD, direct: true }
}

export const catalogIds = entry => Object.fromEntries(CATALOGS.map(({ key, host }) => [key, idIn(entry.sources, host)]))

/**
 * The seasons with every season source's shows and counts laid over them. manami ships no
 * popularity, and its 1 to 10 rating puts three shows tied at a perfect 10 from a handful of votes
 * above Mushoku Tensei.
 *
 * NEVER FATAL: a season's ordering is not worth failing a deploy over. A season a source could not be
 * read for is laid by the others, or keeps its rating order, and the line logged says why.
 */
const withPopularity = async (seasons, rows) => {
  const laid = await seasonData(seasons, require('@kawaiioverflow/arm/arm.json'), { rows })
  for (const [source, { pages, failed }] of Object.entries(laid.reads)) {
    for (const [key, page] of pages) log(`${source} ${key}: ${page.size ?? page.length} entries`)
    for (const [key, error] of failed) log(`${source} ${key} unavailable (${errorText(error)})`)
  }
  return laid.seasons
}

/**
 * The extract, which is deliberately NOT "the dump with some fields removed": the id rows of every
 * entry, the windowed seasons' records, and `history`, the title, picture and ids (AniDB's
 * included) of every record the offline source can be addressed by, which the history's shards are
 * picked from. Nothing else of the dump reaches the build.
 *
 * It also lands the extract in nearly the shape the build wants, so the cache path exercises the
 * same code as the fresh path rather than a second one that could rot untested.
 */
export const buildExtract = (entries, meta, tag) => {
  const cut = new Date(`${meta.lastUpdate}T00:00:00Z`)
  const anchor = { year: cut.getUTCFullYear(), season: SEASON_ORDER[Math.floor(cut.getUTCMonth() / 3)] }
  const from = seasonIndex(anchor) - SEASONS_BACK
  const to = seasonIndex(anchor) + SEASONS_FORWARD

  const rows = []
  const seasons = {}
  // every record the offline source can be addressed by, for the history's shards
  const history = []
  for (const entry of entries) {
    const ids = catalogIds(entry)
    const row = [ids.mal, ...COLUMNS.map(key => ids[key])]
    if (row.some(Boolean)) rows.push(row)

    const record = {
      t: entry.title,
      ty: entry.type,
      // A MyAnimeList CDN path with the constant prefix dropped, restored on the client, where the
      // prefix is 42 of its roughly 70 bytes. The replace is a NO-OP for the many entries whose
      // picture manami took from somewhere else (anidb, kitsu, anisearch, ANN and five more), so
      // those stay absolute and the client tells the two apart rather than prefixing blindly.
      p: entry.picture?.replace('https://cdn.myanimelist.net/images/anime/', '') ?? '',
    }
    if (entry.episodes) record.ep = entry.episodes
    if (ids.mal) record.ml = ids.mal
    if (ids.anilist) record.al = ids.anilist
    if (ids.kitsu) record.ku = ids.kitsu
    // a copy, since laying the season sources over a bucket merges records in place
    if (entry.title && (ids.mal || ids.anilist || ids.kitsu)) history.push({ ...record, ...ids.anidb && { ad: ids.anidb } })

    const season = entry.animeSeason
    if (!season?.year || !SEASON_ORDER.includes(season.season)) continue
    const index = seasonIndex(season)
    if (index < from || index > to) continue

    ;(seasons[`${season.year}-${season.season}`] ??= []).push(
      entry.score?.arithmeticMean ? { ...record, sc: Math.round(entry.score.arithmeticMean * 100) / 100 } : record
    )
  }

  return { sources: [OFFLINE_DATABASE], tag, updated: meta.lastUpdate, anchor: `${anchor.year}-${anchor.season}`, rows, seasons, history }
}

/** The newest dump: its dated tag, its metadata line, its entries and the sha256 of the file. Throws, saying why. */
export const downloadDump = async () => {
  const release = await newestRelease()
  // Names the path as well as the release, because a green build is NOT evidence the fallback
  // works: it almost always runs through the api. This line is the only thing that says otherwise.
  log(`offline database release ${release.tag}${release.direct ? ', github.com direct download' : ''}, downloading`)

  // Its own budget, unspent by whatever the naming attempts above cost.
  const response = await fetch(release.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`download ${release.url}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const jsonl = zstdDecompressSync(bytes).toString('utf8')

  const lines = jsonl.split('\n').filter(Boolean)
  const meta = JSON.parse(lines[0])
  const entries = lines.slice(1).map(line => JSON.parse(line))
  if (entries.length < 30_000) throw new Error(`only ${entries.length} entries, expected 30000+`)

  // The dump names the tag it was cut from in its own schema url, so a release reached without the
  // API still records the dated tag rather than the rolling pointer that served it. Falls back to
  // whatever named the release if upstream ever changes that url's shape.
  const tag = /refs\/tags\/([^/]+)\//.exec(meta.$schema ?? '')?.[1] ?? release.tag
  return { tag, meta, entries, sha256: sha256(bytes) }
}

const refreshExtract = async () => {
  const { tag, meta, entries } = await downloadDump()
  const extract = buildExtract(entries, meta, tag)
  extract.seasons = await withPopularity(extract.seasons, extract.rows)

  mkdirSync(dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(extract))
  log(`${extract.rows.length} rows carrying an id, ${Object.keys(extract.seasons).length} seasons, cut ${meta.lastUpdate}`)
  return extract
}

const loadManami = async () => {
  if (process.argv.includes('--offline')) {
    log('--offline: skipping the release fetch')
  } else {
    try {
      return await refreshExtract()
    } catch (error) {
      warn(`could not reach ${REPO}: ${errorText(error)}`)
    }
  }
  // Deliberately fails rather than emitting a thinner artifact. arm alone would still produce a
  // plausible looking index, so a silent degrade would ship a build missing every season listing and
  // every Kitsu and AniDB id, and look exactly like a healthy one.
  if (!existsSync(CACHE)) {
    console.error(`[anime-data] REFUSING: no data from ${REPO}, and no build cache to fall back on.`)
    console.error(`[anime-data] The seasonal artifact cannot be built without it. Run with network access.`)
    process.exit(1)
  }
  const extract = JSON.parse(readFileSync(CACHE, 'utf8'))
  warn(`using the build cache, ${extract.tag} cut ${extract.updated}. This may be out of date.`)
  return extract
}

const readHistoryCache = cache => {
  if (!existsSync(resolve(cache, MANIFEST))) return undefined
  const manifest = readFileSync(resolve(cache, MANIFEST), 'utf8')
  const assets = {}
  for (const { name } of Object.values(readManifest(manifest).assets)) {
    if (existsSync(resolve(cache, name))) assets[name] = readFileSync(resolve(cache, name))
  }
  return { manifest, assets }
}

const writeHistoryCache = (cache, { manifest, assets }) => {
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(cache, { recursive: true })
  for (const [name, bytes] of Object.entries(assets)) writeFileSync(resolve(cache, name), bytes)
  writeFileSync(resolve(cache, MANIFEST), manifest)
}

/**
 * The offline history the Offline history workflow publishes, each asset checked against its manifest. A build
 * never gathers one itself, since from scratch means asking AniDB and Kitsu, which only that workflow may do.
 *
 * A manifest it cannot fetch falls back on the cache, as the dump does. Unreadable (an asset the manifest names
 * that cannot be fetched included), or with no cache, it throws, so the build FAILS: a build on the dump's titles
 * alone looks healthy while heading half of older shows unlike stub's page.
 */
export const loadHistory = async ({ offline = false, get = fetch, pauseMs, cache = HISTORY_CACHE } = {}) => {
  if (!offline) {
    let manifest
    try {
      manifest = await downloadManifest({ get, pauseMs })
    } catch (error) {
      warn(`could not read the offline history at ${DOWNLOAD}: ${errorText(error)}`)
    }
    if (manifest) {
      const files = { manifest, assets: await downloadAssets(manifest, get) }
      const history = decodeHistory(files)
      writeHistoryCache(cache, files)
      return history
    }
  }
  const files = readHistoryCache(cache)
  if (!files) throw new Error(`no offline history at ${DOWNLOAD}/${MANIFEST}, and no build cache to fall back on. Run the Offline history workflow.`)
  warn('using the cached offline history. It may be out of date.')
  return decodeHistory(files)
}

/* --------------------------------------------------------------------------------------------- */
/* emit                                                                                             */
/* --------------------------------------------------------------------------------------------- */

/**
 * Emitted as TypeScript holding a JSON string, not as a .json file.
 *
 * A lazily imported .json compiles to a JS object literal here unless `json.namedExports` is turned
 * off, which is global config that would change every other JSON import in the app. Emitting the
 * module directly gets the JSON.parse fast path, which is the quicker one at this size, without
 * touching shared config.
 */
const emit = (name, payload, provenance, sources) => {
  const json = JSON.stringify({ sources, ...payload })
  const credits = sources
    .map(source => `//   ${source.name}\n//     ${source.url}\n//     ${source.license}, ${source.licenseUrl}. ${source.notice}`)
    .join('\n')
  const module = `// GENERATED by scripts/build-anime-data.mjs. Do not edit.
//
// Derived from:
${credits}
//
// Attribution of record is the sources field inside this file. ${provenance}
//
// Reached only through a dynamic import, so these bytes are a separate content-hashed chunk and are
// absent from the initial bundle. Parsed from a string because JSON.parse is the faster path here.
export default JSON.parse(${JSON.stringify(json)}) as ${name.types}
`
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, name.file), module)
  const brotli = brotliCompressSync(Buffer.from(json), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
  log(`${name.file.padEnd(18)} ${(json.length / 1024).toFixed(0).padStart(5)} KB raw, ${(brotli.length / 1024).toFixed(0).padStart(4)} KB brotli`)
  return brotli.length
}

/** Each set's shards as modules under src/generated/history, every stale one removed first. */
const emitHistory = (sets, shardName, provenance) => {
  rmSync(HISTORY_DIR, { recursive: true, force: true })
  mkdirSync(HISTORY_DIR, { recursive: true })
  for (const [set, shards] of Object.entries(sets)) {
    const sizes = shards.map((records, shard) => {
      const json = JSON.stringify({ sources: HISTORY_SOURCES[set], records })
      writeFileSync(resolve(HISTORY_DIR, `${shardName(set, shard)}.ts`), `// GENERATED by scripts/build-anime-data.mjs. Do not edit. ${provenance}
// Attribution of record is the sources field inside this file.
export default JSON.parse(${JSON.stringify(json)})
`)
      return gzipSync(json, { level: 9 }).length
    }).sort((a, b) => a - b)
    const kb = bytes => (bytes / 1024).toFixed(1)
    log(`history ${set.padEnd(5)} ${shards.length} shards, ${kb(sizes.reduce((sum, size) => sum + size, 0))} KB gzip, ${kb(sizes[sizes.length >> 1])} KB median`)
  }
}

const refuse = line => {
  console.error(`[anime-data] REFUSING: ${line}`)
  process.exit(1)
}

/**
 * Why this build must not ship, or nothing. Guards rather than niceties: every artifact is lazily
 * imported, so a shape change upstream would emit an empty table and every lookup would silently
 * miss, which is indistinguishable from a show simply not being listed. A history with next to no
 * AniDB titles (a first publish AniDB refused, or AniDB ids lost on the way) is refused too: it
 * builds and looks healthy, while AniDB's titles head 12,075 shows on 2026-43.
 */
export const refusal = ({ indexRows, seasons, anidbTitles }) => {
  if (indexRows < 15_000) return `only ${indexRows} index rows, expected at least 15000.`
  if (seasons < 3) return `only ${seasons} seasons, expected at least 3.`
  if (anidbTitles < 10_000) return `only ${anidbTitles} history titles from AniDB, expected at least 10000. Run the Offline history workflow once AniDB answers.`
}

const main = async () => {
  const armVersion = JSON.parse(readFileSync(require.resolve('@kawaiioverflow/arm/package.json'), 'utf8')).version
  const armEntries = require('@kawaiioverflow/arm/arm.json')
  const history = await loadHistory({ offline: process.argv.includes('--offline') }).catch(error => refuse(errorText(error)))
  const manami = await loadManami()
  // a cache written before the history existed carries no records for it
  if (!manami.history) refuse('the build cache predates the offline history. Run with network access.')

  log(`arm@${armVersion}: ${armEntries.length} rows | offline database ${manami.tag}: ${manami.rows.length} rows`)

  const { kept, conflicts, cleared } = mergeIds(armEntries, manami.rows)
  log(`merged index: ${kept.length} rows, ${conflicts} dropped on a contradiction, ${cleared} ids cleared as ambiguous`)

  const { seasons, anchor } = manami
  for (const [key, list] of Object.entries(seasons).sort()) log(`  season ${key.padEnd(12)} ${String(list.length).padStart(4)}`)

  const provenance = `Built from arm@${armVersion} and manami ${manami.tag} (cut ${manami.updated}).`

  const total =
    emit(
      { file: 'anime-index.ts', types: '{ mal: number[], anilist: number[], kitsu: number[], anidb: number[], ann: number[] }' },
      { arm: armVersion, tag: manami.tag, updated: manami.updated, ...encodeIndex(kept) },
      provenance,
      [ARM, OFFLINE_DATABASE],
    ) +
    emit(
      { file: 'anime-seasons.ts', types: '{ seasons: Record<string, { t: string, ty: string, p: string, ep?: number, ml?: number, al?: number, ku?: number, sc?: number }[]> }' },
      // Already formatted by buildExtract, and formatted again here it produced the literal string
      // "undefined-undefined" in every shipped artifact, because a string has no .year or .season.
      { tag: manami.tag, updated: manami.updated, anchor, seasons },
      provenance,
      [OFFLINE_DATABASE, ARM],
    )

  log(`${(total / 1024).toFixed(0)} KB brotli total, none of it in the initial bundle`)

  const { runnerImport } = await import('vite-plus')
  const { module: pick } = await runnerImport(resolve(ROOT, 'scripts/offline-pick.ts'), { root: ROOT, configFile: false, logLevel: 'error' })
  const { sets, counts } = pick.historyShards(manami.history, history.anidb.titles, history.kitsu)
  log(`history: ${counts.records} records, AniDB titles of ${history.anidb.fetchedAt}, Kitsu rows refreshed for ${history.manifest.kitsu?.refreshedFor}`)
  log(`history: titles from AniDB ${counts.anidbTitles}, Kitsu ${counts.kitsuTitles}, the dump ${counts.records - counts.anidbTitles - counts.kitsuTitles}; Kitsu covers ${counts.kitsuCovers}, banners ${counts.banners}, descriptions ${counts.descriptions}`)
  emitHistory(sets, pick.shardName, provenance)

  const refused = refusal({ indexRows: kept.length, seasons: Object.keys(seasons).length, anidbTitles: counts.anidbTitles })
  if (refused) refuse(refused)
}

if (import.meta.main) await main()
