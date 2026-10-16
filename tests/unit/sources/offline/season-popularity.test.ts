// The owner's target, with two screenshots on 2026-09-05: a cold "Current season" must lead with
// Mushoku Tensei, Saga of Tanya the Evil II, Smoking Behind the Supermarket and Bleach. That order is
// MyAnimeList's member count, which the live jikan source publishes at score 0.9 and which therefore
// wins the aggregate. manami ships no popularity at all, so the bundle could only sort by its 1 to 10
// rating: 37 of 219 records carry one and its top is three shows tied at a perfect 10 from a handful
// of votes. The build attaches the real counts, measured 2026-09-06:
//   254638 Mushoku Tensei III | 233645 Youjo Senki II | 161220 Super no Ura de Yani Suu Futari
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vite-plus/test'

import { seasonMedia } from '../../../../src/sources/offline/normalize'
import { orderSeasonBucket } from '../../../../scripts/season-order.mjs'
import { anilistPairs, errorText, malSeason, malSeasonData, malSeasons, withMalSeasons } from '../../../../scripts/season-popularity.mjs'
import index from '../../../../src/generated/anime-index'
import built from '../../../../src/generated/anime-seasons'
import { readIndex, type IndexBundle } from '../../../../src/sources/offline/index-lookup'
import { identify, type CatalogLookup } from '../../../../src/tracking/identity'
import { toAggregatedUri, type Uri } from '../../../../src/utils/uri'

const record = (t: string, over: { sc?: number, pop?: number, ml?: number, al?: number } = {}) => ({ t, ty: 'TV', p: '', ...over })

test('member counts decide the order, so the season leads with what MyAnimeList says is popular', () => {
  const bucket = [
    record('Clevatess II', { sc: 10 }),
    record('Mushoku Tensei III', { sc: 8.96, pop: 254_638 }),
    record('Youjo Senki II', { sc: 8.44, pop: 233_645 }),
  ]

  expect(orderSeasonBucket(bucket).map(entry => entry.t))
    .toEqual(['Mushoku Tensei III', 'Youjo Senki II', 'Clevatess II'])
})

test('a record with no member count falls behind every record that has one, however it is rated', () => {
  const bucket = [record('Rated Ten', { sc: 10 }), record('Modest But Watched', { pop: 500 })]

  expect(orderSeasonBucket(bucket).map(entry => entry.t), 'a 10 from three votes is not popularity')
    .toEqual(['Modest But Watched', 'Rated Ten'])
})

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../jikan/__fixtures__/${name}`, import.meta.url)), 'utf8')
// Real bytes of myanimelist.net/anime/season: two cards under "TV (New)", One Piece and Meitantei Conan
// under "TV (Continuing)".
const page = fixture('mal-season-sections.html')
const summer = fixture('mal-season-summer-2026.html')
const fall = fixture('mal-season-fall-2026.html')
const SUMMER = 'https://myanimelist.net/anime/season/2026/summer'
const FALL = 'https://myanimelist.net/anime/season/2026/fall'

const answering = (...answers: (Response | Error)[]) => {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('asked too often')
    return answer
  }
  return { get, asked }
}

// MyAnimeList answers a season it has no page for (2027 summer and fall, measured 2026-10-16) with a
// 303 to /anime/season, which is the season running now.
const site = (pages: Record<string, string | number>) => {
  const asked: string[] = []
  const get = async (url: string, init?: RequestInit) => {
    asked.push(url)
    const answer = pages[url]
    if (typeof answer === 'number') return new Response('', { status: answer })
    if (answer !== undefined) return new Response(answer)
    return init?.redirect === 'manual' ? new Response(null, { status: 303, headers: { location: '/anime/season' } }) : new Response(fall)
  }
  return { get, asked }
}

const summerPages = async () => (await malSeasons(['2026-SUMMER'], site({ [SUMMER]: summer }).get, 0)).pages

test('the build reads every bundled season off its own MyAnimeList page', async () => {
  const { get, asked } = site({ [SUMMER]: summer, [FALL]: fall })

  const { pages } = await malSeasons(['2026-SUMMER', '2026-FALL'], get, 0)

  expect(asked).toEqual([SUMMER, FALL])
  expect(pages.get('2026-SUMMER')?.get(59193)?.members, 'Mushoku Tensei III, listed for Summer only').toBe(367_295)
  expect(pages.get('2026-FALL')?.get(54344)?.members).toBe(13_337)
})

test('a season page that fails keeps the counts already read, and asks MyAnimeList nothing more', async () => {
  const { get, asked } = site({ [SUMMER]: summer, [FALL]: 403 })

  const { pages, failed } = await malSeasons(['2026-SUMMER', '2026-FALL', '2027-WINTER'], get, 0)

  expect(pages.get('2026-SUMMER')?.get(59193)?.members).toBe(367_295)
  expect([...pages.keys()]).toEqual(['2026-SUMMER'])
  expect(errorText(failed.get('2026-FALL'))).toBe(`${FALL} answered HTTP 403`)
  expect(asked, 'three attempts at Fall, then nothing').toEqual([SUMMER, FALL, FALL, FALL])
})

// The offline database's dump lists Summer 2026 before Fall 2026 (measured 2026-10-16), and the home
// page's row and hero read the season running now.
test('a failing page listed before the season running now still leaves that season its counts, synopses and R18+ drop', async () => {
  const { get, asked } = site({ [SUMMER]: 504, [FALL]: fall })
  const seasons = {
    '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193 })],
    '2026-FALL': [record('Mahou Shoujo Ikusei Keikaku: Restart', { ml: 54344 }), record('Kanojo no Tomodachi', { ml: 64131 })],
  }

  const laid = await malSeasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })

  expect(asked).toEqual([FALL, SUMMER, SUMMER, SUMMER])
  expect(laid.seasons['2026-FALL'].map(entry => [entry.ml, entry.pop, Boolean(entry.sy)])).toEqual([[54344, 13_337, true], [64028, 325, false]])
  expect(errorText(laid.failed.get('2026-SUMMER'))).toBe(`${SUMMER} answered HTTP 504`)
})

test('with no season named, the season the clock is in is asked first and keeps the synopses', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-01T12:00:00Z'))
  try {
    const { get, asked } = site({ [SUMMER]: summer, [FALL]: fall })

    const laid = await malSeasonData({ '2026-FALL': [], '2026-SUMMER': [] }, [], { get, pauseMs: 0 })

    expect(asked).toEqual([SUMMER, FALL])
    expect(laid.seasons['2026-SUMMER'].map(entry => Boolean(entry.sy))).toEqual([true, true])
    expect(laid.seasons['2026-FALL'].some(entry => entry.sy)).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('past its time budget the run asks MyAnimeList nothing more', async () => {
  const { get, asked } = site({ [SUMMER]: summer, [FALL]: fall })
  const slow = async (url: string, init?: RequestInit) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return get(url, init)
  }

  const { pages, failed } = await malSeasons(['2026-FALL', '2026-SUMMER'], slow, 0, 0)

  expect([...pages.keys()]).toEqual(['2026-FALL'])
  expect(errorText(failed.get('2026-SUMMER'))).toBe('not asked after 0 s')
  expect(asked).toEqual([FALL])
})

test('an added show takes its AniList id from arm\'s rows', async () => {
  const arm = [{ mal_id: 61469, anilist_id: 210482 }, { mal_id: 59193 }]

  const laid = await malSeasonData({ '2026-SUMMER': [] }, arm, { now: '2026-FALL', get: site({ [SUMMER]: summer }).get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].map(entry => [entry.ml, entry.al])).toEqual([[59193, undefined], [61469, 210482]])
})

test('a season MyAnimeList has no page for lists nothing, rather than the season running now', async () => {
  const { get, asked } = site({})

  const { pages } = await malSeasons(['2027-SUMMER'], get, 0)

  expect(pages.get('2027-SUMMER')?.size).toBe(0)
  expect(asked, 'a redirect is an answer, not a fault to retry').toHaveLength(1)
})

// The live `mal` source drops the same block, so the bundle never counts a show it does not list.
test('shows MyAnimeList carries over from earlier seasons get no count', async () => {
  const counts = await malSeason('2026-SUMMER', answering(new Response(page)).get, 0)

  expect([...counts.keys()].sort((a, b) => a - b)).toEqual([49233, 59193])
})

test('a failed read is retried, so one transient refusal does not cost a deploy its order', async () => {
  const { get, asked } = answering(new TypeError('fetch failed'), new Response('', { status: 503 }), new Response(page))

  expect((await malSeason('2026-SUMMER', get, 0)).size).toBe(2)
  expect(asked).toHaveLength(3)
})

test('when every read fails the error says what the last one was', async () => {
  await expect(malSeason('2026-SUMMER', answering(new Response('', { status: 403 }), new Response('', { status: 403 }), new Response('', { status: 403 })).get, 0))
    .rejects.toThrow(`${SUMMER} answered HTTP 403`)
  await expect(malSeason('2026-SUMMER', answering(new Response('<html></html>'), new Response('<html></html>'), new Response('<html></html>')).get, 0))
    .rejects.toThrow('parsed to no entries from 13 bytes')
})

test('every bundled record carries the member count MyAnimeList shows for it, so a past season paints in its final order', async () => {
  const seasons = { '2026-SUMMER': [record('Rated Ten', { ml: 1, sc: 10 }), record('Mushoku Tensei III', { ml: 59193, sc: 8.9 })] }

  const laid = withMalSeasons(seasons, await summerPages(), '2026-FALL')

  expect(laid['2026-SUMMER'].map(entry => [entry.ml, entry.pop])).toEqual([[59193, 367_295], [61469, 247_199], [1, undefined]])
})

// Measured 2026-10-16: the offline database files Link Click III in Summer and MyAnimeList lists it in Fall.
test('a record takes its count from whichever season\'s page lists it', async () => {
  const laid = withMalSeasons({ '2026-FALL': [record('Mushoku Tensei III', { ml: 59193 })] }, await summerPages(), '2026-FALL')

  expect(laid['2026-FALL'].find(entry => entry.ml === 59193)?.pop).toBe(367_295)
})

// Steel Ball Run is #4 of Summer 2026 by members, and the offline database files it with no MyAnimeList id.
test('a show MyAnimeList lists for a season that its bucket lacks is added from its card, with its count', async () => {
  const laid = withMalSeasons({ '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193 })] }, await summerPages(), '2026-FALL')
  const added = laid['2026-SUMMER'].find(entry => entry.ml === 61469)

  expect(added).toEqual({ t: 'Steel Ball Run: JoJo no Kimyou na Bouken', ty: 'ONA', p: '1065/158884l.webp', ml: 61469, sc: 9.05, pop: 247_199 })

  const media = seasonMedia(added!, '2026-SUMMER')
  expect(media?.handles.map(handle => handle.node.uri), 'the uri the live MyAnimeList source answers with').toEqual(['mal:61469'])
  expect(media?.covers[0]?.url).toBe('https://cdn.myanimelist.net/images/anime/1065/158884l.webp')
  expect([media?.season, media?.seasonYear, media?.popularity]).toEqual(['SUMMER', 2026, 247_199])
})

// Measured 2026-10-16 on the Fall 2026 page: asked in English (`en`, `en-US`) its cards carry 89 English
// titles, asked as node's fetch asks (`Accept-Language: *`) or in Japanese none, and nothing else on a
// card changes. The live source leads with that English title (score 0.9), and its romaji one (0.4) is
// still above the bundle's (0.2).
const english = fixture('mal-season-fall-2026-english.html')
const inEnglishOnly = async (_url: string, init?: RequestInit) => new Response(new Headers(init?.headers).get('accept-language')?.startsWith('en')
  ? english
  : english.replace(/<h3 class="h3_anime_subtitle">[^<]*<\/h3>/g, ''))

test('a record takes the title its MyAnimeList card shows, its English one first', async () => {
  const seasons = { '2026-FALL': [record('Black Clover (2026)', { ml: 61967 }), record('Cyberpunk Edgerunners (2026)', { ml: 61990 })] }

  const laid = await malSeasonData(seasons, [], { now: '2026-FALL', get: inEnglishOnly, pauseMs: 0 })

  expect(laid.seasons['2026-FALL'].map(entry => [entry.ml, entry.t])).toEqual([
    [61469, 'Steel Ball Run: JoJo\'s Bizarre Adventure'],
    [61967, 'Black Clover Season 2'],
    [61990, 'Cyberpunk: Edgerunners 2'],
  ])
})

// Measured 2026-10-16: MyAnimeList lists Steel Ball Run on both the Summer and the Fall 2026 page, as the
// live source then answers it for both.
test('a show MyAnimeList lists in two seasons is in both buckets', async () => {
  const card = (await summerPages()).get('2026-SUMMER')!.get(61469)!
  const pages = new Map([['2026-SUMMER', new Map([[61469, card]])], ['2026-FALL', new Map([[61469, card]])]])

  const laid = withMalSeasons({ '2026-SUMMER': [], '2026-FALL': [] }, pages, '2026-FALL')

  expect([laid['2026-SUMMER'].map(entry => entry.ml), laid['2026-FALL'].map(entry => entry.ml)]).toEqual([[61469], [61469]])
})

// Measured 2026-10-16: the offline database files Link Click III in Summer and MyAnimeList lists it in
// Fall, so the live source answers it for Fall as well.
test('a show another bucket holds is still added to the season whose page lists it, with its episodes', async () => {
  const card = (await summerPages()).get('2026-SUMMER')!.get(59193)!
  const seasons = { '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193 })], '2026-FALL': [] }

  const laid = withMalSeasons(seasons, new Map([['2026-FALL', new Map([[59193, card]])]]), '2026-FALL')

  expect(laid['2026-FALL'].map(entry => [entry.ml, entry.ep, entry.pop])).toEqual([[59193, 14, 367_295]])
})

// Measured 2026-10-16: the offline database pairs Steel Ball Run's 1st stage (mal 61469) with AniList 190327
// and its 2nd Stage (mal 63825) with AniList 210482, while AniList ties 210482 to mal 61469. The trackers
// read the offline database's pairs, so a record naming 61469 and 210482 is two shows to them.
const steelBallRun = { lookup: (origin: string, id: number) =>
  [{ mal: 61469, anilist: 190327 }, { mal: 63825, anilist: 210482 }].find(row => row[origin as 'mal' | 'anilist'] === id) } as CatalogLookup

// the address a card on the page carries: the record's own uri with every id it names
const cardUri = (entry: ReturnType<typeof record>) => {
  const media = seasonMedia(entry, '2026-SUMMER')!
  return toAggregatedUri([media.uri, ...media.handles.map(handle => handle.node.uri)] as Uri[])
}

test('an added show takes the offline database\'s AniList id over arm\'s, and none arm pairs with another show', () => {
  const arm = [{ mal_id: 61469, anilist_id: 210482 }, { mal_id: 1, anilist_id: 11 }, { mal_id: 2, anilist_id: 210482 }]

  expect([...anilistPairs(arm, [[61469, 190327], [63825, 210482]])].sort(([a], [b]) => a - b)).toEqual([[1, 11], [61469, 190327], [63825, 210482]])
  expect(anilistPairs(arm, [[63825, 210482]]).has(61469), 'arm\'s pair names the offline database\'s 2nd Stage').toBe(false)
})

test('a bundled record keeps its own ids beside a listed show, and the trackers can tell both apart', async () => {
  const seasons = { '2026-SUMMER': [record('Steel Ball Run 2nd Stage', { ml: 63825, al: 210482 })] }
  const anilistOf = anilistPairs([{ mal_id: 61469, anilist_id: 210482 }], [[61469, 190327], [63825, 210482]])

  const laid = withMalSeasons(seasons, await summerPages(), '2026-FALL', anilistOf)

  expect(laid['2026-SUMMER'].map(entry => [entry.t, entry.ml, entry.al])).toEqual([
    ['Mushoku Tensei III: Isekai Ittara Honki Dasu', 59193, undefined],
    ['Steel Ball Run: JoJo no Kimyou na Bouken', 61469, 190327],
    ['Steel Ball Run 2nd Stage', 63825, 210482],
  ])
  for (const entry of laid['2026-SUMMER']) expect(identify(cardUri(entry), steelBallRun).kind, entry.t).not.toBe('ambiguous')
  expect(identify(cardUri({ ...record('welded'), ml: 61469, al: 210482 }), steelBallRun).kind, 'the control: the pair AniList gives').toBe('ambiguous')
})

// The build's own output against the index the trackers read: on 2026-10-16 both Steel Ball Run records
// named AniList 210482 with mal 61469, and AniList and MyAnimeList both refused to track them.
test('no record of the built seasons names ids the trackers read as two shows', () => {
  const catalog = readIndex(index as IndexBundle)
  const { seasons } = built as unknown as { seasons: Record<string, Parameters<typeof seasonMedia>[0][]> }
  const welded = Object.entries(seasons).flatMap(([key, records]) => records
    .map(entry => seasonMedia(entry, key))
    .filter(media => media !== undefined)
    .map(media => toAggregatedUri([media.uri, ...media.handles.map(handle => handle.node.uri)] as Uri[]))
    .filter(uri => identify(uri, catalog).kind === 'ambiguous'))

  expect(welded).toEqual([])
})

test('a bundled record is never re-pointed to the show arm ties its AniList id to', async () => {
  const seasons = { '2026-SUMMER': [record('Steel Ball Run 2nd Stage', { ml: 63825, al: 210482 })] }

  const laid = withMalSeasons(seasons, await summerPages(), '2026-FALL', new Map([[61469, 210482]]))

  expect(laid['2026-SUMMER'].find(entry => entry.t === 'Steel Ball Run 2nd Stage')?.ml).toBe(63825)
})

test('a record MyAnimeList lists under its own id keeps it, whichever show arm ties its AniList id to', async () => {
  const seasons = { '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193, al: 166873 })] }

  const laid = withMalSeasons(seasons, await summerPages(), '2026-FALL', new Map([[61469, 166873]]))

  expect(laid['2026-SUMMER'].map(entry => [entry.t, entry.ml])).toEqual([
    ['Mushoku Tensei III: Isekai Ittara Honki Dasu', 59193],
    ['Steel Ball Run: JoJo no Kimyou na Bouken', 61469],
  ])
})

// The title page reads whichever bucket holds the id first: a Steel Ball Run card on the Fall page opened
// the Summer record, which named no AniList show, so the page lost AniList's relations.
test('a show in two buckets names the same shows in both', async () => {
  const card = (await summerPages()).get('2026-SUMMER')!.get(61469)!
  const pages = new Map([['2026-SUMMER', new Map([[61469, card]])], ['2026-FALL', new Map([[61469, card]])]])
  const anilistOf = anilistPairs([{ mal_id: 61469, anilist_id: 210482 }], [[61469, 190327], [63825, 210482]])

  const laid = withMalSeasons({ '2026-SUMMER': [], '2026-FALL': [] }, pages, '2026-FALL', anilistOf)
  const named = (key: string) => seasonMedia(laid[key][0], key)?.handles.map(handle => handle.node.uri)

  expect(named('2026-SUMMER')).toEqual(['mal:61469', 'anilist:190327'])
  expect(named('2026-FALL')).toEqual(named('2026-SUMMER'))
})

test('an R18+ title is in no season, whether the offline database or MyAnimeList brings it', async () => {
  const laid = withMalSeasons({ '2026-SUMMER': [record('Ushiro no Shoumen Kamui-san', { ml: 63468 })] }, await summerPages(), '2026-FALL')
  const listed = laid['2026-SUMMER'].map(entry => entry.ml)

  expect(listed, 'in the offline database, marked R18+ on MyAnimeList').not.toContain(63468)
  expect(listed, 'Shoujo Ramune, R18+ and only on MyAnimeList').not.toContain(32587)
  expect(listed).toEqual([59193, 61469])
})

// The hero reads only the season running now, and a synopsis is most of a record's bytes.
test('synopses ride only with the season running now', async () => {
  const seasons = { '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193 })] }

  const now = withMalSeasons(seasons, await summerPages(), '2026-SUMMER')
  const later = withMalSeasons(seasons, await summerPages(), '2026-FALL')

  expect(now['2026-SUMMER'].map(entry => Boolean(entry.sy))).toEqual([true, true])
  expect(later['2026-SUMMER'].map(entry => Boolean(entry.sy))).toEqual([false, false])
})

test('with no page read at all every bucket keeps its rating order, so a failed fetch degrades', () => {
  const seasons = { '2026-SUMMER': [record('Unrated'), record('Well Rated', { sc: 9 }), record('Fairly Rated', { sc: 7 })] }

  expect(withMalSeasons(seasons, new Map(), '2026-FALL')['2026-SUMMER'].map(entry => entry.t))
    .toEqual(['Well Rated', 'Fairly Rated', 'Unrated'])
})

// The exact shape node threw for api.jikan.moe on 2026-10-13, which the build logged as `(page 1 ())`.
test('a connect failure with no message of its own still says what failed', () => {
  const refused = Object.assign(new AggregateError([
    new Error('connect ETIMEDOUT 135.181.39.91:443'),
    new Error('connect ENETUNREACH 2a01:4f9:c010:b863::1:443 - Local (:::0)'),
  ], ''), { code: 'ETIMEDOUT' })

  expect(errorText(refused))
    .toBe('ETIMEDOUT (connect ETIMEDOUT 135.181.39.91:443; connect ENETUNREACH 2a01:4f9:c010:b863::1:443 - Local (:::0))')
  expect(errorText(new TypeError('fetch failed', { cause: refused }))).toContain('fetch failed (ETIMEDOUT (connect ETIMEDOUT')
})

// vitest resolves an extensionless specifier and node does not, so only plain node can show the build
// would die importing the parser.
test('plain node loads the build\'s popularity module', () => {
  const module = fileURLToPath(new URL('../../../../scripts/season-popularity.mjs', import.meta.url))

  expect(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(module)}).then(m => console.log(typeof m.errorText, typeof m.seasonData))`], { encoding: 'utf8' }).trim())
    .toBe('function function')
})

// arm names the AniList id of each show MyAnimeList adds to a season, so it is a contributor to the file
test('the bundled seasons credit arm as well as the offline database', async () => {
  const { sources } = (await import('../../../../src/generated/anime-seasons')).default as unknown as { sources: { name: string }[] }

  expect(sources.map(source => source.name)).toEqual([expect.stringContaining('anime-offline-database'), '@kawaiioverflow/arm'])
})

test('the season data marks MyAnimeList R18+ cards, so the build leaves them out of the season', async () => {
  const counts = await malSeason('2026-FALL', async () => new Response(fall), 0)

  expect(counts.get(64131)?.adult, 'Kanojo no Tomodachi, marked R18+').toBe(true)
  expect(counts.get(54344)?.adult, 'Mahou Shoujo Ikusei Keikaku: Restart').toBe(false)
})
