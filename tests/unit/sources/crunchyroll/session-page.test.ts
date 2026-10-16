// The page script's half, as it runs inside a page at www.crunchyroll.com: what it asks Crunchyroll for
// one season and what it writes there, against a fake fetch answering as ./watched-fixtures.ts says.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import type { Asked } from './watched-fixtures'

import { readWatched, saveWatched } from '../../../../src/sources/crunchyroll/session-page'
import {
  ACCESS_TOKEN, ACCOUNT_ID, PLAYHEADS, SEASON_EPISODES, SEASON_ID, SERIES_ID, SIGNED_OUT, fakeCrunchyroll, throughRelay,
} from './watched-fixtures'

const SEASON = { seriesId: SERIES_ID, seasonId: SEASON_ID }
const BASE = 'https://www.crunchyroll.com'

const pathOf = ({ url }: Asked) => new URL(url).pathname
// every request ends in its own `_=<nonce>`
const bare = (url: string) => url.replace(/[?&]_=[^&]+$/, '')
const heads = (...watched: string[]) => ({ ...PLAYHEADS, data: watched.map(content_id => ({ playhead: 1420, content_id, fully_watched: true })) })

describe('a read', () => {
  test("finds the season in its series as the source does, then reads its episodes and their playheads, the series' stars and Watchlist, with the viewer's own token", async () => {
    const { send, asked } = fakeCrunchyroll()
    const answer = await readWatched(SEASON, send)

    expect(answer).toEqual({ status: 200, body: null, held: { progress: 2, stars: null, watchlisted: false } })
    const byPath = (path: string) => bare(asked.find(request => pathOf(request) === path)!.url)
    expect(pathOf(asked[0]!)).toBe('/auth/v1/token')
    expect(byPath(`/content/v2/cms/series/${SERIES_ID}/seasons`)).toBe(`${BASE}/content/v2/cms/series/${SERIES_ID}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`)
    // the `cr:` id drops the JAJP the API needs: asked by that id, the season answers an empty list
    expect(byPath(`/content/v2/cms/seasons/${SEASON_ID}JAJP/episodes`)).toBe(`${BASE}/content/v2/cms/seasons/${SEASON_ID}JAJP/episodes?preferred_audio_language=ja-JP&locale=en-US`)
    expect(byPath(`/content-reviews/v3/user/${ACCOUNT_ID}/rating/series/${SERIES_ID}`)).toBe(`${BASE}/content-reviews/v3/user/${ACCOUNT_ID}/rating/series/${SERIES_ID}`)
    expect(byPath(`/content/v2/${ACCOUNT_ID}/watchlist`)).toBe(`${BASE}/content/v2/${ACCOUNT_ID}/watchlist?content_ids=${SERIES_ID}`)
    const playheads = new URL(byPath(`/content/v2/${ACCOUNT_ID}/playheads`))
    // every audio version: an episode watched in the dub is watched
    expect(playheads.searchParams.get('content_ids')!.split(',').sort()).toEqual([
      'GDUBEP001', 'GDUBEP002', 'GDUBEP003', 'GDUBEP004', 'GJAEP0001', 'GJAEP0002', 'GJAEP0003', 'GJAEP0004', 'GJAEPRECAP',
    ])
    for (const request of asked.slice(1)) expect(request.authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(asked).toHaveLength(6)
    expect(new Set(asked.map(({ url }) => new URL(url).searchParams.get('_') ?? 'none')).size, 'a nonce of its own on each').toBe(6)
  })

  test('progress is the last episode fully watched, counted in the season, wherever Crunchyroll numbers it from', async () => {
    const episode = (number: number) => ({ id: `GJA${number}`, episode_number: number, versions: null })
    const { send } = fakeCrunchyroll({ episodes: { ...SEASON_EPISODES, data: [25, 26, 27, 28, 29].map(episode) }, playheads: heads('GJA25', 'GJA27') })
    expect((await readWatched(SEASON, send)).held).toMatchObject({ progress: 3 })
  })

  test("the series' stars and its place on the Watchlist", async () => {
    const { send } = fakeCrunchyroll({ stars: '4s', watchlisted: true, playheads: heads() })
    expect((await readWatched(SEASON, send)).held).toEqual({ progress: 0, stars: 4, watchlisted: true })
  })

  test('a series its rating read answers 404 for is unrated, and the episodes still read', async () => {
    const site = fakeCrunchyroll()
    const answering = (status: number) => async (url: string, init: RequestInit) => url.includes('/content-reviews/')
      ? { status, ok: false, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } }
      : site.send(url, init)
    expect((await readWatched(SEASON, answering(404))).held).toEqual({ progress: 2, stars: null, watchlisted: false })
    await expect(readWatched(SEASON, answering(500)), 'the control: any other refusal').rejects.toThrow('Crunchyroll answered 500')
  })

  test('the token and the account it names never leave the page that asked', async () => {
    for (const answer of [await readWatched(SEASON, fakeCrunchyroll().send), await saveWatched({ ...SEASON, progress: 4, stars: 2, watchlist: true }, fakeCrunchyroll().send)]) {
      expect(JSON.stringify(answer)).not.toContain(ACCESS_TOKEN)
      expect(JSON.stringify(answer)).not.toContain(ACCOUNT_ID)
    }
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
    const { send, asked } = fakeCrunchyroll({ episodes: { ...SEASON_EPISODES, data: numbers.map(episode) }, playheads: heads('GDUB30') })

    const answer = await readWatched(SEASON, send)

    const parts = asked.filter(({ url }) => url.includes('/playheads')).map(({ url }) => new URL(url).searchParams.get('content_ids')!.split(','))
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(50)
    expect(parts.flat().sort()).toEqual(numbers.flatMap(number => [`GJA${number}`, `GDUB${number}`]).sort())
    expect(answer.held!.progress).toBe(30)
  })
})

describe('a save', () => {
  const marked = (writes: Asked[]) => writes.map(request => {
    expect(request).toMatchObject({ method: 'POST', authorization: `Bearer ${ACCESS_TOKEN}` })
    expect(request.init.body).toBeUndefined()
    return pathOf(request)
  })
  const markOf = (id: string) => `/content/v2/discover/${ACCOUNT_ID}/mark_as_watched/${id}`

  test('raising progress marks each numbered episode up to it that no audio version has watched, the Japanese one, one per call', async () => {
    // watched: 1 in Japanese and 2 in the dub, so 3 and 4 are left; the recap has no number
    const { send, writes } = fakeCrunchyroll()
    expect(await saveWatched({ ...SEASON, progress: 4 }, send)).toEqual({ status: 200, body: null })
    expect(marked(writes())).toEqual([markOf('GJAEP0003'), markOf('GJAEP0004')])
  })

  test('an episode skipped before the new progress is marked too, and one past it is not', async () => {
    const { send, writes } = fakeCrunchyroll({ playheads: heads('GDUBEP002') })
    await saveWatched({ ...SEASON, progress: 3 }, send)
    expect(marked(writes())).toEqual([markOf('GJAEP0001'), markOf('GJAEP0003')])
  })

  test('the progress it already holds marks nothing', async () => {
    const { send, writes } = fakeCrunchyroll()
    expect(await saveWatched({ ...SEASON, progress: 2 }, send)).toEqual({ status: 200, body: null })
    expect(writes()).toEqual([])
  })

  test('a progress past the numbered episodes writes nothing and says how many there are', async () => {
    const { send, writes } = fakeCrunchyroll()
    expect(await saveWatched({ ...SEASON, progress: 5, stars: 3, watchlist: true }, send)).toEqual({ status: 200, body: null, refused: 'Crunchyroll lists 4 episodes of this season' })
    expect(writes()).toEqual([])
  })

  test('a lower progress writes nothing, since Crunchyroll has no unmark, and says so', async () => {
    const { send, writes } = fakeCrunchyroll()
    expect(await saveWatched({ ...SEASON, progress: 1, stars: 3 }, send)).toEqual({ status: 200, body: null, refused: 'Crunchyroll cannot unmark an episode' })
    expect(writes()).toEqual([])
  })

  test('a mark Crunchyroll refuses stops there and fails the save; one it already holds (409) counts as done', async () => {
    const failing = fakeCrunchyroll({ playheads: heads(), marks: id => id === 'GJAEP0002' ? 500 : 200 })
    await expect(saveWatched({ ...SEASON, progress: 4 }, failing.send)).rejects.toThrow('Crunchyroll answered 500')
    expect(failing.writes().map(pathOf)).toEqual([markOf('GJAEP0001'), markOf('GJAEP0002')])

    const held = fakeCrunchyroll({ playheads: heads(), marks: id => id === 'GJAEP0002' ? 409 : 200 })
    await saveWatched({ ...SEASON, progress: 3 }, held.send)
    expect(held.writes().map(pathOf)).toEqual([markOf('GJAEP0001'), markOf('GJAEP0002'), markOf('GJAEP0003')])
  })

  test("stars rate the series, 1s to 5s, with the one PUT the site's own star sends to set them and to change them", async () => {
    const rating = `${BASE}/content-reviews/v2/user/${ACCOUNT_ID}/rating/series/${SERIES_ID}`
    for (const [stars, held] of [[4, ''], [2, '4s']] as const) {
      const site = fakeCrunchyroll({ stars: held })
      await saveWatched({ ...SEASON, stars }, site.send)
      expect(site.writes(), `${stars} on ${held || 'no rating'}`).toMatchObject([{ method: 'PUT', authorization: `Bearer ${ACCESS_TOKEN}`, body: { rating: `${stars}s` } }])
      expect(bare(site.writes()[0]!.url)).toBe(rating)
    }

    for (const [stars, held] of [[4, '4s'], [null, '']] as const) {
      const same = fakeCrunchyroll({ stars: held })
      expect(await saveWatched({ ...SEASON, stars }, same.send), `${stars} on ${held || 'no rating'}`).toEqual({ status: 200, body: null })
      expect(same.writes(), `${stars} on ${held || 'no rating'}`).toEqual([])
    }
  })

  // the site's DELETE removes a thumb, its rating in the body; sent with no body on a series' stars it answered 409
  test('a rating once given is never taken off, since Crunchyroll has no request that does: clearing it writes nothing and says so', async () => {
    const { send, writes } = fakeCrunchyroll({ stars: '4s' })
    expect(await saveWatched({ ...SEASON, stars: null, progress: 3, watchlist: true }, send)).toEqual({ status: 200, body: null, refused: 'Crunchyroll cannot remove a rating' })
    expect(writes()).toEqual([])
  })

  test('the Watchlist takes the series on and off as its own button does, and only when it changes', async () => {
    const added = fakeCrunchyroll()
    await saveWatched({ ...SEASON, watchlist: true }, added.send)
    expect(added.writes()).toMatchObject([{ method: 'POST', body: { content_id: SERIES_ID } }])
    expect(bare(added.writes()[0]!.url)).toBe(`${BASE}/content/v2/${ACCOUNT_ID}/watchlist`)

    const removed = fakeCrunchyroll({ watchlisted: true })
    await saveWatched({ ...SEASON, watchlist: false }, removed.send)
    expect(removed.writes()).toMatchObject([{ method: 'DELETE' }])
    expect(bare(removed.writes()[0]!.url)).toBe(`${BASE}/content/v2/${ACCOUNT_ID}/watchlist/${SERIES_ID}`)

    for (const watchlist of [true, false]) {
      const same = fakeCrunchyroll({ watchlisted: watchlist })
      await saveWatched({ ...SEASON, watchlist }, same.send)
      expect(same.writes(), String(watchlist)).toEqual([])
    }
  })

  test('signed out it writes nothing, and answers what the token call said', async () => {
    const { send, asked } = fakeCrunchyroll({ signedIn: false })
    expect(await saveWatched({ ...SEASON, progress: 4, stars: 5, watchlist: true }, send)).toEqual({ status: 400, body: SIGNED_OUT })
    expect(asked).toHaveLength(1)
  })
})

// The FKN relay answers a GET or a POST it has seen from its cache, keyed on the whole request, the token
// included. Nothing says Crunchyroll never grants the same token twice, so the page's own nonce is what
// tells two requests apart.
describe('through the relay', () => {
  // in a page at the site, as on the cloud, every token call carries the site's own device id
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://www.crunchyroll.com' })
    vi.stubGlobal('document', { cookie: 'device_id=the-sites-own-device' })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('a read after a reload, or after a save, reaches Crunchyroll and holds what it holds now', async () => {
    const site = fakeCrunchyroll()
    const relay = throughRelay(site.send)
    expect((await readWatched(SEASON, relay)).held).toEqual({ progress: 2, stars: null, watchlisted: false })

    // rated and put on the Watchlist on crunchyroll.com itself, then stub reloaded
    Object.assign(site.state, { stars: '4s', watchlisted: true })
    const before = site.asked.length
    expect((await readWatched(SEASON, relay)).held).toEqual({ progress: 2, stars: 4, watchlisted: true })
    expect(site.asked.length - before, 'every request of the read').toBe(6)

    await saveWatched({ ...SEASON, stars: 3, watchlist: false }, relay)
    expect((await readWatched(SEASON, relay)).held).toEqual({ progress: 2, stars: 3, watchlisted: false })
  })

  test('every write reaches Crunchyroll, one the same as an earlier one included', async () => {
    const site = fakeCrunchyroll()
    const relay = throughRelay(site.send)
    for (const watchlist of [true, false, true]) await saveWatched({ ...SEASON, watchlist }, relay)
    expect(site.writes().map(({ method, body }) => [method, body])).toEqual([
      ['POST', { content_id: SERIES_ID }],
      ['DELETE', undefined],
      ['POST', { content_id: SERIES_ID }],
    ])
    expect(site.state.watchlisted).toBe(true)
  })
})
