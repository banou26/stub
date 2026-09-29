// Stub's code inside a myanimelist.net page, where the viewer's session cookie rides along with every
// request the page makes. Built into one self-contained function (scripts/page-script.ts) and installed
// with `frame.evaluate`, once per document, by the session frame (tracking/session-frames.ts). It
// imports nothing that needs the app: the shared install (tracking/page-install.ts) and ./page-text.ts.
//
// It asks the way MyAnimeList's own client does, measured in its bundles on 2026-09-29: the list page
// pages `/animelist/<user>/load.json` and stops on an empty page (all-899255d77a.js), and add, edit and
// the finish of a rewatch are `$.post` calls, the first two with a JSON string for a body, into which
// header.js's ajaxPrefilter puts the page's csrf_token.

import type { ServeArg } from '../../tracking/session-frames'

import { installSessionServer, randomNonce } from '../../tracking/page-install'
import { csrfTokenOf, isBlockPage, userNameOf, writeAccepted } from './page-text'

/** A list MyAnimeList serves: 1 watching, 2 completed, 3 on hold, 4 dropped, 6 plan to watch, 7 all. */
export type MalListStatus = 1 | 2 | 3 | 4 | 6 | 7

/** 1: by title, which pages stably. 5: by `updated_at`, newest first (measured 2026-09-30). */
export type MalListOrder = 1 | 5

export type MalListRequest = { user: string, status: MalListStatus, order: MalListOrder, offset: number }

/** An answer as the page received it. `url` is where it ended after redirects; `retryAfter` in seconds. */
export type MalPageAnswer = { kind: 'answer', status: number, url: string, text: string, retryAfter: number | null }

/**
 * Who the session is, from a fresh about.php. `page`: the answer was a full MyAnimeList page (it had
 * the USER_NAME line). `user`: null when it names nobody. `token`: whether it carried a CSRF token,
 * which never leaves the page.
 */
export type MalWhoAmI = {
  kind: 'whoami'
  status: number
  url: string
  page: boolean
  user: string | null
  token: boolean
  blocked: boolean
  retryAfter: number | null
}

/** What add.json and edit.json take, as MyAnimeList's own client sends them. */
export type MalEntryFields = {
  anime_id: number
  status: number
  score?: number
  num_watched_episodes?: number
  is_rewatching?: 1
}

export type MalWrite =
  | { kind: 'add' | 'edit', fields: MalEntryFields }
  | { kind: 'delete', animeId: number }
  | { kind: 'finish-rewatch', animeId: number }

/** Steps sent in order, only while the session is `user`'s. */
export type MalWriteRequest = { user: string, steps: MalWrite[] }

/**
 * `not-sent`: the fresh about.php named nobody, somebody else, carried no token, or was not a page of
 * MyAnimeList's, so nothing was posted. `sent`: the answer to each step posted, up to the first one
 * that was not accepted.
 */
export type MalWriteAnswer = { kind: 'not-sent', whoami: MalWhoAmI } | { kind: 'sent', answers: MalPageAnswer[] }

/** What the page serves over its port. */
export type MalPageApi = {
  whoami: (arg: Record<string, never>) => Promise<MalWhoAmI>
  list: (arg: MalListRequest) => Promise<MalPageAnswer>
  write: (arg: MalWriteRequest) => Promise<MalWriteAnswer>
  /** MyAnimeList's hover card for one anime: the page the session frame holds, for that id. */
  anime: (arg: { id: number }) => Promise<MalPageAnswer>
}

/** What `run` takes: serve the session over the port the app posts next, or answer whether anyone is signed in. */
export type MalPageArg = ServeArg | { kind: 'viewer' }

type PageFetch = (input: string, init?: RequestInit) => Promise<Response>

const retryAfterOf = (headers: Headers) => {
  const value = headers.get('retry-after')
  const seconds = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(seconds) ? seconds : null
}

const XHR = { 'x-requested-with': 'XMLHttpRequest' }
const FORM = 'application/x-www-form-urlencoded; charset=UTF-8'

/**
 * The page's side of the tracker. Every request is same-origin, carries the page's cookies, and ends in
 * `_=<nonce>`, so no cache keyed on the request answers it with an earlier one. Nothing is kept between
 * calls: each write reads about.php afresh, so it goes out only on a session that is still the one the
 * worker planned for. A write is posted once, never again; and the page never calls MyAnimeList's
 * sharing step (`SNSFunc.postListUpdates`), which is what posts to other sites.
 */
export const createMalPage = ({ fetch, nonce }: { fetch: PageFetch, nonce: () => string }): MalPageApi => {
  const answerOf = async (response: Response): Promise<MalPageAnswer> =>
    ({ kind: 'answer', status: response.status, url: response.url, text: await response.text(), retryAfter: retryAfterOf(response.headers) })

  const about = async (): Promise<{ whoami: MalWhoAmI, token: string | undefined }> => {
    const response = await fetch(`/about.php?_=${nonce()}`, { credentials: 'include', headers: { accept: 'text/html' } })
    const text = await response.text()
    const user = userNameOf(text)
    const token = csrfTokenOf(text)
    const page = user !== undefined
    return {
      token,
      whoami: {
        kind: 'whoami',
        status: response.status,
        url: response.url,
        page,
        user: user ?? null,
        token: Boolean(token),
        blocked: response.status === 429 || (!page && (response.status === 403 || isBlockPage(text))),
        retryAfter: retryAfterOf(response.headers),
      },
    }
  }

  const post = (path: string, body: string, headers: Record<string, string>) =>
    fetch(`${path}${path.includes('?') ? '&' : '?'}_=${nonce()}`, { method: 'POST', credentials: 'include', headers, body })

  const send = (step: MalWrite, token: string) => {
    switch (step.kind) {
      case 'add':
      case 'edit':
        return post(`/ownlist/anime/${step.kind}.json`, JSON.stringify({ ...step.fields, csrf_token: token }), { ...XHR, accept: '*/*', 'content-type': FORM })
      case 'delete':
        return post(`/ownlist/anime/${step.animeId}/delete`, `csrf_token=${encodeURIComponent(token)}`, { 'content-type': FORM })
      case 'finish-rewatch':
        // what the list page posts for "Yes, I am done Rewatching", beside t=18 for "Set as Completed"
        return post('/includes/ajax.inc.php?t=59', `aid=${step.animeId}&csrf_token=${encodeURIComponent(token)}`, { ...XHR, accept: '*/*', 'content-type': FORM })
    }
  }

  return {
    whoami: async () => (await about()).whoami,
    list: async ({ user, status, order, offset }) =>
      answerOf(await fetch(
        `/animelist/${encodeURIComponent(user)}/load.json?status=${status}&order=${order}&offset=${offset}&_=${nonce()}`,
        { credentials: 'include', headers: { ...XHR, accept: 'application/json, text/javascript, */*; q=0.01' } },
      )),
    write: async ({ user, steps }) => {
      const { whoami, token } = await about()
      if (!whoami.page || whoami.blocked || !whoami.user || whoami.user !== user || !token) return { kind: 'not-sent', whoami }
      const answers: MalPageAnswer[] = []
      for (const step of steps) {
        const answer = await answerOf(await send(step, token))
        answers.push(answer)
        if (!writeAccepted(answer.status, answer.url)) break
      }
      return { kind: 'sent', answers }
    },
    anime: async ({ id }) =>
      answerOf(await fetch(
        `/includes/ajax.inc.php?t=64&id=${id}&_=${nonce()}`,
        { credentials: 'include', headers: { ...XHR, accept: 'text/html, */*; q=0.01' } },
      )),
  }
}

/** Whether the page names a viewer. Reads what the page rendered, fetches nothing. */
export const hasViewer = (page: { MAL?: { USER_NAME?: unknown } }): boolean =>
  typeof page.MAL?.USER_NAME === 'string' && page.MAL.USER_NAME !== ''

/** The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg. */
export const run = (arg: MalPageArg): boolean | 'installed' | 'reinstalled' => {
  const page = globalThis as typeof globalThis & { MAL?: { USER_NAME?: unknown } } & Record<symbol, unknown>
  if (arg.kind === 'viewer') return hasViewer(page)
  return installSessionServer(arg, page, createMalPage({ fetch: (input, init) => page.fetch(input, init), nonce: randomNonce }))
}
