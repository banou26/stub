// How the sign-in window tells that someone signed in to app.trakt.tv: the header's free guest marker
// first, then Trakt's own answer about the session's token through the page script.
import { describe, expect, test, vi } from 'vite-plus/test'

import type { Frame } from '@fkn/lib'

import { GUEST_MARKER, TRAKT_SESSION_URL, traktSignedIn } from '../../../../src/sources/trakt/session'

const PAGE_SCRIPT = 'function (arg) { return arg }'

const loginWindow = ({ guest, viewer }: { guest: boolean, viewer: boolean }) => {
  const exists = vi.fn(async () => guest)
  const locator = vi.fn((_selector: string) => ({ exists }))
  const evaluate = vi.fn(async (_source: string, _arg: unknown) => viewer)
  return { login: { locator, evaluate } as unknown as Frame, locator, evaluate }
}

test('hidden session frame uses lightweight robots.txt on app.trakt.tv', () => {
  expect(TRAKT_SESSION_URL).toBe('https://app.trakt.tv/robots.txt')
})

describe('whether the sign-in window is signed in', () => {
  test('costs one free read, and runs nothing in the page, while the header offers Sign in', async () => {
    const { login, locator, evaluate } = loginWindow({ guest: true, viewer: true })

    expect(await traktSignedIn(login, PAGE_SCRIPT)).toBe(false)
    expect(locator).toHaveBeenCalledWith('.trakt-login-button')
    expect(GUEST_MARKER).toBe('.trakt-login-button')
    expect(evaluate).not.toHaveBeenCalled()
  })

  test('asks the page whether Trakt knows the session once Sign in is gone', async () => {
    const signedIn = loginWindow({ guest: false, viewer: true })
    expect(await traktSignedIn(signedIn.login, PAGE_SCRIPT)).toBe(true)
    expect(signedIn.evaluate).toHaveBeenCalledWith(PAGE_SCRIPT, { kind: 'viewer' })

    const nobody = loginWindow({ guest: false, viewer: false })
    expect(await traktSignedIn(nobody.login, PAGE_SCRIPT)).toBe(false)
  })
})
