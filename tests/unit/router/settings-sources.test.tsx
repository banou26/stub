// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount, withIntl } from '../components/dom'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { PluginStatus } from '../../../src/plugins'
import type { AccountsProps } from '../../../src/router/settings/accounts'

// The Sources category of the settings page: a card for every source stub ships with or the viewer
// added, each with its switches and its sign-in, then the packages the viewer added and the two ways to
// add more. FKN is faked: the plugin runtime is replaced by a list in memory, and this browser's storage
// by a map. tests/unit/router/settings-accounts.test.tsx covers the sign-ins themselves.

const fake = vi.hoisted(() => ({
  statuses: [] as PluginStatus[],
  listeners: new Set<() => void>(),
}))
const calls = vi.hoisted(() => ({
  addPlugins: vi.fn(async () => {}),
  installPlugin: vi.fn(async (uri: string): Promise<string | null> => uri),
  disablePlugin: vi.fn(async (_uri: string) => {}),
  configurePlugin: vi.fn(async (_uri: string, _values: object) => {}),
}))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ ChevronDown: () => null, ChevronUp: () => null, GripVertical: () => null }))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => fake.statuses,
  onPluginsChange: (listener: () => void) => {
    fake.listeners.add(listener)
    return () => { fake.listeners.delete(listener) }
  },
  ...calls,
}))

const { SourcesSection } = await import('../../../src/router/settings/sources')
const { startLanguage } = await import('../../../src/i18n')
const { builtInSources } = await import('../../../src/sources/built-in')
const { DISABLED_SOURCES_KEY } = await import('../../../src/sources/disabled-sources')
const { PLUGIN_VALUES_KEY } = await import('../../../src/plugin-list')
const { readPluginSettings } = await import('../../../src/worker/plugin-sources')
const { HIDDEN_ICONS_KEY } = await import('../../../src/sources/hidden-icons')
const { DEFAULT_MERGE_ORDER } = await import('../../../src/sources/merge-order')

const ACCOUNTS: AccountsProps = {
  backend: 'cloud',
  crunchyroll: { signIn: async () => 'authed', signOut: async () => {} },
  prime: { signIn: async () => 'authed', signOut: async () => {} },
  sites: { isConnected: () => false, watch: () => () => {}, signIn: async () => 'authed', signOut: async () => {} },
  status: { read: () => undefined, watch: () => () => {}, refresh: () => {} },
}

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
  const host = mount(withIntl(<SourcesSection {...ACCOUNTS}/>))
  hosts.push(host)
  const row = (uri: string) => host.querySelector<HTMLElement>(`[data-plugin="${uri}"]`)!
  return { host, row }
}

const CONNECTED: PluginStatus = { uri: 'npm:@spec/one', state: 'connected', sources: [{ origin: 'one', name: 'One', icon: 'https://one.spec.test/icon.png', isApiOnly: false }] }
const FAMILY: PluginStatus = {
  uri: 'npm:@spec/family',
  state: 'connected',
  sources: [{ origin: 'a', name: 'Alpha' }, { origin: 'b', name: 'Beta' }, { origin: 'c', name: 'Gamma' }],
  rejected: [{ origin: 'd', reason: 'no catalogue' }],
}
const CONNECTING: PluginStatus = { uri: 'npm:@spec/slow', state: 'connecting' }
const FAILED: PluginStatus = { uri: 'npm:@spec/broken', state: 'error' }

const card = (host: HTMLElement, origin: string) => host.querySelector<HTMLElement>(`[data-source="${origin}"]`)!
const switchOf = (host: HTMLElement, origin: string) => card(host, origin).querySelector<HTMLInputElement>('input[aria-label$=" source"]')!
const iconSwitchOf = (host: HTMLElement, origin: string) => card(host, origin).querySelector<HTMLInputElement>('input[aria-label$=" icon"]')
// linkedom implements no `checked` property, so Preact renders the attribute; once a flip has set the
// property, as a click would, Preact keeps the property in step instead
const isOn = (input: HTMLInputElement) => (input.checked as boolean | undefined) ?? input.hasAttribute('checked')
const flip = (input: HTMLInputElement, on: boolean) => act(() => {
  Object.assign(input, { checked: on })
  input.dispatchEvent(new Event('change', { bubbles: true }))
})

// the owner, 2026-10-25 (HOR-1019): "for every source, we have a card, with its icon/logo, the name, the
// source enable/disable, the show icon enable/disable, and a 'log into account' within the card"
test('a card for every source stub ships with or an added package registered, those Play tries first, each on by default', () => {
  const { host } = render([CONNECTED, FAMILY, FAILED])
  const cards = [...host.querySelectorAll<HTMLElement>('[data-source]:not(.brief)')]
  const players = ['cr', 'amazon', 'nf', 'one', 'a', 'b', 'c']
  const merged = DEFAULT_MERGE_ORDER.filter(origin => !players.includes(origin))
  expect(cards.map(item => item.getAttribute('data-source'))).toEqual([...players, ...merged, ...builtInSources.map(source => source.origin).filter(origin => !players.includes(origin) && !merged.includes(origin))])
  expect([...host.querySelectorAll('.brief')].map(item => item.getAttribute('data-source')), 'a player the merge weighs is ranked there again').toEqual(['cr', 'nf'])
  expect(cards.map(item => isOn(item.querySelector<HTMLInputElement>('input[aria-label$=" source"]')!))).toEqual(cards.map(() => true))
  expect(card(host, 'imdb'), 'the placeholder origin answers nothing, so it has no card').toBeNull()
  expect(host.querySelector('.count')!.textContent).toBe(`All ${builtInSources.length + 4} on`)
  expect(button(host, 'Turn all on')!.getAttribute('aria-disabled'), 'mounted, and inert while all are on').toBe('true')
})

test('a card shows the source\'s icon, or its initial without one, its name, and the site it reads or the package that added it', () => {
  const { host } = render([CONNECTED, FAMILY])
  const icon = (origin: string) => card(host, origin).querySelector('.icon')!
  expect(icon('cr').querySelector('img')!.getAttribute('src')).toBe(builtInSources.find(source => source.origin === 'cr')!.icon)
  expect(icon('anizip').querySelector('img')).toBeNull()
  expect(icon('anizip').textContent).toBe('A')
  expect(icon('one').querySelector('img')!.getAttribute('src')).toBe('https://one.spec.test/icon.png')
  expect(icon('a').textContent, 'a package\'s source with no icon').toBe('A')
  expect([card(host, 'cr'), card(host, 'one')].map(item => [item.querySelector('h4')!.textContent, item.querySelector('.from')!.textContent]))
    .toEqual([['Crunchyroll', 'crunchyroll.com'], ['One', 'npm:@spec/one']])
})

test('a card has a Source and an Icon switch side by side, named for its source, and no Icon switch where stub draws no icon', () => {
  const { host } = render([CONNECTED, { ...FAMILY, sources: [{ origin: 'a', name: 'Alpha', isApiOnly: true }] }])
  const labels = (origin: string) => [...card(host, origin).querySelectorAll('.switches label')].map(label => [label.textContent, label.querySelector('input')!.getAttribute('aria-label')])
  expect(labels('tvdb')).toEqual([['Source', 'TheTVDB source'], ['Icon', 'TheTVDB icon']])
  expect(labels('kitsu'), 'stub never draws an api only source').toEqual([['Source', 'Kitsu source']])
  expect(labels('one')).toEqual([['Source', 'One source'], ['Icon', 'One icon']])
  expect(labels('a'), 'nor an api only source a package registered').toEqual([['Source', 'Alpha source']])
})

test('a source turned off stays off in this browser, its card says so, the count follows, and Turn all on brings them back', async () => {
  const { host } = render()
  await flip(switchOf(host, 'simkl'), false)
  await flip(switchOf(host, 'tvdb'), false)

  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['simkl', 'tvdb'])
  expect(isOn(switchOf(host, 'simkl'))).toBe(false)
  expect(card(host, 'simkl').classList.contains('off')).toBe(true)
  expect(card(host, 'anilist').classList.contains('off')).toBe(false)
  expect(host.querySelector('.count')!.textContent).toBe(`${builtInSources.length - 2} of ${builtInSources.length} on`)
  expect(button(host, 'Turn all on')!.hasAttribute('aria-disabled')).toBe(false)
  expect(isOn(switchOf(render().host, 'tvdb')), 'a page opened later reads it back').toBe(false)

  await flip(switchOf(host, 'tvdb'), true)
  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['simkl'])
  await act(() => { button(host, 'Turn all on')!.click() })
  expect(stored.has(DISABLED_SOURCES_KEY)).toBe(false)
  expect([...host.querySelectorAll<HTMLInputElement>('[data-source] input[aria-label$=" source"]')].every(isOn)).toBe(true)
  expect(button(host, 'Turn all on')!.getAttribute('aria-disabled'), 'with all on there is nothing to turn on').toBe('true')
})

// the owner, 2026-10-25 (HOR-1019): "right now custom sources can't be disabled besides just removing the plugin"
test('a source an added package registered turns off without removing its package, and Turn all on brings it back', async () => {
  const { host, row } = render([CONNECTED])
  await flip(switchOf(host, 'one'), false)
  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['one'])
  expect(card(host, 'one').classList.contains('off')).toBe(true)
  expect(host.querySelector('.count')!.textContent).toBe(`${builtInSources.length} of ${builtInSources.length + 1} on`)
  expect(row(CONNECTED.uri), 'its package stays').not.toBeNull()
  expect(calls.disablePlugin).not.toHaveBeenCalled()

  await act(() => { button(host, 'Turn all on')!.click() })
  expect(stored.has(DISABLED_SOURCES_KEY)).toBe(false)
})

test('a package still connecting or that failed has no card, its row only', () => {
  const { host, row } = render([CONNECTING, FAILED])
  expect(host.querySelectorAll('[data-source]:not(.brief)')).toHaveLength(builtInSources.length)
  expect(row(CONNECTING.uri)).not.toBeNull()
  expect(row(FAILED.uri)).not.toBeNull()
})

test('hiding a source\'s icon keeps the source on, and IMDb\'s icon is hidden as imdb', async () => {
  const { host } = render()
  expect(isOn(iconSwitchOf(host, 'tvdb')!)).toBe(true)
  await flip(iconSwitchOf(host, 'tvdb')!, false)
  expect(JSON.parse(stored.get(HIDDEN_ICONS_KEY)!)).toEqual(['tvdb'])
  expect(isOn(iconSwitchOf(host, 'tvdb')!)).toBe(false)
  expect(isOn(switchOf(host, 'tvdb')), 'the source itself stays on').toBe(true)
  expect(card(host, 'tvdb').classList.contains('off')).toBe(false)
  expect(stored.has(DISABLED_SOURCES_KEY)).toBe(false)

  await flip(iconSwitchOf(host, 'omdb')!, false)
  expect(JSON.parse(stored.get(HIDDEN_ICONS_KEY)!)).toEqual(['tvdb', 'imdb'])
})

// the owner, 2026-10-25 (HOR-1019): "I think we can completely remove that Accounts category and also merge it with the Sources category"
test('the country comes first, and the sources stub signs in to hold their sign-in in their card, and no other card does', () => {
  const { host } = render()
  expect(host.querySelector('.rows > .row')?.getAttribute('data-setting')).toBe('country')
  const accounts = [...host.querySelectorAll('[data-account]')].map(account => [account.closest('[data-source]')!.getAttribute('data-source'), account.getAttribute('data-account')])
  expect(accounts).toEqual([['cr', 'crunchyroll'], ['amazon', 'prime'], ['nf', 'netflix'], ['mal', 'mal'], ['anilist', 'anilist']])
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

test('a source that failed says so in one line under its row', () => {
  const { row } = render([FAILED, CONNECTED])
  expect(row(FAILED.uri).querySelector('.failure')!.textContent).toBe('Could not connect to this source.')
  expect(row(CONNECTED.uri).querySelector('.failure')).toBeNull()
})

test('a package registering several sources says how many, and how many could not be', () => {
  const { row } = render([FAMILY])
  expect(row(FAMILY.uri).querySelector('.name')!.textContent).toBe('Alpha, Beta, Gamma')
  expect(row(FAMILY.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/family · 3 sources · 1 unavailable')
})

test('a package of two sources is named by both, and one of one source counts only those it could not register', () => {
  const PAIR: PluginStatus = { uri: 'npm:@spec/pair', state: 'connected', sources: [{ origin: 'a', name: 'Alpha' }, { origin: 'b', name: 'Beta' }] }
  const PARTLY: PluginStatus = { ...CONNECTED, rejected: [{ origin: 'x', reason: 'no catalogue' }, { origin: 'y', reason: 'no catalogue' }] }
  const { row } = render([PAIR, PARTLY])
  expect(row(PAIR.uri).querySelector('.name')!.textContent).toBe('Alpha, Beta')
  expect(row(PAIR.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/pair · 2 sources')
  expect(row(PAIR.uri).querySelector('button')!.getAttribute('aria-label')).toBe('Remove Alpha, Beta')
  expect(row(PARTLY.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/one · 2 unavailable')
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

test('the address input and its Add button are one group, under a label', () => {
  const { host } = render()
  const group = host.querySelector('.group')!
  const input = group.querySelector('input')!
  expect([...group.children].map(child => child.tagName)).toEqual(['INPUT', 'BUTTON'])
  expect(group.querySelector('button')!.textContent).toBe('Add')
  expect(input.getAttribute('placeholder')).toBe('npm:@scope/package')
  expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Or add one by its address')
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

test('an address FKN refuses says so in one line under the group, marks the group and keeps the address', async () => {
  calls.installPlugin.mockRejectedValueOnce(new Error("'nope' is not an npm package or a local address"))
  const { host } = render()
  const input = await typeAddress(host, 'nope')
  await submit(host)
  await flush()

  const error = host.querySelector('[role="alert"]')!
  expect(error.textContent).toBe('Could not add this source. Check the address.')
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

describe('in Russian', () => {
  beforeAll(() => startLanguage({ language: 'ru', languages: ['ru-RU'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('a package counts its sources and those it could not register in the forms each count takes', () => {
    const FIVE: PluginStatus = {
      uri: 'npm:@spec/five',
      state: 'connected',
      sources: ['a', 'b', 'c', 'd', 'e'].map(origin => ({ origin: `five-${origin}`, name: origin.toUpperCase() })),
      rejected: [{ origin: 'x', reason: 'no catalogue' }, { origin: 'y', reason: 'no catalogue' }],
    }
    const { row } = render([FAMILY, FIVE])
    expect(row(FAMILY.uri).querySelector('.name')!.textContent).toBe('Alpha, Beta, Gamma')
    expect(row(FAMILY.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/family · 3 источника · 1 недоступен')
    expect(row(FIVE.uri).querySelector('.meta')!.textContent).toBe('npm:@spec/five · 5 источников · 2 недоступны')
    expect(row(FIVE.uri).querySelector('.pill')!.textContent).toBe('Подключён')
    expect(row(FIVE.uri).querySelector('button')!.getAttribute('aria-label')).toBe('Удалить A, B, C, D, E')
  })
})

describe('a source that lists settings', () => {
  const ASKING: PluginStatus = {
    ...CONNECTED,
    settings: [
      { key: 'address', label: 'Server address', kind: 'url', required: true },
      { key: 'apiKey', label: 'Server key', kind: 'secret', required: true },
      { key: 'category', label: 'Category', kind: 'text' },
    ],
  }
  const SECRET = 'a-secret-the-page-keeps'
  const keep = (values: object) => stored.set(PLUGIN_VALUES_KEY, JSON.stringify({ [ASKING.uri]: values }))
  const field = (row: HTMLElement, label: string) => [...row.querySelectorAll('label')].find(item => item.textContent === label)!.querySelector('input')!
  const fill = (input: HTMLInputElement, value: string) => act(() => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = (row: HTMLElement) => act(async () => { row.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  const saveButton = (row: HTMLElement) => row.querySelector('form button')!

  test('shows a form on its row in the words of the plugin, each field its kind, and one that lists none shows none', () => {
    const { row } = render([ASKING, { ...FAILED }, { ...CONNECTED, uri: 'npm:@spec/two' }])
    expect([...row(ASKING.uri).querySelectorAll('label')].map(label => label.textContent)).toEqual(['Server address', 'Server key', 'Category'])
    expect([...row(ASKING.uri).querySelectorAll('input')].map(input => input.getAttribute('type'))).toEqual(['url', 'password', 'text'])
    expect([...row(ASKING.uri).querySelectorAll('input')].map(input => input.getAttribute('aria-required'))).toEqual(['true', 'true', null])
    expect(row(FAILED.uri).querySelector('form')).toBeNull()
    expect(row('npm:@spec/two').querySelector('form')).toBeNull()
  })

  test('a field keyed after a member of every object, as the worker reads it, leaves the form and the row standing', () => {
    const settings = readPluginSettings([{ key: 'constructor', label: 'Odd', kind: 'text' }, ASKING.settings![0]])
    const { row } = render([{ ...ASKING, settings }])
    expect([...row(ASKING.uri).querySelectorAll('label')].map(label => label.textContent)).toEqual(['Server address'])
  })

  test('what is kept but cannot be read shows an empty form, and the row stays', () => {
    stored.set(PLUGIN_VALUES_KEY, '{not json')
    const { row } = render([ASKING])
    expect(field(row(ASKING.uri), 'Server address').value).toBe('')
    expect(row(ASKING.uri).querySelector('.pill')!.textContent).toBe('Connected')
  })

  test('a secret is a password input, and what was saved for it is never on the page as text', () => {
    keep({ address: 'https://server.spec.test', apiKey: SECRET })
    const { host, row } = render([ASKING])
    const input = field(row(ASKING.uri), 'Server key')
    expect(input.getAttribute('type')).toBe('password')
    expect(input.value, 'it can be replaced or cleared').toBe(SECRET)
    expect(host.textContent).not.toContain(SECRET)
  })

  test('Save hands over what was entered, trimmed, without what was left empty, and has nothing to do until the next change', async () => {
    keep({ category: 'old' })
    const { row } = render([ASKING])
    const form = row(ASKING.uri)
    expect(saveButton(form).getAttribute('aria-disabled'), 'nothing to save yet').toBe('true')
    await save(form)
    expect(calls.configurePlugin).not.toHaveBeenCalled()

    await fill(field(form, 'Server address'), '  https://server.spec.test ')
    await fill(field(form, 'Server key'), SECRET)
    await fill(field(form, 'Category'), '   ')
    expect(saveButton(form).getAttribute('aria-disabled')).toBeNull()
    await save(form)
    expect(calls.configurePlugin).toHaveBeenCalledExactlyOnceWith(ASKING.uri, { address: 'https://server.spec.test', apiKey: SECRET })
    expect(field(form, 'Server address').value).toBe('https://server.spec.test')
    expect(saveButton(form).getAttribute('aria-disabled')).toBe('true')
  })

  test('Save stays on the page, whether or not there is anything to save', async () => {
    const { row } = render([ASKING])
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    await act(async () => { row(ASKING.uri).querySelector('form')!.dispatchEvent(submit) })
    expect(submit.defaultPrevented).toBe(true)
  })

  test('a required field left empty shows in one line on its row, until it is saved, and the rest of the list stays', async () => {
    keep({ address: 'https://server.spec.test' })
    const { row } = render([ASKING, FAMILY])
    const form = row(ASKING.uri)
    expect(form.querySelector('.failure')!.textContent).toBe('Required: Server key')
    expect(row(FAMILY.uri).querySelector('.failure'), 'on its own row').toBeNull()
    expect(row(FAMILY.uri).querySelector('.pill')!.textContent).toBe('Connected')

    await fill(field(form, 'Server key'), SECRET)
    expect(form.querySelector('.failure'), 'typed is not saved').not.toBeNull()
    await save(form)
    expect(form.querySelector('.failure')).toBeNull()
  })

  test('a required field can be saved empty, and so can every field', async () => {
    keep({ address: 'https://server.spec.test', apiKey: SECRET })
    const { row } = render([ASKING])
    const form = row(ASKING.uri)
    await fill(field(form, 'Server address'), '')
    await fill(field(form, 'Server key'), '')
    await save(form)
    expect(calls.configurePlugin).toHaveBeenCalledExactlyOnceWith(ASKING.uri, {})
    expect(form.querySelector('.failure')!.textContent).toBe('Required: Server address, Server key')
  })
})
