// TMDB's show pages on 2026-10-12, cut to the lines carrying the title, the season links, the genres,
// the original language and the keywords.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/tmdb/extractor'

const SHOWS: Record<string, string> = {
  209867: 'frieren',
  98123: 'immortal-king',
  231003: 'lazarus',
  94605: 'arcane',
  93405: 'squid-game',
  111110: 'one-piece-2023',
  121659: 'yu-yu-hakusho-2023',
  110316: 'alice-in-borderland',
  84469: 'cowboy-bebop-2021',
}

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/show-${name}.html`, import.meta.url), 'utf8')

const show = async (id: string, edit = (html: string) => html) => {
  const context = {
    fetch: async (url: string) => {
      const page = url.match(/^https:\/\/www\.themoviedb\.org\/tv\/(\d+)\?language=en-US$/)?.[1]
      // the season pages carry no signal, so they answer empty
      return { text: async () => page ? edit(fixture(SHOWS[page]!)) : '' }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `tmdb:${id}` } }, context).next()
  return value.media
}

test('the anime keyword makes a show anime, whatever its language', async () => {
  expect((await show('209867')).categories).toEqual(['ANIME', 'SERIES'])
  const lazarus = await show('231003')
  expect(lazarus.titles[0].title).toBe('Lazarus')
  expect(lazarus.categories).toEqual(['ANIME', 'SERIES'])
})

// Frieren's page with its anime keyword taken out, so only the language can say anime
test.each(['Japanese', 'Chinese', 'Korean'])('animation in %s is anime without the anime keyword', async language => {
  const media = await show('209867', html => html
    .replace(/.*\/keyword\/210024-anime\/.*\n/, '')
    .replace('</bdi></strong> Japanese<', `</bdi></strong> ${language}<`))
  expect(media.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation in Chinese is anime', async () => {
  const immortalKing = await show('98123')
  expect(immortalKing.titles[0].title).toBe('The Daily Life of the Immortal King')
  expect(immortalKing.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation in English, and a live-action show in Korean, are series only', async () => {
  const arcane = await show('94605')
  const squidGame = await show('93405')
  expect(arcane.titles[0].title).toBe('Arcane')
  expect(arcane.categories).toEqual(['SERIES'])
  expect(squidGame.titles[0].title).toBe('Squid Game')
  expect(squidGame.categories).toEqual(['SERIES'])
})

// Cowboy Bebop's `based on anime` keyword, and the Japanese of the other two, are the near misses
test.each([
  ['111110', 'ONE PIECE'],
  ['121659', 'Yu Yu Hakusho'],
  ['110316', 'Alice in Borderland'],
  ['84469', 'Cowboy Bebop'],
])('the live-action show %s, %s, is not anime', async (id, title) => {
  const media = await show(id)
  expect(media.titles[0].title).toBe(title)
  expect(media.categories).toEqual(['SERIES'])
})
