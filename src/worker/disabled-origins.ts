// The built-in sources the viewer turned off (src/sources/disabled-sources.ts), as the worker holds
// them. Kept apart from ./extractor.ts, which cannot load under vitest, so the rule is tested alone.

import { site, siteAsks, type Site } from '../site'

const disabled = new Set<string>()

/** Replaces the turned off origins. Fan-outs opened from then on leave them out. */
export const setDisabledOrigins = (origins: readonly string[]) => {
  disabled.clear()
  for (const origin of origins) disabled.add(origin)
}

/**
 * The entries a question may be put to: every one but a built-in source that is turned off or that
 * this site never asks (src/site.ts). A plugin source is never left out here, since the way to stop one
 * is removing it.
 */
export const askable = <E extends { extractor: { origin: string }, pluginUri?: string }>(entries: readonly E[], current: Site = site): E[] =>
  entries.filter(entry => entry.pluginUri !== undefined || (!disabled.has(entry.extractor.origin) && siteAsks(entry.extractor.origin, current)))
