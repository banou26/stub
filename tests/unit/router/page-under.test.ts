// A preview opened from a search is drawn over that search, so closing it or Back returns to the same results where
// they were. Its history entry is what remembers the search and its place, so every navigation through wouter has to
// write them.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { navigateOver, pageOver } from '../../../src/router/page-under'

const MEDIA = '/media/ag:(anilist:207141,mal:63403)/frieren'
const LISTING = '/search?genre=Action'
const OVER = { under: LISTING, top: 2243 }

/** A browser at `url`, scrolled to `top`, whose entry holds `state`, recording every entry written after it. */
const at = (url: string, state: unknown = null, top = 0) => {
  const { pathname, search, href } = new URL(url, 'https://anime.fkn.app')
  const written: [string, unknown, string][] = []
  vi.stubGlobal('location', { pathname, search, href, origin: 'https://anime.fkn.app' })
  vi.stubGlobal('scrollY', top)
  vi.stubGlobal('history', {
    state,
    pushState: (next: unknown, _: string, to: string) => { written.push(['push', next, to]) },
    replaceState: (next: unknown, _: string, to: string) => { written.push(['replace', next, to]) },
  })
  return written
}

afterEach(() => { vi.unstubAllGlobals() })

describe('pageOver', () => {
  test('names the search a preview\'s entry keeps, and its place', () => {
    expect(pageOver(MEDIA, OVER)).toEqual(OVER)
  })

  test('names nothing for a preview opened from home, nor on any other page, nor for a state another script wrote', () => {
    expect(pageOver(MEDIA, null)).toBeUndefined()
    expect(pageOver(LISTING, { under: '/search?genre=Drama', top: 0 })).toBeUndefined()
    expect(pageOver(MEDIA, { under: 1, top: 0 })).toBeUndefined()
    expect(pageOver(MEDIA, { under: LISTING })).toBeUndefined()
  })
})

describe('navigateOver', () => {
  test('a card on a search opens its preview over that search, where it is scrolled to', () => {
    const written = at(LISTING, null, 2243)
    navigateOver(MEDIA)
    expect(written).toEqual([['push', OVER, MEDIA]])
  })

  test('a preview over a search keeps it under another preview it opens, and under its address growing', () => {
    const written = at(MEDIA, OVER)
    navigateOver('/media/ag:(anilist:182255)')
    navigateOver(`${MEDIA}-2`, { replace: true })
    expect(written).toEqual([
      ['push', OVER, '/media/ag:(anilist:182255)'],
      ['replace', OVER, `${MEDIA}-2`],
    ])
  })

  test('a preview opened from any other page keeps no page under it, as before: home, the lists, a watch page', () => {
    for (const page of ['/', '/list', '/watch/ag:(anilist:207141)/ag:(anizip:19873-4)', MEDIA]) {
      const written = at(page, null, 900)
      navigateOver('/media/ag:(anilist:182255)')
      expect(written, page).toEqual([['push', null, '/media/ag:(anilist:182255)']])
    }
  })

  test('leaving a preview over a search for another page keeps nothing', () => {
    const written = at(MEDIA, OVER)
    navigateOver(LISTING)
    navigateOver('/title/ag:(anilist:207141)', { replace: true })
    expect(written).toEqual([['push', null, LISTING], ['replace', null, '/title/ag:(anilist:207141)']])
  })
})
