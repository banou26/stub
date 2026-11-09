// STUB-374: a viewer reading French sees the French title AniZip answers on the title page and on a card, and the
// French synopsis where a source has one, while the cluster, its stored first title and every match stay the English
// ones every viewer gets. The page's own documents run over the graph through the app's own `Media` resolvers, as in
// ./read.test.ts.
import { afterAll, beforeAll, expect, test, vi } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import { createSchema, createYoga } from 'graphql-yoga'

// see ./read.test.ts: urql cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

import { normalizeMedia } from '../../../../src/sources/anizip/extractor'
import { resolvers as mediaResolvers } from '../../../../src/worker/resolvers/media/index'
import { typeDefs } from '../../../../src/generated/schema/typeDefs.generated'
import { holdViewerLanguages } from '../../../../src/viewer-languages'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { pageClusters, resolveMedia, setReadStore } from '../../../../src/worker/graph/read'
import PENGUIN_HIGHWAY from '../../../fixtures/anizip/penguin-highway.json'
import FRIEREN_SEASON_2 from '../../../fixtures/anizip/frieren-season-2.json'
import { answer, media, rowsOf, title } from './plugins/fixtures'

const documentNamed = (file: string, name: string): string => {
  const source = readFileSync(new URL(file, import.meta.url).pathname, 'utf-8')
  const block = [...source.matchAll(/gql\(`([\s\S]*?)`\)/g)].map(match => match[1]!)
    .find(entry => entry.includes(`subscription ${name}(`) || entry.includes(`fragment ${name} on`))
  if (!block) throw new Error(`no document named ${name} in ${file}: the client renamed it`)
  return block
}

const MEDIA_FRAGMENT = documentNamed('../../../../src/worker/resolvers/media/fragment.ts', 'MediaFragment')
const EPISODE_FRAGMENT = documentNamed('../../../../src/worker/resolvers/episode/fragment.ts', 'EpisodeFragment')
// the title page's and the modal's, and the home row's cards
const TITLE_PAGE = `${documentNamed('../../../../src/router/home/media-details.tsx', 'GetMediaDetails')}\n${MEDIA_FRAGMENT}\n${EPISODE_FRAGMENT}`
const CARDS = `${documentNamed('../../../../src/router/home/index.tsx', 'GetReleasingMediaPage')}\n${MEDIA_FRAGMENT}`

const server = createYoga({
  schema: createSchema({
    typeDefs,
    resolvers: {
      Query: {},
      Mutation: {},
      Subscription: {
        mediaPage: {
          subscribe: async function* (_parent: unknown, args: { input: { nodes?: { uri: string }[] | null } }) {
            yield { mediaPage: { nodes: await pageClusters((args.input.nodes ?? []).map(node => node.uri)) } }
          },
        },
        media: {
          subscribe: async function* (_parent: unknown, args: { input: { uri?: string | null } }) {
            yield { media: await resolveMedia(args.input.uri ?? '') }
          },
        },
      },
      Media: mediaResolvers.Media,
    } as never,
  }),
  maskedErrors: false,
})

const execute = async (document: string, variables: Record<string, unknown>) => {
  const response = await server.handleRequest(new Request('http://d/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ query: document, variables }),
  }), {})
  const [payload] = [...(await response.text()).matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]!))
  if (payload?.errors) throw new Error(JSON.stringify(payload.errors))
  return payload?.data
}

type Shown = { titles: { title: string }[], descriptions?: { description: string }[], shortDescriptions?: { shortDescription: string }[] }

/** The title page's titles and synopses, and the card's, as a viewer reading `language` is answered them. */
const shownTo = async (language: string) => {
  holdViewerLanguages({ language })
  const page = (await execute(TITLE_PAGE, { input: { uri: 'ag:(anilist:101249)' }, descriptionInput: { type: 'TEXT' } })).media as Shown
  const [card] = (await execute(CARDS, { input: { nodes: [{ uri: 'anilist:101249' }] }, shortDescriptionInput: { count: 1 } })).mediaPage.nodes as Shown[]
  return {
    heading: page.titles.map(({ title }) => title).slice(0, 2),
    synopses: page.descriptions!.map(({ description }) => description.trim()),
    card: [card!.titles[0]!.title, card!.shortDescriptions![0]!.shortDescription.trim()],
  }
}

const ENGLISH = 'A boy finds penguins in his town.'
const LONGER = 'Aoyama, a fourth grader who takes notes on everything, finds penguins in his suburban town, far from any sea.'
const FRENCH = 'Un garçon trouve des pingouins dans sa ville.'

beforeAll(async () => {
  await enableGraph(true)
  setReadStore('graph')
  // the page's own answers: AniList's, AniZip's as its extractor builds it for a French viewer, and JustWatch's film
  // with a synopsis in English and in French. Beside them, a film no source links to it, titled as AniZip translates
  // it, which a translation in the profile would weld to it.
  await ingestAnswers([
    await answer('media', media('anilist:101249', {
      score: 0.8, type: 'MOVIE', categories: ['ANIME', 'MOVIE'], startDate: '2018-08-17', episodeCount: 1,
      titles: [title('en', 'Penguin Highway', 0.8), title('jp-en', 'Pengin Haiuei', 0.8)],
      descriptions: [{ language: 'en', description: LONGER, score: 0.8 }],
      shortDescriptions: [{ language: 'en', shortDescription: LONGER, score: 0.8 }],
    })),
    await answer('media', normalizeMedia(PENGUIN_HIGHWAY as never, 'fr-FR') as never),
    await answer('media', media('jw:405112', {
      score: 0.2, type: 'MOVIE', categories: ['ANIME', 'MOVIE'], startDate: '2018-08-17',
      titles: [title('en', 'Penguin Highway', 0.2)],
      handles: [{ relation: 'SAME_AS', node: media('anilist:101249') }],
      descriptions: [{ language: 'en', description: ENGLISH, score: 0.2 }, { language: 'fr', description: FRENCH, score: 0.2 }],
      shortDescriptions: [{ language: 'en', shortDescription: ENGLISH, score: 0.2 }, { language: 'fr', shortDescription: FRENCH, score: 0.2 }],
    })),
    // and a season whose Chinese title alone says which, as a viewer reading Chinese gets it
    await answer('media', normalizeMedia(FRIEREN_SEASON_2 as never, 'zh-Hans') as never),
    await answer('media', media('kitsu:900374', {
      score: 0.3, type: 'MOVIE', categories: ['ANIME', 'MOVIE'], startDate: '2018-08-17', episodeCount: 1,
      titles: [title('en', 'Le mystère des pingouins', 0.3)],
    })),
  ])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => {
  holdViewerLanguages({ language: 'en' })
  setReadStore('legacy')
  await closeGraph()
})

// Mutations: give `translatedTitle` its source's own score, and the stored first title is French; drop its class, and
// the film titled in French joins the cluster.
test('the merge keeps the English titles first and the French one out of every match', async () => {
  const clusters = await rowsOf(`MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE m.uri IN ['anilist:101249', 'anizip:13853', 'jw:405112', 'kitsu:900374']
    RETURN m.uri AS uri, c.id AS id, c.media AS media`)
  const of = (uri: string) => clusters.find(row => row.uri === uri)!
  expect(of('anizip:13853').id, 'AniZip joins AniList').toBe(of('anilist:101249').id)
  expect(of('kitsu:900374').id, 'the film titled in French stays apart').not.toBe(of('anilist:101249').id)
  expect((JSON.parse(String(of('anilist:101249').media)) as Shown).titles.map(({ title }) => title), 'the translation last')
    .toEqual(['Penguin Highway', 'ペンギン・ハイウェイ', 'Pengin Haiuei', 'Le mystère des pingouins'])
})

// Mutation: read every title in `mediaProfileRow` (plugins/profile.ts), and "葬送的芙莉莲 第二季" makes the row a season 2
test('a translation says nothing of which season a row is', async () => {
  const [row] = await rowsOf('MATCH (m:Media {uri: \'anizip:18886\'}) RETURN m.titles AS titles')
  expect((JSON.parse(String(row!.titles)) as { title: string }[]).at(-1)!.title, 'the setup').toBe('葬送的芙莉莲 第二季')
  const [profile] = await rowsOf('MATCH (n:MediaProfile {uri: \'anizip:18886\'}) RETURN n.seasonOrdinal AS seasonOrdinal')
  expect(profile!.seasonOrdinal).toBeNull()
})

// Mutation: drop `translationFirst` from the `titles` resolver, or `synopsesIn` from `descriptions` or
// `shortDescriptions`, and the French viewer reads English there.
test('a French viewer\'s title page and card lead with the French title and show the French synopsis', async () => {
  expect(await shownTo('fr-FR')).toEqual({
    heading: ['Le mystère des pingouins', 'Penguin Highway'],
    synopses: [FRENCH],
    card: ['Le mystère des pingouins', FRENCH],
  })
})

test('an English viewer\'s title page and card are as before', async () => {
  expect(await shownTo('en-US')).toEqual({
    heading: ['Penguin Highway', 'ペンギン・ハイウェイ'],
    synopses: [LONGER, ENGLISH],
    card: ['Penguin Highway', LONGER],
  })
})
