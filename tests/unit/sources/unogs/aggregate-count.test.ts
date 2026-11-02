// An aggregated media ALWAYS carries `episodes: []` (aggregateMedia fills that field from a separate
// resolver), so `media.episodeCount ?? media.episodes?.length` read a cluster that declares no count
// as a run of ZERO episodes. Zero is a count, not an absence: `foldVetoed` then refuses every
// candidate season longer than it, which is all of them, and the refusal looks exactly like "this
// source has nothing" (docs/design-inputs/01-edge-cases.md case 23).
//
// This source reads the cluster's count twice, and the first read is a GATE: `matchNetflixSeason`
// waits for a count before asking anything, because unOGS publishes no date at any level and a count
// is the axis it has. So an empty aggregate list cannot tell the two readings apart here, and the
// test below hands a NON-EMPTY one instead: the rule is that no list on an aggregated media is ever
// read as its count, and a list that would be read is the only way to show it is not.
import { expect, test } from 'vitest'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { linkNetflix } from '../../../../src/sources/unogs/extractor'

const UNOGS = 'https://unogs.com/api'
const NF_ID = '80987039'
const AG = 'ag:(anilist:108465,kitsu:42323)'

// Netflix's Mushoku Tensei: seasons of 24, 25 and 11. A run of 24 with no ordinal is season 1 by the
// first-season rule, which is the answer a count read off a list would produce here.
const MUSHOKU = [{ season: 1, episodes: 24 }, { season: 2, episodes: 25 }, { season: 3, episodes: 11 }]

const routes = () => ({
  'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
  [`${UNOGS}/title/detail?netflixid=${NF_ID}`]: [{
    netflixid: Number(NF_ID),
    title: 'A Show',
    vtype: 'series',
    synopsis: 'A show.',
    year: '2021',
    img: '', runtime: '', avgrating: '', top250: 0, top250tv: 0, poster: '', clist: '', imdbid: '',
  }],
  [`${UNOGS}/title/bgimages?netflixid=${NF_ID}`]: {},
  [`${UNOGS}/title/episodes?netflixid=${NF_ID}`]: MUSHOKU.map(season => ({
    season: season.season,
    episodes: Array.from({ length: season.episodes }, (_, index) => ({
      epid: `${NF_ID}-s${season.season}e${index + 1}`,
      episode: index + 1,
      title: `S${season.season}E${index + 1}`,
      synopsis: '', runtime: '', img: '',
    })),
  })),
})

// throws on an unlisted url, so fixture drift fails loudly instead of reading as "the source had
// nothing to say", which is the same shape as the refusal under test
const knowing = (known: unknown): ExtractorServerContext => ({
  fetch: (async (url: string) => {
    const table = routes() as Record<string, unknown>
    const key = typeof url === 'string' ? url : String(url)
    if (!(key in table)) throw new Error(`unstubbed url: ${key}`)
    return { json: async () => table[key], ok: true, status: 200 }
  }) as unknown as ExtractorServerContext['fetch'],
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
} as unknown as ExtractorServerContext)

const link = (known: unknown) => linkNetflix(NF_ID, AG, knowing(known), 'series')

test('a list on the aggregated media is never read as the run\'s count', async () => {
  const media = await link({
    titles: [{ language: 'en', title: 'Some Show' }],
    episodeCount: null,
    episodes: Array.from({ length: 24 }, () => ({})),
  })

  expect(media, 'a length is not a declared count, and this cluster declares none').toBeUndefined()
})

test('control: the same cluster declaring 24 is matched to the Netflix season holding 24', async () => {
  const media = await link({
    titles: [{ language: 'en', title: 'Some Show' }],
    episodeCount: 24,
    episodes: [],
    startDate: '2021-01-11',
  })

  expect(media?.uri).toBe(`nf:${NF_ID}-1`)
})

// The production shape, pinned so the gate keeps saying so: with no count there is no axis here, and
// the answer is nothing rather than a season picked by a zero.
test('a cluster that declares no count is matched to no Netflix season at all', async () => {
  const media = await link({
    titles: [{ language: 'en', title: 'Some Show' }],
    episodeCount: null,
    episodes: [],
  })

  expect(media).toBeUndefined()
})
