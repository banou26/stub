import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, expect, test, vi } from 'vite-plus/test'

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
const graph = vi.hoisted(() => ({ boots: (): Promise<void> => Promise.resolve() }))
vi.mock('../../../src/worker/graph', () => ({ enableGraph: () => graph.boots(), setReadStore: () => {} }))

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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let asked: { uri: string, details?: boolean, site: string }[]
let ended: boolean

beforeEach(() => {
  asked = []
  ended = false
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
