// Crunchyroll's series title and description in the viewer's language, from the series asked with that `locale` as the
// English is asked with `en-US`. The answers are made up, in Crunchyroll's shape: Crunchyroll was not reachable from
// where this was written.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/crunchyroll/extractor'

const CMS = 'https://www.crunchyroll.com/content/v2/cms'
const SERIES = { id: 'GG5H5XQX4', title: 'Frieren: Beyond Journey\'s End', slug_title: 'frieren', description: 'An elf outlives her party.', images: {} }
const FRENCH = { ...SERIES, title: 'Frieren', description: 'Une elfe survit à ses compagnons.' }

const routes: Record<string, unknown> = {
  [`${CMS}/series/GG5H5XQX4?preferred_audio_language=ja-JP&locale=en-US`]: { data: [SERIES] },
  [`${CMS}/series/GG5H5XQX4?preferred_audio_language=ja-JP&locale=fr-FR`]: { data: [FRENCH] },
  // where Crunchyroll has no German, its English
  [`${CMS}/series/GG5H5XQX4?preferred_audio_language=ja-JP&locale=de-DE`]: { data: [SERIES] },
  [`${CMS}/series/GG5H5XQX4/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`]: { data: [
    { id: 'GS1', title: SERIES.title, description: 'The first season.', season_number: 1, audio_locale: 'ja-JP' },
    { id: 'GS2', title: 'Frieren: Beyond Journey\'s End Season 2', description: 'The second season.', season_number: 2, audio_locale: 'ja-JP' },
  ] },
  [`${CMS}/seasons/GS1/episodes?preferred_audio_language=ja-JP&locale=en-US`]: { data: [] },
  [`${CMS}/seasons/GS2/episodes?preferred_audio_language=ja-JP&locale=en-US`]: { data: [] },
}

type Texts = { titles: { language: string, title: string, score: number, class?: string }[], descriptions: { language: string, description: string }[] }

const open = async (uri: string, language: string) => {
  const requests: string[] = []
  const context = {
    language,
    fetch: async (url: string, init: object) => {
      // the token is the module's once fetched, so whether a test asks it depends on the tests before it
      if (url === 'https://www.crunchyroll.com/auth/v1/token') return { headers: new Headers(), json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }
      requests.push(JSON.stringify([url, init]))
      if (!(url in routes)) throw new Error(`fixture has no route for ${url}`)
      return { headers: new Headers(), json: async () => routes[url] }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  const asked = requests.map(request => JSON.parse(request)[0] as string).filter(url => url.includes('locale=') && !url.endsWith('locale=en-US'))
  return { media: value.media as Texts, asked, requests }
}

const shown = ({ titles, descriptions }: Texts) =>
  [...titles.map(({ language, title }) => `${language} ${title}`), ...descriptions.map(({ language, description }) => `${language} ${description}`)]

// Mutation: drop the translation from `getMedia`, and the French title and description are gone
test('a French viewer gets the series\' French title and description, on the series and its first season', async () => {
  for (const uri of ['cr:GG5H5XQX4', 'cr:GG5H5XQX4-GS1']) {
    const { media, asked } = await open(uri, 'fr')
    expect(asked, uri).toEqual([`${CMS}/series/GG5H5XQX4?preferred_audio_language=ja-JP&locale=fr-FR`])
    expect(media.titles.at(-1), uri).toEqual({ language: 'fr', title: 'Frieren', score: 0.05, class: 'TRANSLATED' })
    expect(media.descriptions.at(-1)!.description, uri).toBe(FRENCH.description)
  }
})

// Mutation: drop the `season_number` check, and season 2 asks the French series and carries its description, which
// would stand alone as a French viewer's synopsis of season 2
test('a later season asks no translation', async () => {
  const { media, asked } = await open('cr:GG5H5XQX4-GS2', 'fr')
  expect(asked).toEqual([])
  expect(shown(media)).toEqual(['en Frieren: Beyond Journey\'s End Season 2', 'en The second season.'])
})

// Mutation: drop either comparison with what the media holds from `withTranslation`, and the English comes twice
test('Crunchyroll\'s English where it has no German is no translation', async () => {
  const { media, asked } = await open('cr:GG5H5XQX4', 'de-AT')
  expect(asked).toEqual([`${CMS}/series/GG5H5XQX4?preferred_audio_language=ja-JP&locale=de-DE`])
  expect(shown(media)).toEqual(['en Frieren: Beyond Journey\'s End', 'en An elf outlives her party.'])
})

// The relay caches on the whole request. Mutation: list `en-US` among LOCALES and take `en` out of the languages
// `askedLocale` refuses, and an English viewer asks the series twice.
test('an English viewer sends exactly the requests every viewer sent before', async () => {
  for (const language of ['en-US', 'en-GB']) {
    const { requests } = await open('cr:GG5H5XQX4-GS1', language)
    expect(createHash('sha256').update(requests.join('\n')).digest('hex'), language).toBe('a8b45326ca4c7d1343e8173414f215e3760bcf69cfebad252182f45359330735')
  }
})
