// Which upstream is asked from the viewer's browser and which goes through the FKN relay.
//
// This rule is invisible on the happy path: both paths answer 200 and a source cannot tell them apart from the
// payload. A host routed direct whose CORS is closed fails as a network error on every request, and a host left on
// the relay while its CORS is open spends the relay and hides the viewer's own country and allowance. So the two
// halves are pinned separately: the hosts measured open from anime.fkn.app (2026-10-25, src/worker/direct-fetch.ts),
// and the hosts measured closed, which a rule sending everything one way would get wrong.
import { expect, test } from 'vite-plus/test'

import { asksViewerDirectly, DIRECT_FETCH_ORIGINS, withDirectFetch } from '../../../src/worker/direct-fetch'
import { NETFLIX_GRAPHQL_URL } from '../../../src/sources/unogs/netflix'
import { sceneSearchUrl } from '../../../src/scene/search'

test('the host the season answer is about is asked from the browser', () => {
  expect(asksViewerDirectly(NETFLIX_GRAPHQL_URL), 'the endpoint the episodes come from').toBe(true)
  expect(asksViewerDirectly(new URL(NETFLIX_GRAPHQL_URL)), 'a URL, which is what a source may pass').toBe(true)
  expect(asksViewerDirectly(new Request(NETFLIX_GRAPHQL_URL)), 'a Request, same').toBe(true)
})

// trace.moe counts its free 100 searches a day per asking address, so through the relay every viewer of a node
// would share one node's 100
test('the scene search is asked from the browser, whose own address trace.moe counts', () => {
  expect(asksViewerDirectly(sceneSearchUrl('gwebWzth7oPe2UIubOJmozi1NDFp'))).toBe(true)
})

// Each as its source asks it (src/sources/<name>/extractor.ts)
test('every host whose CORS lets a browser ask it is asked from the browser', () => {
  for (const url of [
    'https://graphql.anilist.co/',
    'https://kitsu.io/api/edge/anime/1?include=mappings',
    'https://uts-api.itunes.apple.com/uts/v3/search?searchTerm=severance&caller=web&sf=143441&v=58&pfm=web&locale=en-US&utsk=0',
    'https://api.ani.zip/mappings?anilist_id=1&specials=1',
    'https://www.livechart.me/api/v1/anime?season=fall&year=2026&limit=200',
    'https://apiz.trakt.tv/search/show?query=breaking%20bad',
    'https://api4.thetvdb.com/web/search/queries',
    'https://api.tvmaze.com/search/shows?q=breaking%20bad',
    'https://graphql.animethemes.moe/',
    'https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=1',
    // asked by the watch page itself, src/router/watch/fallback-ending.ts
    'https://api.aniskip.com/v2/skip-times/59978/3?types=ed&episodeLength=1440.11',
  ]) {
    expect(asksViewerDirectly(url), url).toBe(true)
  }
})

// THE CONTROL: each of these answered a page on anime.fkn.app with no allow-origin, or needs a header a browser drops,
// so asked from the browser every one of them would fail where the relay answers
test('every host a browser cannot ask still goes through the relay', () => {
  for (const url of [
    'https://anilist.co/graphql',
    'https://www.crunchyroll.com/auth/v1/token',
    'https://static.crunchyroll.com/skip-events/production/G8WUND5JX.json',
    // its CORS is open, but it answers any request carrying an Origin 412
    'https://api.simkl.com/anime/1990194?extended=full',
    'https://simkl.com/ajax/full/search.php',
    'https://www.paramountplus.com/shows/lioness/xhr/episodes/page/0/size/100000/xs/0/season/0/',
    'https://apis.justwatch.com/graphql',
    'https://caching.graphql.imdb.com/',
    'https://gateway.watchmode.com/trpc/gateway.quickSearch?batch=1',
    'https://myanimelist.net/anime/1',
    'https://www.themoviedb.org/tv/1399',
    'https://unogs.com/api/title/episodes?netflixid=80987039',
    'https://api.jikan.moe/v4/anime/1',
    // the trap a suffix match walks into: a host somebody else controls, ending in the allowed one
    'https://www.netflix.com.example.test/graphql',
    // and a sibling host that was never measured, so it was never exempted
    'https://api.netflix.com/graphql',
    'https://trace.moe/',
    'https://api.trace.moe.example.test/search',
    'https://kitsu.app/api/edge/anime/1',
  ]) {
    expect(asksViewerDirectly(url), url).toBe(false)
  }
  expect(asksViewerDirectly('not a url at all'), 'unparseable falls back to the relay').toBe(false)
})

test('the list is the hosts measured open, not a rule that grew', () => {
  expect([...DIRECT_FETCH_ORIGINS]).toEqual([
    'https://api.ani.zip',
    'https://api.aniskip.com',
    'https://api.trace.moe',
    'https://api.tvmaze.com',
    'https://api4.thetvdb.com',
    'https://apiz.trakt.tv',
    'https://cdn.animenewsnetwork.com',
    'https://graphql.anilist.co',
    'https://graphql.animethemes.moe',
    'https://kitsu.io',
    'https://uts-api.itunes.apple.com',
    'https://www.livechart.me',
    'https://www.netflix.com',
  ])
})

test('each request takes exactly one of the two paths', async () => {
  const took: string[] = []
  const path = (name: string) => async () => {
    took.push(name)
    return new Response('{}')
  }
  const fetch = withDirectFetch(path('relay'), path('direct'))

  await fetch(NETFLIX_GRAPHQL_URL, { method: 'POST' })
  await fetch('https://unogs.com/api/user')

  expect(took).toEqual(['direct', 'relay'])
})

// the viewer may be signed in to one of these sites in this browser; the relay never had their cookies to send
test('a request from the browser carries no credentials, whatever its source asked', async () => {
  const sent: { path: string, init?: RequestInit }[] = []
  const path = (name: string) => async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ path: name, init })
    return new Response('{}')
  }
  const fetch = withDirectFetch(path('relay'), path('direct'))

  await fetch('https://kitsu.io/api/edge/anime/1', { credentials: 'include', headers: { accept: 'application/json' } })
  await fetch('https://graphql.anilist.co/', { method: 'POST', body: '{}' })
  await fetch('https://www.crunchyroll.com/auth/v1/token', { method: 'POST', credentials: 'include' })

  expect(sent).toEqual([
    { path: 'direct', init: { credentials: 'omit', headers: { accept: 'application/json' } } },
    { path: 'direct', init: { method: 'POST', body: '{}', credentials: 'omit' } },
    { path: 'relay', init: { method: 'POST', credentials: 'include' } },
  ])
})
