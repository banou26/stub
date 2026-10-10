import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// A <button> draws in the browser's own face unless its rule says otherwise: measured on Chrome
// 153.0.8010.47 on 2026-10-11, the description's Expand drew in Arial beside the page's Montserrat.
const source = readFileSync(fileURLToPath(new URL('../../../src/components/collapsible.tsx', import.meta.url)), 'utf-8')
const toggle = /\.toggle-button \{([^}]*)\}/.exec(source)?.[1] ?? ''

test("the description's Expand button draws in stub's font", () => {
  // CONTROL: the rule was read, so a missing declaration is the rule's and not the regex's
  expect(toggle).toContain('cursor: pointer;')
  expect(toggle).toContain('font-family: inherit;')
})
