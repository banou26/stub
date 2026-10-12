// Breaking Bad's cast page as TMDB answered /tv/1396/cast?language=en-US on 2026-10-12, cut to 13 of
// its 348 cast rows and 4 of its 91 crew rows, in Art, Directing and Writing.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { parseCredits, resolvers } from '../../../../src/sources/tmdb/extractor'

const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), 'utf8')
const CAST = fixture('credits/tmdb-breaking-bad.html')

const face = (path: string) => `https://media.themoviedb.org/t/p/w132_and_h132_face/${path}.jpg`

test('each actor stands under their first part with no language, and the crew is not read', () => {
  const { characters, staff } = parseCredits(CAST)

  expect(characters).toHaveLength(13)
  expect(characters[0]).toEqual({
    names: ['Walter White'],
    voiceActors: [{
      language: null,
      person: { id: 'tmdb:17419', name: 'Bryan Cranston', image: face('7Jahy5LZX2Fo8fGJltMreAI49hC'), url: 'https://www.themoviedb.org/person/17419-bryan-cranston' },
    }],
  })
  expect(characters.at(-1)!.names, 'Tina Parker plays "Francesca (voice)" and "Francesca"').toEqual(['Francesca (voice)'])
  expect(staff, 'the crew rows in the fixture').toEqual([])
})

test('the first 25 actors only', () => {
  const [head, row] = CAST.split('<li data-order="0">')
  const rows = Array.from({ length: 30 }, (_, i) => `<li data-order="0">${row!.split('</li>')[0]!.replace('>Walter White<', `>Part ${i}<`)}</li>`)
  expect(parseCredits(`${head}${rows.join('')}`).characters.map(({ names }) => names[0])).toEqual(Array.from({ length: 25 }, (_, i) => `Part ${i}`))
})

const SHOWS: Record<string, string> = { 1396: 'breaking-bad', 209867: 'frieren' }

const open = async (uri: string, details?: boolean, cast = { status: 200, body: CAST }) => {
  const paths: string[] = []
  const context = {
    fetch: async (url: string) => {
      const path = url.replace('https://www.themoviedb.org', '')
      paths.push(path)
      const [, id, page] = path.match(/^\/tv\/(\d+)(\/seasons|\/cast)?\?language=en-US$/) ?? []
      const { status, body } = page === '/cast' ? cast : { status: 200, body: id ? fixture(`tmdb/${page ? 'seasons' : 'show'}-${SHOWS[id]}.html`) : '' }
      return { ok: status === 200, status, text: async () => body }
    },
    findAggregatedMedia: async () => undefined,
    listenForMediaChanges: async function* () {},
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri, details } }, context).next()
  return { paths, media: value.media }
}

// the modal and the listing send what they sent before; an anime's cast names no language, so it is never asked
test('the cast page is asked only by a live-action title\'s page', async () => {
  const modal = await open('tmdb:1396-s1')
  expect(modal.paths.filter(path => path.includes('/cast'))).toEqual([])
  expect(modal.media.credits).toBeUndefined()

  const page = await open('tmdb:1396-s1', true)
  expect(page.paths.filter(path => path.includes('/cast'))).toEqual(['/tv/1396/cast?language=en-US'])
  expect(page.media.credits.characters).toHaveLength(13)

  const anime = await open('tmdb:209867-s1', true)
  expect(anime.media.uri).toBe('tmdb:209867-s1')
  expect(anime.paths.filter(path => path.includes('/cast'))).toEqual([])
})

// Mutation: answer the show's own card without `withCredits` and a TMDB-only address has no cast.
test('the show\'s own card carries the cast too', async () => {
  const { media } = await open('tmdb:1396', true)
  expect(media.uri).toBe('tmdb:1396')
  expect(media.credits.characters).toHaveLength(13)
})

// A later answer from TMDB replaces its earlier credits, so an error page must not answer an empty cast.
test('a cast page that fails adds no credits', async () => {
  const { media } = await open('tmdb:1396-s1', true, { status: 403, body: '<html>403 Forbidden</html>' })
  expect(media.uri).toBe('tmdb:1396-s1')
  expect(media.credits).toBeUndefined()
})

// Mutation: ask the cast before the season is known and a series with no season to answer fetches it anyway.
test('the cast is not asked when no season can be answered', async () => {
  const { paths, media } = await open('ag:(tmdb:1396,tvmaze:169)', true)
  expect(media).toBeNull()
  expect(paths.filter(path => path.includes('/cast'))).toEqual([])
})
