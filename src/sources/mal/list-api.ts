// The viewer's MyAnimeList list as the MyAnimeList tracker reads and writes it: what each answer the
// page script hands back means, how a list row maps onto stub's list entries, and which writes a save
// takes. Import free apart from types and ./page-text.ts, so every mapping is pinned under vitest.

import type { ListEntry, ListEntryInput, ListStatus, Tracker } from '../../generated/schema/types.generated'
import type { MalListStatus, MalPageAnswer, MalWhoAmI, MalWrite } from './session-page'

import { isBlockPage } from './page-text'

export const MAL_TRACKER_ID = 'mal'
export const MAL_URL = 'https://myanimelist.net'
export const MAL_ICON = 'https://cdn.myanimelist.net/images/favicon.ico'

/**
 * How many rows one load.json page held (300, measured 2026-09-29). Only a cost rule reads it: a list
 * that fits in one page is read whole rather than by its recent changes. Paging never relies on it.
 */
export const LIST_PAGE_SIZE = 300

/** Said in the editor wherever MyAnimeList is ticked. */
export const MAL_WRITE_NOTICE = 'Saving to MyAnimeList changes your list on myanimelist.net, which is public by default and shows your updates on your profile. MyAnimeList keeps scores as whole numbers from 1 to 10, and marking a rewatch Completed counts one finished rewatch.'

/**
 * One row of load.json as the tracker keeps it. `status` is MyAnimeList's own number, `rewatching` its
 * raw flag whatever the status, `score` 0 to 10 (0 is no score), `updatedAt` unix seconds.
 */
export type MalListRow = {
  animeId: number
  status: number
  rewatching: boolean
  score: number
  progress: number
  episodes: number | null
  title: string | null
  url: string
  cover: string | null
  updatedAt: number | null
}

const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value
  : typeof value === 'string' && /^\d+$/.test(value) ? Number(value)
  : undefined

/**
 * A load.json row, read tolerantly. `is_rewatching` came as 0 and as "" (measured), so only 1 or "1"
 * is a rewatch. `anime_num_episodes` 0 is a count MyAnimeList does not know yet. The start and finish
 * dates are never read: two digit years, in a format that may follow a setting of the list's owner.
 */
export const rowOf = (raw: unknown): MalListRow | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const animeId = whole(row.anime_id)
  const status = whole(row.status)
  if (!animeId || status === undefined) return undefined
  const path = typeof row.anime_url === 'string' && row.anime_url.startsWith('/') ? row.anime_url : `/anime/${animeId}`
  const title = row.anime_title
  return {
    animeId,
    status,
    rewatching: row.is_rewatching === 1 || row.is_rewatching === '1',
    score: Math.min(10, whole(row.score) ?? 0),
    progress: whole(row.num_watched_episodes) ?? 0,
    episodes: whole(row.anime_num_episodes) || null,
    title: typeof title === 'string' ? title : typeof title === 'number' ? String(title) : null,
    url: `${MAL_URL}${path}`,
    cover: typeof row.anime_image_path === 'string' && row.anime_image_path ? row.anime_image_path : null,
    updatedAt: whole(row.updated_at) || null,
  }
}

/** What one answer said, before it means anything about a media. */
export type MalRead<T> =
  | { kind: 'data', data: T }
  | { kind: 'signed-out' }
  | { kind: 'blocked', retryAfter: number | null }
  | { kind: 'error', message: string }

const NOT_JSON = Symbol('not json')

const parsed = (text: string): unknown => {
  try { return JSON.parse(text) as unknown } catch { return NOT_JSON }
}

const isOk = (status: number) => status >= 200 && status < 300

// {"errors":[{"message":"invalid request"}]}, MyAnimeList's JSON refusal (measured on a 400)
const errorMessageOf = (body: unknown) => {
  const message = (body as { errors?: { message?: unknown }[] } | null)?.errors?.[0]?.message
  return typeof message === 'string' && message ? message : undefined
}

const endedSignedOut = (url: string) => url.includes('/login.php')

/** Who a fresh about.php says the session is. */
export const readWhoAmI = (answer: MalWhoAmI): MalRead<string> =>
  answer.blocked ? { kind: 'blocked', retryAfter: answer.retryAfter }
  : !answer.page ? { kind: 'error', message: `MyAnimeList answered ${answer.status} with a page stub could not read` }
  : !answer.user ? { kind: 'signed-out' }
  : { kind: 'data', data: answer.user }

/**
 * One load.json page. JSON is read FIRST: a JSON array is the list whatever text the viewer put in it,
 * so a note saying "request blocked" is data. A body that is not JSON is never a list: a block page,
 * or an interstitial served in its place, which is read as blocked too, since pausing costs one viewer
 * a few minutes where asking again costs everyone on FKN's shared egress.
 */
export const readListPage = (answer: MalPageAnswer): MalRead<MalListRow[]> => {
  if (endedSignedOut(answer.url)) return { kind: 'signed-out' }
  if (answer.status === 429) return { kind: 'blocked', retryAfter: answer.retryAfter }
  const body = parsed(answer.text)
  if (body !== NOT_JSON) {
    if (isOk(answer.status) && Array.isArray(body)) return { kind: 'data', data: body.flatMap(raw => rowOf(raw) ?? []) }
    const said = errorMessageOf(body)
    if (answer.status >= 400 && answer.status < 500 && said) return { kind: 'error', message: `MyAnimeList answered ${answer.status}: ${said}` }
    return { kind: 'error', message: `MyAnimeList answered ${answer.status} with a list it could not read` }
  }
  if (answer.status === 403 || isOk(answer.status) || isBlockPage(answer.text)) return { kind: 'blocked', retryAfter: answer.retryAfter }
  return { kind: 'error', message: `MyAnimeList answered ${answer.status}` }
}

/**
 * One write's answer. A 2xx is accepted and its body never read: what add.json and edit.json answer
 * was not measured, and the delete follows a redirect onto an HTML page that carries the viewer's own
 * notes. The tracker reads the list back instead.
 */
export const readWriteAnswer = (answer: MalPageAnswer): MalRead<null> => {
  if (endedSignedOut(answer.url)) return { kind: 'signed-out' }
  if (answer.status === 429) return { kind: 'blocked', retryAfter: answer.retryAfter }
  const body = parsed(answer.text)
  if (answer.status === 403 && body === NOT_JSON) return { kind: 'blocked', retryAfter: answer.retryAfter }
  if (isOk(answer.status)) return { kind: 'data', data: null }
  const said = body === NOT_JSON ? undefined : errorMessageOf(body)
  if (answer.status >= 400 && answer.status < 500 && said) return { kind: 'error', message: `MyAnimeList answered ${answer.status}: ${said}` }
  return { kind: 'error', message: `MyAnimeList answered ${answer.status}` }
}

const FROM_MAL: Record<number, ListStatus> = { 1: 'WATCHING', 2: 'COMPLETED', 3: 'PAUSED', 4: 'DROPPED', 6: 'PLANNING' }

/**
 * A row's status in stub's words. The rewatch flag counts only beside status 2, as in MyAnimeList's
 * own `getIsCompleted` (`2 === status && 1 !== is_rewatching`). Null for a status stub does not know,
 * and the entry is still listed.
 */
export const statusOf = (row: Pick<MalListRow, 'status' | 'rewatching'>): ListStatus | null =>
  row.status === 2 && row.rewatching ? 'REWATCHING' : FROM_MAL[row.status] ?? null

/** MyAnimeList's status for each of stub's. A rewatch is status 2 with the flag set. */
export const TO_MAL: Record<ListStatus, Exclude<MalListStatus, 7>> = {
  WATCHING: 1,
  REWATCHING: 2,
  COMPLETED: 2,
  PAUSED: 3,
  DROPPED: 4,
  PLANNING: 6,
}

const STATUS_WORDS: Record<ListStatus, string> = {
  WATCHING: 'Watching',
  REWATCHING: 'Rewatching',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  PLANNING: 'Plan to watch',
}

/**
 * A 0 to 100 score as MyAnimeList keeps it, a whole number from 0 (no score) to 10: rounded DOWN and
 * never below 1, which is how AniList keeps a POINT_10 score (tracking slice 3, measured on
 * graphql.anilist.co), so a score moved from AniList reads the same on both. MAL-Sync rounds instead
 * (api single.ts:126-137); stub does not follow it there.
 */
export const malScore = (score?: number | null): number => score ? Math.max(1, Math.floor(score / 10)) : 0

/** One row as a stub list entry. MyAnimeList's dates and rewatch count are not read in this slice. */
export const listEntryOf = (user: string, row: MalListRow): ListEntry => ({
  _id: `${MAL_TRACKER_ID}:${user}:${row.animeId}`,
  tracker: MAL_TRACKER_ID,
  mediaUri: `${MAL_TRACKER_ID}:${row.animeId}`,
  status: statusOf(row),
  progress: row.progress,
  score: row.score ? row.score * 10 : null,
  scoreLabel: row.score ? `${row.score} / 10` : null,
  startedAt: null,
  completedAt: null,
  rewatchCount: null,
  updatedAt: row.updatedAt ? new Date(row.updatedAt * 1_000).toISOString() : null,
  url: row.url,
  title: row.title,
  cover: row.cover,
  episodeCount: row.episodes,
})

/** What the list should show once a phase of a save landed. */
export type MalExpect = { status: ListStatus, progress?: number, score?: number }

/** Steps sent together, then checked against the list before anything after them goes out. */
export type MalPhase = { steps: MalWrite[], expect: MalExpect }

export type MalPlan = { phases: MalPhase[] } | { noop: true } | { error: string }

const REWATCH_FROM_COMPLETED = 'MyAnimeList starts a rewatch on a completed entry: save it as Completed first'

const isNamed = (input: ListEntryInput, field: keyof ListEntryInput) => field in input && input[field] !== undefined

/**
 * The writes a save takes on MyAnimeList, or why it takes none.
 *
 * Only what MyAnimeList's own list page sends goes out: `anime_id` and `status` with the named fields
 * (its partial edits send the status every time), and add.json with all four keys its
 * `addAnimeEntry` sends. No MyAnimeList client sends `is_rewatching` to edit.json, so a rewatch starts
 * only on an entry already Completed, with the flag sent ALONE first: if MyAnimeList ignores it,
 * nothing on the entry changed, and the check after it says so before anything else goes out. A
 * rewatch ends only as Completed, through the list page's own "done rewatching" step, which counts one
 * finished rewatch. Dates and the rewatch count are refused, null included, so nothing is half written.
 */
export const planWrite = (animeId: number, row: MalListRow | undefined, input: ListEntryInput): MalPlan => {
  if (input.progress != null && !(Number.isInteger(input.progress) && input.progress >= 0)) return { error: 'Progress has to be a whole number of episodes' }
  if (input.score != null && !(Number.isInteger(input.score) && input.score >= 0 && input.score <= 100)) return { error: 'A score is a whole number from 0 to 100' }
  if (isNamed(input, 'startedAt') || isNamed(input, 'completedAt') || isNamed(input, 'rewatchCount')) {
    return { error: 'MyAnimeList takes status, progress and score from stub' }
  }
  const progress = isNamed(input, 'progress') ? input.progress ?? 0 : undefined
  const score = isNamed(input, 'score') ? malScore(input.score) : undefined
  // MyAnimeList's list page clamps to its count before it sends; the server takes more, so stub asks it the same
  if (progress !== undefined && row?.episodes != null && progress > row.episodes) return { error: `MyAnimeList counts ${row.episodes} episodes for this anime` }

  const fields = { ...score === undefined ? {} : { score }, ...progress === undefined ? {} : { num_watched_episodes: progress } }
  const expectOf = (status: ListStatus): MalExpect =>
    ({ status, ...progress === undefined ? {} : { progress }, ...score === undefined ? {} : { score } })

  if (!row) {
    const status = input.status
    if (!status) return { error: 'Pick a status to add it to MyAnimeList' }
    if (status === 'REWATCHING') return { error: REWATCH_FROM_COMPLETED }
    return {
      phases: [{
        steps: [{ kind: 'add', fields: { anime_id: animeId, status: TO_MAL[status], score: score ?? 0, num_watched_episodes: progress ?? 0 } }],
        expect: { status, progress: progress ?? 0, score: score ?? 0 },
      }],
    }
  }

  const current = statusOf(row)
  const wanted = input.status ?? current
  if (!wanted) return { error: 'MyAnimeList lists it under a status stub does not know: change it on myanimelist.net' }
  // MyAnimeList's own edit form hides the checkbox without clearing it, so the flag can sit under any status
  if (row.rewatching && row.status !== 2 && (wanted === 'COMPLETED' || wanted === 'REWATCHING')) {
    return { error: 'MyAnimeList keeps a rewatch flag on this entry: change it on myanimelist.net' }
  }
  if (current === 'REWATCHING' && wanted !== 'REWATCHING' && wanted !== 'COMPLETED') {
    return { error: 'MyAnimeList ends a rewatch as Completed: save it as Completed, or change it on myanimelist.net' }
  }
  if (wanted === 'REWATCHING' && current !== 'REWATCHING' && current !== 'COMPLETED') return { error: REWATCH_FROM_COMPLETED }

  const changes = (score !== undefined && score !== row.score) || (progress !== undefined && progress !== row.progress)
  if (wanted === current && !changes) return { noop: true }

  const edit = (status: number, extra: Record<string, number> = fields): MalWrite => ({ kind: 'edit', fields: { anime_id: animeId, status, ...extra } })
  if (current === 'REWATCHING' && wanted === 'COMPLETED') {
    return { phases: [{ steps: [{ kind: 'finish-rewatch', animeId }, edit(2)], expect: expectOf('COMPLETED') }] }
  }
  if (current === 'COMPLETED' && wanted === 'REWATCHING') {
    const start: MalPhase = { steps: [edit(2, { is_rewatching: 1 })], expect: { status: 'REWATCHING' } }
    return { phases: changes ? [start, { steps: [edit(2)], expect: expectOf('REWATCHING') }] : [start] }
  }
  // a rewatching entry edited as REWATCHING leaves the flag out, as the list page's own edits do
  return { phases: [{ steps: [edit(TO_MAL[wanted])], expect: expectOf(wanted) }] }
}

const sameState = (a: MalListRow, b: MalListRow) =>
  a.status === b.status && a.rewatching === b.rewatching && a.progress === b.progress && a.score === b.score

/** Whether the list shows nothing of a write yet: no entry, or the entry exactly as it was before it. */
export const showsNoChange = (after: MalListRow | undefined, before: MalListRow | undefined) =>
  !after || (before !== undefined && sameState(after, before))

/** What the list shows that a phase did not ask for, said as MyAnimeList shows it, or undefined when it matches. */
export const mismatchOf = (expect: MalExpect, after: MalListRow | undefined, before: MalListRow | undefined): string | undefined => {
  if (!after) return "MyAnimeList's list does not show this entry after the save"
  const status = statusOf(after)
  const shown: string[] = []
  if (status !== expect.status) shown.push(`it as ${status ? STATUS_WORDS[status] : 'a status stub does not know'}`)
  if (expect.progress !== undefined && after.progress !== expect.progress) shown.push(`${after.progress} episodes`)
  if (expect.score !== undefined && after.score !== expect.score) shown.push(after.score ? `a score of ${after.score} / 10` : 'no score')
  if (!shown.length) return undefined
  if (expect.status === 'REWATCHING' && before && statusOf(before) === 'COMPLETED' && status === 'COMPLETED') {
    return 'MyAnimeList kept it as Completed, so the rewatch did not start'
  }
  if (before && sameState(after, before)) return "MyAnimeList's list does not show the save yet"
  return `MyAnimeList shows ${shown.join(', ')}`
}

/** The rows the tracker holds, by anime id, and the newest `updated_at` among them. */
export type MalRows = { rows: ReadonlyMap<number, MalListRow>, watermark: number }

const newest = (rows: Iterable<MalListRow>, from = 0) => {
  let watermark = from
  for (const row of rows) watermark = Math.max(watermark, row.updatedAt ?? 0)
  return watermark
}

/** `rows` read afresh, each replacing its anime's row. */
export const upsertRows = (list: MalRows, rows: readonly MalListRow[]): MalRows => {
  const next = new Map(list.rows)
  for (const row of rows) next.set(row.animeId, row)
  return { rows: next, watermark: newest(rows, list.watermark) }
}

/**
 * The lists a row may be served in. A rewatch is status 2 with the flag, and whether MyAnimeList serves
 * it under Watching or Completed was not measured (no signed-in list), so it may be either.
 */
export const listsHolding = (row: Pick<MalListRow, 'status' | 'rewatching'>): MalListStatus[] =>
  row.status === 2 && row.rewatching ? [1, 2] : [row.status as MalListStatus]

/** The lists an entry with this status may be served in. */
export const listsFor = (status: ListStatus): MalListStatus[] => status === 'REWATCHING' ? [1, 2] : [TO_MAL[status]]

/**
 * `rows` are the whole of the lists `statuses` names, read afresh. List 7 is everything, so it replaces
 * all. Otherwise each row read replaces its own, and a row held but not read is dropped only when every
 * list that may serve it was read.
 */
export const replaceLists = (list: MalRows | undefined, statuses: readonly MalListStatus[], rows: readonly MalListRow[]): MalRows => {
  if (!list || statuses.includes(7)) return { rows: new Map(rows.map(row => [row.animeId, row])), watermark: newest(rows) }
  const read = new Set(rows.map(row => row.animeId))
  const next = new Map(list.rows)
  for (const [id, row] of list.rows) {
    if (!read.has(id) && listsHolding(row).every(status => statuses.includes(status))) next.delete(id)
  }
  for (const row of rows) next.set(row.animeId, row)
  return { rows: next, watermark: newest(next.values()) }
}

/** The tracker as its answers name it, from the viewer the last read found (none: signed out). */
export const malTracker = (user?: string): Tracker => ({
  id: MAL_TRACKER_ID,
  name: 'MyAnimeList',
  icon: MAL_ICON,
  color: null,
  signedIn: Boolean(user),
  account: user ?? null,
  canWrite: Boolean(user),
  scoreScale: 'POINT_10',
  writeNotice: MAL_WRITE_NOTICE,
})
