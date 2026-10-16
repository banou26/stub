// The settings page lists the sources stub ships with on the main thread, where the extractors (and the
// wasm they pull in) must not be bundled. So the list is its own client-safe module, and this pins it to
// what actually runs: src/sources/index.ts, less the `imdb` origin that answers nothing.
import { expect, test } from 'vite-plus/test'

import * as sources from '../../../src/sources/index'
import { builtInSources, iconSources } from '../../../src/sources/built-in'

test('names every source that answers, under its own origin, name and site, in the order they run', () => {
  const answering = Object.values(sources)
    .filter(source => source.origin !== 'imdb')
    .map(source => ({ origin: source.origin, name: source.name, url: source.originUrl }))
  expect(builtInSources).toEqual(answering)
  expect(builtInSources).toHaveLength(35)
})

test('lists IMDb once, as the source that reads it', () => {
  expect(builtInSources.filter(source => source.name === 'IMDb').map(source => source.origin)).toEqual(['omdb'])
})

test('lists Anime News Network, for its credits', () => {
  expect(builtInSources).toContainEqual({ origin: 'ann', name: 'Anime News Network', url: 'https://www.animenewsnetwork.com' })
})

test('lists an icon switch for exactly the origins stub draws', () => {
  const drawn = Object.values(sources).filter(source => !source.isApiOnly).map(source => source.origin)
  expect(iconSources.map(source => source.origin).sort()).toEqual([...drawn].sort())
  expect(iconSources).toContainEqual({ origin: 'imdb', name: 'IMDb', url: 'https://www.imdb.com' })
})
