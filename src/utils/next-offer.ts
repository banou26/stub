import type { MediaChapter } from '@banou/media-player'

// What follows an ending, in aniskip's marks of 52 episodes (a middle one and the last one of 26 shows,
// 2026-10-26): 0 to 6 s (nothing, an end card), 10 to 18 s (mostly a preview), 26 to 91 s (a scene),
// then 179 and 211 s (story, an ending played mid-episode). Both bounds below sit in those gaps.

/** media-player's skip offer lead: an offer is on screen a second before its part starts. */
const LEAD_S = 1
/** Less than this after an ending is nothing to wait for. */
const NOTHING_S = 10
/** More than this after an ending is the episode going on, so that ending is not its end. */
const STORY_S = 120

// the titles skip-events.ts gives Crunchyroll's credits and preview. A file's own chapters will need
// media-player's classifier, not exported yet, which leaves a mixed ending (the song over the story) out too.
const isEnding = (chapter: MediaChapter) => chapter.title === 'Ending'
const isPreview = (chapter: MediaChapter) => chapter.title === 'Preview'

const known = (duration: number | undefined): duration is number =>
  duration !== undefined && Number.isFinite(duration) && duration > 0

/** The last ending, and how long what follows it runs. */
const lastEnding = (chapters: MediaChapter[], duration: number) => {
  const ending = chapters.findLast(isEnding)
  // owner question 3, answered (a): a preview is something after the ending, so it counts here
  return ending && { ending, after: duration - ending.end }
}

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
