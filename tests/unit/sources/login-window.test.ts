import type { WindowFrame } from '@fkn/lib'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

// the real lib, with only the window opener replaced: the error classes and isTerminalError below are
// the lib's own, so a renamed error or a changed terminal name fails here rather than in a browser
const attach = vi.hoisted(() => vi.fn())
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: attach,
}))

const {
  ExtensionOperationUnsupportedError,
  FrameWindowBlockedError,
  FrameWindowRefusedError,
  LOCATOR_DENIED,
  LOCATOR_UNSUPPORTED,
  isTerminalError,
} = await import('@fkn/lib')
const { signInThroughWindow } = await import('../../../src/sources/login-window')

const LOGIN_URL = 'https://sso.crunchyroll.com/authorize?state=%2F'
const DOMAINS = ['www.crunchyroll.com', 'sso.crunchyroll.com']

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// what a WindowFrame promises about ending: `closed` resolves once, whoever ends it, and `close()`
// resolves only after the cookie commit it waits on, which is what `commitMs` stands in for
const fakeWindow = ({ commitMs = 0 } = {}) => {
  const events: string[] = []
  let end!: () => void
  const closed = new Promise<void>(resolve => { end = resolve })
  const close = vi.fn(async () => {
    await sleep(commitMs)
    events.push('committed and closed')
    end()
  })
  return { login: { closed, close } as unknown as WindowFrame, close, end, events }
}

const signIn = (isSignedIn: () => Promise<boolean>) =>
  signInThroughWindow({ url: LOGIN_URL, domains: DOMAINS, isSignedIn, pollMs: 1 })

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  attach.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('opening the window', () => {
  // the browser only opens a window while the click's activation is current, so the lib call has to
  // happen inside the caller's own stack: a single await in front of it loses the window
  test('calls attachFrame before anything is awaited', () => {
    attach.mockReturnValue(new Promise(() => {}))
    void signIn(async () => false)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith({ window: { url: LOGIN_URL }, domains: DOMAINS })
  })

  test('a blocked window resolves blocked', async () => {
    attach.mockRejectedValue(new FrameWindowBlockedError())
    expect(await signIn(async () => false)).toBe('blocked')
  })

  test.each([
    ['the extension backend', () => new ExtensionOperationUnsupportedError('attachWindow', 3, 'window mode is served by the cloud backend')],
    ['the window itself', () => new FrameWindowRefusedError('jar-unreachable')],
  ])('a window mode refusal by %s resolves unsupported and opens nothing else', async (_, refusal) => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const isSignedIn = vi.fn(async () => false)
    attach.mockRejectedValue(refusal())

    expect(await signIn(isSignedIn)).toBe('unsupported')
    expect(attach).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(isSignedIn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('a window that closes before it connects resolves closed', async () => {
    // the lib's own shape for it: a plain Error carrying the terminal locator name
    const gone = Object.assign(new Error('cloud.attachFrame: the window closed before it connected'), { name: LOCATOR_UNSUPPORTED })
    expect(isTerminalError(gone), 'control: the lib reads this as its terminal detach error').toBe(true)
    attach.mockRejectedValue(gone)
    expect(await signIn(async () => false)).toBe('closed')
  })

  test('any other failure to open rejects, rather than passing for a closed window', async () => {
    attach.mockRejectedValue(new Error('cloud.attachFrame: timed out connecting to the window'))
    await expect(signIn(async () => false)).rejects.toThrow('timed out connecting')
  })
})

describe('waiting for the sign-in', () => {
  test('the signed-in marker resolves authed, after the window is closed and its cookies committed', async () => {
    const { login, close, events } = fakeWindow({ commitMs: 20 })
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)

    const outcome = await signIn(isSignedIn).then(result => {
      events.push(`resolved ${result}`)
      return result
    })

    expect(outcome).toBe('authed')
    expect(isSignedIn).toHaveBeenCalledTimes(3)
    expect(isSignedIn).toHaveBeenCalledWith(login)
    expect(close).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['committed and closed', 'resolved authed'])
  })

  // the SSO page and the site's callback replace the document, and reads across that reject
  test('a read that rejects mid redirect keeps the poll going', async () => {
    const { login } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('the document went away'))
      .mockRejectedValueOnce(new Error('the document went away'))
      .mockResolvedValue(true)

    expect(await signIn(isSignedIn)).toBe('authed')
    expect(isSignedIn).toHaveBeenCalledTimes(3)
  })

  test('the viewer closing the window first resolves closed, and closes nothing', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn(async () => false)

    const pending = signIn(isSignedIn)
    await vi.waitFor(() => expect(isSignedIn).toHaveBeenCalled())
    end()

    expect(await Promise.race([pending, sleep(500).then(() => 'still waiting')])).toBe('closed')
    expect(close).not.toHaveBeenCalled()
  })

  // a read can sit on the lib's own retry for tens of seconds, which must not hold the outcome
  test('a close still ends it while a read is hanging', async () => {
    const { login, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn(() => new Promise<boolean>(() => {}))

    const pending = signIn(isSignedIn)
    await vi.waitFor(() => expect(isSignedIn).toHaveBeenCalled())
    end()

    expect(await Promise.race([pending, sleep(500).then(() => 'still waiting')])).toBe('closed')
  })
})

describe('only the signed-in marker closes the window', () => {
  const watch = (isSignedIn: () => Promise<boolean>, readTimeoutMs?: number) =>
    signInThroughWindow({ url: LOGIN_URL, domains: DOMAINS, isSignedIn, pollMs: 1, readTimeoutMs })

  const hang = () => new Promise<boolean>(() => {})

  const settled = <T,>(pending: Promise<T>, ms = 500) => Promise.race([pending, sleep(ms).then(() => 'still waiting' as const)])

  // 'still open' once `read` has run `times` times, unless the sign-in resolved first
  const openAfter = <T,>(pending: Promise<T>, read: { mock: { calls: unknown[] } }, times: number) => Promise.race([
    pending,
    vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThanOrEqual(times)).then(() => 'still open' as const),
  ])

  // what fkn.app answers since 2026-09-27 for a page that moved itself to a host outside the domains
  const denied = () => Object.assign(
    new Error('frame: this frame no longer holds the document the app attached it to'),
    { name: LOCATOR_DENIED },
  )
  // what it answered on 2026-09-26 for any page that had moved itself to another host
  const unreachable = () => Object.assign(
    new Error('Locator operation not supported on the render proxy backend: the proxied document is not available yet'),
    { name: LOCATOR_UNSUPPORTED },
  )

  test.each([
    ['outside the domains', denied],
    ['on a host the frame did not follow', unreachable],
  ])('a page that can no longer be read never closes the window: refused %s', async (_, refusal) => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn(() => Promise.reject(refusal()))

    const pending = watch(isSignedIn)
    expect(await openAfter(pending, isSignedIn, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  test('the window closes once the signed-in marker reads true after reads were rejected', async () => {
    const { login, close, events } = fakeWindow({ commitMs: 20 })
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn<() => Promise<boolean>>()
    for (let read = 0; read < 5; read++) isSignedIn.mockRejectedValueOnce(read % 2 ? unreachable() : denied())
    isSignedIn.mockResolvedValue(true)

    const outcome = await settled(watch(isSignedIn).then(result => {
      events.push(`resolved ${result}`)
      return result
    }))

    expect(outcome).toBe('authed')
    expect(isSignedIn).toHaveBeenCalledTimes(6)
    expect(close).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['committed and closed', 'resolved authed'])
  })

  test('a stalled read does not hold the poll', async () => {
    const { login, close } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(hang)
      .mockImplementationOnce(hang)
      .mockResolvedValue(true)

    expect(await settled(watch(isSignedIn, 10))).toBe('authed')
    expect(isSignedIn).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
