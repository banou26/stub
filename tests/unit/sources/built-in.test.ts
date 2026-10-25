// The settings page lists the sources stub ships with on the main thread, where the extractors (and the
// wasm they pull in) must not be bundled. So the list is its own client-safe module, and this pins it to
// what actually runs: src/sources/index.ts, less the `imdb` origin that answers nothing.
import { expect, test } from 'vite-plus/test'

import * as sources from '../../../src/sources/index'
import { builtInSources, drawnAs } from '../../../src/sources/built-in'

test('names every source that answers, under its own origin, name, site and icon, in the order they run', () => {
  const answering = Object.values(sources)
    .filter(source => source.origin !== 'imdb')
    .map(source => ({ origin: source.origin, name: source.name, url: source.originUrl, icon: 'icon' in source ? source.icon : undefined }))
  expect(builtInSources).toEqual(answering)
  expect(builtInSources).toHaveLength(35)
  expect(builtInSources.filter(source => !source.icon).map(source => source.origin), 'the three with no icon of their own').toEqual(['anizip', 'livechart', 'offline'])
})

test('lists IMDb once, as the source that reads it', () => {
  expect(builtInSources.filter(source => source.name === 'IMDb').map(source => source.origin)).toEqual(['omdb'])
})

test('lists Anime News Network, for its credits', () => {
  expect(builtInSources).toContainEqual({ origin: 'ann', name: 'Anime News Network', url: 'https://www.animenewsnetwork.com', icon: 'https://www.animenewsnetwork.com/favicon.ico' })
})

test('names the origin of exactly the icons stub draws, IMDb\'s as imdb', () => {
  const drawn = Object.values(sources).filter(source => !source.isApiOnly).map(source => source.origin)
  const byName = (a: string, b: string) => a.localeCompare(b)
  expect(builtInSources.flatMap(source => drawnAs(source.origin) ?? []).sort(byName)).toEqual([...drawn].sort(byName))
  expect(drawnAs('omdb')).toBe('imdb')
  expect(drawnAs('kitsu'), 'an api only source').toBeUndefined()
})
