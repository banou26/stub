import type { AccountsProps } from './accounts'

import { attachFrame, fetch } from '@fkn/lib'

import { clearCloudCookies } from '../../sources/cloud-sign-out'
import { PRIME_DOMAINS, PRIME_SIGN_IN_URL, primeSignedIn } from '../../sources/amazon/session'
import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, crunchyrollSignedIn } from '../../sources/crunchyroll/session'
import { checkCrunchyroll } from '../../sources/crunchyroll/sign-in-check'
import { signInThroughWindow } from '../../sources/login-window'
import { isSiteConnected, signOutOfCrunchyroll, signOutOfSite, trackerSignIns, watchSite } from '../../tracking/site-sessions'
import { createRefresh, rememberSignIn, siteStatuses } from '../../tracking/site-status'
import { mountHiddenFrame } from '../../utils/hidden-frame'

/** What the Accounts section reaches for Crunchyroll: the sign-in window and the cookies a sign out removes. */
export const crunchyroll: AccountsProps['crunchyroll'] = {
  signIn: () => signInThroughWindow({ url: CRUNCHYROLL_LOGIN_URL, domains: CRUNCHYROLL_DOMAINS, isSignedIn: crunchyrollSignedIn })
    .then(rememberSignIn(siteStatuses, 'crunchyroll')),
  signOut: signOutOfCrunchyroll,
}

/** What the Accounts section reaches for Prime Video: the sign-in window and the cookies a sign out removes. */
export const prime: AccountsProps['prime'] = {
  signIn: () => signInThroughWindow({ url: PRIME_SIGN_IN_URL, domains: PRIME_DOMAINS, isSignedIn: primeSignedIn })
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
