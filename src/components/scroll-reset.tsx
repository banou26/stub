import { useEffect, useRef } from 'preact/hooks'

import { cancelReset, resetsScroll, returnTop, scheduleReset, takeAskedTop } from '../router/scroll-reset'
import { pageOver } from '../router/page-under'
import type { Navigation, NavigationKind, Place } from '../router/scroll-reset'

// Applies router/scroll-reset.ts to the document. Mounted once at the router root, so it hears every
// navigation whichever page made it.

const here = (): Place => ({ pathname: location.pathname, search: location.search, over: pageOver(location.pathname, history.state) })

/**
 * wouter patches `pushState` and `replaceState` to dispatch an event of the same name once the url has
 * changed, which is how its own hooks hear a navigation; `popstate` is the browser's, for back and
 * forward.
 *
 * `hashchange` is deliberately NOT here. A fragment is a place within the page somebody asked for, so
 * jumping to the top is the opposite of what it means. The party invite rides in one (router/party),
 * and is read on mount rather than navigated to.
 */
const EVENTS: [string, NavigationKind][] = [['pushState', 'push'], ['replaceState', 'replace'], ['popstate', 'pop']]

const ScrollReset = () => {
  const last = useRef<Place>(here())

  useEffect(() => {
    const listeners = EVENTS.map(([event, kind]) => {
      const listener = () => {
        const navigation: Navigation = { from: last.current, to: here(), kind, asked: takeAskedTop() }
        last.current = navigation.to
        // A navigation that keeps the position leaves a pending reset ALONE rather than cancelling it.
        // Bookkeeping lands in the same frame as the navigation that caused it, and cancelling here
        // would swallow that navigation's reset: plugin-url.ts is the live example, rewriting the url
        // with a same-page `replaceState` whenever the enabled plugins change or a pop lands.
        // `scheduleReset` waits a frame; see it for why the reset cannot run here.
        const top = resetsScroll(navigation) ? 0 : returnTop(navigation)
        if (top !== undefined) scheduleReset(top)
      }
      addEventListener(event, listener)
      return () => removeEventListener(event, listener)
    })
    return () => {
      cancelReset()
      for (const remove of listeners) remove()
    }
  }, [])

  return null
}

export default ScrollReset
