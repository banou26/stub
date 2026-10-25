// unOGS stays the primary Netflix path. This file pins the fallback that runs when it cannot answer:
// Netflix's own endpoint, the one www.netflix.com's public title pages call.
//
// Two things about that endpoint make a test the only way to keep it honest. It caps a season at TEN
// episodes and takes no pagination variable, so a 24 episode season arrives as a PREFIX, and a prefix
// published as a count is evidence the season picker acts on. And its persisted query id is Netflix's,
// hardcoded here, so the day Netflix edits the query every call is answered PersistedQueryNotFound,
// which must arrive as a named failure rather than as a title with no seasons.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { fetchNetflixTitle, NETFLIX_GRAPHQL_URL, NETFLIX_PAGE_SIZE, NETFLIX_PERSISTED_QUERY } from '../../../../src/sources/unogs/netflix'
import { getMedia, parseUnogsSeasons, resetUnogsCaches, resolvers } from '../../../../src/sources/unogs/extractor'

const UNOGS = 'https://unogs.com/api'

/**
 * Netflix's own answer for videoId 80987039, recorded live 2026-09-12 (HTTP 200, 41 KB).
 *
 * TRIMMED, and only by deletion: `plans`, `trifectaRows` and the title's artwork, cast, genre and
 * tag fields are gone, seasons 2 and 3 keep their first two episodes, and every episode synopsis but
 * the first is blanked. Every id, number, title, label and `pageInfo` below is exactly what Netflix
 * answered, including season 1's ten episodes and the `hasNextPage: true` that says it has more.
 */
const RECORDED_NETFLIX = {
  data: {
    videos: [
      {
        __typename: 'Show',
        videoId: 80987039,
        title: 'Mushoku Tensei: Jobless Reincarnation',
        latestYear: 2026,
        shortSynopsis: 'Reincarnated into a magical world full of adventure, a formerly aimless and unemployed man decides to live his new life to the fullest.',
        seasons: {
          __typename: 'SeasonsConnection',
          totalCount: 3,
          pageInfo: {
            __typename: 'PageInfo',
            hasNextPage: false
          },
          edges: [
            {
              __typename: 'SeasonEdge',
              node: {
                __typename: 'Season',
                videoId: 81392609,
                title: 'Season 1',
                shortTitle: 'Season 1',
                numberLabelV2: 'Season 1',
                showMemberType: 'SEASON',
                totalDisplayRuntimeInSec: 34111,
                episodes: {
                  __typename: 'EpisodesConnection',
                  pageInfo: {
                    __typename: 'PageInfo',
                    hasNextPage: true
                  },
                  edges: [
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402901,
                        number: 1,
                        runtimeSec: 1422,
                        title: 'Episode 1',
                        shortSynopsis: 'A man hit by a truck fades into unconsciousness. When he awakes, he discovers that he has been reborn as a child in a world of sword and sorcery.',
                        merchStill300: {
                          __typename: 'Image',
                          available: true,
                          url: 'https://occ-0-988-993.1.nflxso.net/dnm/api/v6/9pS1daC2n6UGc3dUogvWIPMR_OU/AAAABbSFroTbXJ-5ZfsWZI6K6aURM4P5j3MMv8nBilOmJfSMdHeGqC32NBaBqzEhNJclFfTD5EZNsGXtcp_wCOxJSdYM6ui3HV_KzJRk_zvoWpzFHh0yL0QZbXq-.jpg?r=25a',
                          width: 300,
                          height: 169
                        }
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402902,
                        number: 2,
                        runtimeSec: 1422,
                        title: 'Episode 2',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402903,
                        number: 3,
                        runtimeSec: 1422,
                        title: 'Episode 3',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402904,
                        number: 4,
                        runtimeSec: 1422,
                        title: 'Episode 4',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402905,
                        number: 5,
                        runtimeSec: 1422,
                        title: 'Episode 5',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402906,
                        number: 6,
                        runtimeSec: 1421,
                        title: 'Episode 6',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402907,
                        number: 7,
                        runtimeSec: 1422,
                        title: 'Episode 7',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402908,
                        number: 8,
                        runtimeSec: 1422,
                        title: 'Episode 8',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402909,
                        number: 9,
                        runtimeSec: 1422,
                        title: 'Episode 9',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81402910,
                        number: 10,
                        runtimeSec: 1422,
                        title: 'Episode 10',
                        shortSynopsis: ''
                      }
                    }
                  ]
                }
              }
            },
            {
              __typename: 'SeasonEdge',
              node: {
                __typename: 'Season',
                videoId: 81705182,
                title: 'Season 2',
                shortTitle: 'Season 2',
                numberLabelV2: 'Season 2',
                showMemberType: 'SEASON',
                totalDisplayRuntimeInSec: 35818,
                episodes: {
                  __typename: 'EpisodesConnection',
                  pageInfo: {
                    __typename: 'PageInfo',
                    hasNextPage: true
                  },
                  edges: [
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81705186,
                        number: 1,
                        runtimeSec: 1432,
                        title: 'Fitz the Guardian',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 81705187,
                        number: 2,
                        runtimeSec: 1430,
                        title: 'The Depressed Magician',
                        shortSynopsis: ''
                      }
                    }
                  ]
                }
              }
            },
            {
              __typename: 'SeasonEdge',
              node: {
                __typename: 'Season',
                videoId: 82941638,
                title: 'Season 3',
                shortTitle: 'Season 3',
                numberLabelV2: 'Season 3',
                showMemberType: 'SEASON',
                totalDisplayRuntimeInSec: 17061,
                episodes: {
                  __typename: 'EpisodesConnection',
                  pageInfo: {
                    __typename: 'PageInfo',
                    hasNextPage: true
                  },
                  edges: [
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 82941639,
                        number: 1,
                        runtimeSec: 1422,
                        title: 'Rage, Mad Dog',
                        shortSynopsis: ''
                      }
                    },
                    {
                      __typename: 'EpisodeEdge',
                      node: {
                        __typename: 'Episode',
                        videoId: 82941640,
                        number: 2,
                        runtimeSec: 1422,
                        title: 'Howl, Mad Dog',
                        shortSynopsis: ''
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    ]
  }
}

/** unOGS' own answer for the same show, recorded live 2026-09-12, trimmed to season 1's first two episodes. */
const RECORDED_UNOGS = [
  {
    season: 1,
    episodes: [
      {
        epid: 81402901,
        seasid: 81392609,
        epnum: 1,
        seasnum: 1,
        title: 'Episode 1',
        synopsis: 'A man hit by a truck fades into unconsciousness. When he awakes, he discovers that he has been reborn as a child in a world of sword and sorcery.',
        img: 'https://occ-0-993-988.1.nflxso.net/dnm/api/v6/one.jpg'
      },
      {
        epid: 81402902,
        seasid: 81392609,
        epnum: 2,
        seasnum: 1,
        title: 'Episode 2',
        synopsis: '',
        img: ''
      }
    ]
  }
]

type StubEpisode = { videoId: number, number?: number, title: string }
type StubSeason = {
  videoId: number
  title: string
  numberLabelV2?: string
  /** `false` says the season is complete, `true` says there is more, and OMITTING it omits `pageInfo` */
  hasNextPage?: boolean
  episodes: StubEpisode[]
}

/**
 * A payload in the recording's shape, BUILT rather than recorded, for the shapes the wire has not
 * shown us: a season block carrying no number in any label, a forty season title answered ten at a
 * time, an episodes connection with no `pageInfo` at all. Every field name is the recording's.
 */
const netflixPayload = (seasons: StubSeason[], seasonsHaveNextPage = false) => ({
  data: {
    videos: [
      {
        __typename: 'Show',
        videoId: 12345678,
        title: 'A Show',
        latestYear: 2021,
        seasons: {
          __typename: 'SeasonsConnection',
          totalCount: seasons.length,
          pageInfo: { __typename: 'PageInfo', hasNextPage: seasonsHaveNextPage },
          edges: seasons.map(season => ({
            __typename: 'SeasonEdge',
            node: {
              __typename: 'Season',
              videoId: season.videoId,
              title: season.title,
              numberLabelV2: season.numberLabelV2,
              episodes: {
                __typename: 'EpisodesConnection',
                ...(season.hasNextPage === undefined ? {} : { pageInfo: { __typename: 'PageInfo', hasNextPage: season.hasNextPage } }),
                edges: season.episodes.map(episode => ({
                  __typename: 'EpisodeEdge',
                  node: { __typename: 'Episode', videoId: episode.videoId, number: episode.number, title: episode.title }
                }))
              }
            }
          }))
        }
      }
    ]
  }
})

/** `count` episodes titled distinctly, so the season picker's title axis has something real to read. */
const stubEpisodes = (firstId: number, count: number): StubEpisode[] =>
  Array.from({ length: count }, (_, index) => ({
    videoId: firstId + index,
    number: index + 1,
    title: `The ${['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'][index]} Trial`
  }))

/** What a stubbed url answers. Every route is one of these, so a test says which failure it is staging. */
type Answer =
  | { kind: 'json', body: unknown }
  | { kind: 'status', status: number }
  | { kind: 'unreachable' }

const json = (body: unknown): Answer => ({ kind: 'json', body })
const status = (code: number): Answer => ({ kind: 'status', status: code })
const unreachable = (): Answer => ({ kind: 'unreachable' })

type Call = { url: string, init: RequestInit | undefined }

// An unlisted url THROWS rather than answering nothing, so a test that expects the fallback not to run
// fails loudly if it does, instead of quietly reading a stubbed empty payload as a refusal.
const rig = (routes: Record<string, Answer>) => {
  const calls: Call[] = []
  const ctx = {
    fetch: (async (url: string, init?: RequestInit) => {
      const key = String(url)
      calls.push({ url: key, init })
      const answer = routes[key]
      if (!answer) throw new Error(`unstubbed url: ${key}`)
      if (answer.kind === 'unreachable') throw new Error(`network is down: ${key}`)
      if (answer.kind === 'status') return new Response('{}', { status: answer.status })
      return new Response(JSON.stringify(answer.body), { status: 200 })
    }) as unknown as ExtractorServerContext['fetch']
  } as unknown as ExtractorServerContext
  return { ctx, calls }
}

/** The unOGS side of a series title, with the episodes route left to the caller to stage. */
const unogsRoutes = (id: string, episodes: Answer): Record<string, Answer> => ({
  [`${UNOGS}/user`]: json({ token: { access_token: 'test-token' } }),
  [`${UNOGS}/title/detail?netflixid=${id}`]: json([{
    netflixid: Number(id), title: 'Mushoku Tensei', vtype: 'series', synopsis: 'A show.', year: '2021', img: '', lgimg: ''
  }]),
  [`${UNOGS}/title/bgimages?netflixid=${id}`]: json({}),
  [`${UNOGS}/title/episodes?netflixid=${id}`]: episodes
})

// Netflix's two operations share ONE url, so a count of calls to that url says nothing about which of
// them ran. The landing query is the season INDEX and the fallback this file is about; the season
// query is the episode source, asked for whichever season is being published.
const netflixOperation = (call: Call) =>
  JSON.parse(String((call.init as { body?: string } | undefined)?.body ?? '{}')).operationName as string | undefined

const netflixCalls = (calls: Call[]) =>
  calls.filter(call => call.url === NETFLIX_GRAPHQL_URL && netflixOperation(call) === 'LodpTitleAndPlansPageQuery')

const netflixSeasonCalls = (calls: Call[]) =>
  calls.filter(call => call.url === NETFLIX_GRAPHQL_URL && netflixOperation(call) === 'PreviewModalEpisodeSelectorSeasonEpisodes')
const unogsEpisodeCalls = (calls: Call[]) => calls.filter(call => call.url.startsWith(`${UNOGS}/title/episodes`))

/** `resolvers.Media.episodes`, the path an already-known `nf:` media takes to fill its episode list. */
const askMediaEpisodes = async (parent: Partial<GQLMedia>, ctx: ExtractorServerContext) => {
  const { episodes } = resolvers.Media as unknown as { episodes: Function }
  return await episodes({ origin: 'nf', categories: ['SERIES'], ...parent }, {}, ctx) as GQLMedia['episodes']
}

/** One `similarMedia` ask, which is the path the season picker is reached by. */
const askSimilar = async (input: Record<string, unknown>, ctx: ExtractorServerContext) => {
  const { subscribe } = (resolvers.Subscription as { similarMedia: { subscribe: Function } }).similarMedia
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return (value?.similarMedia ?? null) as GQLMedia | null
}

/** The other half of the fold (4.4): which season HOLDS the run, asked the same way. */
const askContaining = async (input: Record<string, unknown>, ctx: ExtractorServerContext) => {
  const { subscribe } = (resolvers.Subscription as { containingMedia: { subscribe: Function } }).containingMedia
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return (value?.containingMedia ?? null) as GQLMedia | null
}

beforeEach(() => {
  resetUnogsCaches()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// `seasid` and `epnum` arrive on every unOGS episode and were declared nowhere, so they were read off
// the wire and dropped. `seasid` is the real Netflix SEASON id, which is what the ordinal season uri
// this source mints is standing in for; `epnum` is Netflix's own ordering.
test('seasid and epnum survive into the parsed episode', async () => {
  const seasons = parseUnogsSeasons(RECORDED_UNOGS)

  expect(seasons?.[0]?.seasonId, 'the Netflix season id, identical to their own endpoint\'s').toBe(81392609)
  expect(seasons?.[0]?.episodes[0]?.seasid).toBe(81392609)
  expect(seasons?.[0]?.episodes[0]?.epnum).toBe(1)
  expect(seasons?.[0]?.episodes[1]?.epnum).toBe(2)
})

// The malformed-body detector, which is what tells a failed upstream from a title with no episodes.
test('a body that is not the episodes payload is no answer at all', async () => {
  expect(parseUnogsSeasons({ detail: 'not found' })).toBeUndefined()
  expect(parseUnogsSeasons([{ season: 'one', episodes: [] }])).toBeUndefined()
  // the control: a well formed answer holding nothing IS an answer, and must not read as a failure
  expect(parseUnogsSeasons([])).toEqual([])
})

test('the Netflix client parses the recorded payload into seasons and episodes', async () => {
  const { ctx } = rig({ [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX) })
  const result = await fetchNetflixTitle('80987039', ctx)

  expect(result.ok).toBe(true)
  const title = result.ok ? result.title : undefined
  expect(title?.title).toBe('Mushoku Tensei: Jobless Reincarnation')
  expect(title?.seasons.map(season => season.videoId)).toEqual([81392609, 81705182, 82941638])
  expect(title?.seasons.map(season => season.number)).toEqual([1, 2, 3])
  expect(title?.seasons[0]?.episodes[0]).toMatchObject({ videoId: 81402901, number: 1, title: 'Episode 1' })
  expect(title?.seasons[0]?.episodes[0]?.synopsis?.startsWith('A man hit by a truck')).toBe(true)
})

// TEN per season with `hasNextPage: true`, and no pagination variable to ask for the rest with. A
// caller that reads ten as the season's length asserts 10 of 24.
test('a truncated season says it is truncated, and a complete one says it is not', async () => {
  const complete = structuredClone(RECORDED_NETFLIX) as typeof RECORDED_NETFLIX
  complete.data.videos[0]!.seasons.edges[1]!.node.episodes.pageInfo.hasNextPage = false
  const { ctx } = rig({ [NETFLIX_GRAPHQL_URL]: json(complete) })

  const result = await fetchNetflixTitle('80987039', ctx)
  const title = result.ok ? result.title : undefined
  expect(title?.seasons.map(season => season.truncated), 'season 2 is the control').toEqual([true, false, true])
  expect(title?.seasons[0]?.episodes.length, 'the ten it answered are still offered').toBe(10)
})

// The day Netflix edits the query, the hardcoded id stops being recognised and EVERY call is answered
// this way. It has to name itself: read as an empty title it would say the show has no seasons.
test('PersistedQueryNotFound is its own failure, never an empty title', async () => {
  const { ctx } = rig({
    [NETFLIX_GRAPHQL_URL]: json({ errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] })
  })
  const result = await fetchNetflixTitle('80987039', ctx)

  expect(result.ok, 'a failure answered as ok:true is a show with no seasons').toBe(false)
  expect(result.ok === false && result.failure).toBe('persisted-query-stale')
  expect(result.ok === false && result.message).toContain('NETFLIX_PERSISTED_QUERY')
})

// The control for the test above: an ordinary GraphQL error is NOT the stale id, and must not send
// anyone to Netflix's page bundle to re-read a query that is fine.
test('an ordinary GraphQL error is not read as a stale persisted query', async () => {
  const { ctx } = rig({ [NETFLIX_GRAPHQL_URL]: json({ errors: [{ message: 'something else' }] }) })
  const result = await fetchNetflixTitle('80987039', ctx)

  expect(result.ok === false && result.failure).toBe('graphql-errors')
})

// The viewer may well be signed in to Netflix in this very browser. The call works anonymously, so
// their session must never ride along on a lookup they did not make.
test('the Netflix call carries no credentials and no authorization', async () => {
  const { ctx, calls } = rig({ [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX) })
  await fetchNetflixTitle('80987039', ctx)

  const init = netflixCalls(calls)[0]?.init as RequestInit & { headers: Record<string, string> }
  expect(init.credentials, "'include' or a default would attach the viewer's Netflix session").toBe('omit')
  expect(Object.keys(init.headers).map(header => header.toLowerCase())).not.toContain('cookie')
  expect(Object.keys(init.headers).map(header => header.toLowerCase())).not.toContain('authorization')
})

test('the fallback does NOT run when unOGS answers', async () => {
  // the netflix url is deliberately absent from the table, so asking it throws
  const { ctx, calls } = rig(unogsRoutes('80987039', json(RECORDED_UNOGS)))
  const media = await getMedia('80987039', ctx, 1, true)

  expect(media?.episodes?.length).toBe(2)
  expect(media?.episodes?.[0]?.id, 'unOGS answered, so these are unOGS episodes').toBe('81402901')
  expect(netflixCalls(calls).length, 'unOGS is the primary INDEX and a working primary is the whole season list').toBe(0)
  // the season endpoint is asked for the published season either way, and it is the one url the rig
  // refuses, so this is also the control that a failed episode call leaves unOGS' episodes standing
  expect(netflixSeasonCalls(calls).length, 'the episodes still come from Netflix, one request').toBe(1)
})

test('the fallback DOES run when unOGS fails', async () => {
  const { ctx, calls } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })
  const media = await getMedia('80987039', ctx, 1, true)

  expect(netflixCalls(calls).length, 'one landing query for the season index').toBe(1)
  expect(media?.episodes?.map(episode => episode.id).slice(0, 3)).toEqual(['81402901', '81402902', '81402903'])
})

// Frieren's tracks as the landing query answered them to Tokyo, 2026-10-25: Netflix names a language
// rather than coding it, and lists them for the title, not per episode
const FRIEREN_TRACKS = {
  __typename: 'MediaTracks',
  audioTracks: ['English', 'Japanese [Original]', 'Mandarin (Guoyu)'].map(language => ({ __typename: 'AudioTrack', language })),
  subtitles: ['English', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Klingon'].map(language => ({ __typename: 'TimedTextTrack', language })),
}

test('the landing query, when it is asked, gives every episode the title\'s audio and subtitle languages', async () => {
  const [video] = RECORDED_NETFLIX.data.videos
  const { ctx } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json({ data: { videos: [{ ...video, mediaTracks: FRIEREN_TRACKS }] } })
  })
  const media = await getMedia('80987039', ctx, 1, true)

  expect(media?.episodes?.length, 'the control: the fallback answered').toBeGreaterThan(1)
  for (const episode of media?.episodes ?? []) {
    expect(episode.audioLanguages).toEqual(['en', 'ja', 'zh'])
    expect(episode.subtitleLanguages, 'a name no code reads is dropped').toEqual(['en', 'ja', 'ko', 'zh'])
  }
})

// A season answered as a prefix has a length and no COUNT. Ten published as `episodeCount` is a claim
// the season picker acts on (`foldVetoed` compares counts) and the page prints as the season's length.
test('a truncated season is listed without claiming to be the whole season', async () => {
  const { ctx } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })
  const media = await getMedia('80987039', ctx, 1, true)

  expect(media?.episodes?.length, 'the ten Netflix answered are still offered').toBe(10)
  expect(media?.episodeCount, 'ten is not the length of a 24 episode season').toBeUndefined()
})

// A page opening several Netflix rows asks this source many times in a second. Every one of them
// paying a token call plus a failing episodes call is the worst thing to do to an upstream in trouble.
test('a failed unOGS is left alone for a short window instead of being retried in a burst', async () => {
  const routes = {
    ...unogsRoutes('80987039', unreachable()),
    ...unogsRoutes('70000001', unreachable()),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  }
  const { ctx, calls } = rig(routes)

  await getMedia('80987039', ctx, 1, true)
  await getMedia('70000001', ctx, 1, true)

  expect(unogsEpisodeCalls(calls).length, 'the second ask goes straight to the fallback').toBe(1)
})

// The control for the cooldown: an empty list is unOGS ANSWERING, about the title, and must not put
// the whole source into a cooldown that every later title then pays.
test('an empty but well formed unOGS answer never counts as unOGS being down', async () => {
  const routes = {
    ...unogsRoutes('80987039', json([])),
    ...unogsRoutes('70000001', json(RECORDED_UNOGS)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  }
  const { ctx, calls } = rig(routes)

  await getMedia('80987039', ctx, 1, true)
  await getMedia('70000001', ctx, 1, true)

  expect(unogsEpisodeCalls(calls).length, 'the second title still asks unOGS first').toBe(2)
  expect(netflixCalls(calls).length, 'and an empty answer is still worth a second opinion').toBe(1)
  expect(netflixSeasonCalls(calls).length, 'one season published per title, one episode call each').toBe(2)
})

// Loud where a human can act on it: the id is hardcoded and only a person re-reading Netflix's bundle
// can fix it, so the one failure that needs a human names itself in the log.
test('a stale persisted query is reported loudly rather than swallowed', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { ctx } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json({ errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] })
  })

  const media = await getMedia('80987039', ctx, 1, true)

  expect(media?.episodes?.length, 'neither upstream answered, so there are no episodes').toBe(0)
  expect(errors.mock.calls.some(call => String(call[0]).includes('persisted-query-stale'))).toBe(true)
})

// The season picker reads an episode count as evidence and acts on it: ten episodes of a 24 episode
// season clear the fold veto against any run of ten or more, and the season it then hands that run is
// one the run does not hold. `graph.link` has no inverse, so the refusal has to happen here.
test('a truncated season is offered to the season picker with no count at all', async () => {
  const ask = async (payload: unknown) => {
    resetUnogsCaches()
    const { ctx } = rig({ ...unogsRoutes('80987039', status(503)), [NETFLIX_GRAPHQL_URL]: json(payload) })
    return await askSimilar({ showId: '80987039', episodeCount: 9, titles: ['Mushoku Tensei'] }, ctx)
  }

  // NINE episodes, not the recording's ten, and the two arms differ in nothing but `hasNextPage`. Ten
  // is the measured page size, so a ten episode season is a prefix whatever its flag says
  // (`isPrefix`), which would make the control refuse for the wrong reason and prove nothing.
  const nineEpisodes = (hasNextPage: boolean) => {
    const payload = structuredClone(RECORDED_NETFLIX) as typeof RECORDED_NETFLIX
    const [first, ...rest] = payload.data.videos[0]!.seasons.edges
    first!.node.episodes.edges = first!.node.episodes.edges.slice(0, 9)
    first!.node.episodes.pageInfo.hasNextPage = hasNextPage
    // seasons 2 and 3 are two episode trims and stay identical in both arms, so the only thing under
    // test is what season 1 says about itself
    for (const edge of rest) edge.node.episodes.pageInfo.hasNextPage = false
    return payload
  }

  // the control, and it must pass: the same nine episodes, declared COMPLETE, are a season of nine and
  // the picker takes them. A rig that refuses either way would prove nothing about the truncation.
  expect((await ask(nineEpisodes(false)))?.uri, 'nine complete episodes for a run of nine').toBe('nf:80987039-1')

  expect(await ask(nineEpisodes(true)), 'nine answered of an unknown number is not a run of nine').toBeNull()
})

// THE TITLE AXIS DECIDES BEFORE ANY COUNT RULE, so withholding a prefix's count and keeping its titles
// left the weld route open. `EPISODE_TITLE_COVERAGE` is measured against the CANDIDATE's listed titles,
// so a ten of 24 prefix turns the fold the rule exists to refuse, 12/24 = 0.50, into 10/10 = 1.00 and
// hands a single cour a season holding two cours. `graph.link` has no inverse.
test('a truncated season offers no episode TITLES either, which is the axis that decides first', async () => {
  const ask = async (hasNextPage: boolean) => {
    resetUnogsCaches()
    const { ctx } = rig({
      ...unogsRoutes('12345678', status(503)),
      [NETFLIX_GRAPHQL_URL]: json(netflixPayload([
        { videoId: 900001, title: 'Season 1', numberLabelV2: 'Season 1', hasNextPage, episodes: stubEpisodes(500001, 8) }
      ]))
    })
    return await askSimilar({
      showId: '12345678',
      titles: ['A Show'],
      episodeCount: 12,
      // our run is the first cour: its twelve titles CONTAIN every title the prefix can see
      episodeTitles: stubEpisodes(500001, 12).map(episode => episode.title)
    }, ctx)
  }

  // the control, and it must pass: the same eight titles declared COMPLETE are a season of eight, our
  // twelve carry all eight, and the picker takes it on the title axis. The arms differ in nothing else.
  expect((await ask(false))?.uri, 'eight titles of a complete season of eight').toBe('nf:12345678-1')

  expect(await ask(true), 'a prefix of a season titles is not that season titles').toBeNull()
})

// The SEASON list is paged at ten as well: One Piece answers `totalCount: 40` with ten edges and
// `hasNextPage: true` (measured 2026-09-12), where unOGS answers all forty. Asked for season 15 off
// that prefix, the fallback is answering about a season nobody looked at.
test('a season a prefix listing never showed is refused, never published as zero episodes', async () => {
  const seasonsFor = (count: number): StubSeason[] =>
    Array.from({ length: count }, (_, index) => ({
      videoId: 900100 + index,
      title: `Season ${index + 1}`,
      numberLabelV2: `Season ${index + 1}`,
      hasNextPage: false,
      episodes: stubEpisodes(510000 + index * 100, 3)
    }))
  const ask = async (count: number, seasonsHaveNextPage: boolean) => {
    resetUnogsCaches()
    const { ctx } = rig({
      ...unogsRoutes('12345678', status(503)),
      [NETFLIX_GRAPHQL_URL]: json(netflixPayload(seasonsFor(count), seasonsHaveNextPage))
    })
    return await getMedia('12345678', ctx, 15, true)
  }

  expect(await ask(3, true), 'the listing said there is more of it').toBeUndefined()
  expect(await ask(NETFLIX_PAGE_SIZE, false), 'and a listing at the page size is a prefix whatever it says').toBeUndefined()

  // The control, which isolates the truncation: a COMPLETE listing holding no season 15 is a different
  // claim, since that upstream listed every season it has, so the media is still minted. What it may
  // never do either way is publish a count, because zero is a number nobody answered.
  const complete = await ask(3, false)
  expect(complete?.uri, 'a complete listing still answers').toBe('nf:12345678-15')
  expect(complete?.episodes?.length).toBe(0)
  expect(complete?.episodeCount, 'zero is not a count this source may invent').toBeUndefined()
})

// FINDING 1 OF THE 2026-09-13 REVIEW, the half that is about the LISTING rather than the picker. The
// containment year axis reads "the one season dated our year, turned down ONLY for being longer, is
// the one the run is in", and a season list that is a PREFIX may not carry the run's own season at
// all: the run is then handed the earliest season sharing its year, which is a season it is not in,
// and the placement lays that season's episodes over it. The same refusal `assembleMedia` makes for a
// season a prefix never showed, and reachable the same way, since the landing query pages the SEASON
// list at ten whenever unOGS is the one that could not answer.
//
// Mutation: drop `if (listing.truncated) return undefined` from `containingSeason` and the second
// assertion answers `nf:12345678-1` off a listing that said there was more of it.
test('a container is never named off a season list that is a prefix', async () => {
  // NINE episodes, because this listing is the fallback's: `isPrefix` reads any season at or over
  // NETFLIX_PAGE_SIZE as a prefix whatever its flag says, so a longer season would carry no count and
  // both arms would refuse for that reason instead of for the one under test.
  const ask = async (seasonsHaveNextPage: boolean) => {
    resetUnogsCaches()
    const { ctx } = rig({
      ...unogsRoutes('12345678', status(503)),
      [NETFLIX_GRAPHQL_URL]: json(netflixPayload(
        [{ videoId: 900001, title: 'Season 1', numberLabelV2: 'Season 1', hasNextPage: false, episodes: stubEpisodes(500001, 9) }],
        seasonsHaveNextPage
      ))
    })
    return await askContaining({ showId: '12345678', titles: ['A Show'], episodeCount: 4, startDate: '2021-10-04' }, ctx)
  }

  // the control, and it must pass: the same one season list declared COMPLETE holds the run, on the
  // year unOGS publishes for the title. The arms differ in nothing else.
  expect((await ask(false))?.uri, 'nine over a run of four, with no other season it could be').toBe('nf:12345678-1')

  expect(await ask(true), 'the season this run is in may be one the listing never showed').toBeNull()
})

// Before the fallback existed this could not happen: a failed episodes call rejected the resolver and
// no media was assembled at all. Now it returns an empty list, and `filtered.length` published as a
// count says a season we could not read holds nothing. `hasEvidence` reads `episodeCount != null`, the
// cluster count vote filters on the same test, and the row prints "0 Episodes".
test('neither upstream answering publishes no episode count, and never zero', async () => {
  const { ctx } = rig({ ...unogsRoutes('80987039', status(503)), [NETFLIX_GRAPHQL_URL]: unreachable() })
  const outage = await getMedia('80987039', ctx, 1, true)

  expect(outage?.episodes?.length, 'nobody answered').toBe(0)
  expect(outage?.episodeCount, 'so there is no count, rather than a count of zero').toBeUndefined()

  // the control: the same ask with unOGS healthy publishes the count it actually read
  resetUnogsCaches()
  const answered = await getMedia('80987039', rig(unogsRoutes('80987039', json(RECORDED_UNOGS))).ctx, 1, true)
  expect(answered?.episodeCount, 'two episodes read is a count of two').toBe(2)
})

// unOGS answers HTTP 200 with body `{}` for any id it cannot parse, INCLUDING the season-suffixed ids
// this app mints itself (measured 2026-09-12). `Media.episodes` passed `parent.id` through, so every
// season-scoped media asked a question unOGS cannot answer, got a body this source reads as a failure,
// and served no episodes for a season that has them.
test('Media.episodes asks about the SHOW id, never the season suffix this source minted', async () => {
  const { ctx, calls } = rig({
    ...unogsRoutes('80987039', json(RECORDED_UNOGS)),
    // what unOGS really answers for our own suffixed id, so the unsplit ask fails the way it does live
    [`${UNOGS}/title/episodes?netflixid=80987039-1`]: json({})
  })

  const episodes = await askMediaEpisodes({ id: '80987039-1', uri: 'nf:80987039-1' }, ctx)

  expect(episodes?.map(episode => episode.id), 'season 1 as unOGS answered it').toEqual(['81402901', '81402902'])
  expect(unogsEpisodeCalls(calls).map(call => call.url)).toEqual([`${UNOGS}/title/episodes?netflixid=80987039`])
})

// The path the fallback was written for, and the one nothing drove: an already-known season media
// filling its episode list while unOGS is unwell. A RUN may never list another season's episodes, so
// the answer is filtered back down to the season its own uri names.
test('Media.episodes resolves one season through the fallback, and only that season', async () => {
  const { ctx } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })

  const episodes = await askMediaEpisodes({ id: '80987039-2', uri: 'nf:80987039-2' }, ctx)

  expect(episodes?.map(episode => episode.id), 'Netflix season 2, and nothing from 1 or 3').toEqual(['81705186', '81705187'])
  expect(episodes?.map(episode => episode.mediaUri)).toEqual(['nf:80987039-2', 'nf:80987039-2'])
})

test('Media.episodes gives a season\'s episodes the title\'s languages too', async () => {
  const [video] = RECORDED_NETFLIX.data.videos
  const { ctx } = rig({
    ...unogsRoutes('80987039', status(503)),
    [NETFLIX_GRAPHQL_URL]: json({ data: { videos: [{ ...video, mediaTracks: FRIEREN_TRACKS }] } })
  })

  const episodes = await askMediaEpisodes({ id: '80987039-2', uri: 'nf:80987039-2' }, ctx)

  expect(episodes?.map(episode => [episode.id, episode.audioLanguages, episode.subtitleLanguages])).toEqual([
    ['81705186', ['en', 'ja', 'zh'], ['en', 'ja', 'ko', 'zh']],
    ['81705187', ['en', 'ja', 'zh'], ['en', 'ja', 'ko', 'zh']],
  ])
})

// The cooldown is MODULE GLOBAL, so what may arm it is only evidence about unOGS itself. A 200 carrying
// `{}` and a 500 for one id are the upstream working and this ask failing, and the ids that fail that
// way include the ones this app mints, which is how one page visit silenced every Netflix row.
test('a failure about ONE title never puts the whole source into the cooldown', async () => {
  const { ctx, calls } = rig({
    ...unogsRoutes('80987039', json({})),
    ...unogsRoutes('70000001', status(500)),
    ...unogsRoutes('70000002', json(RECORDED_UNOGS)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })

  await getMedia('80987039', ctx, 1, true)
  await getMedia('70000001', ctx, 1, true)
  const healthy = await getMedia('70000002', ctx, 1, true)

  expect(unogsEpisodeCalls(calls).length, 'every title still gets its own ask').toBe(3)
  expect(healthy?.episodes?.length, 'and a healthy title is still served by unOGS').toBe(2)
})

// `hasNextPage` alone read a payload with no `pageInfo` as a COMPLETE season, so a reshaped connection
// would publish ten of 24 as a count. The page size is the belt to that braces: it was exactly ten on
// every season measured across six shows, and the operation takes no pagination variable.
test('a season with no pageInfo, and one answered at the page size, are both prefixes', async () => {
  const { ctx } = rig({
    [NETFLIX_GRAPHQL_URL]: json(netflixPayload([
      // no `pageInfo` key at all, which is what a reshaped connection looks like
      { videoId: 900201, title: 'Season 1', numberLabelV2: 'Season 1', episodes: stubEpisodes(520001, 3) },
      { videoId: 900202, title: 'Season 2', numberLabelV2: 'Season 2', hasNextPage: false, episodes: stubEpisodes(520101, NETFLIX_PAGE_SIZE) },
      { videoId: 900203, title: 'Season 3', numberLabelV2: 'Season 3', hasNextPage: false, episodes: stubEpisodes(520201, 9) }
    ]))
  })

  const result = await fetchNetflixTitle('12345678', ctx)
  const title = result.ok ? result.title : undefined

  expect(title?.seasons.map(season => season.truncated), 'season 3 is the control, complete and under the cap').toEqual([true, true, false])
})

// `{ ok: true, title: undefined }` is "Netflix has no such video id", the one answer this module must
// keep distinct from every failure. A `videos` key that stops being a list was taking that value, which
// is the single place the module's own "the payload changed under us" tell was swallowed.
test('a videos key that is not a list is the payload changing, never an unknown id', async () => {
  const { ctx } = rig({ [NETFLIX_GRAPHQL_URL]: json({ data: { videos: null } }) })
  const changed = await fetchNetflixTitle('80987039', ctx)

  expect(changed.ok, 'read as an unknown id this is a show with no seasons').toBe(false)
  expect(changed.ok === false && changed.failure).toBe('unreadable')

  // the control, and it is the whole distinction: an EMPTY list is Netflix answering about the id
  const empty = rig({ [NETFLIX_GRAPHQL_URL]: json({ data: { videos: [] } }) })
  const unknown = await fetchNetflixTitle('1', empty.ctx)
  expect(unknown.ok, 'an answer, not a failure').toBe(true)
  expect(unknown.ok && unknown.title, 'and it says there is no such title').toBeUndefined()
})

// `parseUnogsSeasons` is the declared gate between "unOGS answered" and "unOGS is broken", so it has to
// keep its own promise: undefined for a body it cannot read, never a throw, since the caller reads a
// throw as the upstream being down.
test('parseUnogsSeasons never throws on a hostile episode, and drops an episode with no id', () => {
  expect(parseUnogsSeasons([{ season: 1, episodes: [null] }]), 'a null episode threw a TypeError').toEqual([
    { season: 1, seasonId: undefined, episodes: [] }
  ])

  // an episode with no `epid` was published as `nf:undefined` at netflix.com/watch/undefined, and the
  // episode uri is not scoped by its media, so two id-less episodes from two titles union onto it
  const seasons = parseUnogsSeasons([{ season: 1, episodes: [{ epid: 81402901, title: 'Episode 1' }, { title: 'Episode 2' }] }])
  expect(seasons?.[0]?.episodes.map(episode => episode.epid)).toEqual([81402901])
})

// `epnum` is Netflix's own order and the one thing it is authoritative about (it is NEVER the published
// episode number, which is the position). Every payload measured arrives already ordered, so nothing on
// the wire exercises the sort and only a hostile fixture can keep it honest.
test('a season answered out of order is read in Netflix own order, and an ambiguous one is not', () => {
  const shuffled = parseUnogsSeasons([{
    season: 1,
    episodes: [{ epid: 3, epnum: 3 }, { epid: 1, epnum: 1 }, { epid: 2, epnum: 2 }]
  }])
  expect(shuffled?.[0]?.episodes.map(episode => episode.epid)).toEqual([1, 2, 3])

  // the controls: a duplicate number and a missing one both leave the payload's own order alone,
  // because unOGS' Friends season 9 really does answer 25 episodes with a duplicate `epnum`
  const duplicated = parseUnogsSeasons([{ season: 1, episodes: [{ epid: 3, epnum: 1 }, { epid: 1, epnum: 1 }] }])
  expect(duplicated?.[0]?.episodes.map(episode => episode.epid)).toEqual([3, 1])
  const missing = parseUnogsSeasons([{ season: 1, episodes: [{ epid: 3, epnum: 2 }, { epid: 1 }] }])
  expect(missing?.[0]?.episodes.map(episode => episode.epid)).toEqual([3, 1])
})

// Netflix numbers nothing: a season carries the labels `numberLabelV2`, `shortTitle` and `title`, so a
// block whose labels name no number can only take its POSITION. Two blocks can then derive one ordinal,
// and `assembleMedia` selects by ordinal, so a collision would publish two seasons as one media holding
// both their episode lists. Not seen on the wire (nine shows, 2026-09-12), which is why it is a fixture.
test('two season blocks deriving one ordinal stay two seasons, and an unlabelled block takes its position', async () => {
  const collides = {
    ...unogsRoutes('12345678', status(503)),
    [NETFLIX_GRAPHQL_URL]: json(netflixPayload([
      // no label here carries a digit, so its only ordinal is the position, which season 1 also claims
      { videoId: 900301, title: 'Specials', hasNextPage: false, episodes: stubEpisodes(530001, 2) },
      { videoId: 900302, title: 'Season 1', numberLabelV2: 'Season 1', hasNextPage: false, episodes: stubEpisodes(530101, 3) }
    ]))
  }
  const ask = async (season: number, routes: Record<string, Answer>) => {
    resetUnogsCaches()
    return await getMedia('12345678', rig(routes).ctx, season, true)
  }

  expect((await ask(1, collides))?.episodes?.map(episode => episode.id), 'the labelled block keeps the number it named')
    .toEqual(['530101', '530102', '530103'])
  expect((await ask(2, collides))?.episodes?.map(episode => episode.id), 'and the unlabelled one moves rather than merging')
    .toEqual(['530001', '530002'])

  // the position fallback on its own: a lone unlabelled block is season 1 because it is first
  const lone = {
    ...unogsRoutes('12345678', status(503)),
    [NETFLIX_GRAPHQL_URL]: json(netflixPayload([
      { videoId: 900401, title: 'Limited Series', hasNextPage: false, episodes: stubEpisodes(540001, 2) }
    ]))
  }
  expect((await ask(1, lone))?.episodes?.map(episode => episode.id)).toEqual(['540001', '540002'])
})

// The operation is a PERSISTED query: Netflix holds the document and this file sends only its id, its
// version and the variables. Netflix refuses the operation outright if a variable is missing, and
// without the locale header it answers in the geo default language, which feeds localized episode
// titles into the season picker. None of that is visible in a diff, so it is pinned to the recording.
//
// The literal id and version are asserted next to the constant on purpose: comparing only against the
// constant would stay green while both halves moved together. When Netflix does edit the query, this
// test and `NETFLIX_PERSISTED_QUERY` are meant to be updated in the same change.
test('the outbound Netflix request is the one the logged-out page sends', async () => {
  const { ctx, calls } = rig({ [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX) })
  await fetchNetflixTitle('80987039', ctx)

  const init = netflixCalls(calls)[0]?.init as RequestInit & { headers: Record<string, string> }
  const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]))
  expect(init.method).toBe('POST')
  expect(headers['x-netflix.context.locales'], 'without it the episode titles arrive in the geo language').toBe('en')
  expect(headers['content-type']).toBe('application/json')

  const body = JSON.parse(String(init.body))
  expect(body.operationName).toBe('LodpTitleAndPlansPageQuery')
  expect(body.extensions.persistedQuery).toEqual(NETFLIX_PERSISTED_QUERY)
  expect(body.extensions.persistedQuery.id, 'read off Netflix own bundle, 2026-09-12').toBe('217277fd-12a1-4816-a5b2-b9d7b9afd4ea')
  expect(body.extensions.persistedQuery.version, 'a right id with a wrong version is refused the same way').toBe(102)
  // toEqual, so a MISSING variable and an added one both fail: Netflix rejects the operation either way
  expect(body.variables).toEqual({
    videoId: 80987039,
    opaqueImageFormat: 'JPG',
    transparentImageFormat: 'PNG',
    thumbnailVideoId: 0,
    hasValidThumbnailVideoId: false,
    useBakedInPlayThumbnail: false,
    useFromWatchSupplements: false,
    isModernizedSignup: false
  })
})

// A REVOKED unOGS token is answered HTTP 500 (`{"message": "Internal Server Error"}`, measured
// 2026-09-12), and the token is cached for 12 h against a measured 24 h lifetime. A cache that kept
// serving a revoked token would hold the whole source on the truncated fallback for half a day, with
// nothing ever looking stale and the failure re-arming on every ask.
test('a failed episodes call forgets the cached token, so the next ask mints a fresh one', async () => {
  const { ctx, calls } = rig({
    ...unogsRoutes('80987039', status(500)),
    ...unogsRoutes('70000001', json(RECORDED_UNOGS)),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })
  const tokenCalls = (asked: Call[]) => asked.filter(call => call.url === `${UNOGS}/user`).length

  await getMedia('80987039', ctx, 1, true)
  await getMedia('70000001', ctx, 1, true)
  expect(tokenCalls(calls), 'a 500 may be a revoked token, so the next ask does not reuse it').toBe(2)

  // the control, without which the count above proves nothing: a healthy source mints ONE token and
  // every later ask reuses it, which is the cache this is deliberately stepping around
  resetUnogsCaches()
  const healthy = rig({
    ...unogsRoutes('80987039', json(RECORDED_UNOGS)),
    ...unogsRoutes('70000001', json(RECORDED_UNOGS))
  })
  await getMedia('80987039', healthy.ctx, 1, true)
  await getMedia('70000001', healthy.ctx, 1, true)
  expect(tokenCalls(healthy.calls), 'two titles, one token').toBe(1)
})

// A page showing several seasons of one Netflix title asks about that title several times at once, and
// every one of those asks resolves to the same show id. The unOGS calls have always collapsed into one
// through `_inflight`; the fallback sat outside that map and POSTed Netflix once per row. Measured
// 2026-09-12 over five concurrent asks: one unOGS call and FIVE Netflix calls.
test('concurrent asks for one title make one fallback call, not one per row', async () => {
  const { ctx, calls } = rig({
    ...unogsRoutes('80987039', json([])),
    [NETFLIX_GRAPHQL_URL]: json(RECORDED_NETFLIX)
  })

  const rows = await Promise.all(Array.from({ length: 5 }, () => getMedia('80987039', ctx, 1, true)))

  expect(unogsEpisodeCalls(calls).length, 'the primary already collapsed a burst').toBe(1)
  expect(netflixCalls(calls).length, 'and the fallback now collapses with it').toBe(1)
  expect(netflixSeasonCalls(calls).length, 'and so does the season call, which is keyed by season id').toBe(1)
  // the control: sharing one call must not starve any of the rows that waited on it
  expect(rows.map(row => row?.episodes?.length), 'every row still gets its episodes').toEqual([10, 10, 10, 10, 10])
})
