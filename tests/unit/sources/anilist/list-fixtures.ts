// AniList answers for the tracker's tests.
//
// RECORDED from anilist.co/graphql on 2026-09-27, signed out, with the CSRF pair stub's metadata code
// uses: `SIGNED_OUT_BODY` (HTTP 401, the whole query refused, `Media` null beside `Viewer`), and the
// media half of `FRIEREN`, which any caller may read.
//
// SHAPED from the schema (introspected 2026-09-26, scratchpad research/intro.out): the viewer and the
// list entry. Those need a signed-in session, which no test here can hold; the main session checks them
// live with the owner signed in.

import type { AnilistEntry, AnilistMedia, AnilistViewer } from '../../../../src/sources/anilist/list-api'

export const SIGNED_OUT_BODY = {
  errors: [{ message: 'Unauthorized.', status: 401, locations: [{ line: 2, column: 25 }] }],
  data: { Viewer: null, Media: null },
}

export const FRIEREN_PUBLIC = {
  data: {
    Media: {
      id: 154587,
      episodes: 28,
      siteUrl: 'https://anilist.co/anime/154587',
      title: { userPreferred: 'Sousou no Frieren' },
      coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg' },
      mediaListEntry: null,
    },
  },
}

export const FRIEREN: AnilistMedia = FRIEREN_PUBLIC.data.Media

export const VIEWER: AnilistViewer = { id: 5_551_234, name: 'viewer', mediaListOptions: { scoreFormat: 'POINT_10_DECIMAL' } }

export const FRIEREN_ENTRY: AnilistEntry = {
  id: 398_761_234,
  status: 'CURRENT',
  progress: 12,
  scoreRaw: 85,
  repeat: 0,
  private: false,
  startedAt: { year: 2026, month: 1, day: 10 },
  completedAt: { year: null, month: null, day: null },
  updatedAt: 1_789_905_600,
}

/** The tracking query's answer with the entry present. */
export const LISTED_BODY = { data: { Viewer: VIEWER, Media: { ...FRIEREN, mediaListEntry: FRIEREN_ENTRY } } }

/** The tracking query's answer signed in, with nothing listed. */
export const NOT_LISTED_BODY = { data: { Viewer: VIEWER, Media: { ...FRIEREN, mediaListEntry: null } } }

/**
 * Two entries of the whole list as `MediaListCollection(userName, type: ANIME, status_in: [CURRENT, REPEATING])`
 * answered for a public list, signed out, 2026-10-29: the entry's progress and updatedAt and the media's id,
 * status, episodes, format and nextAiringEpisode RECORDED; that read asked for nothing else, so the entry's other
 * fields and the media's titles, cover and page are SHAPED from the schema.
 */
const SHAPED_ENTRY = { status: 'CURRENT', scoreRaw: 0, repeat: 0, private: false, startedAt: { year: null, month: null, day: null }, completedAt: { year: null, month: null, day: null } }
const shapedMedia = (id: number) => ({ siteUrl: `https://anilist.co/anime/${id}`, title: { userPreferred: `Anime ${id}` }, coverImage: { large: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${id}.jpg` } })

export const AIRING_LIST_ENTRY = {
  ...SHAPED_ENTRY,
  id: 501_212_888,
  progress: 5,
  updatedAt: 1793039474,
  media: { ...shapedMedia(212888), id: 212888, status: 'RELEASING', episodes: 12, format: 'ONA', nextAiringEpisode: { episode: 6, airingAt: 1793543400 } },
}

export const FINISHED_LIST_ENTRY = {
  ...SHAPED_ENTRY,
  id: 501_159_559,
  progress: 0,
  updatedAt: 0,
  media: { ...shapedMedia(159559), id: 159559, status: 'FINISHED', episodes: 13, format: 'TV', nextAiringEpisode: null },
}

export const listBody = (entries: unknown[], hasNextChunk = false) =>
  ({ data: { MediaListCollection: { hasNextChunk, lists: [{ entries }] } } })
