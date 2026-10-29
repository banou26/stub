// What a movie's page shows in place of a series' episode list: its length and a release that may still be
// ahead. No component imports, so the rules are tested without rendering the modal.

import { intl } from '../../i18n'
import { durationLocale } from '../../utils/countdown'
import { civilDay, DAY_MS, isDateOnly, isPartialDate, parseReleaseDate, releaseDateLabel } from '../../utils/release-date'

/** "1h 52m" for 112 minutes, "45m" under an hour, in the language shown, undefined for none. */
export const runtimeText = (minutes: number | null | undefined): string | undefined => {
  if (!minutes || minutes <= 0) return undefined
  return new Intl.DurationFormat(durationLocale(), { style: 'narrow' }).format({ hours: Math.floor(minutes / 60), minutes: Math.round(minutes % 60) })
}

/**
 * A film not out yet's date in large type: the day (`Dec 11`) over its long form and the days left (`in 46 days`), or a
 * month or a year alone over its Releases line. A named day is read in UTC, an air time where the viewer is, as
 * `releaseDateLabel` reads them. Undefined for no date.
 */
export const filmDate = (
  released: string | null | undefined,
  now = new Date()
): { day: string, date: string, count?: string, partial: boolean } | undefined => {
  const date = parseReleaseDate(released)
  if (!date) return undefined
  const utc = isDateOnly(released)
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intl.locale, { ...options, ...utc ? { timeZone: 'UTC' } : {} }).format(date)
  if (isPartialDate(released)) {
    return {
      day: format(released!.length === 4 ? { year: 'numeric' } : { month: 'long' }),
      date: intl.formatMessage({ id: 'Releases {day}', defaultMessage: 'Releases {day}' }, { day: releaseDateLabel(released, { locale: intl.locale }) }),
      partial: true,
    }
  }
  const days = Math.round((civilDay(date, utc) - civilDay(now, false)) / DAY_MS)
  return {
    day: format({ month: 'short', day: 'numeric' }),
    date: format({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    count: days < 0 ? undefined : new Intl.RelativeTimeFormat(intl.locale, { numeric: 'auto' }).format(days, 'day'),
    partial: false,
  }
}

/** Whether a media draws as a film: by its format when known, else its categories, however many parts a source lists it in. */
export const isMovieMedia = (
  { type, categories }: { type?: string | null, categories?: readonly string[] | null }
): boolean => type ? type === 'MOVIE' : Boolean(categories?.includes('MOVIE'))

/**
 * Where a release stands at `now`: 1 still ahead, -1 out, 0 within the day, month or year a value with no
 * time names, where it may still come out later. That period begins and ends where the viewer is, so it
 * agrees with the day its label names; a value carrying a time is an instant and is never 0. Undefined
 * for no date.
 */
export const releaseSide = (released: string | null | undefined, now = new Date()): -1 | 0 | 1 | undefined => {
  const date = parseReleaseDate(released)
  if (!date) return undefined
  if (!isDateOnly(released)) return date.getTime() > now.getTime() ? 1 : -1
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const start = date.getTime()
  const year = date.getUTCFullYear()
  const end = released!.length === 4 ? Date.UTC(year + 1, 0)
    : released!.length === 7 ? Date.UTC(year, date.getUTCMonth() + 1)
    : start + 86_400_000
  return today < start ? 1 : today < end ? 0 : -1
}

/** Whether a release is still ahead of `now`, by its instant or by its day where the viewer is. */
export const isUpcoming = (released: string | null | undefined, now = new Date()): boolean =>
  releaseSide(released, now) === 1
