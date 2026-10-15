// Crunchyroll's answers to a signed-in read of one season's watch progress. Measured through the relay:
// SIGNED_OUT (2026-10-07), and anonymously the shapes of a series' season list and of a season's
// episodes, with the empty list a season's id without its `JAJP` gets (2026-10-16, The Apothecary
// Diaries' GS00384044 against GS00384044JAJP). A signed-in session was never available here, so the token
// and the playheads are synthesized in the shapes two maintained clients read today: crunchyroll-rs
// (`src/auth/login.rs`, `src/media/anime/impl.rs` `playhead`) and Universal Trakt Scrobbler 0.9.4
// (`src/services/crunchyroll/CrunchyrollApi.ts`). Ids and values are made up.

/** What www.crunchyroll.com/auth/v1/token answered signed out, measured 2026-10-07. */
export const SIGNED_OUT = {
  code: 'auth.obtain_access_token.oauth2_error',
  context: [{ code: 'auth.obtain_access_token.missing_required_field', field: 'etp_rt' }],
  error: 'invalid_request',
}

export const ACCOUNT_ID = 'a1b2c3d4-0000-4000-8000-00000000c0de'
export const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.the-viewers-own-token.signature'

export const TOKEN_GRANTED = {
  access_token: ACCESS_TOKEN,
  refresh_token: 'the-refresh-token',
  expires_in: 300,
  token_type: 'Bearer',
  scope: 'account content mp:limited offline_access',
  country: 'US',
  account_id: ACCOUNT_ID,
  profile_id: 'f0e1d2c3-0000-4000-8000-0000000000aa',
}

export const SERIES_ID = 'GT00399001'

/** The season as stub's `cr:` ids carry it: Crunchyroll's `GS00399002JAJP` without its `JAJP`. */
export const SEASON_ID = 'GS00399002'
const API_SEASON_ID = `${SEASON_ID}JAJP`

/** `GET /content/v2/cms/series/GT00399001/seasons`: an earlier season, then this one, each with a dub. */
export const SEASONS = {
  total: 2,
  data: [
    {
      id: 'GYE5CQNJ2',
      audio_locale: 'ja-JP',
      versions: [{ guid: 'GYE5CQNJ2', audio_locale: 'ja-JP', original: true }, { guid: 'GYDUBSEASON', audio_locale: 'en-US', original: false }],
    },
    {
      id: API_SEASON_ID,
      audio_locale: 'ja-JP',
      versions: [{ guid: API_SEASON_ID, audio_locale: 'ja-JP', original: true }, { guid: `${SEASON_ID}ENUS`, audio_locale: 'en-US', original: false }],
    },
  ],
  meta: {},
}

const versions = (japanese: string, dub: string) => [
  { audio_locale: 'ja-JP', guid: japanese, original: true, season_guid: API_SEASON_ID },
  { audio_locale: 'en-US', guid: dub, original: false, season_guid: `${SEASON_ID}ENUS` },
]

/** `GET /content/v2/cms/seasons/GS00399002JAJP/episodes`: four numbered episodes and a recap with no number. */
export const SEASON_EPISODES = {
  total: 5,
  data: [
    { id: 'GJAEP0001', episode_number: 1, sequence_number: 1, season_id: API_SEASON_ID, versions: versions('GJAEP0001', 'GDUBEP001') },
    { id: 'GJAEP0002', episode_number: 2, sequence_number: 2, season_id: API_SEASON_ID, versions: versions('GJAEP0002', 'GDUBEP002') },
    { id: 'GJAEPRECAP', episode_number: null, sequence_number: 2.5, season_id: API_SEASON_ID, versions: null },
    { id: 'GJAEP0003', episode_number: 3, sequence_number: 3, season_id: API_SEASON_ID, versions: versions('GJAEP0003', 'GDUBEP003') },
    { id: 'GJAEP0004', episode_number: 4, sequence_number: 4, season_id: API_SEASON_ID, versions: versions('GJAEP0004', 'GDUBEP004') },
  ],
  meta: {},
}

/**
 * `GET /content/v2/{account}/playheads?content_ids=...`: episode 1 watched in Japanese, episode 2 in the
 * dub, episode 3 started and left.
 */
export const PLAYHEADS = {
  total: 3,
  data: [
    { playhead: 1420, content_id: 'GJAEP0001', fully_watched: true, last_modified: '2026-10-10T12:00:00Z' },
    { playhead: 1418, content_id: 'GDUBEP002', fully_watched: true, last_modified: '2026-10-11T12:00:00Z' },
    { playhead: 300, content_id: 'GJAEP0003', fully_watched: false, last_modified: '2026-10-12T12:00:00Z' },
  ],
  meta: {},
}

/** What a signed-in read of SEASON_ID through the fixtures above comes to. */
export const WATCHED = [
  { number: 1, watched: true },
  { number: 2, watched: true },
  { number: 3, watched: false },
  { number: 4, watched: false },
]

type Answer = { status: number, ok: boolean, json: () => Promise<unknown> }
const answer = (status: number, body: unknown): Answer => ({ status, ok: status >= 200 && status < 300, json: async () => body })

/**
 * crunchyroll.com as the fixtures above answer it, recording every request. `signedIn` false answers
 * the token call with the measured 400. Any other season's episodes are an empty list, as measured for
 * a season id without its `JAJP`, and a list of playheads holds only the ids asked for.
 */
export const fakeCrunchyroll = ({ signedIn = true, playheads = PLAYHEADS as unknown, episodes = SEASON_EPISODES as unknown, seasons = SEASONS as unknown } = {}) => {
  const asked: { url: string, init: RequestInit }[] = []
  const send = async (url: string, init: RequestInit): Promise<Answer> => {
    asked.push({ url, init })
    const { pathname, searchParams } = new URL(url)
    if (pathname === '/auth/v1/token') return signedIn ? answer(200, TOKEN_GRANTED) : answer(400, SIGNED_OUT)
    if (pathname === `/content/v2/cms/series/${SERIES_ID}/seasons`) return answer(200, seasons)
    if (pathname === `/content/v2/cms/seasons/${API_SEASON_ID}/episodes`) return answer(200, episodes)
    if (/^\/content\/v2\/cms\/seasons\/[^/]+\/episodes$/.test(pathname)) return answer(200, { total: 0, data: [], meta: {} })
    if (pathname === `/content/v2/${ACCOUNT_ID}/playheads`) {
      const ids = new Set(searchParams.get('content_ids')!.split(','))
      const { data } = playheads as { data?: unknown }
      return answer(200, Array.isArray(data) ? { ...playheads as object, data: data.filter(head => ids.has(head.content_id)) } : playheads)
    }
    return answer(404, { code: 'not_found' })
  }
  return { send, asked }
}
