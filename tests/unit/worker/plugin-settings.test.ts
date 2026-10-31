// What a package asks the viewer for (docs: request/plugins.md, "What a plugin asks the viewer for"): what the worker
// reads of its fields, and how the values reach the package over its connection.
import { inspect } from 'node:util'
import { afterEach, expect, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))
// the package's payload, as the port would carry it
const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const { configureRemoteExtractor, extractors, registerRemoteExtractor, unregisterRemoteExtractor } = await import('../../../src/worker/extractor')
const { CONFIGURE_WAIT_MS } = await import('../../../src/worker/plugin-sources')

const PACKAGE = 'https:settings.spec.test'
const VALUES = { address: 'https://server.spec.test', apiKey: 'a-saved-value' }
const source = (origin: string) => ({ origin, originUrl: `https://${origin}.test`, name: origin, isApiOnly: false, resolvers: {} })
const register = (payload: object, values?: Record<string, string>) => {
  port.payload = payload
  return registerRemoteExtractor(new MessageChannel().port1, PACKAGE, values)
}
const registered = (origin: string) => extractors.some(entry => entry.extractor.origin === origin)

afterEach(() => {
  vi.useRealTimers()
  unregisterRemoteExtractor(PACKAGE)
})

test('the page learns the fields a package lists, beside a single source or a family, and none of an older package', async () => {
  const settings = [{ key: 'address', label: 'Address', kind: 'url', required: true }, { key: 'apiKey', label: 'API key', kind: 'secret' }]
  const read = [settings[0], { ...settings[1], required: false }]
  expect((await register({ ...source('spec-one'), settings })).settings).toEqual(read)
  expect((await register({ sources: [source('spec-a'), source('spec-b')], settings })).settings).toEqual(read)
  expect((await register(source('spec-older'))).settings).toEqual([])
})

test('a malformed or repeated field costs only itself', async () => {
  const good = { key: 'address', label: 'Address', kind: 'url', required: false }
  const { settings } = await register({
    ...source('spec-one'),
    settings: [
      good,
      { ...good, label: 'Twice' },
      { label: 'No key', kind: 'text' },
      { key: '', label: 'Empty key', kind: 'text' },
      { key: 'nolabel', kind: 'text' },
      { key: 'emptylabel', label: '', kind: 'text' },
      { key: 'oddkind', label: 'Odd', kind: 'number' },
      'junk',
      null,
      { key: 'long', label: 'x'.repeat(200), kind: 'text' },
    ],
  })
  expect(settings.map(field => field.key)).toEqual(['address', 'long'])
  expect(settings[1]!.label).toHaveLength(64)
})

// the form reads a saved value by key, so `constructor` would read Object's own member and fail Settings as it renders
test.each(['constructor', 'toString', 'valueOf', '__proto__'])('a field keyed %s, a member of every object, costs only itself', async key => {
  const { settings } = await register({ ...source('spec-one'), settings: [{ key, label: 'Odd', kind: 'text' }, { key: 'address', label: 'Address', kind: 'url' }] })
  expect(settings.map(field => field.key)).toEqual(['address'])
})

test('a list of fields that is no list is none', async () => {
  expect((await register({ ...source('spec-one'), settings: 'junk' })).settings).toEqual([])
})

// a fan-out still open asks a source the moment it joins, so a source joined first would answer without its address
test('a package takes its values on connecting, before any of its sources can be asked', async () => {
  let taken = () => {}
  const configure = vi.fn(() => new Promise<void>(resolve => { taken = resolve }))
  const registering = register({ ...source('spec-one'), configure }, VALUES)
  await vi.waitFor(() => expect(configure).toHaveBeenCalledExactlyOnceWith(VALUES))
  expect(registered('spec-one'), 'not asked until it took them').toBe(false)
  taken()
  await registering
  expect(registered('spec-one')).toBe(true)
})

test('values saved later reach the package at once on its connection, and a connection gone takes nothing', async () => {
  const configure = vi.fn(async () => {})
  await register({ sources: [source('spec-a'), source('spec-b')], configure })
  expect(configure).toHaveBeenCalledExactlyOnceWith({})
  await configureRemoteExtractor(PACKAGE, VALUES)
  expect(configure).toHaveBeenLastCalledWith(VALUES)
  unregisterRemoteExtractor(PACKAGE)
  configure.mockClear()
  await configureRemoteExtractor(PACKAGE, VALUES)
  expect(configure).not.toHaveBeenCalled()
})

/** A package whose `configure` holds its sources back until `take` is called, once it was called. */
const waiting = async (payload: object) => {
  let take = () => {}
  const configure = vi.fn(() => new Promise<void>(resolve => { take = resolve }))
  const registering = register({ ...payload, configure }, VALUES)
  await vi.waitFor(() => expect(configure).toHaveBeenCalled())
  return { registering, configure, take: () => take() }
}

// nothing removes a source that joins after its removal, so it would be asked over a dead port until a reload
test('a source removed while it takes its values never joins', async () => {
  const { registering, take } = await waiting(source('spec-gone'))
  unregisterRemoteExtractor(PACKAGE)
  take()
  await expect(registering).rejects.toThrow('left while connecting')
  expect(registered('spec-gone')).toBe(false)
})

test('a connection left behind while it takes its values does not replace the one after it', async () => {
  const { registering, configure, take } = await waiting(source('spec-one'))
  const newer = vi.fn(async () => {})
  await register({ ...source('spec-one'), configure: newer }, VALUES)
  take()
  await expect(registering).rejects.toThrow('left while connecting')
  expect(registered('spec-one')).toBe(true)
  await configureRemoteExtractor(PACKAGE, {})
  expect(newer).toHaveBeenLastCalledWith({})
  expect(configure).toHaveBeenCalledTimes(1)
})

test('a reconnect takes the values on its own connection, and the next save reaches that one', async () => {
  const first = vi.fn(async () => {})
  const second = vi.fn(async () => {})
  await register({ ...source('spec-one'), configure: first }, VALUES)
  await register({ ...source('spec-one'), configure: second }, VALUES)
  expect(second).toHaveBeenCalledExactlyOnceWith(VALUES)
  await configureRemoteExtractor(PACKAGE, {})
  expect(second).toHaveBeenLastCalledWith({})
  expect(first).toHaveBeenCalledTimes(1)
})

test('a package that serves no configure registers as before, and saving has nothing to reach', async () => {
  await register(source('spec-older'), VALUES)
  expect(registered('spec-older')).toBe(true)
  await expect(configureRemoteExtractor(PACKAGE, VALUES)).resolves.toBeUndefined()
})

test('a package that rejects keeps its sources, and what it said is logged nowhere', async () => {
  const lines = vi.fn()
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(lines))
  try {
    const { sources } = await register({ ...source('spec-one'), configure: async (values: { apiKey: string }) => { throw new Error(`refused ${values.apiKey}`) } }, VALUES)
    expect(sources.map(({ origin }) => origin)).toEqual(['spec-one'])
    await expect(configureRemoteExtractor(PACKAGE, VALUES)).resolves.toBeUndefined()
    expect(inspect(lines.mock.calls, { depth: 8 })).not.toContain(VALUES.apiKey)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
})

test('a package that never answers holds its sources back for CONFIGURE_WAIT_MS at most', async () => {
  vi.useFakeTimers()
  void register({ ...source('spec-one'), configure: () => new Promise(() => {}) }, VALUES)
  await vi.advanceTimersByTimeAsync(CONFIGURE_WAIT_MS - 1)
  expect(registered('spec-one')).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(registered('spec-one')).toBe(true)
})
