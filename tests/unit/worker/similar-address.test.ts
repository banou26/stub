// What the similar step joins, on answers recorded through the relays on 2026-10-31. The store unions everything an
// address names, so a link naming two shows looks like one cluster: the step takes the rows a source's own claims join
// to the run, and of the rest only those a search could have found. A real address must come out exactly as it did.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media } from '../../../src/generated/schema/types.generated'
import type { SimilarAnswerMedia, SimilarOutcome } from '../../../src/sources/similar'

import { buildHandlesFromUri, makeMedia, mergeHandles, partOf, sameAs } from '../../../src/sources/utils'
import { closeGraph, setGraphEnabled } from '../../../src/worker/graph/engine'
import { setReadStore } from '../../../src/worker/graph/read'
import { graphReady } from '../../../src/worker/graph/schema'
import { closeRoot, openRoot, type RequestContext } from '../../../src/worker/request-context'
import { resetSimilarAsks, resolveSimilarRuns } from '../../../src/worker/similar-consumer'
import { recursivelyUnwrapMediaHandles } from '../../../src/worker/store/aggregate'
import { findMediaForPage, resetStore, upsertMedia } from '../../../src/worker/store/db'
import { handleClaims, normalizeToStoreMedia } from '../../../src/worker/store/normalize'

const row = (uri: string, titles: string[], fields: Partial<Omit<Media, 'handles'>> & { handles?: Media['handles'] } = {}) =>
  makeMedia({
    origin: uri.slice(0, uri.indexOf(':')),
    id: uri.slice(uri.indexOf(':') + 1),
    ...fields,
    titles: titles.map(title => ({ language: 'en', title, score: 1 })),
  })

const bare = (uri: string) => row(uri, [])

/** A source's row found by search or by an id the address names: every handle it had, and the address's. */
const addressed = (media: Media, uri: string) => {
  mergeHandles(media, uri)
  return media
}

/** What the worker's inserter makes of an answer (src/worker/extractor.ts, which cannot load here). */
const land = async (...answers: Media[]) => {
  const rows = answers.flatMap(recursivelyUnwrapMediaHandles)
  await upsertMedia(rows.map(normalizeToStoreMedia), handleClaims(rows))
}

const answered = (media: Media): SimilarOutcome => ({ outcome: 'answered', media: media as unknown as SimilarAnswerMedia })
const implemented = (origin: string) => ['cr', 'jw', 'nf'].includes(origin)

/** Asks each origin as the recording answered it, and refuses the rest. */
const asking = (answers: Record<string, Media>) =>
  vi.fn(async (origin: string, input: { showId: string, titles?: string[] | null }): Promise<SimilarOutcome> => {
    const answer = answers[`${origin}:${input.showId}`]
    return answer ? answered(answer) : { outcome: 'refused', reason: 'null' }
  })

const claimsFrom = async (fromUri: string) => {
  const { query } = await graphReady()
  const rows = await query(`MATCH (a:Media {uri: $uri})-[c:CLAIMS]->(b:Media) RETURN b.uri AS toUri ORDER BY toUri`, { uri: fromUri })
  return rows.map(claim => claim.toUri)
}

let root: RequestContext

beforeAll(() => {
  setGraphEnabled(true)
  setReadStore('graph')
})
afterAll(async () => {
  setReadStore('legacy')
  setGraphEnabled(false)
  await closeGraph()
})
beforeEach(async () => {
  resetStore()
  resetSimilarAsks()
  const { query } = await graphReady()
  await query('MATCH ()-[c:CLAIMS]->() DELETE c')
  root = openRoot('MEDIA')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  closeRoot(root.rootId)
  vi.restoreAllMocks()
})

const COWBOY_BEBOP = { startDate: '1998-04-03', episodeCount: 26 }
const TRIGUN = { startDate: '1998-04-01', episodeCount: 26 }
const JW_BEBOP_SEASON = row('jw:34435-51923', ['Cowboy Bebop'], COWBOY_BEBOP)
const NF_BEBOP_SEASON = row('nf:80001305-1', ['Cowboy Bebop'], { episodeCount: 26 })

const trigun = () => [
  row('anilist:6', ['Trigun', 'TRIGUN'], { ...TRIGUN, startDate: 'Wed, 01 Apr 1998 00:00:00 GMT', handles: [sameAs(bare('mal:6'))] }),
  row('mal:6', ['Trigun', 'トライガン'], TRIGUN),
  row('kitsu:3', ['Trigun', 'トライガン'], {
    ...TRIGUN,
    handles: [sameAs(bare('mal:6')), sameAs(bare('anilist:6')), partOf(row('cr:GYP58QMMY', ['Trigun']))],
  }),
]

/** Cowboy Bebop's JustWatch season, which the address pins by its own id and joins to whatever else it names. */
const bebopOnJustWatch = (uri: string) => addressed(row('jw:34435-51923', ['Cowboy Bebop'], {
  ...COWBOY_BEBOP,
  handles: [partOf(bare('nf:80001305')), partOf(row('jw:34435', ['Cowboy Bebop']))],
}), uri)

// Mutations: `agreeingRows` returning its cluster is today's code, which asks all three, and JustWatch's and Netflix's
// seasons are claimed as Trigun's; `upsertMedia` taking an address claim as a source's reddens it the same way.
test('a season only a mixed address joined is asked about nothing, and its show is not the run\'s', async () => {
  const uri = 'ag:(jw:34435,mal:6)'
  // JustWatch's answer lands first, as it did: its claim on mal:6 waits for that row, and must stay an address's
  await land(bebopOnJustWatch(uri))
  await land(...trigun())
  const cluster = await findMediaForPage(uri)
  expect(cluster.map(media => media.uri), 'the page\'s read still joins what the address names').toContain('jw:34435-51923')

  const ask = asking({ 'jw:34435': JW_BEBOP_SEASON, 'nf:80001305': NF_BEBOP_SEASON })
  await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin), 'only the show a source hung the run off').toEqual(['cr'])
  expect(ask.mock.calls[0]![1].titles).toEqual(['Trigun', 'TRIGUN', 'トライガン'])
  expect(await claimsFrom('anilist:6')).toEqual([])
})

// Mutation: as above, and Cowboy Bebop's title in the evidence passes the answer naming it.
test('an answer naming the other show of a mixed address is refused by its title', async () => {
  const uri = 'ag:(jw:34435,mal:6)'
  await land(...trigun(), bebopOnJustWatch(uri))
  const cluster = await findMediaForPage(uri)

  await resolveSimilarRuns(cluster, root, { ask: asking({ 'cr:GYP58QMMY': row('cr:GYP58QMMY-1', ['Cowboy Bebop']) }), implemented })

  expect(await claimsFrom('anilist:6')).toEqual([])
})

// The address names two catalogues of two shows and no JustWatch id: JustWatch found Trigun by its title and rebuilt
// handles to both ids, so the rows of each show are one cluster anchored on the other's AniList row (through the relays).
// Mutation: as above, and Trigun's JustWatch season is claimed as Cowboy Bebop's.
test('a search hit stays out of a show an address names beside the one it was found for', async () => {
  const uri = 'ag:(mal:6,kitsu:1)'
  await land(
    row('anilist:1', ['Cowboy Bebop', 'カウボーイビバップ'], { handles: [sameAs(bare('mal:1'))] }),
    row('kitsu:1', ['Cowboy Bebop', 'カウボーイビバップ'], { handles: [sameAs(bare('mal:1')), sameAs(bare('anilist:1'))] }),
    row('mal:6', ['Trigun', 'トライガン']),
    addressed(row('jw:22056-26907', ['Trigun'], { handles: [partOf(row('jw:22056', ['Trigun']))] }), uri),
  )
  const cluster = await findMediaForPage(uri)
  expect(cluster.map(media => media.uri).sort()).toEqual(['anilist:1', 'jw:22056-26907', 'kitsu:1', 'mal:6'])

  const ask = asking({ 'jw:22056': row('jw:22056-26907', ['Trigun']) })
  await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask).not.toHaveBeenCalled()
  expect(await claimsFrom('anilist:1')).toEqual([])
})

const FRIEREN = 'ag:(anilist:154587,mal:52991)'
const FRIEREN_NF = "Frieren: Beyond the Journey's End"

const frieren = () => [
  row('anilist:154587', ['Frieren: Beyond Journey’s End', 'Sousou no Frieren', '葬送のフリーレン'], {
    startDate: 'Fri, 29 Sep 2023 00:00:00 GMT',
    episodeCount: 28,
    handles: [sameAs(bare('mal:52991'))],
  }),
  row('kitsu:46474', ['Frieren: Beyond Journey’s End', 'Sousou no Frieren', '葬送のフリーレン'], {
    startDate: '2023-09-29',
    episodeCount: 28,
    handles: [sameAs(bare('mal:52991')), sameAs(bare('anilist:154587')), partOf(bare('cr:GG5H5XQX4')), partOf(bare('nf:81726714'))],
  }),
  addressed(row('jw:364792-373583', ["Frieren: Beyond Journey's End"], {
    startDate: '2023-09-29',
    episodeCount: 28,
    handles: [partOf(bare('nf:81726714')), partOf(row('jw:364792', ["Frieren: Beyond Journey's End"]))],
  }), FRIEREN),
  row('nf:81726714-1', [FRIEREN_NF], { episodeCount: 28, handles: buildHandlesFromUri(FRIEREN, 'nf') }),
]

// The merge that rests on an address's ids: Netflix's row is a search hit only the address joins, its title scores 0.842
// against the run's, and that title in the evidence is what passes its own answer.
// Mutation: hold the rows to the answers' 0.9, and Netflix's season is refused by title.
test('a real address asks and claims as it did, a search hit\'s own title vouching for its answer', async () => {
  await land(...frieren())
  const cluster = await findMediaForPage(FRIEREN)

  const ask = asking({
    'cr:GG5H5XQX4': row('cr:GG5H5XQX4-GYE5CQMQ5', ["Frieren: Beyond Journey's End"]),
    'jw:364792': row('jw:364792-373583', ["Frieren: Beyond Journey's End"]),
    'nf:81726714': row('nf:81726714-1', [FRIEREN_NF]),
  })
  await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin).sort()).toEqual(['cr', 'jw', 'nf'])
  expect(ask.mock.calls[0]![1].titles).toContain(FRIEREN_NF)
  expect(await claimsFrom('anilist:154587')).toEqual(['cr:GG5H5XQX4-GYE5CQMQ5', 'jw:364792-373583', 'nf:81726714-1'])
})

// Netflix's `Ace of Diamond` clears the search gate only on a shortened title (`simplifyTitle`): 0.308 on the whole ones.
// Mutation: hold it to the whole titles, and its season is refused by title.
test('a search hit found on a shorter title stays', async () => {
  const uri = 'ag:(anilist:177634,mal:58877)'
  await land(
    row('anilist:177634', ['Ace of the Diamond act II -Second Season-', 'Diamond no Ace act II: Second Season'], { handles: [sameAs(bare('mal:58877'))] }),
    row('kitsu:48878', ['ダイヤのA actII -Second Season-'], { handles: [sameAs(bare('anilist:177634')), partOf(bare('nf:81424512'))] }),
    row('nf:81424512-1', ['Ace of Diamond'], { handles: buildHandlesFromUri(uri, 'nf') }),
  )

  const ask = asking({ 'nf:81424512': row('nf:81424512-1', ['Ace of Diamond']) })
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(await claimsFrom('anilist:177634')).toEqual(['nf:81424512-1'])
})

// JustWatch titles a season by its own name, which agrees with nothing: the show its row hangs off is what names it, and
// the offers on that row are what make Netflix askable here.
// Mutation: read a row's titles alone, and neither season is asked for.
test('a season titled by its arc is read with the show its source hangs it off', async () => {
  const uri = 'ag:(anilist:101922,mal:38000)'
  await land(
    row('anilist:101922', ['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba', '鬼滅の刃'], {
      startDate: '2019-04-06',
      episodeCount: 26,
      handles: [sameAs(bare('mal:38000'))],
    }),
    addressed(row('jw:87466-102514', ['Unwavering Resolve Arc'], {
      startDate: '2019-04-06',
      episodeCount: 26,
      handles: [partOf(bare('nf:81091393')), partOf(row('jw:87466', ['Demon Slayer: Kimetsu no Yaiba']))],
    }), uri),
  )

  const ask = asking({
    'jw:87466': row('jw:87466-102514', ['Unwavering Resolve Arc']),
    'nf:81091393': row('nf:81091393-1', ['Demon Slayer: Kimetsu no Yaiba']),
  })
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(await claimsFrom('anilist:101922')).toEqual(['jw:87466-102514', 'nf:81091393-1'])
})

// A season's address handles skip its own origin, so a show of the origin is its source's word: a show of another origin
// can be the address's, which names one by its bare id, and vouches for nothing.
// Mutation: read every show a row hangs off, and the Netflix season is asked for.
test('a show only the address hung a row off says nothing of that row', async () => {
  const uri = 'ag:(jw:34435-51923,mal:6,tvdb:77680)'
  await land(...trigun(), row('tvdb:77680', ['Trigun', 'TRIGUN'], { scope: 'CONTAINER' }), bebopOnJustWatch(uri))
  const cluster = await findMediaForPage('ag:(mal:6)')
  expect(cluster.map(media => media.uri)).toContain('jw:34435-51923')

  const ask = asking({ 'nf:80001305': NF_BEBOP_SEASON })
  await resolveSimilarRuns(cluster, root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin)).toEqual(['cr'])
})

// A catalogue's row often lands before its titles do, which says nothing against it.
// Mutation: hold a claimed row to the titles too, and the show it hangs off is never asked.
test('a row a source claims stays, with no title to check', async () => {
  await land(
    row('anilist:6', ['Trigun'], TRIGUN),
    row('kitsu:3', [], { ...TRIGUN, handles: [sameAs(bare('anilist:6')), partOf(bare('cr:GYP58QMMY'))] }),
  )

  const ask = asking({})
  await resolveSimilarRuns(await findMediaForPage('ag:(anilist:6)'), root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin)).toEqual(['cr'])
})
