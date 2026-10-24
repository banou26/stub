// Which upstream is asked from the viewer's browser and which goes through the FKN relay.
//
// This rule is invisible on the happy path: both paths answer 200, both parse, and a source cannot
// tell them apart from the payload. What it decides is WHICH COUNTRY the answer is about, and that
// only shows up as an upstream quietly answering about somebody else's catalogue. Measured
// 2026-09-13 on one page, both paths, same minute: through the relay (Hong Kong) Netflix answered
// Mushoku Tensei `isAvailable: false` with 0 seasons and season 82941638 with 0 episodes; from the
// browser (Tokyo) the same asks answered `isAvailable: true`, 3 seasons and 12 episodes. A control
// title available in both countries came back byte for byte identical over either path, which is what
// rules out the relay mangling anything.
//
// So the two cases that matter are "this host goes direct" and "everything else does not", and a rule
// that sent everything one way would satisfy neither.
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

// THE CONTROL, and the half that is easy to lose: the relay is the default and nearly every source
// depends on it to get past a CORS-closed upstream. A predicate that answered true for these would
// take every one of them down while this file's other case still passed.
test('every other upstream still goes through the relay', () => {
  for (const url of [
    'https://unogs.com/api/title/episodes?netflixid=80987039',
    'https://graphql.anilist.co',
    'https://api.jikan.moe/v4/anime/1',
    // the trap a suffix match walks into: a host somebody else controls, ending in the allowed one
    'https://www.netflix.com.evil.test/graphql',
    // and a sibling host that was never measured, so it was never exempted
    'https://api.netflix.com/graphql',
    'https://trace.moe/',
    'https://api.trace.moe.evil.test/search',
  ]) {
    expect(asksViewerDirectly(url), url).toBe(false)
  }
  expect(asksViewerDirectly('not a url at all'), 'unparseable falls back to the relay').toBe(false)
})

test('the exemption is two named origins, not a rule that grew', () => {
  expect([...DIRECT_FETCH_ORIGINS]).toEqual(['https://www.netflix.com', 'https://api.trace.moe'])
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
