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
