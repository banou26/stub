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
