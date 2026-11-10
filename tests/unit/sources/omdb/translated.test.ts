// IMDb's title and plot in the viewer's language, asked with the language headers beside the English query. The French
// answer is the one IMDb gave for Demon Slayer: Mugen Train (tt11032374) asked `fr-FR` on 2026-11-10, its plot named
// `fr-FR`; the English beside it is trimmed to what the title page reads.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/omdb/extractor'

const ENGLISH = {
  id: 'tt11032374',
  titleText: { text: 'Demon Slayer: Kimetsu no Yaiba - The Movie: Mugen Train' },
  titleType: { id: 'movie' },
  releaseYear: { year: 2020 },
  plot: { plotText: { plainText: 'After his family was brutally murdered and his sister turned into a demon, Tanjiro sets out to slay demons.' } },
}
const FRENCH = {
  titleText: { text: 'Demon Slayer - Le Train de l\'infini' },
  plot: {
    plotText: { plainText: 'Tanjirō et ses amis montent à bord du train de l\'Infini afin de rencontrer Kyōjurō Rengoku, le Pilier de la flamme.' },
    language: { id: 'fr-FR' },
  },
}
// made up: where IMDb has no German, its English title, and a plot it names as another language's
const GERMAN = { titleText: ENGLISH.titleText, plot: { plotText: { plainText: 'Tanjirō y sus amigos suben al Tren Infinito.' }, language: { id: 'es-ES' } } }

type Request = { headers: Record<string, string>, body: string }
type Texts = { titles: { language: string, title: string, score: number, class?: string }[], descriptions: { language: string }[], episodes: { titles: unknown[] }[] }

const open = async (language: string, translated: object) => {
  const requests: Request[] = []
  const context = {
    language,
    fetch: async (_: string, init: Request) => {
      requests.push(init)
      return { json: async () => ({ data: { title: init.headers['x-imdb-user-language'] ? translated : ENGLISH } }) }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'omdb:tt11032374' } }, context).next()
  return { media: value.media as Texts, requests }
}

// Mutation: drop the translation from the subscription, and the French title and plot are gone; hand the media to
// `withTranslation` before `getMedia` copies it onto the film's episode, and the episode carries the French title too.
test('a French viewer gets IMDb\'s French title and plot, asked with its language headers, and the film\'s episode none', async () => {
  const { media, requests } = await open('fr-CA', FRENCH)
  expect(requests.map(({ headers }) => [headers['x-imdb-user-language'], headers['x-imdb-user-country']])).toEqual([[undefined, undefined], ['fr-CA', 'CA']])
  expect(JSON.parse(requests[1]!.body).query).toBe('query Title($id: ID!) { title(id: $id) { titleText { text } plot { plotText { plainText } language { id } } } }')
  expect(media.titles).toEqual([
    { language: 'en', title: ENGLISH.titleText.text, score: 0.3 },
    { language: 'fr', title: FRENCH.titleText.text, score: 0.03, class: 'TRANSLATED' },
  ])
  expect(media.descriptions.map(({ language }) => language)).toEqual(['en', 'fr'])
  expect(media.episodes[0]!.titles).toHaveLength(1)
})

// Mutation: drop the plot's language check from `translationOf`, and a German viewer's synopsis is in Spanish
test('a title equal to the English, and a plot IMDb names as another language\'s, are no translation', async () => {
  const { media, requests } = await open('de-DE', GERMAN)
  expect(requests).toHaveLength(2)
  expect(media.titles).toHaveLength(1)
  expect(media.descriptions).toHaveLength(1)
})

// Mutation: ask every language but English, and a Polish viewer sends IMDb a request it answers in English
test('a language imdb.com is not offered in is not asked', async () => {
  expect((await open('pl', FRENCH)).requests).toHaveLength(1)
})

// The relay caches on the whole request, headers included. Mutation: list `en-US` among LANGUAGES and take `en` out of
// the languages `askedLocale` refuses, and an English viewer sends a second request.
test('an English viewer sends exactly the request every viewer sent before', async () => {
  for (const language of ['en-US', 'en-GB']) {
    const { requests } = await open(language, FRENCH)
    expect(createHash('sha256').update(JSON.stringify(requests)).digest('hex'), language).toBe('d99d7ebbf3927851dcc614ecf75abd8d095b1fc78ddbc47b579340d86806a332')
  }
})
