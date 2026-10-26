#!/usr/bin/env node
// `npm run i18n:check`: stub's messages (src/i18n) through FormatJS's own tools, plus what they leave unchecked. It
// lints src with MESSAGE_RULES, as vite.config.ts does, since no gate runs the linter, and runs `formatjs verify` on
// each catalogue against the English `formatjs extract` reads from the code. It adds the plural forms each language
// needs, `#` and `{count, number}` only where the English writes them, no dash, each catalogue sorted by id, and text
// outside a message, which only the files of scripts/i18n-unwrapped.json may hold. `-- --fix` sorts each catalogue,
// drops its keys no code uses, printed beside the keys it lacks so a changed English string's old translations are
// edited rather than written again, and drops listed files left with nothing to wrap. `-- --unwrapped` names every
// string the listed files hold, by file and line.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, TYPE } from '@formatjs/icu-messageformat-parser'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.bin')
const DASH = /[\u2013\u2014]/
const UNWRAPPED_FILE = 'scripts/i18n-unwrapped.json'
const catalogueFile = language => `src/locales/${language}.json`
const shown = id => JSON.stringify(id)

const inTemporary = run => {
  const directory = mkdtempSync(join(tmpdir(), 'stub-i18n-'))
  try { return run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

/**
 * The English of every message in the code under `root`, by id. `--throws` stops on a message extract cannot read (a
 * defaultMessage that is no literal) rather than leave it out, where `--fix` would drop its translations as unused.
 */
export const extract = root => JSON.parse(execFileSync(join(BIN, 'formatjs'), [
  'extract', 'src/**/*.{ts,tsx}', '--ignore', 'src/generated/**', '--ignore', '**/*.d.ts',
  '--id-interpolation-pattern', '[content]', '--format', 'simple', '--throws',
], { cwd: root, encoding: 'utf8' }))

// `formatjs verify` of `languages`' catalogues against `english`, one problem holding its report when it fails
const verify = (root, english, languages, flags) => languages.length === 0 ? [] : inTemporary(directory => {
  writeFileSync(join(directory, 'en.json'), JSON.stringify(english))
  const run = spawnSync(join(BIN, 'formatjs'), ['verify', '--source-locale', 'en', ...flags, join(directory, 'en.json'), ...languages.map(catalogueFile)], { cwd: root, encoding: 'utf8' })
  return run.status === 0 ? [] : [{ file: 'src/locales', message: `formatjs verify ${flags.join(' ')}: ${`${run.stdout}${run.stderr}`.replace(/-{5,}\n/g, '').trim()}` }]
})

/**
 * The eslint-plugin-formatjs rules each message is held to. vite.config.ts lints with them, so `vp lint --fix` writes
 * each id: its English, which react-intl looks it up by.
 */
export const MESSAGE_RULES = {
  'formatjs/enforce-id': ['error', { idInterpolationPattern: '[content]' }],
  'formatjs/enforce-default-message': ['error', 'literal'],
  'formatjs/enforce-placeholders': 'error',
  'formatjs/no-invalid-icu': 'error',
  'formatjs/no-multiple-whitespaces': 'error',
}

/** eslint-plugin-formatjs's rule for text in JSX, as stub runs it on src: JSX text and the attributes a viewer reads. */
export const JSX_TEXT = ['error', { props: { include: [['*', '{label,placeholder,title}']] } }]
const JSX_RULE = 'formatjs(no-literal-string-in-jsx)'

// oxlint's diagnostics on `root`'s src under MESSAGE_RULES and JSX_TEXT
const lint = root => inTemporary(directory => {
  const config = join(directory, 'oxlintrc.json')
  writeFileSync(config, JSON.stringify({
    plugins: [], categories: { correctness: 'off' },
    jsPlugins: [fileURLToPath(import.meta.resolve('eslint-plugin-formatjs'))],
    rules: { ...MESSAGE_RULES, 'formatjs/no-literal-string-in-jsx': JSX_TEXT },
  }))
  const run = spawnSync(join(BIN, 'vp'), ['lint', '-c', config, '--format', 'json', 'src'], { cwd: root, encoding: 'utf8' })
  if (!run.stdout.trim()) throw new Error(`vp lint answered nothing: ${run.stderr}`)
  return JSON.parse(run.stdout).diagnostics
})

const textIn = (root, diagnostics) => {
  const found = new Map()
  for (const { code, filename, labels: [{ span }] } of diagnostics) {
    if (code !== JSX_RULE) continue
    const text = readFileSync(join(root, filename)).subarray(span.offset, span.offset + span.length).toString('utf8').replace(/\s+/g, ' ').trim()
    found.set(filename, [...found.get(filename) ?? [], { line: span.line, text }])
  }
  return found
}

/** The text under `root`'s src outside a message, by file, each `{ line, text }`. */
export const textOutsideMessages = root => textIn(root, lint(root))

const pluralRules = new Map()
const rulesOf = (language, type) => {
  const key = `${language}:${type}`
  if (!pluralRules.has(key)) pluralRules.set(key, new Intl.PluralRules(language, { type }))
  return pluralRules.get(key)
}

/**
 * The branches each plural of `elements` lacks for `language`, as `name: branch`: `other`, and each branch it picks
 * for a whole number from 0 to 1000 that no `=N` branch takes.
 */
const missingForms = (elements, language) => elements.flatMap(element => {
  const nested = [
    ...Object.values(element.options ?? {}).flatMap(option => missingForms(option.value, language)),
    ...element.children ? missingForms(element.children, language) : [],
  ]
  if (element.type !== TYPE.plural) return nested
  const rules = rulesOf(language, element.pluralType === 'ordinal' ? 'ordinal' : 'cardinal')
  const picked = new Set(['other'])
  for (let n = 0; n <= 1000; n++) if (!Object.hasOwn(element.options, `=${n}`)) picked.add(rules.select(n - (element.offset ?? 0)))
  return [...picked].sort().filter(form => !Object.hasOwn(element.options, form)).map(form => `${element.value}: ${form}`).concat(nested)
})

// the forms `elements` write a count in that group it (`1.100` in German), `#` and `{count, number}`, where `{count}`
// writes it as given; formatjs verify takes the three alike
const grouping = elements => elements.flatMap(element => [
  ...element.type === TYPE.pound ? ['#'] : element.type === TYPE.number ? [`{${element.value}, number}`] : [],
  ...Object.values(element.options ?? {}).flatMap(option => grouping(option.value)),
  ...grouping(element.children ?? []),
])

const parsed = text => {
  try { return parse(text) } catch { return undefined }
}

// a message's own problems in `language`, against its `english` in a catalogue; one that does not parse is left to
// no-invalid-icu and `formatjs verify`
const messageProblems = (file, id, text, language, english) => {
  const problems = []
  if (DASH.test(text)) problems.push({ file, message: `${shown(id)} has an em or en dash: ${shown(text)}` })
  const elements = parsed(text)
  if (!elements) return problems
  for (const form of missingForms(elements, language)) problems.push({ file, message: `${shown(id)} lacks the plural branch ${form}` })
  const source = english === undefined ? undefined : parsed(english)
  if (source) {
    const written = new Set(grouping(source))
    for (const form of new Set(grouping(elements))) {
      if (!written.has(form)) problems.push({ file, message: `${shown(id)} writes ${form}, which groups a count, where its English does not` })
    }
  }
  return problems
}

/** What check() and fix() read under `root`: the languages offered, each catalogue by tag, the unwrapped list by area. */
export const readTree = root => {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
  const locales = existsSync(join(root, 'src/locales')) ? readdirSync(join(root, 'src/locales')).filter(name => name.endsWith('.json')) : []
  return {
    offered: json('src/i18n/offered.json'),
    catalogues: Object.fromEntries(locales.map(name => [name.slice(0, -'.json'.length), json(`src/locales/${name}`)])),
    unwrapped: json(UNWRAPPED_FILE),
  }
}

const listedFiles = unwrapped => new Set(Object.values(unwrapped).flat())

/** Every problem under `root`, each `{ file, line?, message }`. */
export const check = root => {
  const { offered, catalogues, unwrapped } = readTree(root)
  const english = extract(root)
  const problems = Object.entries(english).flatMap(([id, text]) => messageProblems('src', id, text, 'en'))
  for (const language of offered) {
    if (language !== 'en' && !catalogues[language]) problems.push({ file: catalogueFile(language), message: `${language} is offered and has no catalogue` })
  }
  for (const [language, catalogue] of Object.entries(catalogues)) {
    const ids = Object.keys(catalogue)
    if (ids.join('\u0000') !== [...ids].sort().join('\u0000')) problems.push({ file: catalogueFile(language), message: 'is not sorted by id' })
    for (const [id, text] of Object.entries(catalogue)) problems.push(...messageProblems(catalogueFile(language), id, text, language, english[id]))
  }
  problems.push(...verify(root, english, Object.keys(catalogues), ['--structural-equality', '--extra-keys']))
  problems.push(...verify(root, english, offered.filter(language => catalogues[language]), ['--missing-keys']))

  const diagnostics = lint(root)
  for (const { code, message, filename, labels: [{ span }] } of diagnostics) {
    if (code !== JSX_RULE) problems.push({ file: filename, line: span.line, message: `${code}: ${message}` })
  }
  const listed = listedFiles(unwrapped)
  const text = textIn(root, diagnostics)
  for (const [file, found] of text) {
    if (!listed.has(file)) for (const { line, text } of found) problems.push({ file, line, message: `${shown(text)} is not in a message` })
  }
  for (const file of listed) if (!text.has(file)) problems.push({ file: UNWRAPPED_FILE, message: `lists ${file}, which has no text left to wrap` })
  return problems
}

/**
 * What `--fix` writes under `root`: each catalogue sorted and without the ids no code uses, and the unwrapped list
 * without the files left with nothing to wrap. Returns a note per catalogue naming each id dropped, with its
 * translation, beside the ids that catalogue lacks.
 */
export const fix = root => {
  const { catalogues, unwrapped } = readTree(root)
  const english = extract(root)
  const notes = []
  for (const [language, catalogue] of Object.entries(catalogues)) {
    const dropped = Object.keys(catalogue).filter(id => !Object.hasOwn(english, id))
    const lacking = Object.keys(english).filter(id => !Object.hasOwn(catalogue, id))
    if (dropped.length) {
      notes.push([
        `${catalogueFile(language)}: dropped, no code uses them:`,
        ...dropped.map(id => `  ${shown(id)}: ${shown(catalogue[id])}`),
        ...lacking.length ? ['  beside the ids it lacks:', ...lacking.map(id => `  ${shown(id)}`)] : [],
      ].join('\n'))
    }
    const kept = Object.keys(catalogue).filter(id => Object.hasOwn(english, id)).sort()
    writeFileSync(join(root, catalogueFile(language)), `${JSON.stringify(Object.fromEntries(kept.map(id => [id, catalogue[id]])), null, 2)}\n`)
  }
  const text = textOutsideMessages(root)
  const list = Object.fromEntries(Object.entries(unwrapped).map(([area, files]) => [area, files.filter(file => text.has(file))]))
  writeFileSync(join(root, UNWRAPPED_FILE), `${JSON.stringify(list, null, 2)}\n`)
  return notes
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--fix')) for (const note of fix(root)) console.log(note)
  if (process.argv.includes('--unwrapped')) {
    const text = textOutsideMessages(root)
    for (const file of listedFiles(readTree(root).unwrapped)) for (const { line, text: found } of text.get(file) ?? []) console.log(`${file}:${line} ${shown(found)}`)
  }
  const problems = check(root)
  for (const { file, line, message } of problems) console.error(`${file}${line ? `:${line}` : ''} ${message}`)
  console.log(problems.length ? `i18n check: ${problems.length} problems` : 'i18n check: passed')
  process.exitCode = problems.length ? 1 : 0
}
