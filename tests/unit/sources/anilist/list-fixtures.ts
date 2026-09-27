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
  score: 8.5,
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
