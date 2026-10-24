// A scene search: which anime, which episode and which moment a picture is from, asked of trace.moe by its color code
// (./code.ts). The worker asks it (src/worker/yoga.ts), from the viewer's own browser (src/worker/direct-fetch.ts).

import type { FetchLike } from '../worker/backoff'

export const TRACE_MOE_ORIGIN = 'https://api.trace.moe'

/** Whether `code` is a color code as ./code.ts writes it: 21 bytes in unpadded url-safe base64. */
export const isSceneCode = (code: string | null | undefined): code is string => /^[\w-]{28}$/.test(code ?? '')

export const sceneSearchUrl = (code: string) => `${TRACE_MOE_ORIGIN}/search?vector=${code}`

// trace.moe's docs: "Similarity lower than 90% are most likely incorrect results."
export const MIN_SIMILARITY = 0.9

/** One moment a show matched at: its AniList episode, absent for a special or a file trace.moe could not number, and the second it starts at. */
export type SceneMoment = { episode: number | null, from: number }

/** A show the picture is from, and each episode it matched in, most similar first. */
export type SceneMatch = { anilist: number, moments: SceneMoment[] }

export type SceneAnswer = { matches: SceneMatch[] } | { error: string }

/** One result as trace.moe answers it, the fields read here only. */
export type TraceMoeResult = {
  anilist: number | { id: number }
  episode_start?: number | null
  from: number
  similarity: number
}

/**
 * The matches at 0.9 or more, one per show in the order trace.moe ranks them, each episode once.
 *
 * An episode's moment is the EARLIEST `from` among its copies: trace.moe indexes several files of one episode, and
 * the same frame sat about 10 s apart between a Blu-ray and a TV copy (measured 2026-10-24), so the earliest starts
 * playback at or before the scene in any of them. `episode_start` is the episode in AniList's order, which stub's
 * numbers follow, where `episode` is only parsed from the file name.
 */
export const scenesOf = (results: readonly TraceMoeResult[]): SceneMatch[] => {
  const shows = new Map<number, Map<number | null, number>>()
  for (const result of results) {
    if (!(result.similarity >= MIN_SIMILARITY)) continue
    const anilist = typeof result.anilist === 'number' ? result.anilist : result.anilist?.id
    if (!Number.isInteger(anilist)) continue
    const moments = shows.get(anilist) ?? new Map<number | null, number>()
    shows.set(anilist, moments)
    const episode = result.episode_start ?? null
    moments.set(episode, Math.min(moments.get(episode) ?? Infinity, Math.max(0, result.from)))
  }
  return [...shows].map(([anilist, moments]) => ({
    anilist,
    moments: [...moments].map(([episode, from]) => ({ episode, from })),
  }))
}

export const SCENE_ERRORS = {
  limit: "trace.moe's daily limit is reached. Try again tomorrow.",
  busy: 'trace.moe is busy. Try again in a moment.',
  failed: 'trace.moe could not search this picture.',
}

/**
 * What trace.moe's refusal means for the viewer. A free caller has 100 searches a day and one at a time, both
 * answered 402, and a full queue 503 (its docs, 2026-10-24).
 */
const errorFor = (status: number, message: unknown): string =>
  status === 402 && /quota/i.test(String(message)) ? SCENE_ERRORS.limit
  : status === 402 || status === 429 || status >= 500 ? SCENE_ERRORS.busy
  : SCENE_ERRORS.failed

const ask = async (code: string, fetch: FetchLike): Promise<SceneAnswer> => {
  if (!isSceneCode(code)) return { error: SCENE_ERRORS.failed }
  try {
    // a GET with no body and no content type, so the browser sends it with no preflight
    const response = await fetch(sceneSearchUrl(code), { credentials: 'omit' })
    const body = await response.json().catch(() => undefined) as { result?: TraceMoeResult[], error?: string } | undefined
    if (!response.ok) return { error: errorFor(response.status, body?.error) }
    return { matches: scenesOf(Array.isArray(body?.result) ? body.result : []) }
  } catch {
    return { error: SCENE_ERRORS.busy }
  }
}

let last: Promise<unknown> = Promise.resolve()

/**
 * Asks trace.moe about one color code, after the search before it has answered: a free caller's second search at
 * once is refused. Never rejects; a refusal is the one line `error` says.
 */
export const searchScene = (code: string, fetch: FetchLike): Promise<SceneAnswer> => {
  const answer = last.then(() => ask(code, fetch))
  last = answer
  return answer
}

/** A moment as the page says it: "Episode 1, 4:32", or "4:32" alone without an episode. */
export const momentLabel = ({ episode, from }: SceneMoment): string => {
  const seconds = Math.floor(from)
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  const clock = minutes >= 60
    ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`
  return episode == null ? clock : `Episode ${episode}, ${clock}`
}
