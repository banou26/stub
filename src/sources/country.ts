// The viewer's country: the one picked in Settings, a setting that follows the FKN account
// (src/settings-store.ts), else the one this device's time zone is in, worked out on each call and kept
// nowhere. No imports but the zone table and the settings store, so the settings page, src/worker.ts, the
// players and the sources share it.

import ZONE_COUNTRIES from './zone-countries.json'
import { settings } from '../settings-store'

/** The setting holding the country picked in Settings, an ISO 3166 code. No value is Automatic. */
export const COUNTRY_KEY = 'stub.country'

// tzdata 2026c's zone.tab, which Firefox reports by name, and for each of its zones the name ICU reports
// instead (Chromium, Safari, Node): `Asia/Calcutta` for Asia/Kolkata, `America/Coral_Harbour` for
// America/Atikokan in Canada. That name takes the zone.tab zone's country, never its tzdata link's
// target's: Coral_Harbour links to America/Panama.
const zones: Readonly<Record<string, string | undefined>> = ZONE_COUNTRIES

/** Every country a time zone is in, as ISO 3166 codes. */
export const COUNTRIES: readonly string[] = [...new Set(Object.values(ZONE_COUNTRIES))]

/** The country `timeZone` is in, or the US for a zone that names none (UTC) or that the table lacks. */
export const zoneCountry = (timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => zones[timeZone] ?? 'US'

/** The country picked in Settings, or undefined for Automatic, a value naming no country, or no storage. */
export const readPickedCountry = (): string | undefined => {
  const kept = settings.getItem(COUNTRY_KEY)
  return kept && COUNTRIES.includes(kept) ? kept : undefined
}

/** Picks `country`, or Automatic with undefined, and tells every watcher. */
export const pickCountry = (country: string | undefined) => {
  try {
    if (country) settings.setItem(COUNTRY_KEY, country)
    else settings.removeItem(COUNTRY_KEY)
  } catch {}
}

/** Calls `listener` whenever the picked country changes, in this tab, in another one, or on the account. */
export const watchPickedCountry = (listener: () => void): () => void => settings.watch(COUNTRY_KEY, listener)

let held: string | undefined

/** Holds the country picked in Settings in a realm with no storage of its own, the worker. */
export const holdPickedCountry = (country: string | undefined) => { held = country }

/** The viewer's country: the one picked in Settings, else the one the time zone is in. */
export const viewerCountry = () => readPickedCountry() ?? held ?? zoneCountry()
