import type { PartyState } from '../../../src/party/store'

import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// @fkn/lib cannot load under vitest, so the shell is a fake that keeps the handler the page registers
const fkn = vi.hoisted(() => ({ taken: [] as (() => void)[], party: { status: 'idle' } as PartyState }))
vi.mock('@fkn/lib', () => ({ shell: { onUpdateTaken: (handler: () => void) => { fkn.taken.push(handler); return () => {} } } }))
vi.mock('../../../src/party', () => ({ party: { getState: () => fkn.party } }))

beforeEach(() => {
  vi.resetModules()
  fkn.taken = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('an fkn.app update taken elsewhere reloads stub through its gate, not at once', async () => {
  vi.useFakeTimers()
  const { document } = parseHTML('<!doctype html><html><head></head><body></body></html>')
  const location = { pathname: '/watch/anilist-154587/1', hostname: 'anime.fkn.app', reload: vi.fn() }
  const stored = new Map<string, string>()
  vi.stubGlobal('document', document)
  vi.stubGlobal('location', location)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } })

  await import('../../../src/update')
  expect(fkn.taken, 'a handler replaces the lib\'s own reload').toHaveLength(1)
  fkn.taken[0]!()
  vi.advanceTimersByTime(30_000)
  expect(location.reload, 'held on /watch').not.toHaveBeenCalled()
  location.pathname = '/'
  vi.advanceTimersByTime(1_000)
  expect(location.reload).toHaveBeenCalledOnce()
})

test.each([
  ['checks', true, 'anime.fkn.app', ['/']],
  ['does not check in development', false, 'anime.fkn.app', []],
  ['does not check on a sandbox tenant\'s host', true, 'stub.sdbx.app', []],
])('a tab back in view %s for a deploy', async (_, prod, hostname, checked) => {
  vi.stubEnv('PROD', prod)
  const { window, document, DOMParser } = parseHTML('<!doctype html><html><head><script type="module" src="/assets/main-Rl2aCtul.js"></script></head><body></body></html>')
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' })
  const asked: string[] = []
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('DOMParser', DOMParser)
  vi.stubGlobal('location', { pathname: '/', hostname, reload: vi.fn() })
  vi.stubGlobal('fetch', async (path: string) => {
    asked.push(path)
    return new Response('', { headers: { 'content-type': 'text/html' } })
  })
  await import('../../../src/update')
  document.dispatchEvent(new window.Event('visibilitychange'))
  expect(asked).toEqual(checked)
})
