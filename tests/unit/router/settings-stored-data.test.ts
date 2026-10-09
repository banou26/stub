// What stub keeps per viewer, as the settings page's Data section lists it: every item says where it is
// kept, and an item the page clears clears exactly its own keys and nothing beside them.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { COMPACT_PREFS_KEY } from '../../../src/tracking/compact-prefs'
import { CONNECTED_KEY } from '../../../src/tracking/connections'
import { DISPLAY_MODE_KEY } from '../../../src/router/search/display'
import { API_KEYS_KEY } from '../../../src/sources/key-configs'
import { ENABLED_PLUGINS_KEY } from '../../../src/plugin-list'
import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../../src/party/store'
import { STORED, clearStored, holdsAnything, isClearedHere, type BrowserStores } from '../../../src/router/settings/stored-data'

const memory = (initial: Record<string, string>) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

// every key stub writes, filled in, and one that belongs to nobody here
const LOCAL = {
  [API_KEYS_KEY]: JSON.stringify({ omdb: 'a-key' }),
  [ENABLED_PLUGINS_KEY]: JSON.stringify(['npm:@banou/example']),
  [DISPLAY_MODE_KEY]: 'list',
  [COMPACT_PREFS_KEY]: JSON.stringify({ targets: { mal: false } }),
  [CONNECTED_KEY]: JSON.stringify(['anilist', 'mal']),
  'not-stub': 'kept',
}
const SESSION = {
  [PARTY_NAME_KEY]: 'Banou',
  [PARTY_SESSION_KEY]: 'an-invite',
  'not-stub-either': 'kept',
}

const seeded = () => {
  const local = memory(LOCAL)
  const session = memory(SESSION)
  const stores: BrowserStores = { local: () => local, session: () => session }
  return { local, session, stores }
}

const byId = (id: string) => {
  const item = STORED.find(candidate => candidate.id === id)
  if (!item) throw new Error(`no stored item ${id}`)
  return item
}

describe('what stub keeps per viewer', () => {
  test('names each key under the constant its owner writes, so the two cannot drift', () => {
    expect(byId('api-keys').keys).toEqual({ store: 'local', names: [API_KEYS_KEY] })
    expect(byId('added-sources').keys).toEqual({ store: 'local', names: [ENABLED_PLUGINS_KEY] })
    expect(byId('search-layout').keys).toEqual({ store: 'local', names: [DISPLAY_MODE_KEY] })
    expect(byId('quick-tracking').keys).toEqual({ store: 'local', names: [COMPACT_PREFS_KEY] })
    expect(byId('connected-sites').keys).toEqual({ store: 'local', names: [CONNECTED_KEY] })
    expect(byId('party-name').keys).toEqual({ store: 'session', names: [PARTY_NAME_KEY] })
    expect(byId('party-invite').keys).toEqual({ store: 'session', names: [PARTY_SESSION_KEY] })
  })

  test('covers every key stub writes to web storage', () => {
    const named = STORED.flatMap(item => item.keys?.names ?? [])
    for (const key of [...Object.keys(LOCAL), ...Object.keys(SESSION)].filter(key => !key.startsWith('not-stub'))) {
      expect(named, key).toContain(key)
    }
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
    for (const { at, key } of written) {
      const value = /^'[^']*'$/.test(key) ? key.slice(1, -1) : constants.get(key)
      expect(value, `${at} writes ${key}, which is not an exported constant`).toBeDefined()
      expect(named, `${at} writes ${key}`).toContain(value)
    }
  })

  test('says where every item lives and how long it lasts, and how to clear what the page does not', () => {
    for (const item of STORED) {
      expect(item.title, item.id).toBeTruthy()
      expect(item.what, item.id).toBeTruthy()
      expect(item.where, item.id).toBeTruthy()
      expect(item.lasts, item.id).toBeTruthy()
      if (!isClearedHere(item)) expect(item.clearedBy?.text, `${item.id} says how it is cleared`).toBeTruthy()
    }
  })

  test('lists the stores kept outside web storage too: the list, the sign-ins, the account, the player', () => {
    expect(STORED.map(item => item.id)).toEqual(expect.arrayContaining(['stub-list', 'site-sign-ins', 'fkn-account', 'player', 'fetched']))
    expect(byId('stub-list').where).toContain('this device')
    expect(byId('player').lasts, 'nothing of the player is kept (P0)').toMatch(/not kept/i)
  })

  test("says a removed entry stays in stub's list, with its title and last values, and cannot be cleared yet", () => {
    expect(byId('stub-list').lasts).toContain('a removed entry stays in it, with its title and last values')
    expect(byId('stub-list').clearedBy?.text).toContain('there is no way to clear these records yet')
    expect(byId('stub-list').what).toContain("each title's name and cover")
  })

  test('says what this browser keeps is per address of stub, since each address is its own origin', () => {
    for (const item of STORED.filter(candidate => candidate.keys?.store === 'local')) expect(item.where, item.id).toContain('at this address')
    expect(byId('stub-list').where).toContain('at this address')
  })

  test('the sites a sign in connected are cleared under Accounts, and the party you are in by leaving it', () => {
    expect(isClearedHere(byId('connected-sites'))).toBe(false)
    expect(byId('connected-sites').clearedBy?.section).toBe('accounts')
    expect(isClearedHere(byId('party-invite'))).toBe(false)
    expect(isClearedHere(byId('stub-list'))).toBe(false)
  })
})

describe('a Clear', () => {
  const clearable = () => STORED.filter(isClearedHere)

  test('is offered for the keys, the added sources, the search layout, the quick tracking choices and the party name', () => {
    expect(clearable().map(item => item.id)).toEqual(['api-keys', 'added-sources', 'search-layout', 'quick-tracking', 'party-name'])
  })

  for (const id of ['api-keys', 'added-sources', 'search-layout', 'quick-tracking', 'party-name']) {
    test(`on ${id} removes exactly its keys, and every other key is left as it was`, () => {
      const { local, session, stores } = seeded()
      const item = byId(id)
      clearStored(item, stores)

      const gone = item.keys!.names
      const expectedLocal = Object.fromEntries(Object.entries(LOCAL).filter(([key]) => item.keys!.store !== 'local' || !gone.includes(key)))
      const expectedSession = Object.fromEntries(Object.entries(SESSION).filter(([key]) => item.keys!.store !== 'session' || !gone.includes(key)))
      expect(Object.fromEntries(local.values)).toEqual(expectedLocal)
      expect(Object.fromEntries(session.values)).toEqual(expectedSession)
      expect(gone.length).toBeGreaterThan(0)
    })
  }

  test('of an item the page does not clear removes nothing', () => {
    const { local, session, stores } = seeded()
    for (const item of STORED.filter(candidate => !isClearedHere(candidate))) clearStored(item, stores)
    expect(Object.fromEntries(local.values)).toEqual(LOCAL)
    expect(Object.fromEntries(session.values)).toEqual(SESSION)
  })

  test('on a browser that blocks site data throws nothing', () => {
    const blocked: BrowserStores = { local: () => { throw new Error('SecurityError') }, session: () => undefined }
    for (const item of STORED) expect(() => clearStored(item, blocked)).not.toThrow()
    expect(STORED.some(item => holdsAnything(item, blocked))).toBe(false)
  })
})

describe('whether an item holds anything', () => {
  test('reads its keys, and an empty list or map holds nothing', () => {
    const { stores, local } = seeded()
    expect(holdsAnything(byId('api-keys'), stores)).toBe(true)
    expect(holdsAnything(byId('added-sources'), stores)).toBe(true)

    // what saveKeys and the plugin list write once everything was removed
    local.values.set(API_KEYS_KEY, '{}')
    local.values.set(ENABLED_PLUGINS_KEY, '[]')
    expect(holdsAnything(byId('api-keys'), stores)).toBe(false)
    expect(holdsAnything(byId('added-sources'), stores)).toBe(false)

    clearStored(byId('search-layout'), stores)
    expect(holdsAnything(byId('search-layout'), stores)).toBe(false)
    expect(holdsAnything(byId('stub-list'), stores), 'not in web storage, so not read here').toBe(false)
  })
})
