// Where the viewer signs in to Prime Video, and the hosts its playback crosses. Import free apart from
// types, so the player and the settings page share one copy.

import type { Frame } from '@fkn/lib'

// every host a Prime Video playback crossed in a signed-in Chrome on 2026-10-12, with the detail
// page's own host by name, since a page is read only on a host named exactly
export const PRIME_DOMAINS = [
  'amazon.co.jp',
  'www.amazon.co.jp',
  'amazon.com',
  'media-amazon.com',
  'ssl-images-amazon.com',
  'aiv-cdn.net',
  'pv-cdn.net',
  'aiv-delivery.net',
  'a2z.com',
  'prime-video.amazon.dev',
]

// the header sign-in link of Prime Video's storefront, which returns there (measured 2026-10-13). Returned
// to the shop's home instead, FKN's cloud window stayed white after a sign-in and never closed by itself
// (2026-10-13).
export const PRIME_SIGN_IN_URL = `https://www.amazon.co.jp/ap/signin?${new URLSearchParams({
  'openid.return_to': 'https://www.amazon.co.jp/gp/video/storefront',
  'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.assoc_handle': 'jpflex',
  'openid.mode': 'checkid_setup',
  'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.ns': 'http://specs.openid.net/auth/2.0',
})}`

/**
 * amazon.co.jp's header sign-in link, there only when signed out: a link inside the header's
 * `#nav-link-accountList` div, which carries `nav_youraccount_btn` once signed in (both measured on the Prime
 * Video detail page 2026-10-13).
 */
export const PRIME_SIGN_IN_LINK = 'a[data-csa-c-content-id="nav_ya_signin"]'

/** Whether a sign-in window shows Amazon's header signed in. Free reads, so the poll never prompts. */
export const primeSignedIn = async (login: Frame) =>
  await login.locator('#nav-link-accountList').exists() && !await login.locator(PRIME_SIGN_IN_LINK).exists()
