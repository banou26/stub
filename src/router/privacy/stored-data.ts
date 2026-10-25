// What stub keeps per viewer, where, and for how long, as the privacy page lists it. Its keys are taken
// from the modules that write or list them, so the list cannot drift from what is written.

import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../party/store'
import { UPDATE_RELOADS_KEY } from '../../update/gate'
import { ACCOUNT_PLUGINS_KEY, ENABLED_PLUGINS_KEY } from '../../plugin-list'
import { ACCOUNT_SETTINGS_KEY } from '../../settings-store'
import { SETTINGS_KEYS } from '../../settings-sync'
import { CONNECTED_KEY } from '../../tracking/connections'
import { SITE_STATUS_KEY } from '../../tracking/site-status'
import { PLAYER_VOLUME_KEY } from '../../utils/player-volume'
import { ACCOUNT_POSITIONS_KEY, WATCH_POSITIONS_KEY } from '../../utils/watch-positions'

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
    what: "The source packages you added from npm, installed for stub through FKN. Signed in to FKN, the list is your account's, so every stub site you sign in on gets it. Sources added while signed out join the list of the next FKN account signed in on this browser.",
    where: `${LOCAL}, and your FKN account's storage while you are signed in, encrypted in this browser before it is stored`,
    lasts: "Until you remove them. The account's copy is deleted with your FKN account, and this browser's copy of it when you sign out",
    keys: { store: 'local', names: [ENABLED_PLUGINS_KEY, ACCOUNT_PLUGINS_KEY] },
  },
  {
    id: 'settings',
    title: 'Settings',
    what: "Your choices in Settings and around stub: sources turned off, hidden icons, the country you picked, autoplay, the search layout, the trackers you chose not to save to and whether you expanded them, and the play order. Signed in to FKN, they are your account's, so every stub site and device you sign in on gets them. What you set while signed out joins the next FKN account signed in on this browser, unless that account already set it.",
    where: `${LOCAL}, and your FKN account's storage while you are signed in, encrypted in this browser before it is stored`,
    lasts: "Until you change them. The account's copy is deleted with your FKN account, and this browser's copy of it when you sign out",
    keys: { store: 'local', names: [...SETTINGS_KEYS, ACCOUNT_SETTINGS_KEY] },
  },
  {
    id: 'connected-sites',
    title: 'Connected tracking sites',
    what: 'Which of AniList, MyAnimeList and Crunchyroll you signed in to through stub on this device, so stub reaches only those.',
    where: LOCAL,
    lasts: "Until you sign out of them, or clear this site's data in your browser",
    keys: { store: 'local', names: [CONNECTED_KEY] },
  },
  {
    id: 'site-status',
    title: 'Site sign-in states',
    what: 'Whether you were signed in to Crunchyroll, Prime Video, AniList and MyAnimeList when stub last learned it, and when. Never your name there.',
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
    id: 'update-reloads',
    title: 'Update reloads',
    what: 'When this tab last reloaded by itself onto a new version of stub, so it does so at most twice in five minutes.',
    where: SESSION,
    lasts: 'Until you close the tab',
    keys: { store: 'session', names: [UPDATE_RELOADS_KEY] },
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
    what: 'Your Crunchyroll, Prime Video, AniList and MyAnimeList sessions, which stub plays and tracks with.',
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
    title: 'Player volume',
    what: 'The volume you last left a player at, and whether it was muted, so the next episode or theme starts the same. Speed and captions are not kept.',
    where: LOCAL,
    lasts: "Until you clear this site's data in your browser",
    keys: { store: 'local', names: [PLAYER_VOLUME_KEY] },
  },
  {
    id: 'positions',
    title: 'Where you stopped',
    what: "The point you stopped at in each episode you have not finished, with the source it played on, its length and when you stopped, for your 200 most recent, and the source and time of the 200 you finished last. Signed in to FKN, they are your account's, so every stub site and device you sign in on resumes there. Those kept while signed out join the next FKN account signed in on this browser.",
    where: `${LOCAL}, and your FKN account's storage while you are signed in, encrypted in this browser before it is stored`,
    lasts: "Until 200 newer ones replace them. The account's copy is deleted with your FKN account, and this browser's copy of it when you sign out",
    keys: { store: 'local', names: [WATCH_POSITIONS_KEY, ACCOUNT_POSITIONS_KEY] },
  },
  {
    id: 'fetched',
    title: 'Titles, artwork and streams',
    what: 'What stub fetched to show you.',
    where: 'Memory, in this tab',
    lasts: 'Until you refresh or close the tab',
  },
]
