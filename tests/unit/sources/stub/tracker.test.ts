// The stub tracker served the way every provider is, over a journal kept in memory, and asked the
// questions the app asks it.
import { afterEach, describe, expect, test } from 'vitest'

import type { CatalogLookup } from '../../../../src/tracking/identity'

import { openJournal, type Journal } from '../../../../src/tracking/journal'
import { stubTrackerResolvers } from '../../../../src/sources/stub/tracker-resolvers'
import { SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT, DELETE_LIST_ENTRY_DOCUMENT } from '../../../../src/worker/tracking-document'
import { memoryStore } from '../../tracking/memory-store'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'

const catalog: CatalogLookup = { lookup: (origin, id) => [{ mal: 10, anilist: 1, kitsu: 5, anidb: 7 }].find(row => row[origin] === id) }

let now = 1_000
let minted = 0
const deps = { now: () => (now += 1_000), uuid: () => `entry-${++minted}` }

const stubServer = (store = memoryStore()) => {
  let journal: Promise<Journal> | undefined
  const open = () => (journal ??= openJournal(store, deps))
  return { store, open, target: providerServer('stub', stubTrackerResolvers(open), { catalog: async () => catalog }) }
}

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const watch = (target: ReturnType<typeof stubServer>['target'], uri: string) => {
  const subscription = subscribe(target, TRACKING_DOCUMENT, { input: { uri } })
  live.push(subscription)
  return subscription
}

const answerOf = (result: any) => result.data.tracking.answers[0]

const save = (target: ReturnType<typeof stubServer>['target'], uri: string, entry: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  yogaClient(target).mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['stub'], entry, ...extra } }).toPromise()

describe('the stub tracker', () => {
  test('answers NOT_LISTED, then LISTED with its own entry once a save lands, on the same subscription', async () => {
    const { target } = stubServer()
    const tracking = watch(target, 'ag:(anilist:1)')

    expect(answerOf(await tracking.next())).toMatchObject({ state: 'NOT_LISTED', tracker: { id: 'stub', canWrite: true }, entry: null })

    const saved = await save(target, 'ag:(anilist:1)', { status: 'WATCHING', progress: 3, score: 80 }, { title: 'Frieren', episodeCount: 28 })
    expect(saved.data.saveListEntry).toMatchObject([{ tracker: 'stub', outcome: 'SAVED', entry: { status: 'WATCHING', progress: 3, score: 80 } }])

    const listed = answerOf(await tracking.until(result => answerOf(result).state === 'LISTED'))
    expect(listed.entry).toMatchObject({ tracker: 'stub', mediaUri: 'anilist:1', status: 'WATCHING', progress: 3, score: 80, title: 'Frieren', episodeCount: 28 })
    expect(listed.entry._id).toMatch(/^stub:/)
  })

  test('finds the entry again from another uri of the same run, and after the page is reloaded', async () => {
    const first = stubServer()
    await save(first.target, 'ag:(anilist:1)', { progress: 5 })

    // a reload is a new worker: a new journal over the same file
    const reloaded = stubServer(first.store)
    const answer = answerOf(await watch(reloaded.target, 'ag:(cr:GRJ-S1,mal:10)').next())
    expect(answer).toMatchObject({ state: 'LISTED', entry: { progress: 5 } })
  })

  test('keeps season 2 apart from season 1 when both carry the show-level Crunchyroll id', async () => {
    const { target } = stubServer()
    await save(target, 'ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS1)', { progress: 12 })

    expect(answerOf(await watch(target, 'ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS2)').next()).state).toBe('NOT_LISTED')
    expect(answerOf(await watch(target, 'ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS1)').next()).state, 'the control').toBe('LISTED')
  })

  test('answers AMBIGUOUS with both ids, and refuses a write it cannot place', async () => {
    const { target, open } = stubServer()
    const answer = answerOf(await watch(target, 'ag:(anilist:1,anilist:2)').next())
    expect(answer).toMatchObject({ state: 'AMBIGUOUS', candidates: ['anilist:1', 'anilist:2'], entry: null })

    const saved = await save(target, 'ag:(anilist:1,anilist:2)', { progress: 1 })
    expect(saved.data.saveListEntry).toMatchObject([{ tracker: 'stub', outcome: 'REFUSED' }])
    expect(saved.data.saveListEntry[0].error).toContain('anilist:1 and anilist:2')
    expect((await open()).entries(), 'nothing was written').toEqual([])
  })

  test('answers NO_ID for a media it cannot key', async () => {
    const { target } = stubServer()
    expect(answerOf(await watch(target, 'ag:(offline:unknown)').next()).state).toBe('NO_ID')
  })

  test('a delete takes the entry off the list', async () => {
    const { target } = stubServer()
    await save(target, 'ag:(anilist:1)', { status: 'COMPLETED', progress: 28 })
    const deleted = await yogaClient(target).mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri: 'ag:(mal:10)', trackers: ['stub'] } }).toPromise()

    expect(deleted.data.deleteListEntry).toMatchObject([{ tracker: 'stub', outcome: 'SAVED' }])
    expect(answerOf(await watch(target, 'ag:(anilist:1)').next()).state).toBe('NOT_LISTED')
  })
})
