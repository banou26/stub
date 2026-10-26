// What each added source last said of the viewer's account with its site, held in this page's memory and
// nowhere else. Import free, so a test drives it on its own.

import type { SourceAccess, SourceAccount } from './plugin-api'

export type PluginAccounts = {
  record: (origin: string, state: SourceAccount) => void
  /** The source's releases play with no account to fix: it needs none, or it said the viewer is signed in. */
  free: (origin: string, access: SourceAccess) => boolean
  /**
   * The source needs an account, and the viewer has no plan there, or is not signed in there and the
   * source never said they were in this page. A source that has not answered counts as not signed in.
   */
  neverSignedIn: (origin: string, access: SourceAccess) => boolean
}

export const createPluginAccounts = (): PluginAccounts => {
  const last = new Map<string, SourceAccount>()
  const signedIn = new Set<string>()
  return {
    record: (origin, state) => {
      last.set(origin, state)
      if (state === 'signed-in') signedIn.add(origin)
    },
    free: (origin, access) => access === 'none' || last.get(origin) === 'signed-in',
    neverSignedIn: (origin, access) => access !== 'none' && last.get(origin) !== 'signed-in'
      && (last.get(origin) === 'no-plan' || !signedIn.has(origin)),
  }
}

export const pluginAccounts = createPluginAccounts()
