import { describe, expect, test } from 'vite-plus/test'

import { thinLast } from '../../../../src/worker/store/filter'

const handle = (uri: string, relation = 'SAME_AS') => ({ relation, node: { uri, origin: uri.split(':')[0] } })

// a search hit as the page receives it, cut down to the fields `thinLast` reads, with nothing but its own id
const hit = (uri: string, fields: Record<string, unknown> = {}) =>
  ({ uri, seasonYear: null, startDate: null, covers: [], banners: [], handles: [handle(uri)], ...fields }) as any

const uris = (medias: { uri: string }[]) => medias.map(media => media.uri)

// "breaking bad" on stub.fkn.app, 2026-10-13: the show, and a Turkish film of that name only Watchmode lists, with no
// year, no poster and no IMDb id. No live-action source carries a popularity, so the two tie and arrival order decides.
const film = hit('watchmode:011104498')
const show = hit('ag:(imdb:tt0903747,tmdb:1396,watchmode:03173903)', {
  seasonYear: 2008,
  startDate: '2008-01-20',
  covers: [{ url: 'https://cdn.watchmode.com/posters/03173903_poster_w185.jpg' }],
  handles: [handle('imdb:tt0903747'), handle('tmdb:1396'), handle('watchmode:03173903')],
})

describe('thinLast', () => {
  test('the "breaking bad" film with nothing but its name goes after the show', () => {
    expect(uris(thinLast([film, show]))).toEqual([show.uri, film.uri])
  })

  test('a thin hit goes after every other hit, and each group keeps its order', () => {
    const page = [hit('watchmode:1'), show, hit('watchmode:2'), hit('watchmode:3', { seasonYear: 2024 })]
    expect(uris(thinLast(page))).toEqual([show.uri, 'watchmode:3', 'watchmode:1', 'watchmode:2'])
  })

  test('a thin hit is never dropped', () => {
    expect(thinLast([film])).toEqual([film])
    expect(uris(thinLast([film, hit('watchmode:2')]))).toEqual([film.uri, 'watchmode:2'])
  })

  test('a year, a picture or another source\'s id, any one alone, keeps a hit in its place', () => {
    const sparse = {
      'a season year': { seasonYear: 2024 },
      'a start date': { startDate: '2024-01-01' },
      'a cover': { covers: [{ url: 'https://cdn.watchmode.com/posters/01913415_poster_w185.jpg' }] },
      'a banner': { banners: [{ url: 'https://image.tmdb.org/t/p/original/banner.jpg' }] },
      'a member from another source': { handles: [handle('watchmode:4'), handle('tmdb:5')] },
      'a link to another source': { handles: [handle('watchmode:4'), handle('imdb:tt9746510', 'PART_OF')] },
    }
    for (const [what, fields] of Object.entries(sparse)) {
      expect(uris(thinLast([hit('watchmode:4', fields), show])), what).toEqual(['watchmode:4', show.uri])
    }
  })

  test('two ids of one source are still one source', () => {
    const twice = hit('watchmode:4', { handles: [handle('watchmode:4'), handle('watchmode:6', 'PART_OF')] })
    expect(uris(thinLast([twice, show]))).toEqual([show.uri, 'watchmode:4'])
  })
})
