#!/usr/bin/env node
// `npm run i18n:check`: stub's text in code and its catalogues kept in step (src/i18n). `-- --fix` sorts each
// catalogue, drops the keys no code uses any more and the unwrapped list's files with nothing left to wrap, and
// prints each dropped key with its translation beside the keys that catalogue lacks, so a changed English string's
// old translations are edited rather than written again. tests/unit/i18n/check.test.ts runs it on the tree.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { parse as parseMessage, TYPE } from '@formatjs/icu-messageformat-parser'

// @babel/traverse is CommonJS, so node hands its module object as the default
const traverse = traverseModule.default ?? traverseModule

const I18N_MODULE = /(^|\/)i18n(\/index(\.ts)?)?$/
const DASH = /[\u2013\u2014]/
const LETTER = /\p{L}/u
const TEXT_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt'])

/** Text rule 6 lets through outside t(): brand names, never translated. */
export const BRANDS = new Set([
  'AniDB', 'AniList', 'Apple TV', 'Crunchyroll', 'FKN', 'HIDIVE', 'JustWatch', 'Kitsu', 'MyAnimeList', 'Netflix',
  'Nyaa', 'Prime Video', 'Stub', 'stub', 'TMDB', 'trace.moe', 'YouTube',
])

const KIND = { [TYPE.argument]: 'argument', [TYPE.number]: 'number', [TYPE.date]: 'date', [TYPE.time]: 'time', [TYPE.select]: 'select', [TYPE.plural]: 'plural', [TYPE.tag]: 'tag' }

/**
 * Each value a message names, by name, with its kind (`select`, `plural`, `selectordinal`, `tag`, ...).
 * @returns {Map<string, string>}
 */
const variables = (elements, found = new Map()) => {
  for (const element of elements) {
    const kind = element.type === TYPE.plural && element.pluralType === 'ordinal' ? 'selectordinal' : KIND[element.type]
    if (kind) found.set(element.value, found.has(element.value) && found.get(element.value) !== kind ? 'conflicting' : kind)
    for (const option of Object.values(element.options ?? {})) variables(option.value, found)
    if (element.children) variables(element.children, found)
  }
  return found
}

const sameVariables = (a, b) => a.size === b.size && [...a].every(([name, kind]) => b.get(name) === kind)

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

const messageOf = text => {
  try { return { elements: parseMessage(text, { requiresOtherClause: true }) } } catch (error) { return { error: error.message } }
}

const keyOf = (text, context) => context === undefined ? text : `${context}\u0004${text}`
const shown = key => JSON.stringify(key.replace('\u0004', ' | '))

// a string literal or template with a letter in it, alone or as a branch of `? :`, `&&`, `||` or `??`
const literalText = node => {
  if (!node) return []
  if (node.type === 'StringLiteral') return LETTER.test(node.value) ? [node.value] : []
  if (node.type === 'TemplateLiteral') {
    const text = node.quasis.map(quasi => quasi.value.cooked ?? '').join('{}')
    return LETTER.test(text) ? [text] : []
  }
  if (node.type === 'ConditionalExpression') return [...literalText(node.consequent), ...literalText(node.alternate)]
  if (node.type === 'LogicalExpression') return [...literalText(node.left), ...literalText(node.right)]
  return []
}

const hasLiteral = (path) => {
  let found = false
  path.traverse({
    CallExpression: inner => { if (importedName(inner) === 'msg') inner.skip() },
    'StringLiteral|TemplateLiteral': () => { found = true },
  })
  return found || path.isStringLiteral() || path.isTemplateLiteral()
}

/** `t` or `msg` when `path` calls the one imported from src/i18n, else undefined. */
const importedName = path => {
  const callee = path.node.callee
  if (callee.type !== 'Identifier') return undefined
  const binding = path.scope.getBinding(callee.name)
  if (binding?.kind !== 'module' || !binding.path.isImportSpecifier()) return undefined
  if (!I18N_MODULE.test(binding.path.parent.source.value)) return undefined
  const imported = binding.path.node.imported
  const name = imported.type === 'Identifier' ? imported.name : imported.value
  return name === 't' || name === 'msg' ? name : undefined
}

/**
 * Reads one source file: the messages its t() and msg() calls name, the problems of rules 1 and 2, and the UI text
 * rule 6 finds outside t().
 */
export const readSource = (file, code) => {
  const messages = []
  const problems = []
  const text = []
  let ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
  } catch (error) {
    return { messages, problems: [{ rule: 1, file, line: error.loc?.line ?? 0, message: `does not parse: ${error.message}` }], text }
  }
  const problem = (rule, node, message) => problems.push({ rule, file, line: node.loc.start.line, message })
  const contextOf = (node, name) => {
    if (node === undefined) return { context: undefined }
    if (node.type === 'StringLiteral') return { context: node.value }
    problem(1, node, `${name}()'s context must be a string literal`)
    return undefined
  }

  traverse(ast, {
    CallExpression(path) {
      const name = importedName(path)
      if (!name) return
      const [first, values, context] = name === 't' ? path.node.arguments : [path.node.arguments[0], undefined, path.node.arguments[1]]
      if (name === 't' && !path.getFunctionParent()) problem(2, path.node, 't() runs at module scope, before the catalogue has loaded')
      if (first?.type !== 'StringLiteral') {
        if (name === 'msg' || !first || hasLiteral(path.get('arguments.0'))) problem(1, path.node, `${name}() takes a string literal${name === 't' ? ' or a msg() value' : ''}`)
        return
      }
      const kept = contextOf(context, name)
      if (!kept) return
      const parsed = messageOf(first.value)
      if (parsed.error) {
        problem(1, first, `${shown(first.value)} is not a message: ${parsed.error}`)
        return
      }
      messages.push({ key: keyOf(first.value, kept.context), file, line: first.loc.start.line, elements: parsed.elements })
      if (name !== 't') return
      const wanted = [...variables(parsed.elements).keys()].sort()
      if (values === undefined) {
        if (wanted.length) problem(1, first, `${shown(first.value)} needs the values ${wanted.join(', ')}`)
        return
      }
      const named = values.type === 'ObjectExpression' && values.properties.every(property => property.type === 'ObjectProperty' && !property.computed)
        ? values.properties.map(property => property.key.type === 'Identifier' ? property.key.name : String(property.key.value)).sort()
        : undefined
      if (!named) problem(1, values, `${shown(first.value)} takes its values as an object literal`)
      else if (named.join() !== wanted.join()) problem(1, values, `${shown(first.value)} names ${wanted.join(', ') || 'no value'}, the call passes ${named.join(', ') || 'none'}`)
    },
    JSXText(path) {
      const value = path.node.value.replace(/\s+/g, ' ').trim()
      if (LETTER.test(value) && !BRANDS.has(value)) text.push({ file, line: path.node.loc.start.line, text: value })
    },
    JSXAttribute(path) {
      const { name, value } = path.node
      if (name.type !== 'JSXIdentifier' || !TEXT_ATTRIBUTES.has(name.name) || !value) return
      const found = value.type === 'JSXExpressionContainer' ? literalText(value.expression) : literalText(value)
      for (const each of found) if (!BRANDS.has(each.trim())) text.push({ file, line: value.loc.start.line, text: each })
    },
    JSXExpressionContainer(path) {
      if (!path.parentPath.isJSXElement() && !path.parentPath.isJSXFragment()) return
      for (const each of literalText(path.node.expression)) if (!BRANDS.has(each.trim())) text.push({ file, line: path.node.loc.start.line, text: each })
    },
  })
  return { messages, problems, text }
}

/**
 * Every problem of the six rules, each `{ rule, file, line, message }`.
 *
 * `sources` are the code's files, `{ file, code }`; `catalogues` each language's catalogue by tag, its text by key, in
 * its file's order; `offered` the languages offered (src/i18n/offered.json); `unwrapped` the files of each area whose
 * text is not in t() yet (scripts/i18n-unwrapped.json).
 */
export const check = ({ sources, catalogues, offered, unwrapped }) => {
  const read = sources.map(({ file, code }) => readSource(file, code))
  const problems = read.flatMap(each => each.problems)
  const messages = new Map()
  for (const message of read.flatMap(each => each.messages)) if (!messages.has(message.key)) messages.set(message.key, message)

  for (const message of messages.values()) {
    for (const form of missingForms(message.elements, 'en')) problems.push({ rule: 4, file: message.file, line: message.line, message: `${shown(message.key)} lacks the plural branch ${form}` })
    if (DASH.test(message.key)) problems.push({ rule: 5, file: message.file, line: message.line, message: `${shown(message.key)} has an em or en dash` })
  }

  for (const language of offered) {
    if (language !== 'en' && !catalogues[language]) problems.push({ rule: 3, file: catalogueFile(language), line: 0, message: `${language} is offered and has no catalogue` })
  }
  for (const [language, catalogue] of Object.entries(catalogues)) {
    const file = catalogueFile(language)
    const add = (rule, message) => problems.push({ rule, file, line: 0, message })
    const keys = Object.keys(catalogue)
    if (keys.join('\u0000') !== [...keys].sort().join('\u0000')) add(3, 'is not sorted by key')
    if (offered.includes(language)) for (const key of messages.keys()) if (!Object.hasOwn(catalogue, key)) add(3, `lacks ${shown(key)}`)
    for (const [key, translation] of Object.entries(catalogue)) {
      const source = messages.get(key)
      if (!source) { add(3, `has ${shown(key)}, which no code uses`); continue }
      if (typeof translation !== 'string') { add(4, `${shown(key)} is not text`); continue }
      if (DASH.test(translation)) add(5, `${shown(key)} has an em or en dash: ${JSON.stringify(translation)}`)
      const parsed = messageOf(translation)
      if (parsed.error) { add(4, `${shown(key)} does not parse: ${parsed.error}`); continue }
      if (!sameVariables(variables(parsed.elements), variables(source.elements))) add(4, `${shown(key)} does not name the values, plurals, selects and tags its English does`)
      for (const form of missingForms(parsed.elements, language)) add(4, `${shown(key)} lacks the plural branch ${form}`)
    }
  }

  const listed = new Set(Object.values(unwrapped).flat())
  const texts = new Map(sources.map(({ file }) => [file, []]))
  for (const each of read.flatMap(source => source.text)) texts.get(each.file).push(each)
  for (const [file, found] of texts) {
    if (listed.has(file)) continue
    for (const each of found) problems.push({ rule: 6, file, line: each.line, message: `${JSON.stringify(each.text)} is not in t()` })
  }
  for (const file of listed) {
    if (!texts.get(file)?.length) problems.push({ rule: 6, file: UNWRAPPED_FILE, line: 0, message: `lists ${file}, which has no text left to wrap` })
  }
  return problems
}

const UNWRAPPED_FILE = 'scripts/i18n-unwrapped.json'
const catalogueFile = language => `src/locales/${language}.json`

/**
 * What `--fix` writes: each catalogue sorted and without the keys no code uses, the unwrapped list without the files
 * left with nothing to wrap, and a note per catalogue naming each key dropped, with its translation, beside the keys
 * that catalogue lacks.
 */
export const fix = ({ sources, catalogues, unwrapped }) => {
  const read = sources.map(({ file, code }) => readSource(file, code))
  const keys = new Set(read.flatMap(each => each.messages.map(message => message.key)))
  const withText = new Set(read.flatMap(each => each.text.map(found => found.file)))
  const notes = []
  const fixed = Object.fromEntries(Object.entries(catalogues).map(([language, catalogue]) => {
    const dropped = Object.keys(catalogue).filter(key => !keys.has(key))
    const lacking = [...keys].filter(key => !Object.hasOwn(catalogue, key))
    if (dropped.length) {
      notes.push([
        `${catalogueFile(language)}: dropped, no code uses them:`,
        ...dropped.map(key => `  ${shown(key)}: ${JSON.stringify(catalogue[key])}`),
        ...lacking.length ? ['  beside the keys it lacks:', ...lacking.map(key => `  ${shown(key)}`)] : [],
      ].join('\n'))
    }
    const kept = Object.keys(catalogue).filter(key => keys.has(key)).sort()
    return [language, Object.fromEntries(kept.map(key => [key, catalogue[key]]))]
  }))
  const list = Object.fromEntries(Object.entries(unwrapped).map(([area, files]) => [area, files.filter(file => withText.has(file))]))
  return { catalogues: fixed, unwrapped: list, notes }
}

const sourceFiles = (root, directory = 'src') => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
  const path = `${directory}/${entry.name}`
  if (entry.isDirectory()) return path === 'src/generated' ? [] : sourceFiles(root, path)
  return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
})

/** The tree under `root`, as check() and fix() read it. */
export const readTree = root => {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
  let locales = []
  try { locales = readdirSync(join(root, 'src/locales')).filter(name => name.endsWith('.json')) } catch {}
  return {
    sources: sourceFiles(root).map(file => ({ file, code: readFileSync(join(root, file), 'utf8') })),
    catalogues: Object.fromEntries(locales.map(name => [name.slice(0, -'.json'.length), json(`src/locales/${name}`)])),
    offered: json('src/i18n/offered.json'),
    unwrapped: json(UNWRAPPED_FILE),
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--fix')) {
    const { catalogues, unwrapped, notes } = fix(readTree(root))
    for (const [language, catalogue] of Object.entries(catalogues)) writeFileSync(join(root, catalogueFile(language)), `${JSON.stringify(catalogue, null, 2)}\n`)
    writeFileSync(join(root, UNWRAPPED_FILE), `${JSON.stringify(unwrapped, null, 2)}\n`)
    for (const note of notes) console.log(note)
  }
  const problems = check(readTree(root))
  for (const { rule, file, line, message } of problems) console.error(`${file}${line ? `:${line}` : ''} rule ${rule}: ${message}`)
  console.log(problems.length ? `i18n check: ${problems.length} problems` : 'i18n check: passed')
  process.exitCode = problems.length ? 1 : 0
}
