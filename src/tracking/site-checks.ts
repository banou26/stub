// What a tracking site's session frame answers to "is anyone signed in", read the way each tracker reads
// it. Import free apart from the trackers' own readers, so a test pins every answer.

import type { SessionResponse } from '../sources/anilist/session-page'
import type { MalWhoAmI } from '../sources/mal/session-page'
import type { SiteState } from './site-status'

import { readResponse } from '../sources/anilist/list-api'
import { readWhoAmI } from '../sources/mal/list-api'

/** The query the AniList check sends: a Viewer means signed in. */
export const ANILIST_VIEWER_QUERY = 'query { Viewer { id } }'

/** Rejects on an answer that is neither: a rate limit or an error. */
export const anilistSignInState = ({ status, body }: Pick<SessionResponse, 'status' | 'body'>): SiteState => {
  const read = readResponse<{ Viewer?: { id?: number } | null }>(status, body as never)
  if (read.kind === 'signed-out') return 'signed-out'
  if (read.kind === 'data') return read.data.Viewer?.id ? 'signed-in' : 'signed-out'
  throw new Error(read.kind === 'rate-limited' ? 'AniList asked stub to wait. Try again in a minute.' : read.message)
}

/** Rejects on an answer that is neither: a block or a page stub could not read. */
export const malSignInState = (whoami: MalWhoAmI): SiteState => {
  const read = readWhoAmI(whoami)
  if (read.kind === 'signed-out') return 'signed-out'
  if (read.kind === 'data') return 'signed-in'
  throw new Error(read.kind === 'blocked' ? 'MyAnimeList asked stub to wait. Try again later.' : read.message)
}
