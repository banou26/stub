import type { BaseLocationHook, BaseSearchHook } from 'wouter'

import { navigate, useLocationProperty, usePathname, useSearch } from 'wouter/use-browser-location'

const isPreview = (pathname: string) => pathname === '/media' || pathname.startsWith('/media/')

/**
 * The search a preview was opened from (`/search?genre=Action`), as the preview's history entry keeps it, so the
 * preview is drawn over its results, and Back, Forward and a reload draw them under it again. Undefined everywhere
 * else, and for a preview opened from any other page, which is drawn over the home page.
 */
export const pageUnder = (pathname: string, state: unknown): string | undefined => {
  const under = isPreview(pathname) ? (state as { under?: unknown } | null)?.under : undefined
  return typeof under === 'string' ? under : undefined
}

const drawnPage = () =>
  pageUnder(location.pathname, history.state) ?? (location.pathname === '/search' ? `${location.pathname}${location.search}` : undefined)

/**
 * Every navigation made through wouter. One to a preview keeps the search drawn now under it, so a preview opened from
 * a search stays over that search through another preview it links to and through its address growing.
 */
export const navigateOver = (to: string, { replace, state }: { replace?: boolean, state?: unknown } = {}) => {
  const under = state === undefined && isPreview(new URL(to, location.href).pathname) ? drawnPage() : undefined
  navigate(to, { replace, state: under ? { under } : state ?? null })
}

/** The search under the preview open now, if there is one. */
export const usePageUnder = () => useLocationProperty(() => pageUnder(location.pathname, history.state), () => undefined)

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
