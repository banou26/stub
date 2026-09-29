// Where stub keeps the viewer's myanimelist.net session open, and how it tells that someone signed in
// there. Import free apart from types, so tracking/site-sessions.ts wires these and a test pins them.

import type { Frame } from '@fkn/lib'

export const MAL_ORIGIN = 'https://myanimelist.net'

/**
 * `attachFrame`'s domains, which are the hosts stub may READ in the frame. The sign-in page's reCAPTCHA
 * and the single sign-on sites are not listed: a subresource on another host loads through the render
 * proxy anyway (as Cloudflare's challenge did for AniList with `['anilist.co']`), and a read while the
 * window is on another site is refused, which the sign-in poll counts as not signed in yet.
 */
export const MAL_DOMAINS = ['myanimelist.net']

/**
 * The sign-in form MyAnimeList's own header links to (`login.php?from=%2Fabout.php`, measured on
 * about.php 2026-09-29), so the window lands on the 41 KB about page once signed in rather than the
 * 163 KB home page.
 */
export const MAL_LOGIN_URL = 'https://myanimelist.net/login.php?from=%2Fabout.php'

/**
 * The page the hidden session frame holds: the anime hover fragment, 978 bytes of text/html with no
 * script (measured 2026-09-29). Every full page loads about 1.5 MB of scripts, ads and reCAPTCHA.
 *
 * It has to be text/html: the render proxy injects its runtime, which `evaluate` runs in, into any
 * HTML document (at the implied head when there is no `<head>`), and passes every other type through
 * untouched (fkn-client efdcbdf7, mirage/src/fetch/rewrite-response-body.ts:208-211,230-233 and
 * mirage/src/rewrite/html/rewrite-html.ts:111-129), so a JSON endpoint or robots.txt could not host
 * the page script. If the fragment does not take the install, `/about.php` is the fallback.
 */
export const MAL_SESSION_URL = 'https://myanimelist.net/includes/ajax.inc.php?t=64&id=1'

/** The header's Login link, drawn for a guest (measured on login.php and about.php signed out, 2026-09-29). */
export const GUEST_MARKER = 'a#malLogin'

/**
 * Whether the page in the sign-in window is signed in.
 *
 * The guest marker is a free read, so the poll costs nothing while the header offers a Login. Once it
 * is gone, the page script says whether the page names a viewer (`window.MAL.USER_NAME`), which is also
 * false on a page that is not MyAnimeList's.
 */
export const malSignedIn = async (login: Frame, pageScript: string): Promise<boolean> =>
  !(await login.locator(GUEST_MARKER).exists())
  && await login.evaluate(pageScript, { kind: 'viewer' }) === true
