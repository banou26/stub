// Whether the viewer was signed in to each site when stub last learned it, for each source's card in
// Settings to show. Import free, so a test drives it over fake storage.

import type { FknBackend } from '../utils/fkn-backend'

/** The localStorage key holding the remembered states, a JSON object of `SiteStatus` by site. */
export const SITE_STATUS_KEY = 'stub.site-status'

/** The sites whose sign-in state stub remembers, by stub's name for them. */
export type StatusSite = 'crunchyroll' | 'prime' | 'anilist' | 'mal'

export type SiteState = 'signed-in' | 'signed-out'

/** A state and when stub learned it, in epoch milliseconds. Never an account name: that stays with the site. */
export type SiteStatus = { state: SiteState, checkedAt: number }

export type SiteStatuses = {
  read: (site: StatusSite) => SiteStatus | undefined
  record: (site: StatusSite, state: SiteState, now?: number) => void
  /** Called after every `record` of the site on this page, and after every change to it `heard` is told of. */
  watch: (site: StatusSite, listener: () => void) => () => void
  /** Tells the watchers of each site whose state differs between two values of SITE_STATUS_KEY, as a storage event carries them. */
  heard: (oldValue: string | null, newValue: string | null) => void
}

const isStatus = (value: unknown): value is SiteStatus =>
  typeof value === 'object' && value !== null
  && ((value as SiteStatus).state === 'signed-in' || (value as SiteStatus).state === 'signed-out')
  && Number.isFinite((value as SiteStatus).checkedAt)

const entries = (raw: () => string | null): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(raw() ?? '{}')
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/**
 * Kept in `storage` when it can be, and for this page at least when it cannot. Read from storage on
 * every call, so a state removed from storage, by another tab or by clearing site data, is gone here too.
 */
export const createSiteStatuses = (storage: () => Pick<Storage, 'getItem' | 'setItem'>): SiteStatuses => {
  const unsaved = new Map<StatusSite, SiteStatus>()
  const listeners = new Map<StatusSite, Set<() => void>>()
  const stored = () => entries(() => storage().getItem(SITE_STATUS_KEY))
  const tell = (site: string) => { for (const listener of listeners.get(site as StatusSite) ?? []) listener() }
  return {
    read: site => {
      const status = unsaved.get(site) ?? stored()[site]
      return isStatus(status) ? { state: status.state, checkedAt: status.checkedAt } : undefined
    },
    record: (site, state, now = Date.now()) => {
      const status = { state, checkedAt: now }
      try {
        storage().setItem(SITE_STATUS_KEY, JSON.stringify({ ...stored(), [site]: status }))
        unsaved.delete(site)
      } catch {
        unsaved.set(site, status)
      }
      tell(site)
    },
    watch: (site, listener) => {
      let set = listeners.get(site)
      if (!set) listeners.set(site, set = new Set())
      set.add(listener)
      return () => { set.delete(listener) }
    },
    heard: (oldValue, newValue) => {
      const before = entries(() => oldValue)
      const after = entries(() => newValue)
      for (const site of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[site]) !== JSON.stringify(after[site])) tell(site)
      }
    },
  }
}

/** This browser's remembered states. */
export const siteStatuses = createSiteStatuses(() => localStorage)

// a state recorded in another document of this browser, as by a sign in in another tab or in the player's own
globalThis.addEventListener?.('storage', ({ key, oldValue, newValue }) => { if (key === SITE_STATUS_KEY) siteStatuses.heard(oldValue, newValue) })

/** A state stub learned this recently is not asked again, and neither is a site it asked this recently. */
export const FRESH_MS = 60_000

/**
 * Asks a site with `ask` and remembers the answer, unless the remembered state or the last ask of it is
 * under FRESH_MS old or an ask of it is still running. A failed ask remembers nothing, and neither does
 * one outrun by a state recorded while it ran, such as a sign out.
 */
export const createRefresh = (
  statuses: Pick<SiteStatuses, 'read' | 'record'>,
  ask: (site: StatusSite, backend: FknBackend) => Promise<SiteState>,
  now = Date.now,
) => {
  // when each site was last asked on this page, Infinity while it is being asked
  const asked = new Map<StatusSite, number>()
  return (site: StatusSite, backend: FknBackend): void => {
    if (now() - Math.max(statuses.read(site)?.checkedAt ?? -Infinity, asked.get(site) ?? -Infinity) < FRESH_MS) return
    const started = now()
    asked.set(site, Infinity)
    void ask(site, backend)
      .then(state => { if ((statuses.read(site)?.checkedAt ?? -Infinity) < started) statuses.record(site, state, now()) }, () => {})
      .finally(() => asked.set(site, now()))
  }
}

/** Remembers what a sign-in through a window told: only `authed` says the viewer is signed in now. */
export const rememberSignIn = <Outcome extends string>(statuses: Pick<SiteStatuses, 'record'>, site: StatusSite) => (outcome: Outcome): Outcome => {
  if (outcome === 'authed') statuses.record(site, 'signed-in')
  return outcome
}

type TrackerStatusSite = Exclude<StatusSite, 'crunchyroll' | 'prime'>
const TRACKER_SITES: readonly string[] = ['anilist', 'mal'] satisfies TrackerStatusSite[]

/**
 * Remembers what the trackers' answers tell of their site's session: a list read means signed in, and
 * SIGNED_OUT signed out. Only for a site connected here, since an unconnected one answers SIGNED_OUT
 * without asking the site. Stamped when the answer arrives, so a MyAnimeList state can be up to
 * `INDEX_TTL_MS` (10 minutes) older than it says: its answers come from a list index held that long.
 */
export const recordTrackerAnswers = (
  answers: readonly { state: string, tracker: { id: string } }[],
  statuses: Pick<SiteStatuses, 'record'>,
  isConnected: (site: TrackerStatusSite) => boolean,
): void => {
  for (const { state, tracker } of answers) {
    const site = tracker.id as TrackerStatusSite
    if (!TRACKER_SITES.includes(site) || !isConnected(site)) continue
    if (state === 'LISTED' || state === 'NOT_LISTED') statuses.record(site, 'signed-in')
    else if (state === 'SIGNED_OUT') statuses.record(site, 'signed-out')
  }
}
