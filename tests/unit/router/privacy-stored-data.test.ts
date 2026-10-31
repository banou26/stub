// What stub keeps per viewer, as the privacy page lists it: every key stub writes is named, and every
// item says where it is kept and for how long.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { COMPACT_PREFS_KEY } from '../../../src/tracking/compact-prefs'
import { CONNECTED_KEY } from '../../../src/tracking/connections'
import { SITE_STATUS_KEY } from '../../../src/tracking/site-status'
import { DISPLAY_MODE_KEY } from '../../../src/router/search/display'
import { ACCOUNT_PLUGINS_KEY, ACCOUNT_VALUES_KEY, ENABLED_PLUGINS_KEY, PLUGIN_VALUES_KEY } from '../../../src/plugin-list'
import { CARRIED_LANGUAGE_KEY, LANGUAGE_KEY } from '../../../src/i18n/languages'
import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import { COUNTRY_KEY } from '../../../src/sources/country'
import { DISABLED_SOURCES_KEY } from '../../../src/sources/disabled-sources'
import { HIDDEN_ICONS_KEY } from '../../../src/sources/hidden-icons'
import { MERGE_ORDER_KEY } from '../../../src/sources/merge-order'
import { PLAY_ORDER_KEY } from '../../../src/sources/play-order'
import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../../src/party/store'
import { UPDATE_RELOADS_KEY } from '../../../src/update/gate'
import { PLAYER_VOLUME_KEY } from '../../../src/utils/player-volume'
import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY } from '../../../src/utils/track-languages'
import { AUTOPLAY_KEY } from '../../../src/utils/autoplay'
import { ACCOUNT_POSITIONS_KEY, WATCH_POSITIONS_KEY } from '../../../src/utils/watch-positions'
import { STORED } from '../../../src/router/privacy/stored-data'

const byId = (id: string) => {
  const item = STORED.find(candidate => candidate.id === id)
  if (!item) throw new Error(`no stored item ${id}`)
  return item
}

describe('what stub keeps per viewer', () => {
  test('names each key under the constant its owner writes, so the two cannot drift', () => {
    expect(byId('added-sources').keys).toEqual({ store: 'local', names: [ENABLED_PLUGINS_KEY, ACCOUNT_PLUGINS_KEY] })
    expect(byId('source-settings').keys).toEqual({ store: 'local', names: [PLUGIN_VALUES_KEY, ACCOUNT_VALUES_KEY] })
    expect(byId('settings').keys).toEqual({
      store: 'local',
      names: [DISABLED_SOURCES_KEY, HIDDEN_ICONS_KEY, COUNTRY_KEY, LANGUAGE_KEY, AUTOPLAY_KEY, DISPLAY_MODE_KEY, COMPACT_PREFS_KEY, PLAY_ORDER_KEY, MERGE_ORDER_KEY, AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, ACCOUNT_SETTINGS_KEY],
    })
    expect(byId('connected-sites').keys).toEqual({ store: 'local', names: [CONNECTED_KEY] })
    expect(byId('site-status').keys).toEqual({ store: 'local', names: [SITE_STATUS_KEY] })
    expect(byId('player').keys).toEqual({ store: 'local', names: [PLAYER_VOLUME_KEY] })
    expect(byId('positions').keys).toEqual({ store: 'local', names: [WATCH_POSITIONS_KEY, ACCOUNT_POSITIONS_KEY] })
    expect(byId('party-name').keys).toEqual({ store: 'session', names: [PARTY_NAME_KEY] })
    expect(byId('party-invite').keys).toEqual({ store: 'session', names: [PARTY_SESSION_KEY] })
    expect(byId('update-reloads').keys).toEqual({ store: 'session', names: [UPDATE_RELOADS_KEY] })
    expect(byId('language-carried').keys).toEqual({ store: 'session', names: [CARRIED_LANGUAGE_KEY] })
  })

  // what src writes, read from src itself, so a new key anywhere turns this red until the list names it
  test('names every key src writes with setItem, each spelled as a constant the list can import', () => {
    const SRC = join(import.meta.dirname, '../../../src')
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .filter(file => /\.tsx?$/.test(file))
      .map(file => ({ file, text: readFileSync(join(SRC, file), 'utf-8') }))
    const constants = new Map(files.flatMap(({ text }) => [...text.matchAll(/export const ([A-Z][A-Z0-9_]*) = '([^']*)'/g)].map(([, name, value]) => [name!, value!])))

    const written = files.flatMap(({ file, text }) => [...text.matchAll(/\bsetItem\(\s*([^,)]+?)\s*,/g)].map(([, key]) => ({ at: relative(SRC, join(SRC, file)), key: key! })))
    expect(written.length, 'the scan finds the writes').toBeGreaterThanOrEqual(7)

    const named = STORED.flatMap(item => item.keys?.names ?? [])
    // the settings store writes the key a setting's module hands it, and that module's own call is scanned
    for (const { at, key } of written.filter(write => !(write.at === 'settings-store.ts' && write.key === 'key'))) {
      const value = /^'[^']*'$/.test(key) ? key.slice(1, -1) : constants.get(key)
      expect(value, `${at} writes ${key}, which is not an exported constant`).toBeDefined()
      expect(named, `${at} writes ${key}`).toContain(value)
    }
  })

  test('says where every item lives and how long it lasts', () => {
    for (const item of STORED) {
      expect(item.title, item.id).toBeTruthy()
      expect(item.what, item.id).toBeTruthy()
      expect(item.where, item.id).toBeTruthy()
      expect(item.lasts, item.id).toBeTruthy()
    }
  })

  test('lists the stores kept outside web storage too: the list, the sign-ins, the account', () => {
    expect(STORED.map(item => item.id)).toEqual(expect.arrayContaining(['stub-list', 'site-sign-ins', 'fkn-account', 'fetched']))
    expect(byId('stub-list').where).toContain('this device')
  })

  test('says the player keeps its volume and mute on the device and not its speed, and the languages last picked with the settings', () => {
    expect(byId('player').what).toContain('whether it was muted')
    expect(byId('player').what).toContain('Speed is not kept')
    expect(byId('player').what).not.toContain('language')
    expect(byId('settings').what).toContain('the audio and subtitle languages you last picked in a player')
  })

  // HOR-1026 (stub in the viewer's language): the Language setting follows the account as the country does
  test('names the language picked in Settings among the settings', () => {
    expect(byId('settings').what).toContain('the country and the language you picked')
  })

  test("says a removed entry stays in stub's list, with its title and last values", () => {
    expect(byId('stub-list').lasts).toContain('a removed entry stays in it, with its title and last values')
    expect(byId('stub-list').what).toContain("each title's name and cover")
  })

  test('says what this browser keeps is per address of stub, since each address is its own origin', () => {
    for (const item of STORED.filter(candidate => candidate.keys?.store === 'local')) expect(item.where, item.id).toContain('at this address')
    expect(byId('stub-list').where).toContain('at this address')
  })

  test('says the added sources are kept on the FKN account, encrypted in this browser, until removed or the account is deleted', () => {
    const added = byId('added-sources')
    expect(added.where).toContain("your FKN account's storage while you are signed in, encrypted in this browser before it is stored")
    expect(added.lasts).toContain('Until you remove them')
    expect(added.lasts).toContain("The account's copy is deleted with your FKN account")
    expect(added.lasts).toContain("this browser's copy of it when you sign out")
  })

  test('says what is entered for a source is kept on the FKN account, encrypted in this browser, and what joins it', () => {
    const kept = byId('source-settings')
    expect(kept.where).toContain("your FKN account's storage while you are signed in, encrypted in this browser before it is stored")
    expect(kept.where, 'and plainly what is not').toContain('not encrypted')
    expect(kept.what).toContain('every stub site and device you sign in on')
    expect(kept.what).toContain('What you entered while signed out joins the next FKN account signed in on this browser, unless that account already set it.')
    expect(kept.lasts).toContain('Until you change it or remove the source, on any site or device')
    expect(kept.lasts).toContain("The account's copy is deleted with your FKN account")
    expect(kept.lasts).toContain("this browser's copy of it when you sign out")
  })

  test('says the settings are kept on the FKN account, encrypted in this browser, until changed or the account is deleted', () => {
    const kept = byId('settings')
    expect(kept.where).toContain("your FKN account's storage while you are signed in, encrypted in this browser before it is stored")
    expect(kept.lasts).toContain('Until you change them')
    expect(kept.lasts).toContain("The account's copy is deleted with your FKN account")
    expect(kept.lasts).toContain("this browser's copy of it when you sign out")
    expect(kept.what).toContain('What you set while signed out joins the next FKN account signed in on this browser, unless that account already set it.')
    expect(kept.what).toContain('the play order, the merge order, and')
  })

  test('keeps the volume, the tracking sites and their sign-in states on the device, and names them apart', () => {
    for (const key of [PLAYER_VOLUME_KEY, CONNECTED_KEY, SITE_STATUS_KEY, WATCH_POSITIONS_KEY]) expect(byId('settings').keys!.names, key).not.toContain(key)
    for (const id of ['player', 'connected-sites', 'site-status']) expect(byId(id).where, id).not.toContain('FKN account')
  })

  test('says where you stopped is kept on the FKN account, encrypted in this browser, with when, and what joins it', () => {
    const kept = byId('positions')
    expect(kept.where).toContain("your FKN account's storage while you are signed in, encrypted in this browser before it is stored")
    expect(kept.what).toContain('when you stopped')
    expect(kept.what).toContain('every stub site and device you sign in on')
    expect(kept.what).toContain('Those kept while signed out join the next FKN account signed in on this browser.')
    expect(kept.lasts).toContain("The account's copy is deleted with your FKN account")
    expect(kept.lasts).toContain("this browser's copy of it when you sign out")
  })

  test('says the sources added while signed out join the next FKN account signed in here', () => {
    expect(byId('added-sources').what).toContain('Sources added while signed out join the list of the next FKN account signed in on this browser.')
  })

  // with the extension stub offers no Crunchyroll sign out, so a sign out is not the only way it goes
  test('names every site a sign in through stub connects, Crunchyroll included, and how its entry goes without a sign out', () => {
    expect(byId('connected-sites').what).toContain('AniList, MyAnimeList and Crunchyroll')
    expect(byId('connected-sites').lasts).toContain("or clear this site's data in your browser")
  })

  test('the sign-in states keep no account name', () => {
    expect(byId('site-status').what).toContain('Never your name there')
  })
})
