// What stub keeps per viewer, where, and for how long: the list the settings page's Data section shows
// and the privacy page names. Import free apart from the key constants, each taken from the module that
// writes it, so the list cannot drift from what is written.

import type { SettingsSectionId } from './sections'

import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../party/store'
import { ENABLED_PLUGINS_KEY } from '../../plugin-list'
import { COMPACT_PREFS_KEY } from '../../tracking/compact-prefs'
import { CONNECTED_KEY } from '../../tracking/connections'
import { DISPLAY_MODE_KEY } from '../search/display'

export type StoredItem = {
  id: string
  title: string
  what: string
  where: string
  lasts: string
  /** The web storage keys the item is, when it is kept there. */
  keys?: { store: 'local' | 'session', names: readonly string[] }
  /** How the item is cleared, when the Data section does not clear it itself. */
  clearedBy?: { text: string, section?: SettingsSectionId }
  /** The question a Clear asks before it clears. */
  confirm?: string
}

const LOCAL = 'This browser, in its storage for stub at this address'
const SESSION = 'This tab, in its storage for stub'

export const STORED: readonly StoredItem[] = [
  {
    id: 'added-sources',
    title: 'Added sources',
    what: 'The source packages you added from npm, installed for stub through FKN.',
    where: LOCAL,
    lasts: 'Until you remove them',
    keys: { store: 'local', names: [ENABLED_PLUGINS_KEY] },
    confirm: 'Remove every added source? FKN uninstalls them for stub too.',
  },
  {
    id: 'search-layout',
    title: 'Search layout',
    what: 'Whether search shows covers, cards or a list.',
    where: LOCAL,
    lasts: 'Until you clear it',
    keys: { store: 'local', names: [DISPLAY_MODE_KEY] },
    confirm: 'Clear the search layout? Search goes back to covers.',
  },
  {
    id: 'quick-tracking',
    title: 'Quick tracking choices',
    what: 'The trackers you chose not to save to from the tracking row.',
    where: LOCAL,
    lasts: 'Until you clear them',
    keys: { store: 'local', names: [COMPACT_PREFS_KEY] },
    confirm: 'Clear your quick tracking choices? The row saves to every tracker you are signed in to again.',
  },
  {
    id: 'connected-sites',
    title: 'Connected tracking sites',
    what: 'Which of AniList and MyAnimeList you signed in to through stub on this device, so stub reaches only those.',
    where: LOCAL,
    lasts: 'Until you sign out of them',
    keys: { store: 'local', names: [CONNECTED_KEY] },
    clearedBy: { text: 'Sign out of each under Accounts.', section: 'accounts' },
  },
  {
    id: 'party-name',
    title: 'Party name',
    what: 'The name you gave yourself in a watch party.',
    where: SESSION,
    lasts: 'Until you close the tab',
    keys: { store: 'session', names: [PARTY_NAME_KEY] },
    confirm: 'Clear your party name?',
  },
  {
    id: 'party-invite',
    title: 'Party you are in',
    what: 'The watch party this tab is in, so a reload rejoins it.',
    where: SESSION,
    lasts: 'Until you leave the party or close the tab',
    keys: { store: 'session', names: [PARTY_SESSION_KEY] },
    clearedBy: { text: 'Leave the party to forget it.' },
  },
  {
    id: 'stub-list',
    title: "Stub's list",
    what: "What you track with stub's own tracker: status, progress, score and dates, with each title's name and cover. Signed in to FKN, stub uses your account's list instead, encrypted in this browser before it is stored.",
    where: "The browser's private files for stub at this address, on this device only, and your FKN account's storage once you use its list",
    lasts: 'As long as the list: a removed entry stays in it, with its title and last values, as a record that it was removed',
    clearedBy: { text: "Remove an entry with Remove from list, in its title's status menu. The record that it was removed stays, so any other device using the list removes it too, and there is no way to clear these records yet. Signing out of FKN takes the account's list off this device." },
  },
  {
    id: 'site-sign-ins',
    title: 'Site sign-ins',
    what: 'Your Crunchyroll, AniList and MyAnimeList sessions, which stub plays and tracks with.',
    where: 'Without the FKN extension, FKN keeps them for every fkn.app app. With it, your browser does.',
    lasts: 'Until you sign out, or the site ends the session',
    clearedBy: { text: 'Sign out under Accounts.', section: 'accounts' },
  },
  {
    id: 'fkn-account',
    title: 'FKN account',
    what: 'Which FKN account you are signed in with.',
    where: 'FKN, not stub',
    lasts: 'Until you disconnect',
    clearedBy: { text: 'Disconnect under Accounts.', section: 'accounts' },
  },
  {
    id: 'player',
    title: 'Player settings',
    what: 'Volume, speed and captions.',
    where: 'Nowhere',
    lasts: 'Not kept: every episode starts with the player defaults',
    clearedBy: { text: 'Nothing to clear.' },
  },
  {
    id: 'fetched',
    title: 'Titles, artwork and streams',
    what: 'What stub fetched to show you.',
    where: 'Memory, in this tab',
    lasts: 'Until you refresh or close the tab',
    clearedBy: { text: 'Refresh the page to clear it.' },
  },
]

export type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>

/** Where an item's keys are read and removed. A getter, since reading `localStorage` throws when a browser blocks site data. */
export type BrowserStores = { local: () => StorageLike | undefined, session: () => StorageLike | undefined }

export const browserStores: BrowserStores = {
  local: () => globalThis.localStorage,
  session: () => globalThis.sessionStorage,
}

const storeOf = (item: StoredItem, stores: BrowserStores) => {
  if (!item.keys) return undefined
  try { return stores[item.keys.store]() } catch { return undefined }
}

/** Whether the Data section clears the item itself, rather than pointing at where it is cleared. */
export const isClearedHere = (item: StoredItem): boolean => Boolean(item.keys) && !item.clearedBy

// what an owner writes once everything was removed (the plugin list writes `[]`)
const EMPTY = new Set(['', '[]', '{}', 'null'])

/** Whether any of the item's keys holds something. Always false for an item outside web storage. */
export const holdsAnything = (item: StoredItem, stores: BrowserStores): boolean => {
  const store = storeOf(item, stores)
  return Boolean(store) && item.keys!.names.some(name => {
    try {
      const value = store!.getItem(name)
      return value !== null && !EMPTY.has(value.trim())
    } catch {
      return false
    }
  })
}

/** Removes exactly the item's keys, when the Data section clears it, and nothing else. */
export const clearStored = (item: StoredItem, stores: BrowserStores): void => {
  if (!isClearedHere(item)) return
  const store = storeOf(item, stores)
  for (const name of item.keys!.names) {
    try { store?.removeItem(name) } catch {}
  }
}
