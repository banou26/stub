// The sources the viewer turned off (src/sources/disabled-sources.ts), as the worker holds them. Kept
// apart from ./extractor.ts, which cannot load under vitest, so the rule is tested alone.

import { site, siteAsks, type Site } from '../site'
import { joinFanout, type Fanout, type FanoutEntry } from './fanout'

const disabled = new Set<string>()

/** Replaces the turned off origins. Fan-outs opened from then on leave them out. */
export const setDisabledOrigins = (origins: readonly string[]) => {
  disabled.clear()
  for (const origin of origins) disabled.add(origin)
}

/**
 * The entries a question may be put to: every one but a source that is turned off, built in or added,
 * and a built-in source this site never asks (src/site.ts).
 */
export const askable = <E extends { extractor: { origin: string }, pluginUri?: string }>(entries: readonly E[], current: Site = site): E[] =>
  entries.filter(entry => !disabled.has(entry.extractor.origin) && (entry.pluginUri !== undefined || siteAsks(entry.extractor.origin, current)))

/** Joins a source that registered mid-flight to every fan-out still open, unless `askable` leaves it out. */
export const joinOpenFanouts = <E extends FanoutEntry & { extractor: { origin: string }, pluginUri?: string }>(fanouts: Iterable<Fanout<E>>, entry: E) => {
  if (!askable([entry]).length) return
  for (const fanout of fanouts) joinFanout(fanout, entry)
}
