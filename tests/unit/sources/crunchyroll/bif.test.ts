import { describe, expect, test } from 'vite-plus/test'

import { BifParseError, bifFrameAt, parseBif } from '../../../../src/sources/crunchyroll/bif'
import { buildBif, fixtureImage } from './bif-fixture'

const bytesOf = (view: Uint8Array) => [...view]

describe('parseBif', () => {
  // the measured shape: separation 1, so timestamps are already milliseconds, 10 s apart from 10 s
  test('reads every image with its time span and its own bytes', () => {
    const frames = parseBif(buildBif({ timestamps: [10_000, 20_000, 30_000] }))
    expect(frames.map(({ start, end }) => [start, end])).toEqual([[10_000, 20_000], [20_000, 30_000], [30_000, Infinity]])
    expect(frames.map(({ bytes }) => bytesOf(bytes))).toEqual([fixtureImage(0), fixtureImage(1), fixtureImage(2)])
  })

  test('a separation of 0 means 1000, so the timestamps are seconds', () => {
    const frames = parseBif(buildBif({ timestamps: [10, 20], separation: 0 }))
    expect(frames.map(({ start }) => start)).toEqual([10_000, 20_000])
    expect(frames[0]!.end).toBe(20_000)
  })

  test('the last image ends at the sentinel entry\'s offset, not at the end of the buffer', () => {
    const frames = parseBif(buildBif({ timestamps: [10_000, 20_000], trailer: [0xde, 0xad, 0xbe, 0xef] }))
    expect(bytesOf(frames.at(-1)!.bytes)).toEqual(fixtureImage(1))
  })

  test('refuses a buffer that is not a BIF', () => {
    const buffer = buildBif({ timestamps: [10_000] })
    new Uint8Array(buffer)[1] = 0x00
    expect(() => parseBif(buffer)).toThrow(BifParseError)
    expect(() => parseBif(buffer)).toThrow('bad magic')
  })

  test('refuses a truncated header, index or image by name', () => {
    const whole = buildBif({ timestamps: [10_000, 20_000, 30_000] })
    expect(() => parseBif(whole.slice(0, 40))).toThrow(/truncated header/)
    expect(() => parseBif(whole.slice(0, 64 + 2 * 8))).toThrow(/truncated index/)
    expect(() => parseBif(whole.slice(0, whole.byteLength - 1))).toThrow(/image 2 spans .* outside/)
    for (const cut of [40, 64 + 2 * 8, whole.byteLength - 1]) expect(() => parseBif(whole.slice(0, cut))).toThrow(BifParseError)
  })

  test('refuses a count the index does not end on, and an implausible one', () => {
    expect(() => parseBif(buildBif({ timestamps: [10_000, 20_000], count: 1 }))).toThrow(/0xffffffff/)
    expect(() => parseBif(buildBif({ timestamps: [10_000], sentinel: 20_000 }))).toThrow(/0xffffffff/)
    expect(() => parseBif(buildBif({ timestamps: [10_000], count: 0x7fffffff }))).toThrow(/implausible frame count/)
  })

  test('refuses timestamps that do not increase', () => {
    expect(() => parseBif(buildBif({ timestamps: [10_000, 30_000, 20_000] }))).toThrow(/do not increase at image 1/)
    expect(() => parseBif(buildBif({ timestamps: [10_000, 10_000] }))).toThrow(/do not increase at image 0/)
  })

  test('refuses an image offset that points back into the index', () => {
    const buffer = buildBif({ timestamps: [10_000, 20_000] })
    new DataView(buffer).setUint32(64 + 4, 64, true)
    expect(() => parseBif(buffer)).toThrow(/image 0 spans 64\.\./)
  })

  test('an empty storyboard parses to no frames', () => {
    expect(parseBif(buildBif({ timestamps: [] }))).toEqual([])
  })
})

describe('bifFrameAt', () => {
  const frames = parseBif(buildBif({ timestamps: [10_000, 20_000, 30_000] }))

  test('picks the image whose span holds the time', () => {
    expect(bifFrameAt(frames, 10_000)).toBe(frames[0])
    expect(bifFrameAt(frames, 19_999)).toBe(frames[0])
    expect(bifFrameAt(frames, 20_000)).toBe(frames[1])
    expect(bifFrameAt(frames, 29_000)).toBe(frames[1])
    expect(bifFrameAt(frames, 1_770_000)).toBe(frames[2])
  })

  test('a time before the first image gets the first image, and no frames or no time get nothing', () => {
    expect(bifFrameAt(frames, 4_000)).toBe(frames[0])
    expect(bifFrameAt([], 4_000)).toBeUndefined()
    expect(bifFrameAt(frames, NaN)).toBeUndefined()
  })
})
