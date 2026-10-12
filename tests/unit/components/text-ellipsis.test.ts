import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

// The clamp sets the box to a whole number of lines, counted from the computed line height. Left at
// `normal`, that height is the font's own, which for Montserrat on Chrome 155 at 15px is 19px, and the
// count used 1.2 times the size: the phone hero's last line lost its descenders (2026-10-13). The rig
// draws a fallback face, so only the declaration can be pinned here.
const source = readFileSync(fileURLToPath(new URL('../../../src/components/text-ellipsis.tsx', import.meta.url)), 'utf-8')
const rule = /const style = css`([^`]*)`/.exec(source)?.[1] ?? ''

test('the clamped text sets its own line height, so the lines it counts are the lines it draws', () => {
  // CONTROL: the rule was read, so a missing declaration is the rule's and not the regex's
  expect(rule).toContain('-webkit-box-orient: vertical;')
  expect(rule).toMatch(/line-height: \d/)
})
