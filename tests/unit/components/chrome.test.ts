import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, describe, test } from 'vite-plus/test'

// These invariants are CSS and one HTML attribute, so there is nothing to import and call. They are
// read off the source instead, the way tests/unit/sources/index.test.ts reads the schema, and every
// one of them carries a control: a regex that stopped matching would otherwise report a passing
// invariant it never looked at.
//
// What no unit test can do is LAY THE PAGE OUT, so each rule's behaviour was measured in a real
// browser and the number is recorded with the rule.
//
// THE STACKING ORDER IS NOT HERE. It moved into src/layers.ts, so ./layers.test.ts asserts it by
// importing the module rather than reading numbers back out of nine files, and
// scripts/check-modal-header.mjs drives the real page for the half a unit test cannot see.

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf-8')

describe("the plugin player's frame", () => {
  const source = read('src/components/plugin-player.tsx')
  const sandbox = /sandbox="([^"]+)"/.exec(source)?.[1]?.split(/\s+/) ?? []

  // CONTROL: the two flags the FKN broker refuses to mount without. If these are missing the regex
  // found the wrong thing, since no working build can lack them.
  test('the sandbox attribute was actually read', () => {
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')
  })

  /**
   * Sandbox flags are INHERITED by a nested frame and can only be added to, so this attribute decides
   * what ripple can do two frames down, and ripple cannot ask for any of it back.
   *
   * Without `allow-popups` its player's links ("Open this torrent in Ripple", "Download") did nothing
   * at all: the browser blocks the tab and says so only in the console, which no one is reading.
   * Without `allow-popups-to-escape-sandbox` the tab opens still sandboxed, where a download is
   * blocked and a form submit does nothing. Measured over that frame chain on Chrome 149, 2026-09-09.
   */
  test('a link inside the player can open a tab, and that tab is an ordinary page', () => {
    expect(sandbox).toContain('allow-popups')
    expect(sandbox).toContain('allow-popups-to-escape-sandbox')
  })
})

describe('the header search field', () => {
  const source = read('src/components/header.tsx')
  const block = source.slice(source.indexOf('.search {'), source.indexOf('.actions {', source.indexOf('.search {')))
  const rulesOf = (selector: string) => {
    const from = block.indexOf(`${selector} {`)
    return from < 0 ? '' : block.slice(from, block.indexOf('}', from))
  }

  // CONTROL: the block has to be the search field's, with both children in it.
  test('the search field block was actually read', () => {
    expect(block).toContain('backdrop-filter')
    expect(rulesOf('input')).toContain('font-size')
    expect(rulesOf('svg')).toContain('color')
  })

  /**
   * Measured in Chrome at 1440px before this changed: the pill was 320x38 and its input was 262x19,
   * so HALF the bar's height and both ends of it were the form's own padding. `elementFromPoint` at
   * every inner edge returned the form, which sets no caret, so a click aimed at the field did
   * nothing. Padding on the box around an input is dead space by construction; the input has to carry
   * its own inset for the whole pill to be the target.
   */
  test('the field carries the inset, so the whole pill is the click target', () => {
    const own = block.slice(0, block.indexOf('&:focus-within'))
    expect(own, 'padding on the form is dead space').not.toMatch(/^\s*padding[\w-]*:/m)
    expect(rulesOf('input')).toMatch(/padding-inline:\s*[^;]+;/)
  })

  // the glyph is drawn over the field rather than beside it, so its share of the pill stays a target
  test('and the glyph does not swallow the click that lands on it', () => {
    expect(rulesOf('svg')).toContain('pointer-events: none')
  })
})
