import type { Frame } from '@fkn/lib'

const LOGIN_TIMEOUT = 30_000

/**
 * Whether the viewer is signed in to Crunchyroll, read from a watch page from its first bytes on.
 *
 * `#user-menu-authenticated` decides at once. `#user-menu-anonymous` does not: the server streams it
 * into every page, signed in or not, beside `.shell-header`, which the client removes once it has
 * resolved the session, putting the real menu in. So the anonymous menu decides only after the shell
 * has been seen and has gone, and the shell is read first so the menus read after it are the client's.
 * Traced through the relay on 2026-09-26, the shell stood about 2 s either way (signed in +3.9 s to
 * +5.6 s, signed out +3.3 s to +5.2 s). At the deadline an anonymous menu without the shell counts as
 * signed out, and anything else throws.
 */
export const checkIsLoggedIn = async (frame: Frame, isCancelled: () => boolean) => {
  const deadline = Date.now() + LOGIN_TIMEOUT
  let shellSeen = false
  while (!isCancelled()) {
    const shell = await frame.locator('.shell-header').exists()
    shellSeen ||= shell
    const [isLoggedOut, isLoggedIn] = await Promise.all([
      frame.locator('#user-menu-anonymous').exists(),
      frame.locator('#user-menu-authenticated').exists()
    ])
    if (isCancelled()) break
    if (isLoggedIn) return { isLoggedIn, isLoggedOut: false }
    const expired = Date.now() >= deadline
    if (isLoggedOut && !shell && (shellSeen || expired)) return { isLoggedIn, isLoggedOut }
    if (expired) break
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Login state check timed out')
}
