// The stub tracker's adapter over @fkn/lib's storage calls. What it must never do is read a failure as
// a sign out (that clears the list), or let an error's code die on the way to the worker (osra keeps
// only a message, so a locked read would read as a broken one).
import { describe, expect, test } from 'vitest'

import { fknTrackerCloud, type FknStorage } from '../../../src/tracking/fkn-cloud'

const never = () => new Promise<never>(() => {})

const lib = (overrides: Partial<FknStorage> = {}, fs: Record<string, unknown> = {}): FknStorage => ({
  api: async () => ({
    cloud: {
      fs: {
        availability: async () => 'connected' as const,
        list: async () => [],
        ...fs,
      },
    },
  }),
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

  test('never answers disconnected unless the broker said so', async () => {
    const quick = { timeoutMs: 10 }
    expect(await fknTrackerCloud(lib({}, { availability: async () => 'disconnected' }), quick).availability()).toBe('disconnected')
    expect(await fknTrackerCloud(lib({}, { availability: undefined }), quick).availability(), 'a broker too old to say').toBe('unknown')
    expect(await fknTrackerCloud(lib({ api: never }), quick).availability(), 'a broker that never answers').toBe('unknown')
    expect(await fknTrackerCloud(lib({ api: async () => { throw new Error('unreachable') } }), quick).availability()).toBe('unknown')
  })

  test('a key that cannot be asked about reads as not held, and a listing that failed as none', async () => {
    const quick = { timeoutMs: 10 }
    expect(await fknTrackerCloud(lib({ encryption: never }), quick).unlocked()).toBe(false)
    expect(await fknTrackerCloud(lib({ encryption: async () => ({ unlocked: true }) }), quick).unlocked()).toBe(true)
    expect(await fknTrackerCloud(lib({}, { list: async () => { throw new Error('storage: not connected') } }), quick).list()).toBeUndefined()
    expect(await fknTrackerCloud(lib({ writeFile: never }), quick).write('x', '{}')).toEqual({ error: 'FKN storage did not answer' })
  })

  test('lists the tracker\'s own files only, with when each was last written', async () => {
    const cloud = fknTrackerCloud(lib({}, {
      list: async () => [
        { path: 'tracking/v1/devices/a.json', updatedAt: '2026-09-27T00:00:00.000Z', size: 10, contentType: 'application/json', encryption: 'fkne3' },
        { path: 'settings.json', updatedAt: '2026-09-27T00:00:00.000Z', size: 10, contentType: 'application/json', encryption: 'fkne3' },
      ],
    }))

    expect(await cloud.list()).toEqual([{ path: 'tracking/v1/devices/a.json', updatedAt: '2026-09-27T00:00:00.000Z' }])
  })
})
