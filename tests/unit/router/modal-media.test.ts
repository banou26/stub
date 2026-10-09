// What the media route opens, and on what. Open problem 22, recorded 2026-08-31: "A direct
// navigation to a wide media uri never opens the modal ... The modal matches against the home
// listing's own narrower uri", which is why a pasted media link looked broken.
//
// MEASURED AGAIN 2026-09-12 against the running app (npm run dev, headless Chrome, the real store),
// four direct navigations: a 9 member uri wider than anything the store holds, the record's own
// `ag:(anilist:178789,...)` link, a work the current season listing does not carry at all
// (`ag:(mal:1)`, Cowboy Bebop) and a bare `anilist:178789`. Every one of them mounted the overlay
// and filled it, so the overlay half of that report is closed.
//
// What was left is the match against the listing, which refused every uri that is not an `ag:(...)`
// of its own, so the modal had nothing to draw while the store was still asking. Same day, same rig,
// the first painted frame after a navigation with the season listing already loaded:
//
//   route uri                      | matched by equality of aggregates | matched by shared member
//   /media/anilist:178789          | (empty modal)                     | Mushoku Tensei ... Season 3
//   /media/mal:59193               | (empty modal)                     | Mushoku Tensei ... Season 3
//   /media/ag:(...,zz:99) (wider)  | Mushoku Tensei ... Season 3       | Mushoku Tensei ... Season 3
//   /media/ag:(mal:1) (not listed) | (empty modal)                     | (empty modal)
//
// The third row is the control: it is the same under both rules, so a rig that painted a title
// whatever the code said would have shown the first two filled as well. The fourth is the answer
// staying honest, since nothing on that page names Cowboy Bebop; the store fills it a beat later.
//
// The rule is tested through `src/router/home/modal-media.ts` because media-modal.tsx cannot be
// imported here at all: it reaches @floating-ui/react, which resolves `react` through vite's preact
// alias, and vitest.config.ts carries no plugins, so the import dies with "Cannot find package
// 'react'". The `tests/unit/components/dom.ts` harness does not help, and it was measured rather
// than assumed: importing the modal behind it fails identically, since what is missing is a package
// and not a document. The component's own shape is therefore read off the source below, each
// assertion with a control, the way tests/unit/components/chrome.test.ts reads css it cannot lay out.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

import { listedMediaFor, namesSameWork } from '../../../src/router/home/modal-media'
import { shouldGrowAddress } from '../../../src/utils/uri'

// The record's own example, read off the running home page on 2026-09-12: the card carries four
// sources, the address the store grew to carries eight, and a link copied from that address is what
// a friend opens.
const CARD = 'ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)'
const SHARED_LINK = 'ag:(anilist:178789,anizip:18727,cr:G24H1N3MP-GS00374452,jw:222366-490814,kitsu:49002,mal:59193,nf:80987039-3,offline:mal-59193)'
const OTHER_CARD = 'ag:(anilist:135865,kitsu:44778,mal:49233,offline:mal-49233)'
const UNLISTED = 'ag:(anidb:23,anilist:1,anizip:23,kitsu:1,mal:1,offline:mal-1)'

const listing = [{ _id: 'card', uri: CARD }, { _id: 'other', uri: OTHER_CARD }]

describe('the listed card a media route is showing', () => {
  test('a shared link naming more sources than the card still names the card\'s work', () => {
    expect(listedMediaFor(SHARED_LINK, listing)).toBe(listing[0])
  })

  // The other direction of the same growth: a link copied before the store folded the rest in.
  test('and so does one naming fewer', () => {
    expect(listedMediaFor('ag:(mal:59193)', listing)).toBe(listing[0])
  })

  // A relation, a graph node and anything linking in from outside name a work through ONE source.
  // `matchAggregatedUris` answers false for every one of these, since one side is not an `ag:(...)`,
  // which is the empty first frame in rows one and two of the table above.
  test('a bare source uri names the work that carries it', () => {
    expect(listedMediaFor('anilist:178789', listing)).toBe(listing[0])
    expect(namesSameWork('anilist:178789', CARD)).toBe(true)
    expect(namesSameWork('anilist:178789', 'anilist:178789')).toBe(true)
  })

  // CONTROL. Opening a card from the listing is the path that always worked, and a rule that said
  // yes to everything would pass every test above while breaking this one.
  test('a listed card opens as itself', () => {
    expect(listedMediaFor(CARD, listing)).toBe(listing[0])
    expect(listedMediaFor(OTHER_CARD, listing)).toBe(listing[1])
  })

  // CONTROL. Sharing no source handle is a different work, whatever else the two uris have in common.
  test('a work the listing does not carry matches nothing on the page', () => {
    expect(listedMediaFor(UNLISTED, listing)).toBeUndefined()
    expect(namesSameWork(CARD, OTHER_CARD)).toBe(false)
    expect(namesSameWork(UNLISTED, SHARED_LINK)).toBe(false)
  })

  // An id is only shared within its own origin: `mal:1` and `anilist:1` are two different works.
  test('the same id under another origin is not a shared member', () => {
    expect(namesSameWork('ag:(anilist:1)', 'ag:(mal:1)')).toBe(false)
  })

  test('and nothing at all is not a work', () => {
    expect(listedMediaFor(undefined, listing)).toBeUndefined()
    expect(listedMediaFor('', listing)).toBeUndefined()
    expect(listedMediaFor(CARD, [])).toBeUndefined()
    expect(listedMediaFor(CARD, undefined)).toBeUndefined()
    expect(namesSameWork(undefined, undefined)).toBe(false)
    // `isUri` throws on a comma in an id, and a throw in a render is permanent DOM corruption here
    expect(() => namesSameWork('not a uri, really', CARD)).not.toThrow()
    expect(namesSameWork('not a uri, really', CARD)).toBe(false)
  })
})

describe('what the modal does with that answer', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)), 'utf-8')
  const component = source.slice(source.indexOf('const MediaModal ='))

  // CONTROL: the component was actually read, and it is the one that consults the listing.
  test('the modal component was actually read', () => {
    expect(component).toContain('listedMediaFor(params.uri, mediaNodes)')
    expect(component).toContain('mediaNodes')
  })

  /**
   * The modal opens on the ROUTE, never on the listing.
   *
   * `media` is answered by a subscription on the route's own uri, and the worker resolves an
   * aggregate by falling back to its members one at a time, so a uri the current season listing has
   * never heard of still answers. Gating the overlay on a found card would close the modal for every
   * link to a work outside this season, which is most links anyone shares.
   */
  test('the open state asks the listing nothing, and the route params nothing either', () => {
    const initial = /const \[open, onOpenChange\] = useState\(([^\n]*)\)/.exec(component)?.[1]
    expect(initial, 'the open state was not found, so this test read nothing').toBeTypeOf('string')
    expect(initial).not.toMatch(/foundMedia|mediaNodes|params/)
  })

  test('and the only way out of the modal is the person closing it', () => {
    const redirects = component.match(/<Redirect[^/]*/g) ?? []
    expect(redirects, 'no redirect was found, so this test read nothing').toHaveLength(1)
    expect(component).toContain('if (!open) return <Redirect to="/" />')
  })
})

describe('the address the modal leaves behind', () => {
  /**
   * FORWARD ONLY. The modal rewrites its address as the store folds more sources into the cluster,
   * and a shared link that already names more than the page has must be left exactly as it is:
   * rewriting it to the card's four sources would hand the next person a narrower link than the one
   * they were given, and the address is the shareable route the watch party syncs between viewers.
   */
  test('a link wider than the listing is not rewritten to the listing', () => {
    expect(shouldGrowAddress(CARD, SHARED_LINK)).toBe(false)
  })

  // CONTROL: the same pair the other way round, which is the growth this rule exists to allow.
  test('and one narrower than the work in hand still grows', () => {
    expect(shouldGrowAddress(SHARED_LINK, CARD)).toBe(true)
  })

  test('the modal rewrites the address only through that rule', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)), 'utf-8')
    const navigations = source.match(/navigate\([^\n]*/g) ?? []
    // CONTROL: the rewrite is there to be guarded, and it goes to the media route.
    expect(navigations, 'no navigation was found, so this test read nothing').toHaveLength(1)
    expect(navigations[0]).toContain('Route.MEDIA')
    expect(source).toContain('if (shouldGrowAddress(media?.uri, params.uri)) {')
  })
})

/**
 * The modal's trailer box takes its whole height from its aspect ratio. Everything inside it is
 * absolutely placed, the player being a size container that gives its box no height, so without the
 * ratio the box collapses to 0 and the trailer and its cover are gone (measured headless: 562.5px
 * with it, 0px without).
 */
test('the trailer box is 16:9, the shape the player fills without cropping the picture', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)), 'utf-8')
  const trailer = /\n {2}\.trailer \{\n([^{}]*)\n {4}\.player \{/.exec(source)?.[1]
  expect(trailer, 'the .trailer block was not found, so this test read nothing').toContain('position: relative;')
  expect(trailer).toContain('aspect-ratio: 16 / 9;')
})
