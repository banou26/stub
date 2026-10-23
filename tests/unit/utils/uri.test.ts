import { describe, expect, test } from 'vite-plus/test'

import { decodeRouteUri, extractAggregatedUriOrigin, fromAggregatedUri, isRoutableUri, matchAggregatedUris, originsOfUri, routeMediaUri } from '../../../src/utils/uri'

describe('originsOfUri', () => {
  test('lists the origins an aggregated uri lets a source recognise itself by', () => {
    expect(originsOfUri('ag:(anilist:108465,kitsu:41371,mal:39535)').sort())
      .toEqual(['anilist', 'kitsu', 'mal'])
  })

  // one origin can contribute several handles to a cluster, and the caller only ever asks whether that
  // source is addressable at all, so the repeat must not show up twice
  test('deduplicates an origin that contributed several handles', () => {
    expect(originsOfUri('ag:(cr:G24H1N3MP,cr:GRDQCGX5E,mal:39535)').sort())
      .toEqual(['cr', 'mal'])
  })

  test('a bare handle uri is its own single origin', () => {
    expect(originsOfUri('anilist:108465')).toEqual(['anilist'])
  })

  test('something that is not a uri names no origins', () => {
    expect(originsOfUri('nocolon')).toEqual([])
    expect(originsOfUri('')).toEqual([])
  })

  // the whole point of the re-ask: what a narrow uri is MISSING is what has to be asked again
  test('a grown uri names origins the narrow one did not', () => {
    const narrow = originsOfUri('ag:(anilist:108465,kitsu:41371,mal:39535,offline:x)')
    const grown = originsOfUri('ag:(anilist:108465,cr:G24H1N3MP,kitsu:41371,mal:39535,nf:81074276,offline:x)')
    expect(grown.filter(origin => !narrow.includes(origin)).sort()).toEqual(['cr', 'nf'])
    expect(narrow.filter(origin => !grown.includes(origin))).toEqual([])
  })
})

describe('isRoutableUri', () => {
  test('an ordinary handle uri passes, including the compound ids sources mint', () => {
    for (const uri of ['anilist:108465', 'cr:G24H1N3MP-GRDQCGX5E', 'jw:222366-3', 'tmdb:94664-s3e1', 'imdb:tt13293588']) {
      expect(isRoutableUri(uri), uri).toBe(true)
    }
  })

  // A '/' splits '/watch/:mediaUri/:episodeUri' and a ',' splits the `ag:(...)` handle list, so either
  // one builds a media uri that matches no route at all - a bare "404 No page found".
  test('a url smuggled in as an id is rejected', () => {
    expect(isRoutableUri('cr:https://www.crunchyroll.com/mushoku-tensei-jobless-reincarnation')).toBe(false)
    expect(isRoutableUri('cr:some/path')).toBe(false)
  })

  test('a comma is rejected: it would split the handle list', () => {
    expect(isRoutableUri('cr:a,b')).toBe(false)
  })

  test('parens are rejected: they delimit the aggregate itself', () => {
    expect(isRoutableUri('cr:a(b)')).toBe(false)
  })

  test('something with no origin at all is not a uri', () => {
    expect(isRoutableUri('nocolon')).toBe(false)
    expect(isRoutableUri(':leading')).toBe(false)
  })
})

// THE BUG. `fromAggregatedUri` sorts handles by id and this used to take the first match, so a
// show-level id, being a strict prefix of its own season-scoped form, always won. Crunchyroll was
// therefore asked about the whole series while the handle for the run was in the same cluster, and a
// 14 episode season page listed 24 rows.
describe('extractAggregatedUriOrigin', () => {
  const MUSHOKU = 'ag:(anilist:178789,cr:G24H1N3MP,cr:G24H1N3MP-GS00374452,kitsu:49002)'

  test('the season-scoped handle wins over the show it extends', () => {
    expect(extractAggregatedUriOrigin(MUSHOKU, 'cr')?.id).toBe('G24H1N3MP-GS00374452')
  })

  // the control: the same call still answers for an origin with one handle, so the assertion above is
  // a preference and not this function having stopped resolving anything
  test('an origin with a single handle is unaffected', () => {
    expect(extractAggregatedUriOrigin(MUSHOKU, 'kitsu')?.id).toBe('49002')
    expect(extractAggregatedUriOrigin(MUSHOKU, 'anilist')?.id).toBe('178789')
  })

  test('an origin the uri does not carry is undefined', () => {
    expect(extractAggregatedUriOrigin(MUSHOKU, 'nf')).toBeUndefined()
  })

  // SPECIFICITY IS PREFIX EXTENSION, NOT LENGTH. Two unrelated ids say nothing about each other, so
  // the longer one is not the more specific one and picking it would be a different arbitrary answer.
  // The first still wins there, which is arbitrary but stable, and stable is what matters.
  test('a merely longer id does not win, only one that extends the other', () => {
    const unrelated = 'ag:(cr:AAAA,cr:ZZZZZZZZZZZZ)'
    expect(extractAggregatedUriOrigin(unrelated, 'cr')?.id).toBe('AAAA')
  })

  test('a plain uri of that origin still resolves to itself', () => {
    expect(extractAggregatedUriOrigin('cr:G24H1N3MP-GS00374452', 'cr')?.id).toBe('G24H1N3MP-GS00374452')
    expect(extractAggregatedUriOrigin('kitsu:49002', 'cr')).toBeUndefined()
  })
})

// A percent-encoded media path is a legal encoding of a valid URL, the server answers 200 and the shell
// renders, and the page then sat empty forever because the route segment reached the validators
// encoded. Measured 2026-09-05, after three probe scripts built their paths with encodeURIComponent
// and reported pages that were never subscribed.
describe('decodeRouteUri', () => {
  const AG = 'ag:(anilist:108465,kitsu:42323,mal:39535)'

  test('an encoded aggregated uri decodes to the uri', () => {
    expect(decodeRouteUri(encodeURIComponent(AG))).toBe(AG)
  })

  test('an encoded plain uri decodes to the uri', () => {
    expect(decodeRouteUri(encodeURIComponent('anilist:108465'))).toBe('anilist:108465')
  })

  test('a raw uri passes unchanged', () => {
    expect(decodeRouteUri(AG)).toBe(AG)
    expect(decodeRouteUri('anilist:108465')).toBe('anilist:108465')
  })

  test('a segment that decodes to nothing a validator accepts comes back as it was, and a bad escape never throws', () => {
    expect(decodeRouteUri('not-a-uri')).toBe('not-a-uri')
    expect(decodeRouteUri('%E0%A4%A')).toBe('%E0%A4%A')
    expect(decodeRouteUri(undefined)).toBeUndefined()
  })
})

describe('routeMediaUri', () => {
  test('a bare source uri, as an old bookmark names a work, is asked as its one member cluster, encoded or not', () => {
    expect(routeMediaUri('anilist:101249')).toBe('ag:(anilist:101249)')
    expect(routeMediaUri(encodeURIComponent('anilist:101249'))).toBe('ag:(anilist:101249)')
  })

  test('a cluster is asked as it is, and what is no routable uri comes back as it was', () => {
    expect(routeMediaUri('ag:(anilist:101249,jw:403680)')).toBe('ag:(anilist:101249,jw:403680)')
    expect(routeMediaUri('not-a-uri')).toBe('not-a-uri')
    expect(routeMediaUri(undefined)).toBeUndefined()
  })
})

// ─── An absent uri is not an uri ────────────────────────────────────────────
//
// Back and forward a few times on a media route and the homepage used to stack copies of itself, each
// clone's hero absolutely positioned at the same place, so the titles painted over one another.
//
// The cause is a render ORDER divergence: a browser dispatched `popstate` runs a microtask checkpoint
// between its listeners while an app dispatched `pushState` does not, so `Home` re-renders before
// wouter's `<Switch>` and `useRoute('/media/:uri')` is already true while the params context still
// holds the previous route's EMPTY params. `MediaModal` then matched against `undefined`.
//
// Dereferencing it threw during render, and there is no error boundary anywhere in the app, so Preact
// abandoned the commit and orphaned the mounted subtree in the DOM rather than replacing it.
describe('an absent uri', () => {
  test('does not parse, and does not throw', () => {
    expect(fromAggregatedUri(undefined as never)).toBeUndefined()
    expect(fromAggregatedUri(null as never)).toBeUndefined()
    expect(() => fromAggregatedUri(undefined as never)).not.toThrow()
  })

  test('matches nothing, which is the answer a half-updated route needs', () => {
    const real = 'ag:(anilist:178789,mal:59193)' as never
    expect(matchAggregatedUris(real, undefined as never)).toBe(false)
    expect(matchAggregatedUris(undefined as never, real)).toBe(false)
    expect(() => matchAggregatedUris(real, undefined as never)).not.toThrow()
  })

  test('and a real pair still matches, so the guard did not just disable matching', () => {
    expect(matchAggregatedUris('ag:(anilist:178789,mal:59193)' as never, 'ag:(mal:59193)' as never)).toBe(true)
  })
})
