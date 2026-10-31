// The media subscription's `settled`, driven through the app's own resolver against fake sources: the
// sources are what the page waits on before it says a media has no episodes.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { ASK_BOUND_MS, askEntry, openFanout, type FanoutEntry, type Settling } from '../../../src/worker/fanout'
import { emit } from '../../../src/worker/store/events'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

type Source = FanoutEntry & { end: () => void }
const source = (name: string): Source => {
  const sinks: ((result: unknown) => void)[] = []
  return {
    name,
    end: () => { for (const sink of sinks) sink({ data: { media: null }, hasNext: false }) },
    client: { subscription: () => ({ subscribe: sink => { sinks.push(sink); return { unsubscribe: () => {} } } }) },
  }
}
// the sources asked at subscribe time, and those asked once the media is found under their origin
const sources = vi.hoisted(() => ({ asked: [] as unknown[], byOrigin: {} as Record<string, unknown> }))
// the address the store answers the media under, which the resolver re-asks newly named origins on
const cluster = vi.hoisted(() => ({ uri: 'ag:(anilist:1)' }))
// the graph read store, off unless a test turns it on: `rows` stands in for the rows a pass folds in
const graph = vi.hoisted(() => ({
  on: false,
  rows: 0,
  address: async () => '',
  show: async () => '',
  pass: async (): Promise<unknown> => null,
  // what a read waits on after it has read the rows
  reading: async () => {},
}))
// the similar consumer: by default it asks nothing, as for a cluster with no show-level link
type Ask = (origin: string, input: unknown) => Promise<unknown>
type Deps = { ask: Ask, wait?: () => void }
const similar = vi.hoisted(() => ({
  run: async (_cluster: unknown, _root: unknown, _deps: Deps) => {},
  answer: async (): Promise<unknown> => ({ outcome: 'refused', reason: 'null' }),
}))
// every read of the media, counted
const reads = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../../src/worker/extractor', () => ({
  implementsSimilarMedia: () => true,
  similarOutcomeFrom: () => () => similar.answer(),
  proxyRequestToExtractors: (_ctx: unknown, _operation: unknown, _extract: unknown, settling: Settling) => {
    const fanout = openFanout({ entries: sources.asked as Source[], query: 'Q', variables: {}, settling })
    return {
      subscriptions: fanout.subscriptions,
      askOrigins: (origins: string[]) => {
        for (const origin of origins) {
          const entry = sources.byOrigin[origin] as Source | undefined
          if (entry) askEntry(fanout, entry, {})
        }
      },
      root: { rootId: 'root' },
      close: () => {},
    }
  },
}))
vi.mock('../../../src/worker/graph', async original => ({
  ...await original<object>(),
  readStore: () => graph.on ? 'graph' : 'legacy',
  createMediaReader: () => ({
    read: async () => {
      const rows = graph.rows
      await graph.reading()
      return { _id: 'cl:1', uri: cluster.uri, categories: ['ANIME'], rows }
    },
    wakes: () => true,
  }),
  askAddressOf: () => graph.address(),
  followedShowAddress: () => graph.show(),
  passSettled: () => graph.pass(),
}))
vi.mock('../../../src/worker/store/db', async original => ({
  ...await original<object>(),
  findMediaForPage: async () => { reads.count++; return [{ uri: 'anilist:1' }] },
}))
vi.mock('../../../src/worker/similar-consumer', () => ({ resolveSimilarRuns: (cluster: unknown, root: unknown, deps: Deps) => similar.run(cluster, root, deps) }))
vi.stubGlobal('location', new URL('http://localhost/'))
vi.mock('../../../src/worker/store/aggregate', async original => ({
  ...await original<object>(),
  aggregateMedia: () => ({ _id: cluster.uri, uri: cluster.uri, categories: ['ANIME'] }),
}))

const { resolvers } = await import('../../../src/worker/resolvers/media/index')

const open = () => {
  const controller = new AbortController()
  const ctx = { request: { signal: controller.signal }, params: { query: 'Q', variables: { input: { uri: 'ag:(anilist:1)' } } } }
  const answers = (resolvers.Subscription.media.subscribe as any)(undefined, { input: { uri: 'ag:(anilist:1)' } }, ctx) as AsyncGenerator<{ settled: boolean, rows?: number }>
  const answer = async () => (await answers.next()).value!
  return { answer, next: async () => (await answer()).settled, close: () => { controller.abort(); void answers.return(undefined as never) } }
}

const opened: ReturnType<typeof open>[] = []
afterEach(() => {
  while (opened.length) opened.pop()!.close()
  sources.asked = []
  sources.byOrigin = {}
  cluster.uri = 'ag:(anilist:1)'
  Object.assign(graph, { on: false, rows: 0, address: async () => '', show: async () => '', pass: async () => null, reading: async () => {} })
  similar.run = async () => {}
  similar.answer = async () => ({ outcome: 'refused', reason: 'null' })
  reads.count = 0
  vi.useRealTimers()
})

const quiet = () => new Promise(resolve => setTimeout(resolve, 50))

// well under ASK_BOUND_MS, so no test here can pass on the bound settling an ask its answer should have
describe('the media subscription', { timeout: 5_000 }, () => {
  test('reports settled once every source asked has answered for the last time', async () => {
    const [anilist, anizip] = sources.asked = [source('anilist'), source('anizip')]
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)

    anilist!.end()
    anizip!.end()
    expect(await media.next()).toBe(true)
  })

  test('is not settled while one source is still out', async () => {
    const [anilist] = sources.asked = [source('anilist'), source('anizip')]
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)

    anilist!.end()
    const next = media.next()
    expect(await Promise.race([next, new Promise(resolve => setTimeout(() => resolve('nothing'), 50))])).toBe('nothing')
  })

  test('settles after the bound when a source never answers', async () => {
    vi.useFakeTimers()
    const [anilist] = sources.asked = [source('anilist'), source('never')]
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)
    anilist!.end()

    const next = media.next()
    await vi.advanceTimersByTimeAsync(ASK_BOUND_MS - 1)
    expect(await Promise.race([next, Promise.resolve('nothing')])).toBe('nothing')
    await vi.advanceTimersByTimeAsync(1)
    expect(await next).toBe(true)
  })

  test('a similar ask made on the media\'s behalf holds it until that source answers', async () => {
    const [anilist] = sources.asked = [source('anilist')]
    let answer: (outcome: unknown) => void = () => {}
    similar.answer = () => new Promise(resolve => { answer = resolve })
    let asked = false
    similar.run = async (_cluster, _root, deps) => {
      if (asked) return
      asked = true
      await deps.ask('cr', { showId: 'G1' })
    }
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)
    anilist!.end()
    const next = media.next()
    await quiet()
    expect(await Promise.race([next, Promise.resolve('nothing')]), 'Crunchyroll has not answered').toBe('nothing')

    answer({ outcome: 'refused', reason: 'null' })
    expect(await next).toBe(true)
  })

  test('goes quiet once settled: what a read starts never wakes the next read', async () => {
    const [anilist] = sources.asked = [source('anilist')]
    // a similar consumer with nothing left to ask, as on every read after its pairs have settled
    similar.run = async () => {}
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)
    anilist!.end()
    expect(await media.next()).toBe(true)

    const settledAt = reads.count
    const next = media.next()
    await quiet()
    expect(await Promise.race([next, Promise.resolve('nothing')]), 'no answer without a change').toBe('nothing')
    expect(reads.count - settledAt).toBe(0)
  })

  test('a source the media is newly found under holds it until that source answers', async () => {
    const [anilist] = sources.asked = [source('anilist')]
    const kitsu = source('kitsu')
    sources.byOrigin = { kitsu }
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)

    // AniList's answer names the media's Kitsu id, so the read it wakes asks Kitsu
    cluster.uri = 'ag:(anilist:1,kitsu:1)'
    anilist!.end()
    expect(await media.next(), 'Kitsu has not answered').toBe(false)
    kitsu.end()
    expect(await media.next()).toBe(true)
  })

  test('a similar ask the settling read plans past an await of its own holds the media', async () => {
    const [anilist] = sources.asked = [source('anilist')]
    let answer: (outcome: unknown) => void = () => {}
    similar.answer = () => new Promise(resolve => { answer = resolve })
    let asked = false
    // as the real consumer does, which reads the store before it asks, and here first asks on the read the settle wakes
    similar.run = async (_cluster, _root, deps) => {
      if (asked || reads.count < 2) return
      asked = true
      await new Promise(resolve => setTimeout(resolve, 1))
      await deps.ask('cr', { showId: 'G1' })
    }
    const media = open()
    opened.push(media)
    expect(await media.next()).toBe(false)

    anilist!.end()
    expect(await media.next(), 'Crunchyroll has not answered').toBe(false)
    answer({ outcome: 'refused', reason: 'null' })
    expect(await media.next()).toBe(true)
  })

  describe('on the graph store', () => {
    test('a placeholder\'s source, asked past an await, holds the media', async () => {
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      const kitsu = source('kitsu')
      sources.byOrigin = { kitsu }
      const media = open()
      opened.push(media)
      expect(await media.next()).toBe(false)

      // the cluster's claims name a Kitsu entry no source has described, found by a read of the graph
      graph.address = async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return 'ag:(anilist:1,kitsu:1)'
      }
      anilist!.end()
      expect(await media.next(), 'Kitsu has not answered').toBe(false)
      kitsu.end()
      expect(await media.next()).toBe(true)
    })

    // Mutation: drop the `followedShowAddress` ask and JustWatch is never asked, so the media settles without it.
    test('a source only the followed show names is asked and holds the media', async () => {
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      const jw = source('jw')
      sources.byOrigin = { jw }
      const media = open()
      opened.push(media)
      expect(await media.next()).toBe(false)

      // the page is drawn as the run, whose address names no JustWatch id; its show does
      graph.show = async () => 'ag:(anilist:1,jw:1)'
      anilist!.end()
      expect(await media.next(), 'JustWatch has not answered').toBe(false)
      jw.end()
      expect(await media.next()).toBe(true)
    })

    test('a similar answer holds the media until the consumer has claimed it, which joins its episodes', async () => {
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      let claim = () => {}
      let asked = false
      similar.run = async (_cluster, _root, deps) => {
        if (asked) return
        asked = true
        await deps.ask('nf', { showId: '81511410' })
        // the consumer checks Netflix's season against the cluster before it writes the claim
        await new Promise<void>(resolve => { claim = resolve })
        graph.rows = 1
      }
      const media = open()
      opened.push(media)
      expect(await media.answer()).toMatchObject({ settled: false })

      anilist!.end()
      const next = media.answer()
      await quiet()
      expect(await Promise.race([next, Promise.resolve('nothing')]), 'Netflix\'s season is not claimed').toBe('nothing')
      claim()
      expect(await next).toMatchObject({ settled: true, rows: 1 })
    })

    test('a similar ask another page has in flight holds the media until that page\'s consumer has claimed it', async () => {
      graph.on = true
      let driver: Promise<void> | undefined
      let claimed = false
      let claim = () => {}
      // as `drive` does: the first run asks, a run that finds that ask in flight waits it out, and a
      // claimed pair asks nothing
      similar.run = async (_cluster, _root, deps) => {
        if (claimed) return
        if (driver) {
          deps.wait?.()
          return driver
        }
        driver = (async () => {
          await deps.ask('nf', { showId: '81511410' })
          await new Promise<void>(resolve => { claim = resolve })
          graph.rows = 1
          claimed = true
          driver = undefined
        })()
        return driver
      }
      sources.asked = [source('anilist')]
      const title = open()
      expect(await title.answer()).toMatchObject({ settled: false })
      // Play on the title page: it closes, and the watch page asks its own sources
      title.close()
      const [anilist] = sources.asked = [source('anilist')]
      const watch = open()
      opened.push(watch)
      expect(await watch.answer()).toMatchObject({ settled: false })

      anilist!.end()
      const next = watch.answer()
      await quiet()
      expect(await Promise.race([next, Promise.resolve('nothing')]), 'Netflix\'s season is not claimed').toBe('nothing')
      claim()
      expect(await next).toMatchObject({ settled: true, rows: 1 })
    })

    test('a read under way as the last ask ends is not the settled one, and the read after it is', async () => {
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      const media = open()
      opened.push(media)
      expect(await media.answer()).toMatchObject({ settled: false, rows: 0 })

      // a read woken by a pass, which has read the rows when AniList's answer ends and its rows land
      let read = () => {}
      graph.reading = () => new Promise<void>(resolve => { read = resolve })
      emit('view:changed', { clusters: ['cl:1'], uris: ['anilist:1'] })
      const next = media.answer()
      await quiet()
      graph.reading = async () => {}
      anilist!.end()
      graph.rows = 1
      read()
      expect(await next, 'the rows it read are from before the answer').toMatchObject({ settled: false, rows: 0 })
      expect(await media.answer()).toMatchObject({ settled: true, rows: 1 })
    })

    test('a consumer that never finishes still settles the media at the bound', async () => {
      vi.useFakeTimers()
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      let asked = false
      similar.run = async (_cluster, _root, deps) => {
        if (asked) return
        asked = true
        await deps.ask('nf', { showId: '81511410' })
        await new Promise(() => {})
      }
      const media = open()
      opened.push(media)
      expect(await media.next()).toBe(false)

      anilist!.end()
      const next = media.next()
      await vi.advanceTimersByTimeAsync(ASK_BOUND_MS - 1)
      expect(await Promise.race([next, Promise.resolve('nothing')])).toBe('nothing')
      await vi.advanceTimersByTimeAsync(1)
      expect(await next).toBe(true)
    })

    test('a media nothing more is asked about settles on the read its last answer wakes, with no time passing', async () => {
      vi.useFakeTimers()
      graph.on = true
      const [anilist, justwatch] = sources.asked = [source('anilist'), source('jw')]
      const media = open()
      opened.push(media)
      expect(await media.next()).toBe(false)

      anilist!.end()
      justwatch!.end()
      expect(await media.next()).toBe(true)
    })

    test('the settled answer is read after the pass that folds the last answers in', async () => {
      graph.on = true
      const [anilist] = sources.asked = [source('anilist')]
      const media = open()
      opened.push(media)
      expect(await media.answer()).toMatchObject({ settled: false, rows: 0 })

      // AniList's answer is written, and its rows wait on a pass still to run
      graph.pass = () => new Promise(resolve => setTimeout(() => { graph.rows = 1; resolve(null) }, 10))
      anilist!.end()
      expect(await media.answer()).toMatchObject({ settled: true, rows: 1 })
    })
  })
})
