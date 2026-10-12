// The four sites' rule, as decided by the owner on 2026-10-11 and 12: anime films show on anime and
// movie, Chinese and Korean animation is anime, and live-action adaptations never are.
import { expect, test } from 'vite-plus/test'

import { siteAllows, siteAsks, siteOf, type Site } from '../../src/site'

const SITES: Site[] = ['anime', 'movie', 'series', 'stub']

const TABLE: { title: string, categories: string[], sites: Site[] }[] = [
  { title: 'Frieren', categories: ['ANIME', 'SERIES'], sites: ['anime', 'stub'] },
  { title: 'Your Name', categories: ['ANIME', 'MOVIE'], sites: ['anime', 'movie', 'stub'] },
  { title: 'an OVA no source gives a format', categories: ['ANIME'], sites: ['anime', 'stub'] },
  { title: 'The Daily Life of the Immortal King', categories: ['ANIME', 'SERIES'], sites: ['anime', 'stub'] },
  { title: 'Arcane', categories: ['SERIES'], sites: ['series', 'stub'] },
  { title: 'Golden Axe (JP and US)', categories: ['SERIES'], sites: ['series', 'stub'] },
  { title: 'One Piece (2023)', categories: ['SERIES'], sites: ['series', 'stub'] },
  { title: 'Kamen Rider: The Movie', categories: ['MOVIE'], sites: ['movie', 'stub'] },
  { title: 'Spider-Man: Across the Spider-Verse', categories: ['MOVIE'], sites: ['movie', 'stub'] },
  { title: 'a row no source categorized', categories: [], sites: ['stub'] },
]

test.each(TABLE)('$title shows on $sites', ({ categories, sites }) => {
  expect(SITES.filter(site => siteAllows(categories, site))).toEqual(sites)
})

test('the site is the address\'s first label on fkn.app and localhost, and everything anywhere else', () => {
  expect(siteOf('anime.fkn.app')).toBe('anime')
  expect(siteOf('movie.fkn.app')).toBe('movie')
  expect(siteOf('series.fkn.app')).toBe('series')
  expect(siteOf('movie.localhost')).toBe('movie')
  expect(siteOf('stub.fkn.app')).toBe('stub')
  expect(siteOf('stub-ben.pages.dev')).toBe('stub')
  expect(siteOf('movie.stub-ben.pages.dev')).toBe('stub')
  expect(siteOf('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku.sdbx.app')).toBe('stub')
  expect(siteOf('localhost')).toBe('stub')
})

test('movie and series never ask the anime catalogues, and anime and stub ask every source', () => {
  for (const origin of ['anilist', 'mal', 'kitsu', 'livechart', 'anizip', 'offline', 'cr']) {
    expect([siteAsks(origin, 'movie'), siteAsks(origin, 'series')], origin).toEqual([false, false])
    expect([siteAsks(origin, 'anime'), siteAsks(origin, 'stub')], origin).toEqual([true, true])
  }
  expect(SITES.map(site => siteAsks('jw', site))).toEqual([true, true, true, true])
})
