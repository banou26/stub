// Even the Student Council Has Its Holes! as JustWatch answered stub's own search and node bodies for a viewer in
// Japan on 2026-10-29, each catalogue's search cut to its first three: the US catalogue does not carry the show and
// Japan's names it first.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import SEARCH from '../../../fixtures/justwatch/student-council-holes-search.json'
import NODE from '../../../fixtures/justwatch/student-council-holes.json'
import { viewerIn } from './viewer'

const KNOWN = {
  titles: [{ title: 'Even the Student Council Has Its Holes!' }, { title: 'Seitokai ni mo Ana wa Aru!' }],
  startDate: '2026-01-07',
  episodeCount: 12,
  categories: ['ANIME', 'SERIES'],
}

const open = async ({ search = SEARCH as unknown, node = NODE as unknown } = {}) => {
  const bodies: { query: string, variables: Record<string, unknown> }[] = []
  const context = {
    findAggregatedMedia: async () => KNOWN,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      const body = JSON.parse(init.body)
      bodies.push(body)
      const { nodeId } = body.variables
      return { json: async () => (!nodeId ? search : nodeId === 'ts471256' ? node : { data: { node: null } }) }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:191656,mal:61578)' } }, context).next()
  return { media: value.media, bodies }
}

test('a show the US catalogue does not carry is found in the viewer\'s, read in US English', async () => {
  viewerIn('Asia/Tokyo')
  const { media, bodies } = await open()
  expect(bodies[0]!.variables).toMatchObject({ country: 'US', offerCountry: 'JP' })
  expect(media.uri).toBe('jw:471256-500395')
  expect(media.titles[0].title).toBe('Even the Student Council Has Its Holes!')
  expect(media.handles.map(({ relation, node }: { relation: string, node: { uri: string } }) => `${relation} ${node.uri}`))
    .toContain('PART_OF disney:5c5f29e8-4417-44b0-aacd-391dbf1726d1')

  const usAlone = { data: { popularTitles: SEARCH.data.popularTitles } }
  expect((await open({ search: usAlone })).media, 'the control: the US catalogue alone does not carry it').toBeNull()
})

// a viewer in the US would ask the same catalogue twice; tests/unit/sources/justwatch/details.test.ts pins that body
test('the viewer\'s catalogue is asked in the same request, and only outside the US', async () => {
  viewerIn('Asia/Tokyo')
  const [abroad] = (await open()).bodies
  expect(abroad!.query).toMatch(/viewerTitles: popularTitles\(country: \$offerCountry,/)
  viewerIn('America/New_York')
  const [home] = (await open({ search: { data: { popularTitles: { edges: [] } } } })).bodies
  expect(home!.variables).toMatchObject({ country: 'US', offerCountry: 'US' })
  expect(home!.query).not.toContain('viewerTitles')
})
