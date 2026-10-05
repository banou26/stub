// What a Clear does beyond the item's keys, for the three items that are more than their keys: the
// worker holds a copy of the keys, each added source holds a connection and an FKN install, and the
// party store holds the name for the page.
import { beforeEach, expect, test, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  clearKeys: vi.fn(async () => {}),
  disableAllPlugins: vi.fn(() => new Promise<void>(() => {})),
  setName: vi.fn(),
}))
vi.mock('../../../src/utils/keys', () => ({ clearKeys: calls.clearKeys }))
vi.mock('../../../src/plugins', () => ({ disableAllPlugins: calls.disableAllPlugins }))
vi.mock('../../../src/party', () => ({ party: { setName: calls.setName } }))

const { clearers } = await import('../../../src/router/settings/clearers')
const { STORED, isClearedHere } = await import('../../../src/router/settings/stored-data')

beforeEach(() => { for (const call of Object.values(calls)) call.mockClear() })

test('clearing the keys clears the worker\'s copy too', async () => {
  await clearers['api-keys']()
  expect(calls.clearKeys).toHaveBeenCalledTimes(1)
})

test('clearing the added sources removes each one, without waiting on FKN to uninstall them', async () => {
  const cleared = await Promise.race([Promise.resolve(clearers['added-sources']()).then(() => 'returned'), new Promise(resolve => setTimeout(() => resolve('waited'), 50))])
  expect(cleared).toBe('returned')
  expect(calls.disableAllPlugins).toHaveBeenCalledTimes(1)
})

test('clearing the party name forgets the name the page holds, not only the stored one', async () => {
  await clearers['party-name']()
  expect(calls.setName).toHaveBeenCalledWith(undefined)
})

test('names only items the Data section clears', () => {
  const clearable = STORED.filter(isClearedHere).map(item => item.id)
  for (const id of Object.keys(clearers)) expect(clearable, id).toContain(id)
})
