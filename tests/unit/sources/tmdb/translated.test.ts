// TMDB's name and overview of a show in the viewer's language, from its page asked in that language. The English pages
// are TMDB's as recorded in tests/fixtures/tmdb; the French ones are made up, since TMDB's site was not fetched for this.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/tmdb/extractor'
import BREAKING_BAD from '../../../fixtures/tmdb/show-breaking-bad.html?raw'
import BREAKING_BAD_SEASONS from '../../../fixtures/tmdb/seasons-breaking-bad.html?raw'
import FRIEREN from '../../../fixtures/tmdb/show-frieren.html?raw'
import FRIEREN_SEASONS from '../../../fixtures/tmdb/seasons-frieren.html?raw'

const BASE = 'https://www.themoviedb.org'
const FRENCH = 'Professeur de chimie au Nouveau-Mexique, Walter White apprend qu\'il est atteint d\'un cancer.'
const page = (title: string, overview: string) => `<meta property="og:title" content="${title}"><meta property="og:description" content="${overview}">`
const overviewOf = (html: string) => html.match(/og:description" content="([^"]*)"/)![1]!

const routes: Record<string, string> = {
  '/tv/1396?language=en-US': BREAKING_BAD,
  '/tv/1396/seasons?language=en-US': BREAKING_BAD_SEASONS,
  '/tv/1396/season/1?language=en-US': '',
  '/tv/1396/season/2?language=en-US': '',
  '/tv/1396-breaking-bad?language=fr-FR': page('Breaking Bad', FRENCH),
  '/tv/1396-breaking-bad?language=es-MX': page('Breaking Bad: Química mortal', overviewOf(BREAKING_BAD)),
  '/tv/209867?language=en-US': FRIEREN,
  '/tv/209867/seasons?language=en-US': FRIEREN_SEASONS,
  '/tv/209867/season/1?language=en-US': '',
  // what a page may answer where TMDB has no French: the name in its original script, and the English overview
  '/tv/209867?language=fr-FR': page('葬送のフリーレン', overviewOf(FRIEREN)),
}

type Texts = { titles: { language: string, title: string, score: number, class?: string }[], descriptions: { language: string, description: string }[] }

const open = async (uri: string, language: string) => {
  const asked: string[] = []
  const context = {
    language,
    fetch: async (url: string) => {
      const path = url.replace(BASE, '')
      asked.push(path)
      if (!(path in routes)) throw new Error(`fixture has no route for ${url}`)
      return { status: 200, headers: new Headers(), text: async () => routes[path] }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return { media: value.media as Texts, asked: asked.filter(path => !path.endsWith('language=en-US')) }
}

const shown = ({ titles, descriptions }: Texts) =>
  [...titles.map(({ language, title }) => `${language} ${title}`), ...descriptions.map(({ language, description }) => `${language} ${description.slice(0, 12)}`)]

// Mutation: ask `/tv/1396` rather than the address its English page names, and the French page costs a redirect too,
// a request no route here answers. Drop the translation from `finish`, and the French overview is gone.
test('a French viewer gets TMDB\'s French overview, asked once at the show\'s own address, and no name equal to the English', async () => {
  const { media, asked } = await open('tmdb:1396', 'fr')
  expect(asked).toEqual(['/tv/1396-breaking-bad?language=fr-FR'])
  expect(shown(media)).toEqual(['en Breaking Bad', 'en Walter White', 'fr Professeur d'])
})

// Mutation: hand `translationOf` every season, and season 2 asks the French page and carries the show's overview,
// which would stand alone as the French viewer's synopsis of season 2.
test('the show\'s first season gets its translation, and a later season asks none', async () => {
  expect((await open('tmdb:1396-s1', 'fr')).asked).toEqual(['/tv/1396-breaking-bad?language=fr-FR'])
  const later = await open('tmdb:1396-s2', 'fr')
  expect(later.asked).toEqual([])
  expect(later.media.descriptions.map(({ language }) => language)).toEqual(['en'])
})

// Mutation: drop `writtenIn` from `withTranslation`, and a French viewer's heading is the Japanese name
test('a name left in another script, and an overview equal to the English, are no translation', async () => {
  const { media, asked } = await open('tmdb:209867', 'fr-FR')
  expect(asked).toEqual(['/tv/209867?language=fr-FR'])
  expect(shown(media)).toEqual(['en Frieren: Beyond Journey\'s End', 'en After the pa'])
})

// TMDB names a language with a country, and answers English for one it keeps no translation for: de-AT's, though it has
// the show in German. Mutation: ask the viewer's own country, and de-AT, fr-BE and es-AR ask pages with no translation;
// drop Mexico for Latin America, and es-419 is asked Spain's; drop the countries TMDB keeps apart, and fr-CA is asked
// France's.
test('a viewer is asked the country TMDB keeps their language for, Latin American Spanish Mexico\'s', async () => {
  for (const [language, tag] of [['de-AT', 'de-DE'], ['fr-BE', 'fr-FR'], ['fr-CA', 'fr-CA'], ['es', 'es-ES'], ['es-AR', 'es-MX'], ['pt', 'pt-BR'], ['pt-PT', 'pt-PT']]) {
    expect((await open('tmdb:1396', language!)).asked, language).toEqual([`/tv/1396-breaking-bad?language=${tag}`])
  }
  const { media, asked } = await open('tmdb:1396', 'es-419')
  expect(asked).toEqual(['/tv/1396-breaking-bad?language=es-MX'])
  expect(media.titles.at(-1)).toEqual({ language: 'es', title: 'Breaking Bad: Química mortal', score: 0.03, class: 'TRANSLATED' })
})

// The relay caches on the whole request. Mutation: take `en` out of the languages `askedLocale` refuses, and an English
// viewer asks a page more.
test('an English viewer asks exactly what every viewer asked before', async () => {
  for (const language of ['en-US', 'en-GB']) {
    const urls: string[] = []
    const context = { language, fetch: async (url: string) => (urls.push(url), { status: 200, headers: new Headers(), text: async () => routes[url.replace(BASE, '')] ?? '' }) }
    await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'tmdb:1396-s1' } }, context).next()
    expect(createHash('sha256').update(urls.join('\n')).digest('hex'), language).toBe('08442dcd8546b343ebd3c45aff798260cfd11a6f485386fd2e5267298789b211')
  }
})
