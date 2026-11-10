import type { BaseLocationHook, BaseSearchHook } from 'wouter'

import { navigate, useLocationProperty, usePathname, useSearch } from 'wouter/use-browser-location'

const isPreview = (pathname: string) => pathname === '/media' || pathname.startsWith('/media/')

/**
 * The search a preview was opened from (`/search?genre=Action`) and where that search was scrolled to, as the
 * preview's history entry keeps them. The search is drawn under the preview, so Back, Forward and a reload draw it
 * again, and closing the preview returns to that place in it.
 */
export type Over = { under: string, top: number }

/** The search under a preview's entry. Undefined everywhere else, and for a preview opened from any other page, which is drawn over the home page. */
export const pageOver = (pathname: string, state: unknown): Over | undefined => {
  const over = isPreview(pathname) ? state as Partial<Over> | null : undefined
  return typeof over?.under === 'string' && typeof over.top === 'number' ? { under: over.under, top: over.top } : undefined
}

const drawnOver = (): Over | undefined =>
  pageOver(location.pathname, history.state)
  ?? (location.pathname === '/search' ? { under: `${location.pathname}${location.search}`, top: scrollY } : undefined)

/**
 * Every navigation made through wouter. One to a preview keeps the search drawn now under it, so a preview opened from
 * a search stays over that search through another preview it links to and through its address growing.
 */
export const navigateOver = (to: string, { replace, state }: { replace?: boolean, state?: unknown } = {}) => {
  const over = state === undefined && isPreview(new URL(to, location.href).pathname) ? drawnOver() : undefined
  navigate(to, { replace, state: over ?? state ?? null })
}

/** The search under the preview open now, if there is one. */
export const usePageUnder = () => useLocationProperty(() => pageOver(location.pathname, history.state)?.under, () => undefined)

/** The browser's location, navigating through `navigateOver`. */
export const useAppLocation: BaseLocationHook = options => [usePathname(options), navigateOver]

/** The location the pages are drawn at: the search under a preview while one is open over it. */
export const usePageLocation: BaseLocationHook = options => {
  const pathname = usePathname(options)
  const under = usePageUnder()
  return [under ? new URL(under, location.origin).pathname : pathname, navigateOver]
}

export const usePageSearch: BaseSearchHook = options => {
  const search = useSearch(options)
  const under = usePageUnder()
  return under ? new URL(under, location.origin).search : search
}
