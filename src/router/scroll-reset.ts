// Where the page's scroll goes after a navigation, and the home rows' sideways scroll.
//
// A single page app moves nothing on its own: wouter swaps the route component and the document
// keeps whatever scroll it had, so "Current season" clicked 1,200px down the home page opened the
// season listing 1,200px down, and nothing in this app ever reset it (2026-09-08). This is the rule,
// kept pure so every navigation in the app can be tabled against it in tests/unit/router; the
// component that applies it is components/scroll-reset.tsx.

import type { Over } from './page-under'

/** How the document reached its current url. Back and forward are `pop`. */
export type NavigationKind = 'push' | 'replace' | 'pop'

export type Place = {
  pathname: string
  search: string
  /** The search a preview was opened over, if any: see `pageOver` in ./page-under.ts. */
  over?: Over
}

export type Navigation = {
  from: Place
  to: Place
  kind: NavigationKind
  /** The link itself asked for the top, whatever the rule would say: see `askForTop`. */
  asked?: boolean
}

/**
 * `/` and `/media/...` are ONE page. The media route renders the home page with a modal over it (a
 * fixed overlay that locks the body and scrolls inside itself), so opening a card, closing it, or
 * a canonical uri replacing the one in the address bar has to leave the home page exactly where it
 * was: it is still there under the modal, and it is what the person comes back to. A modal opened
 * from a search is drawn over that search instead, see `Place.over`.
 */
export const isHomeFamily = (pathname: string): boolean =>
  pathname === '/' || pathname === '/media' || pathname.startsWith('/media/')

const isTitle = (pathname: string) => pathname.startsWith('/title/')

const address = ({ pathname, search }: Place) => `${pathname}${search}`

/**
 * Whether a navigation resets the page to the top.
 *
 * - Back and forward are the browser's. It restores the position the entry had, and a reset on top
 *   of that would send every back button to the top of a page the person had already read.
 * - Anything within the home family stays: the modal rides over the page, see `isHomeFamily`. So
 *   does a modal opened over a search, and closing it returns to where that search was, see
 *   `returnTop`.
 * - A replace is the url as state (the search filters, the header's typing, a canonical media uri)
 *   rather than the person going somewhere, so it resets only when it changes the page. The title
 *   page growing its address as sources merge is the same page.
 * - Everything else is somebody going somewhere, and a page somebody asked for starts at the top.
 *   That includes the same page again: the next episode or another source from the watch page.
 */
export const resetsScroll = ({ from, to, kind, asked = false }: Navigation): boolean => {
  if (asked) return true
  if (kind === 'pop') return false
  if (isHomeFamily(from.pathname) && isHomeFamily(to.pathname)) return false
  if (to.over?.under === address(from) || from.over?.under === address(to)) return false
  if (kind === 'replace') return from.pathname !== to.pathname && !(isTitle(from.pathname) && isTitle(to.pathname))
  return true
}

const shown = new Map<string, () => number>()

/**
 * Where the home row `row` was when the viewer left the history entry the page shows, as `keepRows` kept it. Undefined
 * on an entry never left, so a page somebody asked for starts each row at its first card.
 */
export const rowLeft = (row: string): number | undefined =>
  (globalThis.navigation?.currentEntry?.getState() as { rows?: Record<string, number> } | undefined)?.rows?.[row]

/** Lets `keepRows` read a home row's place while it is drawn. Returns the function that ends that, for its unmount. */
export const showRow = (row: string, left: () => number) => {
  shown.set(row, left)
  return () => { shown.delete(row) }
}

/**
 * For the Navigation API's `navigate` event, which fires while the entry being left is still the current one: keeps
 * the drawn rows' places in it. History holds them per entry, through a reload too, so Back draws every row where that
 * page had it.
 */
export const keepRows = () => {
  navigation.updateCurrentEntry({ state: { rows: Object.fromEntries([...shown].map(([row, left]) => [row, left()])) } })
}

/**
 * Where closing a modal puts the search it was drawn over: where that search was when the modal
 * opened. The search may have been drawn again under the modal since (Back from a title or watch
 * page, a reload), and the browser's own restore stops short while its results load. Undefined for
 * every other navigation, and for Back, which is the browser's.
 */
export const returnTop = ({ from, to, kind }: Navigation): number | undefined =>
  kind !== 'pop' && from.over?.under === address(to) ? from.over.top : undefined

/**
 * Jumped, never glided. `instant` rather than `auto`, because `auto` defers to whatever
 * `scroll-behavior` a stylesheet sets and would animate the reset across the whole of the old page.
 */
const jumpTo = (top: number) => { window.scrollTo({ top, left: 0, behavior: 'instant' }) }

/** The top of the page, for a link that goes there itself. */
export const scrollToTop = () => { jumpTo(0) }

let frame = 0

/**
 * Reset, to `top` when given, on the NEXT frame rather than now, because two things follow the
 * navigation and both have to come first. The re-render, so the new page is not painted at the old
 * position and then jumped. And a modal the old page had, whose unlock on unmount restores the
 * position it captured when it locked (floating-ui does this on iOS); a reset before that unlock is
 * undone by it, and nothing on a desktop shows it.
 */
export const scheduleReset = (top = 0) => {
  cancelReset()
  frame = requestAnimationFrame(() => { frame = 0; jumpTo(top) })
}

/**
 * Drop a reset that has not run yet, because something else has just decided where this page belongs.
 *
 * The watch party is the caller. A follower placed where the host is arrives through a navigation,
 * and the reset that navigation scheduled would fire a frame later and undo the placement. The
 * placement is the more specific instruction, so it wins. Safe to call when nothing is pending.
 */
export const cancelReset = () => { cancelAnimationFrame(frame); frame = 0 }

/** Whether a reset is waiting for its frame. For tests, and for anyone who has to reason about order. */
export const resetPending = () => frame !== 0

let wanted = false

/**
 * For a link whose destination the rule would leave alone: the wordmark. Home is where the person
 * already is, or the page under the modal they have open, and the rule keeps both; clicking the
 * wordmark means "home, from the top". Consumed by the very next navigation, whatever it decides,
 * and only by it: a modifier click that opens a new tab never reaches the link's handler, so it
 * cannot leave a request behind.
 */
export const askForTop = () => { wanted = true }

/** Read and clear the request, once, by whoever handles the navigation. */
export const takeAskedTop = (): boolean => {
  const asked = wanted
  wanted = false
  return asked
}
