import { parseHTML } from 'linkedom'
import { createContext, runInContext } from 'node:vm'

type Rect = { left: number, top: number, width: number, height: number }

/**
 * A stand-in for Crunchyroll's page, running page functions the way `frame.evaluate` does.
 *
 * The function is compiled from its SOURCE, as `'(' + source + '\n)'` (the render proxy's
 * `evaluate` in proxy-sandbox's locator-modules.ts), inside a vm context whose only globals are a
 * page's. So one that reaches for an import or a constant of its module throws a ReferenceError
 * here, as it would on crunchyroll.com, where calling it in place would pass. The argument and the
 * result go through `structuredClone`, and a thrown error comes back rebuilt from its name and
 * message, as both backends answer it.
 *
 * linkedom has no MouseEvent or PointerEvent and lays nothing out: both events are Event subclasses
 * that carry their init fields, and `place` gives an element a box. Its own Event is named
 * GlobalEvent, so it is subclassed once to read as `Event` in a recording. Its inputs do not reflect
 * `min` and `max` as properties, so the ones in `html` are given that here. What the page hands to
 * `reportError` lands in `reported`.
 */
export const pageRealm = (html: string) => {
  const { document, window, Event: LinkedomEvent, HTMLElement, HTMLInputElement } = parseHTML(html)
  for (const input of document.querySelectorAll('input')) {
    for (const name of ['min', 'max']) {
      Object.defineProperty(input, name, { configurable: true, get: () => input.getAttribute(name) ?? '' })
    }
  }

  class Event extends LinkedomEvent {}
  class MouseEvent extends Event {
    constructor (type: string, { bubbles, cancelable, composed, ...fields }: Record<string, unknown> = {}) {
      super(type, { bubbles, cancelable, composed } as EventInit)
      Object.assign(this, fields)
    }
  }
  class PointerEvent extends MouseEvent {}

  const reported: unknown[] = []
  const context = createContext({
    document, window, Event, MouseEvent, PointerEvent, HTMLElement, HTMLInputElement, setTimeout, clearTimeout,
    reportError: (error: unknown) => { reported.push(error) },
  })

  const evaluate = async <R, A>(pageFunction: ((arg: A) => R | Promise<R>) | string, arg?: A): Promise<Awaited<R>> => {
    const source = typeof pageFunction === 'function' ? pageFunction.toString() : pageFunction
    let value: unknown
    try {
      const compiled = runInContext(`(${source}\n)`, context)
      value = await (typeof compiled === 'function' ? compiled(structuredClone(arg)) : compiled)
    } catch (error) {
      const { name, message } = error as Error
      throw Object.assign(new Error(message), { name })
    }
    return structuredClone(value) as Awaited<R>
  }

  const place = (element: Element, rect: Rect) => {
    element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }) as DOMRect
  }

  return { document: document as unknown as Document, evaluate, place, reported }
}

/** Every event an element receives, as `Constructor:type`, with the pointer position it carried. */
export const recordEvents = (element: Element) => {
  const seen: { event: string, clientX?: number, clientY?: number }[] = []
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'input', 'change']) {
    element.addEventListener(type, event => {
      const { clientX, clientY } = event as MouseEvent
      seen.push({ event: `${event.constructor.name}:${type}`, ...(clientX === undefined ? {} : { clientX, clientY }) })
    })
  }
  return seen
}
