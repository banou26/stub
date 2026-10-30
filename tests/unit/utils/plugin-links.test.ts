import { describe, expect, test } from 'vite-plus/test'

import { comparablePluginUri, readPluginUris, withoutPluginUris, writePluginUris } from '../../../src/utils/plugin-links'

// These run on every navigation, so a throw or a non-idempotent write breaks routing, not just the query.

const BASE = 'https://stub.moe/media/anilist:108465'
const NYAA = 'npm:@banou/stub-plugin'
const DEV = 'localhost:4599'

describe('writePluginUris', () => {
  test('a bare path picks up the registered plugins, which is what every <Link> hands over', () => {
    expect(writePluginUris('/search/mushoku', [NYAA], BASE))
      .toBe('https://stub.moe/search/mushoku?plugins=npm:@banou/stub-plugin')
  })

  test('the address is left readable rather than form-encoded', () => {
    const written = writePluginUris('/', [NYAA], BASE)
    expect(written).toContain('plugins=npm:@banou/stub-plugin')
    expect(written).not.toContain('%3A')
  })

  test('and still round-trips, which is the only thing the encoding has to guarantee', () => {
    for (const uri of [NYAA, DEV, 'https://stub.plugins.banou.dev', 'npm:a+b', 'npm:a&b=c', 'npm:a b']) {
      expect(readPluginUris(writePluginUris('/', [uri], BASE))).toEqual([uri])
    }
  })

  test('existing params and the hash survive, so this composes with any other route state', () => {
    expect(writePluginUris('/watch/a/b?t=42#frag', [NYAA], BASE))
      .toBe('https://stub.moe/watch/a/b?t=42&plugins=npm:@banou/stub-plugin#frag')
  })

  test('plugins already on the url are replaced, never appended', () => {
    const once = writePluginUris('/', [NYAA, DEV], BASE)
    expect(writePluginUris(once, [NYAA, DEV], BASE)).toBe(once)
    expect(readPluginUris(writePluginUris(once, [DEV], BASE))).toEqual([DEV])
  })

  test('an empty list strips the param instead of leaving a dangling one', () => {
    expect(writePluginUris('/search/x?plugins=npm:gone', [], BASE)).toBe('https://stub.moe/search/x')
    expect(writePluginUris('/search/x?q=1&plugins=npm:gone', [], BASE)).toBe('https://stub.moe/search/x?q=1')
  })

  test('the query is sorted, so a reordered enabled list does not rewrite the address bar', () => {
    expect(writePluginUris('/', [DEV, NYAA], BASE)).toBe(writePluginUris('/', [NYAA, DEV], BASE))
  })

  test('the same url in gives the same url out, which is what stops the sync looping', () => {
    const settled = writePluginUris(BASE, [NYAA], BASE)
    expect(writePluginUris(settled, [NYAA], settled)).toBe(settled)
  })

  test('a cross-origin url is untouched: an outbound link carries no source list', () => {
    expect(writePluginUris('https://anilist.co/anime/108465', [NYAA], BASE))
      .toBe('https://anilist.co/anime/108465')
  })

  test('an unparseable target is passed through rather than throwing mid-navigation', () => {
    expect(writePluginUris('http://[', [NYAA], BASE)).toBe('http://[')
    expect(writePluginUris('/media/x', [NYAA], 'not-a-url')).toBe('/media/x')
  })

  test('a duplicate is written once', () => {
    expect(readPluginUris(writePluginUris('/', [NYAA, NYAA], BASE))).toEqual([NYAA])
  })
})

describe('readPluginUris', () => {
  test('every plugin param is read, in order', () => {
    expect(readPluginUris(`https://stub.moe/?plugins=${DEV}&plugins=${NYAA}`)).toEqual([DEV, NYAA])
  })

  test('no param is no invite, not an empty-string one', () => {
    expect(readPluginUris('https://stub.moe/media/x')).toEqual([])
    expect(readPluginUris('https://stub.moe/?plugins=&plugins=%20')).toEqual([])
  })

  test('a relative url reads against the base it was given', () => {
    expect(readPluginUris(`/search/x?plugins=${NYAA}`, BASE)).toEqual([NYAA])
  })

  test('a malformed url reads as no invites rather than throwing on load', () => {
    expect(readPluginUris('::nonsense')).toEqual([])
  })

  test('a repeated address is offered once', () => {
    expect(readPluginUris(`https://stub.moe/?plugins=${NYAA}&plugins=${NYAA}`)).toEqual([NYAA])
  })
})

// HOR-1106: a party compares the host's page with each follower's, and each address carries its own viewer's sources
describe('withoutPluginUris', () => {
  test('both names go, every other parameter and the fragment stay as written', () => {
    expect(withoutPluginUris(`/search?season=FALL&plugins=${NYAA}&year=2026&plugin=${DEV}#top`)).toBe('/search?season=FALL&year=2026#top')
    expect(withoutPluginUris('/search?q=a%20b+c&plugins_x=1')).toBe('/search?q=a%20b+c&plugins_x=1')
  })

  test('a query of sources only leaves no question mark', () => {
    expect(withoutPluginUris(`/watch/a/b?plugins=${NYAA}&plugins=${DEV}`)).toBe('/watch/a/b')
    expect(withoutPluginUris(`/watch/a/b?plugins=${NYAA}#t`)).toBe('/watch/a/b#t')
  })

  test('a path with no query, or a question mark only in the fragment, is untouched', () => {
    expect(withoutPluginUris('/watch/a/b')).toBe('/watch/a/b')
    expect(withoutPluginUris('/party#key.room?plugins=x')).toBe('/party#key.room?plugins=x')
  })
})

describe('comparablePluginUri', () => {
  test('a pinned version compares equal to the address it installs as', () => {
    expect(comparablePluginUri('npm:@banou/stub-plugin@0.1.0')).toBe('npm:@banou/stub-plugin')
    expect(comparablePluginUri('npm:express@4')).toBe('npm:express')
  })

  test('a scope is not mistaken for a version', () => {
    expect(comparablePluginUri('npm:@banou/stub-plugin')).toBe('npm:@banou/stub-plugin')
  })

  test('a port is not mistaken for a version', () => {
    expect(comparablePluginUri('localhost:4599')).toBe('localhost:4599')
  })

  test('surrounding space and a trailing slash do not make a second entry', () => {
    expect(comparablePluginUri('  https://stub.plugins.banou.dev/  ')).toBe('https://stub.plugins.banou.dev')
  })
})

/**
 * The parameter was `plugin` until 2026-09-09 and is `plugins` now, which is what it always meant:
 * `readPluginUris` has always returned a LIST, and an invite routinely carries several.
 *
 * An invite is a url someone pasted into a chat, so the old name outlives the rename by however long
 * that chat does. It is still read, and never written, so a link that arrives under the old name
 * leaves under the new one instead of carrying both.
 */
describe('the parameter rename', () => {
  const BASE = 'https://stub.moe/'
  const NYAA = 'https:stub.plugins.banou.dev'
  const DEV = 'localhost:4599'

  test('a link shared under the old name still offers its sources', () => {
    expect(readPluginUris(`https://stub.moe/?plugin=${NYAA}`)).toEqual([NYAA])
    expect(readPluginUris(`https://stub.moe/?plugin=${DEV}&plugin=${NYAA}`)).toEqual([DEV, NYAA])
  })

  test('and one under either name is the same offer, counted once', () => {
    expect(readPluginUris(`https://stub.moe/?plugins=${NYAA}&plugin=${NYAA}`)).toEqual([NYAA])
    expect(readPluginUris(`https://stub.moe/?plugin=${DEV}&plugins=${NYAA}`)).toEqual([DEV, NYAA])
  })

  test('what is written is the new name, and only the new name', () => {
    const written = writePluginUris('https://stub.moe/', [NYAA], BASE)
    expect(written).toContain(`plugins=${NYAA}`)
    expect(written).not.toMatch(/[?&]plugin=/)
  })

  test('an old name on the way in is replaced rather than kept alongside', () => {
    const written = writePluginUris(`https://stub.moe/?plugin=${DEV}`, [NYAA], BASE)
    expect(written).toBe(`https://stub.moe/?plugins=${NYAA}`)
    expect(written).not.toContain(DEV)
  })

  test('and a url carrying only the old name is cleaned when nothing is enabled', () => {
    expect(writePluginUris(`https://stub.moe/search/x?q=1&plugin=${DEV}`, [], BASE))
      .toBe('https://stub.moe/search/x?q=1')
  })
})
