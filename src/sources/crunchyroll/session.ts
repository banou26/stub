// Where the viewer signs in to Crunchyroll, and the hosts that session crosses. Import free apart from
// types, so the player and the settings page share one copy.

import type { Frame } from '@fkn/lib'

export const CRUNCHYROLL_DOMAINS = [
  'www.crunchyroll.com',
  'crunchyroll.com',
  'sso.crunchyroll.com',
  'static.crunchyroll.com'
]

export const CRUNCHYROLL_BASE_URL = 'https://www.crunchyroll.com'

export const CRUNCHYROLL_ICON = 'https://static.crunchyroll.com/cxweb/assets/img/favicons/favicon-96x96.png'

/** The tracker reading the viewer's Crunchyroll history, and its session frame: the Crunchyroll source's own origin. */
export const CRUNCHYROLL_TRACKER_ID = 'cr'

/** The page the tracker's hidden session frame holds, the empty page the sign-in check asks from on the cloud. */
export const CRUNCHYROLL_SESSION_URL = `${CRUNCHYROLL_BASE_URL}/`

/** crunchyroll.com's own client id for a signed-in account, its pages' `cxApiParams.accountAuthClientId`. */
export const CRUNCHYROLL_SSO_CLIENT_ID = 'noaihdevm_6iyg0a8l0q'
// state '/': returning the sign-in popup or window to the episode would start a second player there
export const CRUNCHYROLL_LOGIN_URL = `https://sso.crunchyroll.com/authorize?${new URLSearchParams({
  client_id: CRUNCHYROLL_SSO_CLIENT_ID,
  redirect_uri: `${CRUNCHYROLL_BASE_URL}/callback`,
  response_type: 'cookie',
  state: '/',
})}`

/** Whether the page in a sign-in window shows the signed-in menu. A free read, so the poll never prompts. */
export const crunchyrollSignedIn = (login: Frame) => login.locator('#user-menu-authenticated').exists()
