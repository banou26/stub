// Whether the viewer was signed in to each site when stub last learned it, for the Accounts section to
// show without asking the site on every visit. Import free, so a test drives it over fake storage.

/** The localStorage key holding the remembered states, a JSON object of `SiteStatus` by site. */
export const SITE_STATUS_KEY = 'stub.site-status'

/** The sites whose sign-in state stub remembers, by stub's name for them. */
export type StatusSite = 'crunchyroll' | 'anilist' | 'mal'

export type SiteState = 'signed-in' | 'signed-out'

/** A state and when stub learned it, in epoch milliseconds. Never an account name: that stays with the site. */
export type SiteStatus = { state: SiteState, checkedAt: number }

export type SiteStatuses = {
  read: (site: StatusSite) => SiteStatus | undefined
  record: (site: StatusSite, state: SiteState, now?: number) => void
  /** Called after every `record` of the site on this page. */
  watch: (site: StatusSite, listener: () => void) => () => void
}

const isStatus = (value: unknown): value is SiteStatus =>
  typeof value === 'object' && value !== null
  && ((value as SiteStatus).state === 'signed-in' || (value as SiteStatus).state === 'signed-out')
  && Number.isFinite((value as SiteStatus).checkedAt)

/**
 * Kept in `storage` when it can be, and for this page at least when it cannot. Read from storage on
 * every call, so a state removed from storage, by another tab or by clearing site data, is gone here too.
 */
export const createSiteStatuses = (storage: () => Pick<Storage, 'getItem' | 'setItem'>): SiteStatuses => {
  const unsaved = new Map<StatusSite, SiteStatus>()
  const listeners = new Map<StatusSite, Set<() => void>>()
  const stored = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(storage().getItem(SITE_STATUS_KEY) ?? '{}')
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
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
      for (const listener of listeners.get(site) ?? []) listener()
    },
    watch: (site, listener) => {
      let set = listeners.get(site)
      if (!set) listeners.set(site, set = new Set())
      set.add(listener)
      return () => { set.delete(listener) }
    },
  }
}

/** This browser's remembered states. */
export const siteStatuses = createSiteStatuses(() => localStorage)

/** Remembers what a sign-in through a window told: only `authed` says the viewer is signed in now. */
export const rememberSignIn = <Outcome extends string>(statuses: Pick<SiteStatuses, 'record'>, site: StatusSite) => (outcome: Outcome): Outcome => {
  if (outcome === 'authed') statuses.record(site, 'signed-in')
  return outcome
}

type TrackerStatusSite = Exclude<StatusSite, 'crunchyroll'>
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
