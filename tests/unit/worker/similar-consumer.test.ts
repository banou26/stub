// The worker's asks of `similarMedia`: on a run's page, with the CLUSTER's evidence, per (run cluster,
// container) pair, re-asked only when the question changes, and the answer claimed as SAME_AS of the
// run once its title names our show, while the container edge stays. Fixtures in the shape of
// container-page.test.ts; the ask is recorded so the exact input the answering source would read can
// be asserted.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import type { SimilarOutcome } from '../../../src/sources/similar'

import { closeRoot, openRoot, type RequestContext } from '../../../src/worker/request-context'
import { MAX_ASKS_PER_PAIR, planSimilarAsks, resetSimilarAsks, resolveSimilarRuns, runEvidence } from '../../../src/worker/similar-consumer'
import { findAggregatedMedia, findPartOfMedia, resetStore, upsertEpisodes, upsertMedia } from '../../../src/worker/store/db'
import { closeGraph, setGraphEnabled } from '../../../src/worker/graph/engine'
import { exportAsks } from '../../../src/worker/graph/asks'
import { graphReady } from '../../../src/worker/graph/schema'
import { setReadStore } from '../../../src/worker/graph/read'

const media = (
  uri: string,
  scope: 'RUN' | 'CONTAINER',
  fields: { score?: number, startDate?: string | null, episodeCount?: number | null, titles?: string[] } = {}
) => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  titles: (fields.titles ?? [uri]).map(title => ({ language: 'en', title, score: 1 })),
  startDate: fields.startDate ?? null,
  episodeCount: fields.episodeCount ?? null,
  score: fields.score ?? null,
  scope,
}) as any

const episode = (uri: string, mediaUri: string, title: string) => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  mediaUri,
  titles: [{ language: 'en', title, score: 1 }],
  episodeNumber: 1,
}) as any

const uris = (medias: { uri: string }[]) => medias.map(m => m.uri).sort()

/** anilist:1 and kitsu:2, one run, PART_OF a crunchyroll series and an imdb title, with two episodes */
const storeRun = async () => {
  await upsertMedia(
    [
      media('anilist:1', 'RUN', { score: 0.8, startDate: '2026-01-01', episodeCount: 12, titles: ['Show', 'Season 3'] }),
      media('kitsu:2', 'RUN', { score: 0.3, startDate: '2026-07-04', episodeCount: 14, titles: ['Show'] }),
      media('cr:X', 'CONTAINER'),
      media('imdb:tt1', 'CONTAINER'),
    ],
    [
      { mediaUri: 'anilist:1', handleUri: 'kitsu:2' },
      { mediaUri: 'anilist:1', handleUri: 'cr:X' },
      { mediaUri: 'kitsu:2', handleUri: 'imdb:tt1' },
    ]
  )
  await upsertEpisodes([episode('anilist:1-1', 'anilist:1', 'Alpha'), episode('anilist:1-2', 'anilist:1', 'Beta')], [])
  return findAggregatedMedia('anilist:1')
}

/** three more titled episodes on anilist:1, which is the evidence Rule 2 reads and a new fingerprint */
const addEpisodeTitles = () =>
  upsertEpisodes(
    [episode('anilist:1-3', 'anilist:1', 'Gamma'), episode('anilist:1-4', 'anilist:1', 'Delta'), episode('anilist:1-5', 'anilist:1', 'Epsilon')],
    []
  )

const episodeTitlesOfCall = (ask: ReturnType<typeof vi.fn>, index: number) =>
  ((ask.mock.calls[index] as unknown as [string, { episodeTitles?: string[] }])[1].episodeTitles ?? [])

// the real answer carries the row's titles, which the consumer reads to check the show
const ANSWER = { uri: 'cr:X-S3', origin: 'cr', id: 'X-S3', scope: 'RUN', titles: [{ title: 'Show' }] }
const answered = (media: typeof ANSWER = ANSWER): SimilarOutcome => ({ outcome: 'answered', media })
/** the fold: a season that HOLDS the run without being it (4.4), which claims containment and never identity */
const CONTAINER_ANSWER = { uri: 'cr:X-S1', origin: 'cr', id: 'X-S1', scope: 'RUN', titles: [{ title: 'Show' }] }
const containing = (media: typeof ANSWER = CONTAINER_ANSWER): SimilarOutcome => ({ outcome: 'containing', media })
const REFUSED: SimilarOutcome = { outcome: 'refused', reason: 'null' }
const implemented = (origin: string) => origin === 'cr' || origin === 'nf'
const recorder = () => vi.fn(async (): Promise<SimilarOutcome> => answered())
/** an origin that cannot place the run */
const refuser = () => vi.fn(async (): Promise<SimilarOutcome> => REFUSED)
/** an ask that never reached the source */
const decliner = (reason: 'ceiling' | 'timeout' | 'error') => vi.fn(async (): Promise<SimilarOutcome> => ({ outcome: 'declined', reason }))

let root: RequestContext
beforeEach(() => {
  resetStore()
  resetSimilarAsks()
  root = openRoot('MEDIA')
  return () => closeRoot(root.rootId)
})
// a test failing before its own mockRestore would hand its console spy, calls included, to the next
afterEach(() => vi.restoreAllMocks())

test('a run page asks each answering container origin once, with the cluster\'s evidence', async () => {
  const cluster = await storeRun()
  const ask = recorder()

  await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask).toHaveBeenCalledTimes(1)
  const [origin, input] = ask.mock.calls[0] as unknown as [string, Record<string, unknown>]
  expect(origin).toBe('cr')
  expect(input.showId).toBe('X')
  expect(input.titles, 'a bare season label names a position, never the run').toEqual(['Show'])
  expect(input.startDate, 'the day-precise date, not the higher-scored January 1').toBe('2026-07-04')
  expect(input.episodeCount, 'the highest-scored count').toBe(12)
  expect(input.episodeTitles).toEqual(['Alpha', 'Beta'])
  expect(input.context, 'the page\'s own root, so the callee reads a MEDIA hop').toBe(root)
})

// THE ANCHOR of every ask and every claim this consumer writes. The old store makes a row out of any
// uri a claim names, so a cluster routinely carries a member no source has described: the offline
// source's `anidb:14758` handle on `ag:(anilist:108465)`, which sorts ahead of `anilist:108465` and
// carries no title, no date and no count. The graph calls the same uri a placeholder and clusters
// nothing onto it, so an ask anchored there claims into nothing.
//
// Mutation: go back to `cluster.filter(...).map(media => media.uri).sort()[0]` and both assertions
// redden, the ask on `anidb:0` and the claim with it.
test('an ask is anchored on a member a source has described, never on a bare claimed uri', async () => {
  // `anidb:0` is the shape the offline source's `anidb:14758` handle has on the live page: a row
  // carrying a url and nothing else, which is enough to store (a row of pure identity is refused as a
  // placeholder) and nothing a rule can read
  await upsertMedia(
    [
      { ...media('anidb:0', 'RUN', { titles: [] }), url: 'https://anidb.net/anime/0' } as any,
      media('anilist:1', 'RUN', { score: 0.8, startDate: '2026-07-04', episodeCount: 12, titles: ['Show'] }),
      media('cr:X', 'CONTAINER'),
    ],
    [{ mediaUri: 'anilist:1', handleUri: 'anidb:0' }, { mediaUri: 'anilist:1', handleUri: 'cr:X' }]
  )
  const ask = recorder()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })

  expect(uris(await findAggregatedMedia('anilist:1')), 'the undescribed row IS a member of this cluster').toContain('anidb:0')
  expect(warn.mock.calls.map(call => String(call[0])), 'and `anidb:0` sorts first, and is not what the ask is keyed on')
    .toContainEqual(expect.stringMatching(/^similarMedia: consumer asked cr X for anilist:1 /))
  expect(warn.mock.calls.map(call => String(call[0]))).not.toContainEqual(expect.stringMatching(/ for anidb:0 /))
  warn.mockRestore()
})

test('the answer lands as SAME_AS of the run once its row arrives, and the container edge stays', async () => {
  const cluster = await storeRun()
  await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })

  // the answering extractor's own insertion, which the deferred claim has been waiting for
  await upsertMedia([media('cr:X-S3', 'RUN', { startDate: '2026-07-04', episodeCount: 14 })], [])

  const merged = await findAggregatedMedia('anilist:1')
  expect(uris(merged)).toEqual(['anilist:1', 'cr:X-S3', 'kitsu:2'])
  expect(uris(findPartOfMedia(merged)), 'the edge to the show is untouched').toEqual(['cr:X', 'imdb:tt1'])
})

test('a cluster is asked once per session, and growing does not re-ask', async () => {
  const cluster = await storeRun()
  const ask = refuser()

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)

  await upsertMedia([media('mal:9', 'RUN')], [{ mediaUri: 'anilist:1', handleUri: 'mal:9' }])
  const grown = await findAggregatedMedia('anilist:1')
  expect(uris(grown)).toContain('mal:9')
  await resolveSimilarRuns(grown, root, { ask, implemented })
  expect(ask, 'growing with no new evidence is the same question, so it is not asked again').toHaveBeenCalledTimes(1)
})

test('a refusal on partial evidence is asked again when the evidence changes, and not before', async () => {
  const cluster = await storeRun()
  const ask = refuser()

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await resolveSimilarRuns(cluster, root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)

  await addEpisodeTitles()
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'five episode titles is a new question').toHaveBeenCalledTimes(2)
  expect(episodeTitlesOfCall(ask, 1)).toHaveLength(5)

  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'and the same five is the same question').toHaveBeenCalledTimes(2)
})

test('a ceiling decline is retried on the next read with the same evidence', async () => {
  const cluster = await storeRun()
  const ask = decliner('ceiling')

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await resolveSimilarRuns(cluster, root, { ask, implemented })
  expect(ask, 'a decline never reached the source, so nothing about the evidence was learned').toHaveBeenCalledTimes(3)
})

test('an answer ends the asking for that pair', async () => {
  const cluster = await storeRun()
  const ask = recorder()

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)

  await addEpisodeTitles()
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'new evidence about a settled pair asks nothing').toHaveBeenCalledTimes(1)
})

test('asks per pair are capped', async () => {
  const cluster = await storeRun()
  const ask = decliner('timeout')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  for (let i = 0; i < 6; i++) await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask).toHaveBeenCalledTimes(MAX_ASKS_PER_PAIR)
  expect(warn.mock.calls.map(call => String(call[0]))).toContainEqual(expect.stringMatching(/^similarMedia: consumer settled cr X for anilist:1 \(cap 4 reached\)$/))
  warn.mockRestore()
})

test('two runs of one show keep their own records', async () => {
  const s1 = await storeRun()
  await upsertMedia(
    [media('anilist:5', 'RUN', { titles: ['Show Season 3'], startDate: '2026-07-04', episodeCount: 14 })],
    [{ mediaUri: 'anilist:5', handleUri: 'cr:X' }]
  )
  const s3 = await findAggregatedMedia('anilist:5')
  expect(uris(s3), 'the setup: season 3 is its own run under the same show').toEqual(['anilist:5'])
  const ask = refuser()

  await resolveSimilarRuns(s1, root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)
  await resolveSimilarRuns(s3, root, { ask, implemented })
  expect(ask, 'another run of the show is another question').toHaveBeenCalledTimes(2)
  await resolveSimilarRuns(s1, root, { ask, implemented })
  expect(ask, 'season 3 being asked did not forget season 1 was').toHaveBeenCalledTimes(2)
})

test('a cold read with no evidence burns nothing', async () => {
  await upsertMedia(
    [{ ...media('mal:3', 'RUN', { titles: [] }), titles: [], categories: ['ANIME'] }, media('cr:Z', 'CONTAINER')],
    [{ mediaUri: 'mal:3', handleUri: 'cr:Z' }]
  )
  const ask = recorder()

  await resolveSimilarRuns(await findAggregatedMedia('mal:3'), root, { ask, implemented })
  expect(ask).not.toHaveBeenCalled()

  await upsertMedia(
    [media('kitsu:4', 'RUN', { titles: ['Show'], startDate: '2026-07-04', episodeCount: 12 })],
    [{ mediaUri: 'mal:3', handleUri: 'kitsu:4' }]
  )
  await resolveSimilarRuns(await findAggregatedMedia('mal:3'), root, { ask, implemented })
  expect(ask, 'the first read holding evidence is the first ask').toHaveBeenCalledTimes(1)
})

test('one ask in flight per pair, and evidence that lands meanwhile is asked once it settles', async () => {
  const cluster = await storeRun()
  let settleFirst!: (outcome: SimilarOutcome) => void
  const pending = new Promise<SimilarOutcome>(resolve => { settleFirst = resolve })
  const ask = vi.fn(async (): Promise<SimilarOutcome> => REFUSED).mockImplementationOnce(() => pending)

  const first = resolveSimilarRuns(cluster, root, { ask, implemented })
  await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))

  await addEpisodeTitles()
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'the pair has an ask in flight, so the new evidence waits').toHaveBeenCalledTimes(1)

  settleFirst(REFUSED)
  await first
  expect(ask, 'the evidence that landed meanwhile is asked once the first settles').toHaveBeenCalledTimes(2)
  expect(episodeTitlesOfCall(ask, 1)).toHaveLength(5)
})

test('a run with no titles is not asked until a title lands', async () => {
  await upsertMedia(
    [{ ...media('mal:3', 'RUN', { titles: [], startDate: '2026-07-04', episodeCount: 12 }), titles: [], categories: ['ANIME'] }, media('cr:Z', 'CONTAINER')],
    [{ mediaUri: 'mal:3', handleUri: 'cr:Z' }]
  )
  const ask = recorder()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(await findAggregatedMedia('mal:3'), root, { ask, implemented })
  expect(ask, 'an answer could not be checked against the show').toHaveBeenCalledTimes(0)
  expect(warn.mock.calls.map(call => String(call[0])).filter(text => /^similarMedia: consumer skipped /.test(text))).toHaveLength(1)

  await upsertMedia([media('kitsu:4', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'mal:3', handleUri: 'kitsu:4' }])
  await resolveSimilarRuns(await findAggregatedMedia('mal:3'), root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)
  warn.mockRestore()
})

test('an answer titled for another show is refused, and the same titles do not ask again', async () => {
  const cluster = await storeRun()
  const ask = vi.fn(async (): Promise<SimilarOutcome> => answered({ ...ANSWER, titles: [{ title: 'Grand Blue Dreaming' }] }))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await upsertMedia([media('cr:X-S3', 'RUN', { titles: ['Grand Blue Dreaming'] })], [])

  expect(uris(await findAggregatedMedia('anilist:1')), 'a season of another show is never our run').toEqual(['anilist:1', 'kitsu:2'])
  expect(warn.mock.calls.map(call => String(call[0])))
    .toContainEqual(expect.stringMatching(/^similarMedia: consumer refused-by-title cr:X-S3 for anilist:1 \(best 0\.\d{3} of 1 run titles against 1 answer titles, threshold 0\.9\); re-asks on a new title$/))

  await addEpisodeTitles()
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'more evidence about the SEASON cannot change the show the answer names').toHaveBeenCalledTimes(1)
  warn.mockRestore()
})

// The real Mushoku Tensei shapes. A cold page's first read is routinely ONE source's row, and kitsu's
// carries the romaji title alone, which scores 0.441 against Crunchyroll's English series title
// (measured 2026-09-05; the native title scores 0.005). Settling the pair on that refusal made the
// recall gap permanent: the English title landing a moment later could never reopen it.
const ENGLISH = 'Mushoku Tensei: Jobless Reincarnation Season 3'
const ROMAJI = 'Mushoku Tensei III: Isekai Ittara Honki Dasu'
const NATIVE = '無職転生 Ⅲ ～異世界行ったら本気だす～'
const CR_SEASON_3 = { uri: 'cr:G24H1N3MP-GS00374452', origin: 'cr', id: 'G24H1N3MP-GS00374452', scope: 'RUN', titles: [{ title: 'Mushoku Tensei: Jobless Reincarnation' }] }

test('a title landing after a refusal by title asks again, and the English title is what passes', async () => {
  await upsertMedia(
    [media('kitsu:49002', 'RUN', { score: 0.3, titles: [ROMAJI], startDate: '2026-07-04', episodeCount: 14 }), media('cr:G24H1N3MP', 'CONTAINER')],
    [{ mediaUri: 'kitsu:49002', handleUri: 'cr:G24H1N3MP' }]
  )
  const ask = vi.fn(async (): Promise<SimilarOutcome> => answered(CR_SEASON_3))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(await findAggregatedMedia('kitsu:49002'), root, { ask, implemented })
  await resolveSimilarRuns(await findAggregatedMedia('kitsu:49002'), root, { ask, implemented })
  expect(ask, 'the romaji title alone refuses the answer, and the same title is not asked again').toHaveBeenCalledTimes(1)
  expect(warn.mock.calls.map(call => String(call[0])).filter(text => /^similarMedia: consumer refused-by-title /.test(text))).toHaveLength(1)

  await upsertMedia(
    [media('anilist:178789', 'RUN', { score: 0.8, titles: [ENGLISH, ROMAJI, NATIVE], startDate: '2026-07-04', episodeCount: 14 })],
    [{ mediaUri: 'anilist:178789', handleUri: 'kitsu:49002' }]
  )
  await resolveSimilarRuns(await findAggregatedMedia('kitsu:49002'), root, { ask, implemented })
  expect(ask, 'a new title is a new question').toHaveBeenCalledTimes(2)
  await upsertMedia([media('cr:G24H1N3MP-GS00374452', 'RUN', { titles: ['Mushoku Tensei: Jobless Reincarnation'], startDate: '2026-07-04', episodeCount: 14 })], [])
  expect(uris(await findAggregatedMedia('kitsu:49002'))).toEqual(['anilist:178789', 'cr:G24H1N3MP-GS00374452', 'kitsu:49002'])
  warn.mockRestore()
})

// Two clusters of one show under one container, unioned while the second's ask is in flight. The
// survivor copied the other's in-flight flag, the other's driver cleared its own on settle, and the
// merged pair sat "in flight" for the session with nothing to say about it (2026-09-05).
test('a record absorbed while its ask is in flight does not leave the merged pair stuck', async () => {
  const a = await storeRun()
  await upsertMedia(
    [media('mal:7', 'RUN', { titles: ['Show'], startDate: '2026-07-04', episodeCount: 12 })],
    [{ mediaUri: 'mal:7', handleUri: 'cr:X' }]
  )
  const b = await findAggregatedMedia('mal:7')
  expect(uris(b), 'the setup: a second cluster under the same show').toEqual(['mal:7'])
  let settleB!: (outcome: SimilarOutcome) => void
  const pending = new Promise<SimilarOutcome>(resolve => { settleB = resolve })
  const ask = vi.fn(async (): Promise<SimilarOutcome> => REFUSED)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(a, root, { ask, implemented })
  expect(ask).toHaveBeenCalledTimes(1)
  ask.mockImplementationOnce(() => pending)
  const inFlight = resolveSimilarRuns(b, root, { ask, implemented })
  await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2))

  await upsertMedia([], [{ mediaUri: 'anilist:1', handleUri: 'mal:7' }])
  const merged = await findAggregatedMedia('anilist:1')
  expect(uris(merged)).toEqual(['anilist:1', 'kitsu:2', 'mal:7'])
  await resolveSimilarRuns(merged, root, { ask, implemented })
  expect(warn.mock.calls.map(call => String(call[0]))).toContainEqual('similarMedia: consumer merged 2 records under cr:X (3 members)')
  settleB(REFUSED)
  await inFlight
  expect(ask, 'the merged question was already refused for the survivor, so it is not asked again').toHaveBeenCalledTimes(2)

  await addEpisodeTitles()
  await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
  expect(ask, 'nothing is in flight any more, and the evidence is new: the merged pair must be asked').toHaveBeenCalledTimes(3)
  warn.mockRestore()
})

// Two callers can name one origin's run for one cluster: anilist's own mapping claims by its day-precise
// date while the consumer's ask is still in flight on weaker evidence. Nothing compared the two, so a
// second season of one origin could land in one cluster, which is two seasons welded.
test('an answer arriving after another run of its origin joined the cluster is refused', async () => {
  const cluster = await storeRun()
  let settle!: (outcome: SimilarOutcome) => void
  const pending = new Promise<SimilarOutcome>(resolve => { settle = resolve })
  const ask = vi.fn((): Promise<SimilarOutcome> => pending)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const first = resolveSimilarRuns(cluster, root, { ask, implemented })
  await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
  await upsertMedia([media('cr:X-S1', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
  settle(answered())
  await first
  await upsertMedia([media('cr:X-S3', 'RUN', { titles: ['Show'] })], [])

  expect(uris(await findAggregatedMedia('anilist:1')), 'one origin, one run per cluster').toEqual(['anilist:1', 'cr:X-S1', 'kitsu:2'])
  expect(warn.mock.calls.map(call => String(call[0])))
    .toContainEqual('similarMedia: consumer refused-by-origin cr:X-S3 for anilist:1 (cr:X-S1 is already the cluster\'s cr run)')
  warn.mockRestore()
})

test('a read during an in-flight ask says it deferred', async () => {
  const cluster = await storeRun()
  let settle!: (outcome: SimilarOutcome) => void
  const pending = new Promise<SimilarOutcome>(resolve => { settle = resolve })
  const ask = vi.fn((): Promise<SimilarOutcome> => pending)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  const first = resolveSimilarRuns(cluster, root, { ask, implemented })
  await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
  await resolveSimilarRuns(cluster, root, { ask, implemented })
  expect(warn.mock.calls.map(call => String(call[0])))
    .toContainEqual('similarMedia: consumer deferred cr X for anilist:1 (an ask is in flight; asked when it settles if still new)')
  settle(REFUSED)
  await first
  warn.mockRestore()
})

test('an answer with no titles is refused', async () => {
  const cluster = await storeRun()
  const ask = vi.fn(async (): Promise<SimilarOutcome> => answered({ ...ANSWER, titles: [] }))

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  await upsertMedia([media('cr:X-S3', 'RUN', { startDate: '2026-07-04', episodeCount: 14 })], [])

  expect(uris(await findAggregatedMedia('anilist:1')), 'an answer that cannot be checked is not verified').toEqual(['anilist:1', 'kitsu:2'])
})

test('the consumer says what it did, one line per decision', async () => {
  const cluster = await storeRun()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })

  expect(warn.mock.calls.map(call => String(call[0])).filter(text => /^similarMedia: consumer/.test(text))).toEqual([
    'similarMedia: consumer asked cr X for anilist:1 (ask 1 of 4) with {day:2026-07-04, count:12, ordinals:-, parts:no, titles:1, episodeTitles:2}',
    'similarMedia: consumer claimed cr:X-S3 as SAME_AS of anilist:1',
  ])
  warn.mockRestore()
})

test('an origin that does not implement the field, or already has a run in the cluster, is never asked', async () => {
  const cluster = await storeRun()
  const asks = planSimilarAsks(cluster, findPartOfMedia(cluster), implemented)
  expect(asks.map(ask => ask.origin), 'imdb answers nothing, so it is not asked').toEqual(['cr'])

  await upsertMedia([media('cr:X-S1', 'RUN')], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
  const withRun = await findAggregatedMedia('anilist:1')
  expect(planSimilarAsks(withRun, findPartOfMedia(withRun), implemented), 'the cluster already holds a cr run').toEqual([])
})

test('a container-only cluster asks nothing, and so does a run with no evidence', async () => {
  await upsertMedia([media('tvmaze:7', 'CONTAINER'), media('cr:Y', 'CONTAINER')], [{ mediaUri: 'tvmaze:7', handleUri: 'cr:Y' }])
  const ask = recorder()
  await resolveSimilarRuns(await findAggregatedMedia('tvmaze:7'), root, { ask, implemented })
  expect(ask).not.toHaveBeenCalled()

  await upsertMedia(
    [{ ...media('mal:3', 'RUN', { titles: [] }), titles: [], categories: ['ANIME'] }, media('cr:Z', 'CONTAINER')],
    [{ mediaUri: 'mal:3', handleUri: 'cr:Z' }]
  )
  const bare = await findAggregatedMedia('mal:3')
  expect(runEvidence(bare, []), 'the setup: nothing to say about the run').toEqual({ titles: [], startDate: undefined, episodeCount: undefined, episodeTitles: [] })
  await resolveSimilarRuns(bare, root, { ask, implemented })
  expect(ask).not.toHaveBeenCalled()
})

test('a refusal claims nothing', async () => {
  const cluster = await storeRun()
  await resolveSimilarRuns(cluster, root, { ask: refuser(), implemented })
  await upsertMedia([media('cr:X-S3', 'RUN', { startDate: '2026-07-04' })], [])

  expect(uris(await findAggregatedMedia('anilist:1'))).toEqual(['anilist:1', 'kitsu:2'])
  expect(uris(await findAggregatedMedia('cr:X-S3')), 'the row is its own cluster').toEqual(['cr:X-S3'])
})

// The policy gate. Only `Subscription.media` calls this, so a listing never reaches it by
// construction; the gate is what makes that a property of the consumer rather than of its one caller.
test('a listing root never asks', async () => {
  const cluster = await storeRun()
  const listing = openRoot('MEDIA_PAGE')
  const ask = recorder()

  await resolveSimilarRuns(cluster, listing, { ask, implemented })
  expect(ask).not.toHaveBeenCalled()

  await resolveSimilarRuns(cluster, root, { ask, implemented })
  expect(ask, 'and the refused listing did not count as asked').toHaveBeenCalledTimes(1)
  closeRoot(listing.rootId)
})

// THE ASK CLAIM (4.4, migration step 4). An answer the consumer ACCEPTS becomes a claim in the graph,
// stamped `provenance: 'ask'`, beside the log row that records the question. The two are different
// facts and neither stands in for the other: the log says a question was put and what it came to, the
// claim says what the graph may now derive, and a question that was declined or refused has the first
// and never the second.
//
// The claims are read straight off `CLAIMS` rather than through a plugin, because this file owns the
// consumer and the shape of what it writes; that an `ask` claim is then consumed exactly as a `source`
// claim is lives in `graph/ask-claim.test.ts`, where the plugins run.
// THE ASK LOG (7.3). One row per question the consumer SENT, carrying what that question came to, so
// a page with no Crunchyroll button can tell "never asked" from "asked and refused" from "asked and
// declined". The flag goes up only here, at the end of the file: every test above runs with the graph
// down and is therefore also the control that the consumer's behaviour does not depend on it.
describe('the Ask log and the ask claim', () => {
  beforeAll(() => { setGraphEnabled(true) })
  afterAll(async () => {
    setGraphEnabled(false)
    await closeGraph()
  })

  const keysOf = (rows: { key: string }[]) => new Set(rows.map(row => row.key))
  const added = async (before: Set<string>) => (await exportAsks()).filter(row => !before.has(row.key))

  test('an answered question is one row naming the answer', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())

    await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })

    const rows = await added(before)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      clusterId: 'ag:(anilist:1,kitsu:2)',
      // Mutation: drop `runUri` from the `recordAsk` call in `note` and this reads back null. 7.5's
      // ask query matches on this column, and the consumer is its only writer.
      runUri: 'anilist:1',
      origin: 'cr',
      showId: 'X',
      outcome: 'answered',
      reason: 'cr:X-S3',
      answerUri: 'cr:X-S3',
    })
  })

  test('a decline from the funnel is recorded with the funnel\'s own reason', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())

    await resolveSimilarRuns(cluster, root, { ask: decliner('ceiling'), implemented })

    const rows = await added(before)
    expect(rows.map(row => [row.outcome, row.reason])).toEqual([['declined', 'ceiling']])
    expect(rows[0]!.answerUri, 'a decline named no row').toBeNull()
  })

  test('the consumer\'s own refusal by title is recorded as its own reason', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    const ask = vi.fn(async (): Promise<SimilarOutcome> => answered({ ...ANSWER, titles: [{ title: 'Grand Blue Dreaming' }] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await resolveSimilarRuns(cluster, root, { ask, implemented })

    expect(await added(before)).toMatchObject([{ outcome: 'refused', reason: 'by-title', answerUri: null }])
    warn.mockRestore()
  })

  // The other half of the design's `refused-other-run`: an answer that arrives after another run of
  // its origin joined the cluster is the weld the ask exists to avoid, and the log says so.
  test('an answer refused because the origin already has a run in the cluster says which', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    let settle!: (outcome: SimilarOutcome) => void
    const pending = new Promise<SimilarOutcome>(resolve => { settle = resolve })
    const ask = vi.fn((): Promise<SimilarOutcome> => pending)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const first = resolveSimilarRuns(cluster, root, { ask, implemented })
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    await upsertMedia([media('cr:X-S1', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
    settle(answered())
    await first

    expect(await added(before)).toMatchObject([{ outcome: 'refused', reason: 'other-run' }])
    warn.mockRestore()
  })

  // THE LOG IS A HISTORY, NOT A DEDUPE. A decline never reached the source, so the consumer retries
  // the identical question; four of those are the whole of the pair's cap, and a log that folded them
  // into one row would report one question where four were spent.
  test('the same question asked again is a second row, and new evidence a third', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    const ask = decliner('ceiling')

    await resolveSimilarRuns(cluster, root, { ask, implemented })
    await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })
    await addEpisodeTitles()
    await resolveSimilarRuns(await findAggregatedMedia('anilist:1'), root, { ask, implemented })

    const rows = await added(before)
    expect(rows).toHaveLength(3)
    expect(rows[0]!.questionHash, 'the identical question, asked twice').toBe(rows[1]!.questionHash)
    expect(rows[0]!.key, 'and two rows, never one').not.toBe(rows[1]!.key)
    expect(rows[2]!.questionHash, 'five episode titles is a different question').not.toBe(rows[0]!.questionHash)
    expect(rows.map(row => row.seq)).toEqual([...rows.map(row => row.seq)].sort((a, b) => a - b))
  })

  // THE CONTROL. The consumer runs exactly as it does above, an answer and all, and writes nothing:
  // the log is a record of a session that asked for one, never a cost every session pays.
  test('a session with the graph off records nothing', async () => {
    const cluster = await storeRun()
    const before = await exportAsks()
    setGraphEnabled(false)

    await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })
    await upsertMedia([media('cr:X-S3', 'RUN', { startDate: '2026-07-04', episodeCount: 14 })], [])
    expect(uris(await findAggregatedMedia('anilist:1')), 'the consumer did its whole job').toEqual(['anilist:1', 'cr:X-S3', 'kitsu:2'])

    setGraphEnabled(true)
    expect(await exportAsks(), 'and the log is untouched').toEqual(before)
  })

  // The engine is opened once for the whole file and never torn down (closing it and reopening hangs
  // the wasm module), so the claim table is the one piece of state that would otherwise carry from
  // case to case: a pair another case already claimed is a no-op here, and an assertion over it could
  // not see a leak. Emptied per case instead, which is what lets each one assert the WHOLE set.
  beforeEach(async () => {
    const { query } = await graphReady()
    await query('MATCH ()-[c:CLAIMS]->() DELETE c')
  })

  const claimsFrom = async (fromUri: string) => {
    const { query } = await graphReady()
    return query(
      `MATCH (a:Media {uri: $uri})-[c:CLAIMS]->(b:Media)
       RETURN b.uri AS toUri, c.kind AS kind, c.provenance AS provenance, c.claimer AS claimer
       ORDER BY toUri, kind`,
      { uri: fromUri }
    )
  }

  // Mutation: pass 'SAME_AS' rather than `kind` to `claim` in the consumer's accept branch and the
  // kind assertion reddens. This is the expensive direction of the two: a wrong containment costs a
  // badge and a hidden card, a wrong sameness welds two works.
  test('a containing answer is claimed PART_OF, never SAME_AS', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())

    await resolveSimilarRuns(cluster, root, { ask: vi.fn(async () => containing()), implemented })

    expect(await claimsFrom('anilist:1')).toEqual([
      { toUri: 'cr:X-S1', kind: 'PART_OF', provenance: 'ask', claimer: 'cr' },
    ])
    // and the log says which kind of answer it was, since `answered` and `containing` come to two
    // different claims. Mutation: hardcode 'answered' in the accept branch's `note` and this reddens
    expect(await added(before)).toMatchObject([{ outcome: 'containing', reason: 'cr:X-S1', answerUri: 'cr:X-S1' }])
  })

  // THE OLD STORE TAKES SAMENESS AND NOTHING ELSE, which is what it took before `containing` existed.
  // A containment is the graph's fact: nothing in the old store reads one, since it has no placement
  // that lays a container's episodes over a run, and that store is the CONTROL every measurement of
  // this migration is made against, so a new kind of handle landing there moves the arm the
  // comparison is with. It welds nothing either way, `upsertMedia` putting a claimed `PART_OF` on a
  // deletable edge; what it costs is the control.
  //
  // Mutation: drop the `kind === 'SAME_AS'` condition from the accept branch's `upsertMedia` and the
  // last assertion reddens, `cr:X-S1` appearing beside the two containers. Delete that write outright
  // and 'a session with the graph off records nothing' reddens instead, since the sameness answer is
  // what unions `cr:X-S3` into that cluster.
  test('a containing answer leaves the old store exactly as it found it', async () => {
    const cluster = await storeRun()
    const before = uris(findPartOfMedia(await findAggregatedMedia('anilist:1')))

    await resolveSimilarRuns(cluster, root, { ask: vi.fn(async () => containing()), implemented })
    // the answering source's own row, landing after the claim exactly as it does in the app
    await upsertMedia([media('cr:X-S1', 'RUN', { startDate: '2021-01-11', episodeCount: 24 })], [])

    expect(uris(await findAggregatedMedia('anilist:1')), 'the container is not a member of the run').toEqual(['anilist:1', 'kitsu:2'])
    expect(before, 'the containers the page had before the ask').toEqual(['cr:X', 'imdb:tt1'])
    expect(
      uris(findPartOfMedia(await findAggregatedMedia('anilist:1'))),
      'and the ones it has after it: the season is claimed in the graph and nowhere here'
    ).toEqual(before)
  })

  // FINDING 2 OF THE 2026-09-13 REVIEW. The season a containing answer mints is a season-scoped RUN
  // hanging off the cluster on a `PART_OF`, and the plan used to read every `PART_OF` target as a
  // show: the next page then asked the source about show `cr:X-S1`, an id only this app has spelled,
  // at the far end of two network calls.
  //
  // Mutation: drop `if (container.scope !== 'CONTAINER') continue` from `planSimilarAsks` and the
  // last assertion gains a second ask, about that season.
  test('the season a containing answer minted is never asked as if it were a show', async () => {
    await storeRun()
    // the answering source's own row, and the PART_OF the claim becomes once the row describes itself
    await upsertMedia([media('cr:X-S1', 'RUN', { startDate: '2021-01-11', episodeCount: 24 })], [])
    await upsertMedia([], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1', relation: 'PART_OF' }])

    const cluster = await findAggregatedMedia('anilist:1')
    const containers = findPartOfMedia(cluster)
    expect(uris(containers), 'the season IS a part-of target, so nothing else keeps it out').toEqual(['cr:X', 'cr:X-S1', 'imdb:tt1'])
    expect(
      planSimilarAsks(cluster, containers, implemented).map(ask => ask.showId),
      'and only the CONTAINER-scoped ones are shows'
    ).toEqual(['X'])
  })

  // FINDING 6 OF THE 2026-09-13 REVIEW. The cluster already holds the answering origin's run and a
  // CONTAINING answer names that very row, so the source has said it HOLDS the run where the cluster
  // says it IS the run. The claim is written for that reason rather than in spite of it: `containing`
  // is not a downgrade reason, so `invariantRepairs` reads the `PART_OF` between two members of one
  // cluster and retracts the `SAME_AS` that joined them (3.5). Swallowing it would leave the weld
  // standing on evidence the source itself has withdrawn.
  //
  // Mutation: pass 'SAME_AS' rather than `kind` to `claim` in this arm and the kind reddens; drop the
  // `claim` call from the arm and the row disappears entirely.
  test('a containing answer naming the cluster\'s own run is claimed PART_OF, never read as confirmation', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    let settle!: (outcome: SimilarOutcome) => void
    const ask = vi.fn((): Promise<SimilarOutcome> => new Promise<SimilarOutcome>(resolve => { settle = resolve }))

    // the only way into this arm, and the one the design names: the row joins the cluster on somebody
    // else's evidence WHILE the ask is in flight, since a cluster that already holds the origin's run
    // is never asked at all
    const running = resolveSimilarRuns(cluster, root, { ask, implemented })
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    await upsertMedia([media('cr:X-S1', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
    settle(containing())
    await running

    expect(uris(await findAggregatedMedia('anilist:1')), 'the answer names a row the cluster now holds').toContain('cr:X-S1')
    expect(await claimsFrom('anilist:1'), 'the contradiction reaches the graph as a containment claim').toEqual([
      { toUri: 'cr:X-S1', kind: 'PART_OF', provenance: 'ask', claimer: 'cr' },
    ])
    expect(await added(before), 'and the log says a container is what arrived').toMatchObject([
      { outcome: 'containing', reason: 'cr:X-S1', answerUri: 'cr:X-S1' },
    ])
  })

  // Mutation: drop the `await claim(...)` line from the accept branch and this reddens while every
  // `Ask` log case above still passes, which is exactly the state the slice started in: the answer
  // logged, and nothing in the graph saying so.
  test('a sameness answer is claimed SAME_AS, stamped ask and attributed to the answering origin', async () => {
    const cluster = await storeRun()

    await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })

    expect(await claimsFrom('anilist:1')).toEqual([
      { toUri: 'cr:X-S3', kind: 'SAME_AS', provenance: 'ask', claimer: 'cr' },
    ])
  })

  // Mutation, for this case and the one below: claim the pair the consumer ASKED about, by adding
  // `await claim(ask, { uri: ask.containerUri, origin: ask.origin, id: ask.showId }, 'PART_OF')` after
  // `record.asks += 1`. Both redden. That is the plausible mistake here, since a question sent is a
  // pointer at a container and it is tempting to record it: a declined ask never reached the source,
  // and an ask that was sent asserts nothing until it is answered.
  test('a declined ask writes its log row and no claim at all', async () => {
    const cluster = await storeRun()
    const before = new Set((await exportAsks()).map(row => row.key))

    await resolveSimilarRuns(cluster, root, { ask: decliner('ceiling'), implemented })

    expect((await exportAsks()).filter(row => !before.has(row.key)).map(row => row.outcome)).toEqual(['declined'])
    expect(await claimsFrom('anilist:1'), 'nothing was answered, so nothing is claimed').toEqual([])
  })

  // The consumer's own refusal, for the same reason: an answer whose titles do not name our show is
  // not an answer, and the log row is the whole of what it leaves behind.
  //
  // Mutation: the one above, and equally moving `await claim(...)` above the `verdict.ok` check.
  test('an answer refused by title writes its log row and no claim', async () => {
    const cluster = await storeRun()
    const ask = vi.fn(async (): Promise<SimilarOutcome> => answered({ ...ANSWER, titles: [{ title: 'Grand Blue Dreaming' }] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await resolveSimilarRuns(cluster, root, { ask, implemented })

    expect(await claimsFrom('anilist:1')).toEqual([])
    warn.mockRestore()
  })

  // 1a. THE BRANCH THE LIVE PAGE TAKES, and the one the slice shipped without. An answer naming the
  // run the cluster ALREADY holds was logged `answered` and claimed nowhere, so the Netflix season the
  // console said had answered existed in the graph as no member of anything. The row being present is
  // somebody else's evidence for it; this ask is a second, independent one, and the claim is what
  // makes it a fact the rules may use.
  //
  // Mutation: remove the `await claim(...)` line from the `present.uri === result.media.uri` arm and
  // this reddens while every log case above stays green, which is the exact state that was measured.
  test('an answer naming the run the cluster already holds is claimed, not merely logged', async () => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    let settle!: (outcome: SimilarOutcome) => void
    const pending = new Promise<SimilarOutcome>(resolve => { settle = resolve })
    const ask = vi.fn((): Promise<SimilarOutcome> => pending)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const first = resolveSimilarRuns(cluster, root, { ask, implemented })
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    // the answering extractor's own row lands while the ask is in flight: the same uri the answer
    // is about to name, which is an answer and not the weld the other arm refuses
    await upsertMedia([media('cr:X-S3', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S3' }])
    settle(answered())
    await first

    expect(await added(before), 'the log still says it was answered').toMatchObject([{ outcome: 'answered', answerUri: 'cr:X-S3' }])
    expect(await claimsFrom('anilist:1')).toEqual([
      { toUri: 'cr:X-S3', kind: 'SAME_AS', provenance: 'ask', claimer: 'cr' },
    ])
    warn.mockRestore()
  })

  // 1b. THE GATE READS THE STORE THE CLAIM IS WRITTEN INTO. The old store unions a row in off the
  // route's address alone; the graph refuses the same row entry because an address asserts nothing
  // (3.3). A gate on the old store therefore reported "this cluster already has a cr run" about a
  // graph that had none, and the answer was refused `other-run` and claimed nowhere. A route uri
  // naming a season must never be what silences the ask.
  //
  // Mutation: make `presentRun` always read `findAggregatedMedia` (drop its `readStore()` branch) and
  // this reddens: the row becomes `refused`/`other-run` and the claim set is empty.
  //
  // Two arms over one setup, and the second is the control that the gate MOVED rather than being
  // dropped: a second run of one origin is still the weld the ask exists to avoid, on the store that
  // can actually see it. The row lands while the ask is in flight, which is the one way to reach the
  // gate at all once the plan reads the same store.
  const answerWithAnotherCrRunPresent = async (store: 'graph' | 'legacy') => {
    const cluster = await storeRun()
    const before = keysOf(await exportAsks())
    let settle!: (outcome: SimilarOutcome) => void
    const pending = new Promise<SimilarOutcome>(resolve => { settle = resolve })
    const ask = vi.fn((): Promise<SimilarOutcome> => pending)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setReadStore(store)
    try {
      const run = resolveSimilarRuns(cluster, root, { ask, implemented })
      await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
      // the OLD store gains a different cr run; the graph gains nothing at all
      await upsertMedia([media('cr:X-S1', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
      settle(answered())
      await run
    } finally {
      setReadStore('legacy')
      warn.mockRestore()
    }
    return { rows: await added(before), claims: await claimsFrom('anilist:1') }
  }

  test('on the graph store a run only the OLD store holds does not refuse the answer', async () => {
    const { rows, claims } = await answerWithAnotherCrRunPresent('graph')
    expect(rows).toMatchObject([{ outcome: 'answered', answerUri: 'cr:X-S3' }])
    expect(claims).toEqual([{ toUri: 'cr:X-S3', kind: 'SAME_AS', provenance: 'ask', claimer: 'cr' }])
  })

  test('on the legacy store the same second run of one origin is still refused and claimed nowhere', async () => {
    const { rows, claims } = await answerWithAnotherCrRunPresent('legacy')
    expect(rows).toMatchObject([{ outcome: 'refused', reason: 'other-run' }])
    expect(claims).toEqual([])
  })

  // The plan half of the same rule, and the one the fifth measured row of the review took: with
  // `nf:80987039-3` in the ROUTE the old store unions it in, so the consumer saw the origin present
  // and never asked at all. An address asserts nothing, so on the graph store the ask is still owed.
  //
  // Mutation: drop the `heldOrigins` argument from the `planSimilarAsks` call in `resolveSimilarRuns`
  // and this reddens with no ask made.
  test('on the graph store an origin only the OLD store holds is still asked', async () => {
    const cluster = await storeRun()
    await upsertMedia([media('cr:X-S1', 'RUN', { titles: ['Show'] })], [{ mediaUri: 'anilist:1', handleUri: 'cr:X-S1' }])
    const withCr = await findAggregatedMedia('anilist:1')
    expect(withCr.map(m => m.origin), 'the old store really does hold a cr run now').toContain('cr')
    const ask = refuser()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    setReadStore('graph')
    try {
      await resolveSimilarRuns(withCr, root, { ask, implemented })
    } finally {
      setReadStore('legacy')
    }
    expect(ask).toHaveBeenCalledTimes(1)

    // the control on the same cluster: the legacy store's own membership DOES silence it
    resetSimilarAsks()
    const legacyAsk = refuser()
    await resolveSimilarRuns(withCr, root, { ask: legacyAsk, implemented })
    expect(legacyAsk).toHaveBeenCalledTimes(0)
    warn.mockRestore()
  })

  // THE CONTROL, and the same one the log keeps: the consumer does its whole job with the flag down
  // and writes no claim, so a session that never asked for a graph pays nothing for one.
  //
  // Mutation: drop the `graphEnabled()` line from `claim` and this reddens by opening the engine and
  // writing a claim in a session that asked for neither.
  test('a session with the graph off claims nothing', async () => {
    const cluster = await storeRun()
    setGraphEnabled(false)

    await resolveSimilarRuns(cluster, root, { ask: recorder(), implemented })
    await upsertMedia([media('cr:X-S3', 'RUN', { startDate: '2026-07-04' })], [])
    expect(uris(await findAggregatedMedia('anilist:1')), 'the consumer did its whole job').toEqual(['anilist:1', 'cr:X-S3', 'kitsu:2'])

    setGraphEnabled(true)
    expect(await claimsFrom('anilist:1')).toEqual([])
  })
})
