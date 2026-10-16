// Every season source stub reads live, as the data build lays them over the bundled seasons:
// MyAnimeList's season pages, AniList's season browse and Kitsu's season pages. Not LiveChart, the
// fourth: its robots.txt disallows /api/ to every automated agent (read 2026-10-16), and it carries no
// count. Its own module so it can be tested: ./build-anime-data.mjs runs the whole build when imported.
//
// Imports the live sources' parsers as .ts, which node loads by stripping the types (22.18 or newer;
// Pages builds on the version .node-version names).

import { MAL_TYPE, isContinuing, parseMalSeason } from '../src/sources/jikan/season-scrape.ts'
import { seasonPageNumbers, seasonQuery } from '../src/sources/kitsu/season-paging.ts'
import { mediaSeasonNow } from '../src/sources/season.ts'
import { COLUMNS, mergeIds } from './merge-ids.mjs'
import { orderSeasonBucket } from './season-order.mjs'

const TIMEOUT_MS = 30_000
const ATTEMPTS = 3
const PAUSE_MS = 2_000
// the three sources' six seasons take about 3 s at once (measured 2026-10-16); the budget only stops a
// slow site stretching a deploy
const BUDGET_MS = 30_000
const COVER_PREFIX = 'https://cdn.myanimelist.net/images/anime/'

/**
 * An error as one line that says what failed.
 *
 * Node's connect failure is an AggregateError with an EMPTY message, the code on the error and one
 * reason per address in `errors`, and `fetch` wraps any failure as a bare `fetch failed` with the
 * reason in `cause`. Printing `message` alone logged `(page 1 ())` on every build from 2026-10-03.
 */
export const errorText = error => {
  if (!(error instanceof Error)) return String(error)
  const own = error.message || error.code || error.name
  const inner = [...(error.errors ?? []), ...(error.cause === undefined ? [] : [error.cause])].map(errorText)
  return inner.length ? `${own} (${inner.join('; ')})` : own
}

/**
 * The cards MyAnimeList's page for one bundle season (`2026-SUMMER`) lists as new that season, keyed
 * by mal id, the same page and the same cards the live `mal` source answers that season with. Throws,
 * saying why, when no attempt reads a page that parses to entries.
 *
 * Read off myanimelist.net rather than Jikan: Jikan's public API shut down on 2026-10-01
 * (jikan-me/jikan-rest#613) and has refused every connection since.
 */
export const malSeason = async (key, get = fetch, pauseMs = PAUSE_MS) => {
  const [year, season] = key.split('-')
  const url = `https://myanimelist.net/anime/season/${year}/${season.toLowerCase()}`
  let last
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, pauseMs))
    try {
      // a card carries its English title only on a page asked for in English, and node's fetch asks for `*`
      const response = await get(url, { redirect: 'manual', headers: { 'accept-language': 'en' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      // a season with no page yet answers 303 to /anime/season, the season running now, whose shows
      // would otherwise all be filed under this one
      if (response.status >= 300 && response.status < 400) return new Map()
      if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
      const html = await response.text()
      const entries = parseMalSeason(html).filter(entry => !isContinuing(entry))
      if (!entries.length) throw new Error(`${url} parsed to no entries from ${html.length} bytes`)
      return new Map(entries.map(entry => [Number(entry.id), entry]))
    } catch (error) {
      last = error
    }
  }
  throw last
}

/**
 * Each season read by `read`, one after another, with the seasons not read in `failed`.
 *
 * A season that fails ends the run: the source is then not answering this build, and every further
 * season could add its timeouts to a deploy for nothing. Once `budgetMs` has passed, the run ends after
 * the season being read, so the first season is always asked.
 */
const seasonsInTurn = async (keys, read, budgetMs = BUDGET_MS) => {
  const until = Date.now() + budgetMs
  const pages = new Map()
  const failed = new Map()
  let skip
  for (const key of keys) {
    if (skip) {
      failed.set(key, new Error(skip))
      continue
    }
    try {
      pages.set(key, await read(key))
      if (Date.now() > until) skip = `not asked after ${budgetMs / 1000} s`
    } catch (error) {
      failed.set(key, error)
      skip = `not asked after ${key} failed`
    }
  }
  return { pages, failed }
}

/** Each season's MyAnimeList page in turn (see `seasonsInTurn`), each read with up to three attempts. */
export const malSeasons = (keys, get = fetch, pauseMs = PAUSE_MS, budgetMs = BUDGET_MS) =>
  seasonsInTurn(keys, key => malSeason(key, get, pauseMs), budgetMs)

const ANILIST = 'https://graphql.anilist.co'
// The live source's season browse (src/sources/anilist/extractor.ts): three pages of 50 under this sort
// are the season's 150 most popular, the window whose counts the live page shows.
const ANILIST_PAGES = 3
const ANILIST_QUERY = `query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page) {
    pageInfo { hasNextPage }
    media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC]) {
      id idMal isAdult format episodes popularity averageScore title { romaji english } coverImage { extraLarge }
    }
  }
}`

// a 0 to 100 score as the bundle's 1 to 10 one, to two places as the offline database's are
const outOfTen = score => Math.round(Number(score) * 10) / 100

/**
 * AniList's season (`2026-SUMMER`) as bundle records keyed by their AniList id, each named by its
 * English title first as the live source names it, the titles AniList marks adult left out. Throws,
 * saying why, when a page cannot be read.
 */
export const anilistSeason = async (key, get = fetch) => {
  const [year, season] = key.split('-')
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const media = []
  for (let page = 1; page <= ANILIST_PAGES; page++) {
    const response = await get(ANILIST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { season, seasonYear: Number(year), page } }),
      signal,
    })
    if (!response.ok) throw new Error(`AniList ${key} page ${page} answered HTTP ${response.status}`)
    const { data, errors } = await response.json()
    if (!data?.Page) throw new Error(`AniList ${key} page ${page} answered no page${errors ? ` (${errors.map(error => error.message).join('; ')})` : ''}`)
    media.push(...data.Page.media)
    if (!data.Page.pageInfo.hasNextPage) break
  }
  return media
    .filter(entry => !entry.isAdult)
    .map(entry => ({
      t: entry.title.english || entry.title.romaji,
      ty: entry.format ?? 'UNKNOWN',
      p: entry.coverImage?.extraLarge ?? '',
      ...entry.episodes && { ep: entry.episodes },
      al: entry.id,
      ...entry.idMal && { ml: entry.idMal },
      ...entry.averageScore && { sc: outOfTen(entry.averageScore) },
      ...entry.popularity && { pop: entry.popularity },
    }))
}

// one id, or none: two mappings to one catalogue, or a slug, name no entry to pair with
const onlyId = ids => ids.length === 1 ? Number(ids[0]) || undefined : undefined

/**
 * Kitsu's season (`2026-SUMMER`) as bundle records keyed by their Kitsu id, off the pages the live
 * `kitsu` source asks, with the MyAnimeList and AniList ids its mappings name, each named by its English
 * title first as the live source names it. Throws, saying why, when a page cannot be read, so a season
 * is never counted in part.
 */
export const kitsuSeason = async (key, get = fetch) => {
  const [year, season] = key.split('-')
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const pages = await Promise.all(seasonPageNumbers().map(async page => {
    const url = `https://kitsu.io/api/edge${seasonQuery({ season: season.toLowerCase(), year: Number(year), page })}`
    const response = await get(url, { signal })
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
    return response.json()
  }))
  return pages.flatMap(({ data = [], included = [] }) => {
    const mappings = new Map(included.map(mapping => [mapping.id, mapping.attributes]))
    return data.map(({ id, attributes: anime, relationships }) => {
      const linked = site => onlyId((relationships?.mappings?.data ?? [])
        .map(ref => mappings.get(ref.id))
        .filter(mapping => mapping?.externalSite === site)
        .map(mapping => mapping.externalId))
      const [ml, al] = [linked('myanimelist/anime'), linked('anilist/anime')]
      return {
        t: anime.titles?.en || anime.canonicalTitle,
        ty: anime.subtype?.toUpperCase() ?? 'UNKNOWN',
        p: anime.posterImage?.original ?? anime.posterImage?.large ?? anime.posterImage?.medium ?? '',
        ...anime.episodeCount && { ep: anime.episodeCount },
        ku: Number(id),
        ...ml && { ml },
        ...al && { al },
        ...anime.averageRating && { sc: outOfTen(anime.averageRating) },
        ...anime.userCount && { pop: anime.userCount },
      }
    })
  })
}

const cardRecord = (id, card, anilist) => ({
  t: card.title,
  ty: MAL_TYPE[card.typeId] ?? 'UNKNOWN',
  p: card.cover?.replace(COVER_PREFIX, '') ?? '',
  ...card.episodes && { ep: card.episodes },
  ml: id,
  ...anilist && { al: anilist },
  ...card.score && { sc: card.score },
})

/**
 * The bundled seasons with MyAnimeList's pages laid over them, each bucket in the order the listing
 * paints, so the first paint is the order and the titles the live `mal` source settles it into.
 *
 * A record takes the member count, the cover and the title MyAnimeList shows for it on any season's
 * page, its English title first: the offline database and MyAnimeList file some shows a season apart.
 * A show a season's page lists that its bucket lacks is added from its card, also when another bucket
 * holds it, as the live source answers it for every season whose page lists it. An R18+ title is in
 * no season. Synopses go only to the season running now (`now`), the one the home page's hero reads.
 *
 * A bundled record keeps its own ids. An added show carries the AniList id `anilistOf` pairs with its
 * mal id (see `anilistPairs`), so a show in two buckets names the same shows in both.
 */
export const withMalSeasons = (seasons, pages, now, anilistOf = new Map()) => {
  const cards = new Map([...pages.values()].flatMap(page => [...page]))
  const laid = {}
  for (const key of new Set([...Object.keys(seasons), ...pages.keys()])) {
    const records = seasons[key] ?? []
    const held = new Set(records.map(record => record.ml))
    const added = [...pages.get(key) ?? []].filter(([id]) => !held.has(id)).map(([id, card]) => cardRecord(id, card, anilistOf.get(id)))
    laid[key] = orderSeasonBucket([...records, ...added]
      .filter(record => !cards.get(record.ml)?.adult)
      .map(record => {
        const card = cards.get(record.ml)
        return {
          ...record,
          ...card && { t: card.englishTitle ?? card.title },
          ...card?.cover && { p: card.cover.replace(COVER_PREFIX, '') },
          ...card?.members && { pop: card.members },
          ...key === now && card?.synopsis && { sy: card.synopsis },
        }
      }))
  }
  return laid
}

/**
 * The AniList id of each mal id, for the shows MyAnimeList adds: the offline database's pair where it
 * has a row for the mal id, else arm's, unless the offline database pairs that AniList id with another
 * mal id. The trackers read the offline database's pairs, and a record naming an AniList id it pairs
 * elsewhere is two shows to them, so they refuse it: AniList ties Steel Ball Run's 2nd Stage (210482)
 * to the 1st stage's mal 61469, while the offline database pairs 61469 with 190327 and 210482 with
 * 63825 (2026-10-16). `offline` is the database's `[mal, anilist]` pairs.
 */
export const anilistPairs = (arm, offline) => {
  const offlineAnilist = new Map(offline.filter(([mal]) => mal).map(([mal, anilist]) => [mal, anilist]))
  const offlineMal = new Map(offline.filter(([, anilist]) => anilist).map(([mal, anilist]) => [anilist, mal]))
  const pairs = new Map()
  for (const { mal_id: mal, anilist_id: anilist } of arm) {
    if (!mal || !anilist || offlineAnilist.has(mal)) continue
    if (!offlineMal.has(anilist) || offlineMal.get(anilist) === mal) pairs.set(mal, anilist)
  }
  for (const [mal, anilist] of offlineAnilist) if (anilist) pairs.set(mal, anilist)
  return pairs
}

const seasonNow = () => {
  const { year, season } = mediaSeasonNow()
  return `${year}-${season}`
}

const CATALOGUES = ['ml', 'al', 'ku']

/**
 * `showOf(ids)`: every id of the one show that carries `ids`, through each row of the trackers' index
 * and each record already bundled that names one of them, directly or through each other; undefined
 * when those name another id beside one of `ids`, so that `ids` are two shows. The trackers refuse a
 * record naming ids their index places in two shows, and the store joins everything a record names
 * into one show for good. `add` makes a new record one of those rows.
 */
const pairing = (index, seasons) => {
  const rows = Object.fromEntries(CATALOGUES.map(catalogue => [catalogue, new Map()]))
  const add = row => {
    for (const catalogue of CATALOGUES) {
      if (row[catalogue]) rows[catalogue].set(row[catalogue], [...rows[catalogue].get(row[catalogue]) ?? [], row])
    }
  }
  for (const { mal, anilist, kitsu } of index) add({ ml: mal, al: anilist, ku: kitsu })
  for (const records of Object.values(seasons)) records.forEach(add)
  const showOf = ids => {
    const show = { ...ids }
    for (let grew = true; grew;) {
      grew = false
      for (const catalogue of CATALOGUES) {
        for (const row of rows[catalogue].get(show[catalogue]) ?? []) {
          for (const other of CATALOGUES) {
            if (!row[other] || row[other] === show[other]) continue
            if (show[other]) return undefined
            show[other] = row[other]
            grew = true
          }
        }
      }
    }
    return show
  }
  return { add, showOf }
}

/**
 * The seasons `withMalSeasons` laid, with AniList's and Kitsu's records laid over them: `answers` is
 * each source's `{ own, pages }`, `own` the catalogue its records are keyed by (`al`, `ku`) and `pages`
 * its records by season. `index` is the trackers' index, as `{ mal, anilist, kitsu }` rows.
 *
 * A record takes the count, the cover and the title the live page settles on, from the highest scored
 * source giving one this season: for the count MyAnimeList (0.9), AniList (0.8), Kitsu (0.3), else its
 * own; for the cover MyAnimeList's, AniList's `extraLarge`, Kitsu's original, else its own; for the
 * title MyAnimeList's English one (0.9), AniList's (0.8), MyAnimeList's romaji one (0.4), Kitsu's
 * (0.3), else its own (0.2). A source's record keeps its own id and only the ids it claims that agree
 * with every other show's (see `pairing`). It joins the bundled records of its season those ids
 * name, which become one record when there are several (the offline database holds some shows as two
 * records with no id in common): the first in the bucket's order, keeping its fields and taking the
 * others' where it has none. A source's record whose ids name none is added. A show MyAnimeList marks
 * R18+ is in no season, also when a source names it by another catalogue's id only.
 */
const withSeasonSources = (seasons, malPages, answers, index = []) => {
  const { add, showOf } = pairing(index, seasons)
  const adult = new Set([...malPages.values()].flatMap(page => [...page].filter(([, card]) => card.adult).map(([id]) => id)))
  const laid = {}
  for (const [key, bucket] of Object.entries(seasons)) {
    const records = [...bucket]
    const listed = new Map()
    for (const { own, pages } of answers) {
      for (const row of pages.get(key) ?? []) {
        const ids = CATALOGUES.reduce((named, catalogue) =>
          catalogue !== own && row[catalogue] && showOf({ ...named, [catalogue]: row[catalogue] }) ? { ...named, [catalogue]: row[catalogue] } : named,
        { [own]: row[own] })
        if (adult.has(row.ml) || adult.has(showOf(ids)?.ml)) continue
        const [found, ...others] = records.filter(candidate => CATALOGUES.some(catalogue => ids[catalogue] && candidate[catalogue] === ids[catalogue]))
        const record = found ?? { ...Object.fromEntries(Object.entries(row).filter(([field]) => !CATALOGUES.includes(field))), ...ids }
        if (!found) {
          records.push(record)
          add(record)
        }
        for (const other of others) {
          records.splice(records.indexOf(other), 1)
          Object.assign(record, { ...other, ...record })
          listed.set(record, { ...listed.get(other), ...listed.get(record) })
          add(record)
        }
        listed.set(record, { [own]: row, ...listed.get(record) })
      }
    }
    laid[key] = orderSeasonBucket(records.map(record => {
      const card = malPages.get(key)?.get(record.ml)
      const { al, ku } = listed.get(record) ?? {}
      const pop = card?.members || al?.pop || ku?.pop || record.pop
      const p = card?.cover?.replace(COVER_PREFIX, '') || al?.p || ku?.p || record.p
      return { ...record, t: card?.englishTitle ?? al?.t ?? card?.title ?? ku?.t ?? record.t, p, ...pop && { pop } }
    }))
  }
  return laid
}

const askOrder = (seasons, now) => Object.keys(seasons).sort((a, b) => Number(b === now) - Number(a === now))

/**
 * The bundled seasons (`2026-SUMMER` to records) with MyAnimeList's page for each laid over them by
 * `withMalSeasons`, with the pages read and the seasons whose page was not, for the build's log.
 *
 * The season running now (`now`) is asked first, since a failure or a slow site ends the run: its
 * counts and synopses are what the home page's row and hero read. `arm` is @kawaiioverflow/arm's
 * rows and `offline` the offline database's `[mal, anilist]` pairs, which together give the AniList id
 * of each show MyAnimeList lists (`anilistPairs`).
 */
export const malSeasonData = async (seasons, arm, { offline = [], now = seasonNow(), get = fetch, pauseMs = PAUSE_MS, budgetMs = BUDGET_MS } = {}) => {
  const anilistOf = anilistPairs(arm, offline)
  const { pages, failed } = await malSeasons(askOrder(seasons, now), get, pauseMs, budgetMs)
  return { seasons: withMalSeasons(seasons, pages, now, anilistOf), pages, failed }
}

/**
 * The bundled seasons with every season source laid over them (`malSeasonData`, then
 * `withSeasonSources` with AniList's and Kitsu's), and each source's reads (`{ pages, failed }`) for the
 * build's log. `rows` is the offline database's rows (`[mal, ...COLUMNS]`), which with arm's give the
 * trackers' index (`mergeIds`) and the AniList id of each show MyAnimeList adds (`anilistPairs`).
 *
 * The three sources are read at once, each season by season as `seasonsInTurn` reads them, the season
 * running now first, within one time budget. A source that fails or is not asked leaves the seasons as
 * the others lay them.
 */
export const seasonData = async (seasons, arm, { rows = [], ...options } = {}) => {
  const { now = seasonNow(), get = fetch, budgetMs = BUDGET_MS } = options
  const keys = askOrder(seasons, now)
  const offline = rows.map(row => [row[0], row[1 + COLUMNS.indexOf('anilist')]])
  const [myanimelist, anilist, kitsu] = await Promise.all([
    malSeasonData(seasons, arm, { ...options, offline, now }),
    seasonsInTurn(keys, key => anilistSeason(key, get), budgetMs),
    seasonsInTurn(keys, key => kitsuSeason(key, get), budgetMs),
  ])
  const answers = [{ own: 'al', pages: anilist.pages }, { own: 'ku', pages: kitsu.pages }]
  const index = mergeIds(arm, rows).kept
  return { seasons: withSeasonSources(myanimelist.seasons, myanimelist.pages, answers, index), reads: { myanimelist, anilist, kitsu } }
}
