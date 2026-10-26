import type { MediaChapter } from '@banou/media-player'
import type { PlaybackLink } from '../../party/bridge'

import { useEffect, useState } from 'preact/hooks'

import { fetchAniskipEnding } from '../../sources/aniskip'
import { crunchyrollLength } from '../../sources/crunchyroll/relay-check'
import { crunchyrollEpisodeId, fetchSkipEvents, skipEventsToChapters } from '../../sources/crunchyroll/skip-events'
import { fetch as relayFetch } from '../../utils/fetch'
import { hasEnding } from '../../utils/next-offer'
import { browserFetch } from '../../worker/browser-fetch'
import { withDirectFetch } from '../../worker/direct-fetch'

// Crunchyroll's rips sit -0.002 to +1.633 s from its length, Netflix's 2.000 s or more (step 5 measure, 2026-10-26)
const SAME_CUT_S = 2
// aniskip's endings kept there start at 89 to 96% of the runtime; the one refused, at 6%, was an opening
const ENDING_FROM = 0.6

/** Whether two lengths in seconds are one cut of an episode. */
export const sameCut = (a: number, b: number) => Math.abs(a - b) < SAME_CUT_S

/** Where an episode's ending can come from besides its file: its Crunchyroll watch url, and its MyAnimeList id and number. */
export type EndingSources = { crunchyroll?: string, mal?: { id: string, episode: number } }

const fromCrunchyroll = async (url: string, length: number) => {
  const theirs = await crunchyrollLength(url)
  if (theirs === undefined || !sameCut(theirs, length)) return []
  return skipEventsToChapters(await fetchSkipEvents(crunchyrollEpisodeId(url)!), length)
}

// its host is one DIRECT_FETCH_ORIGINS lists, so this asks it from the viewer's browser
const viewerFetch = withDirectFetch(relayFetch, browserFetch)

const fromAniskip = async ({ id, episode }: { id: string, episode: number }, length: number) => {
  const ending = await fetchAniskipEnding(id, episode, length, viewerFetch)
  return ending && sameCut(ending.length, length) && ending.start >= length * ENDING_FROM
    ? skipEventsToChapters({ credits: { start: ending.start, end: ending.end } }, length)
    : []
}

/**
 * The chapters a player `length` s long takes its ending from when its own mark none: Crunchyroll's skip events when
 * Crunchyroll's length of the episode, read now, is the same cut; else aniskip's ending when it was recorded on the
 * same cut and starts in the last 40%. Empty when neither gives one, a failed request giving none.
 */
export const fallbackEnding = async (length: number, { crunchyroll, mal }: EndingSources): Promise<MediaChapter[]> => {
  const theirs = crunchyroll ? await fromCrunchyroll(crunchyroll, length).catch(() => []) : []
  if (hasEnding(theirs)) return theirs
  return mal ? fromAniskip(mal, length).catch(() => []) : []
}

const NONE: MediaChapter[] = []

/**
 * `fallbackEnding` for the player of `link`, asked once, at its first report playing with a known length whose own
 * chapters mark no ending, and never otherwise. Empty until it answers, and without a link.
 */
export const useFallbackEnding = (link: PlaybackLink | undefined, { crunchyroll, mal }: EndingSources): MediaChapter[] => {
  const [chapters, setChapters] = useState(NONE)
  useEffect(() => {
    setChapters(NONE)
    if (!link || (!crunchyroll && !mal)) return
    let asked = false
    let gone = false
    const stop = link.onReport(({ paused }) => {
      const length = link.duration?.()
      const own = link.chapters?.()
      if (asked || paused || !length || (own && hasEnding(own))) return
      asked = true
      void fallbackEnding(length, { crunchyroll, mal }).then(found => { if (!gone) setChapters(found) })
    })
    return () => {
      gone = true
      stop()
    }
    // the sources by value, as the page builds them afresh on every render
  }, [link, crunchyroll, mal?.id, mal?.episode])
  return chapters
}
