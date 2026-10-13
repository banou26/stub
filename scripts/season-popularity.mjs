// MyAnimeList's popularity for the season running now, as the data build attaches it to the bundle.
// Its own module so it can be tested: ./build-anime-data.mjs runs the whole build when imported.
//
// Imports the live source's parser as .ts, which node loads by stripping the types (22.18 or newer;
// Pages builds on the version .node-version names).

import { isContinuing, parseMalSeason } from '../src/sources/jikan/season-scrape.ts'

export const SEASON_PAGE = 'https://myanimelist.net/anime/season'
const TIMEOUT_MS = 30_000
const ATTEMPTS = 3
const PAUSE_MS = 2_000

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
 * MyAnimeList's member count and synopsis for each show its season page lists as new this season,
 * keyed by mal id. Throws, saying why, when no attempt reads a page that parses to entries.
 *
 * Read off myanimelist.net rather than Jikan: Jikan's public API shut down on 2026-10-01
 * (jikan-me/jikan-rest#613) and has refused every connection since. The live `mal` source reads the
 * same page with the same parser and drops the same carried-over block, so the bundle's count is the
 * one that source restates at 0.9.
 */
export const malSeason = async (get = fetch, pauseMs = PAUSE_MS) => {
  let last
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, pauseMs))
    try {
      const response = await get(SEASON_PAGE, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) throw new Error(`${SEASON_PAGE} answered HTTP ${response.status}`)
      const html = await response.text()
      const entries = parseMalSeason(html).filter(entry => !isContinuing(entry))
      if (!entries.length) throw new Error(`${SEASON_PAGE} parsed to no entries from ${html.length} bytes`)
      return new Map(entries.map(entry => [Number(entry.id), { members: entry.members, synopsis: entry.synopsis, adult: entry.adult }]))
    } catch (error) {
      last = error
    }
  }
  throw last
}
