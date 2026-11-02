// A plugin source's `check`: what its site asks the viewer to pass in person, which the watch page offers to open.
import { afterEach, expect, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here. Each source's client, as a fan-out
// asks it, notes the ask in `events` and ends its answer at once.
const events = vi.hoisted(() => [] as string[])
vi.mock('urql', () => ({
  Client: class {
    subscription() {
      return {
        subscribe: (next: (result: object) => void) => {
          events.push('asked')
          queueMicrotask(() => next({ hasNext: false }))
          return { unsubscribe: () => {} }
        },
      }
    }
  },
  fetchExchange: {},
  mapExchange: () => ({}),
  getOperationName: () => undefined,
}))
// the package's payload, as the port would carry it
const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const { proxyRequestToExtractors, registerRemoteExtractor, remoteCheck, searchAgain, unregisterRemoteExtractor } = await import('../../../src/worker/extractor')
const { CHECK_WAIT_MS } = await import('../../../src/worker/plugin-sources')

const PACKAGE = 'https:check.spec.test'
const CHECK = { url: 'https://ext.to/browse/?imdb_id=tt1375666', passed: 'table.search-table' }
const source = (origin: string, fields: object) => ({ origin, originUrl: 'https://ext.to', name: origin, isApiOnly: false, resolvers: {}, ...fields })
const register = (...sources: object[]) => {
  port.payload = { sources }
  return registerRemoteExtractor(new MessageChannel().port1, PACKAGE)
}

afterEach(() => {
  vi.useRealTimers()
  unregisterRemoteExtractor(PACKAGE)
})

test('a source that reports a check on its own site is asked for it, on every call, and answers none once passed', async () => {
  const check = vi.fn(async (): Promise<unknown> => CHECK)
  await register(source('spec-check', { check }))
  expect(await remoteCheck('spec-check')).toEqual(CHECK)
  check.mockResolvedValue(null)
  expect(await remoteCheck('spec-check')).toBeUndefined()
  expect(check).toHaveBeenCalledTimes(2)
})

test('a page below the site\'s host is on its site', async () => {
  await register(source('spec-check', { check: async () => ({ url: 'https://www.ext.to/browse/', passed: 'table' }) }))
  expect(await remoteCheck('spec-check')).toEqual({ url: 'https://www.ext.to/browse/', passed: 'table' })
})

test('a check anywhere off the source\'s site is no check, so the page has nothing to open', async () => {
  for (const url of ['https://accounts.example.com/signin', 'https://ext.to.example.com/', 'https://notext.to/', 'http://ext.to/', 'javascript:alert(1)', 'not a url']) {
    await register(source('spec-check', { check: async () => ({ url, passed: 'body' }) }))
    expect(await remoteCheck('spec-check'), url).toBeUndefined()
  }
})

test('a malformed, rejected or late answer is no check', async () => {
  for (const answer of [{ url: CHECK.url }, { url: CHECK.url, passed: '' }, 'https://ext.to/', undefined]) {
    await register(source('spec-check', { check: async () => answer }))
    expect(await remoteCheck('spec-check'), JSON.stringify(answer)).toBeUndefined()
  }
  await register(source('spec-check', { check: async () => { throw new Error('refused') } }))
  expect(await remoteCheck('spec-check')).toBeUndefined()

  vi.useFakeTimers()
  await register(source('spec-check', { check: () => new Promise(() => {}) }))
  const late = remoteCheck('spec-check')
  await vi.advanceTimersByTimeAsync(CHECK_WAIT_MS)
  expect(await late).toBeUndefined()
})

test('a source that serves no check, or is gone, is asked nothing', async () => {
  await register(source('spec-none', {}))
  expect(await remoteCheck('spec-none')).toBeUndefined()
  const check = vi.fn(async () => CHECK)
  await register(source('spec-check', { check }))
  unregisterRemoteExtractor(PACKAGE)
  expect(await remoteCheck('spec-check')).toBeUndefined()
  expect(check).not.toHaveBeenCalled()
})

// a media page's fan-out, open over every source, with what it asked so far cleared
const pages: { close: () => void }[] = []
const openPage = () => {
  pages.push(proxyRequestToExtractors({ params: { query: 'subscription { media }', variables: {} } } as never, { operationName: 'Media' } as never))
  events.length = 0
}
afterEach(() => { while (pages.length) pages.pop()!.close() })

test('once the window is done, the source is told before it is asked its question again', async () => {
  await register(source('spec-check', { check: async () => CHECK, checkDone: async () => { events.push('told') } }))
  openPage()
  await searchAgain('spec-check')
  expect(events).toEqual(['told', 'asked'])
})

test('a source that never answers checkDone is asked again after CHECK_WAIT_MS', async () => {
  vi.useFakeTimers()
  await register(source('spec-check', { check: async () => CHECK, checkDone: () => new Promise(() => {}) }))
  openPage()
  let done = false
  void searchAgain('spec-check').then(() => { done = true })
  await vi.advanceTimersByTimeAsync(CHECK_WAIT_MS - 1)
  expect(events).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(events).toEqual(['asked'])
  expect(done).toBe(true)
})

test('a source that rejects checkDone, or serves none, is asked again', async () => {
  await register(source('spec-check', { check: async () => CHECK, checkDone: async () => { throw new Error('refused') } }))
  openPage()
  await searchAgain('spec-check')
  expect(events).toEqual(['asked'])

  await register(source('spec-check', { check: async () => CHECK }))
  events.length = 0
  await searchAgain('spec-check')
  expect(events).toEqual(['asked'])
})
