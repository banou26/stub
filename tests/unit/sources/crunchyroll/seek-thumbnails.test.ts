import type { Frame } from '@fkn/lib'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { parseBif } from '../../../../src/sources/crunchyroll/bif'
import { readCrunchyrollBif } from '../../../../src/sources/crunchyroll/read-bif'
import { createBifThumbnails, loadCrunchyrollThumbnails } from '../../../../src/sources/crunchyroll/seek-thumbnails'
import { buildBif } from './bif-fixture'

const bif = () => buildBif({ timestamps: [10_000, 20_000, 30_000] })

afterEach(() => { vi.restoreAllMocks() })

describe('createBifThumbnails', () => {
  test('makes an image url only when that image is first asked for, and reuses it after', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const thumbnails = createBifThumbnails(parseBif(bif()))
    expect(create).not.toHaveBeenCalled()

    const first = thumbnails.at(12)!
    expect(first).toMatchObject({ startTime: 10, endTime: 20 })
    expect(thumbnails.at(19)).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
    expect(thumbnails.at(45)).toMatchObject({ startTime: 30, endTime: Infinity })
    expect(create).toHaveBeenCalledTimes(2)
    thumbnails.dispose()
  })

  test('dispose revokes every url it made, and nothing is made after it', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const thumbnails = createBifThumbnails(parseBif(bif()))
    const made = [thumbnails.at(12)!.url, thumbnails.at(25)!.url]

    thumbnails.dispose()
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(made.sort())
    expect(thumbnails.at(35)).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('loadCrunchyrollThumbnails', () => {
  const frameAnswering = (answer: unknown) => {
    const evaluate = vi.fn(async (..._args: unknown[]) => answer)
    return { frame: { evaluate } as unknown as Frame, evaluate }
  }

  test('runs the page reader in the frame, within evaluate\'s deadline and the relay\'s size cap', async () => {
    const { frame, evaluate } = frameAnswering({ bytes: bif(), via: 'named' })
    const thumbnails = await loadCrunchyrollThumbnails(frame)
    expect(evaluate).toHaveBeenCalledTimes(1)
    const [pageFunction, options] = evaluate.mock.calls[0]!
    expect(pageFunction).toBe(readCrunchyrollBif)
    const { waitMs, fetchMs, maxBytes } = options as { waitMs: number, fetchMs: number, maxBytes: number }
    expect(waitMs + fetchMs).toBeLessThan(30_000)
    expect(maxBytes).toBeLessThanOrEqual(32 * 1024 * 1024)
    expect(thumbnails.at(25)).toMatchObject({ startTime: 20, endTime: 30 })
    thumbnails.dispose()
  })

  test('rejects with the page\'s reason when there is no BIF, and on a file that does not parse', async () => {
    await expect(loadCrunchyrollThumbnails(frameAnswering({ none: 'no-bif' }).frame)).rejects.toThrow('no BIF: no-bif')
    await expect(loadCrunchyrollThumbnails(frameAnswering({ none: 'fetch-failed', detail: 'HTTP 403' }).frame)).rejects.toThrow('no BIF: fetch-failed (HTTP 403)')
    await expect(loadCrunchyrollThumbnails(frameAnswering({ bytes: new ArrayBuffer(80), via: 'named' }).frame)).rejects.toThrow('bad magic')
    await expect(loadCrunchyrollThumbnails(frameAnswering({ bytes: buildBif({ timestamps: [] }), via: 'named' }).frame)).rejects.toThrow('no images')
  })
})
