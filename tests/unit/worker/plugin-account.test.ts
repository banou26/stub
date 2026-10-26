// A plugin source's `access` and `account` (docs: request/plugins.md, "Whether a source needs an account"): what the
// worker hands the page when the source registers, and when it asks the source.
import { afterEach, expect, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))
// the package's payload, as the port would carry it
const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const { registerRemoteExtractor, remoteAccount, unregisterRemoteExtractor } = await import('../../../src/worker/extractor')
const { ACCOUNT_WAIT_MS } = await import('../../../src/worker/plugin-sources')

const PACKAGE = 'https:account.spec.test'
const source = (origin: string, fields: object) => ({ origin, originUrl: `https://${origin}.test`, name: origin, isApiOnly: false, resolvers: {}, ...fields })
const register = (...sources: object[]) => {
  port.payload = { sources }
  return registerRemoteExtractor(new MessageChannel().port1, PACKAGE)
}

afterEach(() => {
  vi.useRealTimers()
  unregisterRemoteExtractor(PACKAGE)
})

test('the page learns each source\'s access as it registers, none for one that declares none', async () => {
  const { sources } = await register(
    source('spec-account', { access: 'account' }),
    source('spec-paid', { access: 'paid' }),
    source('spec-older', {}),
  )
  expect(sources.map(({ origin, access }) => [origin, access])).toEqual([['spec-account', 'account'], ['spec-paid', 'paid'], ['spec-older', 'none']])
})

test('a source that needs an account is asked, on every call', async () => {
  const account = vi.fn(async () => 'signed-in')
  await register(source('spec-paid', { access: 'paid', account }))
  expect(await remoteAccount('spec-paid')).toBe('signed-in')
  account.mockResolvedValue('no-plan')
  expect(await remoteAccount('spec-paid')).toBe('no-plan')
  expect(account).toHaveBeenCalledTimes(2)
})

test('a source that needs no account is never asked, though it serves `account`', async () => {
  const account = vi.fn(async () => 'signed-out')
  await register(source('spec-none', { access: 'none', account }), source('spec-older', { account }))
  expect(await remoteAccount('spec-none')).toBeUndefined()
  expect(await remoteAccount('spec-older')).toBeUndefined()
  expect(account).not.toHaveBeenCalled()
})

test('a source that needs an account and serves no `account` answers nothing, and so does one gone', async () => {
  const account = vi.fn(async () => 'signed-in')
  await register(source('spec-silent', { access: 'account' }), source('spec-paid', { access: 'paid', account }))
  expect(await remoteAccount('spec-silent')).toBeUndefined()
  unregisterRemoteExtractor(PACKAGE)
  expect(await remoteAccount('spec-paid')).toBeUndefined()
  expect(account).not.toHaveBeenCalled()
})

// the page keeps no time limit of its own: this bound is what keeps a source that never answers from holding Play
test('an answer late past ACCOUNT_WAIT_MS, a rejection or any other value is no answer', async () => {
  await register(
    source('spec-late', { access: 'account', account: () => new Promise(() => {}) }),
    source('spec-rejects', { access: 'account', account: async () => { throw new Error('no session') } }),
    source('spec-odd', { access: 'paid', account: async () => 'SIGNED-IN' }),
  )
  vi.useFakeTimers()
  let late: unknown = 'waiting'
  void remoteAccount('spec-late').then(state => { late = state })
  await vi.advanceTimersByTimeAsync(ACCOUNT_WAIT_MS - 1)
  expect(late).toBe('waiting')
  await vi.advanceTimersByTimeAsync(1)
  expect(late).toBeUndefined()
  expect(await remoteAccount('spec-rejects')).toBeUndefined()
  expect(await remoteAccount('spec-odd')).toBeUndefined()
})
