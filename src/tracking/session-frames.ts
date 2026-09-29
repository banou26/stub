// A hidden frame per site, holding one of the site's own pages, so stub can ask the site things with
// the viewer's own session: the page's requests carry the site's cookies, which nothing else here can.
// Import free apart from types, so a test drives it with a fake Frame; ./site-sessions.ts wires it to
// the real attachFrame, a real iframe and the built page script.

import type { CategoryRequest, Frame } from '@fkn/lib'

/** The `type` of the message that hands an installed page script its port. */
export const SESSION_PORT_MESSAGE = 'stub:session-port'

/**
 * Where a page script keeps its install on its document's global, `globalThis[Symbol.for(SESSION_INSTALL)]`:
 * an object whose `key` is the key of the port it serves. The frame reads it on every document report,
 * so a document that already serves the current install is not installed again.
 */
export const SESSION_INSTALL = 'stub:session-install'

/**
 * What `evaluate` runs, with `SESSION_INSTALL`, to read the key the frame's document serves: a string,
 * or null in a document with no install. A source string, so nothing a build adds to a function's body
 * travels into the page.
 */
export const READ_SESSION_INSTALL = 'function (name) { const install = globalThis[Symbol.for(name)]; return install && typeof install.key === "string" ? install.key : null }'

/** The arg the page script is evaluated with: serve the session over the port a message with `key` brings. */
export type ServeArg = { kind: 'serve', appOrigin: string, key: string }

/** A site stub keeps one page of open, hidden, for the viewer's session on it. */
export type SessionSite = {
  /** stub's name for the site, which callers ask by: `anilist`. */
  id: string
  /** The page the frame holds. Any page of the site carries the session, so the lightest one. */
  url: string
  /** The page's origin as the site knows it, which the port message is addressed to. */
  origin: string
  /** `attachFrame`'s `domains`. */
  domains: string[]
  /** Why stub asks to run code on the site, for the consent card. */
  reason: string
  /** The page script, a function expression `evaluate` calls with a `ServeArg`, keeping its install at `SESSION_INSTALL`. */
  pageScript: string
}

export type SessionFramesOptions<Api> = {
  attach: (options: { iframe: HTMLIFrameElement, domains: string[], permissions: CategoryRequest[] }) => Promise<Frame>
  /** A new iframe in the document, hidden, and how to take it out again. */
  mount: () => { iframe: HTMLIFrameElement, remove: () => void }
  /** The app's end of a port the page serves on, as osra connects it. */
  connect: (port: MessagePort) => PromiseLike<Api>
  appOrigin: string
  /** A fresh key per install, so a page answers only the port sent for its own install. */
  key: () => string
  /** How long a page may take to answer on a new port. */
  connectTimeoutMs?: number
  /** How long one call may take before its port is given up on. */
  callTimeoutMs?: number
}

/** How `use` may run its call. */
export type UseOptions = {
  /**
   * Never run the call a second time: a call the page's next document cut short rejects with
   * `CallInterrupted` rather than running again. For a write, which may already have reached the site.
   * A page that went away before the call was made (while attaching, installing or connecting) is
   * still tried once more, since nothing was sent to it.
   */
  once?: boolean
}

export type SessionFrames<Api> = {
  /**
   * Runs `call` against the site's page, attaching the frame on the first use. A call the page's next
   * document cut short runs once more on the page installed there, unless `once` says it may not;
   * anything else rejects.
   */
  use: <T>(site: string, call: (api: Api) => Promise<T>, options?: UseOptions) => Promise<T>
  /** Drops the site's frame, so the next use loads the page afresh (after a sign in), and tells the watchers. */
  reload: (site: string) => void
  /** Called after every `reload` of the site. */
  watch: (site: string, listener: () => void) => () => void
}

/** The page a call or an install was talking to went away: another page (or none) holds the frame now. */
class PageGone extends Error {}
/**
 * A `once` call's page went away while the call was running, so whether it reached the site is not
 * known. It is not run again.
 */
export class CallInterrupted extends Error {
  override name = 'CallInterrupted'
}
/** The page did not answer in time, so the port it was given is not trusted again. */
class PageSilent extends Error {}

const deadline = <T>(promise: PromiseLike<T>, ms: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PageSilent(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })

type Install<Api> = {
  key: string
  /** Settles once the page script ran, or failed to, in whichever document it reached. */
  landed: Promise<void>
  api: Promise<Api>
  /** Rejects with PageGone once this install is replaced or dropped. */
  gone: Promise<never>
  retire: () => void
}

type Entry<Api> = {
  frame: Promise<Frame>
  current: Install<Api> | undefined
  controller: AbortController
}

export const createSessionFrames = <Api>(
  sites: readonly SessionSite[],
  { attach, mount, connect, appOrigin, key, connectTimeoutMs = 15_000, callTimeoutMs = 30_000 }: SessionFramesOptions<Api>,
): SessionFrames<Api> => {
  const entries = new Map<string, Entry<Api>>()
  const watchers = new Map<string, Set<() => void>>()

  const siteOf = (id: string) => {
    const site = sites.find(candidate => candidate.id === id)
    if (!site) throw new Error(`There is no session site called ${id}`)
    return site
  }

  // ONE page script per document, since what evaluate installed ends with its document
  const install = (entry: Entry<Api>, site: SessionSite, frame: Frame): Install<Api> => {
    entry.current?.retire()
    const serve: ServeArg = { kind: 'serve', appOrigin, key: key() }
    const { port1, port2 } = new MessageChannel()
    let retire!: () => void
    const gone = new Promise<never>((_resolve, reject) => {
      retire = () => {
        reject(new PageGone('the page changed while stub was asking it'))
        port1.close()
      }
    })
    gone.catch(() => {})
    const evaluated = (async () => { await frame.evaluate(site.pageScript, serve) })()
    const api = (async () => {
      await evaluated
      await frame.postMessage({ type: SESSION_PORT_MESSAGE, key: serve.key }, site.origin, [port2])
      return await deadline(connect(port1), connectTimeoutMs, `${site.origin} did not answer stub's page script`)
    })()
    api.catch(() => {})
    const next = { key: serve.key, landed: evaluated.catch(() => {}), api, gone, retire }
    entry.current = next
    return next
  }

  // A report does not say which document it is for, and the goto's own document can be reported before,
  // during or after the first install, or never (on the extension, a page that moves before its load).
  // So the document is asked which install it serves, once the one in flight has landed.
  const settle = async (entry: Entry<Api>, site: SessionSite, frame: Frame) => {
    for (;;) {
      if (entries.get(site.id) !== entry) return
      const current = entry.current
      await current?.landed
      const serving = await frame.evaluate(READ_SESSION_INSTALL, SESSION_INSTALL).catch(() => null)
      if (entries.get(site.id) !== entry) return
      // an install started during the read may have landed after it, so the read says nothing of it
      if (entry.current !== current) continue
      if (serving !== current?.key) install(entry, site, frame)
      return
    }
  }

  const start = (site: SessionSite): Entry<Api> => {
    const controller = new AbortController()
    const entry: Entry<Api> = { frame: undefined!, current: undefined, controller }
    entry.frame = (async () => {
      const { iframe, remove } = mount()
      controller.signal.addEventListener('abort', remove, { once: true })
      const frame = await attach({ iframe, domains: site.domains, permissions: [{ category: 'evaluation', reason: site.reason }] })
      frame.addEventListener('document', () => { void settle(entry, site, frame) }, { signal: controller.signal })
      await frame.goto(site.url, { waitUntil: 'documentstart' })
      return frame
    })()
    // a frame that could not attach is forgotten, so the next use tries again
    entry.frame.catch(() => {
      if (entries.get(site.id) === entry) entries.delete(site.id)
      controller.abort()
    })
    entries.set(site.id, entry)
    return entry
  }

  const drop = (entry: Entry<Api>, current: Install<Api>) => {
    if (entry.current !== current) return
    current.retire()
    entry.current = undefined
  }

  const use = async <T>(id: string, call: (api: Api) => Promise<T>, { once = false }: UseOptions = {}): Promise<T> => {
    const site = siteOf(id)
    for (let attempt = 0; ; attempt++) {
      const again = attempt === 0
      const entry = entries.get(site.id) ?? start(site)
      const frame = await entry.frame
      // reloaded while attaching: that frame is already on its way out
      if (entries.get(site.id) !== entry) {
        if (again) continue
        throw new PageGone(`${site.origin} was reloaded while stub was asking it`)
      }
      const current = entry.current ?? install(entry, site, frame)
      let api: Api
      try {
        api = await Promise.race([current.api, current.gone])
      } catch (error) {
        if (error instanceof PageGone && again) continue
        // an install that failed is dropped, so the next use installs again rather than failing for good
        drop(entry, current)
        throw error
      }
      try {
        return await Promise.race([deadline(call(api), callTimeoutMs, `${site.origin} did not answer within ${callTimeoutMs / 1000} s`), current.gone])
      } catch (error) {
        if (error instanceof PageGone && once) {
          throw new CallInterrupted(`${site.origin} changed while stub's call was running, so whether it arrived is not known`)
        }
        if (error instanceof PageGone && again) continue
        if (error instanceof PageSilent) drop(entry, current)
        throw error
      }
    }
  }

  const reload = (id: string) => {
    const entry = entries.get(id)
    if (entry) {
      entries.delete(id)
      entry.current?.retire()
      entry.controller.abort()
    }
    for (const listener of watchers.get(id) ?? []) listener()
  }

  const watch = (id: string, listener: () => void) => {
    const set = watchers.get(id) ?? new Set()
    watchers.set(id, set)
    set.add(listener)
    return () => { set.delete(listener) }
  }

  return { use, reload, watch }
}
