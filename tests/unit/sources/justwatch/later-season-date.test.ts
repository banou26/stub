// JustWatch dates Severance's second season 2022-02-17, year included, which is the show's and its first season's
// premiere: season 2 aired from 2025-01-16, as its own episodes say (both answers recorded 2026-11-02). Read as the
// season's own date, it sent Apple TV a day inside its season 1's window, and Apple's season 1 was claimed as
// JustWatch's season 2, so season 2's episodes showed season 1's titles and Apple TV+ links.
import { expect, test } from 'vite-plus/test'

import { resolvers as appletv } from '../../../../src/sources/appletv/extractor'
import { resolvers as justwatch } from '../../../../src/sources/justwatch/extractor'
import SEVERANCE from '../../../fixtures/justwatch/severance.json'
import APPLE_SEVERANCE from '../../../fixtures/appletv/severance.json'
import APPLE_SEVERANCE_S2_EPISODES from '../../../fixtures/appletv/severance-s2-episodes.json'

const JW_API = 'https://apis.justwatch.com/graphql'
const APPLE_SHOW = APPLE_SEVERANCE.data.content.id
const apple = (path: string) => `https://uts-api.itunes.apple.com/uts/v3${path}${path.includes('?') ? '&' : '?'}caller=web&sf=143441&v=58&pfm=web&locale=en-US&utsk=0`
const APPLE: Record<string, unknown> = {
  [apple(`/shows/${APPLE_SHOW}`)]: APPLE_SEVERANCE,
  [apple(`/shows/${APPLE_SHOW}/episodes?selectedSeasonId=umc.cmc.uhm560ns0yg3a5fy454bb967`)]: APPLE_SEVERANCE_S2_EPISODES,
}

const contextFor = (nodes: Record<string, unknown> = SEVERANCE) => ({
  request: new Request('http://d/graphql'),
  findAggregatedMedia: async () => undefined,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string, init?: { body?: string }) => {
    if (url === JW_API) {
      const { nodeId } = JSON.parse(init?.body ?? '{}').variables
      return { json: async () => ({ data: { node: nodes[nodeId] ?? null } }) }
    }
    if (url in APPLE) return { json: async () => APPLE[url] }
    throw new Error(`no recorded answer for ${url}`)
  },
})

const first = async (iterator: AsyncIterator<any>) => (await iterator.next()).value
const jwMedia = async (uri: string, nodes?: Record<string, unknown>) =>
  (await first((justwatch.Subscription as any).media.subscribe(undefined, { input: { uri } }, contextFor(nodes)))).media
const askApple = async (input: object) => (await first((appletv.Subscription as any).similarMedia.subscribe(undefined, { input }, contextFor()))).similarMedia
const askJustWatch = async (input: object) => (await first((justwatch.Subscription as any).similarMedia.subscribe(undefined, { input }, contextFor()))).similarMedia

type Season = (typeof SEVERANCE.ts320458.seasons)[number]
const [ONE, TWO] = SEVERANCE.ts320458.seasons as [Season, Season]
const severanceWith = (...seasons: Season[]) => ({ ts320458: { ...SEVERANCE.ts320458, seasons } })
const secondWith = (content: Partial<Season['content']>) => severanceWith(ONE, { ...TWO, content: { ...TWO.content, ...content } })

const SEASON_2_TITLES = SEVERANCE.ts320458.seasons[1]!.episodes.map(episode => episode.content.title)

test("a later season dated with the first season's premiere has no date of its own", async () => {
  expect((await jwMedia('jw:320458-350405')).startDate, 'season 2 aired in 2025, not in 2022').toBeUndefined()
  expect((await jwMedia('jw:320458-329115')).startDate, 'the control: season 1 keeps its day').toBe('2022-02-17')
})

// Seven of the fifteen copies measured are the day before the first season's, as The Diplomat's second season is. A
// second season can air two weeks after the first, as Strike's did.
test("a copy dated the day before is one too, and a season two weeks later keeps its date", async () => {
  expect((await jwMedia('jw:320458-350405', secondWith({ originalReleaseDate: '2022-02-16' }))).startDate).toBeUndefined()
  expect((await jwMedia('jw:320458-350405', secondWith({ originalReleaseDate: '2022-03-03' }))).startDate).toBe('2022-03-03')
})

// Tom and Jerry's "Season 1940" and Jeopardy!'s "Season 1984" are listed beside a "Season 1" and do start on its day
// (1940-02-10 and 1984-09-10, 2026-11-02)
test("a season named by its own year keeps the first season's day", async () => {
  expect((await jwMedia('jw:320458-350405', secondWith({ seasonNumber: 2022 }))).startDate).toBe('2022-02-17')
})

test("specials dated like the first season do not take its place", async () => {
  const specials = { ...ONE, id: 'tss1', objectId: 1, episodes: [], content: { ...ONE.content, seasonNumber: 0 } }
  const nodes = severanceWith(specials, ONE, TWO)
  expect((await jwMedia('jw:320458-329115', nodes)).startDate).toBe('2022-02-17')
  expect((await jwMedia('jw:320458-350405', nodes)).startDate).toBeUndefined()
})

test("Apple TV's season 1 is not picked for JustWatch's season 2", async () => {
  const second = await jwMedia('jw:320458-350405')
  const evidence = { showId: APPLE_SHOW, titles: second.titles.map((title: { title: string }) => title.title), episodeCount: second.episodeCount }

  expect(await askApple({ ...evidence, startDate: second.startDate }), "season 2 as JustWatch describes it").toBeNull()
  expect((await askApple({ ...evidence, startDate: '2025-01-16' }))?.uri, "the control: season 2 by its first episode's day")
    .toBe(`appletv:${APPLE_SHOW}-s2`)
})

test("JustWatch answers its season 2 for a 2025 run carrying that season's episode titles", async () => {
  const answer = await askJustWatch({ showId: '320458', startDate: '2025-01-17', titles: ['Severance'], episodeCount: 10, episodeTitles: SEASON_2_TITLES })
  expect(answer?.uri, "2022 was the first season's year, not this one's").toBe('jw:320458-350405')
})
