// The home page's new episodes as data: how many episodes of a work on the viewer's lists are out, and which
// works the row shows. No component imports, for the reason ./movie.ts gives.

import { firstUnreleased, releasedAtOf, unreleasedEpisodes } from './episodes'

/** One work on the viewer's lists, as the row reads it off `viewerLists`. */
export type ListedWork = {
  uri: string
  episodeCount?: number | null
  mediaStatus?: string | null
  nextAiringEpisode?: { episodeNumber: number, airingAt: string } | null
  summary: { status?: string | null, progress?: number | null, episodeCount?: number | null, updatedAt?: string | null }
}

/** One work as stub's merged data holds it: what the title page dims its unreleased episodes by. */
export type StoredWork = Parameters<typeof unreleasedEpisodes>[0] & { episodeCount?: number | null }

/** How many episodes are out, and when the newest of them came out, when that is known. */
export type Released = { count: number, at?: string }

/** A list entry changed this recently is in the row whether its show still airs or not. */
export const RECENT_MS = 30 * 86_400_000
export const MOST = 20

const WATCHING = new Set(['WATCHING', 'REWATCHING'])
const ENDED = new Set(['FINISHED', 'CANCELLED'])

const isWatching = (work: ListedWork) => WATCHING.has(work.summary.status ?? '')
const isRecent = (work: ListedWork, now: Date) => now.getTime() - Date.parse(work.summary.updatedAt ?? '') < RECENT_MS
const airs = (work: ListedWork) => work.mediaStatus === 'RELEASING' || Boolean(work.nextAiringEpisode)

/**
 * What the trackers alone say is out: every episode of a show that ended, by the tracker's own count, and every
 * episode before the one AniList's schedule names next. Undefined when only stub's merged data can tell.
 */
export const releasedByTrackers = (work: ListedWork, now: Date): Released | undefined => {
  const next = work.nextAiringEpisode
  if (next) {
    const passed = Date.parse(next.airingAt) <= now.getTime()
    return { count: firstUnreleased({ nextAiringEpisode: next, episodes: [] }, now)! - 1, ...passed ? { at: next.airingAt } : {} }
  }
  if (work.mediaStatus === 'NOT_YET_RELEASED') return { count: 0 }
  return ENDED.has(work.mediaStatus ?? '') && work.episodeCount != null ? { count: work.episodeCount } : undefined
}

/**
 * The works whose episodes out stub's merged data is asked for: Watching, with nothing out by the trackers' word,
 * and airing by it or changed in the last RECENT_MS, the only ones the row could hold.
 */
export const askedOfStore = <W extends ListedWork>(works: readonly W[], now: Date): W[] =>
  works.filter(work => isWatching(work) && !releasedByTrackers(work, now) && (airs(work) || isRecent(work, now)))

/**
 * What stub's merged data says is out of a work, by the rule the title page dims unreleased episodes with, save that
 * an episode no source dates counts only when the show ended or an episode ahead is known: that rule lets it through,
 * which counted would be every episode listed.
 */
export const releasedInStore = (media: StoredWork, now: Date): Released | undefined => {
  const unreleased = unreleasedEpisodes(media, now)
  const undatedOut = ENDED.has(media.status ?? '') || firstUnreleased({
    status: media.status,
    nextAiringEpisode: media.nextAiringEpisode,
    episodes: media.episodes.map(episode => ({ episodeNumber: episode.episodeNumber, releaseDate: releasedAtOf(episode) })),
  }, now) !== undefined
  const newest = media.episodes
    .filter((episode, index) => !unreleased[index] && episode.episodeNumber != null && (undatedOut || releasedAtOf(episode)))
    .reduce<typeof media.episodes[number] | undefined>((best, episode) => !best || episode.episodeNumber! > best.episodeNumber! ? episode : best, undefined)
  if (newest) {
    const at = releasedAtOf(newest)
    return { count: newest.episodeNumber!, ...at ? { at } : {} }
  }
  const first = firstUnreleased({ status: media.status, nextAiringEpisode: media.nextAiringEpisode, episodes: [] }, now)
  if (first !== undefined) return { count: first - 1 }
  return ENDED.has(media.status ?? '') && media.episodeCount != null ? { count: media.episodeCount } : undefined
}

/**
 * What is out of a work: the trackers' word, else stub's merged data. Not the merged data's when a tracker counts
 * the work in other episodes than it does (a split season), where the same number names another episode.
 */
export const releasedOf = (work: ListedWork, media: StoredWork | undefined, now: Date): Released | undefined => {
  const known = releasedByTrackers(work, now)
  if (known || !media) return known
  const own = work.summary.episodeCount
  return own != null && media.episodeCount != null && own !== media.episodeCount ? undefined : releasedInStore(media, now)
}

/**
 * The row: Watching and Rewatching works with more episodes out than watched, that still air or changed in the
 * last RECENT_MS, the newest first (by the newest episode out when known, else the entry's last change), at most
 * MOST. `next` is the episode to watch, `count` how many are out past the watched ones.
 */
export const newEpisodes = <W extends ListedWork>(works: readonly W[], released: (work: W) => Released | undefined, now: Date) =>
  works
    .flatMap(work => {
      const out = isWatching(work) && (airs(work) || isRecent(work, now)) ? released(work) : undefined
      const progress = work.summary.progress ?? 0
      if (!out || out.count <= progress) return []
      return [{ work, next: progress + 1, count: out.count - progress, at: Date.parse(out.at ?? work.summary.updatedAt ?? '') || 0 }]
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, MOST)
