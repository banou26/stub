// The offline history is stub's own result: each gathered input becomes the media stub's own source answers for
// it, and stub's own merge picks the title, cover, banner and description, as it picks them for a page. The job's
// merge adds every answer the private store keeps, of any source, and a live answer still outranks what it chose.
import { expect, test } from 'vite-plus/test'

import { anizipTitles, historyPicks, historyShards, pick, storedAnswers, type AnidbTitle, type HistoryRecord, type KitsuRow, type PreviewAnswer, type StoredAnswer } from '../../../../scripts/offline-pick'
import { historyMedia } from '../../../../src/sources/offline/history'
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'

const GUNDAM: HistoryRecord = { t: 'Kidou Senshi Gundam', ty: 'TV', p: '1426/112393.jpg', ml: 80, ku: 80, ad: 63 }
const GUNDAM_ANIDB: AnidbTitle[] = [['syn', 'en', 'MSG'], ['official', 'en', 'Mobile Suit Gundam'], ['official', 'ja', '機動戦士ガンダム']]
const kitsuRow = (id: number, attributes: Record<string, unknown>): KitsuRow => ({ id: String(id), attributes })
const GUNDAM_KITSU = kitsuRow(80, {
  titles: { en: 'Mobile Suit Gundam (TV)', en_jp: 'Kidou Senshi Gundam' },
  canonicalTitle: 'Kidou Senshi Gundam',
  synopsis: 'The year is Universal Century 0079.',
  posterImage: { original: 'https://media.kitsu.app/anime/80/poster_image/a.jpg' },
  coverImage: { original: 'https://media.kitsu.app/anime/cover_images/80/original.jpg' },
})

const T1 = '2026-10-25T05:41:00.000Z'
const T2 = '2026-10-26T05:41:00.000Z'
const T3 = '2026-10-27T05:41:00.000Z'
const kept = (source: string, id: string, fetchedAt: string, media: PreviewAnswer['media']): PreviewAnswer => ({ source, id, class: 'full', fetchedAt, media })

// Mutations: take the last unofficial title; take official titles only.
test('AniDB\'s titles pass as api.ani.zip passes them: per language the official one, else the first in the file', () => {
  expect(anizipTitles([['syn', 'en', 'Space Cowboy'], ['official', 'en', 'Cowboy Bebop'], ['syn', 'ja', 'カウボーイ'], ['short', 'ja', 'CB']]))
    .toEqual({ en: 'Cowboy Bebop', ja: 'カウボーイ' })
  expect(anizipTitles([['main', 'x-jat', 'Cowboy Bebop']])).toEqual({})
})

// Mutation: leave the anizip member out.
test('a show heads with AniDB\'s English title over Kitsu\'s and the dump\'s, as anizip outranks both on the page', () => {
  expect(pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU).title).toEqual({ value: 'Mobile Suit Gundam', origin: 'anizip' })
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU).title).toEqual({ value: 'Mobile Suit Gundam (TV)', origin: 'kitsu' })
})

// Mutation: build the anizip member's titles apart from the anizip source's own.
test('an AniDB title escaped once more than XML takes reads as the anizip source decodes it on the page', () => {
  const nine = { t: 'Nine (Original Ban)', ty: 'MOVIE', p: '', ml: 9242, ad: 9242 }
  expect(pick(nine, [['official', 'ja', 'ナイン &lt;オリジナル版&gt;']]).title).toEqual({ value: 'ナイン <オリジナル版>', origin: 'anizip' })
})

// Mutation: drop the MyAnimeList id condition.
test('AniDB\'s titles take part only for a show with a MyAnimeList id, the only address the live anizip source answers', () => {
  const noMal = { t: 'Kidou Senshi Gundam', ty: 'TV', p: '', al: 80, ad: 63 }
  expect(pick(noMal, GUNDAM_ANIDB).title).toEqual({ value: 'Kidou Senshi Gundam', origin: 'offline' })
})

// Mutations: leave out the MyAnimeList cover member; give it to every dump picture.
test('a dump picture on MyAnimeList\'s CDN is the cover over Kitsu\'s poster, and any other loses to it', () => {
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU).cover).toEqual({ value: 'https://cdn.myanimelist.net/images/anime/1426/112393l.webp', origin: 'mal' })
  const planet = { ...GUNDAM, p: 'https://cdn.anime-planet.com/anime/primary/mobile-suit-gundam.jpg' }
  expect(pick(planet, undefined, GUNDAM_KITSU).cover).toEqual({ value: 'https://media.kitsu.app/anime/80/poster_image/a.jpg', origin: 'kitsu' })
})

test('the banner is the merge\'s first, and the description its longest, both here Kitsu\'s', () => {
  const { banner, description } = pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU)
  expect(banner).toEqual({ value: 'https://media.kitsu.app/anime/cover_images/80/original.jpg', origin: 'kitsu' })
  expect(description).toEqual({ value: 'The year is Universal Century 0079.', origin: 'kitsu' })
  expect(pick({ t: 'A', ty: 'TV', p: '' }).description).toBeUndefined()
})

// Mutations: take the first description by score; let a shorter one replace a longer one; take the last of two as long.
test('the description is the longest of the merged ones, as a page and a preview show it, whatever its score', () => {
  const answer = (descriptions: [string, number][]) => kept('kitsu', '80', T3, { descriptions: descriptions.map(([description, score]) => ({ language: 'en', description, score })) })
  expect(pick(GUNDAM, undefined, undefined, { kitsu: answer([['Short.', 0.9], ['A far longer synopsis.', 0.1]]) }).description?.value).toBe('A far longer synopsis.')
  expect(pick(GUNDAM, undefined, undefined, { kitsu: answer([['A far longer synopsis.', 0.1], ['Short.', 0.9]]) }).description?.value).toBe('A far longer synopsis.')
  // of two as long, the better scored, as the page's stable sort keeps it
  expect(pick(GUNDAM, undefined, undefined, { kitsu: answer([['Second.', 0.1], ['First..', 0.9], ['Other..', 0.5]]) }).description?.value).toBe('First..')
})

const RECORDS: HistoryRecord[] = [
  GUNDAM,
  // the same key again: the first record keeps it
  { ...GUNDAM, t: 'Gundam (duplicate)' },
  // no MyAnimeList id, reached from its Kitsu id
  { t: 'Daicon III Opening Animation', ty: 'SPECIAL', p: '', al: 300, ku: 7 },
  // a title Kitsu gives the same as the dump: nothing stored for it
  { t: 'Cowboy Bebop', ty: 'TV', p: '4/19644.jpg', ml: 1, ku: 1 },
]
const picksOf = () => historyPicks(
  RECORDS,
  new Map([[63, GUNDAM_ANIDB]]),
  new Map([[80, GUNDAM_KITSU], [1, kitsuRow(1, { titles: { en: 'Cowboy Bebop' }, canonicalTitle: 'Cowboy Bebop' })]]),
)
const shardsOf = () => historyShards(RECORDS, picksOf().picks)

// Mutations: store a title equal to the dump's; store the cover the dump already gives; let a duplicate key overwrite.
test('the dump\'s set holds its own title and picture, and stub\'s what the merge chose over them', () => {
  const sets = shardsOf()
  expect(sets.dump[80]).toEqual({ 'mal-80': ['Kidou Senshi Gundam', '1426/112393.jpg'] })
  expect(sets.stub[80]).toEqual({ 'mal-80': { t: 'Mobile Suit Gundam', b: 'cover_images/80/original.jpg', d: 'The year is Universal Century 0079.' } })
  expect(sets.dump[1]).toEqual({ 'mal-1': ['Cowboy Bebop', '4/19644.jpg'] })
  expect(sets.stub[1]).toEqual({})
  expect(picksOf().counts).toEqual({ records: 3, anidbTitles: 1, kitsuTitles: 0, kitsuCovers: 0, banners: 1, descriptions: 1, previewed: 0, stored: 0 })
})

// Mutation: leave a record the merge chose nothing for in the picks.
test('a record the merge chose nothing else for has no pick', () => {
  expect([...picksOf().picks.keys()]).toEqual(['mal-80'])
})

// Mutations: store a Kitsu image whole; count a cover as Kitsu's whoever gave it.
test('a Kitsu cover the merge chose keeps only what follows Kitsu\'s prefix, and counts as Kitsu\'s', () => {
  const planet = { ...GUNDAM, p: 'https://cdn.anime-planet.com/anime/primary/mobile-suit-gundam.jpg' }
  const { picks, counts } = historyPicks([planet], new Map(), new Map([[80, GUNDAM_KITSU]]))
  expect(picks.get('mal-80')?.p).toBe('80/poster_image/a.jpg')
  expect(counts.kitsuCovers).toBe(1)
})

// Mutations: drop the pointers; point every record's Kitsu id.
test('a record with no MyAnimeList id is also reached from its Kitsu id, and only such a record', () => {
  const sets = shardsOf()
  expect(sets.dump[7]).toEqual({ 'kitsu-7': 'anilist-300' })
  expect(sets.dump[44]).toEqual({ 'anilist-300': ['Daicon III Opening Animation', ''] })
  expect(Object.keys(sets.dump[80]!)).toEqual(['mal-80'])
})

// Mutation: write the picked title into the dump's entry.
test('the ODbL set holds the dump\'s own title and picture, never AniDB\'s or Kitsu\'s content', () => {
  const dump = JSON.stringify(shardsOf().dump)
  for (const text of ['Mobile Suit Gundam', 'Universal Century', 'cover_images']) expect(dump).not.toContain(text)
})

// Mutations: leave a kept anizip answer out; build the anizip member from AniDB's file when one is kept; join a kept
// answer by the show's MyAnimeList id rather than its AniDB id.
test('an anizip answer kept from a preview heads a show with api.ani.zip\'s own title, over the one AniDB\'s file gives', () => {
  const answer = kept('anizip', '63', T2, { titles: [{ language: 'en', title: 'Mobile Suit Gundam 0079', score: 0.9 }] })
  // control: AniDB's file alone heads it with its official English title
  expect(pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU).title).toEqual({ value: 'Mobile Suit Gundam', origin: 'anizip' })
  expect(pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU, { anizip: answer }).title).toEqual({ value: 'Mobile Suit Gundam 0079', origin: 'anizip' })
  // api.ani.zip answered no English or Japanese title, so the page heads it with Kitsu's, and so does the history
  expect(pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU, { anizip: { ...answer, media: { titles: [] } } }).title).toEqual({ value: 'Mobile Suit Gundam (TV)', origin: 'kitsu' })
  const { picks, counts } = historyPicks([GUNDAM], new Map([[63, GUNDAM_ANIDB]]), new Map([[80, GUNDAM_KITSU]]), new Map([['anizip:63', answer]]))
  expect(picks.get('mal-80')?.t).toBe('Mobile Suit Gundam 0079')
  expect(counts.previewed).toBe(1)
})

// Mutations: take a kept Kitsu answer over a later row; never take one.
test('a Kitsu answer kept from a preview stands for Kitsu\'s row when Kitsu answered it later, and not when the row is newer', () => {
  const row = { ...GUNDAM_KITSU, fetchedAt: T2 }
  const answer = (fetchedAt: string) => kept('kitsu', '80', fetchedAt, {
    score: 0.3,
    titles: [{ language: 'en', title: 'Mobile Suit Gundam (TV)', score: 0.3 }],
    descriptions: [{ language: 'en', description: 'An edited synopsis.', score: 0.3 }],
    covers: [{ url: 'https://media.kitsu.app/anime/80/poster_image/b.jpg', score: 0.3 }],
    banners: [],
  })
  expect(pick(GUNDAM, undefined, row, { kitsu: answer(T3) }).description).toEqual({ value: 'An edited synopsis.', origin: 'kitsu' })
  expect(pick(GUNDAM, undefined, row, { kitsu: answer(T1) }).description).toEqual({ value: 'The year is Universal Century 0079.', origin: 'kitsu' })
  expect(pick(GUNDAM, undefined, undefined, { kitsu: answer(T1) }).description).toEqual({ value: 'An edited synopsis.', origin: 'kitsu' })
  const { picks } = historyPicks([GUNDAM], new Map(), new Map([[80, row]]), new Map([['kitsu:80', answer(T3)]]))
  expect(picks.get('mal-80')).toEqual({ t: 'Mobile Suit Gundam (TV)', d: 'An edited synopsis.' })
})

const RUN = 'ag:(anilist:900,kitsu:80,mal:80)'
const stored = (source: string, id: string, fields: Partial<StoredAnswer> & { media?: PreviewAnswer['media'] } = {}): StoredAnswer =>
  ({ source, id, class: 'full', fetchedAt: T2, role: 'member', run: RUN, media: {}, ...fields })
const titled = (title: string, score = 0.9) => ({ score, titles: [{ language: 'en', title, score }] })
const described = (description: string, score = 0.9) => ({ score, descriptions: [{ language: 'en', description, score }] })
const picked = (records: HistoryRecord[], answers: StoredAnswer[]) => historyPicks(records, new Map(), new Map(), new Map(), storedAnswers(records, answers))
const titleOf = (records: HistoryRecord[], answers: StoredAnswer[], key = 'mal-80') => picked(records, answers).picks.get(key)?.t

// Mutation: leave the stored answers out of the members.
test('an AniList title no open source gives heads the show, and reaches the shards', () => {
  const { picks, counts } = picked([GUNDAM], [stored('anilist', '900', { media: titled('Mobile Suit Gundam') })])
  expect(picks.get('mal-80')).toEqual({ t: 'Mobile Suit Gundam' })
  expect(counts.stored).toBe(1)
  expect(historyShards([GUNDAM], picks).stub[80]).toEqual({ 'mal-80': { t: 'Mobile Suit Gundam' } })
})

// Mutations: count every title as AniDB's or Kitsu's; count a cover as Kitsu's whoever gave it.
test('a title and a cover from another source count as neither AniDB\'s nor Kitsu\'s, so the build\'s floor stays about AniDB', () => {
  const cover = 'https://img.anili.st/media/900'
  const answers = [stored('anilist', '900', { media: { ...titled('Mobile Suit Gundam'), covers: [{ url: cover, score: 0.9 }] } })]
  const { picks, counts } = historyPicks([{ ...GUNDAM, p: '' }], new Map([[63, GUNDAM_ANIDB]]), new Map(), new Map(), storedAnswers([GUNDAM], answers))
  expect(picks.get('mal-80')).toMatchObject({ t: 'Mobile Suit Gundam', p: cover })
  expect([counts.anidbTitles, counts.kitsuTitles, counts.kitsuCovers]).toEqual([0, 0, 0])
  const overKitsu = historyPicks([{ ...GUNDAM, p: '' }], new Map(), new Map([[80, GUNDAM_KITSU]]), new Map(), storedAnswers([GUNDAM], answers))
  expect([overKitsu.counts.anidbTitles, overKitsu.counts.kitsuTitles, overKitsu.counts.kitsuCovers]).toEqual([0, 0, 0])
  // control: with no stored answer they are AniDB's and Kitsu's
  const alone = historyPicks([{ ...GUNDAM, p: '' }], new Map([[63, GUNDAM_ANIDB]]), new Map([[80, GUNDAM_KITSU]]))
  expect([alone.counts.anidbTitles, alone.counts.kitsuTitles, alone.counts.kitsuCovers]).toEqual([1, 0, 1])
})

// Mutation: rank a stored description by its score.
test('a stored description ships when it is the longest, whichever source gave it', () => {
  const answers = [
    stored('anilist', '900', { media: described('A synopsis AniList wrote at some length.', 0.1) }),
    stored('jw', '77', { media: described('A short one.', 0.9) }),
  ]
  expect(picked([GUNDAM], answers).picks.get('mal-80')?.d).toBe('A synopsis AniList wrote at some length.')
})

// Mutations: take the newest answer of either class; read full answers only; take the oldest of a class.
test('a source\'s newest full answer stands, else its newest list hit', () => {
  const answer = (cls: 'full' | 'list', fetchedAt: string, title: string) => stored('anilist', '900', { class: cls, fetchedAt, media: titled(title) })
  expect(titleOf([GUNDAM], [answer('full', T1, 'The full one'), answer('list', T3, 'A later list hit')])).toBe('The full one')
  expect(titleOf([GUNDAM], [answer('list', T3, 'A later list hit'), answer('full', T1, 'The full one')])).toBe('The full one')
  expect(titleOf([GUNDAM], [answer('list', T1, 'An older hit'), answer('list', T3, 'The newest hit')])).toBe('The newest hit')
  expect(titleOf([GUNDAM], [answer('full', T3, 'The newest full'), answer('full', T1, 'An older full')])).toBe('The newest full')
})

// Mutations: join only by the run's address; take the first of two runs' list hits for another show.
test('an answer is about the record of its own catalogue id, even as a hit in another show\'s run', () => {
  const other = { t: 'Another show', ty: 'TV', p: '', ml: 81 }
  const hit = stored('mal', '80', { class: 'list', role: null, run: 'ag:(mal:81)', media: titled('Mobile Suit Gundam') })
  const { picks } = picked([GUNDAM, other], [hit])
  expect(picks.get('mal-80')?.t).toBe('Mobile Suit Gundam')
  expect(picks.has('mal-81')).toBe(false)
})

// Mutations: join every answer of a run to its show; drop what joins by the address alone.
test('of the sources no record has an id of, a member of a run\'s address counts, and a related answer or a passed over hit says nothing', () => {
  const member = stored('jw', '77', { media: titled('Its JustWatch title') })
  expect(titleOf([GUNDAM], [member])).toBe('Its JustWatch title')
  expect(titleOf([GUNDAM], [{ ...member, role: 'related' }])).toBeUndefined()
  expect(titleOf([GUNDAM], [{ ...member, role: null }])).toBeUndefined()
})

// Mutation: read the role alone, so a cut run's answers join nothing.
test('a run cut before its card arrived has no roles, and its address joins the answers it names', () => {
  const cut = stored('jw', '77', { role: null, run: 'ag:(jw:77,mal:80)', media: titled('Its JustWatch title') })
  expect(titleOf([GUNDAM], [cut])).toBe('Its JustWatch title')
})

// Mutation: read a plain uri as naming nothing.
test('a run\'s address may be a plain uri, as a crawler asked for it', () => {
  expect(titleOf([GUNDAM], [stored('jw', '77', { run: 'mal:80', media: titled('Its JustWatch title') })])).toBe('Its JustWatch title')
})

// Mutations: name a record by every catalogue of an address, not its most specific; let the last record take a shared id.
test('a Kitsu id two records share lends a MyAnimeList address nothing, and goes to the first record alone', () => {
  const sibling = { t: 'A second cour', ty: 'TV', p: '', ml: 81, ku: 80 }
  const member = stored('jw', '77', { media: titled('Its JustWatch title') })
  const { picks } = picked([sibling, GUNDAM], [member])
  expect([picks.get('mal-80')?.t, picks.has('mal-81')]).toEqual(['Its JustWatch title', false])
  // an address naming only the shared id
  const shared = picked([sibling, GUNDAM], [{ ...member, run: 'ag:(kitsu:80)' }]).picks
  expect([shared.has('mal-80'), shared.get('mal-81')?.t]).toEqual([false, 'Its JustWatch title'])
})

// Mutation: give an address's answers to its first record only.
test('two records one address names are one show on a page, so each takes the run\'s answers', () => {
  const sibling = { t: 'A recap', ty: 'TV', p: '', ml: 81 }
  const { picks } = picked([GUNDAM, sibling], [stored('jw', '77', { run: 'ag:(jw:77,mal:80,mal:81)', media: titled('Its JustWatch title') })])
  expect([picks.get('mal-80')?.t, picks.get('mal-81')?.t]).toEqual(['Its JustWatch title', 'Its JustWatch title'])
})

// Mutation: leave AniList out of the catalogues a record is reached by.
test('an address naming a record only by its AniList id reaches it, as the offline source does', () => {
  const record = { ...GUNDAM, al: 900 }
  expect(titleOf([record], [stored('jw', '77', { run: 'ag:(anilist:900,jw:77)', media: titled('Its JustWatch title') })])).toBe('Its JustWatch title')
})

// Mutation: drop the offline id from what names a record.
test('an address naming a record only by the offline source\'s id reaches it', () => {
  expect(titleOf([GUNDAM], [stored('jw', '77', { run: 'ag:(jw:77,offline:mal-80)', media: titled('Its JustWatch title') })])).toBe('Its JustWatch title')
})

const MAL_COVER = 'https://cdn.myanimelist.net/images/anime/1426/112393l.webp'
const OTHER_COVER = 'https://cdn.myanimelist.net/images/anime/9/other.webp'

// Mutations: put the stored answers after the job's; drop the dump picture's member when MyAnimeList's answer is kept.
test('a stored MyAnimeList cover goes ahead of the dump\'s picture, and one with no cover leaves the picture its rank', () => {
  const answer = (covers: { url: string, score: number }[]) => stored('mal', '80', { media: { ...titled('Mobile Suit Gundam'), covers } })
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU, {}, [answer([{ url: OTHER_COVER, score: 0.9 }])]).cover).toEqual({ value: OTHER_COVER, origin: 'mal' })
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU, {}, [answer([])]).cover?.value).toBe(MAL_COVER)
})

// Mutation: let a stored answer stand beside the row its source is decided by.
test('a stored Kitsu or anizip answer of the record\'s own id leaves the public rule to decide its source', () => {
  const row = { ...GUNDAM_KITSU, fetchedAt: T3 }
  const stale = stored('kitsu', '80', { fetchedAt: T1, media: described('An older synopsis, and a far longer one than Kitsu has now.', 0.3) })
  expect(pick(GUNDAM, undefined, row, {}, [stale]).description?.value).toBe('The year is Universal Century 0079.')
  const anizip = stored('anizip', '63', { media: titled('A second anizip title') })
  expect(pick(GUNDAM, GUNDAM_ANIDB, row, {}, [anizip]).title).toEqual({ value: 'Mobile Suit Gundam', origin: 'anizip' })
})

// Mutation: rank the history's media above the floor.
test('a pick stays at the floor, so a fresher live answer of any source goes ahead of it', () => {
  const entry = { key: 'mal-80', title: 'Kidou Senshi Gundam', picture: '1426/112393.jpg', pick: { t: 'A stored AniList title', d: 'A stored synopsis.' } }
  const floor = historyMedia(entry, [])
  const live = { ...floor, uri: 'jw:77', origin: 'jw', id: '77', score: 0.2, titles: [{ language: 'en', title: 'A live title', score: 0.2 }] }
  const row = aggregateFields({
    cluster: { id: 'x', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
    members: [floor, live].map(member => ({ uri: member.uri, origin: member.origin, id: member.id, owned: true, score: member.score ?? null, raw: member as unknown as Record<string, unknown>, fieldSeq: {} })),
    related: [],
    relations: [],
    locationOrigin: '',
  })
  expect((row.titles as { title: string }[]).map(({ title }) => title)).toEqual(['A live title', 'A stored AniList title'])
  expect([floor.origin, floor.id, floor.score]).toEqual(['offline', 'mal-80', 0.2])
})
