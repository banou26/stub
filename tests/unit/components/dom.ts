import type { ComponentChild, ComponentType } from 'preact'
import type { IntlShape } from 'react-intl'

import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

/**
 * A DOM for the component tests, installed on `globalThis` as a side effect of importing this file.
 *
 * IMPORT IT FIRST, above every other import in a test file. `@emotion/react` decides at MODULE SCOPE
 * whether it is running in a browser (`typeof document !== 'undefined'`) and builds its style cache
 * there, so a document installed after emotion has been evaluated leaves every `css` prop with a null
 * cache: the render then dies inside emotion, at `cache.key`, rather than in the component under
 * test. Module bodies run in import order, so the position of this import is the whole fix.
 */
const dom = parseHTML('<!doctype html><html><head></head><body></body></html>')

// `HTMLElement` is in this list for emotion's sake and not preact's: its browser build gates the
// default style cache on `typeof HTMLElement !== 'undefined'` rather than on `document`, so a
// document with no constructors beside it gets that null cache all the same.
const { CustomEvent, DocumentFragment, Element, Event, HTMLElement, Node, SVGElement, Text } = dom

// a top-level page, as a browser has it: linkedom's window has no `parent`
Object.assign(dom.window, { parent: dom.window })

// Node's own EventTarget, which refuses an event of linkedom's with ERR_INVALID_ARG_TYPE: @banou/media-player 0.10.29
// tells each change of its chapters with `new Event('chapterschange')` on a `new EventTarget()`, which failed every
// test rendering the real player. Node's target stays, as linkedom's ignores a listener's `signal`, and takes
// linkedom's event as one of its own with the same fields.
const NodeEvent = globalThis.Event
class EventTargetForDomEvents extends EventTarget {
  dispatchEvent (event: { type: string, bubbles: boolean, cancelable: boolean }) {
    if (event instanceof NodeEvent) return super.dispatchEvent(event)
    const own = new NodeEvent(event.type, { bubbles: event.bubbles, cancelable: event.cancelable })
    for (const [key, value] of Object.entries(event)) if (!(key in own)) Object.defineProperty(own, key, { value })
    return super.dispatchEvent(own)
  }
}

Object.assign(globalThis, {
  document: dom.document,
  window: dom.window,
  CustomEvent, DocumentFragment, Element, Event, EventTarget: EventTargetForDomEvents, HTMLElement, Node, SVGElement, Text,
})

/**
 * The three browser APIs linkedom does not implement, which any LAID OUT component needs.
 *
 * linkedom is a DOM without a layout engine, so it has no box model: nothing measures, nothing
 * observes a resize, and no element has a position. A component that only reads and writes nodes
 * never notices. A component that MEASURES itself dies, and `@xyflow/react` is the first one here
 * that does: it dies at `new ResizeObserver` before a single assertion runs.
 *
 * These are stubs and they are deliberately CONSTANT rather than clever. A fake box model that
 * returned plausible varying numbers would let a test assert a position, and that assertion would be
 * about this file rather than about the component. So every element reports the same box, the
 * observer fires once with it, and the honest consequence is that pixel geometry is not testable
 * here: what IS testable is which nodes and edges got rendered and what they carry, which is what the
 * trace panel's cases actually ask.
 */
const VIEWPORT = { width: 1200, height: 800 }

class StubResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor (callback: ResizeObserverCallback) { this.callback = callback }
  private readonly reported = new WeakSet<Element>()
  /**
   * Fired ONCE per target, and asynchronously.
   *
   * Both halves are load bearing and both were found the hard way. A real observer reports a size
   * change, and a stub that reports on every `observe` call turns a consumer's
   * measure, set state, re-observe cycle into an unbounded loop: `debug-trace.test.tsx`'s debounced
   * re-trace then never got a turn and the test timed out at 4 s with the panel stuck on its second
   * trace. Synchronous delivery is the other half of that, since it puts the state update inside the
   * caller's own render.
   */
  observe (target: Element) {
    if (this.reported.has(target)) return
    this.reported.add(target)
    setTimeout(() => this.callback(
      [{ target, contentRect: { ...VIEWPORT, top: 0, left: 0, bottom: VIEWPORT.height, right: VIEWPORT.width, x: 0, y: 0 } }] as unknown as ResizeObserverEntry[],
      this as unknown as ResizeObserver,
    ), 0)
  }
  unobserve () {}
  disconnect () {}
}

// linkedom has no CSSOM, so `window.getComputedStyle` is simply absent. xyflow calls it while
// measuring, from inside the deferred observer callback, so the throw lands AFTER the test that
// caused it has passed: vitest reports it as an unhandled error and the run exits non-zero with
// every test green, which is the most misleading shape a failure can take. Empty values are the
// honest answer here, since nothing in this DOM has computed style to report.
if (typeof (dom.window as { getComputedStyle?: unknown }).getComputedStyle !== 'function') {
  const empty = { getPropertyValue: () => '', transform: 'none', width: '0px', height: '0px' }
  Object.assign(dom.window, { getComputedStyle: () => empty })
  Object.assign(globalThis, { getComputedStyle: () => empty })
}

const box = () => ({
  width: VIEWPORT.width, height: VIEWPORT.height,
  top: 0, left: 0, right: VIEWPORT.width, bottom: VIEWPORT.height, x: 0, y: 0,
  toJSON: () => ({}),
})

Object.assign(globalThis, { ResizeObserver: StubResizeObserver })

// node has these on `globalThis` only from 22 behind a flag, and linkedom brings no window timers of
// its own. xyflow schedules its auto-pan on them and CANCELS on unmount, so a missing pair fails at
// teardown rather than at render, which reads as a broken test instead of a missing global.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number,
    cancelAnimationFrame: (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })
}
if (!Element.prototype.getBoundingClientRect) {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', { value: box, writable: true })
}
if (!(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly) {
  // d3-zoom reads a transform off the pane; with no CSSOM there is nothing to read, so it starts at
  // the identity, which is exactly where a freshly mounted graph sits anyway
  Object.assign(globalThis, { DOMMatrixReadOnly: class { m41 = 0; m42 = 0; a = 1; d = 1 } })
}

// imported once the document is in place: preact/compat, which react-intl loads, reads at module scope whether a
// document exists
const { RawIntlProvider } = await import('react-intl')
const i18n = await import('../../../src/i18n')

/** `vnode` under the page's react-intl object, as src/index.tsx renders the page: what a component calling useIntl() needs. */
export const withIntl = (vnode: ComponentChild) => h(RawIntlProvider as ComponentType<{ value: IntlShape }>, { value: i18n.intl }, vnode)

/** Renders into a fresh host element attached to the document, and flushes the render. */
export const mount = (vnode: ComponentChild) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => { render(vnode, host) })
  return host
}

/** Unmounts a tree put up by `mount` and takes its host out of the document. */
export const unmount = (host: HTMLElement) => {
  act(() => { render(null, host) })
  host.remove()
}

/** The button of a rendered tree carrying this label, if there is one. */
export const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find(candidate => candidate.textContent === label)
