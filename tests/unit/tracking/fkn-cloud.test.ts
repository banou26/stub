// The stub tracker's adapter over @fkn/lib's storage calls. What it must never do is read a failure as
// a sign out (that clears the list), retry a call FKN refused as another account's, or call @fkn/lib a
// step later than it was called (the link's account check and the call would come apart).
import { describe, expect, test } from 'vitest'

import { fknTrackerCloud, PIN_UNSUPPORTED_TEXT, type FknStorage } from '../../../src/tracking/fkn-cloud'

const never = () => new Promise<never>(() => {})

const lib = (overrides: Partial<FknStorage> = {}): FknStorage => ({
  availability: async () => 'connected' as const,
  list: async () => [],
  encryption: async () => ({ unlocked: true }),
  readFile: async () => '{}',
  writeFile: async () => {},
  ...overrides,
})

describe('the tracker\'s FKN storage', () => {
  test('reads a locked or missing file as that, and any other failure as an error', async () => {
    const failing = (code?: string) => fknTrackerCloud(lib({
      readFile: async () => { throw Object.assign(new Error('refused'), code ? { code } : {}) },
      writeFile: async () => { throw Object.assign(new Error('refused'), code ? { code } : {}) },
    }))

    expect(await failing('FKN_E2E_LOCKED').read('tracking/v1/devices/a.json')).toEqual({ locked: true })
    expect(await failing('FKN_E2E_LOCKED').write('tracking/v1/devices/a.json', '{}')).toEqual({ locked: true })
    expect(await failing('FKN_STORAGE_NOT_FOUND').read('tracking/v1/devices/a.json')).toEqual({ missing: true })
    expect(await failing().read('tracking/v1/devices/a.json')).toEqual({ error: 'refused' })
    expect(await fknTrackerCloud(lib({ readFile: async () => new TextEncoder().encode('{"a":1}') })).read('x'), 'bytes decode to text').toEqual({ ok: '{"a":1}' })
  })

  test('answers a call refused as another account\'s with `changed`, having made it once', async () => {
    let writes = 0
    const cloud = fknTrackerCloud(lib({
      writeFile: async () => { writes += 1; throw Object.assign(new Error('storage: the signed-in account changed'), { code: 'FKN_ACCOUNT_CHANGED' }) },
      list: async () => { throw new Error('fkn:account-changed: the signed-in account changed') },
    }))

    expect(await cloud.write('tracking/v1/devices/a.json', '{}')).toEqual({ changed: true })
    expect(writes, 'never retried').toBe(1)
    expect(await cloud.list(), 'nor when only the message says so').toEqual({ changed: true })
  })

  test('answers a broker that cannot pin a call with an error, never a write', async () => {
    const unsupported = async () => { throw Object.assign(new Error('storage: the FKN broker cannot pin calls'), { code: 'FKN_ACCOUNT_PIN_UNSUPPORTED' }) }
    const cloud = fknTrackerCloud(lib({ writeFile: unsupported, list: unsupported }))

    expect(await cloud.write('tracking/v1/devices/a.json', '{}')).toEqual({ error: PIN_UNSUPPORTED_TEXT })
    expect(await cloud.list()).toEqual({ error: PIN_UNSUPPORTED_TEXT })
  })

  test('calls @fkn/lib in the step it is called in, before any await', () => {
    const called: string[] = []
    const cloud = fknTrackerCloud(lib({
      list: async () => { called.push('list'); return [] },
      readFile: async () => { called.push('read'); return '{}' },
      writeFile: async () => { called.push('write') },
    }))

    void cloud.list()
    void cloud.read('x')
    void cloud.write('x', '{}')
    expect(called).toEqual(['list', 'read', 'write'])
  })

  test('never answers disconnected unless the broker said so', async () => {
    const quick = { timeoutMs: 10 }
    expect(await fknTrackerCloud(lib({ availability: async () => 'disconnected' }), quick).availability()).toBe('disconnected')
    expect(await fknTrackerCloud(lib({ availability: never }), quick).availability(), 'a broker that never answers').toBe('unknown')
    expect(await fknTrackerCloud(lib({ availability: async () => { throw new Error('unreachable') } }), quick).availability()).toBe('unknown')
  })

  test('a key that cannot be asked about reads as not held, and a call that never answers as an error', async () => {
    const quick = { timeoutMs: 10 }
    expect(await fknTrackerCloud(lib({ encryption: never }), quick).unlocked()).toBe(false)
    expect(await fknTrackerCloud(lib({ encryption: async () => ({ unlocked: true }) }), quick).unlocked()).toBe(true)
    expect(await fknTrackerCloud(lib({ list: async () => { throw new Error('storage: not connected') } }), quick).list()).toEqual({ error: 'storage: not connected' })
    expect(await fknTrackerCloud(lib({ writeFile: never }), quick).write('x', '{}')).toEqual({ error: 'FKN storage did not answer' })
  })

  test('lists the tracker\'s own files only, with when each was last written', async () => {
    const cloud = fknTrackerCloud(lib({
      list: async () => [
        { path: 'tracking/v1/devices/a.json', updatedAt: '2026-09-27T00:00:00.000Z', size: 10, contentType: 'application/json', encryption: 'fkne3' },
        { path: 'settings.json', updatedAt: '2026-09-27T00:00:00.000Z', size: 10, contentType: 'application/json', encryption: 'fkne3' },
      ],
    }))

    expect(await cloud.list()).toEqual({ ok: [{ path: 'tracking/v1/devices/a.json', updatedAt: '2026-09-27T00:00:00.000Z' }] })
  })
})
