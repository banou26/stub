// The label UI is a plain browser script with no exports, so its date display is read off the source.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vite-plus/test'

const source = readFileSync(new URL('../../../tools/label/app.js', import.meta.url), 'utf-8')
const day = runInNewContext(`${source.match(/^const day = value => \{[\s\S]*?^\}/m)![0]}\nday`) as (value: unknown) => string

test('the label tool shows a year or a month alone as just that, and anything else as its day', () => {
  expect(day('2027')).toBe('2027')
  expect(day('2027-10')).toBe('2027-10')
  expect(day('Sat, 04 Jul 2026 00:00:00 GMT'), 'the control: AniList\'s spelling of a day').toBe('2026-07-04')
  expect(day('2027-10-15')).toBe('2027-10-15')
})
