// Trakt's show and search answers on 2026-10-12, trimmed like ./extractor.test.ts's.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/trakt/extractor'

const SHOWS: Record<string, string> = {
  'frieren-beyond-journey-s-end': 'frieren',
  'the-daily-life-of-the-immortal-king': 'immortal-king',
  'lookism-2022': 'lookism-2022',
  lookism: 'lookism-2019',
  'the-simpsons': 'the-simpsons',
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))

const show = async (slug: string, edit = (answer: any) => answer) => {
  const context = {
    fetch: async (url: string) => {
      const name = SHOWS[url.match(/\/shows\/([^/?]+)\?extended=full$/)?.[1] ?? '']
      // the seasons answer carries no signal, so it answers empty
      return { json: async () => name ? edit(fixture(`show-${name}`)) : [] }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `trakt:${slug}` } }, context).next()
  return value.media
}

test('the anime and donghua genres make a show anime', async () => {
  expect((await show('frieren-beyond-journey-s-end')).categories).toEqual(['ANIME', 'SERIES'])
  const immortalKing = await show('the-daily-life-of-the-immortal-king')
  expect(immortalKing.titles[0].title).toBe('The Daily Life of the Immortal King')
  expect(immortalKing.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation from Korea is anime', async () => {
  const lookism = await show('lookism-2022')
  expect(lookism.titles[0].title).toBe('Lookism')
  expect(lookism.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation from the US, and a live-action show from China, are series only', async () => {
  expect((await show('the-simpsons')).categories).toEqual(['SERIES'])
  const liveAction = await show('lookism')
  expect(liveAction.titles[0].title).toBe('Lookism')
  expect(liveAction.categories).toEqual(['SERIES'])
})

// Frieren with its anime genre taken out, so only the country can say anime
test.each(['jp', 'cn', 'kr'])('animation from %s is anime without the anime genre', async country => {
  const media = await show('frieren-beyond-journey-s-end', answer => ({ ...answer, genres: ['animation'], country }))
  expect(media.categories).toEqual(['ANIME', 'SERIES'])
})

test('a search row carries the signal too', async () => {
  const context = { fetch: async () => ({ json: async () => fixture('search-lookism') }) }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'lookism' } }, context).next()
  const [animated, liveAction] = value.mediaPage.nodes
  expect(animated.url).toBe('https://trakt.tv/shows/lookism-2022')
  expect(animated.categories).toEqual(['ANIME', 'SERIES'])
  expect(liveAction.categories).toEqual(['SERIES'])
})
