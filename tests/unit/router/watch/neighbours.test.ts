import type { Ways } from '../../../../src/router/watch/auto-pick'

import { expect, test } from 'vite-plus/test'

import { neighbours, sourceFor } from '../../../../src/router/watch/neighbours'

const rows = [1, 2, 3]

test('previous is the row before, next the row after only once it is out', () => {
  expect(neighbours(rows, 1, [false, false, true])).toEqual({ previous: 1, next: undefined })
  expect(neighbours(rows, 0, [false, false, true])).toEqual({ previous: undefined, next: 2 })
  expect(neighbours(rows, 2, [false, false, false]), 'the last row').toEqual({ previous: 2, next: undefined })
})

test('an episode missing from the list has neither', () => {
  expect(neighbours(rows, -1, [false, false, false])).toEqual({ previous: undefined, next: undefined })
})

const ways: Ways = {
  builtIn: origin => origin === 'cr',
  signedOut: () => false,
  selfPlaying: origin => origin === 'nyaa',
}
const third = [
  { uri: 'cr:GX3', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX3' },
  { uri: 'nyaa:b', origin: 'nyaa', url: 'magnet:?xt=urn:btih:b' },
  { uri: 'nyaa:c', origin: 'nyaa', url: 'magnet:?xt=urn:btih:c' },
]

test('the other episode opens on the origin playing now, a release on its first release', () => {
  expect(sourceFor(third, 'nyaa', ways)).toBe('nyaa:b')
  expect(sourceFor(third, 'cr', ways)).toBe('cr:GX3')
})

test('an origin the other episode lacks, or cannot play there, names no source', () => {
  expect(sourceFor(third, 'amazon', ways)).toBeUndefined()
  expect(sourceFor([{ uri: 'amazon:us', origin: 'amazon', url: 'https://watch.amazon.com/watch?gti=us' }], 'amazon', ways)).toBeUndefined()
  expect(sourceFor(third, undefined, ways)).toBeUndefined()
})
