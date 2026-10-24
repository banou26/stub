import type { PartyState } from '../../../src/party/store'

import { parseHTML } from 'linkedom'
import { afterEach, expect, test, vi } from 'vite-plus/test'

// @fkn/lib cannot load under vitest, so the shell is a fake that keeps the handler the page registers
const fkn = vi.hoisted(() => ({ taken: [] as (() => void)[], party: { status: 'idle' } as PartyState }))
vi.mock('@fkn/lib', () => ({ shell: { onUpdateTaken: (handler: () => void) => { fkn.taken.push(handler); return () => {} } } }))
vi.mock('../../../src/party', () => ({ party: { getState: () => fkn.party } }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
