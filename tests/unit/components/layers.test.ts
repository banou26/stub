import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, describe, test } from 'vitest'

import { FKN_OVERLAY, layer } from '../../../src/layers'

// `src/layers.ts` is only a single source of truth while nothing writes a number beside it, so the
// last describe below reads every file in `src/` and refuses a raw z-index. That guard is the point
// of this file: the ordering assertions catch a layer moved wrongly, the guard catches the next popup
// that never joins the order at all, which is how the previous arrangement broke.

const root = fileURLToPath(new URL('../../..', import.meta.url))

const walk = (dir: string, out: string[] = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

const sources = walk(join(root, 'src'))
  .filter(path => !path.includes('/generated/'))
  .map(path => ({ path: path.slice(root.length), text: readFileSync(path, 'utf-8') }))

describe('the layer order', () => {
  // Ascending, and the list is written in that order so the file reads bottom of the page to top. A
  // new entry in the wrong place is a mistake worth catching, since the whole value of the module is
  // that the order can be READ.
  test('the module is declared in the order it stacks', () => {
    const values = Object.values(layer)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(Object.keys(layer)).size, 'a duplicate key would silently shadow one').toBe(values.length)
  })

  /**
   * The relations that are decisions rather than accidents, each one paid for.
   *
   * The header sits over the modal so a follower whose host opened a modal can still reach the party
   * pill and stop following. That only ever covered the BUTTON: what the bar OPENS is portalled to
   * the body and inherits nothing, so at 150 / 400 / 145 the party menu, the account menu and the
   * chat all opened under the modal, where the overlay both hid them and took their clicks. Since
   * that overlay is the modal's own dismiss target, the click that missed them closed the show.
   */
  test('what the header opens clears the modal, and stays with the bar', () => {
    expect(layer.header).toBeGreaterThan(layer.mediaModal)
    expect(layer.headerPopup).toBeGreaterThan(layer.header)
  })

  /**
   * And no higher, which is not tidiness. The franchise dialog dismisses on outside press, so a chat
   * button painted over it would throw the graph away on the very click that opened the chat, and the
   * party menu force-opens itself when a party ends, which would do it with no click at all.
   */
  test('and no higher than the dialogs that cover the bar on purpose', () => {
    expect(layer.headerPopup).toBeLessThan(layer.franchiseDialog)
    expect(layer.franchiseDialog).toBeLessThan(layer.pluginPrompt)
  })

  // the ghost pointer says where the host's HAND is, so it goes over everything the app draws; it
  // takes nothing in exchange, having no pointer events
  test('the party cursor is over every layer, and under the one that is not ours', () => {
    for (const [name, value] of Object.entries(layer)) {
      if (name === 'partyCursor') continue
      expect(layer.partyCursor, name).toBeGreaterThan(value)
    }
    expect(layer.partyCursor).toBeLessThan(FKN_OVERLAY)
  })
})

/**
 * The numbers that are NOT page layers, and why each one is allowed to stay a literal.
 *
 * Every other z-index in `src/` has to come from the module. An entry here is a claim that the number
 * orders boxes inside one component and means nothing against the page, so a reader who finds it does
 * not have to work that out again.
 */
const LOCAL: Record<string, { values: number[], why: string }> = {
  'src/router/home/media-modal.tsx': {
    values: [0, 1],
    why: 'inside one episode row: the full-row link under the source chips that sit on top of it',
  },
  'src/components/media-franchise.tsx': {
    values: [1],
    why: "the kind filter over the graph canvas, inside the dialog's own sheet",
  },
  'src/components/score-picker.tsx': {
    values: [1],
    why: "the star's score menu, inline in the tracking row and not portalled, painted over the description under the row",
  },
  'src/sources/crunchyroll/player.tsx': {
    values: [30, 9999999],
    why: 'the 30 orders the loading screen over the skin inside the player box; the 9999999 is a string injected into crunchyroll.com with addStyleTag, so it orders that document and never reaches ours',
  },
  'src/sources/unogs/player.tsx': {
    values: [30, 9999999],
    why: 'the same two, for netflix.com',
  },
}

describe('nothing writes a layer beside the module', () => {
  // `z-index: 1150` in css, and `zIndex: 1150` in an inline style object, are both a raw layer. An
  // interpolation reads `z-index: ${layer.headerPopup}` and carries no digits, so it never matches.
  const RAW = /(?:z-index|zIndex)\s*:\s*(-?\d+)/g

  const found = sources.flatMap(({ path, text }) =>
    [...text.matchAll(RAW)]
      // a number quoted inside a comment is prose, not a rule, and the rule above it already moved
      .filter(match => !/^\s*(?:\/\/|\/\*|\*)/.test(text.slice(text.lastIndexOf('\n', match.index) + 1, match.index)))
      .map(match => ({ path, value: Number(match[1]) })))

  // CONTROL. The whole describe is "and nothing else was found", which an empty scan satisfies
  // perfectly. These are the literals that are SUPPOSED to be there, so a reader that stopped
  // matching fails here rather than reporting a clean tree it never read.
  test('the scan reads the files and finds the literals it should', () => {
    expect(sources.length, 'no sources walked').toBeGreaterThan(100)
    expect(found.length, 'no raw z-index at all, so the reader is broken').toBeGreaterThan(0)
    expect(sources.some(({ text }) => text.includes('z-index: ${layer.headerPopup}')), 'no file interpolates a layer')
      .toBe(true)
  })

  test('every raw z-index left in src is a local ordering, listed with its reason', () => {
    const stray = found.filter(({ path, value }) => !LOCAL[path]?.values.includes(value))
    expect(stray, 'use src/layers.ts, or add it to LOCAL above saying why it is not a page layer')
      .toEqual([])
  })

  // an entry that stops matching anything is a note about code that is gone, and it would quietly
  // permit that number if the file ever wrote it again
  test('and every listed exception still exists', () => {
    for (const [path, { values }] of Object.entries(LOCAL)) {
      for (const value of values) {
        expect(found, `${path} no longer has a raw ${value}`).toContainEqual({ path, value })
      }
    }
  })
})
