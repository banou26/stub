// An aggregated media ALWAYS carries `episodes: []` (aggregateMedia fills that field from a separate
// resolver), so `media.episodeCount ?? media.episodes?.length` read a cluster that declares no count
// as a run of ZERO episodes. Zero is a count, not an absence: read as one it places a run on whatever
// season happens to fit it (docs/design-inputs/01-edge-cases.md case 23).
//
// TMDB's own hint is falsy for both readings of an EMPTY list, so an empty one cannot tell them apart
// here, and the test below hands a NON-EMPTY list instead: the rule is that no list on an aggregated
// media is ever read as its count, and a list that would be read is the only way to show it is not.
import { expect, test } from 'vite-plus/test'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { resolvers } from '../../../../src/sources/tmdb/extractor'

const BASE = 'https://www.themoviedb.org'
const SHOW = '94664'

const SHOW_HTML = `
<meta property="og:title" content="A Show">
<meta property="og:description" content="A show.">
<meta property="og:image" content="https://media.themoviedb.org/t/p/w600/poster.jpg">`

const seasonListHtml = (seasons: number[]) => seasons.map(n => `<a href="/tv/${SHOW}/season/${n}">Season ${n}</a>`).join('\n')

const seasonHtml = (episodes: number) =>
  Array.from({ length: episodes }, (_, i) => `<div class="card" data-episode-number="${i + 1}"><h3><a href="#">Episode ${i + 1}</a></h3></div>`).join('\n')

// Three seasons, and only season 2 holds three episodes: a count of 3 names it and nothing else does.
const EPISODES: Record<number, number> = { 1: 10, 2: 3, 3: 24 }

// misses are COLLECTED rather than thrown: `fetchHtml` swallows a rejection, so a drifted fixture
// would return no media and read as the refusal under test
const context = (misses: string[], known: unknown) => ({
  key: () => undefined,
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string) => {
    const html = (body: string) => ({ ok: true, status: 200, text: async () => body })
    if (url.startsWith(`${BASE}/tv/${SHOW}?`)) return html(SHOW_HTML)
    if (url.startsWith(`${BASE}/tv/${SHOW}/seasons?`)) return html(seasonListHtml([1, 2, 3]))
    for (const [season, count] of Object.entries(EPISODES)) {
      if (url.startsWith(`${BASE}/tv/${SHOW}/season/${season}?`)) return html(seasonHtml(count))
    }
    misses.push(url)
    return { ok: false, status: 404, text: async () => '' }
  },
}) as unknown as ExtractorServerContext

const mediaFor = async (known: unknown) => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `tmdb:${SHOW}` } }, context(misses, known)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  return value?.media ?? null
}

test('a list on the aggregated media is never read as the run\'s count', async () => {
  const media = await mediaFor({
    titles: [{ title: 'A Show' }],
    episodeCount: null,
    episodes: [{}, {}, {}],
  })

  expect(media, 'a cluster declaring no count places no season, however many rows its list holds').toBeNull()
})

test('control: the same cluster declaring 3 is placed on the season holding 3', async () => {
  const media = await mediaFor({
    titles: [{ title: 'A Show' }],
    episodeCount: 3,
    episodes: [],
  })

  expect(media?.uri).toBe(`tmdb:${SHOW}-s2`)
})

// The production shape: an empty list and no declared count is a cluster with nothing to place a
// season by, and the show id names every season at once, so the answer is no media.
test('a cluster that declares no count places no season', async () => {
  expect(await mediaFor({ titles: [{ title: 'A Show' }], episodeCount: null, episodes: [] })).toBeNull()
})
