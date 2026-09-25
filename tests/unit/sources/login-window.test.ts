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

describe('leaving the sign-in page', () => {
  const watch = ({ onSignInPage, isSignedIn = async () => false, readTimeoutMs }: {
    onSignInPage: () => Promise<boolean>
    isSignedIn?: () => Promise<boolean>
    readTimeoutMs?: number
  }) => signInThroughWindow({ url: LOGIN_URL, domains: DOMAINS, isSignedIn, onSignInPage, pollMs: 1, readTimeoutMs })

  const answers = (...values: boolean[]) => {
    const read = vi.fn<() => Promise<boolean>>()
    for (const value of values) read.mockResolvedValueOnce(value)
    return read.mockResolvedValue(values.at(-1)!)
  }

  const hang = () => new Promise<boolean>(() => {})

  const settled = <T,>(pending: Promise<T>, ms = 500) => Promise.race([pending, sleep(ms).then(() => 'still waiting' as const)])

  // 'still open' once `read` has run `times` times, unless the sign-in resolved first
  const openAfter = <T,>(pending: Promise<T>, read: { mock: { calls: unknown[] } }, times: number) => Promise.race([
    pending,
    vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThanOrEqual(times)).then(() => 'still open' as const),
  ])

  // the page a sign-in lands on may never answer the signed-in marker, and this still closes it
  test('the page going away after it was seen closes the window, committed, and resolves authed', async () => {
    const { login, close, events } = fakeWindow({ commitMs: 20 })
    attach.mockResolvedValue(login)
    const onSignInPage = answers(true, true, false, false)

    const outcome = await settled(watch({ onSignInPage }).then(result => {
      events.push(`resolved ${result}`)
      return result
    }))

    expect(outcome).toBe('authed')
    expect(onSignInPage).toHaveBeenCalledTimes(4)
    expect(onSignInPage).toHaveBeenCalledWith(login)
    expect(close).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['committed and closed', 'resolved authed'])
  })

  test('a form that stays, as after a failed sign-in, keeps the window open', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn(async () => true)

    const pending = watch({ onSignInPage })
    expect(await openAfter(pending, onSignInPage, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  // a re-render mid submit can drop the form for one read
  test('one read without the form, between reads with it, does not count', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    let reads = 0
    const onSignInPage = vi.fn(async () => reads++ % 2 === 0)

    const pending = watch({ onSignInPage })
    expect(await openAfter(pending, onSignInPage, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  // the window loads the site after it connects, so the first reads can find no sign-in page yet
  test('a sign-in page never seen is never left', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn(async () => false)

    const pending = watch({ onSignInPage })
    expect(await openAfter(pending, onSignInPage, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  test('a stalled read does not hold the poll', async () => {
    const { login, close } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = vi.fn(hang)
    const onSignInPage = answers(true, false, false)

    expect(await settled(watch({ onSignInPage, isSignedIn, readTimeoutMs: 10 }))).toBe('authed')
    expect(onSignInPage).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(1)
  })

  // a read on the lib's own retry proves nothing about where the window is
  test('reads that stall after the page was seen do not count as leaving it', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(true).mockImplementation(hang)

    const pending = watch({ onSignInPage, readTimeoutMs: 5 })
    expect(await openAfter(pending, onSignInPage, 10)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  // what fkn.app answered on 2026-09-26 once a page had left for another host through a redirect, a
  // link or a form, every second for 30 s, inline and in a window alike
  const unreachable = () => Object.assign(
    new Error('Locator operation not supported on the render proxy backend: the proxied document is not available yet'),
    { name: LOCATOR_UNSUPPORTED },
  )

  test('a page that can no longer be read after it was seen closes the window, committed, and resolves authed', async () => {
    expect(isTerminalError(unreachable()), 'control: the lib stops on this error rather than retrying it').toBe(true)
    const { login, close, events } = fakeWindow({ commitMs: 20 })
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementation(() => Promise.reject(unreachable()))

    const outcome = await settled(watch({ onSignInPage }).then(result => {
      events.push(`resolved ${result}`)
      return result
    }))

    expect(outcome).toBe('authed')
    expect(onSignInPage).toHaveBeenCalledTimes(4)
    expect(close).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['committed and closed', 'resolved authed'])
  })

  test('one read that rejects, between reads that find the page, does not count', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    let reads = 0
    const onSignInPage = vi.fn(() => reads++ % 2 === 0 ? Promise.resolve(true) : Promise.reject(unreachable()))

    const pending = watch({ onSignInPage })
    expect(await openAfter(pending, onSignInPage, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  // the window loads the site after it connects, and a page that redirects away at once is never readable
  test('reads that reject before the page was seen prove nothing', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn(() => Promise.reject(unreachable()))

    const pending = watch({ onSignInPage })
    expect(await openAfter(pending, onSignInPage, 20)).toBe('still open')
    expect(close).not.toHaveBeenCalled()

    end()
    expect(await settled(pending)).toBe('closed')
  })

  // the lib ends the window and rejects the reads in flight from one abort
  test('the viewer closing the window after the page went away resolves closed, and closes nothing', async () => {
    const { login, close, end } = fakeWindow()
    attach.mockResolvedValue(login)
    const onSignInPage = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => Promise.reject(unreachable()))
      .mockImplementation(() => {
        end()
        return Promise.reject(unreachable())
      })

    expect(await settled(watch({ onSignInPage }))).toBe('closed')
    expect(close).not.toHaveBeenCalled()
  })

  test('the signed-in marker still resolves authed while the sign-in page stays', async () => {
    const { login, close } = fakeWindow()
    attach.mockResolvedValue(login)
    const isSignedIn = answers(false, false, true)

    expect(await settled(watch({ onSignInPage: async () => true, isSignedIn }))).toBe('authed')
    expect(isSignedIn).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
