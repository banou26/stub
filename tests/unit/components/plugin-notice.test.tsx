// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

const plugins = vi.hoisted(() => ({
  statuses: [] as object[],
  listeners: new Set<() => void>(),
  enablePlugin: vi.fn(async (uri: string, _options?: unknown): Promise<{ uri: string, connected: Promise<void> } | null> => ({ uri, connected: Promise.resolve() })),
  disablePlugin: vi.fn(async (uri: string) => {
    plugins.statuses = plugins.statuses.filter(status => (status as { uri: string }).uri !== uri)
    for (const listener of plugins.listeners) listener()
  }),
}))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => plugins.statuses,
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
  enabledPluginUris: () => [],
  enablePlugin: plugins.enablePlugin,
  installPlugin: vi.fn(),
  installedPluginUris: async () => [],
  disablePlugin: plugins.disablePlugin,
  addedByLink: () => {},
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})

const { addInvites, closeInvites } = await import('../../../src/plugin-invites')
const { default: PluginNotice } = await import('../../../src/components/plugin-notice')

const NYAA = 'https:stub.plugins.banou.dev'
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  closeInvites()
  plugins.statuses = []
  plugins.disablePlugin.mockClear()
})

const drawn = async (uris: string[]) => {
  const host = mount(withIntl(<PluginNotice/>))
  hosts.push(host)
  await act(() => addInvites(uris))
  return host
}
const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent)
const press = (host: HTMLElement, label: string) => act(() => {
  [...host.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === label)!.click()
})

test('the live region is there before anything is said, or a screen reader never hears it arrive', async () => {
  const host = await drawn([])
  expect(host.querySelector('[role="status"]')).not.toBeNull()
  expect(buttons(host)).toEqual([])
})

test('a source says its name and that it was enabled, with Remove and OK, and no prompt', async () => {
  plugins.statuses = [{ uri: NYAA, state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }, { origin: 'tosho', name: 'AnimeTosho' }] }]
  const host = await drawn([NYAA])

  expect(host.querySelector('li span')!.textContent).toBe('Source enabled: Nyaa, AnimeTosho')
  expect(buttons(host)).toEqual(['Remove Nyaa, AnimeTosho', 'OK'])
  expect(host.querySelector('[role="status"] button')).not.toBeNull()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

test('several sources share one notice, each with its own Remove, and Remove takes only that one', async () => {
  const [one, two] = ['npm:@banou/one', 'npm:@banou/two']
  plugins.statuses = [{ uri: one, state: 'connected' }, { uri: two, state: 'connected' }]
  const host = await drawn([one, two])

  expect(host.querySelectorAll('.notice')).toHaveLength(1)
  expect([...host.querySelectorAll('li span')].map(line => line.textContent)).toEqual(['Source enabled: @banou/one', 'Source enabled: @banou/two'])
  expect(buttons(host)).toEqual(['Remove @banou/one', 'Remove @banou/two', 'OK'])

  press(host, 'Remove @banou/one')
  expect(plugins.disablePlugin.mock.calls).toEqual([[one]])
  expect(buttons(host)).toEqual(['Remove @banou/two', 'OK'])
})

test('OK closes it and removes nothing', async () => {
  plugins.statuses = [{ uri: NYAA, state: 'connected' }]
  const host = await drawn([NYAA])
  press(host, 'OK')

  expect(buttons(host)).toEqual([])
  expect(plugins.disablePlugin).not.toHaveBeenCalled()
})

test('the last Remove closes it', async () => {
  plugins.statuses = [{ uri: NYAA, state: 'connected' }]
  const host = await drawn([NYAA])
  press(host, `Remove ${NYAA}`)

  expect(host.querySelector('.notice')).toBeNull()
})

test('an install FKN refused says so in one line, with nothing to remove', async () => {
  plugins.enablePlugin.mockRejectedValueOnce(new Error("'not a package' is not an npm package"))
  const host = await drawn(['npm:not-a-package'])

  expect(host.querySelector('.failed')!.textContent).toBe('Could not add not-a-package')
  expect(host.textContent).not.toContain('is not an npm package')
  expect(buttons(host)).toEqual(['OK'])
})

test('a source that installed and failed to connect is removed again, so it says so with nothing to remove', async () => {
  const connected = Promise.reject(new Error('failed to boot'))
  connected.catch(() => {})
  plugins.enablePlugin.mockResolvedValueOnce({ uri: NYAA, connected })
  plugins.statuses = [{ uri: NYAA, state: 'error' }]
  const host = await drawn([NYAA])

  expect(host.querySelector('.failed')!.textContent).toBe(`Could not add ${NYAA}`)
  expect(buttons(host)).toEqual(['OK'])
})

test('a source that left the list since, in Settings or anywhere else, is no longer said enabled', async () => {
  const [one, two] = ['npm:@banou/one', 'npm:@banou/two']
  plugins.statuses = [{ uri: one, state: 'connected' }, { uri: two, state: 'connected' }]
  const host = await drawn([one, two])

  await act(() => plugins.disablePlugin(one))
  expect([...host.querySelectorAll('li span')].map(line => line.textContent)).toEqual(['Source enabled: @banou/two'])

  await act(() => plugins.disablePlugin(two))
  expect(host.querySelector('.notice'), 'nothing left to say').toBeNull()
})
