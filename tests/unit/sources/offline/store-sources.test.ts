// The three sources only the source store keeps (HOR-994): TVmaze's show index, ANN's title report and AnimeThemes'
// catalogue, each asked only on its own change signal and stopped for the run by a back off that runs out. Driven
// against their recorded answers, a fake clock and a fake R2 bucket; nothing is asked of any of them.
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { Kind, parse, type OperationDefinitionNode, type SelectionNode } from 'graphql'
import { expect, test } from 'vite-plus/test'

import { askAnimethemes, askAnn, askTvmaze, daysSince } from '../../../../scripts/offline-history.mjs'
import { keepAnswers, readStore, rowsOf } from '../../../../scripts/source-store.mjs'
import { normalizeThemes } from '../../../../src/sources/animethemes/extractor'
import { fakeBucket } from './fake-bucket'
import { RECORDED_CATALOGUE, RECORDED_SHOWS, anime, annItem, fakeSources, tvmazeShow } from './fake-sources'

const NOW = Date.parse('2026-10-25T05:41:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()
const seconds = (ms: number) => Math.floor(ms / 1000)
const WRITER = { by: 'offline-history', run: '42', stub: '0.0.62', commit: '0dcc4455' }

type Pulled = { answers: { id: string, fetchedAt: string, body: string }[], state?: object, stopped?: string, requests: number }
const ids = (pulled: Pulled) => pulled.answers.map(answer => answer.id)
const sleeper = () => {
  const waits: number[] = []
  return { waits, sleep: async (ms: number) => { waits.push(ms) } }
}

// Mutations: count days by the hour; read a missing date as a recent one.
test('a source\'s next ask counts UTC days begun since its last, and one never asked is always due', () => {
  expect(daysSince(at(NOW), NOW + 18 * HOUR)).toBe(0)
  expect(daysSince(at(NOW), NOW + 19 * HOUR)).toBe(1)
  expect(daysSince(at(NOW + 17 * HOUR), NOW + 20 * HOUR)).toBe(1)
  expect(daysSince(undefined, NOW)).toBe(Infinity)
  expect(daysSince(null, NOW)).toBe(Infinity)
})

// Mutations: start past page 0; stop before the 404; no pause between pages; keep a page's shows reshaped.
test('TVmaze\'s first ask reads its show index from page 0 to the 404 that ends it, half a second apart', async () => {
  const fake = fakeSources()
  fake.shows.set(251, tvmazeShow(251, seconds(NOW)))
  const { waits, sleep } = sleeper()
  const pulled = await askTvmaze({ kept: undefined, rows: async () => new Map(), now: () => NOW, get: fake.get, sleep })
  expect(fake.asked).toEqual(['tvmaze /shows?page=0', 'tvmaze /shows?page=1', 'tvmaze /shows?page=2'])
  expect(waits).toEqual([500, 500])
  expect(ids(pulled)).toEqual(['1', '2', '251'])
  // the show as the index served it, which is also what /shows/1 serves
  expect(pulled.answers[0]).toEqual({ id: '1', fetchedAt: at(NOW), body: JSON.stringify(RECORDED_SHOWS[0]) })
  expect(pulled.state).toEqual({ nextPage: null, askedAt: at(NOW) })
})

// Mutations: retry a 5xx without waiting; keep asking past the last back off; restart the index from page 0; date the
// index by its last page.
test('a 5xx past every back off stops TVmaze\'s index at its page, and its next ask goes on from that page', async () => {
  const fake = fakeSources()
  fake.shows.set(251, tvmazeShow(251, seconds(NOW)))
  fake.shows.set(501, tvmazeShow(501, seconds(NOW)))
  fake.refusing(line => (line === 'tvmaze /shows?page=1' ? 503 : undefined))
  const { waits, sleep } = sleeper()
  const cut = await askTvmaze({ kept: undefined, rows: async () => new Map(), now: () => NOW, get: fake.get, sleep, backoff: [30_000, 60_000] })
  expect(fake.asked).toEqual(['tvmaze /shows?page=0', 'tvmaze /shows?page=1', 'tvmaze /shows?page=1', 'tvmaze /shows?page=1'])
  expect(waits).toEqual([500, 30_000, 60_000])
  expect([ids(cut), cut.state, cut.stopped]).toEqual([['1', '2'], { nextPage: 1, askedAt: at(NOW) }, '503'])

  fake.asked.length = 0
  fake.refusing(() => undefined)
  const rest = await askTvmaze({ kept: cut.state, rows: async () => new Map(), now: () => NOW + DAY, get: fake.get, sleep })
  expect(fake.asked).toEqual(['tvmaze /shows?page=1', 'tvmaze /shows?page=2', 'tvmaze /shows?page=3'])
  // dated from its first page, so the updates list that follows covers every page
  expect([ids(rest), rest.state]).toEqual([['251', '501'], { nextPage: null, askedAt: at(NOW) }])
})

/** The store's TVmaze rows for `shows`, as a first pull of the index keeps them. */
const storedShows = (shows: { id: number }[]) => async () => new Map(shows.map(show => [String(show.id), { id: String(show.id), body: JSON.stringify(show) }]))

// Mutations: ask TVmaze twice the same UTC day; ask every show the list names; skip a show the store lacks; send the
// whole list while the last ask is recent; send the week's list when it is not; date the ask after its shows.
test('after its index, TVmaze is asked once a UTC day for its updates, then only for the shows they date later or the store lacks', async () => {
  const fake = fakeSources()
  const rows = storedShows(RECORDED_SHOWS)
  const kept = { nextPage: null, askedAt: at(NOW) }
  const later = () => askTvmaze({ kept, rows, now: () => NOW + DAY, get: fake.get, sleep: async () => {} })

  expect(await askTvmaze({ kept, rows, now: () => NOW + 18 * HOUR, get: fake.get, sleep: async () => {} })).toBeUndefined()
  expect(fake.asked).toEqual([])

  // control: a day on with nothing changed, the list is asked and no show
  expect(ids((await later())!)).toEqual([])
  expect(fake.asked).toEqual(['tvmaze /updates/shows?since=week'])

  fake.asked.length = 0
  fake.shows.set(2, { ...RECORDED_SHOWS[1]!, updated: seconds(NOW + 12 * HOUR) })
  fake.shows.set(300, tvmazeShow(300, seconds(NOW + 13 * HOUR)))
  // a minute an answer, so each date says which answer it follows
  let clock = NOW + DAY
  const ticking = async (url: string, init?: RequestInit) => {
    clock += 60_000
    return fake.get(url, init)
  }
  const pulled = (await askTvmaze({ kept, rows, now: () => clock, get: ticking, sleep: async () => {} }))!
  expect(fake.asked).toEqual(['tvmaze /updates/shows?since=week', 'tvmaze /shows/2', 'tvmaze /shows/300'])
  expect(pulled.answers.map(answer => [answer.id, answer.fetchedAt])).toEqual([['2', at(NOW + DAY + 120_000)], ['300', at(NOW + DAY + 180_000)]])
  // as of the list, since a show changed while the others were asked is in the next one
  expect(pulled.state).toEqual({ askedAt: at(NOW + DAY) })

  // with no complete ask yet, or one 6 UTC days back, the whole list, in which show 1 is dated as stored
  for (const askedAt of [null, at(NOW - 5 * DAY)]) {
    fake.asked.length = 0
    await askTvmaze({ kept: { nextPage: null, askedAt }, rows, now: () => NOW + DAY, get: fake.get, sleep: async () => {} })
    expect(fake.asked).toEqual(['tvmaze /updates/shows', 'tvmaze /shows/2', 'tvmaze /shows/300'])
  }
})

// Mutations: ask every changed show in one run; move askedAt when shows were left; stop TVmaze on a show's 404.
test('TVmaze is asked for 1,000 shows a run at most, the rest the next run, and a show gone since the list is skipped', async () => {
  const fake = fakeSources()
  for (let id = 1_000; id <= 2_000; id++) fake.shows.set(id, tvmazeShow(id, seconds(NOW)))
  const kept = { nextPage: null, askedAt: at(NOW - DAY) }
  fake.refusing(line => (line === 'tvmaze /shows/1000' ? 404 : undefined))
  const first = (await askTvmaze({ kept, rows: storedShows(RECORDED_SHOWS), now: () => NOW, get: fake.get, sleep: async () => {} }))!
  expect(fake.asked.filter(line => line.startsWith('tvmaze /shows/'))).toHaveLength(1_000)
  expect([first.answers.length, first.answers[0]!.id, first.answers.at(-1)!.id, first.state]).toEqual([999, '1001', '1999', undefined])

  fake.asked.length = 0
  const withFirst = storedShows([...RECORDED_SHOWS, ...first.answers.map(answer => JSON.parse(answer.body))])
  const second = (await askTvmaze({ kept, rows: withFirst, now: () => NOW + HOUR, get: fake.get, sleep: async () => {} }))!
  // the show that answered 404 is listed again, so it is asked again
  expect(fake.asked).toEqual(['tvmaze /updates/shows?since=week', 'tvmaze /shows/1000', 'tvmaze /shows/2000'])
  expect([ids(second), second.state]).toEqual([['2000'], { askedAt: at(NOW + HOUR) }])
})

// Mutations: ask the whole report every day; ask 50 titles whatever the days missed; keep a short whole report.
test('ANN\'s report is asked whole once, then once a UTC day for 50 titles per day since, as its API page asks', async () => {
  const fake = fakeSources()
  const short = await askAnn({ kept: undefined, now: () => NOW, get: fake.get, sleep: async () => {} })
  expect([fake.asked, short.answers, short.state, short.stopped]).toEqual([['ann /encyclopedia/reports.xml?id=155&type=anime&nlist=all'], [], undefined, 'only 3 titles'])

  for (let id = 1; fake.titles.length < 10_000; id++) fake.titles.push(annItem(id))
  fake.asked.length = 0
  const whole = await askAnn({ kept: undefined, now: () => NOW, get: fake.get, sleep: async () => {} })
  expect([whole.answers.length, whole.state]).toEqual([10_000, { askedAt: at(NOW) }])
  expect(whole.answers[0]).toEqual({ id: '40725', fetchedAt: at(NOW), body: fake.titles[0] })

  const kept = { askedAt: at(NOW) }
  expect(await askAnn({ kept, now: () => NOW + 18 * HOUR, get: fake.get, sleep: async () => {} })).toBeUndefined()
  fake.asked.length = 0
  const daily = await askAnn({ kept, now: () => NOW + DAY, get: fake.get, sleep: async () => {} })
  const missed = await askAnn({ kept, now: () => NOW + 3 * DAY, get: fake.get, sleep: async () => {} })
  expect(fake.asked).toEqual(['ann /encyclopedia/reports.xml?id=155&type=anime&nlist=50', 'ann /encyclopedia/reports.xml?id=155&type=anime&nlist=150'])
  expect([daily.answers.length, missed.answers.length, daily.state]).toEqual([50, 150, { askedAt: at(NOW + DAY) }])
})

// Mutations: retry a 429 without waiting; keep asking past the last back off.
test('ANN answering 429 past every back off is stopped for the run, after each wait', async () => {
  const fake = fakeSources()
  fake.refusing(() => 429)
  const { waits, sleep } = sleeper()
  const pulled = await askAnn({ kept: { askedAt: at(NOW - DAY) }, now: () => NOW, get: fake.get, sleep, backoff: [30_000, 60_000, 120_000, 240_000] })
  expect([fake.asked.length, waits, pulled.stopped, pulled.state]).toEqual([5, [30_000, 60_000, 120_000, 240_000], '429', undefined])
})

// Mutation: take a request that failed before any answer as the answer, with no wait and no second ask.
test('a request that fails before any answer is asked again after the back off', async () => {
  const fake = fakeSources()
  let failed = false
  const flaky = async (url: string, init?: RequestInit) => {
    if (failed) return fake.get(url, init)
    failed = true
    throw new TypeError('fetch failed')
  }
  const { waits, sleep } = sleeper()
  const pulled = await askAnn({ kept: { askedAt: at(NOW - DAY) }, now: () => NOW, get: flaky, sleep, backoff: [30_000, 60_000] })
  expect([waits, pulled.requests, ids(pulled), pulled.state]).toEqual([[30_000], 2, ['40725', '40716', '40715'], { askedAt: at(NOW) }])
})

// Mutations: pull the catalogue more than once a week; stop before the last page; mark a cut pull done; keep the data
// of a page GraphQL answered with errors.
test('AnimeThemes\' catalogue is pulled whole every 7 UTC days, 100 a page, and a pull cut short is not done', async () => {
  const fake = fakeSources()
  for (let id = 3; id <= 150; id++) fake.catalogue.set(id, anime(id))
  const { waits, sleep } = sleeper()
  const pulled = await askAnimethemes({ kept: undefined, now: () => NOW, get: fake.get, sleep })
  expect(fake.asked).toEqual(['animethemes / page 1', 'animethemes / page 2'])
  expect(waits).toEqual([1_000])
  expect([pulled.answers.length, pulled.answers[0]!.id, pulled.state]).toEqual([150, '1', { askedAt: at(NOW) }])
  expect(JSON.parse(pulled.answers[0]!.body)).toEqual(RECORDED_CATALOGUE.data.animePagination.data[0])

  const kept = { askedAt: at(NOW) }
  fake.asked.length = 0
  expect(await askAnimethemes({ kept, now: () => NOW + 6 * DAY, get: fake.get, sleep })).toBeUndefined()
  expect(fake.asked).toEqual([])

  fake.refusing(line => (line === 'animethemes / page 2' ? 500 : undefined))
  const cut = await askAnimethemes({ kept, now: () => NOW + 7 * DAY, get: fake.get, sleep, backoff: [1] })
  expect([fake.asked, cut.answers.length, cut.state, cut.stopped]).toEqual([['animethemes / page 1', 'animethemes / page 2', 'animethemes / page 2'], 100, undefined, '500'])

  const failing = async () => Response.json({ errors: [{ message: 'Max query complexity should be 10000 but got 15000.' }], data: { animePagination: { paginatorInfo: { hasMorePages: false }, data: [anime(1)] } } })
  const refused = await askAnimethemes({ kept: undefined, now: () => NOW, get: failing, sleep })
  expect([refused.answers, refused.state, refused.stopped]).toEqual([[], undefined, 'Max query complexity should be 10000 but got 15000.'])
})

// Mutation: go on past a page with no anime.
test('an AnimeThemes page with no anime ends the pull, whatever it says of more pages', async () => {
  let requests = 0
  const endless = async () => {
    // a pull that went on would ask this forever, so a third request ends the test
    if (++requests > 2) throw new Error('asked past a page with no anime')
    return Response.json({ data: { animePagination: { paginatorInfo: { hasMorePages: true }, data: [] } } })
  }
  const pulled = await askAnimethemes({ kept: undefined, now: () => NOW, get: endless, sleep: async () => {}, backoff: [] })
  expect([requests, pulled.answers, pulled.state]).toEqual([1, [], { askedAt: at(NOW) }])
})

/** Each field a query selects under `root`, as a dotted path. */
const fieldPaths = (query: string, root: string[]) => {
  const paths: string[] = []
  const walk = (selections: readonly SelectionNode[], path: string[]) => {
    for (const selection of selections) {
      if (selection.kind !== Kind.FIELD) continue
      const next = [...path, selection.name.value]
      paths.push(next.join('.'))
      if (selection.selectionSet) walk(selection.selectionSet.selections, next)
    }
  }
  walk((parse(query).definitions[0] as OperationDefinitionNode).selectionSet.selections, [])
  const prefix = `${root.join('.')}.`
  return paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
}

// Mutation: ask the catalogue for less than the animethemes source's own query.
test('a kept AnimeThemes anime holds every field the animethemes source asks, and the ids that join it to a show', async () => {
  const fake = fakeSources()
  let sent = ''
  const get = async (url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string).query
    return fake.get(url, init)
  }
  const pulled = await askAnimethemes({ kept: undefined, now: () => NOW, get, sleep: async () => {} })
  const own = /const QUERY = `([\s\S]*?)`/.exec(readFileSync(new URL('../../../../src/sources/animethemes/extractor.ts', import.meta.url), 'utf8'))![1]!
  // control: the source's own selection is read, down to its video links
  expect(fieldPaths(own, ['findAnimeByExternalSite'])).toContain('animethemes.animethemeentries.videos.nodes.link')
  const catalogue = fieldPaths(sent, ['animePagination', 'data'])
  expect(fieldPaths(own, ['findAnimeByExternalSite']).filter(path => !catalogue.includes(path))).toEqual([])
  expect(catalogue).toContain('resources.nodes.externalId')
  const hack = JSON.parse(pulled.answers[0]!.body)
  expect(normalizeThemes(hack)[0]).toMatchObject({ kind: 'OP', title: expect.any(String), video: expect.stringMatching(/^https:\/\//) })
  expect(hack.resources.nodes.find((resource: { site: string }) => resource.site === 'MAL')).toMatchObject({ externalId: 299 })
})

const lines = (bytes: Buffer) => zstdDecompressSync(bytes).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

// Mutations: move changedAt on an unchanged answer; keep one changedAt on a changed one; drop a source's state; write
// a pull's state over the entry when the pull brought none.
test('each source\'s answers keep their changedAt while unchanged and move it when changed, and its next ask is in its manifest entry', async () => {
  const bucket = fakeBucket()
  const fake = fakeSources()
  for (let id = 1; fake.titles.length < 10_000; id++) fake.titles.push(annItem(id))
  const pull = async (now: number) => {
    const stored = await readStore(bucket.client)
    const options = { now: () => now, get: fake.get, sleep: async () => {} }
    const tvmaze = await askTvmaze({ ...options, kept: stored.manifest.job.tvmaze, rows: () => rowsOf(bucket.client, stored.manifest.job.tvmaze) })
    const ann = await askAnn({ ...options, kept: stored.manifest.job.ann })
    const animethemes = await askAnimethemes({ ...options, kept: stored.manifest.job.animethemes })
    const pulls = Object.fromEntries(Object.entries({ tvmaze, ann, animethemes }).filter(([, pulled]) => pulled))
    await keepAnswers(bucket.client, stored, { pulls, writer: WRITER })
    return readStore(bucket.client)
  }
  const dates = (store: Awaited<ReturnType<typeof readStore>>, source: string, id: string) => {
    const line = store.index.get([source, id, null, 'full'].join('\t'))
    return [line.fetchedAt, line.changedAt]
  }

  const first = await pull(NOW)
  expect(first.manifest.job.tvmaze).toMatchObject({ rows: 2, nextPage: null, askedAt: at(NOW) })
  expect(first.manifest.job.ann).toMatchObject({ rows: 10_000, askedAt: at(NOW) })
  expect(first.manifest.job.animethemes).toMatchObject({ rows: 2, askedAt: at(NOW) })
  const kept = lines(bucket.objects.get(first.manifest.job.ann.name)!)
  expect(kept[0]).toEqual({ source: 'ann', id: '1', form: 'upstream', type: 'text/xml', sha256: expect.any(String), body: annItem(1) })

  // a day on: TVmaze's list dates show 2 later while its copy is the same, and show 1 changed; ANN renamed a title
  fake.listedAt.set(2, seconds(NOW + HOUR))
  fake.shows.set(1, { ...RECORDED_SHOWS[0]!, name: 'Under the Dome (2013)', updated: seconds(NOW + HOUR) })
  fake.titles[1] = fake.titles[1]!.replace('Energy Kyōka!!', 'Energy Kyouka!!')
  const second = await pull(NOW + DAY)
  expect([dates(second, 'tvmaze', '1'), dates(second, 'tvmaze', '2')]).toEqual([[at(NOW + DAY), at(NOW + DAY)], [at(NOW + DAY), at(NOW)]])
  expect([dates(second, 'ann', '40716'), dates(second, 'ann', '40725'), dates(second, 'ann', '9000')]).toEqual([[at(NOW + DAY), at(NOW + DAY)], [at(NOW + DAY), at(NOW)], [at(NOW), at(NOW)]])
  // AnimeThemes was not due, so its lines and its date stay
  expect(dates(second, 'animethemes', '1')).toEqual([at(NOW), at(NOW)])
  expect(second.manifest.job.tvmaze.askedAt).toBe(at(NOW + DAY))
  expect(second.manifest.job.animethemes).toEqual(first.manifest.job.animethemes)

  // a week on, AnimeThemes again: anime 2 changed, anime 1 did not
  fake.catalogue.set(2, { ...RECORDED_CATALOGUE.data.animePagination.data[1], slug: 'hackroots-tv' })
  const week = await pull(NOW + 7 * DAY)
  expect([dates(week, 'animethemes', '1'), dates(week, 'animethemes', '2')]).toEqual([[at(NOW + 7 * DAY), at(NOW)], [at(NOW + 7 * DAY), at(NOW + 7 * DAY)]])

  // TVmaze's list asked and refused: its entry keeps the date of its last complete ask
  fake.refusing(line => (line.startsWith('tvmaze ') ? 503 : undefined))
  const refused = await pull(NOW + 8 * DAY)
  expect(refused.manifest.job.tvmaze).toEqual(week.manifest.job.tvmaze)
})
