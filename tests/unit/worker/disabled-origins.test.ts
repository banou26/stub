// The worker's half of a source turned off in Settings, built in or added: every fan-out and every single-origin question
// in worker/extractor.ts takes its entries through `askable`, which leaves those sources out.
import { afterEach, expect, test } from 'vite-plus/test'

import { askable, setDisabledOrigins } from '../../../src/worker/disabled-origins'

const builtIn = (origin: string) => ({ extractor: { origin }, pluginUri: undefined as string | undefined })
const plugin = (origin: string) => ({ extractor: { origin }, pluginUri: `npm:@spec/${origin}` })
const ENTRIES = [builtIn('anilist'), builtIn('simkl'), builtIn('tvdb'), plugin('nyaa')]
const origins = (entries: { extractor: { origin: string } }[]) => entries.map(entry => entry.extractor.origin)

afterEach(() => { setDisabledOrigins([]) })

test('with nothing turned off, every source is asked', () => {
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'simkl', 'tvdb', 'nyaa'])
})

test('a built-in source turned off is left out, and the next list replaces the last', () => {
  setDisabledOrigins(['simkl', 'tvdb'])
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'nyaa'])
  setDisabledOrigins(['tvdb'])
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'simkl', 'nyaa'])
})

// the owner, 2026-10-25 (HOR-1019): "right now custom sources can't be disabled besides just removing the plugin"
test('a plugin source turned off is left out too, and asked again once turned back on', () => {
  setDisabledOrigins(['nyaa'])
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'simkl', 'tvdb'])
  setDisabledOrigins([])
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'simkl', 'tvdb', 'nyaa'])
})

test('movie and series leave out the anime catalogues, and keep a plugin source', () => {
  expect(origins(askable(ENTRIES, 'movie'))).toEqual(['simkl', 'tvdb', 'nyaa'])
  expect(origins(askable(ENTRIES, 'series'))).toEqual(['simkl', 'tvdb', 'nyaa'])
  expect(origins(askable(ENTRIES, 'anime'))).toEqual(['anilist', 'simkl', 'tvdb', 'nyaa'])
})
