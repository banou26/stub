// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, expect, test, vi } from 'vitest'
import { act } from 'preact/test-utils'

import type { BrowserStores } from '../../../src/router/settings/stored-data'

import { API_KEYS_KEY } from '../../../src/sources/key-configs'
import { DISPLAY_MODE_KEY } from '../../../src/router/search/display'
import { PARTY_NAME_KEY, PARTY_SESSION_KEY } from '../../../src/party/store'
import { CONNECTED_KEY } from '../../../src/tracking/connections'
import { STORED } from '../../../src/router/settings/stored-data'

const { DataSection } = await import('../../../src/router/settings/data')

// The Data section: what stub keeps, where and for how long, and one Clear per item that asks first.

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

const memory = (initial: Record<string, string>) => {
  const values = new Map(Object.entries(initial))
  return { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key) }, values }
}

const render = (clearers = {}) => {
  const local = memory({ [API_KEYS_KEY]: '{"omdb":"a-key"}', [DISPLAY_MODE_KEY]: 'list', [CONNECTED_KEY]: '["anilist"]' })
  const session = memory({ [PARTY_NAME_KEY]: 'Banou', [PARTY_SESSION_KEY]: 'an-invite' })
  const stores: BrowserStores = { local: () => local, session: () => session }
  const onCleared = vi.fn()
  const host = mount(<DataSection stores={stores} clearers={clearers} onCleared={onCleared}/>)
  hosts.push(host)
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-stored="${id}"]`)!
  return { host, row, local, session, onCleared }
}

test('lists every item stub keeps, with where it is kept and how long', () => {
  const { row } = render()
  for (const item of STORED) {
    expect(row(item.id), item.id).toBeTruthy()
    expect(row(item.id).textContent).toContain(item.title)
    expect(row(item.id).textContent).toContain(item.where)
    expect(row(item.id).textContent).toContain(item.lasts)
  }
})

test('a Clear asks first, and Cancel leaves every store as it was', async () => {
  const { row, local } = render()
  await act(async () => { button(row('search-layout'), 'Clear')!.click() })
  expect(local.values.get(DISPLAY_MODE_KEY), 'nothing is cleared by the first click').toBe('list')
  await act(async () => { button(row('search-layout'), 'Cancel')!.click() })
  expect(local.values.get(DISPLAY_MODE_KEY)).toBe('list')
  expect(button(row('search-layout'), 'Yes, clear')).toBeFalsy()
})

test('a confirmed Clear clears that item alone, and the row then says nothing is kept', async () => {
  const { row, local, session, onCleared } = render()
  await act(async () => { button(row('search-layout'), 'Clear')!.click() })
  await act(async () => { button(row('search-layout'), 'Yes, clear')!.click() })
  await flush()

  expect(local.values.has(DISPLAY_MODE_KEY)).toBe(false)
  expect(local.values.get(API_KEYS_KEY)).toBe('{"omdb":"a-key"}')
  expect(local.values.get(CONNECTED_KEY)).toBe('["anilist"]')
  expect(session.values.get(PARTY_NAME_KEY)).toBe('Banou')
  expect(onCleared).toHaveBeenCalledWith('search-layout')
  expect(row('search-layout').textContent).toContain('Nothing kept')
  expect(button(row('search-layout'), 'Clear')).toBeFalsy()
})

test('an item with its own clear runs that instead, so the keys also leave the worker', async () => {
  const clearKeys = vi.fn()
  const { row, local } = render({ 'api-keys': clearKeys })
  await act(async () => { button(row('api-keys'), 'Clear')!.click() })
  await act(async () => { button(row('api-keys'), 'Yes, clear')!.click() })
  await flush()
  expect(clearKeys).toHaveBeenCalledTimes(1)
  expect(local.values.get(API_KEYS_KEY), 'the default removal did not run beside it').toBe('{"omdb":"a-key"}')
})

test('an item holding nothing offers no Clear', () => {
  const { row } = render()
  expect(row('quick-tracking').textContent).toContain('Nothing kept')
  expect(button(row('quick-tracking'), 'Clear')).toBeFalsy()
})

test('an item cleared elsewhere says where, and links to its section', () => {
  const { row } = render()
  expect(button(row('connected-sites'), 'Clear')).toBeFalsy()
  expect(row('connected-sites').querySelector('a')?.getAttribute('href')).toBe('#accounts')
  expect(button(row('party-invite'), 'Clear')).toBeFalsy()
  expect(button(row('stub-list'), 'Clear')).toBeFalsy()
})
