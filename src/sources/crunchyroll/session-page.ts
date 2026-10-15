// Stub's code inside a page at www.crunchyroll.com, where the viewer's session cookie and the device id
// the site keeps ride along. Built into one self-contained function (scripts/page-script.ts) and
// installed with `frame.evaluate`, once per document, by the session frame (tracking/session-frames.ts).

import type { ServeArg } from '../../tracking/session-frames'
import type { SeasonIds } from './season-id'
import type { PageFetch, TokenAnswer } from './sign-in-check'

import { installSessionServer } from '../../tracking/page-install'
import { findSeason, resolveSeasonId } from './season-id'
import { CRUNCHYROLL_BASE_URL } from './session'
import { askForToken, TOKEN_REQUEST } from './sign-in-check'

/** A season as a `cr:` id names it: its series, and the season as the id carries it. */
export type WatchedRequest = { seriesId: string, seasonId: string }

/** One numbered episode of a season, and whether the account fully watched any audio version of it. */
export type WatchedEpisode = { number: number, watched: boolean }

/** The token call's answer, and once a token is granted, what the account watched of the season. */
export type WatchedAnswer = TokenAnswer & { episodes?: WatchedEpisode[] }

/** What the page serves over its port. */
export type CrunchyrollPageApi = { watched: (request: WatchedRequest) => Promise<WatchedAnswer> }

type Episode = { id: string, episode_number: number | null, versions?: { guid: string }[] | null }

// a chosen size, not a measured limit: a long season in every audio version is a list of kilobytes
const PLAYHEADS_AT_ONCE = 50

const idsOf = (episode: Episode) => [episode.id, ...(episode.versions ?? []).map(version => version.guid)]

/**
 * What the account watched of one season, read with the viewer's own token: the season found in its
 * series the way the source finds it, since the `cr:` id may not be the one the API answers on, then
 * its episodes and their playheads, every audio version's, the way crunchyroll-rs and Universal Trakt
 * Scrobbler read them (never measured signed in: a list of ids in one `content_ids` is inferred from its
 * name). A fresh token per read keys every request apart in the relay's cache.
 */
export const readWatched = async ({ seriesId, seasonId }: WatchedRequest, send: PageFetch): Promise<WatchedAnswer> => {
  const { read, ...answer } = await askForToken(TOKEN_REQUEST, send, async ({ access_token: token, account_id: account }) => {
    const list = async <T>(path: string): Promise<T[]> => {
      const response = await send(`${CRUNCHYROLL_BASE_URL}${path}`, { headers: { authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error(`Crunchyroll answered ${response.status}`)
      const { data } = await response.json() as { data?: unknown }
      if (!Array.isArray(data)) throw new Error('Crunchyroll answered with no list')
      return data as T[]
    }
    const seasons = await list<SeasonIds>(`/content/v2/cms/series/${encodeURIComponent(seriesId)}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`)
    const season = findSeason(seasons, seasonId)
    if (!season) throw new Error('Crunchyroll lists no such season')
    const episodes = await list<Episode>(`/content/v2/cms/seasons/${encodeURIComponent(resolveSeasonId(season))}/episodes?preferred_audio_language=ja-JP&locale=en-US`)
    const ids = [...new Set(episodes.flatMap(idsOf))]
    const parts = Array.from({ length: Math.ceil(ids.length / PLAYHEADS_AT_ONCE) }, (_, at) => ids.slice(at * PLAYHEADS_AT_ONCE, (at + 1) * PLAYHEADS_AT_ONCE))
    const heads = await Promise.all(parts.map(part =>
      list<{ content_id: string, fully_watched: boolean }>(`/content/v2/${account}/playheads?content_ids=${part.join(',')}&locale=en-US`)))
    const watched = new Set(heads.flat().filter(head => head.fully_watched).map(head => head.content_id))
    return episodes.flatMap(episode => episode.episode_number == null ? [] : [{ number: episode.episode_number, watched: idsOf(episode).some(id => watched.has(id)) }])
  })
  return read ? { ...answer, episodes: read } : answer
}

/** The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg. */
export const run = (arg: ServeArg) => {
  const page = globalThis as typeof globalThis & Record<symbol, unknown>
  const api: CrunchyrollPageApi = {
    watched: request => readWatched(request, (input, init) => page.fetch(input, init)),
  }
  return installSessionServer(arg, page, api)
}
