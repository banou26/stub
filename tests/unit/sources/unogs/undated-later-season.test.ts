// JustWatch titles Wednesday's second season "Wednesday", as it titles every season, and leaves it undated because its
// date was a copy of the first season's. Its 8 episodes are as many as season 1's, so Netflix, asked before the
// episode titles had landed, answered its season 1, and season 2's rows opened season 1's episodes: E1 "Here We Woe
// Again" carried 81257204, "Wednesday's Child Is Full of Woe" (all answers recorded 2026-11-02). Bridgerton's third
// season the same.
import { expect, test } from 'vite-plus/test'

import { resolvers as justwatch } from '../../../../src/sources/justwatch/extractor'
import { resolvers as unogs } from '../../../../src/sources/unogs/extractor'
import JW_BRIDGERTON from '../../../fixtures/justwatch/bridgerton.json'
import JW_WEDNESDAY from '../../../fixtures/justwatch/wednesday.json'
import NF_BRIDGERTON from '../../../fixtures/unogs/bridgerton.json'
import NF_WEDNESDAY from '../../../fixtures/unogs/wednesday.json'

const JW_API = 'https://apis.justwatch.com/graphql'
const NODES: Record<string, unknown> = { ...JW_WEDNESDAY, ...JW_BRIDGERTON }
const UNOGS: Record<string, unknown> = {
  'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
  'https://unogs.com/api/title/bgimages?netflixid=81231974': {},
  'https://unogs.com/api/title/bgimages?netflixid=80232398': {},
  ...NF_WEDNESDAY,
  ...NF_BRIDGERTON,
}

const context = {
  request: new Request('http://d/graphql'),
  findAggregatedMedia: async () => undefined,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string, init?: { body?: string }) => {
    if (url === JW_API) return { json: async () => ({ data: { node: NODES[JSON.parse(init?.body ?? '{}').variables.nodeId] ?? null } }) }
    if (url in UNOGS) return { ok: true, status: 200, json: async () => UNOGS[url] }
    throw new Error(`no recorded answer for ${url}`)
  },
}

const first = async (iterator: AsyncIterator<any>) => (await iterator.next()).value
const jwMedia = async (uri: string) => (await first((justwatch.Subscription as any).media.subscribe(undefined, { input: { uri } }, context))).media
const askNetflix = async (input: object) => (await first((unogs.Subscription as any).similarMedia.subscribe(undefined, { input }, context))).similarMedia

/** The run as the page's consumer describes it to Netflix, with or without its episode titles. */
const evidenceOf = async (uri: string, showId: string) => {
  const media = await jwMedia(uri)
  const evidence = {
    showId,
    titles: media.titles.map((title: { title: string }) => title.title),
    episodeCount: media.episodeCount,
    startDate: media.startDate,
  }
  const episodeTitles: string[] = [...new Set<string>(media.episodes.flatMap((episode: { titles: { title: string }[] }) => episode.titles.map(title => title.title)))]
  return { evidence, episodeTitles }
}

test("Netflix's season 1 is not picked for JustWatch's second season of Wednesday", async () => {
  const { evidence, episodeTitles } = await evidenceOf('jw:274631-388675', '81231974')
  expect(evidence, 'no date, and as many episodes as season 1').toMatchObject({ titles: ['Wednesday'], episodeCount: 8, startDate: undefined })

  expect(await askNetflix(evidence), 'before its episode titles land').toBeNull()
  const answer = await askNetflix({ ...evidence, episodeTitles })
  expect(answer?.uri, 'its episode titles are season 2\'s').toBe('nf:81231974-2')
  expect(answer?.episodes[0]?.url, 'E1 opens "Here We Woe Again"').toBe('https://www.netflix.com/watch/81662171')
})

test("the control: Wednesday's first season, dated, is Netflix's season 1 before any episode title", async () => {
  const { evidence } = await evidenceOf('jw:274631-293677', '81231974')
  const answer = await askNetflix(evidence)
  expect(answer?.uri).toBe('nf:81231974-1')
  expect(answer?.episodes[0]?.url).toBe('https://www.netflix.com/watch/81257204')
})

test("Bridgerton's third season is Netflix's third, not its first", async () => {
  const { evidence, episodeTitles } = await evidenceOf('jw:216679-350403', '80232398')
  expect(evidence).toMatchObject({ episodeCount: 8, startDate: undefined })

  expect(await askNetflix(evidence)).toBeNull()
  expect((await askNetflix({ ...evidence, episodeTitles }))?.uri).toBe('nf:80232398-3')
})
