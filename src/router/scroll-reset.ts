// Where the page's scroll goes after a navigation.
//
// A single page app moves nothing on its own: wouter swaps the route component and the document
// keeps whatever scroll it had, so "Current season" clicked 1,200px down the home page opened the
// season listing 1,200px down, and nothing in this app ever reset it (2026-09-08). This is the rule,
// kept pure so every navigation in the app can be tabled against it in tests/unit/router; the
// component that applies it is components/scroll-reset.tsx.

/** How the document reached its current url. Back and forward are `pop`. */
export type NavigationKind = 'push' | 'replace' | 'pop'

export type Place = { pathname: string, search: string }

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
 * was: it is still there under the modal, and it is what the person comes back to.
 */
export const isHomeFamily = (pathname: string): boolean =>
  pathname === '/' || pathname === '/media' || pathname.startsWith('/media/')

const isTitle = (pathname: string) => pathname.startsWith('/title/')

/**
 * Whether a navigation resets the page to the top.
 *
 * - Back and forward are the browser's. It restores the position the entry had, and a reset on top
 *   of that would send every back button to the top of a page the person had already read.
 * - Anything within the home family stays: the modal rides over the page, see `isHomeFamily`.
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
  if (kind === 'replace') return from.pathname !== to.pathname && !(isTitle(from.pathname) && isTitle(to.pathname))
  return true
}

/**
 * Jumped, never glided. `instant` rather than `auto`, because `auto` defers to whatever
 * `scroll-behavior` a stylesheet sets and would animate the reset across the whole of the old page.
 */
export const scrollToTop = () => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }

let frame = 0

/**
 * Reset on the NEXT frame rather than now, because two things follow the navigation and both have to
 * come first. The re-render, so the new page is not painted at the old position and then jumped. And
 * a modal the old page had, whose unlock on unmount restores the position it captured when it locked
 * (floating-ui does this on iOS); a reset before that unlock is undone by it, and nothing on a
 * desktop shows it.
 */
export const scheduleReset = () => {
  cancelReset()
  frame = requestAnimationFrame(() => { frame = 0; scrollToTop() })
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
