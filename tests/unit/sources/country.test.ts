// The viewer's country: the time zone's, from a table of every zone and the old names browsers still
// report, unless Settings picked one.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import ZONE_COUNTRIES from '../../../src/sources/zone-countries.json'
import { COUNTRIES, COUNTRY_KEY, holdPickedCountry, pickCountry, readPickedCountry, viewerCountry, watchPickedCountry, zoneCountry } from '../../../src/sources/country'
import { viewerIn } from './justwatch/viewer'

const stored = new Map<string, string>()
const memory = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
}
beforeEach(() => { stored.clear(); vi.stubGlobal('localStorage', memory) })
afterEach(() => {
  vi.unstubAllGlobals()
  holdPickedCountry(undefined)
})

test('a time zone names the country it is in, Canada\'s included, and one naming none is the US', () => {
  expect(zoneCountry('America/Toronto')).toBe('CA')
  expect(zoneCountry('America/Vancouver')).toBe('CA')
  expect(zoneCountry('America/St_Johns')).toBe('CA')
  expect(zoneCountry('Asia/Tokyo')).toBe('JP')
  expect(zoneCountry('Europe/London')).toBe('GB')
  expect(zoneCountry('Europe/Berlin')).toBe('DE')
  expect(zoneCountry('Europe/Vienna')).toBe('AT')
  expect(zoneCountry('Europe/Amsterdam')).toBe('NL')
  expect(zoneCountry('America/New_York')).toBe('US')
  expect(zoneCountry('America/Los_Angeles')).toBe('US')
  expect(zoneCountry('UTC')).toBe('US')
  expect(zoneCountry('Not/A_Zone')).toBe('US')
})

// Chromium and Node report these for Asia/Kolkata, Europe/Kyiv, Asia/Ho_Chi_Minh, Africa/Asmara (Eritrea),
// America/Atikokan (Ontario), Pacific/Pohnpei and Pacific/Chuuk (Micronesia), and none is in zone.tab. The
// last four are tzdata links to zones in Kenya, Panama, the Solomon Islands and Papua New Guinea.
test('the old zone names a browser still reports name their own country', () => {
  expect(zoneCountry('Asia/Calcutta')).toBe('IN')
  expect(zoneCountry('Europe/Kiev')).toBe('UA')
  expect(zoneCountry('Asia/Saigon')).toBe('VN')
  expect(zoneCountry('Africa/Asmera')).toBe('ER')
  expect(zoneCountry('America/Coral_Harbour')).toBe('CA')
  expect(zoneCountry('Pacific/Ponape')).toBe('FM')
  expect(zoneCountry('Pacific/Truk')).toBe('FM')
})

const reportedFor = (timeZone: string) => new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone

test('a zone and the name this runtime reports for it are in the same country', () => {
  expect(reportedFor('Africa/Asmara'), 'the runtime renames zones, or this checks nothing').toBe('Africa/Asmera')
  const zones = ZONE_COUNTRIES as Record<string, string>
  const apart = Object.keys(zones).filter(zone => zones[reportedFor(zone)] !== zones[zone])
  expect(apart.map(zone => `${zone} ${zones[zone]}, reported ${reportedFor(zone)} ${zones[reportedFor(zone)]}`)).toEqual([])
  expect(zoneCountry(reportedFor('America/Montreal'))).toBe('CA')
})

test('every time zone this runtime reports is in the table', () => {
  const reported = Intl.supportedValuesOf('timeZone')
  expect(reported.length, 'the runtime lists its zones').toBeGreaterThan(400)
  expect(reported.filter(zone => !(zone in ZONE_COUNTRIES))).toEqual([])
  expect(COUNTRIES).toHaveLength(new Set(COUNTRIES).size)
  expect(COUNTRIES).toEqual(expect.arrayContaining(['CA', 'JP', 'US', 'GB', 'DE', 'AT', 'NL']))
})

test('the viewer is in the time zone\'s country until Settings picks another, and back on Automatic', () => {
  viewerIn('America/Toronto')
  expect(viewerCountry()).toBe('CA')
  pickCountry('JP')
  expect(stored.get(COUNTRY_KEY)).toBe('JP')
  expect(readPickedCountry()).toBe('JP')
  expect(viewerCountry()).toBe('JP')
  pickCountry(undefined)
  expect(stored.has(COUNTRY_KEY), 'Automatic keeps nothing').toBe(false)
  expect(viewerCountry()).toBe('CA')
})

test('a kept value naming no country is Automatic', () => {
  viewerIn('Asia/Tokyo')
  for (const kept of ['', 'ca', 'Canada', 'XX', '"CA"']) {
    stored.set(COUNTRY_KEY, kept)
    expect(readPickedCountry(), kept).toBeUndefined()
    expect(viewerCountry(), kept).toBe('JP')
  }
})

test('storage that cannot be read is Automatic, and a pick there is heard but kept nowhere', () => {
  viewerIn('Europe/Berlin')
  vi.stubGlobal('localStorage', undefined)
  const heard = vi.fn()
  const stop = watchPickedCountry(heard)
  pickCountry('GB')
  expect(heard).toHaveBeenCalledTimes(1)
  expect(viewerCountry()).toBe('DE')
  stop()
})

// the worker has no storage, so the page tells it what Settings picked
test('with no storage, a country held for the realm wins over the time zone, and Automatic goes back to it', () => {
  viewerIn('America/Toronto')
  vi.stubGlobal('localStorage', undefined)
  holdPickedCountry('GB')
  expect(viewerCountry()).toBe('GB')
  holdPickedCountry(undefined)
  expect(viewerCountry()).toBe('CA')
})

test('a watcher hears a pick in this tab and in another, until it stops', () => {
  const heard = vi.fn()
  const events = new EventTarget()
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  const stop = watchPickedCountry(heard)
  pickCountry('FR')
  events.dispatchEvent(Object.assign(new Event('storage'), { key: COUNTRY_KEY }))
  events.dispatchEvent(Object.assign(new Event('storage'), { key: 'stub.sources.disabled' }))
  expect(heard).toHaveBeenCalledTimes(2)
  stop()
  pickCountry(undefined)
  expect(heard).toHaveBeenCalledTimes(2)
})
