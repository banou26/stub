// Where stub keeps the viewer's anilist.co session open, and how it tells that someone signed in there.
// Import free apart from types, so tracking/site-sessions.ts wires these and a test pins them.

import type { Frame } from '@fkn/lib'

export const ANILIST_ORIGIN = 'https://anilist.co'
export const ANILIST_DOMAINS = ['anilist.co']
export const ANILIST_LOGIN_URL = 'https://anilist.co/login'

/**
 * The page the hidden session frame holds. The site renders it server side, 1.8 KB with no app of its
 * own, where every other anilist.co page is the same 4.5 KB shell that boots the whole Vue app and its
 * own Viewer query (measured with curl, 2026-09-27). Its requests carry the session cookie as any
 * page's do, and the CSRF token it does not carry is read from the home page by the page script.
 */
export const ANILIST_SESSION_URL = 'https://anilist.co/terms'

/**
 * What anilist.co's nav draws for a signed-in viewer. `#nav` holds `.wrap` with the avatar's
 * `.user-wrap` when the site's `auth` getter answers, and `.wrap.guest` with a Login link otherwise
 * (the nav template in main.1dc97617.js, 2026-09-27).
 */
export const SIGNED_IN_MARKER = '#nav .user-wrap'

/**
 * Whether the page in the sign-in window is signed in.
 *
 * The nav marker is a free read, so the poll costs nothing until it shows. It is not enough alone: the
 * nav draws from a copy of the viewer the site keeps in localStorage, which can outlive the session
 * until the site's own Viewer query fails. So once it shows, the site is asked for its Viewer through
 * the page script, the same code the session frame runs.
 */
export const anilistSignedIn = async (login: Frame, pageScript: string): Promise<boolean> =>
  await login.locator(SIGNED_IN_MARKER).exists()
  && await login.evaluate(pageScript, { kind: 'viewer' }) === true
