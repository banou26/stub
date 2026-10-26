import type { RelayChoice } from '@fkn/lib'

import { cloud, relayOf } from '@fkn/lib'

import { CRUNCHYROLL_BASE_URL } from './session'
import { crunchyrollEpisodeId } from './skip-events'

// How long the player waits for these answers before it opens its frame without them. Measured from Tokyo
// on 2026-10-13 on a fresh page: when the default relay lists the episode the answer is in after about
// 1.5 s, 0.2 s more on average than a bare first call through the broker, which the frame waits for anyway;
// the walk past a relay that does not list it took 3.0 to 3.5 s. A frame took about 8 s to show
// Crunchyroll's signed-out page through a relay (2026-09-26), so an answer up to the budget still saves time.
const CHECK_BUDGET = 5_000

// Crunchyroll lists an episode by the country of the anonymous token, which is the country of the address
// that minted it: through Prague the token says CZ and The Apothecary Diaries' GE00384327JAJP is a 200,
// through Hong Kong it says HK and the episode is a 404, and Hong Kong's token is a 404 through Prague too
// (2026-10-13). Crunchyroll keeps no device_id in the token, so a fresh one gives each check a request of
// its own, which the cache the relays share never answers with another relay's token.
const episodeThrough = async (episodeId: string, relay: RelayChoice) => {
  const minted = await cloud.fetch(`${CRUNCHYROLL_BASE_URL}/auth/v1/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa('cr_web:')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_id&device_id=${crypto.randomUUID()}`,
    relay,
  })
  const served = relayOf(minted)
  const { access_token } = await minted.json() as { access_token?: string }
  if (!served || !access_token) throw new Error(`Crunchyroll token through ${served}: ${minted.status}`)
  const episode = await cloud.fetch(`${CRUNCHYROLL_BASE_URL}/content/v2/cms/objects/${episodeId}?ratings=true&locale=en-US`, {
    headers: { authorization: `Bearer ${access_token}` },
    relay: { id: served },
  })
  if (!episode.ok && episode.status !== 404) throw new Error(`Crunchyroll episode through ${served}: ${episode.status}`)
  return { relay: served, episode }
}

const listedThrough = async (episodeId: string, relay: RelayChoice) => {
  const { relay: served, episode } = await episodeThrough(episodeId, relay)
  return { relay: served, listed: episode.ok }
}

/**
 * Crunchyroll's length of the episode at `url`, in seconds, asked as the check asks, through the default relay and
 * with a fresh token, so never answered from a cache. Undefined where that relay's country does not list the episode,
 * or its object carries no length. Rejects on a failed request.
 */
export const crunchyrollLength = async (url: string): Promise<number | undefined> => {
  const episodeId = crunchyrollEpisodeId(url)
  if (!episodeId) return undefined
  const { episode } = await episodeThrough(episodeId, {})
  if (!episode.ok) return undefined
  const { data } = await episode.json() as { data?: { episode_metadata?: { duration_ms?: unknown } }[] }
  const ms = data?.[0]?.episode_metadata?.duration_ms
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms / 1000 : undefined
}

/**
 * The relays to open the player of `url` past. Each relay is asked in the viewer's order, the default
 * first, whether Crunchyroll lists the episode there, and the ones asked before the first that does are
 * returned. Empty when none lists it, a check fails or 5 s pass, so the player opens as it would without
 * them and its own read of Crunchyroll's page decides. `exclude` are never asked.
 */
export const unlistedRelays = async (url: string, exclude: readonly string[]): Promise<string[]> => {
  const episodeId = crunchyrollEpisodeId(url)
  if (!episodeId) return []
  const walk = async () => {
    const unlisted: string[] = []
    for (;;) {
      const { relay, listed } = await listedThrough(episodeId, { exclude: [...exclude, ...unlisted] })
      if (listed) return unlisted
      // a relay answering again would walk forever
      if (exclude.includes(relay) || unlisted.includes(relay)) return []
      unlisted.push(relay)
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<string[]>(resolve => { timer = setTimeout(resolve, CHECK_BUDGET, []) })
  return Promise.race([walk().catch(() => []), late]).finally(() => clearTimeout(timer))
}
