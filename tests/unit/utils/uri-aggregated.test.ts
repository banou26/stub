// A relation names a work by the ONE source that mentioned it. Linking straight to that source opens a
// page pinned to it, where the store has a single row and never asks anyone else, so the work shows
// whatever AniList alone knew and nothing more. Wrapping it as a cluster is what starts the fan out.
import { describe, expect, test } from 'vite-plus/test'

import { asAggregatedUri, isAggregatedUri, matchAggregatedUris, shouldRewriteAddress } from '../../../src/utils/uri'

describe('asAggregatedUri', () => {
  test('a single source becomes a cluster of one, which is a routable form', () => {
    expect(asAggregatedUri('anilist:166873')).toBe('ag:(anilist:166873)')
    expect(isAggregatedUri(asAggregatedUri('anilist:166873'))).toBe(true)
  })

  test('and it works for every origin, not just the one that names relations today', () => {
    expect(asAggregatedUri('mal:59193')).toBe('ag:(mal:59193)')
    expect(asAggregatedUri('kitsu:49002')).toBe('ag:(kitsu:49002)')
  })

  test('an already aggregated uri is left exactly as it is, never wrapped twice', () => {
    const cluster = 'ag:(anilist:178789,mal:59193)'
    expect(asAggregatedUri(cluster)).toBe(cluster)
    expect(asAggregatedUri('ag:(anilist:1)')).toBe('ag:(anilist:1)')
  })

  test('and anything that is not a uri is returned untouched rather than wrapped into nonsense', () => {
    // `ag:(not a uri)` passes no validator, so the page would render its shell and sit empty
    for (const value of ['', 'not a uri', 'https://example.test/x', 'anilist']) {
      expect(asAggregatedUri(value), value).toBe(value)
    }
  })

  test('the result survives the round trip a route puts it through', () => {
    const routed = asAggregatedUri('anilist:166873')
    expect(isAggregatedUri(routed)).toBe(true)
    expect(routed.startsWith('ag:(')).toBe(true)
  })
})

describe('shouldRewriteAddress', () => {
  const known = 'ag:(anilist:108465)'
  const full = 'ag:(anidb:14758,anilist:108465,kitsu:42323,mal:39535)'
  const other = 'ag:(anilist:178789,kitsu:49002,mal:59193)'

  test('grows once the store has folded more sources into the same work', () => {
    expect(shouldRewriteAddress(full, known)).toBe(true)
  })

  test('and stops once the address already names them all', () => {
    expect(shouldRewriteAddress(full, full)).toBe(false)
  })

  test('NEVER rewrites the address to a different work, however much bigger it is', () => {
    // the bug: on a navigation the address changes first and the page still holds the previous work,
    // so its eight handles beat the new address's one and the click was replaced with the page it
    // came from. Every relation and every graph node did nothing when clicked.
    expect(shouldRewriteAddress(other, known)).toBe(false)
  })

  test('nor when the work in hand knows FEWER sources than the address names', () => {
    expect(shouldRewriteAddress(known, full)).toBe(false)
  })

  test('a bare source uri on either side is left alone', () => {
    expect(shouldRewriteAddress('anilist:108465', known)).toBe(false)
    expect(shouldRewriteAddress(full, 'anilist:108465')).toBe(false)
  })

  // Steel Ball Run's second stage, welded to the first stage's rows for a pass and split by the next
  const welded = 'ag:(anilist:210482,mal:61469,offline:mal-61469)'
  const split = 'ag:(anilist:210482,offline:mal-63825)'

  test('an address the page wrote follows its work down after a split', () => {
    expect(shouldRewriteAddress(split, welded, welded)).toBe(true)
  })

  test('a link the reader opened does not', () => {
    expect(shouldRewriteAddress(split, welded)).toBe(false)
    expect(shouldRewriteAddress(split, welded, known)).toBe(false)
  })

  test('and even an address the page wrote never goes to a different work', () => {
    expect(shouldRewriteAddress(other, full, full)).toBe(false)
  })

  test('nor is rewritten to itself', () => {
    expect(shouldRewriteAddress(welded, welded, welded)).toBe(false)
  })

  test('and a missing uri is not an address to grow', () => {
    expect(shouldRewriteAddress(undefined, known)).toBe(false)
    expect(shouldRewriteAddress(full, undefined)).toBe(false)
    expect(shouldRewriteAddress(undefined, undefined)).toBe(false)
  })
})

// The SINGLETON PATH IS GONE on both types (migration step 3), so a one-source work is addressed
// `ag:(mal:39535)` where the store used to publish `mal:39535`. Both spellings are live at once: the
// new address is what every page mints, and the old one is in every bookmark, party link and shared
// `/watch` path already out there. `asAggregatedUri` is what makes them converge, so a comparison
// that runs it on both sides accepts either, which is what `media-modal.tsx` and `watch/index.tsx`
// now do.
describe('both spellings of a one-source address', () => {
  test('converge on the SAME aggregated form, whichever way round they arrive', () => {
    expect(asAggregatedUri('mal:39535')).toBe(asAggregatedUri('ag:(mal:39535)'))
    expect(asAggregatedUri('mal:39535')).toBe('ag:(mal:39535)')
  })

  test('so a bare uri and the address the store mints for it MATCH as the same work', () => {
    const bare = 'mal:39535'
    const minted = 'ag:(mal:39535)'
    // the comparison the modal and the watch page make, with both sides normalized
    expect(matchAggregatedUris(asAggregatedUri(bare) as never, asAggregatedUri(minted) as never)).toBe(true)
    // and the control that proves the comparison can still say no: a different work does not match
    expect(matchAggregatedUris(asAggregatedUri(bare) as never, asAggregatedUri('mal:60059') as never)).toBe(false)
  })

  test('and the same for a one-row EPISODE uri, which took the same change', () => {
    expect(asAggregatedUri('anizip:14758-1')).toBe('ag:(anizip:14758-1)')
    expect(
      matchAggregatedUris(asAggregatedUri('anizip:14758-1') as never, asAggregatedUri('ag:(anizip:14758-1)') as never)
    ).toBe(true)
  })
})
