// What stub keeps per viewer, where, and for how long, as the privacy page lists it. Import free apart
// from the key constants, each taken from the module that writes it, so the list cannot drift from what
// is written.

import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../party/store'
import { ENABLED_PLUGINS_KEY } from '../../plugin-list'
import { COMPACT_PREFS_KEY } from '../../tracking/compact-prefs'
import { CONNECTED_KEY } from '../../tracking/connections'
import { SITE_STATUS_KEY } from '../../tracking/site-status'
import { DISPLAY_MODE_KEY } from '../search/display'

export type StoredItem = {
  id: string
  title: string
  what: string
  where: string
  lasts: string
  /** The web storage keys the item is, when it is kept there. */
  keys?: { store: 'local' | 'session', names: readonly string[] }
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
  },
  {
    id: 'search-layout',
    title: 'Search layout',
    what: 'Whether search shows covers, cards or a list.',
    where: LOCAL,
    lasts: "Until you clear this site's data in your browser",
    keys: { store: 'local', names: [DISPLAY_MODE_KEY] },
  },
  {
    id: 'quick-tracking',
    title: 'Quick tracking choices',
    what: 'The trackers you chose not to save to from the tracking row.',
    where: LOCAL,
    lasts: "Until you clear this site's data in your browser",
    keys: { store: 'local', names: [COMPACT_PREFS_KEY] },
  },
  {
    id: 'connected-sites',
    title: 'Connected tracking sites',
    what: 'Which of AniList and MyAnimeList you signed in to through stub on this device, so stub reaches only those.',
    where: LOCAL,
    lasts: 'Until you sign out of them',
    keys: { store: 'local', names: [CONNECTED_KEY] },
  },
  {
    id: 'site-status',
    title: 'Site sign-in states',
    what: 'Whether you were signed in to Crunchyroll, AniList and MyAnimeList when stub last learned it, and when. Never your name there.',
    where: LOCAL,
    lasts: "Until stub learns it again, or you clear this site's data in your browser",
    keys: { store: 'local', names: [SITE_STATUS_KEY] },
  },
  {
    id: 'party-name',
    title: 'Party name',
    what: 'The name you gave yourself in a watch party.',
    where: SESSION,
    lasts: 'Until you close the tab',
    keys: { store: 'session', names: [PARTY_NAME_KEY] },
  },
  {
    id: 'party-invite',
    title: 'Party you are in',
    what: 'The watch party this tab is in, so a reload rejoins it.',
    where: SESSION,
    lasts: 'Until you leave the party or close the tab',
    keys: { store: 'session', names: [PARTY_SESSION_KEY] },
  },
  {
    id: 'stub-list',
    title: "Stub's list",
    what: "What you track with stub's own tracker: status, progress, score and dates, with each title's name and cover. Signed in to FKN, stub uses your account's list instead, encrypted in this browser before it is stored.",
    where: "The browser's private files for stub at this address, on this device only, and your FKN account's storage once you use its list",
    lasts: 'As long as the list: a removed entry stays in it, with its title and last values, as a record that it was removed',
  },
  {
    id: 'site-sign-ins',
    title: 'Site sign-ins',
    what: 'Your Crunchyroll, AniList and MyAnimeList sessions, which stub plays and tracks with.',
    where: 'Without the FKN extension, FKN keeps them for every fkn.app app. With it, your browser does.',
    lasts: 'Until you sign out, or the site ends the session',
  },
  {
    id: 'fkn-account',
    title: 'FKN account',
    what: 'Which FKN account you are signed in with.',
    where: 'FKN, not stub',
    lasts: 'Until you disconnect',
  },
  {
    id: 'player',
    title: 'Player settings',
    what: 'Volume, speed and captions.',
    where: 'Nowhere',
    lasts: 'Not kept: every episode starts with the player defaults',
  },
  {
    id: 'fetched',
    title: 'Titles, artwork and streams',
    what: 'What stub fetched to show you.',
    where: 'Memory, in this tab',
    lasts: 'Until you refresh or close the tab',
  },
]
