// The viewer's lists: each tracker's whole list, and those lists joined into one row per work. Import free
// apart from the catalogue readers, so the join is pinned under vitest.

import type { ListEntry, ListItem, ListRow, Tracker, TrackerAnswer, TrackerList, TrackerState, ViewerLists } from '../generated/schema/types.generated'

import { aggregateTracking } from './aggregate'
import { answerId, latestCollector } from './collect'
import { entryMediaUri, identify, type CatalogLookup } from './identity'

export const VIEWER_LISTS_ID = 'viewerLists'

/** One tracker's list as its own answer to `viewerLists`: the list alone, with no rows. */
export const ownList = (tracker: Tracker, state: TrackerState, items: ListItem[] = []): { viewerLists: ViewerLists } =>
  ({ viewerLists: { _id: VIEWER_LISTS_ID, lists: [{ _id: `list:${tracker.id}`, tracker, state, items }], rows: [] } })

/** Each tracker's latest list, as `latestCollector` gathers them. */
export const listCollector = <E>(order: readonly E[], trackerOf: (entry: E) => Tracker) => {
  const empty = (entry: E, state: TrackerState) => ownList(trackerOf(entry), state).viewerLists.lists[0]!
  const { latest, ...collector } = latestCollector<E, TrackerList>(order, {
    read: (data: { viewerLists?: { lists?: TrackerList[] } | null } | null | undefined) => data?.viewerLists?.lists?.[0],
    failed: entry => empty(entry, 'ERROR'),
    loading: entry => empty(entry, 'LOADING'),
  })
  return { ...collector, lists: latest }
}

const time = (entry: ListEntry) => entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0

/**
 * The work an entry is about, by the catalogue ids the bundled table places it with, so MyAnimeList's
 * `mal:1` and AniList's `anilist:1` land on one key. An entry the table cannot place is keyed on its own
 * address. The uri is the one `entryMediaUri` shows: AniList's id, else MyAnimeList's.
 */
const workOf = (own: string, catalog?: CatalogLookup) => {
  const identity = identify(own, catalog)
  return identity.kind === 'catalogue'
    ? { key: identity.ids.join(' '), uri: entryMediaUri({ ids: identity.ids }) ?? own }
    : { key: own, uri: own }
}

type Held = { tracker: Tracker, item: ListItem }

const rowOf = (uri: string, held: Held[]): ListRow => {
  const answers: TrackerAnswer[] = held.map(({ tracker, item }) => ({
    _id: answerId(tracker.id, uri),
    tracker,
    state: 'LISTED',
    entry: item.entry,
    candidates: [],
    error: null,
    episodeCount: item.entry.episodeCount ?? null,
  }))
  const { summary, disagreements } = aggregateTracking(uri, answers)
  const first = <T>(read: (item: ListItem) => T | null | undefined) => held.map(({ item }) => read(item)).find(value => value != null) ?? null
  return {
    _id: `row:${uri}`,
    uri,
    answers,
    summary: summary!,
    disagreements,
    episodeCount: summary?.episodeCount ?? first(item => item.episodeCount),
    mediaStatus: first(item => item.mediaStatus),
    type: first(item => item.type),
    nextAiringEpisode: first(item => item.nextAiringEpisode),
  }
}

/**
 * Every listed entry of `lists`, one row per work, each summarised by the title row's own rule
 * (`aggregateTracking`). A tracker holds one entry per work, its newest should it hold two. A work's
 * facts (airing, format, schedule) are the first tracker's in `lists` that states them.
 */
export const joinLists = (lists: readonly TrackerList[], catalog?: CatalogLookup): ListRow[] => {
  const works = new Map<string, { uri: string, held: Held[] }>()
  for (const { tracker, items } of lists) {
    for (const item of items) {
      if (!item.entry.mediaUri) continue
      const { key, uri } = workOf(item.entry.mediaUri, catalog)
      const work = works.get(key) ?? { uri, held: [] }
      works.set(key, work)
      const twin = work.held.findIndex(other => other.tracker.id === tracker.id)
      if (twin === -1) work.held.push({ tracker, item })
      else if (time(item.entry) > time(work.held[twin]!.item.entry)) work.held[twin] = { tracker, item }
    }
  }
  return [...works.values()].map(({ uri, held }) => rowOf(uri, held))
}
