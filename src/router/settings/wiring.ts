import type { AccountsProps } from './accounts'

import { clearCloudCookies } from '../../sources/cloud-sign-out'
import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, crunchyrollSignedIn } from '../../sources/crunchyroll/session'
import { signInThroughWindow } from '../../sources/login-window'
import { isSiteConnected, signOutOfSite, trackerSignIns, watchSite } from '../../tracking/site-sessions'

/** What the Accounts section reaches for Crunchyroll: the sign-in window and the cookies a sign out removes. */
export const crunchyroll: AccountsProps['crunchyroll'] = {
  signIn: () => signInThroughWindow({ url: CRUNCHYROLL_LOGIN_URL, domains: CRUNCHYROLL_DOMAINS, isSignedIn: crunchyrollSignedIn }),
  signOut: () => clearCloudCookies(CRUNCHYROLL_DOMAINS),
}

/** What the Accounts section reaches for AniList and MyAnimeList. */
export const sites: AccountsProps['sites'] = {
  isConnected: isSiteConnected,
  watch: watchSite,
  signIn: site => trackerSignIns[site]!(),
  signOut: signOutOfSite,
}
