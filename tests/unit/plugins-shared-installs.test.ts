// A page load whose list names a source FKN no longer holds: FKN keeps one install record for every stub
// site, so a source removed on one of them fails to connect on the others. Only FKN's list says which.
import { expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_PLUGINS_KEY, ENABLED_PLUGINS_KEY } from '../../src/plugin-list'

const fkn = vi.hoisted(() => ({
  list: vi.fn((): Promise<{ uri: string }[]> => new Promise(() => {})),
  connect: vi.fn(async (uri: string) => { throw new Error(`'${uri}' is not installed by this app`) }),
  uninstall: vi.fn(async (_uri: string) => {}),
}))
vi.mock('@fkn/lib', () => ({ packages: { list: fkn.list, connect: fkn.connect, uninstall: fkn.uninstall, install: vi.fn(), pick: vi.fn() } }))
vi.mock('../../src/worker', () => ({ registerRemoteSource: vi.fn(), unregisterRemoteSource: vi.fn() }))
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: {}, onTrackerAccountChange: () => {} }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})
vi.spyOn(console, 'warn').mockImplementation(() => {})

const GONE = 'https:stub.plugins.banou.dev'
// a list kept before stub stored FKN's own ids still names the version FKN lists without
const HELD = 'npm:@banou/held@1.2.3'
const ACCOUNT = 'npm:@banou/account'

const load = (device: string[], account?: string[]) => {
  stored.clear()
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify(device))
  if (account) stored.set(ACCOUNT_PLUGINS_KEY, JSON.stringify(account))
  vi.resetModules()
  return import('../../src/plugins')
}

test("a source FKN's list does not answer for stays, and shows its failure once the wait is over", async () => {
  let refuse!: () => void
  fkn.connect.mockImplementationOnce(() => new Promise((_, reject) => { refuse = () => reject(new Error('not installed')) }))
  const page = await load([GONE])
  vi.useFakeTimers()
  try {
    refuse()
    await vi.advanceTimersByTimeAsync(4_900)
    expect(page.pluginStatuses()).toEqual([{ uri: GONE, state: 'connecting' }])
    await vi.advanceTimersByTimeAsync(100)
    expect(page.pluginStatuses()).toEqual([{ uri: GONE, state: 'error' }])
    expect(stored.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([GONE]))
  } finally {
    vi.useRealTimers()
  }
})

test("a source FKN no longer holds leaves this site's list unseen; one it holds, or the account's list's, shows its failure", async () => {
  let answer!: (held: { uri: string }[]) => void
  const listed = new Promise<{ uri: string }[]>(resolve => { answer = resolve })
  fkn.list.mockImplementation(() => listed)
  const page = await load([GONE, HELD], [ACCOUNT])
  await vi.waitFor(() => expect(fkn.list).toHaveBeenCalledTimes(3))
  expect(page.pluginStatuses(), 'nothing shows as failed while FKN is asked').toEqual([ACCOUNT, GONE, HELD].map(uri => ({ uri, state: 'connecting' })))

  answer([{ uri: 'npm:@banou/held' }])
  await vi.waitFor(() => expect(page.pluginStatuses()).toEqual([{ uri: ACCOUNT, state: 'error' }, { uri: HELD, state: 'error' }]))
  expect(stored.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([HELD]))
  expect(stored.get(ACCOUNT_PLUGINS_KEY)).toBe(JSON.stringify([ACCOUNT]))
  expect(fkn.uninstall).not.toHaveBeenCalled()
})
