import type { AccountsProps } from './accounts'

import { attachFrame, fetch } from '@fkn/lib'

import { clearCloudCookies } from '../../sources/cloud-sign-out'
import { PRIME_DOMAINS, primeSignedIn, primeSignInUrl, primeSiteFor } from '../../sources/amazon/session'
import { viewerCountry } from '../../sources/country'
import { checkCrunchyroll } from '../../sources/crunchyroll/sign-in-check'
import { signInThroughWindow } from '../../sources/login-window'
import { isSiteConnected, signInToCrunchyroll, signOutOfCrunchyroll, signOutOfSite, trackerSignIns, watchSite } from '../../tracking/site-sessions'
import { createRefresh, rememberSignIn, siteStatuses } from '../../tracking/site-status'
import { mountHiddenFrame } from '../../utils/hidden-frame'

/** What the Accounts section reaches for Crunchyroll: the Log in of its tracker's chip, which turns its tracking on, and its sign out. */
export const crunchyroll: AccountsProps['crunchyroll'] = {
  signIn: signInToCrunchyroll,
  signOut: signOutOfCrunchyroll,
}

/** What the Accounts section reaches for Prime Video: the viewer's country's sign-in window, and the cookies a sign out removes. */
export const prime: AccountsProps['prime'] = {
  signIn: () => signInThroughWindow({ url: primeSignInUrl(primeSiteFor(viewerCountry())), domains: PRIME_DOMAINS, isSignedIn: primeSignedIn })
    .then(rememberSignIn(siteStatuses, 'prime')),
  signOut: () => clearCloudCookies(PRIME_DOMAINS).then(() => siteStatuses.record('prime', 'signed-out')),
}

/** What the Accounts section reaches for AniList and MyAnimeList. */
export const sites: AccountsProps['sites'] = {
  isConnected: isSiteConnected,
  watch: watchSite,
  signIn: site => trackerSignIns[site]!(),
  signOut: signOutOfSite,
}

/** The remembered sign-in states, and Crunchyroll's check of its own. */
export const status: AccountsProps['status'] = {
  read: siteStatuses.read,
  watch: siteStatuses.watch,
  refresh: createRefresh(siteStatuses, (_site, backend) =>
    checkCrunchyroll(backend, { attach: attachFrame, mount: () => mountHiddenFrame('Sign-in check'), fetch })),
}
