// A plugin source's own picker (src/plugin-api.ts, `selectRelease`): what the worker hands it when the page opens it.
import { afterEach, expect, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))
// the package's payload, as the port would carry it
const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const { registerRemoteExtractor, selectRemoteRelease, unregisterRemoteExtractor } = await import('../../../src/worker/extractor')

const PACKAGE = 'https:picker.spec.test'
const URIS = ['spec-picker:1', 'spec-picker:2']

afterEach(() => { unregisterRemoteExtractor(PACKAGE) })

// STUB-351: the picker marks the release the watch page plays
test('a source\'s picker is handed the release playing, and none with none playing', async () => {
  const selectRelease = vi.fn(async (_uris: string[], _options?: { playing?: string }) => 'spec-picker:1')
  port.payload = { sources: [{ origin: 'spec-picker', originUrl: 'https://spec-picker.test', name: 'Spec', isApiOnly: false, resolvers: {}, selectRelease }] }
  await registerRemoteExtractor(new MessageChannel().port1, PACKAGE)
  expect(await selectRemoteRelease('spec-picker', URIS, 'spec-picker:2')).toBe('spec-picker:1')
  expect(selectRelease).toHaveBeenLastCalledWith(URIS, { playing: 'spec-picker:2' })
  await selectRemoteRelease('spec-picker', URIS)
  expect(selectRelease.mock.lastCall?.[1]).toEqual({ playing: undefined })
})
