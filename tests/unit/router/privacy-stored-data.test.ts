// What stub keeps per viewer, as the privacy page lists it: every key stub writes is named, and every
// item says where it is kept and for how long.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { COMPACT_PREFS_KEY } from '../../../src/tracking/compact-prefs'
import { CONNECTED_KEY } from '../../../src/tracking/connections'
import { SITE_STATUS_KEY } from '../../../src/tracking/site-status'
import { DISPLAY_MODE_KEY } from '../../../src/router/search/display'
import { ACCOUNT_PLUGINS_KEY, ENABLED_PLUGINS_KEY } from '../../../src/plugin-list'
import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import { COUNTRY_KEY } from '../../../src/sources/country'
import { DISABLED_SOURCES_KEY } from '../../../src/sources/disabled-sources'
import { HIDDEN_ICONS_KEY } from '../../../src/sources/hidden-icons'
import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../../src/party/store'
import { PLAYER_VOLUME_KEY } from '../../../src/utils/player-volume'
import { AUTOPLAY_KEY } from '../../../src/utils/autoplay'
import { WATCH_POSITIONS_KEY } from '../../../src/utils/watch-positions'
import { STORED } from '../../../src/router/privacy/stored-data'

const byId = (id: string) => {
  const item = STORED.find(candidate => candidate.id === id)
  if (!item) throw new Error(`no stored item ${id}`)
  return item
}

describe('what stub keeps per viewer', () => {
  test('names each key under the constant its owner writes, so the two cannot drift', () => {
    expect(byId('added-sources').keys).toEqual({ store: 'local', names: [ENABLED_PLUGINS_KEY, ACCOUNT_PLUGINS_KEY] })
    expect(byId('settings').keys).toEqual({
      store: 'local',
      names: [DISABLED_SOURCES_KEY, HIDDEN_ICONS_KEY, COUNTRY_KEY, AUTOPLAY_KEY, DISPLAY_MODE_KEY, COMPACT_PREFS_KEY, ACCOUNT_SETTINGS_KEY],
    })
    expect(byId('connected-sites').keys).toEqual({ store: 'local', names: [CONNECTED_KEY] })
    expect(byId('site-status').keys).toEqual({ store: 'local', names: [SITE_STATUS_KEY] })
    expect(byId('player').keys).toEqual({ store: 'local', names: [PLAYER_VOLUME_KEY] })
    expect(byId('positions').keys).toEqual({ store: 'local', names: [WATCH_POSITIONS_KEY] })
    expect(byId('party-name').keys).toEqual({ store: 'session', names: [PARTY_NAME_KEY] })
    expect(byId('party-invite').keys).toEqual({ store: 'session', names: [PARTY_SESSION_KEY] })
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

  test('says the player keeps its volume and mute, and nothing else of the player', () => {
    expect(byId('player').what).toContain('whether it was muted')
    expect(byId('player').what).toContain('Speed and captions are not kept')
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

  test('says the settings are kept on the FKN account, encrypted in this browser, until changed or the account is deleted', () => {
    const kept = byId('settings')
    expect(kept.where).toContain("your FKN account's storage while you are signed in, encrypted in this browser before it is stored")
    expect(kept.lasts).toContain('Until you change them')
    expect(kept.lasts).toContain("The account's copy is deleted with your FKN account")
    expect(kept.lasts).toContain("this browser's copy of it when you sign out")
    expect(kept.what).toContain('What you set while signed out joins the next FKN account signed in on this browser, unless that account already set it.')
  })

  test('keeps the volume, the tracking sites and their sign-in states on the device, and names them apart', () => {
    for (const key of [PLAYER_VOLUME_KEY, CONNECTED_KEY, SITE_STATUS_KEY, WATCH_POSITIONS_KEY]) expect(byId('settings').keys!.names, key).not.toContain(key)
    for (const id of ['player', 'connected-sites', 'site-status', 'positions']) expect(byId(id).where, id).not.toContain('FKN account')
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
