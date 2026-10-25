// The order the merge weighs the built-in sources in, a setting that follows the FKN account: their own scores until the
// viewer moves one, and a value stub cannot read keeps nothing.
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import {
  DEFAULT_MERGE, DEFAULT_MERGE_ORDER, holdMergeOrder, MERGE_ORDER_KEY, mergeOrder, readMergeOrder, watchMergeOrder, writeMergeOrder,
} from '../../../src/sources/merge-order'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

// every extractor's origin and the score its answers carry, read from the source, so a retuned score turns this red
const SOURCES = new URL('../../../src/sources/', import.meta.url)
const extractorScores = () => readdirSync(SOURCES, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(({ name }) => {
  const text = ['extractor.ts', 'normalize.ts'].map(file => { try { return readFileSync(new URL(`${name}/${file}`, SOURCES), 'utf8') } catch { return '' } }).join('\n')
  const origin = text.match(/export const origin = '([^']+)'/)?.[1]
  const score = text.match(/^(?:export )?const SCORE = ([\d.]+)$/m)?.[1]
  return origin && score ? [[origin, Number(score)] as const] : []
})

test('the default order is every scored extractor, best first, at the score its extractor gives', () => {
  const scores = extractorScores()
  expect(scores.length, 'the scan finds the extractors').toBeGreaterThan(15)
  expect(Object.fromEntries(DEFAULT_MERGE)).toEqual(Object.fromEntries(scores))
  expect(DEFAULT_MERGE.map(([, score]) => score)).toEqual(DEFAULT_MERGE.map(([, score]) => score).toSorted((a, b) => b - a))
  expect(DEFAULT_MERGE_ORDER.slice(0, 3)).toEqual(['mal', 'anizip', 'anilist'])
})

test('the order followed names the built-in sources kept first, then every other one in the default order', () => {
  expect(mergeOrder([])).toEqual(DEFAULT_MERGE_ORDER)
  expect(mergeOrder(['anilist', 'nyaa', 'kitsu'])).toEqual(['anilist', 'kitsu', ...DEFAULT_MERGE_ORDER.filter(origin => origin !== 'anilist' && origin !== 'kitsu')])
})

test('an order written is read back, and a kept value stub cannot read keeps nothing', () => {
  expect(readMergeOrder()).toEqual([])
  writeMergeOrder(['anilist', 'mal'])
  expect(stored.get(MERGE_ORDER_KEY)).toBe('["anilist","mal"]')
  expect(readMergeOrder()).toEqual(['anilist', 'mal'])
  for (const kept of ['not json', '{"mal":0}', 'null', '[1,"mal"]']) {
    stored.set(MERGE_ORDER_KEY, kept)
    expect(readMergeOrder(), kept).toEqual(kept === '[1,"mal"]' ? ['mal'] : [])
  }
})

test('a watcher hears this tab\'s changes and another tab\'s, and nothing once stopped', () => {
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  const listener = vi.fn()
  const stop = watchMergeOrder(listener)
  writeMergeOrder(['anilist'])
  page.dispatchEvent(Object.assign(new Event('storage'), { key: MERGE_ORDER_KEY }))
  page.dispatchEvent(Object.assign(new Event('storage'), { key: 'some-other-key' }))
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
  writeMergeOrder(['mal'])
  expect(listener).toHaveBeenCalledTimes(2)
})

test('the worker\'s copy says it changed only when the order followed did', () => {
  expect(holdMergeOrder(DEFAULT_MERGE_ORDER), 'the default spelled out is the default').toBe(false)
  expect(holdMergeOrder(['anilist'])).toBe(true)
  expect(holdMergeOrder(['anilist', 'nyaa']), 'an added source is not in it').toBe(false)
  expect(holdMergeOrder([])).toBe(true)
})
