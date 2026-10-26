import { intl } from '../i18n'

// days and hours in full, minutes and seconds short, each left out at zero
const COUNTDOWN: Intl.DurationFormatOptions = { style: 'short', days: 'long', hours: 'long', daysDisplay: 'auto', hoursDisplay: 'auto' }

const formats = new Map<string, Intl.DurationFormat>()

// US English writes "42 min" where stub's English has always read "42 mins", as international English (en-001) does
const countdownFormat = () => {
  const locale = new Intl.Locale(intl.locale).language === 'en' ? 'en-001' : intl.locale
  if (!formats.has(locale)) formats.set(locale, new Intl.DurationFormat(locale, COUNTDOWN))
  return formats.get(locale)!
}

/**
 * A duration as the largest units it actually uses, the way a broadcast countdown reads, in the language shown.
 *
 * `units` is how many of them to name: two gives "1 hour, 42 mins", one gives "1 hour". Empty units
 * are SKIPPED rather than padded, so an episode six days and forty-two minutes out reads
 * "6 days, 42 mins" and never "6 days, 0 hours".
 *
 * Answers `undefined` for a time that has already passed, which is the caller's signal to render
 * nothing: a stored schedule outlives the airing it describes by however long the source takes to
 * publish the next one.
 */
export const formatCountdown = (ms: number, units = 2): string | undefined => {
  if (!Number.isFinite(ms) || ms <= 0) return undefined

  const parts: Partial<Record<Intl.DurationFormatUnit, number>> = {}
  let named = 0
  let rest = ms
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size)
    rest -= count * size
    if (!count) continue
    parts[unit] = count
    if (++named >= units) break
  }
  return named ? countdownFormat().format(parts) : undefined
}

const UNITS = [['days', 86_400_000], ['hours', 3_600_000], ['minutes', 60_000], ['seconds', 1_000]] as const
