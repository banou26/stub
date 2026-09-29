// The MyAnimeList tracker served the way every provider is, over a fake session on a hand-made
// MyAnimeList (./fake-mal.ts) holding the recorded list rows, and asked the questions the app asks it.
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { CatalogLookup } from '../../../../src/tracking/identity'

import { MAL_WRITE_NOTICE } from '../../../../src/sources/mal/list-api'
import { BLOCKED_PAUSE_MS, WRITE_GAP_MS } from '../../../../src/sources/mal/pacing'
import { CONFIRM_RETRY_MS, FULL_TTL_MS, INDEX_TTL_MS, malTrackerResolvers } from '../../../../src/sources/mal/tracker-resolvers'
import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../../src/worker/tracking-document'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'
import { answerOf, fakeMal, type FakeMalOptions, type RawRow } from './fake-mal'
import { AIR_GEAR, COWBOY_BEBOP, COWBOY_BEBOP_REWATCHING, ERRORS_400, ROWS } from './list-fixtures'

const CATALOGUE = [
  { mal: 1, anilist: 1, kitsu: 1, anidb: 23 },
  { mal: 48, anilist: 48, kitsu: 60, anidb: 1301 },
  { mal: 21, anilist: 21, kitsu: 12, anidb: 69 },
  { mal: 857, anilist: 857, kitsu: 1452, anidb: 4051 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => CATALOGUE.find(row => row[origin] === id) }

const BEBOP = 'ag:(anilist:1)'
const HACK = 'ag:(mal:48)'
const AIR = 'ag:(mal:857)'
const UNLISTED = 'ag:(mal:9999)'

const setup = (options: FakeMalOptions = {}) => {
  let at = 1_790_000_000_000
  const waits: number[] = []
  const mal = fakeMal(options)
  const sites: string[] = []
  const resolvers = malTrackerResolvers({
    now: () => at,
    wait: async ms => {
      waits.push(ms)
      at += ms
    },
  })
  const target = providerServer('mal', resolvers, { catalog: async () => catalog, session: (site: string) => { sites.push(site); return mal.session } })
  return { ...mal, target, waits, sites, advance: (ms: number) => { at += ms } }
}

type Target = ReturnType<typeof setup>['target']

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const watch = (target: Target, uri: string) => {
  const subscription = subscribe(target, TRACKING_DOCUMENT, { input: { uri } })
  live.push(subscription)
  return subscription
}

const answerOfResult = (result: any) => result.data.tracking.answers[0]
const first = async (target: Target, uri: string) => answerOfResult(await watch(target, uri).next())

const save = async (target: Target, uri: string, entry: Record<string, unknown>) =>
  (await yogaClient(target).mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['mal'], entry } }).toPromise()).data.saveListEntry[0]

const remove = async (target: Target, uri: string) =>
  (await yogaClient(target).mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['mal'] } }).toPromise()).data.deleteListEntry[0]

const READ_ALL = ['whoami', 'list 7/1@0', 'list 7/1@7']

// 301 fillers beside the recorded rows: a list over one page, older than every recorded row
const LONG_LIST: RawRow[] = [
  ...ROWS,
  ...Array.from({ length: 301 }, (_, n) => ({ ...AIR_GEAR, anime_id: 100_000 + n, anime_title: `Filler ${String(n).padStart(3, '0')}`, updated_at: 1_000_000_000 + n })),
]

describe('what the MyAnimeList tracker answers', () => {
  test("LISTED with the viewer's own entry, their account, ten points and what a save does", async () => {
    const { target, sites } = setup()
    expect(await first(target, BEBOP)).toMatchObject({
      state: 'LISTED',
      tracker: { id: 'mal', name: 'MyAnimeList', signedIn: true, account: 'viewer', canWrite: true, scoreScale: 'POINT_10', writeNotice: MAL_WRITE_NOTICE },
      entry: { _id: 'mal:viewer:1', mediaUri: 'mal:1', status: 'COMPLETED', progress: 26, score: 100, scoreLabel: '10 / 10', episodeCount: 26, url: 'https://myanimelist.net/anime/1/Cowboy_Bebop' },
    })
    expect(new Set(sites)).toEqual(new Set(['mal']))
  })

  test('NOT_LISTED when the list has no entry for it', async () => {
    const { target } = setup()
    expect(await first(target, UNLISTED)).toMatchObject({ state: 'NOT_LISTED', entry: null, tracker: { signedIn: true, account: 'viewer' } })
  })

  test('SIGNED_OUT when MyAnimeList names nobody, and no list is asked', async () => {
    const { target, log } = setup({ user: null })
    expect(await first(target, BEBOP)).toMatchObject({ state: 'SIGNED_OUT', tracker: { signedIn: false, canWrite: false, account: null } })
    expect(log).toEqual(['whoami'])
  })

  test('SIGNED_OUT when the viewer never connected MyAnimeList here', async () => {
    const { target, state } = setup()
    state.connected = false
    expect((await first(target, BEBOP)).state).toBe('SIGNED_OUT')
  })

  test('finds the MyAnimeList entry of a media known by its AniList id alone', async () => {
    const { target } = setup()
    expect(await first(target, 'ag:(anilist:48)')).toMatchObject({ state: 'LISTED', entry: { mediaUri: 'mal:48', title: '.hack//Sign' } })
  })

  test('AMBIGUOUS with both ids when the media names two MyAnimeList ids, and asks and writes nothing', async () => {
    const { target, log } = setup()
    const uri = 'ag:(mal:1,mal:48)'
    expect(await first(target, uri)).toMatchObject({ state: 'AMBIGUOUS', candidates: ['mal:1', 'mal:48'] })
    expect(await save(target, uri, { progress: 1 })).toMatchObject({ outcome: 'REFUSED', error: expect.stringContaining('mal:1 and mal:48') })
    expect(log).toEqual([])
  })

  // a cluster that welded one run's AniList id to another run's MyAnimeList id, which stub's own tracker
  // answers AMBIGUOUS: keyed on the MyAnimeList id, a save would land on the other run's entry
  test("AMBIGUOUS where stub's own tracker is, and asks and writes nothing", async () => {
    const { target, log } = setup()
    const uri = 'ag:(anilist:1,mal:48,cr:GG5H5XQX4)'
    expect(await first(target, uri)).toMatchObject({ state: 'AMBIGUOUS', candidates: ['anilist:1', 'mal:48'] })
    expect(await save(target, uri, { progress: 5 })).toMatchObject({ outcome: 'REFUSED' })
    expect(await remove(target, uri)).toMatchObject({ outcome: 'REFUSED' })
    expect(log).toEqual([])
  })

  test('the control: a MyAnimeList id beside an AniList id of the same run reads and writes', async () => {
    const { target, log } = setup()
    const uri = 'ag:(anilist:48,mal:48,cr:GG5H5XQX4)'
    expect((await first(target, uri)).state).toBe('LISTED')
    expect(await save(target, uri, { score: 80 })).toMatchObject({ outcome: 'SAVED' })
    expect(log).toContain('write edit')
  })

  test('NO_ID for a media no MyAnimeList id reaches', async () => {
    const { target, log } = setup()
    expect((await first(target, 'ag:(cr:GG5H5XQX4)')).state).toBe('NO_ID')
    expect(log).toEqual([])
  })
})

describe('what reading the list costs', () => {
  test('two media opened in a row cost one read of the list, whole', async () => {
    const { target, log } = setup()
    await first(target, BEBOP)
    await first(target, HACK)
    await first(target, UNLISTED)
    expect(log).toEqual(READ_ALL)
  })

  test('the list is read again once INDEX_TTL_MS has passed, and after a sign in', async () => {
    const { target, log, advance, changed } = setup()
    const tracking = watch(target, BEBOP)
    await tracking.next()

    advance(INDEX_TTL_MS)
    await first(target, HACK)
    expect(log).toEqual([...READ_ALL, ...READ_ALL])

    changed()
    await tracking.next()
    expect(log).toEqual([...READ_ALL, ...READ_ALL, ...READ_ALL])
  })

  test('a signed-out answer is kept too, until INDEX_TTL_MS or a sign in', async () => {
    const { target, log, state, changed } = setup({ user: null })
    const tracking = watch(target, BEBOP)
    expect(answerOfResult(await tracking.next()).state).toBe('SIGNED_OUT')
    expect((await first(target, HACK)).state).toBe('SIGNED_OUT')
    expect(log).toEqual(['whoami'])

    state.user = 'viewer'
    changed()
    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'LISTED', tracker: { account: 'viewer' } })
    expect(log).toEqual(['whoami', ...READ_ALL])
  })

  test("pages the way MyAnimeList's list page does, by the rows each page held, to an empty one", async () => {
    const { target, log } = setup({ pageSize: 3 })
    expect((await first(target, AIR)).state, 'the sixth row by title').toBe('LISTED')
    expect(log).toEqual(['whoami', 'list 7/1@0', 'list 7/1@3', 'list 7/1@6', 'list 7/1@7'])
  })

  test('stops on a page that adds nothing new, where MyAnimeList ignored the offset', async () => {
    const { target, log } = setup({ pageSize: 3, ignoresOffset: true })
    await first(target, BEBOP)
    expect(log).toEqual(['whoami', 'list 7/1@0', 'list 7/1@3'])
  })

  test('a list over one page is brought up to date by its recent page, and read whole after FULL_TTL_MS', async () => {
    const { target, log, advance, row, state } = setup({ rows: LONG_LIST })
    await first(target, BEBOP)
    const whole = ['whoami', 'list 7/1@0', 'list 7/1@300', 'list 7/1@308']
    expect(log).toEqual(whole)

    // changed on myanimelist.net meanwhile
    Object.assign(row(48)!, { score: 9, updated_at: ++state.clock })
    advance(INDEX_TTL_MS)
    expect(await first(target, HACK)).toMatchObject({ entry: { score: 90 } })
    expect(log).toEqual([...whole, 'whoami', 'list 7/5@0'])

    advance(FULL_TTL_MS)
    await first(target, HACK)
    expect(log).toEqual([...whole, 'whoami', 'list 7/5@0', ...whole])
  })

  test('the recent page is not enough when every row on it is newer than the list held', async () => {
    const { target, log, advance, state } = setup({ rows: LONG_LIST })
    await first(target, BEBOP)
    for (const raw of state.rows.values()) raw.updated_at = ++state.clock
    advance(INDEX_TTL_MS)
    await first(target, BEBOP)
    expect(log.slice(4)).toEqual(['whoami', 'list 7/5@0', 'list 7/1@0', 'list 7/1@300', 'list 7/1@308'])
  })

  test('a read the session changed under is never kept, and is made again', async () => {
    const { target, row, holdNext, changed, log } = setup()
    const release = holdNext('list')
    const tracking = watch(target, HACK)
    await vi.waitFor(() => expect(log).toContain('list 7/1@0'))

    // a sign in lands while the first page is on its way, holding what the list was before it
    row(48)!.score = 9
    changed()
    release()

    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'LISTED', entry: { score: 90 } })
    // the first read runs to its end, and is dropped
    expect(log).toEqual([...READ_ALL, ...READ_ALL])
  })
})

describe('what the MyAnimeList tracker writes', () => {
  test('a save goes as edit.json, is read back from the recent page, and the open answer updates with no read of its own', async () => {
    const { target, log, writes } = setup()
    const tracking = watch(target, HACK)
    await tracking.next()

    expect(await save(target, HACK, { status: 'COMPLETED', progress: 26, score: 85 })).toMatchObject({
      tracker: 'mal', outcome: 'SAVED', error: null, entry: { status: 'COMPLETED', score: 80, scoreLabel: '8 / 10' },
    })
    expect(writes()).toEqual([{ user: 'viewer', steps: [{ kind: 'edit', fields: { anime_id: 48, status: 2, num_watched_episodes: 26, score: 8 } }], options: { once: true } }])
    expect(answerOfResult(await tracking.next())).toMatchObject({ entry: { score: 80 } })
    expect(log).toEqual([...READ_ALL, 'write edit', 'list 7/5@0'])
  })

  test('a save of something not listed goes as add.json', async () => {
    const { target, row, writes } = setup()
    expect(await save(target, UNLISTED, { status: 'PLANNING' })).toMatchObject({ outcome: 'SAVED', entry: { status: 'PLANNING', mediaUri: 'mal:9999' } })
    expect(writes()[0]!.steps).toEqual([{ kind: 'add', fields: { anime_id: 9999, status: 6, score: 0, num_watched_episodes: 0 } }])
    expect(row(9999)).toMatchObject({ status: 6 })
  })

  test('a save that changes nothing sends nothing', async () => {
    const { target, log } = setup()
    expect(await save(target, HACK, { status: 'COMPLETED', score: 75 })).toMatchObject({ outcome: 'SAVED', entry: { score: 70 } })
    expect(log).toEqual(READ_ALL)
  })

  test('a save while signed out is refused, saying so, and nothing is written', async () => {
    const { target, log } = setup({ user: null })
    expect(await save(target, HACK, { progress: 1 })).toMatchObject({ outcome: 'REFUSED', error: 'Sign in to MyAnimeList to save to it' })
    expect(log).toEqual(['whoami'])
  })

  test('a date is refused, and nothing is written', async () => {
    const { target, writes } = setup()
    expect(await save(target, HACK, { progress: 3, startedAt: { year: 2026 } })).toMatchObject({ outcome: 'REFUSED', error: 'MyAnimeList takes status, progress and score from stub' })
    expect(writes()).toEqual([])
  })

  test('a list older than FRESH_FOR_WRITE_MS is brought up to date before a save is planned on it', async () => {
    const { target, log, advance } = setup({ rows: LONG_LIST })
    await first(target, HACK)
    advance(61_000)
    await save(target, HACK, { score: 90 })
    expect(log.slice(4)).toEqual(['whoami', 'list 7/5@0', 'write edit', 'list 7/5@0'])
  })

  test('a mismatch says what MyAnimeList shows, and still wakes the open answer with it', async () => {
    const { target } = setup({ ignoresScore: true })
    const tracking = watch(target, HACK)
    await tracking.next()

    expect(await save(target, HACK, { progress: 25, score: 90 })).toMatchObject({ outcome: 'FAILED', error: 'MyAnimeList shows a score of 7 / 10' })
    expect(answerOfResult(await tracking.next())).toMatchObject({ entry: { progress: 25, score: 70 } })
  })

  test('a save the list shows nothing of is looked at once more before it is called failed', async () => {
    const { target, log, waits, script } = setup()
    // MyAnimeList answers the edit and changes nothing
    script.write = ({ steps }) => ({ kind: 'sent', answers: steps.map(() => answerOf('{}')) })
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'FAILED', error: "MyAnimeList's list does not show the save yet" })
    expect(waits).toEqual([CONFIRM_RETRY_MS])
    expect(log.slice(3)).toEqual(['write edit', 'list 7/5@0', 'list 7/5@0'])
  })

  test("a save the recent page does not lead with is looked for in its own list, read whole", async () => {
    // fillers changed after every recorded row, so .hack//Sign is past the recent page
    const rows = LONG_LIST.map(raw => raw.anime_id >= 100_000 ? { ...raw, updated_at: 1_700_000_000 + raw.anime_id } : raw)
    const { target, log } = setup({ rows, keepsUpdatedAt: true })
    await first(target, HACK)
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'SAVED', entry: { score: 90 } })
    expect(log.slice(4)).toEqual(['write edit', 'list 7/5@0', 'list 2/1@0', 'list 2/1@3'])
  })

  test('a write the page lost is not sent again, and the list says whether it arrived', async () => {
    const arrived = setup()
    arrived.interrupt('after')
    expect(await save(arrived.target, HACK, { score: 90 })).toMatchObject({ outcome: 'SAVED', entry: { score: 90 } })
    expect(arrived.writes()).toHaveLength(1)

    const lost = setup()
    lost.interrupt('before')
    expect(await save(lost.target, HACK, { score: 90 })).toMatchObject({ outcome: 'FAILED', error: "MyAnimeList's list does not show the save yet" })
    expect(lost.writes()).toHaveLength(1)
  })

  test('a rewatch starts with the flag alone, then the rest once the list shows the rewatch', async () => {
    const { target, writes, row } = setup()
    expect(await save(target, BEBOP, { status: 'REWATCHING', progress: 1 })).toMatchObject({ outcome: 'SAVED', entry: { status: 'REWATCHING', progress: 1 } })
    expect(writes().map(write => write.steps)).toEqual([
      [{ kind: 'edit', fields: { anime_id: 1, status: 2, is_rewatching: 1 } }],
      [{ kind: 'edit', fields: { anime_id: 1, status: 2, num_watched_episodes: 1 } }],
    ])
    expect(row(1)).toMatchObject({ is_rewatching: 1, num_watched_episodes: 1 })
  })

  test('a rewatch MyAnimeList did not start fails by name, and the rest of the save is not sent', async () => {
    const { target, writes, row } = setup({ ignoresRewatchFlag: true })
    expect(await save(target, BEBOP, { status: 'REWATCHING', progress: 1 })).toMatchObject({ outcome: 'FAILED', error: 'MyAnimeList kept it as Completed, so the rewatch did not start' })
    expect(writes()).toHaveLength(1)
    expect(row(1)).toMatchObject({ status: 2, num_watched_episodes: 26, score: 10 })
  })

  test("a rewatch ends as Completed through MyAnimeList's own finish, then the edit, in one call", async () => {
    const { target, writes, state } = setup({ rows: [COWBOY_BEBOP_REWATCHING as RawRow, ...ROWS.slice(1)] })
    expect(await first(target, BEBOP)).toMatchObject({ entry: { status: 'REWATCHING', progress: 3 } })
    expect(await save(target, BEBOP, { status: 'COMPLETED', progress: 26 })).toMatchObject({ outcome: 'SAVED', entry: { status: 'COMPLETED', progress: 26 } })
    expect(writes().map(write => write.steps.map(step => step.kind))).toEqual([['finish-rewatch', 'edit']])
    expect(state.finishedRewatches).toBe(1)
  })

  test('a save when somebody else signed in writes nothing, and every answer is read again for them', async () => {
    const { target, state, log } = setup()
    const tracking = watch(target, HACK)
    await tracking.next()

    state.user = 'someone'
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'REFUSED', error: 'MyAnimeList is signed in as someone else now; the list is read again' })
    expect(answerOfResult(await tracking.next())).toMatchObject({ tracker: { account: 'someone' } })
    expect(log.filter(line => line.startsWith('write'))).toEqual(['write edit'])
  })

  test("MyAnimeList's refusal of a save is said in its words, and nothing is read back", async () => {
    const { target, script, log } = setup()
    script.write = () => ({ kind: 'sent', answers: [answerOf(ERRORS_400, { status: 400 })] })
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'FAILED', error: 'MyAnimeList answered 400: invalid request' })
    expect(log.slice(3)).toEqual(['write edit'])
  })

  test('saves are spaced WRITE_GAP_MS apart, and the steps of one are not', async () => {
    const { target, waits } = setup({ rows: [COWBOY_BEBOP_REWATCHING as RawRow, ...ROWS.slice(1)] })
    await save(target, BEBOP, { status: 'COMPLETED', progress: 26 })
    expect(waits).toEqual([])
    await save(target, HACK, { score: 90 })
    expect(waits).toEqual([WRITE_GAP_MS])
  })

  test("a delete posts MyAnimeList's delete and reads the entry's list whole to see it gone", async () => {
    const { target, log, row } = setup()
    expect(await remove(target, HACK)).toMatchObject({ tracker: 'mal', outcome: 'SAVED' })
    expect(log.slice(3)).toEqual(['write delete', 'list 2/1@0', 'list 2/1@2'])
    expect(row(48)).toBeUndefined()
  })

  test('a delete of nothing listed is done, and sends nothing', async () => {
    const { target, writes } = setup()
    expect(await remove(target, UNLISTED)).toMatchObject({ outcome: 'SAVED' })
    expect(writes()).toEqual([])
  })

  test('a delete MyAnimeList answered and did not do fails, saying so', async () => {
    const { target } = setup({ ignoresDelete: true })
    expect(await remove(target, HACK)).toMatchObject({ outcome: 'FAILED', error: 'MyAnimeList still lists it' })
  })
})

describe('when MyAnimeList refuses stub', () => {
  test('a refused read answers PAUSED, and is read again only once the pause is over', async () => {
    const { target, script, waits, log } = setup()
    let refused = false
    script.list = () => refused ? undefined : (refused = true, answerOf('', { status: 429, retryAfter: 90 }))
    const tracking = watch(target, HACK)

    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'PAUSED', error: expect.stringContaining('MyAnimeList asked stub to wait until') })
    expect(answerOfResult(await tracking.next()).state).toBe('LISTED')
    expect(waits).toEqual([90_000])
    expect(log).toEqual(['whoami', 'list 7/1@0', 'whoami', 'list 7/1@0', 'list 7/1@7'])
  })

  test('a block page with no Retry-After pauses BLOCKED_PAUSE_MS', async () => {
    const { target, script, waits } = setup()
    let refused = false
    script.whoami = () => refused ? undefined : (refused = true, { kind: 'whoami', status: 403, url: 'https://myanimelist.net/about.php', page: false, user: null, token: false, blocked: true, retryAfter: null })
    const tracking = watch(target, HACK)
    expect(answerOfResult(await tracking.next()).state).toBe('PAUSED')
    expect(answerOfResult(await tracking.next()).state).toBe('LISTED')
    expect(waits).toEqual([BLOCKED_PAUSE_MS])
  })

  test('a refused save fails, saying why, and is not sent again', async () => {
    const { target, script, writes } = setup()
    script.write = () => ({ kind: 'sent', answers: [answerOf('', { status: 429, retryAfter: 60 })] })
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'FAILED', error: expect.stringContaining('asked stub to wait') })
    expect(writes()).toHaveLength(1)
    expect(await save(target, HACK, { score: 90 }), 'nor while the pause holds').toMatchObject({ outcome: 'FAILED', error: expect.stringContaining('asked stub to wait') })
    expect(writes()).toHaveLength(1)
  })

  test('a save MyAnimeList took and then refused to show is saved, and the list read after the pause', async () => {
    const { target, script } = setup()
    const tracking = watch(target, HACK)
    await tracking.next()
    script.list = ({ order }) => order === 5 ? answerOf('', { status: 429 }) : undefined

    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'SAVED', entry: null })
    expect(answerOfResult(await tracking.next()).state).toBe('PAUSED')
  })

  test('a lost write whose check was refused fails, as nothing says it arrived', async () => {
    const { target, script, interrupt } = setup()
    await first(target, HACK)
    interrupt('after')
    script.list = ({ order }) => order === 5 ? answerOf('', { status: 429 }) : undefined
    expect(await save(target, HACK, { score: 90 })).toMatchObject({ outcome: 'FAILED', error: 'MyAnimeList did not confirm the save; it is read again after the pause' })
  })
})
