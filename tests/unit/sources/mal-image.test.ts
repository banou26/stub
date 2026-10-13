import { expect, test } from 'vite-plus/test'

import { malLargeImage } from '../../../src/sources/mal-image'

const CDN = 'https://cdn.myanimelist.net/images/anime/1527/158340'

test('the plain spelling upgrades to the large one, which is 425x600 against 225x318', () => {
  expect(malLargeImage(`${CDN}.webp`)).toBe(`${CDN}l.webp`)
})

test('a .jpg becomes the .webp at the same size, about three times smaller', () => {
  expect(malLargeImage(`${CDN}.jpg`)).toBe(`${CDN}l.webp`)
  expect(malLargeImage(`${CDN}l.jpg`)).toBe(`${CDN}l.webp`)
})

test('a thumbnail upgrades rather than gaining a second size letter', () => {
  expect(malLargeImage(`${CDN}t.jpg`)).toBe(`${CDN}l.webp`)
})

test('an already large url is returned as it came', () => {
  expect(malLargeImage(`${CDN}l.webp`)).toBe(`${CDN}l.webp`)
})

test('a query string survives, and another host is never rewritten', () => {
  expect(malLargeImage(`${CDN}.jpg?s=abc`)).toBe(`${CDN}l.webp?s=abc`)
  expect(malLargeImage('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-a.jpg'))
    .toBe('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-a.jpg')
  expect(malLargeImage('not a url at all')).toBe('not a url at all')
})

test('a missing url passes through, since a source with no image is not this to fix', () => {
  expect(malLargeImage(undefined)).toBeUndefined()
  expect(malLargeImage(null)).toBeNull()
})

// The site's search answers spell the cover resized, `https://cdn.myanimelist.net/r/116x180/...`, with a
// signature for that size; the plain large file needs neither (measured 2026-10-13, 200 without it).
test('a resized url upgrades to the plain large one, without the size\'s signature', () => {
  expect(malLargeImage('https://cdn.myanimelist.net/r/116x180/images/anime/1921/154528.jpg?s=2c8f7a88b0c041948774328f15908fec'))
    .toBe('https://cdn.myanimelist.net/images/anime/1921/154528l.webp')
})
