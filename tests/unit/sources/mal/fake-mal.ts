// A HAND-MADE MyAnimeList behind a fake session, for the tracker tests. Its list rows are the recorded
// ones (./list-fixtures.ts); how it takes a write is not measured, since no account was used: it
// applies what it is sent and stamps the entry's updated_at, and each of the ways it can refuse or
// ignore a write is a switch a test turns on.

import { vi } from 'vitest'

import type { MalListRequest, MalPageAnswer, MalWhoAmI, MalWrite, MalWriteAnswer, MalWriteRequest } from '../../../../src/sources/mal/session-page'
import type { SiteSessionResult } from '../../../../src/tracking/site-session'

import { ROWS, cardOf } from './list-fixtures'

export type RawRow = Record<string, unknown> & { anime_id: number, status: number }

type Handlers = {
  whoami: () => MalWhoAmI
  list: (arg: MalListRequest) => MalPageAnswer
  write: (arg: MalWriteRequest) => MalWriteAnswer
  anime: (arg: { id: number }) => MalPageAnswer
}

export type FakeMalOptions = {
  user?: string | null
  rows?: RawRow[]
  pageSize?: number
  /** A MyAnimeList that ignores `offset` and serves its first page every time. */
  ignoresOffset?: boolean
  /** A MyAnimeList that ignores `is_rewatching` on edit.json, which no client of its own sends. */
  ignoresRewatchFlag?: boolean
  /** A MyAnimeList that answers the delete and deletes nothing. */
  ignoresDelete?: boolean
  /** A MyAnimeList that keeps every field of an edit but the score. */
  ignoresScore?: boolean
  /** A MyAnimeList that writes without moving the entry's updated_at, so the recent page does not lead with it. */
  keepsUpdatedAt?: boolean
  /** The count each anime's hover card shows; else a listed row's, else `Unknown`. */
  episodes?: Record<number, number | string>
}

export const answerOf = (text: string, { status = 200, url = 'https://myanimelist.net/', retryAfter = null }: Partial<MalPageAnswer> = {}): MalPageAnswer =>
  ({ kind: 'answer', status, url, text, retryAfter })

const added = (id: number, episodes: number): RawRow => ({
  anime_id: id,
  status: 6,
  score: 0,
  is_rewatching: 0,
  num_watched_episodes: 0,
  anime_title: `Anime ${id}`,
  anime_num_episodes: episodes,
  anime_url: `/anime/${id}/Anime_${id}`,
  anime_image_path: `https://cdn.myanimelist.net/images/anime/${id}.jpg`,
  updated_at: 0,
})

export const fakeMal = ({ user = 'viewer', rows = ROWS, pageSize = 300, episodes = {}, ...behaves }: FakeMalOptions = {}) => {
  const state = {
    user,
    connected: true,
    rows: new Map<number, RawRow>(rows.map(row => [row.anime_id, { ...row }])),
    /** unix seconds, past every recorded row */
    clock: 1_790_000_000,
    finishedRewatches: 0,
  }
  const log: string[] = []
  const listeners = new Set<() => void>()
  const held: { method: string, release: Promise<void> }[] = []
  /** A test's own answer for a method, used while it returns something. */
  const script: { [M in keyof Handlers]?: (arg: Parameters<Handlers[M]>[0]) => ReturnType<Handlers[M]> | undefined } = {}
  /** Throws, after applying the write or before it, as a page that went away mid call. */
  let interrupt: 'after' | 'before' | undefined

  const stamp = (row: RawRow) => { if (!behaves.keepsUpdatedAt) row.updated_at = ++state.clock }

  const apply = (step: MalWrite) => {
    if (step.kind === 'delete') {
      if (!behaves.ignoresDelete) state.rows.delete(step.animeId)
      return
    }
    if (step.kind === 'finish-rewatch') {
      const row = state.rows.get(step.animeId)
      if (row) {
        row.is_rewatching = 0
        row.status = 2
        state.finishedRewatches++
        stamp(row)
      }
      return
    }
    const { anime_id: id, is_rewatching, score, ...fields } = step.fields
    // an added row counts what the anime's card shows
    const row = step.kind === 'add' ? added(id, Number(episodes[id]) || 12) : state.rows.get(id)
    if (!row) return
    Object.assign(row, fields)
    if (score !== undefined && !behaves.ignoresScore) row.score = score
    if (is_rewatching !== undefined && !behaves.ignoresRewatchFlag) row.is_rewatching = is_rewatching
    state.rows.set(id, row)
    stamp(row)
  }

  const handlers: Handlers = {
    whoami: () => ({ kind: 'whoami', status: 200, url: 'https://myanimelist.net/about.php', page: true, user: state.user, token: true, blocked: false, retryAfter: null }),
    list: ({ user: owner, status, order, offset }) => {
      const served = [...state.rows.values()]
        .filter(row => status === 7 || row.status === status)
        .sort((a, b) => order === 5
          ? Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0)
          : String(a.anime_title).localeCompare(String(b.anime_title)))
      const start = behaves.ignoresOffset ? 0 : offset
      return answerOf(JSON.stringify(served.slice(start, start + pageSize)), { url: `https://myanimelist.net/animelist/${owner}/load.json` })
    },
    write: ({ user: planned, steps }) => {
      const whoami = handlers.whoami()
      if (whoami.user !== planned) return { kind: 'not-sent', whoami }
      if (interrupt === 'before') throw new Error('https://myanimelist.net changed while stub\'s call was running, so whether it arrived is not known')
      for (const step of steps) apply(step)
      if (interrupt === 'after') throw new Error('https://myanimelist.net changed while stub\'s call was running, so whether it arrived is not known')
      return { kind: 'sent', answers: steps.map(() => answerOf('{}')) }
    },
    anime: ({ id }) => answerOf(cardOf(episodes[id] ?? (Number(state.rows.get(id)?.anime_num_episodes) || 'Unknown')), { url: `https://myanimelist.net/includes/ajax.inc.php?t=64&id=${id}` }),
  }

  const describe = (method: string, arg: unknown) => {
    if (method === 'list') {
      const { status, order, offset } = arg as MalListRequest
      return `list ${status}/${order}@${offset}`
    }
    if (method === 'write') return `write ${(arg as MalWriteRequest).steps.map(step => step.kind).join('+')}`
    if (method === 'anime') return `anime ${(arg as { id: number }).id}`
    return method
  }

  let calls = 0
  const call = vi.fn(async (method: string, arg: unknown, _options?: unknown): Promise<SiteSessionResult<unknown>> => {
    // a tracker that pages forever fails the test here rather than hanging it
    if (++calls > 200) throw new Error('the fake MyAnimeList was asked more than 200 times')
    log.push(describe(method, arg))
    if (!state.connected) return { kind: 'not-connected' }
    const own = (script as Record<string, ((arg: unknown) => unknown) | undefined>)[method]?.(arg)
    const response = own ?? (handlers as Record<string, (arg: unknown) => unknown>)[method]!(arg)
    const hold = held.findIndex(entry => entry.method === method)
    if (hold !== -1) await held.splice(hold, 1)[0]!.release
    return { kind: 'response', response }
  })

  return {
    state,
    script,
    log,
    call,
    session: { call, onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    /** The session changed under the tracker: a sign in. */
    changed: () => { for (const listener of [...listeners]) listener() },
    /** The next call of `method` answers only once `release` is called, with what MyAnimeList held when it was asked. */
    holdNext: (method: string) => {
      let release!: () => void
      held.push({ method, release: new Promise<void>(resolve => { release = resolve }) })
      return () => release()
    },
    interrupt: (when: 'after' | 'before' | undefined) => { interrupt = when },
    row: (id: number) => state.rows.get(id),
    writes: () => call.mock.calls.filter(([method]) => method === 'write').map(([, arg, options]) => ({ ...(arg as MalWriteRequest), options })),
  }
}
