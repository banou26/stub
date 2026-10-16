// Netflix's own season endpoint is where this source's EPISODES come from: the operation
// www.netflix.com's preview modal calls for one season's episode list. unOGS stays the season INDEX
// (it pages nothing, it answers every season of a title in one request, and it is the only one of the
// two that can search), and it stays the fallback for the episodes themselves.
//
// Four things about that endpoint would each silently cost a whole season, and each has a test below.
// It answers 200 with PARTIAL `UNAUTHENTICATED` errors on every logged-out call, so the natural
// "errors.length means failure" throws all 24 episodes away. Its pagination variable is `cursor` and
// an unknown variable is ignored in SILENCE, so a loop written against `after` reads page one forever.
// Its artwork is not always an episode frame. And its persisted query id is Netflix's, hardcoded, so
// the day they edit it every call must fail loudly rather than as a season with no episodes.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import {
  fetchNetflixSeasonEpisodes,
  NETFLIX_EMPTY_FACT,
  NETFLIX_FAILURE_FACT,
  NETFLIX_GRAPHQL_URL,
  NETFLIX_SEASON_PAGE_SIZE,
  NETFLIX_SEASON_QUERY,
  type NetflixSeasonEmpty
} from '../../../../src/sources/unogs/netflix'
import { getMedia, resetUnogsCaches } from '../../../../src/sources/unogs/extractor'
import { withBackoff, type FetchLike } from '../../../../src/worker/backoff'
import { withDirectFetch } from '../../../../src/worker/direct-fetch'

const UNOGS = 'https://unogs.com/api'

/**
 * Netflix's own answer for season 82941638 (Mushoku Tensei season 3), recorded live 2026-09-13.
 *
 * TRIMMED, and only by deletion: episodes 3 to 10 are gone, and so are the other 44 errors, which are
 * the same two per episode. Everything left is exactly what Netflix answered, including the four
 * partial `UNAUTHENTICATED` errors, episode 12's `SHORT_PANEL` artwork where the rest carry
 * `MERCH_STILL`, and episode 12 being numbered rather than named where the rest are named.
 */
const RECORDED_SEASON =
{
  errors: [
    {
      message: 'UNAUTHENTICATED',
      path: ['videos', 0, 'episodes', 'edges', 0, 'node', 'bookmark'],
      extensions: {
        errorType: 'UNAUTHENTICATED',
        origin: 'gusto'
      }
    },
    {
      message: 'UNAUTHENTICATED',
      path: ['videos', 0, 'episodes', 'edges', 0, 'node', 'playlistActions'],
      extensions: {
        errorType: 'UNAUTHENTICATED',
        origin: 'gusto'
      }
    },
    {
      message: 'UNAUTHENTICATED',
      path: ['videos', 0, 'episodes', 'edges', 1, 'node', 'bookmark'],
      extensions: {
        errorType: 'UNAUTHENTICATED',
        origin: 'gusto'
      }
    },
    {
      message: 'UNAUTHENTICATED',
      path: ['videos', 0, 'episodes', 'edges', 1, 'node', 'playlistActions'],
      extensions: {
        errorType: 'UNAUTHENTICATED',
        origin: 'gusto'
      }
    }
  ],
  data: {
    videos: [
      {
        __typename: 'Season',
        videoId: 82941638,
        number: 3,
        title: 'Season 3',
        episodes: {
          __typename: 'EpisodesConnection',
          edges: [
            {
              __typename: 'EpisodeEdge',
              cursor: 'MA==',
              node: {
                __typename: 'Episode',
                number: 1,
                videoId: 82941639,
                artwork: {
                  __typename: 'Image',
                  height: 192,
                  key: 'MERCH_STILL|9b8e7b40-760b-11f1-a45f-1293a6480cf9|en',
                  url: 'https://occ-0-988-993.1.nflxso.net/dnm/api/v6/9pS1daC2n6UGc3dUogvWIPMR_OU/AAAABZzDHm3SpnTsNnhbLVtFgoTfStGUosbKfG5Cw7gtOOo5qPHu-a6IgJ1b-LNbosvWfCLv5HASS8y3etQiGoI9XCX3fkjU3PgCe0oAPgjr1QCuHnIbdnZd--Si.webp?r=9f2',
                  width: 342
                },
                displayRuntimeSec: 1422,
                title: 'Rage, Mad Dog',
                bookmark: null,
                runtimeSec: 1422,
                contextualSynopsis: {
                  __typename: 'ContextualSynopsis',
                  evidenceKey: 'web_synopsis|82941639_INFORMATIVE|en',
                  text: 'Leaving Rudeus, Eris goes with Ghislaine to the Holy Land of Swords. There, Eris trains under Sword God Gal Farion alongside fellow Sword Saint Nina.'
                },
                isAvailable: true,
                playlistActions: null
              }
            },
            {
              __typename: 'EpisodeEdge',
              cursor: 'MQ==',
              node: {
                __typename: 'Episode',
                number: 2,
                videoId: 82941640,
                artwork: {
                  __typename: 'Image',
                  height: 192,
                  key: 'MERCH_STILL|f5b3e3f0-7604-11f1-80df-0affdcb6976f|en',
                  url: 'https://occ-0-988-993.1.nflxso.net/dnm/api/v6/9pS1daC2n6UGc3dUogvWIPMR_OU/AAAABQbKy2X5QyniLPxcVBTse_T0OpXp7sB9HIyggV-us4bOu_XxE6B9apQYMsVoQfcBnFp-3kqOpsrhmIuhQBDZs5S3gdUAxwutpqZk9_qrQxWaPGWeNMBt3W7E.webp?r=cfe',
                  width: 342
                },
                displayRuntimeSec: 1422,
                title: 'Howl, Mad Dog',
                bookmark: null,
                runtimeSec: 1422,
                contextualSynopsis: {
                  __typename: 'ContextualSynopsis',
                  evidenceKey: 'web_synopsis|82941640_INFORMATIVE|en',
                  text: 'A skeptical Nina investigates after hearing Eris talk about Rudeus. Later, Water God Reida and her disciple Isolde arrive at the training grounds.'
                },
                isAvailable: true,
                playlistActions: null
              }
            },
            {
              __typename: 'EpisodeEdge',
              cursor: 'MTA=',
              node: {
                __typename: 'Episode',
                number: 11,
                videoId: 82941649,
                artwork: {
                  __typename: 'Image',
                  height: 192,
                  key: 'MERCH_STILL|3f04cf70-a778-11f1-b74f-0affff8c011d|en',
                  url: 'https://occ-0-988-993.1.nflxso.net/dnm/api/v6/9pS1daC2n6UGc3dUogvWIPMR_OU/AAAABUtfjokvOWMGzhBnPSV8BJEPaU1pWHREwobqDzekltI6ldCGjoDWIRvdedohrimAX0MG72Thb5rRcdnPYvm8mKD8wAaRD9likJsZXfBLKVZpktDfGCWsOggs.webp?r=0df',
                  width: 342
                },
                displayRuntimeSec: 1422,
                title: 'Turning Point 4',
                bookmark: null,
                runtimeSec: 1422,
                contextualSynopsis: {
                  __typename: 'ContextualSynopsis',
                  evidenceKey: 'web_synopsis|82941649_INFORMATIVE|en',
                  text: 'After escaping Atoferatofe\'s pursuit, Rudeus obtains an herb he hopes can save Nanahoshi while Hitogami\'s advice brings a mysterious figure home.'
                },
                isAvailable: true,
                playlistActions: null
              }
            },
            {
              __typename: 'EpisodeEdge',
              cursor: 'MTE=',
              node: {
                __typename: 'Episode',
                number: 12,
                videoId: 82941650,
                artwork: {
                  __typename: 'Image',
                  height: 192,
                  key: 'SHORT_PANEL|55f07c40-6950-11f1-8e8d-0affd9b893b7|en',
                  url: 'https://occ-0-988-993.1.nflxso.net/dnm/api/v6/0Pl7FikwS6m8lECGYFS3VKaweAg/AAAABSRzQ-nNn9-KKp8a_Pkk1QIDPi48DN981_YdbzaOH2ubfJdwuRLKJJmWirgPJUp1puW8qytREbtZDX4tLEDLZ0w1oLWAqNhXpYQ.webp?r=193',
                  width: 342
                },
                displayRuntimeSec: 0,
                title: 'Episode 12',
                bookmark: null,
                runtimeSec: 1421,
                contextualSynopsis: {
                  __typename: 'ContextualSynopsis',
                  evidenceKey: 'web_synopsis|82941650_INFORMATIVE|en',
                  text: ' '
                },
                isAvailable: false,
                playlistActions: null
              }
            }
          ],
          pageInfo: {
            __typename: 'PageInfo',
            endCursor: 'MTE=',
            hasNextPage: false
          }
        }
      }
    ]
  }
}

/** One episode edge, spelled the way the recorded payload spells one. */
const edge = (videoId: number, number: number, overrides: Record<string, unknown> = {}) => ({
  __typename: 'EpisodeEdge',
  cursor: btoa(String(number - 1)),
  node: {
    __typename: 'Episode',
    videoId,
    number,
    title: `The ${number}th Trial`,
    runtimeSec: 1422,
    contextualSynopsis: { __typename: 'ContextualSynopsis', text: `What happens in episode ${number}.` },
    artwork: { __typename: 'Image', key: `MERCH_STILL|${videoId}|en`, url: `https://occ.nflxso.net/${videoId}.webp`, width: 342, height: 192 },
    ...overrides
  }
})

/** One page of a season, with the `pageInfo` Netflix answers. */
const seasonPage = (edges: unknown[], hasNextPage: boolean, endCursor: string) => ({
  data: {
    videos: [{
      __typename: 'Season',
      videoId: 82941638,
      episodes: { __typename: 'EpisodesConnection', edges, pageInfo: { __typename: 'PageInfo', hasNextPage, endCursor } }
    }]
  }
})

type Call = { url: string, body: Record<string, unknown>, init?: RequestInit }

/** A route staging a LITERAL answer body, for the answers that are not JSON and not Netflix's. */
type RawAnswer = { raw: string }
const isRaw = (answer: unknown): answer is RawAnswer =>
  typeof answer === 'object' && answer !== null && typeof (answer as RawAnswer).raw === 'string'

/**
 * Both Netflix operations share ONE url, and the season one pages, so a rig that routes by url cannot
 * express either. This one routes by operation name and by the `cursor` variable, and an unrouted
 * request THROWS: a test that stages page two must fail loudly if the code asks for it by another
 * name, which is exactly the `after` trap.
 */
const rig = (routes: Record<string, unknown>) => {
  const calls: Call[] = []
  const ctx = {
    fetch: (async (url: string, init?: RequestInit) => {
      // only Netflix's body is JSON: unOGS' token call posts a form, and parsing that throws a
      // SyntaxError the source reads as unOGS being down
      const body = String(url) === NETFLIX_GRAPHQL_URL
        ? JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        : {}
      const key = String(url) === NETFLIX_GRAPHQL_URL
        ? `${body.operationName}:${(body.variables as { cursor?: string } | undefined)?.cursor ?? ''}`
        : String(url)
      calls.push({ url: String(url), body, init })
      const answer = routes[key]
      if (answer === undefined) throw new Error(`unstubbed request: ${key}`)
      // a REAL Response, so a route can stage a body that is not JSON at all (`raw`) and the source
      // reads it exactly as it reads Netflix's: a stub that can only answer objects cannot express
      // the 200 that something else answered, which is the failure this file's `not-netflix` is for
      return isRaw(answer) ? new Response(answer.raw, { status: 200 }) : new Response(JSON.stringify(answer), { status: 200 })
    }) as unknown as ExtractorServerContext['fetch']
  } as unknown as ExtractorServerContext
  return { ctx, calls }
}

const SEASON = 'PreviewModalEpisodeSelectorSeasonEpisodes'

/** The unOGS side of one season of a series: the index, which this source still takes from unOGS. */
const unogsRoutes = (id: string, seasonId: number) => ({
  [`${UNOGS}/user`]: { token: { access_token: 'test-token' } },
  [`${UNOGS}/title/detail?netflixid=${id}`]: [{
    netflixid: Number(id), title: 'Mushoku Tensei', vtype: 'series', synopsis: 'A show.', year: '2021', img: '', lgimg: ''
  }],
  [`${UNOGS}/title/bgimages?netflixid=${id}`]: {},
  [`${UNOGS}/title/episodes?netflixid=${id}`]: [{
    season: 3,
    episodes: [
      // unOGS' own episodes for the same season: the one placeholder image it repeats across a whole
      // season, and the synopsis it does not have. What Netflix's answer replaces.
      { epid: 82941639, seasid: seasonId, epnum: 1, seasnum: 3, title: 'Rage, Mad Dog', synopsis: '', img: 'http://unogs.com/placeholder.jpg' },
      { epid: 82941640, seasid: seasonId, epnum: 2, seasnum: 3, title: 'Howl, Mad Dog', synopsis: '', img: 'http://unogs.com/placeholder.jpg' },
      { epid: 82941649, seasid: seasonId, epnum: 11, seasnum: 3, title: 'Turning Point 4', synopsis: '', img: 'http://unogs.com/placeholder.jpg' },
      { epid: 82941650, seasid: seasonId, epnum: 12, seasnum: 3, title: 'Inheritance', synopsis: '', img: 'http://unogs.com/placeholder.jpg' }
    ]
  }]
})

beforeEach(() => {
  resetUnogsCaches()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// THE ONE THAT LOSES A WHOLE SEASON. Every logged-out call is answered 200 with one UNAUTHENTICATED
// error per episode for `bookmark` and one for `playlistActions`, both per-viewer watch state, and the
// season is complete beside them. `if (errors.length) return failure` throws all of it away.
test('a season answered with partial UNAUTHENTICATED errors is a whole season', async () => {
  const { ctx } = rig({ [`${SEASON}:`]: RECORDED_SEASON })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok, 'partial errors on per-viewer fields are not a failure').toBe(true)
  if (!answer.ok) return
  expect(answer.episodes.map(episode => episode.videoId)).toEqual([82941639, 82941640, 82941649, 82941650])
  expect(answer.truncated, 'the payload said hasNextPage: false').toBe(false)
  // the control: an error that is NOT scoped to a per-viewer field is still a failure, so the
  // tolerance above cannot be passing by accepting everything
  const fatal = rig({ [`${SEASON}:`]: { errors: [{ message: 'UNAUTHENTICATED', extensions: { errorType: 'UNAUTHENTICATED' } }] } })
  const refused = await fetchNetflixSeasonEpisodes(82941638, fatal.ctx)
  expect(refused.ok, 'a top-level error carries no path and is about the whole operation').toBe(false)
})

// Netflix's own synopsis is the whole reason this source stopped taking episodes from unOGS: it is
// what the episode anchor scores against, and unOGS answered 4 of 24 where Netflix answers 24 of 24.
test('the synopsis Netflix published reaches the episode', async () => {
  const { ctx } = rig({ [`${SEASON}:`]: RECORDED_SEASON })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok).toBe(true)
  if (!answer.ok) return
  expect(answer.episodes[0]?.synopsis).toBe('Leaving Rudeus, Eris goes with Ghislaine to the Holy Land of Swords. There, Eris trains under Sword God Gal Farion alongside fellow Sword Saint Nina.')
  expect(answer.episodes.every(episode => episode.synopsis), 'every episode of the season carries one').toBe(true)
})

// `artwork` is a generic field name, so the key is the only thing that says what the image IS.
// Episode 12 of this very season carries a promotional SHORT_PANEL where the other eleven carry a
// frame of the episode, and published as a thumbnail it is simply a wrong picture on one row.
test('artwork that is not a MERCH_STILL is not published as a still', async () => {
  const { ctx } = rig({ [`${SEASON}:`]: RECORDED_SEASON })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok).toBe(true)
  if (!answer.ok) return
  const [first, , , last] = answer.episodes
  expect(last?.thumbnail, 'SHORT_PANEL is not an episode frame').toBeUndefined()
  // the control, without which the assertion above passes on a parser that reads no artwork at all
  expect(first?.thumbnail, 'MERCH_STILL is').toContain('https://occ-0-988-993.1.nflxso.net/')
})

// The pagination variable is `cursor`. Measured 2026-09-13 on this season with count 5: a request
// carrying `after: <endCursor>` is answered THE SAME five episodes, because an unknown variable is
// ignored in silence. A loop written against `after` reads page one forever and publishes a fifth of
// a season, so the rig below THROWS on any request it did not stage.
test('a season longer than one page is followed to the end', async () => {
  const { ctx, calls } = rig({
    [`${SEASON}:`]: seasonPage([edge(1, 1), edge(2, 2), edge(3, 3)], true, 'Mg=='),
    [`${SEASON}:Mg==`]: seasonPage([edge(4, 4), edge(5, 5), edge(6, 6)], false, 'NQ==')
  })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok).toBe(true)
  if (!answer.ok) return
  expect(answer.episodes.map(episode => episode.videoId), 'both pages, in order').toEqual([1, 2, 3, 4, 5, 6])
  expect(answer.truncated, 'the last page said hasNextPage: false').toBe(false)
  expect(calls.length).toBe(2)
  expect((calls[1]?.body.variables as { cursor?: string })?.cursor, 'asked with the endCursor page one answered').toBe('Mg==')
  expect((calls[0]?.body.variables as { count?: number })?.count).toBe(NETFLIX_SEASON_PAGE_SIZE)
})

// The other half of that trap: a page that declares more and then answers the same episodes again is
// what an ignored pagination variable LOOKS like, and looping on it never returns. Stopping is right;
// stopping quietly and calling the prefix a season is not, because a prefix's length is published as
// an episode count.
test('a page that repeats itself stops the walk and says the season is longer than this', async () => {
  const page = seasonPage([edge(1, 1), edge(2, 2)], true, 'MQ==')
  const { ctx, calls } = rig({ [`${SEASON}:`]: page, [`${SEASON}:MQ==`]: page })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok).toBe(true)
  if (!answer.ok) return
  expect(answer.episodes.map(episode => episode.videoId), 'each episode once').toEqual([1, 2])
  expect(answer.truncated, 'and the season is not claimed to be two episodes long').toBe(true)
  expect(calls.length, 'two pages, then it gave up rather than spinning').toBe(2)
})

// The id and version are Netflix's, hardcoded, and only a person re-reading their bundle can fix them.
// Both measured shapes are here because they look nothing alike: a wrong id names itself, a wrong
// version answers "Gateway Internal Error" with the tell buried in a debug field.
test('a stale persisted query is its own loud failure, never an empty season', async () => {
  const notFound = rig({
    [`${SEASON}:`]: { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }], data: null }
  })
  const byId = await fetchNetflixSeasonEpisodes(82941638, notFound.ctx)
  expect(byId.ok).toBe(false)
  if (byId.ok) return
  expect(byId.failure).toBe('persisted-query-stale')
  expect(byId.message, 'it names the constant a human has to re-read').toContain('NETFLIX_SEASON_QUERY')

  const badVersion = rig({
    [`${SEASON}:`]: {
      errors: [{
        message: 'Gateway Internal Error',
        extensions: {
          errorType: 'INTERNAL',
          errorDetail: 'SERVER_ERROR',
          debugInfo: { exception: 'PersistedQueryValidationException(message=persistedQuery.version not supported.)' }
        }
      }],
      data: null
    }
  })
  const byVersion = await fetchNetflixSeasonEpisodes(82941638, badVersion.ctx)
  expect(byVersion.ok).toBe(false)
  if (byVersion.ok) return
  expect(byVersion.failure, 'a wrong version is the same job for a human as a wrong id').toBe('persisted-query-stale')

  // the control: an ordinary upstream error is NOT filed as stale, or the distinction is decoration
  const ordinary = rig({ [`${SEASON}:`]: { errors: [{ message: 'something else' }] } })
  const other = await fetchNetflixSeasonEpisodes(82941638, ordinary.ctx)
  expect(other.ok).toBe(false)
  if (other.ok) return
  expect(other.failure).toBe('graphql-errors')
})

test('the call carries the persisted query, no credentials and no authorization', async () => {
  const { ctx, calls } = rig({ [`${SEASON}:`]: RECORDED_SEASON })
  await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect((calls[0]?.body.extensions as { persistedQuery?: unknown })?.persistedQuery).toEqual(NETFLIX_SEASON_QUERY)
  expect((calls[0]?.body.variables as { seasonId?: number })?.seasonId).toBe(82941638)

  // This call leaves the VIEWER'S OWN BROWSER (src/worker/direct-fetch.ts), because Netflix answers
  // per country and no relay can supply the viewer's address. So the viewer may well be signed in to
  // Netflix in this very tab, and their session must never ride along on a lookup they did not make.
  // The rig discarded `init` until 2026-09-13, so this test asserted its own title and nothing else:
  // deleting `credentials: 'omit'` from the source left the whole suite green.
  const init = (calls[0]?.init ?? {}) as RequestInit & { headers?: Record<string, string> }
  expect(init.credentials, "'include' or a default would attach the viewer's Netflix session").toBe('omit')
  const headers = Object.keys(init.headers ?? {}).map(header => header.toLowerCase())
  expect(headers).not.toContain('cookie')
  expect(headers).not.toContain('authorization')
})

// END TO END, through the real extractor: unOGS answers the season index, Netflix answers the
// episodes, and what the source publishes is Netflix's synopsis, Netflix's still and Netflix's
// runtime rather than unOGS' blank synopsis and one repeated placeholder image.
test('the published season 3 carries Netflix episode data, not unOGS placeholders', async () => {
  const { ctx, calls } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: RECORDED_SEASON })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.uri).toBe('nf:80987039-3')
  expect(media?.episodes?.map(episode => episode.id)).toEqual(['82941639', '82941640', '82941649', '82941650'])
  expect(media?.episodes?.[0]?.descriptions?.[0]?.description, 'the anchor the third slice scores on').toContain('Eris trains under Sword God Gal Farion')
  expect(media?.episodes?.[0]?.thumbnails?.[0]?.url, 'a frame of this episode, not one placeholder repeated').toBe('https://occ-0-988-993.1.nflxso.net/dnm/api/v6/9pS1daC2n6UGc3dUogvWIPMR_OU/AAAABZzDHm3SpnTsNnhbLVtFgoTfStGUosbKfG5Cw7gtOOo5qPHu-a6IgJ1b-LNbosvWfCLv5HASS8y3etQiGoI9XCX3fkjU3PgCe0oAPgjr1QCuHnIbdnZd--Si.webp?r=9f2')
  expect(new Set(media?.episodes?.map(episode => episode.thumbnails?.[0]?.url)).size, 'four episodes, four distinct stills').toBe(4)
  expect(media?.episodes?.[0]?.runtime, '1422 seconds is a 24 minute episode').toBe(24)
  expect(media?.episodeCount, 'a season Netflix answered in full has a real count').toBe(4)
  // one unOGS index call for the whole title and ONE Netflix call for the season being published
  expect(calls.filter(call => call.url.startsWith(`${UNOGS}/title/episodes`)).length).toBe(1)
  expect(calls.filter(call => call.url === NETFLIX_GRAPHQL_URL).length).toBe(1)
})

// Netflix numbers some seasons rather than naming them ("Episode 1" through "Episode 24" for season 1
// of this very show), so the replacement keeps unOGS' name when it has a real one for the same id.
// Losing a name that was already published would be a regression on the one axis unOGS is not worse on.
test('a name unOGS has is not replaced by a number Netflix has', async () => {
  const { ctx } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: RECORDED_SEASON })
  const media = await getMedia('80987039', ctx, 3, true)

  const titles = media?.episodes?.map(episode => episode.titles?.[0]?.title)
  expect(titles?.[3], 'Netflix calls this one "Episode 12"; unOGS names it').toBe('Inheritance')
  expect(titles?.[0], 'and a name Netflix does have is its own').toBe('Rage, Mad Dog')
})

// Netflix numbers an episode across the whole show ("Episode 52" for a second season's fourth), so a
// numbered title with no real name behind it is no title, and the row falls back to its own
test('a number Netflix has and unOGS has no name for is no title', async () => {
  const routes = unogsRoutes('80987039', 82941638)
  const [listed] = routes[`${UNOGS}/title/episodes?netflixid=80987039`] as { episodes: { title: string }[] }[]
  listed!.episodes[3]!.title = 'Episode 12'
  const { ctx } = rig({ ...routes, [`${SEASON}:`]: RECORDED_SEASON })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.map(episode => episode.titles?.[0]?.title)).toEqual(['Rage, Mad Dog', 'Howl, Mad Dog', 'Turning Point 4', undefined])
})

// The floor. Netflix failing must leave exactly what this source published before it existed, because
// unOGS' episodes are worse and not nothing.
test('a failed Netflix call leaves the unOGS episodes standing', async () => {
  const { ctx } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] } })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.length, 'unOGS answered these and they are still published').toBe(4)
  expect(media?.episodes?.[0]?.thumbnails?.[0]?.url, 'the unOGS image, upgraded to https').toBe('https://unogs.com/placeholder.jpg')
  expect(media?.episodes?.[0]?.runtime, 'unOGS publishes no runtime at all').toBeUndefined()
})

/** The shape `Media.episodes` is asked with once a season media is already in the store. */
const askMediaEpisodes = async (parent: Partial<GQLMedia>, ctx: ExtractorServerContext) => {
  const { episodes } = (await import('../../../../src/sources/unogs/extractor')).resolvers.Media as unknown as { episodes: Function }
  return await episodes({ origin: 'nf', categories: ['SERIES'], ...parent }, {}, ctx) as GQLMedia['episodes']
}

// The path a stored `nf:<show>-<n>` row takes to fill its episode list, which is where the app reads
// them from: it splits the season off the id itself, so the Netflix call has to be made from here too.
test('an already-known season row fills its episodes from Netflix as well', async () => {
  const { ctx } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: RECORDED_SEASON })
  const episodes = await askMediaEpisodes({ id: '80987039-3', uri: 'nf:80987039-3' }, ctx)

  expect(episodes?.length).toBe(4)
  expect(episodes?.[0]?.descriptions?.[0]?.description).toContain('Eris trains under Sword God Gal Farion')
})

// 1d: THE EXITS THAT USED TO BE SILENT. A failure logs, but the three ways this slice quietly did
// nothing looked identical on a page: unOGS' four synopses of 24 and its one repeated placeholder
// still, with nothing anywhere saying a Netflix call had been skipped, refused or answered empty.
// Every one of them now says which fired on one line, because the difference between "Netflix
// answered a whole described season" and "the call never happened" cannot be read off the page.
//
// Mutation: delete the `console.warn` from any of the three exits in `withNetflixEpisodes` and the
// matching case below reddens while the episode assertions beside it stay green, which is exactly the
// state that had a reviewer blaming a missing `seasid` for an empty answer.
const warnings = () => {
  const lines: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')) })
  return lines
}

/** unOGS' own season list with the Netflix season id stripped out of it, which is 1d's premise. */
const withoutSeasid = (id: string) => {
  const routes = unogsRoutes(id, 82941638) as Record<string, unknown>
  const listing = routes[`${UNOGS}/title/episodes?netflixid=${id}`] as { episodes: Record<string, unknown>[] }[]
  return {
    ...routes,
    [`${UNOGS}/title/episodes?netflixid=${id}`]: listing.map(season => ({
      ...season,
      episodes: season.episodes.map(({ seasid: _seasid, ...rest }) => rest),
    })),
  }
}

test('a season unOGS answered with no seasid says so, and keeps unOGS episodes', async () => {
  const lines = warnings()
  // no Netflix route is stubbed at all: reaching one would throw `unstubbed request`, which is the
  // second half of this case. The slice must not make the call it has no id for.
  const { ctx, calls } = rig(withoutSeasid('80987039'))
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.length, 'unOGS answered these and they still publish').toBe(4)
  expect(calls.some(call => call.url === NETFLIX_GRAPHQL_URL), 'there was no season id to ask with').toBe(false)
  expect(lines.filter(line => line.includes("skipped (ours, off unOGS' own listing: the listing carries no seasid for it)"))).toHaveLength(1)
})

test('a season nobody in this listing numbers says which season was asked for', async () => {
  const lines = warnings()
  const { ctx } = rig(unogsRoutes('80987039', 82941638))
  // the listing holds season 3 alone, so season 9 is a season nobody looked at rather than an empty one
  await getMedia('80987039', ctx, 9, true)

  expect(lines.filter(line => line.includes("skipped (ours, off unOGS' own listing: no season 9 in a listing of 1)"))).toHaveLength(1)
})

// THE EXIT THE LIVE PAGE ACTUALLY TAKES, measured 2026-09-13 on all three Mushoku Tensei routes:
// Netflix answers HTTP 200 with a well formed and EMPTY `EpisodesConnection`. That is not a failure
// and must not take a season down, but it is also not nothing, and `empty` is what names which of the
// two empty shapes came back.
test('an empty but well formed Netflix season is named, not read as a failure', async () => {
  const lines = warnings()
  const { ctx } = rig({
    ...unogsRoutes('80987039', 82941638),
    [`${SEASON}:`]: { data: { videos: [{ videoId: 82941638, episodes: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } }] } },
  })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.length, 'unOGS\' own season still stands').toBe(4)
  expect(lines.filter(line => line.includes('answered no episodes (no-episodes-listed, whose fact: Netflix\'s: the season is in this country\'s catalogue and lists no episodes)'))).toHaveLength(1)
})

test('a season id Netflix does not list is a different fact from a season with no episodes', async () => {
  const lines = warnings()
  const { ctx } = rig({
    ...unogsRoutes('80987039', 82941638),
    [`${SEASON}:`]: { data: { videos: [null] } },
  })
  await getMedia('80987039', ctx, 3, true)

  expect(lines.filter(line => line.includes('answered no episodes (no-such-season, whose fact: Netflix\'s, for the country this request came from'))).toHaveLength(1)
})

// THE CONTROL for all four: the same rig with a real season logs the success line instead, with the
// counts it published. A probe that only ever reports absence proves nothing about absence.
test('a season that published says how many episodes and how many synopses', async () => {
  const lines = warnings()
  const { ctx } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: RECORDED_SEASON })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.length).toBe(4)
  expect(lines.filter(line => /published 4 episode\(s\), \d+ with a synopsis \(whose fact: Netflix's, answered to this browser's own address\)/.test(line))).toHaveLength(1)
  expect(lines.filter(line => line.includes('skipped') || line.includes('answered no episodes'))).toEqual([])
})

// F1: A 200 IS NOT A NETFLIX ANSWER, and for a year of this file's life it was read as one.
//
// The whole Netflix-episode slice published nothing on any page load, and the log said
// `no-episodes-listed`, a sentence about Netflix's catalogue. It was a sentence about which address
// the request left from: every one of these calls went through the FKN relay, which asks server-side
// from its own node, and Netflix answers per country. Measured 2026-09-13, one page, both paths, same
// minute: through the relay (152.233.49.59, Hong Kong) season 82941638 answered 0 edges and 82984815
// answered `videos: [null]`; from the browser (59.138.72.110, Tokyo) the same two answered 12 and 11.
// `src/worker/direct-fetch.ts` is what moved this host onto the second path, and the cases below are
// what stop the first class of confusion coming back in another shape.
//
// Mutation: delete the `not-netflix` branch from `readEnvelope` in netflix.ts and the case below goes
// red with BOTH shapes filed as `unreadable`, whose message opens "Netflix answered". That sentence is
// the whole defect in miniature: it names Netflix for a body Netflix never sent, which is the reading
// that had this slice's silence blamed on an empty catalogue for a day.

/** www.netflix.com's own homepage, measured 2026-09-13: HTTP 200, `text/html`, and not an answer. */
const NOT_JSON_200 = '<!doctype html><html lang="ja" class=""><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/><meta '

/** A 200 that IS json and is nobody's GraphQL answer. Measured through the relay the same day. */
const NOT_GRAPHQL_200 = '{"ip":"152.233.49.59","country":"HK"}'

test('a 200 that is not this endpoint answering is its own failure, never an empty season', async () => {
  for (const [name, raw] of [['html', NOT_JSON_200], ['json that is not a GraphQL answer', NOT_GRAPHQL_200]] as const) {
    const { ctx } = rig({ [`${SEASON}:`]: { raw } })
    const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

    expect(answer.ok, `${name}: nothing in this body is a fact about Netflix`).toBe(false)
    if (answer.ok) continue
    expect(answer.failure, name).toBe('not-netflix')
    // what answered instead is the only thing worth reading, so it travels with the failure
    expect(answer.message, name).toContain(raw.slice(0, 40))
  }
})

test('the same guard passes a real Netflix answer, so it is not refusing everything', async () => {
  const { ctx } = rig({ [`${SEASON}:`]: RECORDED_SEASON })
  const answer = await fetchNetflixSeasonEpisodes(82941638, ctx)

  expect(answer.ok, 'the control: a recorded live payload is this endpoint answering').toBe(true)
  if (!answer.ok) return
  expect(answer.episodes).toHaveLength(4)
})

/**
 * Exactly what the relay path answered for season 82941638 on 2026-09-13, all 421 bytes of it, copied
 * off the wire and not reconstructed.
 *
 * Netflix answered it in full and it is a correct answer: in Hong Kong the show is not in the
 * catalogue, so there are no episodes to list. `parentShow.isAvailable: false` is Netflix saying so,
 * and it is the only thing in the payload that tells this apart from a season that is genuinely empty.
 */
const UNAVAILABLE_SEASON = JSON.parse('{"data":{"videos":[{"__typename":"Season","videoId":82941638,"episodes":{"__typename":"EpisodesConnection","edges":[],"pageInfo":{"__typename":"PageInfo","endCursor":null,"hasNextPage":false}},"hideEpisodeNumbers":false,"number":3,"parentShow":{"__typename":"Show","currentEpisode":null,"hasRecurringReleases":false,"videoId":80987039,"isAvailable":false,"isPlayable":false,"unplayableCauses":null},"title":"Season 3"}]}}') as Record<string, unknown>

// Mutation: drop the `unavailableHere` clause in `fetchSeasonPage` and this reddens as
// `no-episodes-listed`, which is the sentence that sent a reviewer looking at Netflix's catalogue for
// a fault that was in this app's egress address.
test('a season the asking country cannot see is a different fact from a season with no episodes', async () => {
  const lines = warnings()
  const { ctx } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: UNAVAILABLE_SEASON })
  const media = await getMedia('80987039', ctx, 3, true)

  expect(media?.episodes?.length, "unOGS' own season still stands").toBe(4)
  expect(lines.filter(line => line.includes('answered no episodes (not-in-this-catalogue, whose fact: '))).toHaveLength(1)
  expect(lines.filter(line => line.includes('the country this request came from'))).toHaveLength(1)
  // the control: the same empty connection WITHOUT that flag is still the other fact
  const empty = rig({
    ...unogsRoutes('80987039', 82941638),
    [`${SEASON}:`]: { data: { videos: [{ videoId: 82941638, parentShow: { isAvailable: true }, episodes: { edges: [], pageInfo: { hasNextPage: false } } }] } },
  })
  const after = warnings()
  await resetUnogsCaches()
  await getMedia('80987039', empty.ctx, 3, true)
  expect(after.filter(line => line.includes('answered no episodes (no-episodes-listed,'))).toHaveLength(1)
})

// Both tables are `Record<Kind, string>`, so a new kind cannot be added without somebody deciding
// whose fact it is. This is what stops that decision from being the empty string: every entry has to
// name one of the three parties, and every kind the source can actually produce has to be in it.
test('every failure and every empty answer names whose fact it is', () => {
  const names = (fact: string) => /^(ours|Netflix's|neither)[:,]/.test(fact)
  for (const [kind, fact] of Object.entries(NETFLIX_FAILURE_FACT)) {
    expect(names(fact), `${kind}: "${fact}" does not open by naming a party`).toBe(true)
  }
  for (const [kind, fact] of Object.entries(NETFLIX_EMPTY_FACT)) {
    expect(names(fact), `${kind}: "${fact}" does not open by naming a party`).toBe(true)
  }
  // non-vacuous: the kinds the source really produces are the ones in the table
  const produced: NetflixSeasonEmpty[] = ['no-such-season', 'not-in-this-catalogue', 'no-episodes-listed']
  expect(Object.keys(NETFLIX_EMPTY_FACT).sort()).toEqual([...produced].sort())
  expect(Object.keys(NETFLIX_FAILURE_FACT)).toContain('not-netflix')
})

// END TO END over the real fetch path: `withBackoff(withDirectFetch(relay, direct))` is exactly what
// `src/worker/fetch.ts` hands every extractor as `ctx.fetch`, and this drives a whole `getMedia` run
// through it. One run makes both kinds of request, so it can say which leg each took rather than
// which leg exists.
//
// Mutation: `asksViewerDirectly` returning false puts the Netflix call back on the relay and this
// reddens. On the built page the same mutation takes the s3 route from 11 of 12 episodes described to
// 0 of 12, with the log line reading `not-in-this-catalogue` (measured 2026-09-13, both stores).
test('the Netflix call leaves this browser and the unOGS calls in the same run do not', async () => {
  const { ctx, calls } = rig({ ...unogsRoutes('80987039', 82941638), [`${SEASON}:`]: RECORDED_SEASON })
  const legs: string[] = []
  const leg = (name: string): FetchLike => (input, init) => {
    legs.push(`${name} ${new URL(String(input)).origin}`)
    return (ctx.fetch as FetchLike)(input, init)
  }
  const routed = { ...ctx, fetch: withBackoff(withDirectFetch(leg('relay'), leg('direct'))) } as ExtractorServerContext
  const media = await getMedia('80987039', routed, 3, true)

  expect(media?.episodes?.length, 'the run published, so both legs really ran').toBe(4)
  expect(legs.filter(entry => entry === 'direct https://www.netflix.com'), 'the season episodes').toHaveLength(1)
  expect(legs.filter(entry => entry.startsWith('direct')), 'and nothing else went direct').toHaveLength(1)
  expect(legs.filter(entry => entry === 'relay https://unogs.com').length, 'unOGS still goes through the relay').toBeGreaterThan(0)
})
