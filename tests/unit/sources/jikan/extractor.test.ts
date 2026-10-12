// The `mal` source's two resolvers, driven against a routed `ctx.fetch` that records every url it is
// asked for and answers with pages saved from myanimelist.net. Which url is asked is half of what a
// page is: a season the source cannot answer must ask for nothing, and nothing may ask api.jikan.moe,
// which shut down on 2026-10-01 and leaves every request waiting until it times out.
import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vite-plus/test'

import { anidbIdFromUrl, resolvers } from '../../../../src/sources/jikan/extractor'
import { animeSeasonOf, mediaSeasonNow } from '../../../../src/sources/season'
import SAMPLES from '../../../fixtures/descriptions/samples.json'

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

const routed = (route: (url: string) => unknown) => {
  const urls: string[] = []
  return {
    urls,
    ctx: {
      fetch: async (url: string) => {
        urls.push(url)
        const answer = route(url)
        if (answer instanceof Error) throw answer
        return answer
      },
    } as never,
  }
}

const html = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body })
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

// every answer the subscription yields, and the last one's media
const mediaFor = async (asked: string, route: (url: string) => unknown, details?: boolean) => {
  const { ctx, urls } = routed(route)
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const answers: any[] = []
  for await (const { media } of subscribe(undefined, { input: { uri: asked, details } }, ctx)) answers.push(media)
  return { media: answers.at(-1), answers, urls }
}

const pageFor = async (input: Record<string, unknown>, ctx: never) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return (value?.mediaPage?.nodes ?? []) as any[]
}

test('a title is read off its myanimelist.net page, with every field Jikan answered', async () => {
  const { media, urls } = await mediaFor('mal:1', () => html(fixture('mal-anime-1.html')))

  expect(urls).toEqual(['https://myanimelist.net/anime/1'])
  expect(media).toMatchObject({
    uri: 'mal:1',
    url: 'https://myanimelist.net/anime/1',
    type: 'TV',
    categories: ['ANIME', 'SERIES'],
    status: 'FINISHED',
    season: 'SPRING',
    seasonYear: 1998,
    startDate: '1998-04-03',
    endDate: '1999-04-24',
    episodeCount: 26,
    popularity: 2091002,
    averageScore: 88,
    genres: ['Action', 'Award Winning', 'Sci-Fi', 'Adult Cast', 'Space'],
    titles: [
      { language: 'en', title: 'Cowboy Bebop', score: 0.9 },
      { language: 'jp-en', title: 'Cowboy Bebop', score: 0.9 },
      { language: 'jp', title: 'カウボーイビバップ', score: 0.9 },
    ],
    covers: [{ language: 'en', url: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp', score: 0.9 }],
    trailers: [{ uri: 'yt:gY5nDXOtv_o', origin: 'yt', id: 'gY5nDXOtv_o', url: 'https://www.youtube.com/watch?v=gY5nDXOtv_o' }],
  })
  // both handles are minted off the page's AniDB link, whose `&amp;` has to be read first
  expect(media.handles.map((handle: any) => [handle.relation, handle.node.uri])).toEqual([
    ['SAME_AS', 'anidb:23'],
    ['SAME_AS', 'anizip:23'],
  ])
  // the credit goes and the paragraphs stay
  expect(media.descriptions[0].description).toMatch(/revenge for his old wounds\.$/)
  expect(media.descriptions[0].description).toContain('corgi.\n\nWhile')
})

test('a film is a movie with no season, and a show not yet aired keeps its partial start', async () => {
  const { media: film } = await mediaFor('mal:199', () => html(fixture('mal-anime-199.html')))
  expect(film).toMatchObject({ type: 'MOVIE', categories: ['ANIME', 'MOVIE'], startDate: '2001-07-20' })
  expect(film.season).toBeUndefined()
  expect(film.seasonYear).toBeUndefined()

  const { media: upcoming } = await mediaFor('mal:63816', () => html(fixture('mal-anime-63816.html')))
  expect(upcoming).toMatchObject({ status: 'NOT_YET_RELEASED', season: 'FALL', seasonYear: 2027, startDate: '2027-10-01' })
  expect(upcoming.averageScore).toBeUndefined()
  expect(upcoming.trailers).toEqual([])
})

// The page's placeholder would otherwise win the description over AniList's real one, at 0.9.
test('a title with no synopsis carries no description', async () => {
  const { media } = await mediaFor('mal:64028', () => html(fixture('mal-anime-64028.html')))
  expect(media.descriptions).toEqual([])
})

// a season card's type 9 is SPECIAL too, so both of the source's paths agree
test('a TV Special is a special, and a type MAL adds later is no type', async () => {
  const typed = (type: string) => mediaFor('mal:1', () => html(
    '<h1 class="title-name h1_bold_none"><strong>X</strong></h1>'
    + `<div class="spaceit_pad"><span class="dark_text">Type:</span> ${type} </div>`
  ))
  expect((await typed('TV Special')).media.type).toBe('SPECIAL')
  expect((await typed('<a href="https://myanimelist.net/topanime.php?type=ova">OVA</a>')).media.type).toBe('OVA')
  expect((await typed('CM')).media.type).toBeUndefined()
})

test('a page that is not a title answers no media, not a half-built one', async () => {
  for (const answer of [html('Not Found', false), html('<html><body>Too many requests</body></html>')]) {
    const { media } = await mediaFor('mal:999999', () => answer)
    expect(media).toBeUndefined()
  }
})

const CREDITS = readFileSync(new URL('../../../fixtures/credits/mal-bebop.html', import.meta.url), 'utf8')

// Mutation: ask the credits page without `details` and the modal's answer reads it too; drop the `_`
// slug and the site answers the title page, which names nobody.
test('only the title page asks the credits page, and its characters and staff ride on the title', async () => {
  const route = (url: string) =>
    url === 'https://myanimelist.net/anime/1' ? html(fixture('mal-anime-1.html'))
    : url === 'https://myanimelist.net/anime/1/_/characters' ? html(CREDITS)
    : html(fixture('mal-anime-1.html'))

  const modal = await mediaFor('mal:1', route)
  expect(modal.urls).toEqual(['https://myanimelist.net/anime/1'])
  expect(modal.answers).toHaveLength(1)
  expect(modal.media).not.toHaveProperty('credits')

  const { media, answers, urls } = await mediaFor('ag:(anilist:1,mal:1)', route, true)
  expect(urls).toEqual(['https://myanimelist.net/anime/1/_/characters', 'https://myanimelist.net/anime/1'])
  expect(answers).toHaveLength(2)
  expect(answers[0]).not.toHaveProperty('credits')
  expect(media.uri).toBe('mal:1')
  expect(media.credits.score).toBe(0.7)
  expect(media.credits.characters.map(({ names }: { names: string[] }) => names[0])).toEqual([
    'Spike Spiegel', 'Faye Valentine', 'Edward Wong Hau Pepelu Tivrusky IV', 'Jet Black', 'Alisa', 'Actress',
  ])
  expect(media.credits.staff).toHaveLength(13)
})

// Mutation: attach whatever parsed, and a page naming nobody answers credits naming nobody, which
// replace an earlier answer's; read a refused page as a page, and it is dropped with no log line.
test('a credits page that fails or names nobody adds no credits, and the title still answers', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const answers = [
    [html(fixture('mal-anime-1.html')), []],
    [html('<html><body>Too many requests</body></html>', false), ['MyAnimeList credits 1 failed']],
    [new TypeError('Failed to fetch'), ['MyAnimeList credits 1 failed']],
  ] as const
  for (const [answer, logged] of answers) {
    errors.mockClear()
    const { media, answers } = await mediaFor('mal:1', url => url.endsWith('/characters') ? answer : html(fixture('mal-anime-1.html')), true)
    expect(answers).toHaveLength(1)
    expect(media.uri).toBe('mal:1')
    expect(media).not.toHaveProperty('credits')
    expect(errors.mock.calls.map(([line]) => line)).toEqual(logged)
  }
  errors.mockRestore()
})

// One Piece's credits page is 10 MB and took 6.6 to 8.8 s against its title page's 4.1 to 4.3 s
// (2026-10-15). Mutation: await the credits page before the first answer, and the row waits on it.
test('the title page\'s row answers before its credits page, and again with its credits once that lands', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const { ctx } = routed(url => url.endsWith('/_/characters') ? held.then(() => html(CREDITS)) : html(fixture('mal-anime-1.html')))
  const answers = (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'mal:1', details: true } }, ctx)
  const first = await Promise.race([answers.next(), new Promise(resolve => setTimeout(() => resolve('held'), 200))])
  expect(first, 'the row does not wait on the credits page').not.toBe('held')
  expect((first as any).value.media.uri).toBe('mal:1')
  expect((first as any).value.media).not.toHaveProperty('credits')
  release()
  const { value } = await answers.next()
  expect(value.media.uri).toBe('mal:1')
  expect(value.media.credits.characters).toHaveLength(6)
  expect((await answers.next()).done).toBe(true)
})

/**
 * A REAL PAGE ASKS WITH THE CLUSTER'S ADDRESS, never with a bare `mal:` uri.
 *
 * This resolver took `isUri` alone until 2026-09-14, so every ask from a media page was refused on its
 * first line, `mal:61316` stayed a row other sources had named and nobody had described, and the modal
 * drew the MyAnimeList badge as a dead icon while every other origin was a link.
 *
 * Mutation: put back `if (!uri || !isUri(uri))` with `fromUri`, and the aggregated case answers null.
 */
test('it answers when asked with an AGGREGATED uri, which is what a media page sends', async () => {
  const asked = 'ag:(anilist:189046,kitsu:49746,mal:1,offline:mal-1)'
  const { media, urls } = await mediaFor(asked, () => html(fixture('mal-anime-1.html')))

  expect(media?.uri, `asked with ${asked}`).toBe('mal:1')
  expect(urls).toEqual(['https://myanimelist.net/anime/1'])
  // the url is the whole point: it is what makes the badge a link rather than a grey icon
  expect(media?.url).toBeTruthy()
})

test('the control: an aggregated uri naming no mal handle is still refused', async () => {
  const { media, urls } = await mediaFor('ag:(anilist:189046,kitsu:49746)', () => html(fixture('mal-anime-1.html')))

  expect(media, 'this source is not in that address and must not answer for it').toBeNull()
  expect(urls).toEqual([])
})

// MyAnimeList publishes its AniDB link in two shapes, and only one of them puts the id in the path:
//
//   https://anidb.net/perl-bin/animedb.pl?show=anime&aid=23   the common one, measured 2026-09-04 on
//                                                             mal:1, mal:30 and mal:5114
//   https://anidb.net/anime/23                                the modern one
//
// The id read was `searchParams.get('aid') ?? pathname.split('/')[2]`, an unguarded positional
// fallback, and the anizip handle beside it gated on the LINK rather than on the id. So a link the
// first half could not read minted `anizip:undefined`, or `anidb:animedb.pl` off the common shape,
// and every record that produced one produced the SAME one. `upsertMedia` welds those, and `graph.link`
// has no inverse.
const withAnidb = (url: string) =>
  '<h1 class="title-name h1_bold_none"><strong>Cowboy Bebop</strong></h1>'
  + `<a href="${url.replace(/&/g, '&amp;')}" target="_blank" class="link ga-click" data-ga-click-type="external-links-anime-pc-anidb">`

const handlesFor = async (url: string) => {
  const { media } = await mediaFor('mal:1', () => html(withAnidb(url)))
  return ((media?.handles ?? []) as { node: { uri: string, origin: string } }[]).map(handle => handle.node)
}

test('a link on either real shape yields the anidb id, and both handles carry it', async () => {
  for (const url of [
    'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=23',
    'https://anidb.net/anime/23',
  ]) {
    const uris = (await handlesFor(url)).map(handle => handle.uri)
    expect(uris, url).toEqual(['anidb:23', 'anizip:23'])
  }
})

// The weld. Before the fix this record minted `anidb:animedb.pl` and `anizip:animedb.pl`, and so did
// every other record whose `aid` was missing from the same url shape.
test('a link with no readable id leaves BOTH handles unminted, never the script name', async () => {
  for (const url of [
    'https://anidb.net/perl-bin/animedb.pl?show=anime',
    'https://anidb.net/',
    'https://anidb.net/anime/',
    'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=',
    'https://anidb.net/perl-bin/animedb.pl?show=anime&aid=not-a-number',
    'not a url at all',
  ]) {
    expect(await handlesFor(url), url).toEqual([])
  }
})

test('no AniDB link at all is simply no handle, and the record still resolves', async () => {
  const { media } = await mediaFor('mal:1', () => html('<h1 class="title-name h1_bold_none"><strong>Cowboy Bebop</strong></h1>'))

  expect(media.uri).toBe('mal:1')
  expect(media.handles).toEqual([])
})

test('anidbIdFromUrl reads the id, or refuses', () => {
  expect(anidbIdFromUrl('https://anidb.net/perl-bin/animedb.pl?show=anime&aid=6107')).toBe('6107')
  expect(anidbIdFromUrl('https://anidb.net/anime/22')).toBe('22')
  expect(anidbIdFromUrl('https://anidb.net/anime/22?highlight=1')).toBe('22')

  expect(anidbIdFromUrl('https://anidb.net/perl-bin/animedb.pl?show=anime')).toBeUndefined()
  expect(anidbIdFromUrl('https://anidb.net/creator/1234')).toBeUndefined()
  expect(anidbIdFromUrl('not a url at all')).toBeUndefined()
  expect(anidbIdFromUrl(undefined)).toBeUndefined()
  expect(anidbIdFromUrl(null)).toBeUndefined()
  expect(anidbIdFromUrl('')).toBeUndefined()
})

const FALL_2026 = fixture('mal-season-fall-2026.html')

// The fixture holds two new shows, a carried-over one and an R18+ card. Jikan answered a season with
// `sfw` and without `continuing`, so the last two were never part of this source's season. Asked as a
// past season, so the stamp has to be the season asked for rather than the clock's.
test('a named season reads that season\'s page, and keeps only its new, non-adult shows', async () => {
  const { ctx, urls } = routed(() => html(FALL_2026))

  const nodes = await pageFor({ season: 'WINTER', seasonYear: 2024, status: 'RELEASING' }, ctx)

  expect(urls).toEqual(['https://myanimelist.net/anime/season/2024/winter'])
  expect(nodes.map(node => node.uri)).toEqual(['mal:54344', 'mal:64028'])
  expect(nodes.map(node => [node.season, node.seasonYear])).toEqual([['WINTER', 2024], ['WINTER', 2024]])
})

test('a season card carries its type, title, cover, genres, members and start', async () => {
  const { ctx } = routed(() => html(FALL_2026))

  const [first] = await pageFor({ season: 'FALL', seasonYear: 2026 }, ctx)

  expect(first).toMatchObject({
    uri: 'mal:54344',
    type: 'TV',
    categories: ['ANIME', 'SERIES'],
    titles: [{ language: 'jp-en', title: 'Mahou Shoujo Ikusei Keikaku: Restart', score: 0.9 }],
    covers: [{ language: 'en', url: 'https://cdn.myanimelist.net/images/anime/1518/160127l.webp', score: 0.9 }],
    genres: ['Action', 'Suspense', 'Gore', 'High Stakes Game', 'Mahou Shoujo', 'Survival'],
    popularity: 13337,
    startDate: '2026-10-06',
  })
})

test('a season card keeps its synopsis paragraphs, and the no-synopsis line is no description', async () => {
  const { ctx } = routed(() => html(FALL_2026))

  const [withSynopsis, without] = await pageFor({ season: 'FALL', seasonYear: 2026 }, ctx)

  expect(withSynopsis.descriptions[0].description).toMatch(/^The deadly game is back!\n\nOn/)
  expect(without.descriptions).toEqual([])
})

test('the season the clock is in reads that season\'s own page', async () => {
  const now = animeSeasonOf()
  const { season, year } = mediaSeasonNow()
  for (const input of [{ status: 'RELEASING' }, { season, seasonYear: year }]) {
    const { ctx, urls } = routed(() => html(FALL_2026))

    const nodes = await pageFor(input, ctx)

    expect(urls, JSON.stringify(input)).toEqual([`https://myanimelist.net/anime/season/${now.year}/${now.season}`])
    expect(nodes.map(node => [node.season, node.seasonYear])).toEqual([[season, year], [season, year]])
  }
})

test('a season page that fails is an empty season, not a throw and not another season', async () => {
  for (const answer of [
    () => new Error('connect ETIMEDOUT'),
    () => html('<html><body>Too many requests</body></html>', false),
    () => html(''),
  ]) {
    const { ctx, urls } = routed(answer)

    await expect(pageFor({ season: 'SPRING', seasonYear: 2019 }, ctx)).resolves.toEqual([])
    expect(urls).toEqual(['https://myanimelist.net/anime/season/2019/spring'])
  }
})

// Half a season is not a season: without the year this would have to guess one.
test('a season with no year, or a year with no season, asks for nothing at all', async () => {
  for (const input of [{ season: 'WINTER' }, { seasonYear: 2024 }]) {
    const { ctx, urls } = routed(() => html(FALL_2026))

    await expect(pageFor({ ...input, status: 'RELEASING' }, ctx)).resolves.toEqual([])
    expect(urls, JSON.stringify(input)).toEqual([])
  }
})

// MAL rates out of ten and `Media.averageScore` is a 0 to 100 percentage. This source scores 0.9 and
// AniList 0.8, so wherever both answered the cluster took MAL's number: a 8.34 show read as 8%.
test('a MAL rating out of ten arrives as a percentage, from the season page', async () => {
  const card =
    '<div class="js-anime-category-producer js-anime-type-1">'
    + '<a href="https://myanimelist.net/anime/12345/Some_Show" class="link-title">Some Show</a>'
    + '<span class="js-score">6.71</span>'
    + '</div>'
  const { ctx } = routed(() => html(card))

  const nodes = await pageFor({ status: 'RELEASING' }, ctx)

  expect(nodes[0].averageScore).toBe(67)
})

test('a synopsis arrives without the credit ending it, from the season page', async () => {
  const card =
    '<div class="js-anime-category-producer js-anime-type-1">'
    + '<a href="https://myanimelist.net/anime/59027/Spy_x_Family_Season_3" class="link-title">Spy x Family Season 3</a>'
    + `<p class="preline">${SAMPLES.malSpyFamily.description}</p>`
    + '</div>'
  const { ctx } = routed(() => html(card))

  const nodes = await pageFor({ status: 'RELEASING' }, ctx)

  expect(nodes[0].descriptions[0].description).toMatch(/family life\.$/)
})

const SEARCH = JSON.parse(fixture('mal-search-frieren.json'))

// `&` ends a query parameter, so an unescaped term silently searched for its own first word.
test('a search asks the site\'s own search box, with the term percent-encoded', async () => {
  const { ctx, urls } = routed(() => json(SEARCH))

  await pageFor({ search: 'fate & zero' }, ctx)

  expect(urls).toEqual(['https://myanimelist.net/search/prefix.json?type=anime&keyword=fate%20%26%20zero'])
})

test('a search answer carries the id, title, type, status, dates, rating and large cover', async () => {
  const { ctx } = routed(() => json(SEARCH))

  const nodes = await pageFor({ search: 'frieren' }, ctx)

  expect(nodes.map(node => node.uri)).toEqual(['mal:59978', 'mal:52991', 'mal:63816', 'mal:56885'])
  expect(nodes[0]).toMatchObject({
    url: 'https://myanimelist.net/anime/59978',
    type: 'TV',
    status: 'FINISHED',
    startDate: '2026-01-16',
    endDate: '2026-03-27',
    averageScore: 88,
    titles: [{ language: 'jp-en', title: 'Sousou no Frieren 2nd Season', score: 0.9 }],
    covers: [{ language: 'en', url: 'https://cdn.myanimelist.net/images/anime/1921/154528l.webp', score: 0.9 }],
  })
  // `Oct ??, 2027 to ?` and an `N/A` rating
  expect(nodes[2]).toMatchObject({ status: 'NOT_YET_RELEASED', startDate: '2027-10-01' })
  expect(nodes[2].averageScore).toBeUndefined()
  expect(nodes[3].type).toBe('ONA')
})

// A title with no picture answers MAL's question mark (`/images/qm_50.gif`, 452 bytes), which at 0.9
// would sort above AniList's real cover. mal:35490 is that title.
test('a search answer with no picture carries no cover, not MAL\'s placeholder', async () => {
  const { ctx } = routed(() => json(JSON.parse(fixture('mal-search-tanuki.json'))))

  const nodes = await pageFor({ search: 'tanuki' }, ctx)

  expect(nodes).toHaveLength(10)
  for (const node of nodes) {
    expect(node.covers, node.uri).toEqual(node.uri === 'mal:35490' ? [] : [expect.objectContaining({ url: expect.stringMatching(/^https:\/\/cdn\.myanimelist\.net\/images\/anime\/\d+\/\d+l\.webp$/) })])
  }
})

test('a search that fails or finds nothing is an empty page', async () => {
  for (const answer of [
    () => new Error('connect ETIMEDOUT'),
    () => ({ ok: false, status: 429, json: async () => { throw new SyntaxError('not json') } }),
    () => json({ categories: [{ type: 'anime', items: [] }] }),
  ]) {
    const { ctx } = routed(answer)
    await expect(pageFor({ search: 'fz' }, ctx)).resolves.toEqual([])
  }
})

test('nothing this source does asks anything but myanimelist.net', async () => {
  const { ctx, urls } = routed(url =>
    url.includes('/search/') ? json(SEARCH)
    : url.includes('/season/') ? html(FALL_2026)
    : html(fixture('mal-anime-1.html'))
  )
  const subscribe = (resolvers.Subscription as any).media.subscribe
  await subscribe(undefined, { input: { uri: 'mal:1' } }, ctx).next()
  await pageFor({ status: 'RELEASING' }, ctx)
  await pageFor({ season: 'WINTER', seasonYear: 2024 }, ctx)
  await pageFor({ search: 'frieren' }, ctx)

  expect(urls).toHaveLength(4)
  for (const url of urls) expect(url).toMatch(/^https:\/\/myanimelist\.net\//)
})
