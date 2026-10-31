import { expect, test } from 'vite-plus/test'

import { isRightToLeft } from '../../../src/i18n/languages'
import { catalogues } from '../../languages'

const rightToLeft = Object.entries(catalogues()).filter(([language]) => isRightToLeft(language))

test('the control: both languages are read', () => {
  expect(rightToLeft.map(([language]) => language).sort()).toEqual(['ar', 'he'])
})

// a value is isolated from its sentence (src/i18n), which splits it from a Latin letter touching it: `{rate}x` shows as x1.5
test.each(rightToLeft)('%s: no value touches a Latin letter', (_, catalogue) => {
  expect(Object.entries(catalogue).filter(([, text]) => /[A-Za-z]\{\w+\}|\{\w+\}[A-Za-z]/.test(text))).toEqual([])
})

// a fact's value takes its direction from its first letter, so a Latin first word would turn the whole line left to right
test.each(rightToLeft)('%s: a format leads with the language\'s own letters', (_, catalogue) => {
  expect(catalogue['TV Short']).toMatch(/^[\u0590-\u06FF]/)
})

test('the search page\'s heading is a noun, as in every other language', () => {
  expect(Object.fromEntries(rightToLeft.map(([language, catalogue]) => [language, catalogue.Browsing]))).toEqual({ ar: 'تصفح', he: 'עיון' })
})

test('one episode takes a singular participle in Hebrew', () => {
  const { he } = Object.fromEntries(rightToLeft)
  expect(he!['MyAnimeList counts {count, plural, one {{count} episode} other {{count} episodes}} for this anime']).toContain('one {רשום פרק אחד}')
})
