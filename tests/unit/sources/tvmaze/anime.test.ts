// TVmaze's search answers on 2026-10-12, each cut to its first result.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/tvmaze/extractor'
import FRIEREN from '../../../fixtures/tvmaze/search-frieren.json'
import LAZARUS from '../../../fixtures/tvmaze/search-lazarus.json'
import PORORO from '../../../fixtures/tvmaze/search-pororo.json'
import SQUID_GAME from '../../../fixtures/tvmaze/search-squid-game.json'
import THE_SIMPSONS from '../../../fixtures/tvmaze/search-the-simpsons.json'
import LIVE_ACTION from '../../../fixtures/tvmaze/search-live-action.json'

const search = async (answer: unknown) => {
  const context = { fetch: async () => ({ json: async () => answer }) }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'a title' } }, context).next()
  return value.mediaPage.nodes[0]
}

test('the Anime genre makes a show anime, whatever its language', async () => {
  expect((await search(FRIEREN)).categories).toEqual(['ANIME', 'SERIES'])
  const lazarus = await search(LAZARUS)
  expect(lazarus.titles[0].title).toBe('Lazarus')
  expect(lazarus.categories).toEqual(['ANIME', 'SERIES'])
})

// Frieren with its Anime genre taken out, so only the language can say anime
test.each(['Japanese', 'Chinese', 'Korean'])('animation in %s is anime without the Anime genre', async language => {
  const [result] = FRIEREN
  const media = await search([{ ...result, show: { ...result!.show, language, genres: [] } }])
  expect(media.categories).toEqual(['ANIME', 'SERIES'])
})

// a Korean children's cartoon with no Anime genre, which the owner chose to count as anime
test('animation in Korean is anime', async () => {
  const pororo = await search(PORORO)
  expect(pororo.titles[0].title).toBe('Pororo The Little Penguin')
  expect(pororo.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation in English, and a live-action show in Korean, are series only', async () => {
  const simpsons = await search(THE_SIMPSONS)
  const squidGame = await search(SQUID_GAME)
  expect(simpsons.titles[0].title).toBe('The Simpsons')
  expect(simpsons.categories).toEqual(['SERIES'])
  expect(squidGame.titles[0].title).toBe('Squid Game')
  expect(squidGame.categories).toEqual(['SERIES'])
})

// the live-action row of each adaptation's search, 2026-10-12
test.each(LIVE_ACTION)('the live-action $show.name ($show.premiered) is not anime', async result => {
  const media = await search([result])
  expect(media.titles[0].title).toBe(result.show.name)
  expect(media.categories).toEqual(['SERIES'])
})
