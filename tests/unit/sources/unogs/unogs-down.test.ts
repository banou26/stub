// uNoGS is a third-party site and it goes away. Measured 2026-10-31, about 14:34 to 14:50 JST: its token
// call stayed out about 35 s and came back 502, the backoff then asked three more times, and every Netflix
// ask hit its 30 s limit before it reached the fallback to Netflix's own catalogue, so every show lost its
// Netflix icons. The clock is faked, so each wait here is the real one and costs nothing.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { withBackoff } from '../../../../src/worker/backoff'
import { ASK_BOUND_MS } from '../../../../src/worker/fanout'
import { NETFLIX_GRAPHQL_URL } from '../../../../src/sources/unogs/netflix'
import { getMedia, resetUnogsCaches, resolvers, UNOGS_COOLDOWN_MS, UNOGS_WAIT_MS } from '../../../../src/sources/unogs/extractor'

const UNOGS = 'https://unogs.com/api'
const SQUID_GAME = '81040344'
const GLASS_ONION = '81458416'
const FIRST_SEASON = 81105887

const seasonEpisodes = (number: number, label: string, episodes: [number, string][], hasNextPage = false) => ({
  __typename: 'SeasonEdge',
  node: {
    __typename: 'Season',
    videoId: number,
    title: label,
    shortTitle: label,
    numberLabelV2: label,
    episodes: {
      __typename: 'EpisodesConnection',
      pageInfo: { __typename: 'PageInfo', hasNextPage },
      edges: episodes.map(([videoId, title], index) => ({
        __typename: 'EpisodeEdge',
        node: { __typename: 'Episode', videoId, number: index + 1, runtimeSec: 3300, title },
      })),
    },
  },
})

const FIRST_SEASON_EPISODES: [number, string][] = [
  [81262746, 'Red Light, Green Light'],
  [81262748, 'Hell'],
  [81262750, 'The Man with the Umbrella'],
  [81262752, 'Stick to the Team'],
  [81262754, 'A Fair World'],
  [81262755, 'Gganbu'],
  [81262757, 'VIPS'],
  [81262760, 'Front Man'],
  [81436729, 'One Lucky Day'],
]

/**
 * Netflix's own landing answer for Squid Game, anonymous, recorded live 2026-10-31 (HTTP 200, 41 KB, 380 ms).
 * Trimmed by deletion: artwork, cast and synopses are gone, and seasons 2 and 3 keep two episodes each.
 * `latestYear` is the newest year, where the title began in 2021.
 */
const SQUID_GAME_LANDING = {
  data: {
    videos: [{
      __typename: 'Show',
      videoId: 81040344,
      title: 'Squid Game',
      latestYear: 2025,
      seasons: {
        __typename: 'SeasonsConnection',
        totalCount: 3,
        pageInfo: { __typename: 'PageInfo', hasNextPage: false },
        edges: [
          seasonEpisodes(FIRST_SEASON, 'Season 1', FIRST_SEASON_EPISODES),
          seasonEpisodes(81203480, 'Season 2', [[81616248, 'Bread and Lottery'], [81616249, 'Halloween Party']]),
          seasonEpisodes(81615967, 'Season 3', [[81721226, 'Keys and Knives'], [81721227, 'The Starry Night']]),
        ],
      },
    }],
  },
}

/** Netflix's season answer for 81105887, recorded the same day, trimmed the same way, one of its 18 partial errors kept. */
const FIRST_SEASON_ANSWER = {
  errors: [{ message: 'UNAUTHENTICATED', path: ['videos', 0, 'episodes', 'edges', 0, 'node', 'bookmark'], extensions: { errorType: 'UNAUTHENTICATED', origin: 'gusto' } }],
  data: {
    videos: [{
      __typename: 'Season',
      videoId: FIRST_SEASON,
      parentShow: { __typename: 'Show', videoId: 81040344, isAvailable: true },
      episodes: {
        __typename: 'EpisodesConnection',
        pageInfo: { __typename: 'PageInfo', endCursor: 'OA==', hasNextPage: false },
        edges: FIRST_SEASON_EPISODES.map(([videoId, title], index) => ({
          __typename: 'EpisodeEdge',
          node: { __typename: 'Episode', videoId, number: index + 1, runtimeSec: 3300, title },
        })),
      },
    }],
  },
}

/** Netflix's landing answer for a film, recorded the same day: `Movie`, and no seasons connection at all. */
const GLASS_ONION_LANDING = {
  data: { videos: [{ __typename: 'Movie', videoId: 81458416, title: 'Glass Onion: A Knives Out Mystery', latestYear: 2022 }] },
}

const ALL_OF_US_ARE_DEAD = '81237994'
const ALL_OF_US_SEASON = 81237995
const ALL_OF_US_EPISODES = Array.from({ length: 12 }, (_, index): [number, string] => [81237996 + index, `Episode ${index + 1}`])

/** Recorded the same day: a season of 12 answered as its first ten, and `hasNextPage: true`. */
const ALL_OF_US_LANDING = {
  data: {
    videos: [{
      __typename: 'Show',
      videoId: 81237994,
      title: 'All of Us Are Dead',
      latestYear: 2022,
      seasons: {
        __typename: 'SeasonsConnection',
        totalCount: 1,
        pageInfo: { __typename: 'PageInfo', hasNextPage: false },
        edges: [seasonEpisodes(ALL_OF_US_SEASON, 'Season 1', ALL_OF_US_EPISODES.slice(0, 10), true)],
      },
    }],
  },
}

/** The season query for the same season, recorded the same day: all 12. */
const ALL_OF_US_SEASON_ANSWER = {
  data: {
    videos: [{
      __typename: 'Season',
      videoId: ALL_OF_US_SEASON,
      parentShow: { __typename: 'Show', videoId: 81237994, isAvailable: true },
      episodes: {
        __typename: 'EpisodesConnection',
        pageInfo: { __typename: 'PageInfo', endCursor: 'MTE=', hasNextPage: false },
        edges: ALL_OF_US_EPISODES.map(([videoId, title], index) => ({
          __typename: 'EpisodeEdge',
          node: { __typename: 'Episode', videoId, number: index + 1, runtimeSec: 3300, title },
        })),
      },
    }],
  },
}

/** What uNoGS answered through the relay while it was down: nothing for about 35 s, then a 502. */
const down = () => new Promise<Response>(resolve => { setTimeout(() => resolve(new Response('Bad Gateway', { status: 502 })), 35_000) })

const HEALTHY: Record<string, unknown> = {
  [`${UNOGS}/user`]: { token: { access_token: 'test-token' } },
  [`${UNOGS}/title/detail?netflixid=${SQUID_GAME}`]: [{ netflixid: 81040344, title: 'Squid Game', vtype: 'series', synopsis: '', year: '2021', img: '', lgimg: '' }],
  [`${UNOGS}/title/bgimages?netflixid=${SQUID_GAME}`]: {},
  [`${UNOGS}/title/episodes?netflixid=${SQUID_GAME}`]: [{
    season: 1,
    episodes: [{ epid: 81262746, seasid: FIRST_SEASON, epnum: 1, seasnum: 1, title: 'Red Light, Green Light', synopsis: '', img: '' }],
  }],
}
const answered = (url: string, after = 0) => new Promise<Response>((resolve) => {
  setTimeout(() => resolve(new Response(JSON.stringify(HEALTHY[url]), { status: 200 })), after)
})

type Stage = {
  unogs: (url: string) => Promise<Response>
  netflix?: (operation: string, variables: { videoId?: number, seasonId?: number }) => Promise<Response>
}

const recordedNetflix: NonNullable<Stage['netflix']> = async (operation, { videoId, seasonId }) => {
  if (operation === 'PreviewModalEpisodeSelectorSeasonEpisodes') {
    return Response.json(seasonId === FIRST_SEASON ? FIRST_SEASON_ANSWER : seasonId === ALL_OF_US_SEASON ? ALL_OF_US_SEASON_ANSWER : { data: { videos: [] } })
  }
  return Response.json(videoId === Number(GLASS_ONION) ? GLASS_ONION_LANDING : videoId === Number(ALL_OF_US_ARE_DEAD) ? ALL_OF_US_LANDING : SQUID_GAME_LANDING)
}

// through the real backoff, because that is what kept a 502 asking for two minutes
const rig = (stage: Stage) => {
  const calls: string[] = []
  const ctx = {
    fetch: withBackoff(async (input, init) => {
      const url = input as string
      if (url !== NETFLIX_GRAPHQL_URL) {
        calls.push(url)
        return stage.unogs(url)
      }
      const { operationName, variables } = JSON.parse(init?.body as string)
      calls.push(operationName)
      return (stage.netflix ?? recordedNetflix)(operationName, variables)
    }),
  } as unknown as ExtractorServerContext
  return {
    ctx,
    tokenCalls: () => calls.filter(url => url === `${UNOGS}/user`).length,
    unogsCalls: () => calls.filter(url => url.startsWith(UNOGS)),
    landingCalls: () => calls.filter(url => url === 'LodpTitleAndPlansPageQuery').length,
  }
}

const SQUID_GAME_RUN = { showId: SQUID_GAME, titles: ['Squid Game'], episodeCount: 9, startDate: '2021-09-17' }

const askSimilar = async (input: Record<string, unknown>, ctx: ExtractorServerContext) => {
  const { subscribe } = (resolvers.Subscription as { similarMedia: { subscribe: Function } }).similarMedia
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return (value?.similarMedia ?? null) as GQLMedia | null
}

/** What `ask` came to once the fake clock has run `ms`, with `'still out'` for an ask that has not settled. */
const after = async <T>(ms: number, ask: Promise<T>) => {
  let outcome: { value: T } | { error: unknown } | 'still out' = 'still out'
  ask.then(value => { outcome = { value } }, error => { outcome = { error } })
  await vi.advanceTimersByTimeAsync(ms)
  return outcome as { value: T } | { error: unknown } | 'still out'
}

beforeEach(() => {
  vi.useFakeTimers()
  resetUnogsCaches()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('with uNoGS down, the ask reaches Netflix inside its limit and names the season', async () => {
  const { ctx, landingCalls } = rig({ unogs: down })

  const outcome = await after(ASK_BOUND_MS - 1, askSimilar(SQUID_GAME_RUN, ctx))

  expect(outcome, 'the ask is dropped at its limit otherwise').toMatchObject({ value: { uri: 'nf:81040344-1', scope: 'RUN', episodeCount: 9 } })
  expect(landingCalls(), 'Netflix was asked').toBeGreaterThan(0)
})

// The landing query cuts a season at ten, and a cut season offers the picker nothing, so this was a
// refusal, and a refusal is final for its evidence: the row would stay gone after the outage ended.
test('a season the landing query cut at ten is read whole before the picker sees it', async () => {
  const { ctx } = rig({ unogs: down })

  const outcome = await after(ASK_BOUND_MS - 1, askSimilar({ showId: ALL_OF_US_ARE_DEAD, titles: ['All of Us Are Dead'], episodeCount: 12, startDate: '2022-01-28' }, ctx))

  expect(outcome).toMatchObject({ value: { uri: 'nf:81237994-1', episodeCount: 12 } })
})

test('a slow token and a slow detail that still answer are used, and Netflix is not asked', async () => {
  const { ctx, landingCalls } = rig({ unogs: url => answered(url, UNOGS_WAIT_MS - 1) })

  const outcome = await after(ASK_BOUND_MS - 1, getMedia(SQUID_GAME, ctx, 1, true))

  expect(outcome).toMatchObject({ value: { uri: 'nf:81040344-1' } })
  expect(landingCalls(), 'an answer inside the wait is not an outage').toBe(0)
})

test('the wait ends the token call too, so the backoff stops asking', async () => {
  const { ctx, tokenCalls } = rig({ unogs: down })

  await after(5 * 60_000, getMedia(SQUID_GAME, ctx, 1, true))

  expect(tokenCalls(), 'four tries of 35 s each is what stalled the page').toBe(1)
})

test('after a failed token, later asks go straight to Netflix without waiting or asking uNoGS', async () => {
  const { ctx, tokenCalls, unogsCalls } = rig({ unogs: down })
  await after(ASK_BOUND_MS - 1, getMedia(SQUID_GAME, ctx, 1, true))
  const asked = unogsCalls().length

  const later = await after(0, getMedia(GLASS_ONION, ctx, undefined, true))

  expect(later, 'answered with no time passing').toMatchObject({ value: { uri: 'nf:81458416' } })
  expect(unogsCalls().length, 'nothing more went to uNoGS').toBe(asked)
  expect(tokenCalls()).toBe(1)
})

test('a burst of asks makes one token call, and asking on in the cooldown does not extend it', async () => {
  const { ctx, tokenCalls } = rig({ unogs: down })
  await after(ASK_BOUND_MS - 1, Promise.all(Array.from({ length: 5 }, () => getMedia(SQUID_GAME, ctx, 1, true))))
  expect(tokenCalls(), 'a burst shares one call').toBe(1)

  // an ask each 10 s, right through the window: a refused ask re-arming it would hold uNoGS off for good
  for (let elapsed = 0; elapsed < UNOGS_COOLDOWN_MS; elapsed += 10_000) await after(10_000, getMedia(SQUID_GAME, ctx, 1, true))
  await after(ASK_BOUND_MS - 1, getMedia(SQUID_GAME, ctx, 1, true))

  expect(tokenCalls(), 'one try each window, never a tight loop').toBe(2)
})

test('uNoGS is used again once it answers, and Netflix goes back to being the fallback', async () => {
  const stage: Stage = { unogs: down }
  const { ctx, landingCalls, unogsCalls } = rig(stage)
  await after(ASK_BOUND_MS - 1, getMedia(SQUID_GAME, ctx, 1, true))
  expect(landingCalls(), 'the control: it was down').toBeGreaterThan(0)

  stage.unogs = url => answered(url)
  await vi.advanceTimersByTimeAsync(UNOGS_COOLDOWN_MS)
  const landings = landingCalls()
  const back = await after(1_000, getMedia(SQUID_GAME, ctx, 1, true))

  expect(back).toMatchObject({ value: { uri: 'nf:81040344-1' } })
  expect(unogsCalls(), 'the title comes from uNoGS again').toContain(`${UNOGS}/title/detail?netflixid=${SQUID_GAME}`)
  expect(landingCalls(), 'and its seasons do too').toBe(landings)
})

test('a detail call that stalls with a token already held goes on to Netflix too', async () => {
  const stage: Stage = { unogs: url => answered(url) }
  const { ctx, landingCalls, tokenCalls } = rig(stage)
  await after(1_000, getMedia(SQUID_GAME, ctx, 1, true))
  expect(tokenCalls(), 'the token is minted and held').toBe(1)

  stage.unogs = down
  const outcome = await after(UNOGS_WAIT_MS + 1_000, getMedia(SQUID_GAME, ctx, 1, true))

  expect(outcome, 'one wait, and the episodes call behind it is not waited out too').toMatchObject({ value: { uri: 'nf:81040344-1', episodeCount: 9 } })
  expect(landingCalls()).toBeGreaterThan(0)
})

// `latestYear` is the NEWEST year. Offered as the title's year it reaches season 1 as a veto, so the
// run that season holds is refused for being dated 2021 against a title "from" 2025, which the first
// test in this file would catch; here it would date the show itself.
test('a title Netflix described carries no year, because its only year is the newest one', async () => {
  const { ctx } = rig({ unogs: down })

  const bare = await after(ASK_BOUND_MS - 1, getMedia(SQUID_GAME, ctx, undefined, false))
  expect(bare).toMatchObject({ value: { uri: 'nf:81040344', scope: 'CONTAINER' } })
  expect(bare !== 'still out' && 'value' in bare && bare.value?.startDate).toBeUndefined()
})

test('a film Netflix described stays a film', async () => {
  const { ctx } = rig({ unogs: down })

  const outcome = await after(ASK_BOUND_MS - 1, getMedia(GLASS_ONION, ctx, undefined, true))

  expect(outcome).toMatchObject({ value: { uri: 'nf:81458416', type: 'MOVIE', scope: 'RUN', episodeCount: 1 } })
})

test('artwork that cannot be read leaves the title standing', async () => {
  const { ctx } = rig({
    unogs: url => url.includes('/bgimages') ? Promise.resolve(new Response('Bad Gateway', { status: 500 })) : answered(url),
  })

  const outcome = await after(1_000, getMedia(SQUID_GAME, ctx, 1, true))

  expect(outcome).toMatchObject({ value: { uri: 'nf:81040344-1' } })
})

// A refusal is final for its evidence and a decline is asked again on the next read, so a null here would
// cost the show its Netflix row for the session, long after the outage ended.
test('nobody answering stays a failure, never a refusal', async () => {
  const { ctx } = rig({ unogs: down, netflix: () => Promise.resolve(new Response('', { status: 503 })) })

  const outcome = await after(ASK_BOUND_MS - 1, askSimilar(SQUID_GAME_RUN, ctx))

  expect(outcome).toMatchObject({ error: expect.anything() })
})

test('control: Netflix saying it has no such title is an answer, and a refusal', async () => {
  const { ctx } = rig({ unogs: down, netflix: async () => Response.json({ data: { videos: [] } }) })

  const outcome = await after(ASK_BOUND_MS - 1, askSimilar(SQUID_GAME_RUN, ctx))

  expect(outcome).toEqual({ value: null })
})
