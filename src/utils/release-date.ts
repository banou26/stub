/**
 * An episode's release date, as a person reads it.
 *
 * Answers `undefined` for anything there is nothing honest to show for: no date, or a date written in
 * a shape nothing can parse. That is the caller's signal to render nothing rather than a dash or an
 * "unknown", since most episodes of most runs carry no date at all and a column of placeholders is
 * worse than an empty one.
 *
 * THE TRAP THIS EXISTS FOR is the day boundary. A source can name a DAY with no time (anizip's
 * `airdate` is `2024-01-07`), and `new Date('2024-01-07')` is midnight UTC, so `toLocaleDateString`
 * anywhere west of Greenwich renders **January 6**: every date-only episode shows a day early for a
 * third of the world, and nothing about it looks wrong. So a date-only value is formatted in UTC,
 * where the day the source named is the day shown, while a value carrying a time is a real moment and
 * is formatted where the viewer is.
 *
 * It cannot be seen from here, which is why it is pinned rather than eyeballed: this machine is UTC+9
 * and a positive offset never crosses backwards, so the wrong version and the right one render
 * identically on it. `tests/unit/utils/release-date.test.ts` pins the zone.
 *
 * A STRING is the whole input contract, because that is what reaches a client: `Episode.releaseDate`
 * is the GraphQL `Date` scalar. A source holding epoch milliseconds converts at the extractor, where
 * the units are established (see `src/sources/catalogue-gate.ts`, which records how Apple TV's were
 * measured), rather than here where a seconds-for-milliseconds mixup would be a silent 1970.
 */

export const DAY_MS = 86_400_000

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: a year, a month or a day rather than an instant. */
const DATE_ONLY = /^\d{4}(-\d{2}){0,2}$/

/** Whether a value names a year, a month or a day (`2027`, `2027-03`, `2027-03-05`) rather than an instant. */
export const isDateOnly = (value: string | null | undefined): boolean => Boolean(value && DATE_ONLY.test(value))

/** Whether a value names only a year or a month (`2027`, `2027-03`), which a day or an instant outranks. */
export const isPartialDate = (value: string | null | undefined): boolean => isDateOnly(value) && value!.length < 10

/**
 * A year no episode aired in, so a parsed `0000-01-01` is refused rather than rendered as "Jan 1, 0".
 * A floor rather than a window: an episode dated in the future is an announced one, which is worth
 * showing.
 */
const IMPLAUSIBLE_BEFORE = 1900

export type ReleaseDateOptions = {
  /** The locale the page writes dates in, `intl.locale`; undefined is the browser's own. */
  locale?: string | readonly string[]
}

/** The instant a value names, or `undefined` when it names none. */
export const parseReleaseDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  // read in UTC, so the floor does not move with the viewer
  if (date.getUTCFullYear() < IMPLAUSIBLE_BEFORE) return undefined
  return date
}

/**
 * A media's start, end or film release as the day it names, `YYYY-MM-DD`, or as the year or month alone
 * when that is all its source knows. AniList, Jikan, Apple TV and Simkl's anime records write the day as
 * UTC midnight with a time attached, so it is read in UTC, never where the viewer is. Any other time is
 * an air time (AniList takes a start it knows only to its month from its first airing) and stays one.
 */
export const releaseDay = (value: string | null | undefined): string | undefined => {
  const date = parseReleaseDate(value)
  if (!date) return undefined
  return isPartialDate(value) || date.getTime() % DAY_MS ? value! : date.toISOString().slice(0, 10)
}

/** Whether `value` names a day, a month or an instant inside the year or month `partial` names (`2027`, `2027-10`). */
export const refinesDate = (partial: string | null | undefined, value: string | null | undefined): boolean => {
  const date = parseReleaseDate(value)
  if (!date || !isPartialDate(partial)) return false
  if (isPartialDate(value)) return value!.length > partial!.length && value!.startsWith(partial!)
  return date.toISOString().startsWith(partial!)
}

/**
 * The date to show beside an episode, or `undefined` to show nothing.
 *
 * Deliberately a DAY and not a time. An episode's airing is a day in the viewer's head, the sources
 * disagree about the hour by whole timezones, and a broadcast minute in a listing is noise. A year or a
 * month alone shows as just that ("2027", "Mar 2027").
 */
export const releaseDateLabel = (
  value: string | null | undefined,
  { locale }: ReleaseDateOptions = {}
): string | undefined => {
  const date = parseReleaseDate(value)
  if (!date) return undefined
  try {
    return new Intl.DateTimeFormat(locale as string | string[] | undefined, {
      year: 'numeric',
      ...!isPartialDate(value) ? { month: 'short', day: 'numeric' } : value!.length > 4 ? { month: 'short' } : {},
      // the whole point: a named day is shown as that day, everywhere
      ...isDateOnly(value) ? { timeZone: 'UTC' } : {},
    }).format(date)
  } catch {
    // an unusable locale must not take a row down over a date
    return undefined
  }
}

/**
 * How near an episode still reads better as a count of days than as a date, either way. A month, taken
 * as 30 days: past that "47 days ago" is arithmetic the reader has to do, and the date itself is the
 * more useful thing.
 */
export const RELATIVE_WITHIN_DAYS = 30

/**
 * The day a moment falls on, as a number that can be subtracted from another.
 *
 * CALENDAR days, not elapsed hours, which is the whole reason this is not a subtraction. An episode
 * that aired at 23:00 last night is twelve hours old and is `yesterday` to every reader; dividing the
 * elapsed milliseconds by a day would call it today. Built through `Date.UTC` from the civil parts,
 * so a day is exactly 86,400,000 apart from the next one and a daylight saving shift cannot move it.
 *
 * `utc` picks the frame: a source that named a DAY named it in no timezone at all, so its own day is
 * read, while a moment is read where the viewer is.
 */
export const civilDay = (date: Date, utc: boolean): number =>
  utc
    ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())

/**
 * What to show beside an episode: how long ago it landed, or for one not out yet (`upcoming`) how long
 * until it airs, while that is still short enough to mean something, and the date itself once it is
 * not. The one airing next counts down instead (`utils/countdown.ts`).
 *
 * Without `upcoming` a day ahead shows as its date, so an episode that is out while a source dates it
 * later never reads as still to come.
 */
export const releaseDateDisplay = (
  value: string | null | undefined,
  { locale, now = new Date(), upcoming = false }: ReleaseDateOptions & { now?: Date, upcoming?: boolean } = {}
): string | undefined => {
  const date = parseReleaseDate(value)
  if (!date) return undefined
  const days = Math.round((civilDay(now, false) - civilDay(date, isDateOnly(value))) / DAY_MS)
  if (days >= 0 ? days < RELATIVE_WITHIN_DAYS : upcoming && -days < RELATIVE_WITHIN_DAYS) {
    try {
      // today, yesterday, 3 days ago, tomorrow, in 3 days
      return new Intl.RelativeTimeFormat(locale as string | string[] | undefined, { numeric: 'auto' }).format(-days, 'day')
    } catch {
      return undefined
    }
  }
  return releaseDateLabel(value, { locale })
}

/**
 * The machine-readable value for a `<time dateTime>`, or `undefined` alongside an undefined label.
 *
 * A named day is handed back as that day rather than as an instant, so the attribute and the visible
 * text can never disagree about which day it is.
 */
export const releaseDateAttribute = (value: string | null | undefined): string | undefined => {
  const date = parseReleaseDate(value)
  if (!date) return undefined
  return isDateOnly(value) ? value! : date.toISOString()
}
