// How the sign-in window tells that someone signed in to myanimelist.net: the header's free guest
// marker first, then the page's own USER_NAME through the page script.
import { describe, expect, test, vi } from 'vitest'

import type { Frame } from '@fkn/lib'

import { GUEST_MARKER, malSignedIn } from '../../../../src/sources/mal/session'

const PAGE_SCRIPT = 'function (arg) { return arg }'

const loginWindow = ({ guest, viewer }: { guest: boolean, viewer: boolean }) => {
  const exists = vi.fn(async () => guest)
  const locator = vi.fn((_selector: string) => ({ exists }))
  const evaluate = vi.fn(async (_source: string, _arg: unknown) => viewer)
  return { login: { locator, evaluate } as unknown as Frame, locator, evaluate }
}

describe('whether the sign-in window is signed in', () => {
  test('costs one free read, and runs nothing in the page, while the header offers a Login', async () => {
    const { login, locator, evaluate } = loginWindow({ guest: true, viewer: true })

    expect(await malSignedIn(login, PAGE_SCRIPT)).toBe(false)
    expect(locator).toHaveBeenCalledWith('a#malLogin')
    expect(GUEST_MARKER).toBe('a#malLogin')
    expect(evaluate).not.toHaveBeenCalled()
  })

  test('asks the page whether it names a viewer once the Login link is gone', async () => {
    const signedIn = loginWindow({ guest: false, viewer: true })
    expect(await malSignedIn(signedIn.login, PAGE_SCRIPT)).toBe(true)
    expect(signedIn.evaluate).toHaveBeenCalledWith(PAGE_SCRIPT, { kind: 'viewer' })

    // a page with no Login link that names nobody: another site's, or one of MyAnimeList's with no header
    const nobody = loginWindow({ guest: false, viewer: false })
    expect(await malSignedIn(nobody.login, PAGE_SCRIPT)).toBe(false)
  })
})
