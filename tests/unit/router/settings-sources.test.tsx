// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { PluginStatus } from '../../../src/plugins'

// The Sources category of the settings page: the sources stub ships with, each with a switch, the
// sources the viewer added from npm, and the two ways to add more. FKN is faked: the plugin runtime is
// replaced by a list in memory, and this browser's storage by a map.

const fake = vi.hoisted(() => ({
  statuses: [] as PluginStatus[],
  listeners: new Set<() => void>(),
}))
const calls = vi.hoisted(() => ({
  addPlugins: vi.fn(async () => {}),
  installPlugin: vi.fn(async (uri: string): Promise<string | null> => uri),
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
const { builtInSources } = await import('../../../src/sources/built-in')
const { DISABLED_SOURCES_KEY } = await import('../../../src/sources/disabled-sources')

const stored = new Map<string, string>()
const hosts: HTMLElement[] = []
beforeEach(() => {
  for (const call of Object.values(calls)) call.mockClear()
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  fake.statuses = []
  vi.unstubAllGlobals()
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

const switchOf = (host: HTMLElement, origin: string) => host.querySelector<HTMLInputElement>(`[data-source="${origin}"] input[role="switch"]`)!
// linkedom implements no `checked` property, so Preact renders the attribute; once a flip has set the
// property, as a click would, Preact keeps the property in step instead
const isOn = (input: HTMLInputElement) => (input.checked as boolean | undefined) ?? input.hasAttribute('checked')
const flip = (input: HTMLInputElement, on: boolean) => act(() => {
  Object.assign(input, { checked: on })
  input.dispatchEvent(new Event('change', { bubbles: true }))
})

// the owner, 2026-10-10: "display all of the native sources and make the user able to disable/enable
// them. By default obviously all enabled."
test('lists every source stub ships with, each with a switch, all on by default, above the added ones', () => {
  const { host } = render([CONNECTED])
  const switches = [...host.querySelectorAll<HTMLInputElement>('[data-source] input[role="switch"]')]

  expect(host.querySelectorAll('[data-source]')).toHaveLength(builtInSources.length)
  expect(switches.map(isOn)).toEqual(builtInSources.map(() => true))
  expect(host.querySelector('[data-source="cr"]')!.textContent).toBe('Crunchyrollcrunchyroll.com')
  expect(host.querySelector('[data-source="imdb"]'), 'the placeholder origin answers nothing, so it has no switch').toBeNull()
  expect(host.querySelector('.count')!.textContent).toBe(`All ${builtInSources.length} on`)
  expect(button(host, 'Turn all on')!.getAttribute('aria-disabled'), 'mounted, and inert while all are on').toBe('true')
  expect(host.querySelectorAll('[data-plugin]')).toHaveLength(1)
})

test('a source turned off stays off in this browser, the count says so, and Turn all on brings them back', async () => {
  const { host } = render()
  await flip(switchOf(host, 'simkl'), false)
  await flip(switchOf(host, 'tvdb'), false)

  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['simkl', 'tvdb'])
  expect(isOn(switchOf(host, 'simkl'))).toBe(false)
  expect(switchOf(host, 'simkl').closest('label')!.classList.contains('off')).toBe(true)
  expect(host.querySelector('.count')!.textContent).toBe(`${builtInSources.length - 2} of ${builtInSources.length} on`)
  expect(button(host, 'Turn all on')!.hasAttribute('aria-disabled')).toBe(false)
  expect(switchOf(host, 'simkl').getAttribute('aria-label'), 'a switch is named by its source alone').toBe('Simkl')
  expect(isOn(switchOf(render().host, 'tvdb')), 'a page opened later reads it back').toBe(false)

  await flip(switchOf(host, 'tvdb'), true)
  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['simkl'])
  await act(() => { button(host, 'Turn all on')!.click() })
  expect(stored.has(DISABLED_SOURCES_KEY)).toBe(false)
  expect([...host.querySelectorAll<HTMLInputElement>('[data-source] input[role="switch"]')].every(isOn)).toBe(true)
  expect(button(host, 'Turn all on')!.getAttribute('aria-disabled'), 'with all on there is nothing to turn on').toBe('true')
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
  expect(row(CONNECTING.uri).querySelector('.meta'), 'and its address is not said twice').toBeNull()
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
  calls.installPlugin.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { host } = render()
  const input = await typeAddress(host, '  npm:@spec/one  ')
  await submit(host)

  expect(calls.installPlugin).toHaveBeenCalledWith('npm:@spec/one')
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
  calls.installPlugin.mockRejectedValueOnce(new Error("'nope' is not an npm package or a local address"))
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
  calls.installPlugin.mockResolvedValueOnce(null)
  const { host } = render()
  const input = await typeAddress(host, 'npm:@spec/one')
  await submit(host)
  await flush()
  expect(input.value).toBe('npm:@spec/one')

  calls.installPlugin.mockClear()
  await typeAddress(host, '   ')
  await submit(host)
  expect(calls.installPlugin).not.toHaveBeenCalled()
})
