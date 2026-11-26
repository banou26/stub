import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))
const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const {
  CATALOG_ACTION_WAIT_MS,
  CATALOG_DESCRIBE_WAIT_MS,
  MAX_COPY_CHARS,
  MAX_DOWNLOAD_BYTES,
  askPluginCatalogAction,
  askPluginCatalogItems,
  readCatalogActionResult,
  readCatalogItems,
} = await import('../../../src/worker/plugin-sources')
const { setDisabledOrigins } = await import('../../../src/worker/disabled-origins')
const {
  fetchRemoteCatalogItems,
  registerRemoteExtractor,
  runRemoteCatalogAction,
  unregisterRemoteExtractor,
} = await import('../../../src/worker/extractor')

const PACKAGE = 'https:catalog.spec.test'

afterEach(() => {
  unregisterRemoteExtractor(PACKAGE)
  setDisabledOrigins([])
  vi.useRealTimers()
})

describe('worker generic catalog validation and registration', () => {
  test('readCatalogItems validates fields, deduplicates by uri, and filters by allowedUris', () => {
    const items = readCatalogItems([
      null,
      { uri: '', title: 'Missing URI' },
      { uri: 'alpha:1', title: '' },
      {
        uri: 'alpha:1',
        title: 'Clean Alpha',
        rawTitle: 'Raw Alpha 1080p',
        subtitle: 'Team A',
        resolution: 1080,
        videoQualities: ['1080p', 'HDR', '1080p'],
        audioQualities: ['5.1'],
        audioLanguages: ['ja', 'en'],
        subtitleLanguages: ['en', 'fr'],
        sizeBytes: 1_500_000_000,
        sizeText: '1.5 GiB',
        publishedAt: 1_700_000_000_000,
        badges: [
          { id: 'verified', label: 'Verified', tone: 'positive', filterable: true },
          { id: 'verified', label: 'Duplicate', tone: 'warning' },
          { id: 'bogus-tone', label: 'Fallback', tone: 'neon-purple' },
        ],
        metrics: [
          { id: 'rank', label: 'Score', value: 42, display: '42 pts', sort: 'desc', tone: 'positive' },
          { id: 'bad', label: 'Bad', value: Number.NaN },
        ],
        actions: [
          { id: 'copy-link', label: 'Copy link', icon: 'copy' },
          { id: 'open-page', label: 'Open details', icon: 'unknown-icon' },
        ],
      },
      { uri: 'alpha:1', title: 'Duplicate URI ignored' },
      { uri: 'other:9', title: 'Not Allowed' },
    ], new Set(['alpha:1']))

    expect(items).toEqual([{
      uri: 'alpha:1',
      title: 'Clean Alpha',
      rawTitle: 'Raw Alpha 1080p',
      subtitle: 'Team A',
      resolution: 1080,
      videoQualities: ['1080p', 'HDR'],
      audioQualities: ['5.1'],
      audioLanguages: ['ja', 'en'],
      subtitleLanguages: ['en', 'fr'],
      sizeBytes: 1_500_000_000,
      sizeText: '1.5 GiB',
      publishedAt: 1_700_000_000_000,
      badges: [
        { id: 'verified', label: 'Verified', tone: 'positive', filterable: true },
        { id: 'bogus-tone', label: 'Fallback' },
      ],
      metrics: [
        { id: 'rank', label: 'Score', value: 42, display: '42 pts', sort: 'desc', tone: 'positive' },
      ],
      actions: [
        { id: 'copy-link', label: 'Copy link', icon: 'copy' },
        { id: 'open-page', label: 'Open details' },
      ],
    }])
  })

  test('readCatalogActionResult validates allowed kinds, open URLs, copy limit, and 5 MiB download limit', () => {
    expect(readCatalogActionResult({ kind: 'done', message: 'Saved' })).toEqual({ kind: 'done', message: 'Saved' })
    expect(readCatalogActionResult({ kind: 'refresh', message: 'Reloaded' })).toEqual({ kind: 'refresh', message: 'Reloaded' })
    expect(readCatalogActionResult({ kind: 'error', message: 'Unavailable' })).toEqual({ kind: 'error', message: 'Unavailable' })
    expect(readCatalogActionResult({ kind: 'copy', text: 'https://example.test/watch/1', message: 'Copied' })).toEqual({
      kind: 'copy',
      text: 'https://example.test/watch/1',
      message: 'Copied',
    })
    expect(readCatalogActionResult({ kind: 'copy', text: 'x'.repeat(MAX_COPY_CHARS + 1) })).toBeNull()
    expect(readCatalogActionResult({ kind: 'open', url: 'https://example.test/info' })).toEqual({ kind: 'open', url: 'https://example.test/info' })
    expect(readCatalogActionResult({ kind: 'open', url: 'javascript:alert(1)' })).toBeNull()

    const smallB64 = Buffer.from('hello world').toString('base64')
    expect(readCatalogActionResult({
      kind: 'download',
      filename: '../folder/metadata.txt',
      mimeType: 'text/plain',
      base64: smallB64,
    })).toEqual({
      kind: 'download',
      filename: '.._folder_metadata.txt'.replace(/^\.+/, '') || 'download',
      mimeType: 'text/plain',
      base64: smallB64,
    })

    expect(readCatalogActionResult({
      kind: 'download',
      filename: 'bad.bin',
      base64: 'AB=',
    })).toBeNull()

    const overCapB64 = 'A'.repeat(Math.ceil((MAX_DOWNLOAD_BYTES + 3) / 3) * 4)
    expect(readCatalogActionResult({
      kind: 'download',
      filename: 'huge.bin',
      base64: overCapB64,
    })).toBeNull()
  })

  test('askPluginCatalogItems and askPluginCatalogAction enforce bounded timeouts and isolate errors', async () => {
    vi.useFakeTimers()
    const itemsPromise = askPluginCatalogItems(() => new Promise(() => {}), ['alpha:1'])
    await vi.advanceTimersByTimeAsync(CATALOG_DESCRIBE_WAIT_MS + 1)
    expect(await itemsPromise).toEqual([])

    const actionPromise = askPluginCatalogAction(() => new Promise(() => {}), 'alpha:1', 'act')
    await vi.advanceTimersByTimeAsync(CATALOG_ACTION_WAIT_MS + 1)
    expect(await actionPromise).toBeNull()

    expect(await askPluginCatalogItems(async () => { throw new Error('boom') }, ['alpha:1'])).toEqual([])
    expect(await askPluginCatalogAction(async () => { throw new Error('boom') }, 'alpha:1', 'act')).toBeNull()
  })

  test('registerRemoteExtractor announces hasCatalog, skips disabled origins, and cleans up on unregister', async () => {
    const catalogItems = vi.fn(async (uris: string[]) => uris.map(uri => ({ uri, title: `Item ${uri}`, resolution: 1080 })))
    const runCatalogAction = vi.fn(async (uri: string, actionId: string) => ({ kind: 'copy' as const, text: `${uri}:${actionId}` }))
    port.payload = {
      sources: [
        { origin: 'cat-a', originUrl: 'https://a.test', name: 'Source A', isApiOnly: false, resolvers: {}, catalogItems, runCatalogAction },
        { origin: 'plain-b', originUrl: 'https://b.test', name: 'Source B', isApiOnly: false, resolvers: {} },
      ],
    }

    const res = await registerRemoteExtractor(new MessageChannel().port1, PACKAGE)
    expect(res.sources.find(s => s.origin === 'cat-a')?.hasCatalog).toBe(true)
    expect(res.sources.find(s => s.origin === 'plain-b')?.hasCatalog).toBeUndefined()

    expect(await fetchRemoteCatalogItems('cat-a', ['cat-a:1'], { locale: 'en' })).toEqual([
      { uri: 'cat-a:1', title: 'Item cat-a:1', resolution: 1080 },
    ])
    expect(await runRemoteCatalogAction('cat-a', 'cat-a:1', 'share')).toEqual({ kind: 'copy', text: 'cat-a:1:share' })

    setDisabledOrigins(['cat-a'])
    expect(await fetchRemoteCatalogItems('cat-a', ['cat-a:1'])).toEqual([])
    expect(await runRemoteCatalogAction('cat-a', 'cat-a:1', 'share')).toBeNull()

    setDisabledOrigins([])
    unregisterRemoteExtractor(PACKAGE)
    expect(await fetchRemoteCatalogItems('cat-a', ['cat-a:1'])).toEqual([])
    expect(await runRemoteCatalogAction('cat-a', 'cat-a:1', 'share')).toBeNull()
  })
})
