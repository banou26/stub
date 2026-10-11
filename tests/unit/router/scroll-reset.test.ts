// Every navigation the app makes, tabled against the rule. A wrong answer here is either a page that
// opens 1,200px down (the report that started this, 2026-09-08) or a modal that yanks the home page to
// the top under itself, and neither errors.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { askForTop, cancelReset, isHomeFamily, resetPending, resetsScroll, scheduleReset, scrollToTop, takeAskedTop } from '../../../src/router/scroll-reset'
import type { Navigation, NavigationKind } from '../../../src/router/scroll-reset'

const at = (url: string) => {
  const [pathname, search = ''] = url.split('?')
  return { pathname: pathname!, search: search ? `?${search}` : '' }
}

const go = (from: string, to: string, kind: NavigationKind, asked?: boolean): Navigation =>
  ({ from: at(from), to: at(to), kind, ...(asked === undefined ? {} : { asked }) })

const MEDIA = '/media/ag:(anilist:207141,mal:63403)'
const WATCH = '/watch/ag:(anilist:207141)/ag:(anizip:19873-4)'

describe('isHomeFamily', () => {
  test('the home page and the modal over it are one page', () => {
    expect(isHomeFamily('/')).toBe(true)
    expect(isHomeFamily(MEDIA)).toBe(true)
    expect(isHomeFamily('/media/a/b')).toBe(true)
  })

  test('every other page is its own', () => {
    for (const pathname of ['/search', '/search/legacy', WATCH, '/party', '/settings', '/legal', '/privacy', '/media-kit', '/mediaX']) {
      expect(isHomeFamily(pathname), pathname).toBe(false)
    }
  })
})

describe('resetsScroll', () => {
  test('a link to another page: the report itself, Current season from a scrolled home page', () => {
    expect(resetsScroll(go('/', '/search?season=FALL&year=2026', 'push'))).toBe(true)
  })

  const elsewhere: [string, string, string][] = [
    ['the settings icon', '/search?query=a', '/settings'],
    ['a footer link', '/', '/legal'],
    ['an episode from the modal', MEDIA, WATCH],
    ['the party page', '/', '/party'],
    ['a card from the listing, whose modal opens over the HOME page, not the listing', '/search?season=FALL', MEDIA],
    ['the wordmark from the listing', '/search?season=FALL', '/'],
  ]
  for (const [label, from, to] of elsewhere) {
    test(`a push to another page resets: ${label}`, () => {
      expect(resetsScroll(go(from, to, 'push'))).toBe(true)
    })
  }

  test('the same page pushed again is the page asked for again', () => {
    expect(resetsScroll(go('/search?season=FALL', '/search?season=FALL&query=naruto', 'push'))).toBe(true)
    expect(resetsScroll(go('/search?query=a', '/search?query=a', 'push'))).toBe(true)
  })

  test('the same page pushed again: the next episode, or another source, from the watch page', () => {
    expect(resetsScroll(go(WATCH, `${WATCH}/nyaa:2136446`, 'push'))).toBe(true)
  })

  const family: [string, string, string, NavigationKind][] = [
    ['opening a card', '/', MEDIA, 'push'],
    ['closing the modal, which redirects home', MEDIA, '/', 'push'],
    ['the canonical uri replacing the one in the address bar', MEDIA, '/media/ag:(anilist:207141,mal:63403,kitsu:50551)', 'replace'],
    ['one modal to another', MEDIA, '/media/other', 'push'],
  ]
  for (const [label, from, to, kind] of family) {
    test(`within the home family the page stays: ${label}`, () => {
      expect(resetsScroll(go(from, to, kind))).toBe(false)
    })
  }

  test('a replace on the same page is the url as state and moves nothing: the search filters, the header typing', () => {
    expect(resetsScroll(go('/search?season=FALL', '/search?season=FALL&format=TV', 'replace'))).toBe(false)
    expect(resetsScroll(go('/search?query=nar', '/search?query=naru', 'replace'))).toBe(false)
  })

  test('the title page growing its address is the same page, and stays where the reader is', () => {
    expect(resetsScroll(go('/title/ag:(mal:1)', '/title/ag:(anilist:9,mal:1)', 'replace'))).toBe(false)
    expect(resetsScroll(go('/title/ag:(mal:1)', '/title/ag:(mal:2)', 'push')), 'a link to another title').toBe(true)
  })

  test('a replace that changes the page is a redirect, and the new page starts at the top', () => {
    expect(resetsScroll(go('/search/naruto', '/search?query=naruto', 'replace'))).toBe(true)
  })

  test('back and forward belong to the browser, wherever they go', () => {
    expect(resetsScroll(go('/search?season=FALL', '/', 'pop'))).toBe(false)
    expect(resetsScroll(go('/', '/search?season=FALL', 'pop'))).toBe(false)
    expect(resetsScroll(go(WATCH, '/settings', 'pop'))).toBe(false)
  })

  test('a link that asked for the top gets it, even within the family the rule keeps', () => {
    expect(resetsScroll(go('/', '/', 'push', true))).toBe(true)
    expect(resetsScroll(go(MEDIA, '/', 'push', true))).toBe(true)
  })
})

describe('askForTop', () => {
  test('is consumed by the next take and by it only', () => {
    expect(takeAskedTop()).toBe(false)
    askForTop()
    expect(takeAskedTop()).toBe(true)
    expect(takeAskedTop()).toBe(false)
  })
})

describe('scrollToTop', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  test('jumps, and says so: `instant`, since `auto` would defer to a stylesheet', () => {
    const calls: unknown[] = []
    vi.stubGlobal('window', { scrollTo: (options: unknown) => { calls.push(options) } })
    scrollToTop()
    expect(calls).toEqual([{ top: 0, left: 0, behavior: 'instant' }])
  })
})

describe('scheduleReset', () => {
  /** A document whose frames only run when a test says so, so the window between scheduling and firing is real. */
  const frames = () => {
    const pending = new Map<number, () => void>()
    let next = 1
    const scrolls: unknown[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { pending.set(next, callback); return next++ })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { pending.delete(handle) })
    vi.stubGlobal('window', { scrollTo: (options: unknown) => { scrolls.push(options) } })
    return { scrolls, run: () => { for (const callback of [...pending.values()]) callback(); pending.clear() } }
  }

  afterEach(() => { cancelReset(); vi.unstubAllGlobals() })

  test('waits a frame rather than scrolling where it was called', () => {
    const { scrolls, run } = frames()
    scheduleReset()
    expect(scrolls).toEqual([])
    expect(resetPending()).toBe(true)
    run()
    expect(scrolls).toEqual([{ top: 0, left: 0, behavior: 'instant' }])
    expect(resetPending()).toBe(false)
  })

  test('cancelReset drops a reset that has not run: the party placing a follower where the host is', () => {
    const { scrolls, run } = frames()
    scheduleReset()
    cancelReset()
    run()
    expect(scrolls).toEqual([])
    expect(resetPending()).toBe(false)
  })

  test('cancelReset is safe when nothing is pending', () => {
    const { scrolls, run } = frames()
    cancelReset()
    run()
    expect(scrolls).toEqual([])
  })

  test('scheduling twice resets once, not twice', () => {
    const { scrolls, run } = frames()
    scheduleReset()
    scheduleReset()
    run()
    expect(scrolls).toHaveLength(1)
  })

  test('a reset that has already fired leaves nothing for a later cancel to drop', () => {
    const { scrolls, run } = frames()
    scheduleReset()
    run()
    cancelReset()
    run()
    expect(scrolls).toHaveLength(1)
  })
})
