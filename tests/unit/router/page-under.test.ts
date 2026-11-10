// A preview opened from a search is drawn over that search, so closing it or Back returns to the same results where
// they were. Its history entry is what remembers the search, so every navigation through wouter has to write it.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { navigateOver, pageUnder } from '../../../src/router/page-under'

const MEDIA = '/media/ag:(anilist:207141,mal:63403)/frieren'
const LISTING = '/search?genre=Action'

/** A browser at `url` whose entry holds `state`, recording every entry written after it. */
const at = (url: string, state: unknown = null) => {
  const { pathname, search, href } = new URL(url, 'https://anime.fkn.app')
  const written: [string, unknown, string][] = []
  vi.stubGlobal('location', { pathname, search, href, origin: 'https://anime.fkn.app' })
  vi.stubGlobal('history', {
    state,
    pushState: (next: unknown, _: string, to: string) => { written.push(['push', next, to]) },
    replaceState: (next: unknown, _: string, to: string) => { written.push(['replace', next, to]) },
  })
  return written
}

afterEach(() => { vi.unstubAllGlobals() })

describe('pageUnder', () => {
  test('names the page a preview\'s entry keeps', () => {
    expect(pageUnder(MEDIA, { under: LISTING })).toBe(LISTING)
  })

  test('names nothing for a preview opened from home, nor on any other page, nor for a state another script wrote', () => {
    expect(pageUnder(MEDIA, null)).toBeUndefined()
    expect(pageUnder(LISTING, { under: '/search?genre=Drama' })).toBeUndefined()
    expect(pageUnder(MEDIA, { under: 1 })).toBeUndefined()
  })
})

describe('navigateOver', () => {
  test('a card on a search opens its preview over that search', () => {
    const written = at(LISTING)
    navigateOver(MEDIA)
    expect(written).toEqual([['push', { under: LISTING }, MEDIA]])
  })

  test('a preview over a search keeps it under another preview it opens, and under its address growing', () => {
    const written = at(MEDIA, { under: LISTING })
    navigateOver('/media/ag:(anilist:182255)')
    navigateOver(`${MEDIA}-2`, { replace: true })
    expect(written).toEqual([
      ['push', { under: LISTING }, '/media/ag:(anilist:182255)'],
      ['replace', { under: LISTING }, `${MEDIA}-2`],
    ])
  })

  test('a preview opened from any other page keeps no page under it, as before: home, the lists, a watch page', () => {
    for (const page of ['/', '/list', '/watch/ag:(anilist:207141)/ag:(anizip:19873-4)', MEDIA]) {
      const written = at(page)
      navigateOver('/media/ag:(anilist:182255)')
      expect(written, page).toEqual([['push', null, '/media/ag:(anilist:182255)']])
    }
  })

  test('leaving a preview over a search for another page keeps nothing', () => {
    const written = at(MEDIA, { under: LISTING })
    navigateOver(LISTING)
    navigateOver('/title/ag:(anilist:207141)', { replace: true })
    expect(written).toEqual([['push', null, LISTING], ['replace', null, '/title/ag:(anilist:207141)']])
  })
})
