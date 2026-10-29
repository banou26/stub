import type { Plugin } from 'vite-plus'

import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extract } from '../scripts/i18n-check.mjs'

const ROOT = join(import.meta.dirname, '..')
const LOCALES = join(ROOT, 'src', 'locales')
const VIRTUAL = '\0stub-pseudo-language'

/** src/i18n/languages.ts's setting, which a spec cannot import: Node loads no JSON import without an attribute. */
export const LANGUAGE_KEY = 'stub.language'

/** FormatJS's pseudo-language: each message accented, its vowels doubled and bracketed, from the code's own English. */
export const PSEUDO = 'en-XA'

/** The catalogues in src/locales, by tag. */
export const catalogues = (): Record<string, Record<string, string>> => Object.fromEntries(readdirSync(LOCALES)
  .filter(name => name.endsWith('.json'))
  .map(name => [name.slice(0, -'.json'.length), JSON.parse(readFileSync(join(LOCALES, name), 'utf8'))]))

/** The code's English by message id, as `formatjs extract` reads it. */
export const english = (): Record<string, string> => extract(ROOT)

const pseudoCatalogue = () => {
  const directory = mkdtempSync(join(tmpdir(), 'stub-pseudo-'))
  try {
    writeFileSync(join(directory, 'en.json'), JSON.stringify(english()))
    return execFileSync(join(ROOT, 'node_modules', '.bin', 'formatjs'), ['compile', join(directory, 'en.json'), '--ast', '--pseudo-locale', PSEUDO, '--format', 'simple'], { encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * A spec build's plugin offering, before stub does, every catalogue in src/locales and the pseudo-language, so a test
 * shows one by writing its tag to the language setting (LANGUAGE_KEY). A browser in English still gets English.
 */
export const offerEveryLanguage = (): Plugin => {
  const offered = join(ROOT, 'src', 'i18n', 'offered.json')
  const core = join(ROOT, 'src', 'i18n', 'index.ts')
  const glob = "import.meta.glob('../locales/*.json', { import: 'default' })"
  return {
    name: 'spec-offer-every-language',
    enforce: 'pre',
    resolveId: source => source === VIRTUAL ? VIRTUAL : undefined,
    load: id => id === offered ? JSON.stringify(['en', ...Object.keys(catalogues()), PSEUDO])
      : id === VIRTUAL ? `export default ${pseudoCatalogue()}`
      : undefined,
    transform: (code, id) => {
      if (id !== core) return undefined
      if (!code.includes(glob)) throw new Error(`${core} no longer loads its catalogues with ${glob}`)
      return code.replace(glob, `{ ...${glob}, '../locales/${PSEUDO}.json': () => import('${VIRTUAL}').then(module => module.default) }`)
    },
  }
}

// a message as a pattern its rendered text matches, each value and each `#` any text
const patternOf = (elements: MessageFormatElement[]): string => elements.map(element =>
  element.type === TYPE.literal ? element.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  : element.type === TYPE.plural || element.type === TYPE.select ? `(?:${Object.values(element.options).map(option => patternOf(option.value)).join('|')})`
  : element.type === TYPE.tag ? patternOf(element.children)
  : '.+').join('')

/**
 * What `language` leaves in English: each text the page shows that reads as a message of the code whose `language`
 * text differs from its English. A message with no word of its own, such as `{label}: {names}` or
 * `{control}, {member}`, is no English and is skipped, since it reads as any text of its shape. `english` is
 * english()'s, `translated` the language's catalogue (the pseudo-language's differs everywhere).
 */
export const englishIn = (shown: readonly string[], english: Record<string, string>, translated?: Record<string, string>) => {
  const patterns = Object.entries(english)
    .filter(([id, text]) => !translated || translated[id] !== text)
    .map(([id, text]) => [id, patternOf(parse(text))] as const)
    // a value reads as `.+`, so a letter in the pattern is one of the message's own
    .filter(([, pattern]) => /\p{L}/u.test(pattern))
    .map(([id, pattern]) => [id, new RegExp(`^${pattern}$`)] as const)
  return shown.flatMap(text => patterns.filter(([, pattern]) => pattern.test(text)).map(([id]) => `${JSON.stringify(text)} (${id})`))
}
