// A tmdb id is a SHOW id: '94664' is every season of Mushoku Tensei at once, and only the '-s<n>' form
// names one run. So the bare row (search, or a media-path fallback with no season to pick) goes out
// scoped CONTAINER, and the store keeps it out of every run's identity space.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/tmdb/extractor'

const BASE = 'https://www.themoviedb.org'

const SEARCH_HTML = `
<div class="card" data-media-type="tv">
  <a href="/tv/94664-mushoku-tensei-jobless-reincarnation"><img alt="Mushoku Tensei: Jobless Reincarnation" src="https://media.themoviedb.org/t/p/w94/poster.jpg"></a>
  <a href="/tv/94664-mushoku-tensei-jobless-reincarnation"><h2>Mushoku Tensei: Jobless Reincarnation</h2></a>
  <span class="release_date">January 11, 2021</span>
</div>`

const SHOW_HTML = `
<meta property="og:title" content="Mushoku Tensei: Jobless Reincarnation">
<meta property="og:description" content="Reborn as a baby.">
<meta property="og:image" content="https://media.themoviedb.org/t/p/w600/poster.jpg">`

const seasonListHtml = (id: string, seasons: number[]) =>
  seasons.map(n => `<a href="/tv/${id}/season/${n}">Season ${n}</a>`).join('\n')

const seasonHtml = (episodes: number) =>
  Array.from({ length: episodes }, (_, i) => `<div class="card" data-episode-number="${i + 1}"><h3><a href="#">Episode ${i + 1}</a></h3></div>`).join('\n')

// THE AIR DATE, which sits in the card this source already downloads and was skipped until 2026-09-12.
// Every shape below is how TMDB really writes the span, measured that day on /tv/94664/season/2 asked
// with `language=en-US`: 24 cards, all dated, and 8 of them with the DAY SPACE PADDED to two columns,
// so `August  7, 2023` and `July  1, 2024` arrive with two spaces. The month name is English only
// because of that query parameter, which is why the parse is pinned to it rather than to a locale.
const DATED_CARDS: { number: number, date?: string }[] = [
  { number: 1, date: 'July 10, 2023' },
  { number: 2, date: 'August  7, 2023' },
  // a card TMDB dates with something this cannot read, and a day that is not in that month. Both are
  // refused rather than coerced: `new Date` would take the second and answer March 2.
  { number: 3, date: 'sometime in 2023' },
  { number: 4, date: 'February 30, 2023' },
  // a card with NO date span at all, which is 0 of 24 on that page and 25 of 180 on other sources
  { number: 5 },
]

// the real card nesting: the span sits inside a `<div class="date">` beside the runtime, and the outer
// div must not look like a card boundary to `parseSeason`'s split
const datedSeasonHtml = () => DATED_CARDS.map(card => `
<div class="card" data-episode-number="${card.number}">
  <h3><a href="#">Episode ${card.number}</a></h3>
  <div class="date">
    ${card.date === undefined ? '' : `<span class="date">${card.date}</span>`}
    &bull; <span class="runtime">24m</span>
  </div>
</div>`).join('\n')

// misses are COLLECTED rather than thrown: `fetchHtml` swallows a rejection with `.catch(() => undefined)`,
// so a drifted fixture would return no media and fail on a line that says nothing about the fixture.
const context = (misses: string[]) => ({
  key: () => undefined,
  fetch: async (url: string) => {
    const html = (body: string) => ({ ok: true, status: 200, text: async () => body })
    if (url.startsWith(`${BASE}/search/tv?query=`)) return html(SEARCH_HTML)
    if (url.startsWith(`${BASE}/tv/94664?`)) return html(SHOW_HTML)
    if (url.startsWith(`${BASE}/tv/94664/seasons?`)) return html(seasonListHtml('94664', [1, 2, 3]))
    if (url.startsWith(`${BASE}/tv/94664/season/3?`)) return html(seasonHtml(24))
    // a show with no season listed: nothing to pick, so the bare id comes back
    if (url.startsWith(`${BASE}/tv/777?`)) return html(SHOW_HTML)
    if (url.startsWith(`${BASE}/tv/777/seasons?`)) return html('')
    if (url.startsWith(`${BASE}/tv/555?`)) return html(SHOW_HTML)
    if (url.startsWith(`${BASE}/tv/555/seasons?`)) return html(seasonListHtml('555', [1]))
    if (url.startsWith(`${BASE}/tv/555/season/1?`)) return html(datedSeasonHtml())
    // an anime show, by TMDB's own keyword
    if (url.startsWith(`${BASE}/tv/888?`)) return html(`${SHOW_HTML}<a href="/keyword/210024-anime/">anime</a>`)
    if (url.startsWith(`${BASE}/tv/888/seasons?`)) return html(seasonListHtml('888', [1, 2]))
    if (url.startsWith(`${BASE}/tv/888/season/2?`)) return html(datedSeasonHtml())
    misses.push(url)
    return { ok: false, status: 404, text: async () => '' }
  },
}) as never

type Row = { uri: string, scope?: string, startDate?: string, categories?: string[], seasons?: unknown[], episodes?: { episodeNumber?: number, releaseDate?: string }[] }

const mediaFor = async (uri: string): Promise<Row> => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(misses)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  expect(value?.media, 'the media itself must exist for its scope to mean anything').not.toBeNull()
  return value.media
}

const searchRows = async (): Promise<Row[]> => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'mushoku' } }, context(misses)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  return value.mediaPage.nodes
}

test('a season-scoped media is a RUN', async () => {
  const media = await mediaFor('tmdb:94664-s3')

  expect(media.uri).toBe('tmdb:94664-s3')
  expect(media.episodes, 'the pinned season must be the one fetched').toHaveLength(24)
  expect(media.scope).toBe('RUN')
})

test('a search row carries the bare show id and is a CONTAINER', async () => {
  const rows = await searchRows()

  expect(rows.map(row => row.uri)).toEqual(['tmdb:94664'])
  expect(rows[0]!.scope).toBe('CONTAINER')
})

// getMedia hands back the bare id when the show page lists no season to pick, so the media path can
// mint a show-level row too, and it has to say so.
test('a media-path row that falls back to the bare show id is a CONTAINER', async () => {
  const media = await mediaFor('tmdb:777')

  expect(media.uri).toBe('tmdb:777')
  expect(media.scope).toBe('CONTAINER')
})

// THE AIR DATE. TMDB's season page carries it in the same card this source already parses for the
// title, the overview and the still, and `normalizeEpisode` emitted no `releaseDate` at all, so this
// source contributed nothing to the date alignment `store/consensus.ts` pairs episodes by.
//
// The date matters more here than on a source that numbers episodes the way a run does: TMDB PACKAGES
// ANIME AS NETFLIX AND JUSTWATCH DO, folding two cours into one season (season 2 of 94664 is 24
// episodes, 1 to 12 across July to September 2023 and 13 to 24 across April to July 2024), so a stub
// run that IS the second cour numbers its episodes 1 to 12 against TMDB's 13 to 24. The day is what
// pairs those rows; the position cannot.
//
// Mutations, one per test: drop `releaseDate` from `normalizeEpisode`; narrow the `\s+` in
// `parseCardDate` to one literal space; return `text` on a regex miss, or drop the calendar
// round-trip; `continue` on a card with no date span.
test('an episode carries the day the card named', async () => {
  const media = await mediaFor('tmdb:555-s1')

  expect((media.episodes ?? [])[0]!.releaseDate, 'the day stays a day, never widened to an instant').toBe('2023-07-10')
})

test('a space padded day parses, which is how TMDB writes every single digit day', async () => {
  const media = await mediaFor('tmdb:555-s1')

  expect((media.episodes ?? [])[1]!.releaseDate, '`August  7, 2023`, with two spaces').toBe('2023-08-07')
})

test('a date this cannot read is refused rather than guessed at', async () => {
  const dates = (await mediaFor('tmdb:555-s1')).episodes ?? []

  expect(dates[2]!.releaseDate, 'a shape the parse does not know').toBeUndefined()
  // `new Date('February 30, 2023')` is March 2 in V8, which is a confident wrong answer rather than
  // an absent one, and the only thing separating them is the calendar check
  expect(dates[3]!.releaseDate, 'a day that is not in that month').toBeUndefined()
})

test('a card with no date at all is still an episode', async () => {
  const media = await mediaFor('tmdb:555-s1')

  expect(media.episodes, 'five cards, five episodes: the date is a field and never a filter').toHaveLength(5)
  expect((media.episodes ?? [])[4]!.episodeNumber).toBe(5)
  expect((media.episodes ?? [])[4]!.releaseDate).toBeUndefined()
})

// TMDB folds an anime's cours into one season where its runs split them, so TMDB's season numbers do
// not match the run on screen.
test('an anime season lists no seasons, and a live-action one does', async () => {
  const anime = await mediaFor('tmdb:888-s2')

  expect(anime.categories).toContain('ANIME')
  expect(anime.seasons).toBeUndefined()
  expect((await mediaFor('tmdb:94664-s3')).seasons).toHaveLength(3)
})

// A live-action season dated by its first episode is what lets another catalogue's run of it meet it,
// where the show's year never could. TMDB's anime season is not one run, so it says no day.
test('a live-action season is dated by its first episode, and an anime one is not', async () => {
  expect((await mediaFor('tmdb:555-s1')).startDate).toBe('2023-07-10')
  expect((await mediaFor('tmdb:888-s2')).startDate).toBeUndefined()
})
