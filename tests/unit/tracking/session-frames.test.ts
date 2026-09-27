// The session frame manager over a fake Frame: the page script it evaluates and the port it posts,
// served here over a real MessageChannel by a fake page, one page per document the frame holds, each
// its own realm, where READ_SESSION_INSTALL runs as FKN runs a source string.
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { Frame } from '@fkn/lib'

import { createContext, runInContext, type Context } from 'node:vm'

import { expose } from 'osra'

import { READ_SESSION_INSTALL, SESSION_INSTALL, SESSION_PORT_MESSAGE, createSessionFrames, type ServeArg, type SessionSite } from '../../../src/tracking/session-frames'

type PageApi = { ask: (question: string) => Promise<string> }

const SITE: SessionSite = {
  id: 'anilist',
  url: 'https://anilist.co/terms',
  origin: 'https://anilist.co',
  domains: ['anilist.co'],
  reason: 'Read your list',
  pageScript: 'function (arg) { return "installed" }',
}

const ports: MessagePort[] = []
afterEach(() => { while (ports.length) ports.pop()!.close() })

/**
 * When the document a `goto(url, { waitUntil: 'documentstart' })` brings is reported, as FKN does since
 * fkn-client 5ff7f147. `held`, the cloud: the goto answers before its document commits, a call made
 * meanwhile waits for it, and the commit is reported before that call answers. `load`, the extension:
 * the goto answers once the document started, calls run on it at once, and it is reported on the
 * iframe's load, which the test fires with `load()`. `early`, the extension on a fast page: that load
 * comes before the goto answers. `never`: nothing is reported for it. On the extension a page that
 * moves before its load is `load` with no `load()`: its document is never reported.
 */
type GotoReport = 'held' | 'load' | 'early' | 'never'

const REPORTS: GotoReport[] = ['held', 'load', 'early', 'never']

const newRealm = () => createContext() as Context & Record<symbol, unknown>

const runInPage = (source: string, realm: Context, arg: unknown) =>
  (runInContext(`(${source}\n)`, realm) as (arg: unknown) => unknown)(arg)

/**
 * A Frame whose page serves `ask` over the port its document's install was sent, answering with the
 * number of the document it runs in; a document that left answers nothing, as its port died with it.
 * The page script lands a task after it is evaluated, so a read can find a document before it does.
 * `hang` makes that document's answers wait. `order` records each report and each install as it lands.
 */
const fakeFrame = ({ serve = true, report = 'held' as GotoReport } = {}) => {
  let document = -1
  let realm = newRealm()
  let committed = Promise.resolve()
  const listeners = new Set<(event: { type: 'document', origin: string }) => void>()
  const hanging = new Set<number>()
  const order: string[] = []

  const arrive = () => {
    document++
    realm = newRealm()
  }
  const reportDocument = () => {
    order.push(`document ${document}`)
    for (const listener of [...listeners]) listener({ type: 'document', origin: SITE.origin })
  }
  const serving = () => runInPage(READ_SESSION_INSTALL, realm, SESSION_INSTALL)

  const evaluate = vi.fn(async (source: string, arg: unknown) => {
    await committed
    if (source !== SITE.pageScript) return runInPage(source, realm, arg)
    await new Promise(resolve => setTimeout(resolve))
    realm[Symbol.for(SESSION_INSTALL)] = { key: (arg as ServeArg).key }
    order.push(`install ${document}`)
    return 'installed'
  })
  const installs = () => evaluate.mock.calls.filter(([source]) => source === SITE.pageScript)
  const postMessage = vi.fn(async (message: { type: string, key: string }, _origin: string, transfer: MessagePort[]) => {
    const port = transfer[0]!
    ports.push(port)
    await committed
    const own = document
    if (!serve || message.type !== SESSION_PORT_MESSAGE || message.key !== serving()) return
    void expose<PageApi>({
      ask: async question => {
        if (hanging.has(own) || own !== document) await new Promise(() => {})
        return `${question} from document ${own}`
      },
    }, { transport: port })
  })
  const goto = vi.fn(async (_url: string, _options?: unknown) => {
    if (report === 'held') {
      committed = new Promise(resolve => setTimeout(() => {
        arrive()
        reportDocument()
        resolve()
      }))
      return
    }
    arrive()
    if (report === 'early') reportDocument()
  })
  const addEventListener = vi.fn((_type: 'document', listener: (event: { type: 'document', origin: string }) => void, options?: { signal?: AbortSignal }) => {
    listeners.add(listener)
    options?.signal?.addEventListener('abort', () => listeners.delete(listener))
  })

  return {
    frame: { evaluate, postMessage, goto, addEventListener } as unknown as Frame,
    evaluate,
    /** The page script's evaluates, apart from the reads of which install a document serves. */
    installs,
    postMessage,
    goto,
    listeners,
    order,
    /** The page moved: a new document, and nothing the last install left behind. */
    newDocument: () => {
      arrive()
      reportDocument()
    },
    /** The extension's report of the document the frame already holds, on the iframe's load. */
    load: reportDocument,
    hang: () => hanging.add(document),
  }
}

const setup = ({ serve = true, connectTimeoutMs = 2_000, report = 'held' as GotoReport } = {}) => {
  const page = fakeFrame({ serve, report })
  const removed: number[] = []
  let mounted = 0
  const mount = vi.fn(() => {
    const index = ++mounted
    return { iframe: { index } as unknown as HTMLIFrameElement, remove: () => { removed.push(index) } }
  })
  const attach = vi.fn(async (_options: unknown) => page.frame)
  let keys = 0
  const frames = createSessionFrames<PageApi>([SITE], {
    attach,
    mount,
    connect: port => { ports.push(port); return expose<PageApi>({}, { transport: port }) },
    appOrigin: 'https://anime.fkn.app',
    key: () => `key-${++keys}`,
    connectTimeoutMs,
    callTimeoutMs: 2_000,
  })
  const ask = (question: string) => frames.use('anilist', api => api.ask(question))
  return { ...page, frames, attach, mount, removed, ask }
}

describe('the session frame', () => {
  test('attaches nothing until a session is used', async () => {
    const { attach, mount, ask } = setup()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mount).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()

    await ask('hello')
    expect(mount).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)
  })

  test("attaches a hidden frame on the site's page with the evaluation ask, and installs the page script once", async () => {
    const { attach, goto, evaluate, installs, postMessage, ask } = setup()

    expect(await ask('hello')).toBe('hello from document 0')

    expect(attach).toHaveBeenCalledWith({ iframe: { index: 1 }, domains: ['anilist.co'], permissions: [{ category: 'evaluation', reason: 'Read your list' }] })
    expect(goto).toHaveBeenCalledWith('https://anilist.co/terms', { waitUntil: 'documentstart' })
    expect(installs()).toHaveLength(1)
    expect(evaluate).toHaveBeenCalledWith(SITE.pageScript, { kind: 'serve', appOrigin: 'https://anime.fkn.app', key: 'key-1' })
    expect(postMessage).toHaveBeenCalledTimes(1)
    const [message, origin, transfer] = postMessage.mock.calls[0]!
    expect(message).toEqual({ type: SESSION_PORT_MESSAGE, key: 'key-1' })
    expect(origin).toBe('https://anilist.co')
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBeInstanceOf(MessagePort)

    expect(await ask('again')).toBe('again from document 0')
    expect(installs(), 'the port is reused').toHaveLength(1)
  })

  test('uses that start together share one attach and one install', async () => {
    const { attach, installs, ask } = setup()
    expect(await Promise.all([ask('a'), ask('b'), ask('c')])).toEqual(['a from document 0', 'b from document 0', 'c from document 0'])
    expect(attach).toHaveBeenCalledTimes(1)
    expect(installs()).toHaveLength(1)
  })

  test.each(REPORTS)('every document the frame reports gets exactly one install, and later calls reach the page in it (goto %s)', async report => {
    const { installs, postMessage, newDocument, ask } = setup({ report })
    await ask('first')

    newDocument()
    await vi.waitFor(() => expect(installs(), 'installed on the report, before any call').toHaveLength(2))
    expect(await ask('second')).toBe('second from document 1')
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(installs()[1]![1]).toMatchObject({ key: 'key-2' })

    newDocument()
    expect(await ask('third')).toBe('third from document 2')
    expect(installs()).toHaveLength(3)
  })

  test.each(REPORTS)('a call the next document cut short runs once more on the page installed there (goto %s)', async report => {
    const { hang, newDocument, ask } = setup({ report })
    await ask('warm')
    hang()

    const answer = ask('cut short')
    await new Promise(resolve => setTimeout(resolve, 20))
    newDocument()

    expect(await answer).toBe('cut short from document 1')
  })

  test('reload drops the frame and tells the watchers, and the next use attaches a new one', async () => {
    const { frames, attach, removed, listeners, ask } = setup()
    const watcher = vi.fn()
    frames.watch('anilist', watcher)
    await ask('before')

    frames.reload('anilist')
    expect(watcher).toHaveBeenCalledTimes(1)
    expect(removed).toEqual([1])
    expect(listeners.size, 'the old frame is no longer listened to').toBe(0)

    expect(await ask('after'), "the new frame's goto brought a document of its own").toBe('after from document 1')
    expect(attach).toHaveBeenCalledTimes(2)
  })

  test('a frame that could not attach is tried again on the next use', async () => {
    const { attach, frame, removed, ask } = setup()
    attach.mockRejectedValueOnce(new Error('FKN is not reachable'))

    await expect(ask('first')).rejects.toThrow('FKN is not reachable')
    expect(removed).toEqual([1])
    attach.mockResolvedValue(frame)
    expect(await ask('second')).toBe('second from document 0')
    expect(attach).toHaveBeenCalledTimes(2)
  })

  test('a page that never answers on its port fails by name, and the next use installs again', async () => {
    const { installs, ask } = setup({ serve: false, connectTimeoutMs: 50 })

    await expect(ask('first')).rejects.toThrow('https://anilist.co did not answer')
    await expect(ask('second')).rejects.toThrow('did not answer')
    expect(installs()).toHaveLength(2)
  })
})

describe("the goto's own document is installed once, whenever its report lands", () => {
  test('on the cloud, reported while the first install is held for it', async () => {
    const { installs, postMessage, order, newDocument, ask } = setup({ report: 'held' })

    expect(await ask('first')).toBe('first from document 0')
    // the order FKN's reviewers measured on production, so the fake can express the double install
    expect(order).toEqual(['document 0', 'install 0'])
    expect(installs()).toHaveLength(1)
    expect(postMessage).toHaveBeenCalledTimes(1)

    newDocument()
    expect(await ask('second')).toBe('second from document 1')
    expect(order).toEqual(['document 0', 'install 0', 'document 1', 'install 1'])
  })

  test('on the extension, reported on its load after the first install answered', async () => {
    const { installs, postMessage, order, load, newDocument, ask } = setup({ report: 'load' })

    expect(await ask('first')).toBe('first from document 0')
    load()
    expect(await ask('again')).toBe('again from document 0')
    expect(order).toEqual(['install 0', 'document 0'])
    expect(installs()).toHaveLength(1)
    expect(postMessage).toHaveBeenCalledTimes(1)

    newDocument()
    expect(await ask('second')).toBe('second from document 1')
    expect(installs()).toHaveLength(2)
  })

  test('on the extension, reported before the goto answered, and the next document is still installed', async () => {
    const { installs, order, newDocument, ask } = setup({ report: 'early' })

    expect(await ask('first')).toBe('first from document 0')
    expect(order).toEqual(['document 0', 'install 0'])

    newDocument()
    expect(await ask('second')).toBe('second from document 1')
    expect(installs()).toHaveLength(2)
  })

  test('a page that never reports it is installed on first use, without waiting for a report', async () => {
    const { installs, order, ask } = setup({ report: 'never' })

    expect(await ask('first')).toBe('first from document 0')
    expect(order).toEqual(['install 0'])
    expect(installs()).toHaveLength(1)
  })
})
