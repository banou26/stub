// How the MyAnimeList tracker reads MyAnimeList's answers and plans its writes, on the site's recorded
// rows (./list-fixtures.ts says which are hand-made).
import { describe, expect, test } from 'vitest'

import type { MalPageAnswer } from '../../../../src/sources/mal/session-page'

import {
  MAL_WRITE_NOTICE, listEntryOf, malScore, malTracker, mismatchOf, planWrite, readListPage, readWhoAmI, readWriteAnswer,
  replaceLists, rowOf, showsNoChange, statusOf, upsertRows, type MalListRow,
} from '../../../../src/sources/mal/list-api'
import { onScale } from '../../../../src/tracking/score-scale'
import { scoreText } from '../../../../src/tracking/sync'
import {
  AIR_GEAR, A_CHANNEL, BLEACH, CLANNAD, COWBOY_BEBOP, COWBOY_BEBOP_REWATCHING, ERRORS_400, HACK_SIGN, ONE_PIECE, ROWS,
} from './list-fixtures'

const row = (raw: unknown) => rowOf(raw)!

const answer = (text: string, { status = 200, url = 'https://myanimelist.net/animelist/viewer/load.json', retryAfter = null }: Partial<MalPageAnswer> = {}): MalPageAnswer =>
  ({ kind: 'answer', status, url, text, retryAfter })

describe('a list row', () => {
  test('reads every status MyAnimeList serves into stub\'s words', () => {
    expect(ROWS.map(raw => [raw.anime_id, statusOf(row(raw))])).toEqual([
      [1, 'COMPLETED'], [21, 'WATCHING'], [48, 'COMPLETED'], [2167, 'COMPLETED'], [269, 'PAUSED'], [857, 'DROPPED'], [9776, 'PLANNING'],
    ])
  })

  test('is REWATCHING only with status 2 and the flag set, and the recorded "" is no flag', () => {
    expect(row(COWBOY_BEBOP).rewatching, 'is_rewatching "" as recorded').toBe(false)
    expect(statusOf(row(COWBOY_BEBOP_REWATCHING))).toBe('REWATCHING')
    expect(statusOf(row({ ...COWBOY_BEBOP, is_rewatching: '1' }))).toBe('REWATCHING')
    expect(statusOf(row({ ...ONE_PIECE, is_rewatching: 1 })), 'the flag counts only beside status 2').toBe('WATCHING')
    expect(row({ ...ONE_PIECE, is_rewatching: 1 }).rewatching, 'though the raw flag is kept').toBe(true)
  })

  test('a count of 0 is one MyAnimeList does not know yet, and an unreadable row is skipped', () => {
    expect(row(ONE_PIECE)).toMatchObject({ progress: 623, episodes: null })
    expect(row(AIR_GEAR)).toMatchObject({ progress: 18, episodes: 25 })
    expect(rowOf({ anime_title: 'no id' })).toBeUndefined()
    expect(rowOf(null)).toBeUndefined()
  })

  test("as a stub entry: the score both ways, MyAnimeList's own count and page, and no dates", () => {
    expect(listEntryOf('viewer', row(HACK_SIGN))).toEqual({
      _id: 'mal:viewer:48',
      tracker: 'mal',
      mediaUri: 'mal:48',
      status: 'COMPLETED',
      progress: 26,
      score: 70,
      scoreLabel: '7 / 10',
      startedAt: null,
      completedAt: null,
      rewatchCount: null,
      updatedAt: new Date(1173289779 * 1_000).toISOString(),
      url: 'https://myanimelist.net/anime/48/hack__Sign',
      title: '.hack//Sign',
      cover: HACK_SIGN.anime_image_path,
      episodeCount: 26,
    })
    expect(listEntryOf('viewer', row(CLANNAD)), 'a score of 0 is no score').toMatchObject({ score: null, scoreLabel: null })
  })

  test('the tracker names the viewer, keeps ten points and says what a save does', () => {
    expect(malTracker('viewer')).toMatchObject({ id: 'mal', name: 'MyAnimeList', signedIn: true, canWrite: true, account: 'viewer', scoreScale: 'POINT_10', writeNotice: MAL_WRITE_NOTICE })
    expect(malTracker()).toMatchObject({ signedIn: false, canWrite: false, account: null })
    expect(malTracker('viewer').keeps, 'no date and no rewatch count, which planWrite refuses').toEqual(['STATUS', 'PROGRESS', 'SCORE'])
    expect(MAL_WRITE_NOTICE).toContain('public by default')
    expect(MAL_WRITE_NOTICE).toContain('counts one finished rewatch')
  })
})

describe('what an answer says', () => {
  test('a list page is its rows', () => {
    expect(readListPage(answer(JSON.stringify(ROWS)))).toEqual({ kind: 'data', data: ROWS.map(row) })
  })

  // B5: a list carries text the viewer wrote, and a note must never pause the tracker
  test('a JSON list whose notes say "Request blocked" is the list, and the same words in HTML are a block', () => {
    const noted = [{ ...BLEACH, notes: 'Request blocked by my little brother', editable_notes: 'Request blocked by my little brother' }]
    expect(readListPage(answer(JSON.stringify(noted)))).toMatchObject({ kind: 'data', data: [{ animeId: 269 }] })
    expect(readListPage(answer('<html><body>Request blocked</body></html>'))).toEqual({ kind: 'blocked', retryAfter: null })
  })

  test("MyAnimeList's JSON refusal is an error in its own words", () => {
    expect(readListPage(answer(ERRORS_400, { status: 400 }))).toEqual({ kind: 'error', message: 'MyAnimeList answered 400: invalid request' })
  })

  test('a 429, a 403 page and a 200 that is not JSON are all read as blocked, with any Retry-After', () => {
    expect(readListPage(answer('', { status: 429, retryAfter: 120 }))).toEqual({ kind: 'blocked', retryAfter: 120 })
    expect(readListPage(answer('<html>Forbidden</html>', { status: 403 }))).toEqual({ kind: 'blocked', retryAfter: null })
    expect(readListPage(answer('<html>Just a moment...</html>'))).toEqual({ kind: 'blocked', retryAfter: null })
    expect(readListPage(answer('<html>Bad gateway</html>', { status: 502 })), 'the control: an outage is an error').toEqual({ kind: 'error', message: 'MyAnimeList answered 502' })
  })

  test('a list that ended on the sign-in page is signed out', () => {
    expect(readListPage(answer('<html></html>', { url: 'https://myanimelist.net/login.php?error=login_required' }))).toEqual({ kind: 'signed-out' })
  })

  test('who the session is', () => {
    const whoami = { kind: 'whoami', status: 200, url: 'https://myanimelist.net/about.php', page: true, user: 'viewer', token: true, blocked: false, retryAfter: null } as const
    expect(readWhoAmI(whoami)).toEqual({ kind: 'data', data: 'viewer' })
    expect(readWhoAmI({ ...whoami, user: null })).toEqual({ kind: 'signed-out' })
    expect(readWhoAmI({ ...whoami, page: false, user: null })).toMatchObject({ kind: 'error' })
    expect(readWhoAmI({ ...whoami, blocked: true, retryAfter: 30 })).toEqual({ kind: 'blocked', retryAfter: 30 })
  })

  test("a write's 2xx is accepted without reading its body, and its refusals read as the list's do", () => {
    const notesPage = '<html>the list page, with a note: Request blocked</html>'
    expect(readWriteAnswer(answer(notesPage, { url: 'https://myanimelist.net/animelist/viewer' }))).toEqual({ kind: 'data', data: null })
    expect(readWriteAnswer(answer(ERRORS_400, { status: 400 }))).toEqual({ kind: 'error', message: 'MyAnimeList answered 400: invalid request' })
    expect(readWriteAnswer(answer('<html>Forbidden</html>', { status: 403 }))).toMatchObject({ kind: 'blocked' })
    expect(readWriteAnswer(answer('', { status: 429, retryAfter: 60 }))).toEqual({ kind: 'blocked', retryAfter: 60 })
    expect(readWriteAnswer(answer('', { url: 'https://myanimelist.net/login.php' }))).toEqual({ kind: 'signed-out' })
    expect(readWriteAnswer(answer('<html>Not Found</html>', { status: 404 }))).toEqual({ kind: 'error', message: 'MyAnimeList answered 404' })
  })
})

describe('a score on ten points', () => {
  test('rounds down, never below 1, and 0 or none is no score', () => {
    expect(malScore(85), "AniList's POINT_10 rule, not MAL-Sync's rounding").toBe(8)
    expect(malScore(89)).toBe(8)
    expect(malScore(100)).toBe(10)
    expect(malScore(5)).toBe(1)
    expect(malScore(0)).toBe(0)
    expect(malScore(null)).toBe(0)
    expect(malScore(undefined)).toBe(0)
  })

  // a sync writes onScale(score, the tracker's scale) and shows scoreText of it: MyAnimeList has to
  // read that back as the same score and the same words, for every score a source can hold
  test("every score a sync shows for MyAnimeList is the one it reads back, in the preview's words", () => {
    const { scoreScale } = malTracker('viewer')
    for (let score = 1; score <= 100; score++) {
      const sent = onScale(score, scoreScale)
      const plan = planWrite(1, undefined, { status: 'COMPLETED', score: sent })
      const step = 'phases' in plan ? plan.phases[0]!.steps[0] : undefined
      const back = listEntryOf('viewer', row({ ...COWBOY_BEBOP, score: step?.kind === 'add' ? step.fields.score : undefined }))
      expect([score, back.score, back.scoreLabel]).toEqual([score, sent, scoreText(sent, scoreScale)])
    }
  })
})

describe('the writes a save takes', () => {
  const hack = row(HACK_SIGN) // COMPLETED, 26 of 26, score 7
  const airGear = row(AIR_GEAR) // DROPPED, 18 of 25, score 6
  const onePiece = row(ONE_PIECE) // WATCHING, 623, no count
  const rewatching = row(COWBOY_BEBOP_REWATCHING) // REWATCHING, 3 of 26, score 10

  test('an edit sends the status and the named fields only', () => {
    expect(planWrite(857, airGear, { progress: 20 })).toEqual({
      phases: [{ steps: [{ kind: 'edit', fields: { anime_id: 857, status: 4, num_watched_episodes: 20 } }], expect: { status: 'DROPPED', progress: 20 } }],
    })
    expect(planWrite(857, airGear, { status: 'WATCHING', score: 85 })).toEqual({
      phases: [{ steps: [{ kind: 'edit', fields: { anime_id: 857, status: 1, score: 8 } }], expect: { status: 'WATCHING', score: 8 } }],
    })
    expect(planWrite(857, airGear, { score: null }), 'a named null clears the score').toMatchObject({ phases: [{ steps: [{ fields: { score: 0 } }] }] })
  })

  test("an add carries all four keys MyAnimeList's own add sends, and needs a status", () => {
    expect(planWrite(9999, undefined, { status: 'PLANNING' })).toEqual({
      phases: [{ steps: [{ kind: 'add', fields: { anime_id: 9999, status: 6, score: 0, num_watched_episodes: 0 } }], expect: { status: 'PLANNING', progress: 0, score: 0 } }],
    })
    expect(planWrite(9999, undefined, { status: 'WATCHING', progress: 2, score: 70 })).toMatchObject({
      phases: [{ steps: [{ kind: 'add', fields: { anime_id: 9999, status: 1, score: 7, num_watched_episodes: 2 } }] }],
    })
    expect(planWrite(9999, undefined, { progress: 2 })).toEqual({ error: 'Pick a status to add it to MyAnimeList' })
  })

  test('a save that changes nothing sends nothing', () => {
    expect(planWrite(48, hack, { status: 'COMPLETED', progress: 26, score: 75 })).toEqual({ noop: true })
    expect(planWrite(48, hack, {})).toEqual({ noop: true })
    expect(planWrite(48, hack, { score: 80 }), 'the control').toMatchObject({ phases: [{}] })
  })

  // B2: no MyAnimeList client sends is_rewatching to edit.json, so a rewatch starts only on a completed
  // entry, the flag alone first, where MyAnimeList ignoring it changes nothing
  test('a rewatch starts on a completed entry with the flag alone, then the named fields', () => {
    expect(planWrite(48, hack, { status: 'REWATCHING' })).toEqual({
      phases: [{ steps: [{ kind: 'edit', fields: { anime_id: 48, status: 2, is_rewatching: 1 } }], expect: { status: 'REWATCHING' } }],
    })
    expect(planWrite(48, hack, { status: 'REWATCHING', progress: 1 })).toEqual({
      phases: [
        { steps: [{ kind: 'edit', fields: { anime_id: 48, status: 2, is_rewatching: 1 } }], expect: { status: 'REWATCHING' } },
        { steps: [{ kind: 'edit', fields: { anime_id: 48, status: 2, num_watched_episodes: 1 } }], expect: { status: 'REWATCHING', progress: 1 } },
      ],
    })
  })

  test('a rewatch starts nowhere else', () => {
    const refusal = { error: 'MyAnimeList starts a rewatch on a completed entry: save it as Completed first' }
    expect(planWrite(21, onePiece, { status: 'REWATCHING' }), 'from watching').toEqual(refusal)
    expect(planWrite(269, row(BLEACH), { status: 'REWATCHING' }), 'from paused').toEqual(refusal)
    expect(planWrite(9999, undefined, { status: 'REWATCHING' }), 'not listed').toEqual(refusal)
  })

  test("a rewatch ends as Completed through MyAnimeList's own finish, then the named fields", () => {
    expect(planWrite(1, rewatching, { status: 'COMPLETED', progress: 26 })).toEqual({
      phases: [{
        steps: [{ kind: 'finish-rewatch', animeId: 1 }, { kind: 'edit', fields: { anime_id: 1, status: 2, num_watched_episodes: 26 } }],
        expect: { status: 'COMPLETED', progress: 26 },
      }],
    })
  })

  // B3: leaving a rewatch any other way would leave the flag set under that status
  test('a rewatch does not end as anything else', () => {
    for (const status of ['WATCHING', 'PAUSED', 'DROPPED', 'PLANNING'] as const) {
      expect(planWrite(1, rewatching, { status })).toEqual({ error: 'MyAnimeList ends a rewatch as Completed: save it as Completed, or change it on myanimelist.net' })
    }
  })

  test('an edit of a rewatch keeps it one, leaving the flag out as the list page does', () => {
    expect(planWrite(1, rewatching, { progress: 4 })).toEqual({
      phases: [{ steps: [{ kind: 'edit', fields: { anime_id: 1, status: 2, num_watched_episodes: 4 } }], expect: { status: 'REWATCHING', progress: 4 } }],
    })
  })

  test('a flag left under another status refuses Completed and a rewatch, and allows the rest', () => {
    const stray = row({ ...BLEACH, is_rewatching: 1 })
    expect(planWrite(269, stray, { status: 'COMPLETED' })).toEqual({ error: 'MyAnimeList keeps a rewatch flag on this entry: change it on myanimelist.net' })
    expect(planWrite(269, stray, { status: 'REWATCHING' })).toMatchObject({ error: expect.stringContaining('rewatch flag') })
    expect(planWrite(269, stray, { status: 'WATCHING' })).toMatchObject({ phases: [{ steps: [{ fields: { status: 1 } }] }] })
  })

  test("progress past MyAnimeList's own count is refused, and a count it does not know refuses nothing", () => {
    expect(planWrite(857, airGear, { progress: 26 })).toEqual({ error: 'MyAnimeList counts 25 episodes for this anime' })
    expect(planWrite(21, onePiece, { progress: 1200 })).toMatchObject({ phases: [{}] })
  })

  test('dates and the rewatch count are refused, a null one too, and nothing is half written', () => {
    const refusal = { error: 'MyAnimeList takes status, progress and score from stub' }
    expect(planWrite(857, airGear, { progress: 20, startedAt: { year: 2026, month: 9, day: 1 } })).toEqual(refusal)
    expect(planWrite(857, airGear, { progress: 20, completedAt: null })).toEqual(refusal)
    expect(planWrite(857, airGear, { rewatchCount: 0 })).toEqual(refusal)
  })

  test('a progress or a score that is not a whole number is refused', () => {
    expect(planWrite(857, airGear, { progress: 1.5 })).toMatchObject({ error: expect.stringContaining('whole number') })
    expect(planWrite(857, airGear, { score: 101 })).toMatchObject({ error: expect.stringContaining('0 to 100') })
  })
})

describe('whether the list shows a save', () => {
  const before = row(HACK_SIGN)
  const at = (changes: Partial<MalListRow>): MalListRow => ({ ...before, ...changes })

  test('matching what was asked is no mismatch', () => {
    expect(mismatchOf({ status: 'COMPLETED', score: 8 }, at({ score: 8 }), before)).toBeUndefined()
  })

  test('says what MyAnimeList shows instead', () => {
    expect(mismatchOf({ status: 'WATCHING', progress: 3 }, at({ status: 3, progress: 2 }), before)).toBe('MyAnimeList shows it as Paused, 2 episodes')
    expect(mismatchOf({ status: 'COMPLETED', score: 8 }, at({ score: 0, progress: 25 }), before)).toBe('MyAnimeList shows no score')
  })

  test('an entry just as it was, or none at all, does not show the save yet', () => {
    expect(mismatchOf({ status: 'COMPLETED', score: 8 }, before, before)).toBe("MyAnimeList's list does not show the save yet")
    expect(showsNoChange(before, before)).toBe(true)
    expect(mismatchOf({ status: 'PLANNING' }, undefined, undefined)).toBe("MyAnimeList's list does not show this entry after the save")
    expect(showsNoChange(undefined, undefined)).toBe(true)
    expect(showsNoChange(at({ score: 8 }), before), 'the control').toBe(false)
  })

  test('a rewatch start MyAnimeList ignored says so', () => {
    expect(mismatchOf({ status: 'REWATCHING' }, before, before)).toBe('MyAnimeList kept it as Completed, so the rewatch did not start')
  })
})

describe('the rows the tracker holds', () => {
  const held = replaceLists(undefined, [7], ROWS.map(row))

  test('a whole read holds every row, and the newest updated_at', () => {
    expect([...held.rows.keys()]).toEqual([1, 21, 48, 2167, 269, 857, 9776])
    expect(held.watermark).toBe(1618868682)
  })

  test('rows read afresh replace their own and raise the watermark', () => {
    const next = upsertRows(held, [{ ...row(BLEACH), status: 2, updatedAt: 1790000000 }])
    expect(next.rows.get(269)!.status).toBe(2)
    expect(next.rows.size).toBe(7)
    expect(next.watermark).toBe(1790000000)
    expect(held.rows.get(269)!.status, 'the rows held before are left as they were').toBe(3)
  })

  test("a list read whole drops that list's rows it no longer serves, and no other list's", () => {
    const completed = replaceLists(held, [2], [row(COWBOY_BEBOP), row(HACK_SIGN)])
    expect(completed.rows.has(2167), 'Clannad left the completed list').toBe(false)
    expect(completed.rows.has(269), 'Bleach is paused, not read').toBe(true)
    expect(completed.rows.size).toBe(6)
  })

  test('a rewatch is dropped only once both lists that may serve it were read', () => {
    const withRewatch = upsertRows(held, [row(COWBOY_BEBOP_REWATCHING)])
    expect(replaceLists(withRewatch, [2], [row(HACK_SIGN), row(CLANNAD)]).rows.has(1)).toBe(true)
    expect(replaceLists(withRewatch, [1, 2], [row(HACK_SIGN), row(CLANNAD), row(ONE_PIECE)]).rows.has(1)).toBe(false)
  })

  test('the recorded A-Channel with no dates reads like any row', () => {
    expect(row(A_CHANNEL)).toMatchObject({ animeId: 9776, status: 6, progress: 0, episodes: 12 })
  })
})
