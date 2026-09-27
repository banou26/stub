// The viewer's AniList list as the AniList tracker reads and writes it: the documents it sends through
// the viewer's own anilist.co session and how their answers map onto stub's list entries. Import free
// apart from types, so every mapping is pinned under vitest.

import type { FuzzyDate, FuzzyDateInput, ListEntry, ListEntryInput, ListStatus, Tracker } from '../../generated/schema/types.generated'
import type { AnilistBody } from './frontend'
import type { SessionRequest } from './session-page'

export const ANILIST_TRACKER_ID = 'anilist'
export const ANILIST_ICON = 'https://anilist.co/img/icons/favicon-32x32.png'

/** Said in the editor wherever AniList is ticked. */
export const ANILIST_WRITE_NOTICE = 'Saving to AniList can post list activity that your followers see, as saving on anilist.co does.'

type AnilistDate = { year: number | null, month: number | null, day: number | null } | null

export type AnilistEntry = {
  id: number
  status: string | null
  progress: number | null
  /** 0 to 100, whatever the viewer's format. 0 is AniList's "no score". */
  scoreRaw: number | null
  /** In the viewer's own format. */
  score: number | null
  repeat: number | null
  private: boolean | null
  startedAt: AnilistDate
  completedAt: AnilistDate
  /** Unix seconds. */
  updatedAt: number | null
}

export type AnilistMedia = {
  id: number
  episodes: number | null
  siteUrl: string | null
  title: { userPreferred: string | null } | null
  coverImage: { large: string | null } | null
}

export type AnilistViewer = { id: number, name: string, mediaListOptions: { scoreFormat: string | null } | null }

const ENTRY_FIELDS = `
  id
  status
  progress
  scoreRaw: score(format: POINT_100)
  score
  repeat
  private
  startedAt { year month day }
  completedAt { year month day }
  updatedAt
`

const MEDIA_FIELDS = `
  id
  episodes
  siteUrl
  title { userPreferred }
  coverImage { large }
`

/**
 * The viewer and their entry for one anime, in one request. Signed out, AniList answers the whole of
 * it 401 with `Media` null too (measured on anilist.co/graphql, 2026-09-27), so the Viewer cannot be
 * asked beside a read that has to survive without it.
 */
export const TRACKING_QUERY = `
  query StubTracking($mediaId: Int) {
    Viewer { id name mediaListOptions { scoreFormat } }
    Media(id: $mediaId, type: ANIME) {
      ${MEDIA_FIELDS}
      mediaListEntry { ${ENTRY_FIELDS} }
    }
  }
`

export type TrackingData = { Viewer: AnilistViewer | null, Media: (AnilistMedia & { mediaListEntry: AnilistEntry | null }) | null }

/** DeleteMediaListEntry takes the entry's own id, not the anime's, so a delete looks it up first. */
export const ENTRY_ID_QUERY = `
  query StubListEntryId($mediaId: Int) {
    Media(id: $mediaId, type: ANIME) { id mediaListEntry { id } }
  }
`

export type EntryIdData = { Media: { id: number, mediaListEntry: { id: number } | null } | null }

export const DELETE_MUTATION = `
  mutation StubDeleteListEntry($id: Int) {
    DeleteMediaListEntry(id: $id) { deleted }
  }
`

export type DeleteData = { DeleteMediaListEntry: { deleted: boolean | null } | null }

export type SaveData = { SaveMediaListEntry: (AnilistEntry & { media: AnilistMedia | null }) | null }

const FROM_ANILIST: Record<string, ListStatus> = {
  CURRENT: 'WATCHING',
  REPEATING: 'REWATCHING',
  PLANNING: 'PLANNING',
  COMPLETED: 'COMPLETED',
  PAUSED: 'PAUSED',
  DROPPED: 'DROPPED',
}

const TO_ANILIST: Record<ListStatus, string> = {
  WATCHING: 'CURRENT',
  REWATCHING: 'REPEATING',
  PLANNING: 'PLANNING',
  COMPLETED: 'COMPLETED',
  PAUSED: 'PAUSED',
  DROPPED: 'DROPPED',
}

const isCount = (value: unknown) => value == null || (Number.isInteger(value) && (value as number) >= 0)

const dateInput = (date: FuzzyDateInput | null | undefined): FuzzyDateInput =>
  ({ year: date?.year ?? null, month: date?.month ?? null, day: date?.day ?? null })

/**
 * SaveMediaListEntry carrying the fields `entry` names and no other, so everything else on the entry is
 * left as it is. A write is an absolute set, never an increment.
 *
 * - `score` (0 to 100) goes as `scoreRaw`, which AniList stores in the viewer's own format.
 * - An explicit null clears: a score or a count to 0, a date to no date. A status has no clearing on
 *   AniList, so a null one is left as it is.
 * - `private` is never sent, so an entry the viewer keeps private stays private.
 */
export const saveRequest = (mediaId: number, entry: ListEntryInput): { request: SessionRequest } | { error: string } => {
  if (!isCount(entry.progress)) return { error: 'Progress has to be a whole number of episodes' }
  if (!isCount(entry.rewatchCount)) return { error: 'The rewatch count has to be a whole number' }
  if (entry.score != null && !(Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 100)) {
    return { error: 'A score is a whole number from 0 to 100' }
  }
  const named = (field: keyof ListEntryInput) => field in entry && entry[field] !== undefined
  const args: [name: string, type: string, value: unknown][] = [['mediaId', 'Int', mediaId]]
  if (entry.status != null) args.push(['status', 'MediaListStatus', TO_ANILIST[entry.status]])
  if (named('progress')) args.push(['progress', 'Int', entry.progress ?? 0])
  if (named('score')) args.push(['scoreRaw', 'Int', entry.score ?? 0])
  if (named('rewatchCount')) args.push(['repeat', 'Int', entry.rewatchCount ?? 0])
  if (named('startedAt')) args.push(['startedAt', 'FuzzyDateInput', dateInput(entry.startedAt)])
  if (named('completedAt')) args.push(['completedAt', 'FuzzyDateInput', dateInput(entry.completedAt)])
  const query = `
  mutation StubSaveListEntry(${args.map(([name, type]) => `$${name}: ${type}`).join(', ')}) {
    SaveMediaListEntry(${args.map(([name]) => `${name}: $${name}`).join(', ')}) {
      ${ENTRY_FIELDS}
      media { ${MEDIA_FIELDS} }
    }
  }
`
  return { request: { query, variables: Object.fromEntries(args.map(([name, , value]) => [name, value])) } }
}

type AnilistError = NonNullable<AnilistBody['errors']>[number] & { validation?: Record<string, string[]> }

/** What one answer said, before it means anything about a media. */
export type Read<T> =
  | { kind: 'data', data: T }
  | { kind: 'signed-out' }
  | { kind: 'rate-limited' }
  | { kind: 'error', message: string }

const errorMessage = (status: number, errors: AnilistError[]) => {
  const said = errors
    .map(error => [error.message, ...Object.values(error.validation ?? {}).flat()].filter(Boolean).join(' '))
    .filter(Boolean)
  return `AniList answered ${status}${said.length ? `: ${said.join('; ')}` : ' with nothing to read'}`
}

/** AniList reports most failures inside the body, beside whatever status it sent. */
export const readResponse = <T>(status: number, body: AnilistBody<T> | null): Read<T> => {
  const errors = (body?.errors ?? []) as AnilistError[]
  if (status === 429 || errors.some(error => error.status === 429)) return { kind: 'rate-limited' }
  if (status === 401 || errors.some(error => error.status === 401)) return { kind: 'signed-out' }
  if (errors.length || body?.data == null) return { kind: 'error', message: errorMessage(status, errors) }
  return { kind: 'data', data: body.data }
}

/** A score in the viewer's own format, as AniList shows it to them. Null for no score. */
export const scoreLabel = (score: number | null | undefined, format: string): string | null => {
  if (!score) return null
  switch (format) {
    case 'POINT_10_DECIMAL': return `${score.toFixed(1)} / 10`
    case 'POINT_10': return `${Math.round(score)} / 10`
    case 'POINT_5': return `${Math.round(score)} / 5`
    case 'POINT_3': return [':(', ':|', ':)'][Math.round(score) - 1] ?? `${score} / 3`
    default: return `${Math.round(score)} / 100`
  }
}

export const scoreFormatOf = (viewer: AnilistViewer | undefined) => viewer?.mediaListOptions?.scoreFormat ?? 'POINT_100'

const fuzzyDate = (date: AnilistDate): FuzzyDate | null =>
  date?.year ? { year: date.year, month: date.month ?? null, day: date.day ?? null } : null

/** One AniList entry as a stub list entry: its own id, its own episode count, the score both ways. */
export const listEntryOf = (format: string, media: AnilistMedia, entry: AnilistEntry): ListEntry => ({
  _id: `${ANILIST_TRACKER_ID}:${entry.id}`,
  tracker: ANILIST_TRACKER_ID,
  mediaUri: `${ANILIST_TRACKER_ID}:${media.id}`,
  status: (entry.status && FROM_ANILIST[entry.status]) || null,
  progress: entry.progress ?? null,
  score: entry.scoreRaw ? Math.round(entry.scoreRaw) : null,
  scoreLabel: scoreLabel(entry.score, format),
  startedAt: fuzzyDate(entry.startedAt),
  completedAt: fuzzyDate(entry.completedAt),
  rewatchCount: entry.repeat ?? null,
  updatedAt: entry.updatedAt ? new Date(entry.updatedAt * 1_000).toISOString() : null,
  url: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
  title: media.title?.userPreferred ?? null,
  cover: media.coverImage?.large ?? null,
  episodeCount: media.episodes ?? null,
})

/** The tracker as its answers name it, from the viewer the last read found (none: signed out). */
export const anilistTracker = (viewer: AnilistViewer | undefined): Tracker => ({
  id: ANILIST_TRACKER_ID,
  name: 'AniList',
  icon: ANILIST_ICON,
  color: null,
  signedIn: Boolean(viewer),
  account: viewer?.name ?? null,
  canWrite: Boolean(viewer),
  scoreScale: scoreFormatOf(viewer),
  writeNotice: ANILIST_WRITE_NOTICE,
})
