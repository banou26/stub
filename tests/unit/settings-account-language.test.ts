// HOR-1026 (stub in the viewer's language): a language picked while FKN did not answer is carried over the reload
// (./settings-sync.test.ts), and the page's load makes it again, so the account's older pick does not win.
import { expect, test, vi } from 'vite-plus/test'

import { CARRIED_LANGUAGE_KEY, LANGUAGE_KEY } from '../../src/i18n/languages'
import { ACCOUNT_SETTINGS_KEY } from '../../src/settings-store'
import { SETTINGS_PATH } from '../../src/settings-sync'

const account = await vi.hoisted(async () => {
  const { fknWorld } = await import('./tracking/fkn-fake')
  const { fknTrackerCloud } = await import('../../src/tracking/fkn-cloud')
  const world = fknWorld()
  const browser = world.browser({ account: 'alice' })
  return { world, browser, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }) }
})
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: account.cloud, onTrackerAccountChange: account.browser.onChange }))

const storageOf = (items: Map<string, string>) => ({
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => { items.set(key, value) },
  removeItem: (key: string) => { items.delete(key) },
})
// as the last load left them: the account's copy showing its pick, and the pick carried
const stored = new Map([[ACCOUNT_SETTINGS_KEY, JSON.stringify({ [LANGUAGE_KEY]: 'ja' })]])
const session = new Map([[CARRIED_LANGUAGE_KEY, 'ja']])
vi.stubGlobal('localStorage', storageOf(stored))
vi.stubGlobal('sessionStorage', storageOf(session))
account.world.storageOf('alice').set(SETTINGS_PATH, { text: JSON.stringify({ [LANGUAGE_KEY]: 'de' }), updatedAt: new Date(0).toISOString() })

const { checkSettings } = await import('../../src/settings-account')

test('the load makes the carried pick again, which the account then takes over its older one', async () => {
  expect(session.size, 'carried once').toBe(0)
  await checkSettings()
  expect(JSON.parse(account.world.storageOf('alice').get(SETTINGS_PATH)!.text)).toEqual({ [LANGUAGE_KEY]: 'ja' })
  expect(JSON.parse(stored.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [LANGUAGE_KEY]: 'ja' })
})
