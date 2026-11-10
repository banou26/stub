// Trakt's title and overview of a show in the viewer's language, from `/shows/{id}/translations/{language}`. The French
// is what apiz.trakt.tv answered for Frieren on 2026-11-10, its overview trimmed; the show's `available_translations`
// is that day's too. The Portuguese pair is made up.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/trakt/extractor'
import SHOW from './__fixtures__/show-frieren.json'
import SEASONS from './__fixtures__/seasons-frieren.json'

const BASE = 'https://apiz.trakt.tv/shows/frieren-beyond-journey-s-end'
const AVAILABLE = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fo', 'fr', 'he', 'hi', 'hu', 'id', 'is', 'it', 'ja', 'ko', 'lt', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh']
const FRENCH = 'L’elfe Frieren a vaincu le roi des démons aux côtés du groupe mené par le jeune héros Himmel.'

const routes = (available: string[]): Record<string, unknown> => ({
  '?extended=full': { ...SHOW, available_translations: available },
  '/seasons?extended=episodes,full': SEASONS,
  '/translations/fr': [{ title: 'Frieren', overview: FRENCH, tagline: null, language: 'fr', country: 'fr' }],
  '/translations/pt': [
    { title: 'Frieren e a Jornada para o Além', overview: '', tagline: null, language: 'pt', country: 'br' },
    { title: 'Frieren: Para Além do Fim da Jornada', overview: '', tagline: null, language: 'pt', country: 'pt' },
  ],
})

type Texts = { titles: { language: string, title: string, score: number, class?: string }[], descriptions: { language: string, description: string }[] }

const open = async (language: string, available = AVAILABLE) => {
  const asked: string[] = []
  const answers = routes(available)
  const context = {
    language,
    fetch: async (url: string, init: object) => {
      asked.push(JSON.stringify([url, init]))
      const body = answers[url.slice(BASE.length)]
      if (!body) throw new Error(`fixture has no route for ${url}`)
      return { json: async () => body }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'trakt:frieren-beyond-journey-s-end' } }, context).next()
  return { media: value.media as Texts, asked: asked.map(request => JSON.parse(request)[0].slice(BASE.length)), requests: asked }
}

// Mutation: drop the translation from `getMedia`, and the French title and overview are gone
test('a French viewer gets Trakt\'s French title and overview', async () => {
  const { media, asked } = await open('fr-FR')
  expect(asked).toContain('/translations/fr')
  expect(media.titles.at(-1)).toEqual({ language: 'fr', title: 'Frieren', score: 0.03, class: 'TRANSLATED' })
  expect(media.descriptions.map(({ language, description }) => `${language} ${description.slice(0, 9)}`)).toEqual(['en After the', 'fr L’elfe Fr'])
})

// Mutation: take the first translation `/translations/pt` answers, and a viewer in Portugal reads Brazil's title
test('a viewer in Portugal gets Portugal\'s Portuguese over Brazil\'s, and an empty overview is none', async () => {
  const { media } = await open('pt-PT')
  expect(media.titles.at(-1)!.title).toBe('Frieren: Para Além do Fim da Jornada')
  expect(media.descriptions).toHaveLength(1)
})

// Mutation: drop the `available_translations` check, and a show Trakt has no French for is asked for it
test('a language the show does not name as one it has is not asked', async () => {
  expect((await open('fr-FR', ['en', 'ja'])).asked).not.toContain('/translations/fr')
})

// Mutation: take `en` out of the languages `askedLocale` refuses, and an English viewer asks Trakt for English. Trakt is
// asked from the viewer's browser, so this keeps its own cache's entries too.
test('an English viewer sends exactly the requests every viewer sent before', async () => {
  for (const language of ['en-US', 'en-GB']) {
    const { requests } = await open(language)
    expect(createHash('sha256').update(requests.join('\n')).digest('hex'), language).toBe('67b5e9e96a9a9425c147a1b896ba1dded4be8c686b453813f61a000ee159bb67')
  }
})
