import type { MediaChapter } from '@banou/media-player'
import type { RemoteVideoElement } from '@fkn/lib'

import { useEffect, useMemo, useState } from 'preact/hooks'

import { fetch as relayFetch } from '../../utils/fetch'

type Fetch = (input: string) => Promise<Response>

/**
 * The file Crunchyroll's own player reads its skip buttons from, one per episode. Public: measured
 * 2026-09-26 it answers 200 with no sign-in, through FKN's relay and directly.
 */
export const skipEventsUrl = (episodeId: string) =>
  `https://static.crunchyroll.com/skip-events/production/${episodeId}.json`

/** The episode id of a watch url (`/watch/G8WUND5JX/...`, with or without a locale before it). */
export const crunchyrollEpisodeId = (url: string) => {
  try {
    return new URL(url).pathname.match(/\/watch\/([A-Z0-9]+)(?:\/|$)/)?.[1]
  } catch {
    return undefined
  }
}

// the titles are the ones @banou/media-player reads a skip offer from: Opening and Ending get the
// button, Recap and Preview are drawn and named only
const SKIP_EVENTS = [
  ['intro', 'Opening'],
  ['recap', 'Recap'],
  ['credits', 'Ending'],
  ['preview', 'Preview'],
] as const

const BETWEEN = 'Episode'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The episode's skip events as the player's chapters, ordered and non-overlapping, times clamped to
 * the episode. An event with no usable `start` and `end` (Crunchyroll writes `{}` for none) is left
 * out, and an episode with none at all has no chapters.
 *
 * The time around the events is filled with `Episode` chapters, the tail once the duration is known.
 * The player needs them: it offers no skip when themes are most of the chaptered time (its creditless
 * disc rule), so an opening handed over alone, or after a short cold open, would never get a button.
 */
export const skipEventsToChapters = (events: unknown, duration?: number): MediaChapter[] => {
  if (!isRecord(events)) return []
  const runtime = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const spans = SKIP_EVENTS
    .flatMap(([key, title]) => {
      const event = events[key]
      if (!isRecord(event)) return []
      const { start, end } = event
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return []
      const span = { start: Math.max(0, start), end: Math.min(end, runtime), title }
      return span.end > span.start ? [span] : []
    })
    .sort((a, b) => a.start - b.start)

  const chapters: MediaChapter[] = []
  let cursor = 0
  for (const span of spans) {
    // an event overlapping the one before starts where that one ends
    const start = Math.max(span.start, cursor)
    if (span.end <= start) continue
    if (start > cursor) chapters.push({ start: cursor, end: start, title: BETWEEN })
    chapters.push({ start, end: span.end, title: span.title })
    cursor = span.end
  }
  if (chapters.length && runtime !== Infinity && cursor < runtime) {
    chapters.push({ start: cursor, end: runtime, title: BETWEEN })
  }
  return chapters
}

/** The episode's skip events, as Crunchyroll wrote them. Rejects on a failed request. */
// an episode with no file answers the bucket's 403 AccessDenied (measured 2026-09-26), which is not a failure
const NO_FILE = new Set([403, 404])

export const fetchSkipEvents = async (episodeId: string, fetch: Fetch = relayFetch): Promise<unknown> => {
  const response = await fetch(skipEventsUrl(episodeId))
  if (!response.ok) {
    // an unread body keeps the relay's response marked busy until it is collected
    await response.body?.cancel().catch(() => {})
    if (NO_FILE.has(response.status)) return {}
    throw new Error(`${skipEventsUrl(episodeId)} answered ${response.status}`)
  }
  return response.json()
}

const useDuration = (remote: RemoteVideoElement | null) => {
  const [duration, setDuration] = useState<number>()
  useEffect(() => {
    setDuration(remote?.duration)
    if (!remote) return
    const read = () => setDuration(remote.duration)
    remote.addEventListener('durationchange', read)
    remote.addEventListener('loadedmetadata', read)
    return () => {
      remote.removeEventListener('durationchange', read)
      remote.removeEventListener('loadedmetadata', read)
    }
  }, [remote])
  return duration
}

// one identity for "none", since the player publishes its `chapters` prop again on every new array
const NO_CHAPTERS: MediaChapter[] = []

/**
 * The chapters of the episode at `url`, from its skip events, fetched once per episode through the
 * same relay the extractor asks Crunchyroll through (so no page code runs, and it works on every
 * backend). Always an array: the player keeps its last list when handed `undefined`, which would
 * leave the previous episode's chapters on the next. A failed fetch is no chapters and one warning.
 */
export const useCrunchyrollChapters = (url: string, remote: RemoteVideoElement | null) => {
  const episodeId = crunchyrollEpisodeId(url)
  const [loaded, setLoaded] = useState<{ episodeId: string, events: unknown }>()
  const duration = useDuration(remote)

  useEffect(() => {
    if (!episodeId) return
    let cancelled = false
    fetchSkipEvents(episodeId).then(
      events => { if (!cancelled) setLoaded({ episodeId, events }) },
      err => { if (!cancelled) console.warn('[cr] skip events unavailable:', err) },
    )
    return () => { cancelled = true }
  }, [episodeId])

  return useMemo(() => {
    if (!loaded || loaded.episodeId !== episodeId) return NO_CHAPTERS
    const chapters = skipEventsToChapters(loaded.events, duration)
    return chapters.length ? chapters : NO_CHAPTERS
  }, [loaded, episodeId, duration])
}
