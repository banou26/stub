import type { MediaChapter } from '@banou/media-player'
import type { PlaybackState } from '../party/protocol'

import { classifyChapters } from '@banou/media-player/chapters'

// What follows an ending, in aniskip's marks of 52 episodes (a middle one and the last one of 26 shows,
// 2026-10-26): 0 to 6 s (nothing, an end card), 10 to 18 s (mostly a preview), 26 to 91 s (a scene),
// then 179 and 211 s (story, an ending played mid-episode). Both bounds below sit in those gaps.

/** media-player's skip offer lead: an offer is on screen a second before its part starts. */
const LEAD_S = 1
/** How long media-player keeps a skip offer on screen. */
const OFFER_MS = 6_000
/** A jump back by more than this opens media-player's skip offer again. */
const SEEK_BACK_S = 1
/** Less than this after an ending is nothing to wait for. */
const NOTHING_S = 10
/** More than this after an ending is the episode going on, so that ending is not its end. */
const STORY_S = 120

// the title skip-events.ts gives Crunchyroll's preview
const isPreview = (chapter: MediaChapter) => chapter.title === 'Preview'

const known = (duration: number | undefined): duration is number =>
  duration !== undefined && Number.isFinite(duration) && duration > 0

/**
 * The last ending, as the player's own Skip Ending reads one (Crunchyroll's credits, a file's ED or Credits, never
 * a mixed ending, the song over the story), and how long what follows it runs.
 */
const lastEnding = (chapters: MediaChapter[], duration: number) => {
  const ending = chapters[classifyChapters(chapters).lastIndexOf('ending')]
  // a preview is something after the ending, so it counts here
  return ending && { ending, after: duration - ending.end }
}

/** Whether `chapters` mark an ending, as the player's own Skip Ending reads one. */
export const hasEnding = (chapters: MediaChapter[]) => classifyChapters(chapters).includes('ending')

/**
 * When to offer the next episode, in seconds into the one playing, from its chapters: a second before
 * its last ending when less than 10 s follows it, a second before what follows when that runs 10 s to
 * 2 min (a preview, a scene), and as if there were no ending when more follows. With no ending, a
 * second before a preview that closes the episode. Undefined otherwise, and for an unknown duration,
 * which leaves the offer at the end.
 */
export const nextOfferAt = (chapters: MediaChapter[], duration: number | undefined): number | undefined => {
  if (!known(duration)) return undefined
  const last = lastEnding(chapters, duration)
  if (last && last.after < NOTHING_S) return last.ending.start - LEAD_S
  if (last && last.after <= STORY_S) return last.ending.end - LEAD_S
  const preview = chapters.findLast(chapter => isPreview(chapter) && duration - chapter.end < NOTHING_S)
  return preview && preview.start - LEAD_S
}

/**
 * `chapters` as stub hands them to its own player: without the last ending when nothing follows it,
 * where Next takes Skip Ending's corner and Skip Ending has nothing left to skip to but the end.
 */
export const chaptersBesideNext = (chapters: MediaChapter[], duration: number | undefined): MediaChapter[] => {
  const last = known(duration) ? lastEnding(chapters, duration) : undefined
  return last && last.after < NOTHING_S ? chapters.filter(chapter => chapter !== last.ending) : chapters
}

/**
 * media-player's skip offer as a page can follow it from outside the player's document: `hear` takes each report, with
 * the chapters the player offers on, and `onChange` says whether an offer is up. As in its SkipChapter, an offer opens
 * a second before a chapter worth skipping or where a seek lands in one, opens again on a jump back, and closes after
 * 6 s or as the chapter ends, whichever comes first. Reports come seconds apart, so what falls between two is timed
 * from the last, until `stop`.
 */
export const followSkipOffer = (onChange: (up: boolean) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let offer: { end: number, at: number } | undefined
  let last = 0
  const stop = () => clearTimeout(timer)
  // `timed` is a moment timed on from the last report: it opens an offer as playing on would, but only a report closes
  // one or says where the player is, since the player may have stalled short of that moment
  const check = (chapters: MediaChapter[], { paused, time, rate, at }: PlaybackState, timed: boolean) => {
    stop()
    const kinds = classifyChapters(chapters)
    const skippable = chapters.filter((_, index) => kinds[index])
    const part = skippable.find(({ start, end }) => start - LEAD_S <= time && time < end)
    if (part ? part.end !== offer?.end || !timed && time < last - SEEK_BACK_S : !timed) offer = part && { end: part.end, at }
    if (!timed) last = time
    const playing = !paused && rate > 0
    const left = part && offer ? Math.min(offer.at + OFFER_MS - at, playing ? (part.end - time) / rate * 1000 : Infinity) : 0
    onChange(left > 0)
    const ahead = playing ? skippable.find(({ start }) => start - LEAD_S > time) : undefined
    const wait = left > 0 ? left : ahead && (ahead.start - LEAD_S - time) / rate * 1000
    if (wait === undefined) return
    // whole milliseconds, so a step always lands past the line it waits for
    const step = Math.ceil(wait)
    timer = setTimeout(() => check(chapters, { paused, rate, time: playing ? time + step / 1000 * rate : time, at: at + step }, true), step)
  }
  return { hear: (chapters: MediaChapter[], state: PlaybackState) => check(chapters, state, false), stop }
}
