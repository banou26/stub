// MyAnimeList's season pages, as the data build lays them over the bundled seasons. Its own module so
// it can be tested: ./build-anime-data.mjs runs the whole build when imported.
//
// Imports the live source's parser as .ts, which node loads by stripping the types (22.18 or newer;
// Pages builds on the version .node-version names).

import { MAL_TYPE, isContinuing, parseMalSeason } from '../src/sources/jikan/season-scrape.ts'
import { mediaSeasonNow } from '../src/sources/season.ts'
import { orderSeasonBucket } from './season-order.mjs'

const TIMEOUT_MS = 30_000
const ATTEMPTS = 3
const PAUSE_MS = 2_000
// six pages take about 2 s (measured 2026-10-16); the budget only stops a slow site stretching a deploy
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
      const response = await get(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
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
 * Each season's page, one after another, with the seasons whose page could not be read in `failed`.
 *
 * A page that fails every attempt ends the run: MyAnimeList is then not answering this build, and
 * every further page could add 90 s of timeouts to a deploy for nothing. Once `budgetMs` has passed,
 * the run ends after the page being read, so the first season is always asked.
 */
export const malSeasons = async (keys, get = fetch, pauseMs = PAUSE_MS, budgetMs = BUDGET_MS) => {
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
      pages.set(key, await malSeason(key, get, pauseMs))
      if (Date.now() > until) skip = `not asked after ${budgetMs / 1000} s`
    } catch (error) {
      failed.set(key, error)
      skip = `not asked after ${key} failed`
    }
  }
  return { pages, failed }
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
 * paints, so the first paint is the order the live `mal` source settles it into.
 *
 * A record takes the member count MyAnimeList shows for it on any season's page: the offline database
 * and MyAnimeList file some shows a season apart. A show a season's page lists that its bucket lacks
 * is added from its card, also when another bucket holds it, as the live source answers it for every
 * season whose page lists it. An R18+ title is in no season. Synopses go only to the season running
 * now (`now`), the one the home page's hero reads.
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
  const keys = Object.keys(seasons).sort((a, b) => Number(b === now) - Number(a === now))
  const { pages, failed } = await malSeasons(keys, get, pauseMs, budgetMs)
  return { seasons: withMalSeasons(seasons, pages, now, anilistOf), pages, failed }
}
