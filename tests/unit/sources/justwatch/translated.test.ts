// STUB-374: JustWatch's title and synopsis in the viewer's language, asked in the same request as the English. Dune:
// Part Two as JustWatch answered stub's own NODE_DETAILS_QUERY on 2026-10-12, with a French title and synopsis made up
// beside it, and the English JustWatch answers where it has no translation (measured on The Suitor, 2026-11-09).
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import DUNE from '../../../fixtures/justwatch/dune-part-two.json'
import SEVERANCE from '../../../fixtures/justwatch/severance.json'
import POPULAR_MOVIES from '../../../fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from '../../../fixtures/justwatch/popular-shows.json'
import STAR_WARS from '../../../fixtures/justwatch/star-wars-search.json'
import { viewerIn } from './viewer'

const FRENCH = {
  title: 'Dune : Deuxième partie',
  shortDescription: 'Paul Atreides s\'unit à Chani et aux Fremen pour venger sa famille.',
}

const open = async (translated: { title: string, shortDescription: string }, language: string, node: object = DUNE.data.node, uri = 'jw:1133934') => {
  const bodies: string[] = []
  const answer = { data: { node: { ...node, translated } } }
  const context = {
    language,
    findAggregatedMedia: async () => ({ categories: ['MOVIE'] }),
    listenForMediaChanges: async function* () {},
    fetch: async (_: string, init: { body: string }) => (bodies.push(init.body), { json: async () => answer }),
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri, details: true } }, context).next()
  return { media: value.media, body: JSON.parse(bodies[0]!) }
}

type Texts = { titles: { title: string }[], descriptions: { language: string, description: string }[], episodes: { titles: { title: string }[], descriptions: { description: string }[] }[] }

// Mutation: hand `withTranslation` the media before a film's episode copies it, and the episode carries the French
// title as one of its own, which pairs it with other sources' episodes.
test('a French viewer gets JustWatch\'s French title and synopsis, asked in the same request, and the film\'s episode none', async () => {
  viewerIn('America/New_York')
  const { media, body } = await open(FRENCH, 'fr-CA')
  expect(body.query).toContain('translated: content(country: $country, language: $translation) {')
  expect(body.variables).toMatchObject({ language: 'en', country: 'US', translation: 'fr' })
  const { titles, descriptions, episodes } = media as Texts
  expect(titles).toEqual([
    { language: 'en', title: 'Dune: Part Two', score: 0.2 },
    { language: 'fr', title: FRENCH.title, score: 0.02, class: 'TRANSLATED' },
  ])
  expect(descriptions.map(({ language, description }) => `${language} ${description.slice(0, 22)}`))
    .toEqual(['en Follow the mythic jour', `fr ${FRENCH.shortDescription.slice(0, 22)}`])
  expect(episodes[0]!.titles.map(({ title }) => title)).toEqual(['Dune: Part Two'])
  expect(episodes[0]!.descriptions).toHaveLength(1)
})

// Mutation: drop either comparison with the English in `withTranslation`, and that English comes twice.
test('the English JustWatch answers where it has no translation is no translation', async () => {
  viewerIn('America/New_York')
  const english = { title: DUNE.data.node.content.title, shortDescription: DUNE.data.node.content.shortDescription }
  const { media } = await open(english, 'de-DE')
  expect((media as Texts).titles).toHaveLength(1)
  expect((media as Texts).descriptions).toHaveLength(1)
  const titleOnly = await open({ ...english, title: 'Dune: Teil Zwei' }, 'de-DE')
  expect((titleOnly.media as Texts).titles).toHaveLength(2)
  expect((titleOnly.media as Texts).descriptions, 'the synopsis still English').toHaveLength(1)
})

// Mutation: hand `withTranslation` every season as the show, and Severance's second season, which JustWatch names only
// "Season 2", carries the show's French name and the synopsis of the show's start.
test('the show\'s translation is its first season\'s, and no later season\'s', async () => {
  viewerIn('America/New_York')
  const french = { title: 'Dissociation', shortDescription: 'Mark dirige une équipe dont les souvenirs ont été séparés.' }
  const season = async (uri: string) => (await open(french, 'fr-FR', SEVERANCE.ts320458, uri)).media as Texts
  const shown = ({ titles, descriptions }: Texts) => [...titles.map(({ title }) => title), ...descriptions.map(({ language }) => language)]
  expect(shown(await season('jw:320458-329115'))).toEqual(['Severance', 'Dissociation', 'en', 'fr'])
  expect(shown(await season('jw:320458-350405'))).toEqual(['Severance', 'en'])
})

// Mutation: drop `romanized` from `withTranslation`, and an Arabic viewer's page leads with JustWatch's romanization
test('a romanization is no translation into a language written in another script', async () => {
  viewerIn('America/New_York')
  const titlesIn = async (title: string, language: string) =>
    ((await open({ title, shortDescription: DUNE.data.node.content.shortDescription }, language)).media as Texts).titles.map(({ title }) => title)
  expect(await titlesIn('Dyun: Al-Juz Al-Thani', 'ar')).toEqual(['Dune: Part Two'])
  expect(await titlesIn('كثيب: الجزء الثاني', 'ar')).toEqual(['Dune: Part Two', 'كثيب: الجزء الثاني'])
  expect(await titlesIn('Diuna: Część druga', 'pl'), 'the control, a language written in Latin letters').toEqual(['Dune: Part Two', 'Diuna: Część druga'])
})

type Listing = { data: { popularTitles: { edges: { node: { content: { title: string, shortDescription: string | null } } }[] } } }

// each node answered in French as JustWatch answers where it has no translation, its English, but for `title`'s
const inFrench = ({ data }: Listing, english: string, title: string) => ({ data: { popularTitles: { edges: data.popularTitles.edges.map(({ node }) =>
  ({ node: { ...node, translated: { title: node.content.title === english ? title : node.content.title, shortDescription: node.content.shortDescription } } })) } } })

const listedIn = async (input: object, answer: unknown, language: string) => {
  const bodies: { query: string, variables: Record<string, unknown> }[] = []
  const context = {
    language,
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    fetch: async (_: string, init: { body: string }) => (bodies.push(JSON.parse(init.body)), { json: async () => answer }),
  }
  const { value } = await (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input }, context).next()
  return { nodes: value.mediaPage.nodes as Texts[], body: bodies[0]! }
}

// The French titles are made up. Mutation: leave `translated` out of `popularQuery` or `searchQuery`, and the cards of a
// home row or a search stay English for every viewer.
test('a French viewer\'s home rows and search carry JustWatch\'s French titles, asked in the same request', async () => {
  viewerIn('America/New_York')
  const cases = [
    [{ categories: ['MOVIE'] }, POPULAR_MOVIES, 'Practical Magic', 'Les Ensorceleuses'],
    [{ categories: ['SERIES'] }, POPULAR_SHOWS, 'Slow Horses', 'Les Tocards'],
    [{ search: 'star wars' }, STAR_WARS, 'Star Wars', 'La Guerre des étoiles'],
  ] as const
  for (const [input, answer, english, french] of cases) {
    const { nodes, body } = await listedIn(input, inFrench(answer, english, french), 'fr-FR')
    expect(body.query, english).toContain('translated: content(country: $country, language: $translation) {')
    expect(body.variables.translation, english).toBe('fr')
    const titled = nodes.find(({ titles }) => titles[0]!.title === english)!
    expect(titled.titles.slice(1), english).toEqual([{ language: 'fr', title: french, score: 0.02, class: 'TRANSLATED' }])
    expect(nodes.filter(media => media !== titled).map(({ titles }) => titles.length), 'one equal to the English is none').toEqual([1, 1, 1])
  }
})

// Mutation: hand the search `searchAndLinkMedia` runs `translationOf(ctx)`, and a French viewer's search for a link is a
// body of its own, cached apart from every other viewer's, for a field nothing there reads.
test('the search a link is checked by asks no translation, and the title it links is still asked in French', async () => {
  const bodies: { query: string, variables: Record<string, unknown> }[] = []
  const context = {
    language: 'fr-FR',
    findAggregatedMedia: async () => ({ titles: [{ title: 'Dune: Part Two' }], startDate: '2024-02-27', categories: ['MOVIE'] }),
    listenForMediaChanges: async function* () {},
    fetch: async (_: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return { json: async () => init.body.includes('GetSearchTitles') ? { data: { popularTitles: { edges: [{ node: DUNE.data.node }] } } } : { data: { node: { ...DUNE.data.node, translated: FRENCH } } } }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'ag:(omdb:tt15239678)', details: true } }, context).next()
  const [search, node] = bodies
  expect(search!.query).toContain('GetSearchTitles')
  expect(search!.query).not.toContain('translated')
  expect(search!.variables).not.toHaveProperty('translation')
  expect(node!.variables.translation, 'the control: the node is asked in French').toBe('fr')
  expect((value.media as Texts).titles.map(({ title }) => title)).toEqual(['Dune: Part Two', FRENCH.title])
})
