// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { PluginStatus } from '../../../src/plugins'

// The Sources category of the settings page: the sources the viewer added from npm, and the two ways to
// add more. FKN is faked: the plugin runtime is replaced by a list in memory.

const fake = vi.hoisted(() => ({
  statuses: [] as PluginStatus[],
  listeners: new Set<() => void>(),
}))
const calls = vi.hoisted(() => ({
  addPlugins: vi.fn(async () => {}),
  enablePlugin: vi.fn(async (uri: string): Promise<string | null> => uri),
  disablePlugin: vi.fn(async (_uri: string) => {}),
}))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => fake.statuses,
  onPluginsChange: (listener: () => void) => {
    fake.listeners.add(listener)
    return () => { fake.listeners.delete(listener) }
  },
  ...calls,
}))

const { SourcesSection } = await import('../../../src/router/settings/sources')

const hosts: HTMLElement[] = []
beforeEach(() => { for (const call of Object.values(calls)) call.mockClear() })
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  fake.statuses = []
})

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

const render = (statuses: PluginStatus[] = []) => {
  fake.statuses = statuses
  const host = mount(<SourcesSection/>)
  hosts.push(host)
  const row = (uri: string) => host.querySelector<HTMLElement>(`[data-plugin="${uri}"]`)!
  return { host, row }
}

const CONNECTED: PluginStatus = { uri: 'npm:@spec/one', state: 'connected', sources: [{ origin: 'one', name: 'One' }] }
const FAMILY: PluginStatus = {
  uri: 'npm:@spec/family',
  state: 'connected',
  sources: [{ origin: 'a', name: 'Alpha' }, { origin: 'b', name: 'Beta' }, { origin: 'c', name: 'Gamma' }],
  rejected: [{ origin: 'd', reason: 'no catalogue' }],
}
const CONNECTING: PluginStatus = { uri: 'npm:@spec/slow', state: 'connecting' }
const FAILED: PluginStatus = { uri: 'npm:@spec/broken', state: 'error', error: "connecting to 'npm:@spec/broken' timed out" }

test('lists only the sources the viewer added, not the ones stub ships with', () => {
  const { host } = render([CONNECTED])
  expect(host.querySelectorAll('[data-source]')).toHaveLength(0)
  expect(host.textContent).not.toContain('Built in')
  expect(host.textContent).not.toContain('Crunchyroll')
  expect(host.querySelectorAll('[data-plugin]')).toHaveLength(1)
})

test('with nothing added, says so in place of the list', () => {
  const { host } = render()
  expect(host.querySelector('.empty')?.textContent).toBe('No sources added yet.')
  expect(host.querySelectorAll('[data-plugin]')).toHaveLength(0)
  expect(render([CONNECTED]).host.querySelector('.empty'), 'and not once one is added').toBeNull()
})

test('each source shows its name, its address beneath, and its state', () => {
  const { row } = render([CONNECTED, CONNECTING, FAILED])
  const pill = (uri: string) => row(uri).querySelector('.pill')!
  expect(row(CONNECTED.uri).querySelector('.name')!.textContent).toBe('One')
  expect(row(CONNECTED.uri).querySelector('.uri')!.textContent).toBe('npm:@spec/one')
  expect([pill(CONNECTED.uri), pill(CONNECTING.uri), pill(FAILED.uri)].map(element => [element.getAttribute('data-state'), element.textContent]))
    .toEqual([['connected', 'Connected'], ['connecting', 'Connecting'], ['error', 'Error']])
  expect(row(CONNECTING.uri).querySelector('.name')!.textContent, 'before it registers, the package names it').toBe('@spec/slow')
})

test('a source that failed shows the whole error under its row', () => {
  const { row } = render([FAILED, CONNECTED])
  expect(row(FAILED.uri).querySelector('.failure')!.textContent).toBe("connecting to 'npm:@spec/broken' timed out")
  expect(row(CONNECTED.uri).querySelector('.failure')).toBeNull()
})

test('a package registering several sources says how many, and how many could not be', () => {
  const { row } = render([FAMILY])
  expect(row(FAMILY.uri).querySelector('.name')!.textContent).toBe('Alpha, Beta, Gamma')
  expect(row(FAMILY.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/family · 3 sources · 1 unavailable')
})

test('Remove is named for its source and removes that one', async () => {
  const { row } = render([CONNECTED, FAILED])
  const remove = button(row(FAILED.uri), 'Remove')!
  expect(remove.getAttribute('aria-label')).toBe('Remove @spec/broken')
  await act(async () => { remove.click() })
  expect(calls.disablePlugin).toHaveBeenCalledWith(FAILED.uri)
})

test('Browse sources opens FKN\'s picker', async () => {
  const { host } = render()
  await act(async () => { button(host, 'Browse sources')!.click() })
  expect(calls.addPlugins).toHaveBeenCalledTimes(1)
})

const typeAddress = async (host: HTMLElement, value: string) => {
  const input = host.querySelector<HTMLInputElement>('.group input')!
  await act(async () => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
const submit = (host: HTMLElement) => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

test('the address input and its Add button are one group, under a label, with a hint', () => {
  const { host } = render()
  const group = host.querySelector('.group')!
  const input = group.querySelector('input')!
  expect([...group.children].map(child => child.tagName)).toEqual(['INPUT', 'BUTTON'])
  expect(group.querySelector('button')!.textContent).toBe('Add')
  expect(input.getAttribute('placeholder')).toBe('npm:@scope/package')
  expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Or add one by its address')
  const described = input.getAttribute('aria-describedby')!.split(' ').map(id => host.querySelector(`[id="${id}"]`)?.textContent)
  expect(described).toContain('An npm package, or a local dev address such as localhost:4599.')
})

test('while adding, the button reads Adding... and is disabled; once added, the address is cleared', async () => {
  let finish!: (uri: string) => void
  calls.enablePlugin.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { host } = render()
  const input = await typeAddress(host, '  npm:@spec/one  ')
  await submit(host)

  expect(calls.enablePlugin).toHaveBeenCalledWith('npm:@spec/one')
  const add = host.querySelector<HTMLButtonElement>('.group button')!
  expect(add.textContent).toBe('Adding...')
  expect(add.disabled).toBe(true)

  await act(async () => { finish('npm:@spec/one') })
  await flush()
  expect(add.textContent).toBe('Add')
  expect(add.disabled).toBe(false)
  expect(input.value).toBe('')
})

test('an address FKN refuses shows its error under the group, marks the group and keeps the address', async () => {
  calls.enablePlugin.mockRejectedValueOnce(new Error("'nope' is not an npm package or a local address"))
  const { host } = render()
  const input = await typeAddress(host, 'nope')
  await submit(host)
  await flush()

  const error = host.querySelector('[role="alert"]')!
  expect(error.textContent).toBe("'nope' is not an npm package or a local address")
  expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(error.id)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelector('.group')!.classList.contains('invalid')).toBe(true)
  expect(input.value).toBe('nope')

  // and the next try starts clean
  await typeAddress(host, 'npm:@spec/one')
  await submit(host)
  await flush()
  expect(error.textContent).toBe('')
  expect(input.hasAttribute('aria-invalid')).toBe(false)
  expect(host.querySelector('.group')!.classList.contains('invalid')).toBe(false)
})

test('declining FKN\'s confirm keeps the address, and an empty one asks nothing', async () => {
  calls.enablePlugin.mockResolvedValueOnce(null)
  const { host } = render()
  const input = await typeAddress(host, 'npm:@spec/one')
  await submit(host)
  await flush()
  expect(input.value).toBe('npm:@spec/one')

  calls.enablePlugin.mockClear()
  await typeAddress(host, '   ')
  await submit(host)
  expect(calls.enablePlugin).not.toHaveBeenCalled()
})
