import { expect, test } from 'vite-plus/test'

import {
  EXPORT_ANSWERS_VALUE, EXPORT_PARAM, EXPORT_VALUE, readAnswersExportFlag, readExportFlag, readsLegacyStore,
} from '../../../src/utils/export-flag'

test('the flag is exactly ?export=store', () => {
  expect(EXPORT_PARAM).toBe('export')
  expect(EXPORT_VALUE).toBe('store')
  expect(readExportFlag('https://anime.fkn.app/?export=store')).toBe(true)
  expect(readExportFlag('https://anime.fkn.app/media/anilist:1?plugin=x&export=store')).toBe(true)
})

// The answer log is a second value on the same param, so a page may carry both and neither reads the
// other's flag: `?export=store` must not install the answer hook, or a store walk would publish a
// function whose engine was never enabled.
test('the answer log flag is exactly ?export=answers, and the two values are independent', () => {
  expect(EXPORT_ANSWERS_VALUE).toBe('answers')
  expect(readAnswersExportFlag('https://anime.fkn.app/?export=answers')).toBe(true)
  expect(readAnswersExportFlag('https://anime.fkn.app/media/mal:1?graph=1&export=answers')).toBe(true)
  expect(readAnswersExportFlag('https://anime.fkn.app/?export=store')).toBe(false)
  expect(readExportFlag('https://anime.fkn.app/?export=answers')).toBe(false)

  const both = 'https://anime.fkn.app/?export=store&export=answers'
  expect([readExportFlag(both), readAnswersExportFlag(both)]).toEqual([true, true])
})

test('anything else reads false, including an unparseable url', () => {
  expect(readExportFlag('https://anime.fkn.app/?export=1')).toBe(false)
  expect(readExportFlag('https://anime.fkn.app/?plugin=x')).toBe(false)
  expect(readExportFlag('https://anime.fkn.app/')).toBe(false)
  expect(readExportFlag('not a url')).toBe(false)
})

test('a relative url resolves against the base', () => {
  expect(readExportFlag('/?export=store', 'https://x')).toBe(true)
  expect(readExportFlag('/', 'https://x')).toBe(false)
})

// THE STORE FLIP of 2026-09-13: the graph became the default and `?store=legacy` the only way back.
// Before that the switch was `?store=graph` and its ABSENCE meant the old store, so these two cases
// are exact opposites of what this file asserted the day before.
// MUTATED: make `readsLegacyStore` test `params.has(STORE_PARAM)` rather than its value, and the
// third case flips: `?store=graph` starts reading the store it names the opposite of.
test('the graph is the default store, and only the exact opt out leaves it', () => {
  expect(readsLegacyStore('https://x/y'), 'no flag at all').toBe(false)
  expect(readsLegacyStore('https://x/y?store=legacy'), 'the opt out').toBe(true)
  expect(readsLegacyStore('https://x/y?store=graph'), 'the OLD switch, now a no-op').toBe(false)
  expect(readsLegacyStore('https://x/y?store=legcy'), 'a typo lands on the default').toBe(false)
  expect(readsLegacyStore('https://x/y?store=1'), 'and so does a stray value').toBe(false)
  expect(readsLegacyStore('https://x/y?graph=1'), 'the engine flag is a different question').toBe(false)
  expect(readsLegacyStore('not a url'), 'never throws').toBe(false)
  expect(readsLegacyStore('/y?store=legacy', 'https://x'), 'relative, with a base').toBe(true)
})
