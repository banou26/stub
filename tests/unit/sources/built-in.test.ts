// The settings page lists the sources stub ships with on the main thread, where the extractors (and the
// wasm they pull in) must not be bundled. So the list is its own client-safe module, and this pins it to
// what actually runs: src/sources/index.ts.
import { expect, test } from 'vite-plus/test'

import * as sources from '../../../src/sources/index'
import { builtInSources } from '../../../src/sources/built-in'
import { keyConfigs } from '../../../src/sources/key-configs'

test('names every source that runs, under its own origin, name and site, in the order they run', () => {
  const running = Object.values(sources).map(source => ({ origin: source.origin, name: source.name, url: source.originUrl }))
  expect(builtInSources).toEqual(running)
  expect(builtInSources).toHaveLength(24)
})

test('every source that asks for a key is a built-in one', () => {
  const origins = builtInSources.map(source => source.origin)
  for (const config of keyConfigs) expect(origins, config.origin).toContain(config.origin)
})
