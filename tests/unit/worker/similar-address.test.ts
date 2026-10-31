// What the similar step joins, on answers recorded through the relays on 2026-10-31. The store unions everything an
// address names, so a link naming two shows looks like one cluster: the step takes the rows a source's own claims join
// to the run, those a search could have found, and the seasons of the shows a source names on them. A real address must
// come out exactly as it did.
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

// The merge that rests on an address's ids: Netflix's row is a search hit only the address joins, and its title in the
// evidence is what passes its own answer. Two things keep the row here, its title at 0.842 and Kitsu naming Netflix's show.
// Mutation: drop `agreeingRows`' seasons and hold the rows to the answers' 0.9, and Netflix's season is refused by title.
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
// The recording's Kitsu row names Netflix's show, which keeps the row on its own: here it names Crunchyroll's, so only the
// title does.
// Mutation: hold it to the whole titles, and its title leaves the evidence.
test('a search hit found on a shorter title stays', async () => {
  const uri = 'ag:(anilist:177634,mal:58877)'
  await land(
    row('anilist:177634', ['Ace of the Diamond act II -Second Season-', 'Diamond no Ace act II: Second Season'], { handles: [sameAs(bare('mal:58877'))] }),
    row('kitsu:48878', ['ダイヤのA actII -Second Season-'], { handles: [sameAs(bare('anilist:177634')), partOf(bare('cr:GY8VEQ95Y'))] }),
    row('nf:81424512-1', ['Ace of Diamond'], { handles: buildHandlesFromUri(uri, 'nf') }),
  )

  const ask = asking({})
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(ask.mock.calls[0]![1].titles).toContain('Ace of Diamond')
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

// An address names a show by its bare id and hangs it off whatever row it joins, so that show vouches for nothing.
// Mutations: read every show a row hangs off, or take an address's edge as a source's, and the Netflix season is asked for.
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

const AVATAR = 'Avatar: The Last Airbender'

// A series page has no AniList row, so JustWatch's season anchors the run, and JustWatch titles it by its own name.
// Mutation: drop both the show's titles and the seasons of its shows, and the address's own row goes, then the answer.
test('a real address anchored on a season titled by its own name keeps its rows and its merge', async () => {
  const uri = 'ag:(tmdb:246-s1)'
  await land(
    row('tmdb:246-s1', [AVATAR], { startDate: '2005-02-21', episodeCount: 20 }),
    addressed(row('jw:3371-3253', ['Book One: Water'], {
      startDate: '2005-02-21',
      episodeCount: 20,
      handles: [partOf(bare('nf:70142405')), partOf(row('jw:3371', [AVATAR])), partOf(bare('tmdb:246'))],
    }), uri),
  )

  const ask = asking({ 'nf:70142405': row('nf:70142405-1', [AVATAR]) })
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(ask.mock.calls[0]![1].titles).toContain(AVATAR)
  expect(await claimsFrom('jw:3371-3253')).toEqual(['nf:70142405-1'])
})

// The recording's row also names `tmdb:1413`, which keeps the address's row on its own: left out here, so only the title
// of JustWatch's show ties the two. Netflix's show is a search hit hung off the address's row, and refused the ask.
// Mutation: read the run's rows without their shows, and that row goes and Netflix is never asked.
test('the run is read with the show its source hangs it off', async () => {
  const uri = 'ag:(tmdb:1413-s1)'
  await land(
    row('tmdb:1413-s1', ['American Horror Story'], { startDate: '2011-10-05', episodeCount: 12 }),
    addressed(row('jw:5746-5091', ['Murder House'], {
      startDate: '2011-10-05',
      episodeCount: 12,
      handles: [partOf(row('jw:5746', ['American Horror Story']))],
    }), uri),
    row('nf:81599108', ['Vietnamese Horror Story'], { scope: 'CONTAINER', handles: buildHandlesFromUri(uri, 'nf') }),
  )

  const ask = asking({})
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin)).toContain('nf')
})

const DAHMER = 'DAHMER - Monster: The Jeffrey Dahmer Story'
const DAHMER_TAPES = 'Conversations with a Killer: The Jeffrey Dahmer Tapes'

// JustWatch's offer names Netflix's show and the next address pins its season by that id, with no show of its own on it.
// Netflix titles it "DAHMER", 0.142 and under every gate, and that title in the evidence is what passes its own answer.
// The Netflix search hit beside it clears the search gate at 0.503.
// Mutations: drop the seasons of a source's shows, and its answer is refused; raise the gate, and the hit's title goes.
test('a season of a show a source named stays whatever its title', async () => {
  const uri = 'ag:(tmdb:113988-s1)'
  await land(
    row('tmdb:113988-s1', [DAHMER], { startDate: '2022-09-21', episodeCount: 10 }),
    addressed(row('jw:258748-272033', [DAHMER], {
      startDate: '2022-09-21',
      episodeCount: 10,
      handles: [partOf(bare('nf:81287562')), partOf(row('jw:258748', [DAHMER])), partOf(bare('tmdb:113988'))],
    }), uri),
    row('nf:81173345-1', [DAHMER_TAPES], { episodeCount: 3, handles: buildHandlesFromUri(uri, 'nf') }),
    row('nf:81287562-1', ['DAHMER'], { episodeCount: 10, handles: buildHandlesFromUri('ag:(jw:258748-272033,tmdb:113988-s1)', 'nf') }),
  )

  const ask = asking({ 'nf:81287562': row('nf:81287562-1', ['DAHMER']) })
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect([...ask.mock.calls[0]![1].titles!].sort()).toEqual([DAHMER_TAPES, 'DAHMER', DAHMER].sort())
  expect(await claimsFrom('jw:258748-272033')).toEqual(['nf:81287562-1'])
})

// Not a recording: Dahmer's Netflix season on an AniList page, where JustWatch's row is only kept by its title.
// Mutation: read the shows of the claimed rows alone, and the season goes.
test('a row kept by its title names a show as well as a claimed one', async () => {
  const uri = 'ag:(anilist:101922,mal:38000)'
  await land(
    row('anilist:101922', ['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba'], { handles: [sameAs(bare('mal:38000'))] }),
    addressed(row('jw:87466-102514', ['Demon Slayer: Kimetsu no Yaiba'], { handles: [partOf(bare('nf:81091393'))] }), uri),
    row('nf:81091393-1', ['Tanjiro'], { handles: buildHandlesFromUri(uri, 'nf') }),
  )

  const ask = asking({ 'nf:81091393': row('nf:81091393-1', ['Tanjiro']) })
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(await claimsFrom('anilist:101922')).toContain('nf:81091393-1')
})

// The address hangs Netflix's Cowboy Bebop off Trigun's `mal:6` and joins its season, so the show is asked, and that season
// in the evidence would pass its own answer.
// Mutations: take an address's edge as a source's, or read every show of the kept rows, and it is claimed as Trigun's.
test('a season of a show only the address hung off the run stays out', async () => {
  const uri = 'ag:(mal:6,nf:80001305)'
  await land(
    ...trigun(),
    row('nf:80001305', ['Cowboy Bebop'], { scope: 'CONTAINER', handles: buildHandlesFromUri(uri, 'nf') }),
    row('nf:80001305-1', ['Cowboy Bebop'], { episodeCount: 26, handles: buildHandlesFromUri(uri, 'nf') }),
  )
  const cluster = await findMediaForPage(uri)
  expect(cluster.map(media => media.uri)).toContain('nf:80001305-1')

  await resolveSimilarRuns(cluster, root, { ask: asking({ 'nf:80001305': NF_BEBOP_SEASON }), implemented })

  expect(await claimsFrom('anilist:6')).toEqual([])
})

// Kitsu names Crunchyroll's `cr:GYP58QMMY`, and an id that merely starts with it is another show.
// Mutation: read the show's uri as a bare prefix, and the other show's season is kept.
test('a season is of a show by the show\'s whole id', async () => {
  const uri = 'ag:(cr:GYP58QMMY1-1,mal:6)'
  await land(...trigun(), addressed(row('cr:GYP58QMMY1-1', ['Cowboy Bebop'], { handles: [partOf(bare('nf:80001305'))] }), uri))

  const ask = asking({})
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin)).toEqual(['cr'])
})

// Triage X scores 0.421 against Trigun, just under what a search takes. Its row only an address joined.
// Mutation: loosen the gate, and the show its source hangs it off is asked.
test('a row just under the search gate stays out', async () => {
  const uri = 'ag:(jw:1,mal:6)'
  await land(...trigun(), addressed(row('jw:1-2', ['Triage X'], { handles: [partOf(bare('nf:3'))] }), uri))

  const ask = asking({})
  await resolveSimilarRuns(await findMediaForPage(uri), root, { ask, implemented })

  expect(ask.mock.calls.map(([origin]) => origin)).toEqual(['cr'])
})
