// How the sign-in window tells that someone signed in to anilist.co: the nav's free marker first, then
// the site's own Viewer through the page script.
import { describe, expect, test, vi } from 'vitest'

import type { Frame } from '@fkn/lib'

import { SIGNED_IN_MARKER, anilistSignedIn } from '../../../../src/sources/anilist/session'

const PAGE_SCRIPT = 'function (arg) { return arg }'

const loginWindow = ({ marker, viewer }: { marker: boolean, viewer: boolean }) => {
  const exists = vi.fn(async () => marker)
  const locator = vi.fn((_selector: string) => ({ exists }))
  const evaluate = vi.fn(async (_source: string, _arg: unknown) => viewer)
  return { login: { locator, evaluate } as unknown as Frame, locator, evaluate }
}

describe('whether the sign-in window is signed in', () => {
  test('costs one free read, and runs nothing in the page, while the nav shows a guest', async () => {
    const { login, locator, evaluate } = loginWindow({ marker: false, viewer: true })

    expect(await anilistSignedIn(login, PAGE_SCRIPT)).toBe(false)
    expect(locator).toHaveBeenCalledWith(SIGNED_IN_MARKER)
    expect(evaluate).not.toHaveBeenCalled()
  })

  test("asks the site for its Viewer once the nav shows one, so a copy the site kept of an old session does not count", async () => {
    const stale = loginWindow({ marker: true, viewer: false })
    expect(await anilistSignedIn(stale.login, PAGE_SCRIPT)).toBe(false)
    expect(stale.evaluate).toHaveBeenCalledWith(PAGE_SCRIPT, { kind: 'viewer' })

    const signedIn = loginWindow({ marker: true, viewer: true })
    expect(await anilistSignedIn(signedIn.login, PAGE_SCRIPT)).toBe(true)
  })
})
