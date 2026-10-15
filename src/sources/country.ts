// The viewer's country: the one picked in Settings, kept in this browser, else the one this device's
// time zone is in, worked out on each call and kept nowhere. No imports but the zone table, so the
// settings page, src/worker.ts, the players and the sources share it.

import ZONE_COUNTRIES from './zone-countries.json'

/** The localStorage key holding the country picked in Settings, an ISO 3166 code. No key is Automatic. */
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

const listeners = new Set<() => void>()

/** The country picked in Settings, or undefined for Automatic, a value naming no country, or no storage. */
export const readPickedCountry = (): string | undefined => {
  try {
    const kept = globalThis.localStorage.getItem(COUNTRY_KEY)
    return kept && COUNTRIES.includes(kept) ? kept : undefined
  } catch {
    return undefined
  }
}

/** Picks `country`, or Automatic with undefined, and tells every watcher in this tab. */
export const pickCountry = (country: string | undefined) => {
  try {
    if (country) globalThis.localStorage.setItem(COUNTRY_KEY, country)
    else globalThis.localStorage.removeItem(COUNTRY_KEY)
  } catch {}
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the picked country changes, in this tab or in another one. */
export const watchPickedCountry = (listener: () => void): () => void => {
  const fromOtherTab = (event: StorageEvent) => { if (event.key === COUNTRY_KEY || event.key === null) listener() }
  listeners.add(listener)
  globalThis.addEventListener?.('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', fromOtherTab)
  }
}

let held: string | undefined

/** Holds the country picked in Settings in a realm with no storage of its own, the worker. */
export const holdPickedCountry = (country: string | undefined) => { held = country }

/** The viewer's country: the one picked in Settings, else the one the time zone is in. */
export const viewerCountry = () => readPickedCountry() ?? held ?? zoneCountry()
