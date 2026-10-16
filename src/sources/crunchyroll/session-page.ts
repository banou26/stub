// Stub's code inside a page at www.crunchyroll.com, where the viewer's session cookie and the device id
// the site keeps ride along. Built into one self-contained function (scripts/page-script.ts) and
// installed with `frame.evaluate`, once per document, by the session frame (tracking/session-frames.ts).

import type { ServeArg } from '../../tracking/session-frames'
import type { SeasonIds } from './season-id'
import type { PageFetch, TokenAnswer, TokenGrant } from './sign-in-check'

import { installSessionServer, randomNonce } from '../../tracking/page-install'
import { findSeason, resolveSeasonId } from './season-id'
import { CRUNCHYROLL_BASE_URL } from './session'
import { askForToken, TOKEN_REQUEST } from './sign-in-check'

/** A season as a `cr:` id names it: its series, and the season as the id carries it. */
export type WatchedRequest = { seriesId: string, seasonId: string }

/**
 * What the account holds: how far it got in the season, the place among its numbered episodes of the
 * last one fully watched in any audio version (Crunchyroll may number a season on from the one before),
 * and of the whole series its stars (1 to 5) and whether it is on the Watchlist.
 */
export type Held = { progress: number, stars: number | null, watchlisted: boolean }

/** The token call's answer, and once a token is granted, what the account holds. */
export type WatchedAnswer = TokenAnswer & { held?: Held }

/**
 * What a save sets, each field left as it is when absent: progress only ever rises, marking the one
 * episode at it, `stars` null asks for no rating, which Crunchyroll cannot take off once given, and
 * `watchlist` puts the series on the Watchlist or takes it off.
 */
export type SaveRequest = WatchedRequest & { progress?: number, stars?: number | null, watchlist?: boolean }

/** The token call's answer, and why nothing was written when the save was refused. */
export type SaveAnswer = TokenAnswer & { refused?: string }

/** What the page serves over its port. */
export type CrunchyrollPageApi = {
  watched: (request: WatchedRequest) => Promise<WatchedAnswer>
  save: (request: SaveRequest) => Promise<SaveAnswer>
}

type Episode = { id: string, episode_number: number | null, versions?: { guid: string }[] | null }

/** One numbered episode of the season: the first episode carrying the number, and whether any episode with it is fully watched. */
type Numbered = { id: string, watched: boolean }

// a chosen size, not a measured limit: a long season in every audio version is a list of kilobytes
const PLAYHEADS_AT_ONCE = 50

const idsOf = (episode: Episode) => [episode.id, ...(episode.versions ?? []).map(version => version.guid)]

const progressOf = (numbered: Numbered[]) => numbered.reduce((last, episode, at) => episode.watched ? at + 1 : last, 0)

/**
 * The account's half of crunchyroll.com, asked with the token just granted, the way the site's own web
 * client asks (its API table, read in its public bundle; never measured signed in). A list of ids in one
 * `content_ids` is what the site sends for playheads.
 *
 * Every request ends in `_=<nonce>`, as the token call does, so no cache keyed on the request (the FKN
 * relay's is) answers it with an earlier one: the token cannot be trusted to set two reads apart, since
 * nothing says Crunchyroll never grants the same one again.
 */
const account = ({ access_token: token, account_id: accountId }: TokenGrant, send: PageFetch) => {
  const ask = async (path: string, { method, body, done = [] }: { method?: string, body?: object, done?: number[] } = {}) => {
    const response = await send(`${CRUNCHYROLL_BASE_URL}${path}${path.includes('?') ? '&' : '?'}_=${randomNonce()}`, body
      ? { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method, headers: { authorization: `Bearer ${token}` } })
    if (!response.ok && !done.includes(response.status)) throw new Error(`Crunchyroll answered ${response.status}`)
    return response
  }
  const list = async <T>(path: string): Promise<T[]> => {
    const { data } = await (await ask(path)).json() as { data?: unknown }
    if (!Array.isArray(data)) throw new Error('Crunchyroll answered with no list')
    return data as T[]
  }

  const numbered = async ({ seriesId, seasonId }: WatchedRequest): Promise<Numbered[]> => {
    const seasons = await list<SeasonIds>(`/content/v2/cms/series/${encodeURIComponent(seriesId)}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`)
    const season = findSeason(seasons, seasonId)
    if (!season) throw new Error('Crunchyroll lists no such season')
    // the Japanese season, so each episode's own id is its Japanese version's
    const episodes = await list<Episode>(`/content/v2/cms/seasons/${encodeURIComponent(resolveSeasonId(season))}/episodes?preferred_audio_language=ja-JP&locale=en-US`)
    const ids = [...new Set(episodes.flatMap(idsOf))]
    const parts = Array.from({ length: Math.ceil(ids.length / PLAYHEADS_AT_ONCE) }, (_, at) => ids.slice(at * PLAYHEADS_AT_ONCE, (at + 1) * PLAYHEADS_AT_ONCE))
    const heads = await Promise.all(parts.map(part =>
      list<{ content_id: string, fully_watched: boolean }>(`/content/v2/${accountId}/playheads?content_ids=${part.join(',')}&locale=en-US`)))
    const watched = new Set(heads.flat().filter(head => head.fully_watched).map(head => head.content_id))
    const byNumber = new Map<number, Numbered>()
    for (const episode of episodes) {
      if (episode.episode_number == null) continue
      const seen = idsOf(episode).some(id => watched.has(id))
      const same = byNumber.get(episode.episode_number)
      byNumber.set(episode.episode_number, same ? { ...same, watched: same.watched || seen } : { id: episode.id, watched: seen })
    }
    return [...byNumber].sort(([a], [b]) => a - b).map(([, episode]) => episode)
  }

  const held = async (request: WatchedRequest) => {
    const [episodes, rated, listed] = await Promise.all([
      numbered(request),
      // never seen signed in: an unrated series may answer `rating: ""` (crunchyroll-rs reads that on v2) or a 404
      ask(`/content-reviews/v3/user/${accountId}/rating/series/${encodeURIComponent(request.seriesId)}`, { done: [404] })
        .then(response => response.ok ? response.json() as Promise<{ rating?: string } | null> : null),
      list<{ id: string }>(`/content/v2/${accountId}/watchlist?content_ids=${encodeURIComponent(request.seriesId)}`),
    ])
    const stars = Number(/^([1-5])s$/.exec(rated?.rating ?? '')?.[1]) || null
    return { episodes, stars, watchlisted: listed.some(item => item.id === request.seriesId) }
  }

  const save = async ({ progress, stars, watchlist, ...request }: SaveRequest): Promise<string | undefined> => {
    const now = await held(request)
    if (progress !== undefined) {
      const count = now.episodes.length
      if (progress > count) return `Crunchyroll lists ${count} episode${count === 1 ? '' : 's'} of this season`
      if (progress < progressOf(now.episodes)) return 'Crunchyroll cannot unmark an episode'
    }
    // the site's star never takes a rating off, and its thumbs' DELETE, sent with no body, answered 409 on stars
    if (stars === null && now.stars) return 'Crunchyroll cannot remove a rating'
    // never the earlier ones the account left unmarked; 409 is an episode Crunchyroll already counts as watched
    const episode = progress ? now.episodes[progress - 1] : undefined
    if (episode && !episode.watched) {
      await ask(`/content/v2/discover/${accountId}/mark_as_watched/${encodeURIComponent(episode.id)}`, { method: 'POST', done: [409] })
    }
    if (stars && stars !== now.stars) {
      await ask(`/content-reviews/v2/user/${accountId}/rating/series/${encodeURIComponent(request.seriesId)}`, { method: 'PUT', body: { rating: `${stars}s` } })
    }
    if (watchlist !== undefined && watchlist !== now.watchlisted) {
      await ask(
        watchlist ? `/content/v2/${accountId}/watchlist` : `/content/v2/${accountId}/watchlist/${encodeURIComponent(request.seriesId)}`,
        watchlist ? { method: 'POST', body: { content_id: request.seriesId } } : { method: 'DELETE' },
      )
    }
    return undefined
  }

  return { held, save }
}

/**
 * What the account holds of one season, read with the viewer's own token: the season found in its
 * series the way the source finds it, since the `cr:` id may not be the one the API answers on, then
 * its episodes and their playheads, every audio version's, and the series' stars and Watchlist.
 */
export const readWatched = async (request: WatchedRequest, send: PageFetch): Promise<WatchedAnswer> => {
  const { read, ...answer } = await askForToken(TOKEN_REQUEST, send, async grant => {
    const { episodes, ...series } = await account(grant, send).held(request)
    return { progress: progressOf(episodes), ...series }
  })
  return read ? { ...answer, held: read } : answer
}

/**
 * Writes a save to the account, after reading what it holds, so only what changes is sent: the numbered
 * episode at `progress` alone is marked watched, its Japanese version, unless an audio version of it
 * already is; the episodes before it stay as the account holds them. Refused with nothing written when
 * `progress` is past the season's numbered episodes, or under how far the account got, since Crunchyroll
 * has no unmark, and when `stars` is null on a rated series, since it has no way to take a rating off. A
 * write Crunchyroll does not take rejects, with what was sent before it kept.
 */
export const saveWatched = async (request: SaveRequest, send: PageFetch): Promise<SaveAnswer> => {
  const { read, ...answer } = await askForToken(TOKEN_REQUEST, send, grant => account(grant, send).save(request))
  return read ? { ...answer, refused: read } : answer
}

/** The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg. */
export const run = (arg: ServeArg) => {
  const page = globalThis as typeof globalThis & Record<symbol, unknown>
  const send: PageFetch = (input, init) => page.fetch(input, init)
  const api: CrunchyrollPageApi = {
    watched: request => readWatched(request, send),
    save: request => saveWatched(request, send),
  }
  return installSessionServer(arg, page, api)
}
