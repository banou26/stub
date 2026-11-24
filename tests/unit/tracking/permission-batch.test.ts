import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { PRIME_DOMAINS, PRIME_PLAYER_REASON, primeDomainsFor } from '../../../src/sources/amazon/session'
import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_PLAYER_REASON } from '../../../src/sources/crunchyroll/session'
import {
  type BatchRequester,
  createPermissionBatcher,
  MAX_CLOUD_HOSTS,
  watchPlayerPermission,
} from '../../../src/tracking/permission-batch'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPermissionBatcher', () => {
  test('skips requesting when only a single site asks without an active hold', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => [{ allow: true }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })

    const pending = batcher.ask({
      hosts: ['myanimelist.net'],
      reason: 'Read MAL',
      backend: 'cloud',
    })
    await vi.advanceTimersByTimeAsync(50)

    expect(await pending).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  test('batches concurrent multi-site cloud asks and caps hosts to 16 per group', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => [{ allow: true }, { allow: true }, { allow: true }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })
    const primeHosts = primeDomainsFor('https://www.amazon.co.jp/gp/video/detail/B001')

    expect(primeHosts.length).toBeGreaterThan(MAX_CLOUD_HOSTS)

    const p1 = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'cloud' })
    const p2 = batcher.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR', backend: 'cloud' })
    const p3 = batcher.ask({ hosts: primeHosts, reason: PRIME_PLAYER_REASON, backend: 'cloud' })

    await vi.advanceTimersByTimeAsync(50)

    expect(await Promise.all([p1, p2, p3])).toEqual([true, true, true])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('cloud', [
      { category: 'evaluation', hosts: ['myanimelist.net'], reason: 'Read MAL' },
      { category: 'evaluation', hosts: [...CRUNCHYROLL_DOMAINS], reason: 'Read CR' },
      { category: 'evaluation', hosts: primeHosts.slice(0, MAX_CLOUD_HOSTS), reason: PRIME_PLAYER_REASON },
    ])
  })

  test('passes full Prime domains without the 16-host cloud cap on extension backend', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => [{ allow: true }, { allow: true }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })
    const primeHosts = primeDomainsFor('https://www.primevideo.com/detail/123')

    const p1 = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'extension' })
    const p2 = batcher.ask({ hosts: primeHosts, reason: PRIME_PLAYER_REASON, backend: 'extension' })

    await vi.advanceTimersByTimeAsync(50)

    expect(await Promise.all([p1, p2])).toEqual([true, true])
    expect(request).toHaveBeenCalledWith('extension', [
      { category: 'evaluation', hosts: ['myanimelist.net'], reason: 'Read MAL' },
      { category: 'evaluation', hosts: primeHosts, reason: PRIME_PLAYER_REASON },
    ])
    expect(primeHosts.length).toBe(PRIME_DOMAINS.length)
  })

  test('holds tracker asks until released so the watch player joins one combined batch', async () => {
    vi.useFakeTimers()
    const request = vi.fn<BatchRequester>(async () => [{ allow: true }, { allow: true }, { allow: true }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })

    const release = batcher.hold()
    expect(batcher.isHeld()).toBe(true)

    const pMal = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'cloud' })
    const pCr = batcher.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR', backend: 'cloud' })

    await vi.advanceTimersByTimeAsync(200)
    expect(request).not.toHaveBeenCalled()

    release()
    expect(batcher.isHeld()).toBe(false)
    const pPrime = batcher.ask({
      hosts: primeDomainsFor('https://www.amazon.co.jp/gp/video/detail/B001'),
      reason: PRIME_PLAYER_REASON,
      backend: 'cloud',
    })

    await vi.advanceTimersByTimeAsync(49)
    expect(request).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(await Promise.all([pMal, pCr, pPrime])).toEqual([true, true, true])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![1]).toHaveLength(3)
  })

  test('flushes held asks once holdMaxMs elapses even if never released', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => [{ allow: true }, { allow: false }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })

    batcher.hold()
    const pMal = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'cloud' })
    const pCr = batcher.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR', backend: 'cloud' })

    await vi.advanceTimersByTimeAsync(399)
    expect(request).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(await Promise.all([pMal, pCr])).toEqual([true, false])
    expect(request).toHaveBeenCalledTimes(1)
  })

  test('deduplicates identical host sets and fans out answers per group', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => [{ allow: true }, { allow: false }])
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })

    const pCrSession = batcher.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Track CR', backend: 'cloud' })
    const pMal = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Track MAL', backend: 'cloud' })
    const pCrPlayer = batcher.ask({
      hosts: [' STATIC.CRUNCHYROLL.COM ', 'crunchyroll.com', 'sso.crunchyroll.com', 'www.crunchyroll.com'],
      reason: CRUNCHYROLL_PLAYER_REASON,
      backend: 'cloud',
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(await Promise.all([pCrSession, pMal, pCrPlayer])).toEqual([true, false, true])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('cloud', [
      { category: 'evaluation', hosts: [...CRUNCHYROLL_DOMAINS], reason: 'Track CR' },
      { category: 'evaluation', hosts: ['myanimelist.net'], reason: 'Track MAL' },
    ])
  })

  test('falls back to undefined when requester throws', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => { throw new Error('broker offline') })
    const batcher = createPermissionBatcher({ request, windowMs: 50, holdMaxMs: 400 })

    const p1 = batcher.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'cloud' })
    const p2 = batcher.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR', backend: 'cloud' })

    await vi.advanceTimersByTimeAsync(50)
    expect(await Promise.all([p1, p2])).toEqual([undefined, undefined])
  })
})

describe('watchPlayerPermission', () => {
  test('returns ordered Prime or Crunchyroll scopes and omits non-built-in players', () => {
    const amazon = watchPlayerPermission('amazon', 'https://www.amazon.co.jp/gp/video/detail/B001')
    expect(amazon?.hosts[0]).toBe('amazon.co.jp')
    expect(amazon?.reason).toBe(PRIME_PLAYER_REASON)

    expect(watchPlayerPermission('cr', 'https://www.crunchyroll.com/watch/G1')).toEqual({
      hosts: [...CRUNCHYROLL_DOMAINS],
      reason: CRUNCHYROLL_PLAYER_REASON,
    })

    expect(watchPlayerPermission('nf', 'https://www.netflix.com/watch/1')).toBeUndefined()
    expect(watchPlayerPermission('nyaa', 'magnet:?xt=urn:btih:1')).toBeUndefined()
  })
})
