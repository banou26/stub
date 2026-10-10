// The worker's half of a source turned off in Settings: every fan-out and every single-origin question
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

test('a plugin source is never left out here: removing it is how one is stopped', () => {
  setDisabledOrigins(['nyaa'])
  expect(origins(askable(ENTRIES))).toEqual(['anilist', 'simkl', 'tvdb', 'nyaa'])
})
