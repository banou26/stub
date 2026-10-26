// scripts/i18n-check.mjs on trees written for each case, every rule against an input that breaks it, then on the repo.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterAll, describe, expect, test } from 'vite-plus/test'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { check, fix } from '../../../scripts/i18n-check.mjs'

type Problem = { file: string, line?: number, message: string }

const EPISODES = '{count, plural, one {# episode} other {# episodes}}'
const VIEW = 'src/view.tsx'

// the code's messages, declared as stub declares a table of them
const messages = (...english: string[]) =>
  `import { defineMessages } from 'react-intl'\nexport const MESSAGES = defineMessages({\n${english.map((text, index) => `  m${index}: { id: ${JSON.stringify(text)}, defaultMessage: ${JSON.stringify(text)} },`).join('\n')}\n})\n`

const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

const tree = ({ english = [EPISODES, 'Play'], code = {}, catalogues = {}, offered = ['en'], unwrapped = {} }: {
  english?: string[]
  code?: Record<string, string>
  catalogues?: Record<string, Record<string, string>>
  offered?: string[]
  unwrapped?: Record<string, string[]>
}) => {
  const root = mkdtempSync(join(tmpdir(), 'stub-i18n-check-'))
  roots.push(root)
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  write('package.json', '{}')
  write('src/i18n/offered.json', JSON.stringify(offered))
  write('scripts/i18n-unwrapped.json', JSON.stringify(unwrapped))
  write('src/messages.ts', messages(...english))
  for (const [file, source] of Object.entries(code)) write(file, source)
  for (const [language, catalogue] of Object.entries(catalogues)) write(`src/locales/${language}.json`, JSON.stringify(catalogue))
  return root
}

const problems = (input: Parameters<typeof tree>[0]): Problem[] => check(tree(input))
const said = (input: Parameters<typeof tree>[0]) => problems(input).map(({ file, line, message }) => `${file}${line ? `:${line}` : ''} ${message}`)

const FRENCH = { Play: 'Lecture', [EPISODES]: '{count, plural, one {# épisode} other {# épisodes}}' }

test('the repo passes', () => {
  expect(check(resolve(__dirname, '../../..'))).toEqual([])
}, 60_000)

test('a tree as stub keeps it passes: an offered catalogue complete, another partial, a listed file still holding text', () => {
  expect(problems({
    catalogues: { fr: FRENCH, ru: { Play: 'Воспроизвести' } },
    offered: ['en', 'fr'],
    code: { [VIEW]: 'export const View = () => <p>Play</p>\n' },
    unwrapped: { home: [VIEW] },
  })).toEqual([])
}, 60_000)

describe('the plural forms each language needs', () => {
  test('English needs one and other, which a =1 branch stands in for', () => {
    expect(said({ english: ['{count, plural, other {# episodes}}'] })).toEqual(['src "{count, plural, other {# episodes}}" lacks the plural branch count: one'])
    expect(said({ english: ['{count, plural, =1 {one episode} other {# episodes}}'] })).toEqual([])
  })

  test('Russian needs few and many, Arabic all six', () => {
    expect(said({ catalogues: { ru: { [EPISODES]: '{count, plural, one {# серия} other {# серий}}' } } })).toEqual([
      `src/locales/ru.json "${EPISODES}" lacks the plural branch count: few`,
      `src/locales/ru.json "${EPISODES}" lacks the plural branch count: many`,
    ])
    expect(said({ catalogues: { ar: { [EPISODES]: '{count, plural, zero {a} one {b} two {c} few {d} many {e} other {f}}' } } })).toEqual([])
    expect(said({ catalogues: { ar: { [EPISODES]: '{count, plural, one {b} other {f}}' } } })).toHaveLength(4)
  })

  test('Japanese needs other alone, and French no many', () => {
    expect(said({ catalogues: { ja: { [EPISODES]: '{count, plural, other {#話}}' }, fr: FRENCH } })).toEqual([])
  })
})

describe('no em or en dash', () => {
  test('in the English', () => {
    expect(said({ english: ['Play \u2014 now'] })).toEqual(['src "Play \u2014 now" has an em or en dash: "Play \u2014 now"'])
  })

  test('in a catalogue', () => {
    expect(said({ catalogues: { fr: { Play: 'Lecture \u2013 maintenant' } } })).toEqual(['src/locales/fr.json "Play" has an em or en dash: "Lecture \u2013 maintenant"'])
  })
})

test('a catalogue not sorted by id fails', () => {
  expect(said({ catalogues: { fr: { [EPISODES]: FRENCH[EPISODES], Play: 'Lecture' } } })).toEqual(['src/locales/fr.json is not sorted by id'])
})

describe('the catalogues against the English, by formatjs verify', () => {
  test('an offered language lacking an id fails, one not offered yet may', () => {
    const lacking = said({ catalogues: { fr: { Play: 'Lecture' } }, offered: ['en', 'fr'] })
    expect(lacking).toHaveLength(1)
    expect(lacking[0]).toMatch(/^src\/locales formatjs verify --missing-keys: .*locale fr:\n\{count, plural/s)
    expect(said({ catalogues: { fr: { Play: 'Lecture' } } })).toEqual([])
  })

  test('an offered language with no catalogue fails', () => {
    expect(said({ offered: ['en', 'fr'] })).toEqual(['src/locales/fr.json fr is offered and has no catalogue'])
  })

  test('an id no code uses fails', () => {
    expect(said({ catalogues: { fr: { Old: 'Vieux', Play: 'Lecture' } } }).join()).toMatch(/--extra-keys: .*locale fr:\nOld/s)
  })

  test('a translation naming other values than its English fails, and one that does not parse', () => {
    expect(said({ english: ['Signed in to {site}.'], catalogues: { fr: { 'Signed in to {site}.': 'Connecté à {name}.' } } }).join()).toMatch(/--structural-equality --extra-keys: .*Missing variable site/s)
    expect(said({ catalogues: { fr: { [EPISODES]: '{count, plural, one {# épisode}' } } }).join()).toMatch(/--structural-equality --extra-keys: .*MISSING_OTHER_CLAUSE/s)
  })
})

describe('text outside a message, which only the unwrapped list\'s files may hold', () => {
  const VIEW_CODE = 'export const View = () => (\n  <div>\n    <p>Play</p>\n    <input placeholder="Search anime" />\n  </div>\n)\n'

  test('a file it does not list fails on each string, by line', () => {
    expect(said({ code: { [VIEW]: VIEW_CODE } })).toEqual([`${VIEW}:3 "Play" is not in a message`, `${VIEW}:4 "placeholder=\\"Search anime\\"" is not in a message`])
  })

  test('a file it lists that has no text left, or is gone, fails', () => {
    expect(said({ code: { [VIEW]: 'export const View = () => <p>{1}</p>\n' }, unwrapped: { home: [VIEW, 'src/gone.tsx'] } })).toEqual([
      `scripts/i18n-unwrapped.json lists ${VIEW}, which has no text left to wrap`,
      'scripts/i18n-unwrapped.json lists src/gone.tsx, which has no text left to wrap',
    ])
  })
})

test('--fix sorts each catalogue, drops ids no code uses beside the ids it lacks, and the listed files with no text', () => {
  const root = tree({
    english: [EPISODES, 'Play', 'Pause'],
    catalogues: { fr: { [EPISODES]: FRENCH[EPISODES], Old: 'Vieux', Play: 'Lecture' } },
    code: { [VIEW]: 'export const View = () => <p>Play</p>\n', 'src/done.tsx': 'export const Done = () => null\n' },
    unwrapped: { home: [VIEW, 'src/done.tsx'] },
  })
  expect(fix(root)).toEqual(['src/locales/fr.json: dropped, no code uses them:\n  "Old": "Vieux"\n  beside the ids it lacks:\n  "Pause"'])
  expect(readFileSync(join(root, 'src/locales/fr.json'), 'utf8')).toBe(`${JSON.stringify({ Play: 'Lecture', [EPISODES]: FRENCH[EPISODES] }, null, 2)}\n`)
  expect(JSON.parse(readFileSync(join(root, 'scripts/i18n-unwrapped.json'), 'utf8'))).toEqual({ home: [VIEW] })
  expect(existsSync(join(root, 'src/done.tsx'))).toBe(true)
}, 60_000)
