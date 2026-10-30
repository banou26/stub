import type { AnswerRow } from '../../../src/worker/graph'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test'

import { answer, previewOf } from '../../../src/preview'
import { site } from '../../../src/site'

type Feed = (input: { uri: string, details?: boolean }, site: string) => AsyncGenerator<object>

const feed = vi.hoisted(() => ({ current: undefined as unknown as Feed }))

// the title's media subscription, as the test feeds it, beside the site the copy serves when it is asked
vi.mock('../../../src/worker/resolvers', async () => {
  const served = await import('../../../src/site')
  return {
    resolvers: {
      Subscription: {
        media: {
          subscribe: async function* (_: unknown, { input }: { input: { uri: string, details?: boolean } }) {
            for await (const media of feed.current(input, served.site)) yield { media }
          },
        },
      },
    },
  }
})
const graph = vi.hoisted(() => ({
  boots: (): Promise<void> => Promise.resolve(),
  episodesKept: undefined as boolean | undefined,
  // the copy's answer log, as `exportAnswers` reads it back
  answers: [] as AnswerRow[],
  exports: 0,
}))
vi.mock('../../../src/worker/graph', () => ({
  enableGraph: () => graph.boots(),
  setReadStore: () => {},
  keepEpisodes: (kept: boolean) => { graph.episodesKept = kept },
  exportAnswers: async () => {
    graph.exports++
    return graph.answers
  },
}))

const ROOT = resolve(import.meta.dirname, '../../..')
// the two files vite.preview.config.ts copies beside the build
const WASM = {
  frizbee: new WebAssembly.Module(readFileSync(resolve(ROOT, 'node_modules/frizbee/pkg/frizbee_wasm_bg.wasm'))),
  sacha: new WebAssembly.Module(readFileSync(resolve(ROOT, 'node_modules/sacha/sacha_bg.wasm'))),
}

const media = (title: string, settled = false) => ({
  _id: 'm1', uri: 'ag:(anilist:195604)', origin: 'ag', id: '(anilist:195604)', url: null, handles: [],
  titles: [{ language: 'en', title, score: 1 }], descriptions: [], covers: [{ url: 'https://cover.jpg', color: null }], banners: [], settled,
})

const handle = (origin: string, id: string) => ({ _id: `${origin}:${id}`, uri: `${origin}:${id}`, origin, id, url: null })

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let asked: { uri: string, details?: boolean, site: string }[]
let ended: boolean

const answerRow = (seq: number, origin: string, id: string, raw: object): AnswerRow => ({
  key: `sha-${seq}`, seq, uri: `${origin}:${id}`, origin, kind: 'media', operation: 'MEDIA', selection: Object.keys(raw).sort(), raw: JSON.stringify(raw),
})

/** The lines of what `inbox()` gave, gunzipped. */
const linesOf = (body: ArrayBuffer) => gunzipSync(Buffer.from(body)).toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line))

// a copy boots on its first answer, importing the GraphQL server and the sources, which a loaded run can take longer
// than a test's deadline over
beforeAll(async () => {
  feed.current = async function* () { yield media('', true) }
  await answer('ag:(anilist:1)', 'anime', WASM, { deadline: 60_000 }).first
})

beforeEach(() => {
  asked = []
  ended = false
  graph.answers = []
  graph.exports = 0
  // as the preview build defines them
  vi.stubGlobal('__STUB_VERSION__', '0.0.62')
  vi.stubGlobal('__STUB_COMMIT__', 'bdd2430e')
  // a Worker's zone, which JustWatch reads its offer country off
  vi.stubEnv('TZ', 'UTC')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const feeding = (run: () => AsyncGenerator<object>): Feed => async function* (input, served) {
  asked.push({ ...input, site: served })
  try {
    yield* run()
  } finally {
    ended = true
  }
}

test('first is what is read at the deadline, last what is read once the sources settle', async () => {
  feed.current = feeding(async function* () {
    yield media('Black Clover Second Season')
    await wait(300)
    yield media('Black Clover Season 2', true)
  })
  const { first, last } = answer('ag:(anilist:195604)', 'anime', WASM, { deadline: 100 })
  expect((await first)?.title).toBe('Black Clover Second Season')
  expect((await last)?.title).toBe('Black Clover Season 2')
  expect(asked).toEqual([{ uri: 'ag:(anilist:195604)', details: true, site: 'anime' }])
})

// Mutation: drop `await after`.
test('a copy held back by after asks nothing until it settles, and still ends by settleBy', async () => {
  feed.current = feeding(async function* () {
    yield media('Cowboy Bebop', true)
  })
  const { promise: after, resolve } = Promise.withResolvers<void>()
  const { first } = answer('ag:(offline:mal-1)', 'anime', WASM, { deadline: 60_000, after })
  await wait(50)
  expect(asked).toEqual([])
  resolve()
  expect((await first)?.title).toBe('Cowboy Bebop')
  expect(asked).toEqual([{ uri: 'ag:(offline:mal-1)', details: true, site: 'anime' }])

  const { last } = answer('ag:(offline:mal-1)', 'anime', WASM, { deadline: 60_000, settleBy: 100, after: new Promise(() => {}) })
  expect(await last).toBeUndefined()
})

// Mutation: give `stop` nothing to end.
test('a stopped copy ends as at settleBy, with what was read', async () => {
  feed.current = feeding(async function* () {
    yield media('Kaguya-sama: Love is War')
    await new Promise(() => {})
  })
  const { first, last, stop } = answer('ag:(cr:GRJ0J828Y)', 'anime', WASM, { deadline: 50 })
  await first
  const stoppedAt = performance.now()
  stop()
  expect((await last)?.title).toBe('Kaguya-sama: Love is War')
  expect(performance.now() - stoppedAt).toBeLessThan(2_000)
}, 5_000)

// Mutation: drop the check once `after` settles.
test('a copy stopped while held back never asks', async () => {
  feed.current = feeding(async function* () {
    yield media('Cowboy Bebop', true)
  })
  const { promise: after, resolve } = Promise.withResolvers<void>()
  const { last, stop } = answer('ag:(offline:mal-1)', 'anime', WASM, { deadline: 60_000, after })
  stop()
  resolve()
  expect(await last).toBeUndefined()
  await wait(50)
  expect(asked).toEqual([])
}, 5_000)

test('the copy keeps no episodes, which a preview never draws', async () => {
  feed.current = feeding(async function* () {
    yield media('One Piece', true)
  })
  await answer('ag:(anilist:21)', 'anime', WASM, { deadline: 1_000 }).first
  expect(graph.episodesKept).toBe(false)
})

test('first comes as soon as the sources settle, before the deadline', async () => {
  feed.current = feeding(async function* () {
    yield media('Coyote vs. Acme', true)
    await new Promise(() => {})
  })
  const started = performance.now()
  const { first } = answer('ag:(jw:985864)', 'movie', WASM, { deadline: 10_000 })
  expect((await first)?.title).toBe('Coyote vs. Acme')
  expect(performance.now() - started).toBeLessThan(2_000)
  expect(site).toBe('movie')
})

test('when the sources go quiet without settling, last ends at settleBy with what was read', async () => {
  feed.current = feeding(async function* () {
    yield media('Kaguya-sama: Love is War')
    await new Promise(() => {})
  })
  const started = performance.now()
  const { last } = answer('ag:(cr:GRJ0J828Y)', 'anime', WASM, { deadline: 50, settleBy: 200 })
  expect((await last)?.title).toBe('Kaguya-sama: Love is War')
  expect(performance.now() - started).toBeLessThan(2_000)
}, 5_000)

test('at settleBy the subscription is closed, so the copy asks nothing more', async () => {
  let payloads = 0
  feed.current = feeding(async function* () {
    for (;;) {
      yield media(`Groningen Office ${++payloads}`)
      await wait(20)
    }
  })
  const { last } = answer('ag:(trakt:groningen-office)', 'series', WASM, { deadline: 50, settleBy: 200 })
  expect((await last)?.title).toMatch(/^Groningen Office \d+$/)
  await vi.waitFor(() => expect(ended).toBe(true))
  const closedAt = payloads
  await wait(100)
  expect(payloads).toBe(closedAt)
})

test('once the copy is done its relay calls are stopped, and last waits for what they end to unwind', async () => {
  vi.resetModules()
  const fresh = await import('../../../src/preview')
  const relay = await import('../../../src/preview/fetch')
  vi.stubGlobal('fetch', (_input: string, init?: RequestInit) => new Promise((_, reject) => {
    init?.signal?.throwIfAborted()
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  }))
  try {
    feed.current = feeding(async function* () {
      yield media('One Piece')
      await new Promise(() => {})
    })
    const asking = relay.fetch('https://kitsu.io/api/edge/anime/12/episodes').then(() => 'answered', () => 'stopped')
    const { last } = fresh.answer('ag:(anilist:21)', 'anime', WASM, { deadline: 50, settleBy: 200 })
    const stoppedAt = await asking.then(outcome => [outcome, performance.now()] as const)
    expect(stoppedAt[0]).toBe('stopped')
    expect((await last)?.title).toBe('One Piece')
    expect(performance.now() - stoppedAt[1]).toBeGreaterThanOrEqual(900)
  } finally {
    vi.unstubAllGlobals()
  }
}, 5_000)

test('a settled run\'s inbox holds every media answer its sources gave, dated when it settled, under the card\'s address', async () => {
  const card = {
    ...media('Frieren: Beyond Journey\'s End', true),
    uri: 'ag:(anilist:154587,jw:364792-373583)',
    handles: [{ relation: 'SAME_AS', node: handle('anilist', '154587') }, { relation: 'PART_OF', node: handle('jw', '364792') }],
  }
  feed.current = feeding(async function* () {
    await wait(50)
    yield card
  })
  graph.answers = [
    answerRow(1, 'anilist', '154587', { id: '154587', titles: [] }),
    answerRow(2, 'jw', '364792', { id: '364792', scope: 'CONTAINER' }),
    answerRow(3, 'kitsu', '46474', { id: '46474' }),
  ]
  const asking = Date.now()
  const { last, inbox } = answer('ag:(anilist:154587)', 'anime', WASM, { deadline: 1_000 })
  await last
  const object = (await inbox())!
  expect(object.key).toMatch(/^inbox\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jsonl\.gz$/)
  const lines = linesOf(object.body)
  expect(lines.map(({ index }) => [index.source, index.id, index.region, index.class, index.role, index.partial])).toEqual([
    ['anilist', '154587', null, 'full', 'member', false],
    ['jw', '364792', 'US', 'full', 'related', false],
    ['kitsu', '46474', null, 'full', null, false],
  ])
  expect(lines.map(({ body }) => body.body)).toEqual(graph.answers.map(row => row.raw))
  expect(new Set(lines.map(({ body }) => body.run))).toEqual(new Set([card.uri]))
  expect(new Set(lines.map(({ index }) => JSON.stringify(index.writer)))).toEqual(new Set([JSON.stringify({ by: 'stub-preview', stub: '0.0.62', commit: 'bdd2430e' })]))
  const fetchedAt = Date.parse(lines[0].index.fetchedAt)
  expect(fetchedAt).toBeGreaterThanOrEqual(asking + 50)
  expect(fetchedAt).toBeLessThan(asking + 900)
  expect(object.key.slice(6, 16)).toBe(lines[0].index.fetchedAt.slice(0, 10))
})

test('a run cut at settleBy has its finished sources\' lines marked partial, under the last card\'s address', async () => {
  feed.current = feeding(async function* () {
    yield { ...media('Kaguya-sama: Love is War'), uri: 'ag:(cr:GRJ0J828Y,mal:37999)' }
    await new Promise(() => {})
  })
  graph.answers = [answerRow(1, 'cr', 'GRJ0J828Y', { id: 'GRJ0J828Y' }), answerRow(2, 'mal', '37999', { id: '37999' })]
  const { inbox } = answer('ag:(cr:GRJ0J828Y)', 'anime', WASM, { deadline: 50, settleBy: 200 })
  const lines = linesOf((await inbox())!.body)
  expect(lines.map(({ index }) => [index.source, index.partial])).toEqual([['cr', true], ['mal', true]])
  expect(lines.map(({ body }) => body.run)).toEqual(['ag:(cr:GRJ0J828Y,mal:37999)', 'ag:(cr:GRJ0J828Y,mal:37999)'])
}, 5_000)

test('a run cut before any card came has its sources\' lines under the address asked', async () => {
  feed.current = feeding(async function* () {
    await new Promise(() => {})
    yield media('never sent')
  })
  graph.answers = [answerRow(1, 'anilist', '195604', { id: '195604' })]
  const { last, inbox } = answer('ag:(anilist:195604,mal:61967)', 'anime', WASM, { deadline: 50, settleBy: 200 })
  expect(await last).toBeUndefined()
  const lines = linesOf((await inbox())!.body)
  expect(lines.map(({ index, body }) => [index.source, index.role, index.partial, body.run])).toEqual([['anilist', null, true, 'ag:(anilist:195604,mal:61967)']])
}, 5_000)

test('the answer log is read only when the inbox is asked for, and a run with no media answer has no object', async () => {
  feed.current = feeding(async function* () {
    yield media('Coyote vs. Acme', true)
  })
  const { last, inbox } = answer('ag:(jw:985864)', 'movie', WASM, { deadline: 1_000 })
  await last
  expect(graph.exports).toBe(0)
  expect(await inbox()).toBeUndefined()
  expect(graph.exports).toBe(1)
})

test('a read that fails ends both with what was read, and rejects neither', async () => {
  feed.current = feeding(async function* () {
    yield media('Slow Horses')
    throw new Error('a source failed')
  })
  const { first, last } = answer('ag:(jw:131317)', 'series', WASM, { deadline: 1_000 })
  expect((await last)?.title).toBe('Slow Horses')
  expect((await first)?.title).toBe('Slow Horses')
})

test('a copy that cannot boot ends both with no preview, and rejects neither', async () => {
  vi.resetModules()
  graph.boots = () => Promise.reject(new Error('the engine did not open'))
  try {
    const fresh = await import('../../../src/preview')
    const { first, last } = fresh.answer('ag:(jw:131317)', 'series', WASM, { deadline: 1_000 })
    expect(await last).toBeUndefined()
    expect(await first).toBeUndefined()
  } finally {
    graph.boots = () => Promise.resolve()
  }
})

test('a preview is what the title page draws: the first title, the longest description as text, the banner over the cover', () => {
  expect(previewOf({
    titles: [{ title: 'Black Clover Season 2' }, { title: 'Black Clover 2' }],
    descriptions: [{ description: 'Short.' }, { description: '<p>Asta &amp; Yuno<br>return.</p>' }],
    covers: [{ url: 'https://cover/1.jpg', color: null }, { url: 'https://cover/2.jpg', color: '#f1a143' }],
    banners: [{ url: 'https://banner/1.jpg' }, { url: 'https://banner/2.jpg' }],
  })).toEqual({ title: 'Black Clover Season 2', description: 'Asta & Yuno return.', image: 'https://banner/1.jpg', wide: true, color: '#f1a143' })
  expect(previewOf({ titles: [{ title: 'I Am Love' }], covers: [{ url: 'https://cover/1.jpg' }], banners: [] }))
    .toEqual({ title: 'I Am Love', description: undefined, image: 'https://cover/1.jpg', wide: false, color: undefined })
})

test('a description is cut at 200 characters, and media with no title is no preview', () => {
  expect(previewOf({ titles: [{ title: 'Long' }], descriptions: [{ description: 'word '.repeat(60) }], covers: [], banners: [] })?.description).toBe(`${'word '.repeat(39)}word…`)
  expect(previewOf({ titles: [], covers: [{ url: 'https://cover/1.jpg' }], banners: [] })).toBeUndefined()
  expect(previewOf(undefined)).toBeUndefined()
})
