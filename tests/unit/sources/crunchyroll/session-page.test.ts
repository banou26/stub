// The page script's half, as it runs inside a page at www.crunchyroll.com: what it asks Crunchyroll for
// one season, against a fake fetch answering as ./watched-fixtures.ts says.
import { expect, test } from 'vite-plus/test'

import { readWatched } from '../../../../src/sources/crunchyroll/session-page'
import { ACCESS_TOKEN, ACCOUNT_ID, PLAYHEADS, SEASON_EPISODES, SEASON_ID, SERIES_ID, SIGNED_OUT, WATCHED, fakeCrunchyroll } from './watched-fixtures'

const SEASON = { seriesId: SERIES_ID, seasonId: SEASON_ID }

test("finds the season in its series as the source does, then reads its episodes and their playheads with the viewer's own token", async () => {
  const { send, asked } = fakeCrunchyroll()
  const answer = await readWatched(SEASON, send)

  expect(answer).toEqual({ status: 200, body: null, episodes: WATCHED })
  const [token, seasons, episodes, playheads] = asked
  expect(new URL(token!.url).pathname).toBe('/auth/v1/token')
  expect(seasons!.url).toBe(`https://www.crunchyroll.com/content/v2/cms/series/${SERIES_ID}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`)
  // the `cr:` id drops the JAJP the API needs: asked by that id, the season answers an empty list
  expect(episodes!.url).toBe(`https://www.crunchyroll.com/content/v2/cms/seasons/${SEASON_ID}JAJP/episodes?preferred_audio_language=ja-JP&locale=en-US`)
  for (const read of [seasons!, episodes!, playheads!]) expect((read.init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  const playheadsUrl = new URL(playheads!.url)
  expect(playheadsUrl.pathname).toBe(`/content/v2/${ACCOUNT_ID}/playheads`)
  // every audio version: an episode watched in the dub is watched
  expect(playheadsUrl.searchParams.get('content_ids')!.split(',').sort()).toEqual([
    'GDUBEP001', 'GDUBEP002', 'GDUBEP003', 'GDUBEP004', 'GJAEP0001', 'GJAEP0002', 'GJAEP0003', 'GJAEP0004', 'GJAEPRECAP',
  ])
  expect(asked).toHaveLength(4)
})

test('the token and the account it names never leave the page that asked', async () => {
  const answer = await readWatched(SEASON, fakeCrunchyroll().send)
  expect(JSON.stringify(answer)).not.toContain(ACCESS_TOKEN)
  expect(JSON.stringify(answer)).not.toContain(ACCOUNT_ID)
})

test('signed out it reads nothing more, and answers what the token call said', async () => {
  const { send, asked } = fakeCrunchyroll({ signedIn: false })
  expect(await readWatched(SEASON, send)).toEqual({ status: 400, body: SIGNED_OUT })
  expect(asked).toHaveLength(1)
})

// Crunchyroll's error bodies carry no `data`, which read as an empty list would say nothing was watched
test('a read answering anything but a list is a failure, never a season with nothing watched', async () => {
  await expect(readWatched(SEASON, fakeCrunchyroll({ playheads: { __class__: 'error', code: 'rate_limited' } }).send))
    .rejects.toThrow('Crunchyroll answered with no list')
  const missing = fakeCrunchyroll()
  const refusing = async (url: string, init: RequestInit) =>
    url.includes('/playheads') ? { status: 403, ok: false, json: async () => ({}) } : missing.send(url, init)
  await expect(readWatched(SEASON, refusing)).rejects.toThrow('Crunchyroll answered 403')
})

test('a season its series no longer lists is a failure, never a season with nothing watched', async () => {
  const { send } = fakeCrunchyroll({ seasons: { total: 0, data: [], meta: {} } })
  await expect(readWatched(SEASON, send)).rejects.toThrow('Crunchyroll lists no such season')
})

test('a long season asks its playheads a part at a time, and an episode in a later part still counts', async () => {
  const numbers = Array.from({ length: 30 }, (_, at) => at + 1)
  const episode = (number: number) => ({
    id: `GJA${number}`,
    episode_number: number,
    versions: [{ audio_locale: 'ja-JP', guid: `GJA${number}`, original: true }, { audio_locale: 'en-US', guid: `GDUB${number}`, original: false }],
  })
  const { send, asked } = fakeCrunchyroll({
    episodes: { ...SEASON_EPISODES, data: numbers.map(episode) },
    playheads: { ...PLAYHEADS, data: [{ playhead: 1420, content_id: 'GDUB30', fully_watched: true, last_modified: '2026-10-12T12:00:00Z' }] },
  })

  const answer = await readWatched(SEASON, send)

  const parts = asked.filter(({ url }) => url.includes('/playheads')).map(({ url }) => new URL(url).searchParams.get('content_ids')!.split(','))
  expect(parts.length).toBeGreaterThan(1)
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(50)
  expect(parts.flat().sort()).toEqual(numbers.flatMap(number => [`GJA${number}`, `GDUB${number}`]).sort())
  expect(answer.episodes!.filter(({ watched }) => watched)).toEqual([{ number: 30, watched: true }])
})
