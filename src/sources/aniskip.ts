import type { FetchLike } from '../worker/backoff'

/**
 * Where aniskip answers the crowd sourced ending of an episode, by its MyAnimeList id and number, for a player
 * `length` s long. Only `ed`: its `mixed-ed` is the song over the story, which is no ending. It answers its most voted
 * entry recorded within 20 s of the length, and 404 when it has none (aniskip-api 02bdc46,
 * src/repositories/skip-times.repository.ts).
 */
export const aniskipUrl = (malId: string, episode: number, length: number) =>
  `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${episode}?types=ed&episodeLength=${length}`

/** An ending aniskip has, in seconds, with the length of the episode it was recorded on. */
export type AniskipEnding = { start: number, end: number, length: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The ending in an answer of `aniskipUrl`, or nothing for an answer without one of the right shape. */
export const aniskipEndingOf = (answer: unknown): AniskipEnding | undefined => {
  const results = (answer as { results?: unknown } | null | undefined)?.results
  const ending = Array.isArray(results)
    ? results.find(result => (result as { skipType?: unknown } | null)?.skipType === 'ed') as { interval?: { startTime?: unknown, endTime?: unknown }, episodeLength?: unknown }
    : undefined
  const { startTime: start, endTime: end } = ending?.interval ?? {}
  const length = ending?.episodeLength
  return finite(start) && finite(end) && finite(length) && end > start ? { start, end, length } : undefined
}

/** The ending aniskip has for the episode, asked as `aniskipUrl` says. Rejects on a failed request. */
export const fetchAniskipEnding = async (malId: string, episode: number, length: number, fetch: FetchLike): Promise<AniskipEnding | undefined> => {
  const response = await fetch(aniskipUrl(malId, episode, length), { credentials: 'omit' })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`aniskip answered ${response.status}`)
  return aniskipEndingOf(await response.json())
}
