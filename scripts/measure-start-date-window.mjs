/**
 * Corpus and candidate-pair census for the start-date window in src/worker/store/fuzzy-merge.ts.
 *
 * Fetches once into node_modules/.cache next to manami-titles.json and is a no-op afterwards, the
 * same shape as scripts/fetch-title-corpus.mjs. Run it, then the probe:
 *
 *   node scripts/measure-start-date-window.mjs
 *   ./node_modules/.bin/vitest run --config vitest.probe.config.ts \
 *     scripts/measure-start-date-window.probe.ts --disableConsoleIntercept --reporter=verbose
 *
 * WHAT A CANDIDATE PAIR IS. Two DISTINCT AniList entries that share an emitted start YEAR, which is
 * the only thing fuzzyMergeMediaClusters ever compares within, and hold a title pair whose character
 * multiset reaches SIMILARITY_THRESHOLD. That bound is the same exact one the merge pass uses to skip
 * the wasm alignment, so no pair the pass could weld is missed by the selection. Two AniList ids are
 * two different works and stub is one cluster per season, so a weld between them is a wrong weld.
 *
 * The pool is MAIN TITLES ONLY, because that is all stub carries: every extractor emits a source's
 * own titles and none of them emits synonyms. Modelling a cluster as a title plus its synonyms
 * over-counts welds by about 2.6x and is how this axis was once justified on a number that did not
 * describe stub.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const CACHE = new URL('../node_modules/.cache/', import.meta.url).pathname
const ANILIST_DIR = `${CACHE}start-date-anilist`
const KITSU_DIR = `${CACHE}start-date-kitsu`
const OUT = `${CACHE}start-date-pool.json`
const MANAMI = `${CACHE}manami-titles.json`

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ AniList

The API caps a single sorted listing at 5000 entries ("Page depth exceeds maximum allowed"), so the
corpus is sharded on the START DATE rather than fetched in one listing. On startDate and not on
seasonYear, because stub's year bucket is read off `media.startDate` and a great many entries carry a
real start date with no season assigned: OVAs, specials and most movies, which is most of the
population this measurement is about. */
const MEDIA_FIELDS = `
      id
      title { romaji english native }
      startDate { year month day }
      format
      episodes`

const DATE_QUERY = `
query ($page: Int, $perPage: Int, $from: FuzzyDateInt, $to: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage hasNextPage total }
    media(type: ANIME, startDate_greater: $from, startDate_lesser: $to, sort: POPULARITY_DESC) {${MEDIA_FIELDS}
    }
  }
}`

// `x-ratelimit-reset` is not something to compute a sleep from: it comes back stale often enough that
// `reset * 1000 - Date.now()` is negative, which turns a rate-limit backoff into a 1ms one and burns
// every retry in seconds. `retry-after` when it is there, a flat minute when it is not.
const anilistPage = async (variables) => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch('https://graphql.anilist.co/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: DATE_QUERY, variables }),
    }).catch(() => null)
    if (!response) { await sleep(5_000); continue }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? (retryAfter + 1) * 1000 : 62_000)
      continue
    }
    if (!response.ok) { await sleep(Math.min(60_000, 2_000 * 2 ** attempt)); continue }
    const body = await response.json().catch(() => null)
    if (body?.data?.Page) return body.data.Page
    await sleep(6_000)
  }
  throw new Error(`AniList refused ${JSON.stringify(variables)} fifteen times`)
}

const fetchAnilist = async () => {
  mkdirSync(ANILIST_DIR, { recursive: true })
  const thisYear = new Date().getUTCFullYear()
  for (let year = 1960; year <= thisYear + 2; year++) {
    // Two half-year shards, because a whole year of AniList start dates can exceed the page-depth cap.
    // `startDate_greater` is EXCLUSIVE, and the first shard starts one BELOW YYYY0000 on purpose: an
    // entry AniList dates to a year and no month carries the FuzzyDateInt YYYY0000, which sits below
    // YYYY0101, so a shard opening on the 1st of January silently drops every year-precision record.
    // That is exactly the population the January 1 guard is about, so losing it would hide the cost.
    for (const [tag, from, to] of [['a', year * 10000 - 1, year * 10000 + 701], ['b', year * 10000 + 700, year * 10000 + 1232]]) {
      let page = 1
      for (;;) {
        const file = `${ANILIST_DIR}/d${year}${tag}-${String(page).padStart(4, '0')}.json`
        if (existsSync(file)) {
          if (!JSON.parse(readFileSync(file, 'utf8')).pageInfo.hasNextPage) break
          page++
          continue
        }
        const result = await anilistPage({ page, perPage: 50, from, to })
        writeFileSync(file, JSON.stringify({ pageInfo: result.pageInfo, media: result.media }))
        if (!result.pageInfo.hasNextPage) break
        page++
        // the live bucket answers x-ratelimit-limit 30, not the documented 90, so ~24 requests a
        // minute keeps the whole run off the 429 path rather than paying a 62 second backoff for it
        await sleep(2_500)
      }
    }
    if (year % 10 === 0) console.log(`  anilist through ${year}`)
  }
}

/* -------------------------------------------------------------------- Kitsu

Only the fields kitsu/extractor.ts reads: buildTitles takes titles.en, canonicalTitle and
titles.ja_jp, and startDate is passed through untouched. */
const fetchKitsu = async (ids) => {
  mkdirSync(KITSU_DIR, { recursive: true })
  const chunks = []
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20))
  let n = 0
  for (const chunk of chunks) {
    const file = `${KITSU_DIR}/chunk-${String(++n).padStart(5, '0')}.json`
    if (existsSync(file)) continue
    let data
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(
        `https://kitsu.app/api/edge/anime?filter%5Bid%5D=${chunk.join(',')}&page%5Blimit%5D=20`,
        { headers: { Accept: 'application/vnd.api+json' } }
      ).catch(() => null)
      if (!response?.ok) { await sleep(4_000); continue }
      const body = await response.json().catch(() => null)
      if (body?.data) { data = body.data; break }
      await sleep(4_000)
    }
    // an empty chunk is recorded so a rerun does not ask again, and it can only cost coverage
    writeFileSync(file, JSON.stringify((data ?? []).map(record => ({
      id: Number(record.id),
      startDate: record.attributes.startDate,
      canonicalTitle: record.attributes.canonicalTitle,
      titles: record.attributes.titles,
      subtype: record.attributes.subtype,
    }))))
    if (n % 100 === 0) console.log(`  kitsu ${n}/${chunks.length}`)
    await sleep(300)
  }
}

/* ------------------------------------------------------ selection, no network

normalizeTitle and maxPossibleSimilarity are copied rather than imported: this file is plain node and
fuzzy-merge.ts is TypeScript that pulls in the wasm matcher. Both copies are pure and are asserted
against the real ones by the probe, which imports the real module, so a drift fails there loudly. */
const stripTitle = title =>
  title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
const normalizeTitle = title =>
  stripTitle(title).replace(/\b(?:the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim()
const SEASON_MARKER = [
  /\s*\b(?:(?:season|part|cour)\s*\d{1,3}|\d{1,3}(?:st|nd|rd|th)\s+(?:season|part|cour)|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:season|part|cour))\b/gi,
  /\s*(?:シーズン\s*\d{1,3}|第\s*[\d〇零一二三四五六七八九十]{1,4}\s*[期季])/g,
]
const HAS_LETTER = /\p{L}/u
const carriesIdentity = title =>
  HAS_LETTER.test(title) && HAS_LETTER.test(SEASON_MARKER.reduce((text, marker) => text.replace(marker, ' '), title))

const maxPossibleSimilarity = (a, b) => {
  const counts = new Map()
  for (const char of a) counts.set(char, (counts.get(char) ?? 0) + 1)
  let common = 0
  for (const char of b) {
    const count = counts.get(char) ?? 0
    if (count > 0) { counts.set(char, count - 1); common++ }
  }
  return common / Math.max(a.length, b.length)
}

// airedDate() from src/sources/aired-date.ts, with no airingSchedule in this corpus: a complete
// FuzzyDate is what that function returns outright, and an incomplete one goes out as its year or month
const airedDate = fuzzy => {
  if (fuzzy?.year && fuzzy.month && fuzzy.day) return new Date(Date.UTC(fuzzy.year, fuzzy.month - 1, fuzzy.day)).toUTCString()
  if (fuzzy?.year) return fuzzy.month ? `${fuzzy.year}-${String(fuzzy.month).padStart(2, '0')}` : String(fuzzy.year)
  return null
}

const main = async () => {
  if (!existsSync(MANAMI)) {
    throw new Error(`${MANAMI} is missing. Run \`npm run data:build\` or \`node scripts/fetch-title-corpus.mjs\` first.`)
  }

  console.log('fetching the AniList corpus (cached, first run takes about 15 minutes)')
  await fetchAnilist()

  const byId = new Map()
  for (const file of readdirSync(ANILIST_DIR)) {
    for (const record of JSON.parse(readFileSync(`${ANILIST_DIR}/${file}`, 'utf8')).media ?? []) {
      if (!byId.has(record.id)) byId.set(record.id, record)
    }
  }
  console.log('anilist entries:', byId.size)

  const kitsuOf = new Map()
  for (const record of JSON.parse(readFileSync(MANAMI, 'utf8')).records) {
    let anilist = null
    let kitsu = null
    for (const source of record.sources ?? []) {
      const a = source.match(/anilist\.co\/anime\/(\d+)/)
      if (a) { anilist = Number(a[1]); continue }
      const k = source.match(/kitsu\.app\/anime\/(\d+)/)
      if (k) kitsu = Number(k[1])
    }
    if (anilist && kitsu) kitsuOf.set(anilist, kitsu)
  }

  const wanted = [...new Set([...byId.keys()].map(id => kitsuOf.get(id)).filter(Boolean))]
  console.log('fetching kitsu for', wanted.length, 'entries (cached)')
  await fetchKitsu(wanted)

  const kitsu = new Map()
  for (const file of readdirSync(KITSU_DIR)) {
    for (const record of JSON.parse(readFileSync(`${KITSU_DIR}/${file}`, 'utf8'))) kitsu.set(record.id, record)
  }

  const entries = []
  for (const record of byId.values()) {
    const emitted = airedDate(record.startDate)
    if (!emitted) continue
    const k = kitsu.get(kitsuOf.get(record.id))
    const kitsuTitles = []
    const seen = new Set()
    for (const title of [k?.titles?.en, k?.canonicalTitle, k?.titles?.ja_jp]) {
      if (title && !seen.has(title)) { seen.add(title); kitsuTitles.push(title) }
    }
    const titles = [...new Set(
      [record.title?.english, record.title?.romaji, record.title?.native, ...kitsuTitles]
        .filter(Boolean).map(normalizeTitle).filter(carriesIdentity)
    )].slice(0, 6)
    if (!titles.length) continue
    entries.push({
      id: record.id,
      format: record.format,
      episodes: record.episodes ?? null,
      english: record.title?.english ?? null,
      romaji: record.title?.romaji ?? null,
      native: record.title?.native ?? null,
      emitted,
      year: new Date(emitted).getUTCFullYear(),
      titles,
      kitsu: k
        ? { id: k.id, startDate: k.startDate ?? null, subtype: k.subtype, titles: kitsuTitles }
        : null,
    })
  }

  const byYear = new Map()
  for (const entry of entries) {
    const bucket = byYear.get(entry.year)
    if (bucket) bucket.push(entry)
    else byYear.set(entry.year, [entry])
  }
  const pairs = []
  for (const bucket of byYear.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]
        const b = bucket[j]
        let reachable = false
        for (const titleA of a.titles) {
          for (const titleB of b.titles) {
            if (titleA === titleB || maxPossibleSimilarity(titleA, titleB) >= 0.9) { reachable = true; break }
          }
          if (reachable) break
        }
        if (reachable) pairs.push({ a: a.id, b: b.id, year: a.year })
      }
    }
  }

  console.log('entries with a date and an identity title:', entries.length)
  console.log('entries carrying a kitsu record:', entries.filter(entry => entry.kitsu).length)
  console.log('same-year candidate pairs:', pairs.length)
  writeFileSync(OUT, JSON.stringify({ entries, pairs }))
  console.log('wrote', OUT)
}

await main()
