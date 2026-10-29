import type { Said } from '../../src/i18n'

import { wordsOf } from '../../src/i18n'

type Matcher = { asymmetricMatch: (actual: unknown) => boolean, toString: () => string }

/**
 * Matches words for the viewer (src/i18n/said.ts) that read `expected` in English, the page's own: the text itself, or
 * a matcher such as `expect.stringContaining`. What a test of a message the worker writes pins its English with.
 */
export const inEnglish = (expected: string | Matcher) => ({
  asymmetricMatch: (said: unknown) => {
    if (typeof said !== 'string' && (typeof said !== 'object' || said === null)) return false
    const text = wordsOf(said as Said)
    return typeof expected === 'string' ? text === expected : expected.asymmetricMatch(text)
  },
  toString: () => 'InEnglish',
  toAsymmetricMatcher: () => `InEnglish<${typeof expected === 'string' ? JSON.stringify(expected) : expected.toString()}>`,
})
