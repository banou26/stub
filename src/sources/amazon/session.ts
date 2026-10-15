// Where the viewer signs in to Prime Video, and the hosts its playback crosses. It imports only the
// country module, so the player, the settings page, playable.ts and the JustWatch source share one copy.

import type { Frame } from '@fkn/lib'

import { viewerCountry } from '../country'

// every host a Prime Video playback crossed in a signed-in Chrome on 2026-10-12, on amazon.co.jp, and
// the other Prime Video sites, each page's own host by name, since a page is read only on a host named
// exactly. JustWatch's primevideo.com links are on app.primevideo.com, which opens www.primevideo.com.
export const PRIME_DOMAINS = [
  'amazon.co.jp',
  'www.amazon.co.jp',
  'amazon.com',
  'www.amazon.com',
  'amazon.co.uk',
  'www.amazon.co.uk',
  'amazon.de',
  'www.amazon.de',
  'primevideo.com',
  'www.primevideo.com',
  'app.primevideo.com',
  'media-amazon.com',
  'ssl-images-amazon.com',
  'aiv-cdn.net',
  'pv-cdn.net',
  'aiv-delivery.net',
  'a2z.com',
  'prime-video.amazon.dev',
]

// the four Amazon sites with a Prime Video of their own; every other country's links are on
// primevideo.com (JustWatch's links over 16 countries, 2026-10-15). The US territories are amazon.com's
// too, and JustWatch keeps no catalogue of theirs, so they are asked the US's.
const PRIME_SITES: Readonly<Record<string, string | undefined>> = {
  US: 'amazon.com', PR: 'amazon.com', GU: 'amazon.com', VI: 'amazon.com', AS: 'amazon.com', MP: 'amazon.com', UM: 'amazon.com',
  GB: 'amazon.co.uk', DE: 'amazon.de', AT: 'amazon.de', JP: 'amazon.co.jp',
}

/** The Prime Video site of a viewer in `country`, as a bare domain: `amazon.de`, `primevideo.com`. */
export const primeSiteFor = (country: string) => PRIME_SITES[country] ?? 'primevideo.com'

/** The site a Prime Video link is on, as `primeSiteFor` names it: `watch.amazon.de` is `amazon.de`. Undefined for no url. */
export const primeSiteOf = (url: string) => URL.parse(url)?.hostname.replace(/^(www|watch|app)\./, '')

/** Whether a Prime Video link is on the viewer's own country's site, the one catalogue their account plays. */
export const isViewersPrime = (url: string) => primeSiteOf(url) === primeSiteFor(viewerCountry())

/**
 * Whether stub plays `site`'s Prime Video on FKN's cloud; with the extension it plays every site. A Prime
 * Video site picks its region from the connection, which on the cloud is a relay in Prague or Hong Kong,
 * and only amazon.co.jp is known to play through one (Hong Kong).
 */
export const primePlaysOnCloud = (site: string | undefined) => site === 'amazon.co.jp'

// amazon.co.jp's is its storefront's header sign-in link, the one signed in through (2026-10-13): back on
// the shop's home instead, FKN's cloud window stayed white after a sign-in and never closed by itself
const JP_SIGN_IN_URL = `https://www.amazon.co.jp/ap/signin?${new URLSearchParams({
  'openid.return_to': 'https://www.amazon.co.jp/gp/video/storefront',
  'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.assoc_handle': 'jpflex',
  'openid.mode': 'checkid_setup',
  'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.ns': 'http://specs.openid.net/auth/2.0',
})}`

/**
 * Where `site`'s own Sign in sends a viewer, which comes back to its Prime Video storefront: the other
 * Amazon sites' to their own `/ap/signin`, primevideo.com's to the Amazon sign-in of the region the
 * connection is in (each measured signed out, 2026-10-15).
 */
export const primeSignInUrl = (site: string) =>
  site === 'amazon.co.jp' ? JP_SIGN_IN_URL
  : site === 'primevideo.com' ? 'https://www.primevideo.com/auth-redirect?signin=1&returnUrl=%2Fstorefront'
  : `https://www.${site}/gp/video/auth-redirect?signin=1&returnUrl=%2Fgp%2Fvideo%2Fstorefront`

/**
 * The header's sign-in link, there only when signed out: on an Amazon site a link inside the shop
 * header's `#nav-link-accountList` div, which carries `nav_youraccount_btn` once signed in (measured on
 * the Prime Video detail page 2026-10-13); on primevideo.com, which has no shop header, the account
 * menu's Sign In (2026-10-15).
 */
export const PRIME_SIGN_IN_LINK = 'a[data-csa-c-content-id="nav_ya_signin"], [data-testid="pv-nav-sign-in"]'

/**
 * Whether a sign-in window shows a Prime Video page signed in: the shop header on an Amazon site, and on
 * primevideo.com its footer, since its Sign In is parsed 34 KB after its bar opens and a signed-out page
 * still streaming in read signed in for up to 100 ms between the two (2026-10-16). Free reads, so the
 * poll never prompts.
 */
export const primeSignedIn = async (login: Frame) =>
  await login.locator('#nav-link-accountList, #pv-footer').exists() && !await login.locator(PRIME_SIGN_IN_LINK).exists()
