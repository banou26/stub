import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { check, fix, readTree } from '../../../scripts/i18n-check.mjs'

type Problem = { rule: number, file: string, line: number, message: string }

const IMPORT = "import { msg, t } from '../i18n'\n"
const EPISODES = '{count, plural, one {# episode} other {# episodes}}'

const tree = ({ code = '', file = 'src/x.tsx', catalogues = {}, offered = ['en'], unwrapped = {} }: {
  code?: string
  file?: string
  catalogues?: Record<string, Record<string, unknown>>
  offered?: string[]
  unwrapped?: Record<string, string[]>
}) => ({ sources: [{ file, code: IMPORT + code }], catalogues, offered, unwrapped })

const problems = (input: Parameters<typeof tree>[0]): Problem[] => check(tree(input))
const rules = (input: Parameters<typeof tree>[0]) => problems(input).map(({ rule }) => rule)

const inFunction = (body: string) => `export const View = (props: any) => {\n  ${body}\n}\n`

test('the tree passes', () => {
  expect(check(readTree(fileURLToPath(new URL('../../..', import.meta.url))))).toEqual([])
})

describe('rule 1: a literal, and values naming its placeholders', () => {
  test('a literal with its values, and a msg() value reaching t() by its type, pass', () => {
    expect(problems({ code: inFunction("return [t('Signed in to {site}.', { site: props.site }), t(props.title), t('Play', {}, 'verb')]") })).toEqual([])
    expect(problems({ code: `const TITLES = [msg('Sources'), msg('Play', 'verb')]\n${inFunction("return t(TITLES[0])")}` })).toEqual([])
  })

  test.each([
    ['a template', 't(`Signed in to ${props.site}`)'],
    ['a branch of two literals', "t(props.on ? 'On' : 'Off')"],
    ['a concatenation', "t('Signed in to ' + props.site)"],
    ['no message at all', 't()'],
  ])('t() of %s fails', (_, call) => {
    expect(rules({ code: inFunction(`return ${call}`) })).toEqual([1])
  })

  test('msg() of anything but a literal fails', () => {
    expect(rules({ code: 'const a = msg(String(1))' })).toEqual([1])
  })

  test('a context that is not a literal fails', () => {
    expect(rules({ code: inFunction('return t(\'Play\', {}, props.context)') })).toEqual([1])
    expect(rules({ code: 'const a = msg(\'Play\', String(1))' })).toEqual([1])
  })

  test.each([
    ['a value missing', "t('Signed in to {site} as {name}.', { site: props.site })"],
    ['a value too many', "t('Signed in.', { site: props.site })"],
    ['no values', "t('Signed in to {site}.')"],
    ['values not written out', "t('Signed in to {site}.', props)"],
    ['a spread', "t('Signed in to {site}.', { ...props })"],
  ])('%s fails', (_, call) => {
    expect(rules({ code: inFunction(`return ${call}`) })).toEqual([1])
  })

  test('a message that does not parse fails, at its line', () => {
    expect(problems({ code: inFunction("return t('{count, plural, one {#}')") })).toMatchObject([{ rule: 1, file: 'src/x.tsx', line: 3 }])
  })

  test('a t() not imported from src/i18n is not stub\'s', () => {
    for (const code of ["const t = (text: string) => text\nexport const a = t(String(1))\n", "import { t } from 'i18next'\nexport const a = t(String(1))\n"]) {
      expect(check({ sources: [{ file: 'src/x.ts', code }], catalogues: {}, offered: ['en'], unwrapped: {} })).toEqual([])
    }
  })
})

describe('rule 2: no t() at module scope', () => {
  test('at module scope fails, inside a function passes', () => {
    expect(rules({ code: "export const TITLE = t('Sources')\n" })).toEqual([2])
    expect(rules({ code: inFunction("return t('Sources')") })).toEqual([])
  })
})

describe('rule 3: each offered language has every key, and every catalogue only keys the code uses, sorted', () => {
  const code = inFunction("return [t('Play'), t('Sources')]")

  test('a complete, sorted catalogue passes, and one not yet offered may lack keys', () => {
    expect(problems({ code, offered: ['en', 'fr'], catalogues: { fr: { Play: 'Lire', Sources: 'Sources' }, de: { Play: 'Abspielen' } } })).toEqual([])
  })

  test('an offered language without a catalogue fails', () => {
    expect(rules({ code, offered: ['en', 'fr'] })).toEqual([3])
  })

  test('an offered language lacking a key fails', () => {
    expect(problems({ code, offered: ['en', 'fr'], catalogues: { fr: { Play: 'Lire' } } })).toMatchObject([{ rule: 3, file: 'src/locales/fr.json', message: 'lacks "Sources"' }])
  })

  test('a key no code uses fails', () => {
    expect(rules({ code, catalogues: { de: { Play: 'Abspielen', Quellen: 'Quellen' } } })).toEqual([3])
  })

  test('keys out of order fail', () => {
    expect(rules({ code, catalogues: { de: { Sources: 'Quellen', Play: 'Abspielen' } } })).toEqual([3])
  })

  test('a key named like an object\'s own property is still missing', () => {
    expect(rules({ code: inFunction("return t('constructor')"), offered: ['en', 'fr'], catalogues: { fr: {} } })).toEqual([3])
  })
})

describe('rule 4: each translation parses, names what its English does, and carries its language\'s plural branches', () => {
  const code = inFunction(`return [t('${EPISODES}', { count: props.count }), t('Signed in to {site}.', { site: props.site })]`)
  const fr = (translations: Record<string, unknown>) => ({ code, catalogues: { fr: { 'Signed in to {site}.': 'Connecté à {site}.', [EPISODES]: '{count, plural, one {# épisode} other {# épisodes}}', ...translations } } })

  test('French needs one and other, Japanese other alone, Arabic all six', () => {
    expect(problems(fr({}))).toEqual([])
    expect(problems({ code, catalogues: { ja: { [EPISODES]: '{count, plural, other {#話}}' } } })).toEqual([])
    expect(problems({ code, catalogues: { ar: { [EPISODES]: '{count, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}' } } })).toEqual([])
  })

  test('a translation that does not parse fails', () => {
    expect(rules(fr({ 'Signed in to {site}.': 'Connecté à {site.' }))).toEqual([4])
  })

  test('a translation naming another value fails', () => {
    expect(rules(fr({ 'Signed in to {site}.': 'Connecté à {service}.' }))).toEqual([4])
  })

  test('a translation turning a plural into a plain value fails', () => {
    expect(rules(fr({ [EPISODES]: '{count} épisodes' }))).toEqual([4])
  })

  test('a plural lacking a branch its language picks fails', () => {
    expect(problems({ code, catalogues: { ru: { [EPISODES]: '{count, plural, one {# серия} other {# серии}}' } } }).map(({ message }) => message))
      .toEqual([`"${EPISODES}" lacks the plural branch count: few`, `"${EPISODES}" lacks the plural branch count: many`])
    expect(rules({ code, catalogues: { ar: { [EPISODES]: '{count, plural, one {o} other {x}}' } } })).toEqual([4, 4, 4, 4])
  })

  test('the English is held to English\'s branches, an =1 standing in for one', () => {
    expect(rules({ code: inFunction("return t('{count, plural, other {# episodes}}', { count: props.count })") })).toEqual([4])
    expect(rules({ code: inFunction("return t('{count, plural, =1 {one episode} other {# episodes}}', { count: props.count })") })).toEqual([])
  })

  test('a translation that is not text fails', () => {
    expect(problems(fr({ 'Signed in to {site}.': 3 }))).toMatchObject([{ rule: 4, message: '"Signed in to {site}." is not text' }])
  })
})

describe('rule 5: no em or en dash', () => {
  const code = inFunction("return t('Sources')")

  test('in a translation, or in the English', () => {
    expect(rules({ code, catalogues: { fr: { Sources: 'Sources \u2014 toutes' } } })).toEqual([5])
    expect(rules({ code, catalogues: { fr: { Sources: '1\u20132' } } })).toEqual([5])
    expect(rules({ code: inFunction("return t('Sources \u2014 all')") })).toEqual([5])
    expect(rules({ code, catalogues: { fr: { Sources: 'Sources - toutes' } } })).toEqual([])
  })
})

describe('rule 6: no UI text outside t() but in the files listed unwrapped', () => {
  const view = (jsx: string) => inFunction(`return ${jsx}`)

  test.each([
    ['text', '<h3>Country</h3>'],
    ['an alt', '<img alt="Poster"/>'],
    ['a title from a branch', "<b title={props.on ? 'Turn off' : ''}/>"],
    ['a placeholder template', '<input placeholder={`Search ${props.site}`}/>'],
    ['an aria-label', '<button aria-label="Close"/>'],
    ['a literal child', "<p>{props.count || 'None yet'}</p>"],
  ])('%s outside t() fails, named by file and line', (_, jsx) => {
    expect(problems({ code: view(jsx) })).toMatchObject([{ rule: 6, file: 'src/x.tsx', line: 3 }])
  })

  test('text in t(), brand names, symbols and other attributes pass', () => {
    expect(problems({ code: view("<p className=\"credit\" title={t('Close')}>{t('Country')} <b>Crunchyroll</b> <b>stub</b> · {props.count}% <i>{' '}</i></p>") })).toEqual([])
  })

  test('a file listed unwrapped is not read for it', () => {
    expect(problems({ code: view('<h3>Country</h3>'), unwrapped: { settings: ['src/x.tsx'] } })).toEqual([])
  })

  test('a file listed with nothing left to wrap, or no longer there, fails', () => {
    expect(problems({ code: view("<h3>{t('Country')}</h3>"), unwrapped: { settings: ['src/x.tsx'] } })).toMatchObject([{ rule: 6, file: 'scripts/i18n-unwrapped.json' }])
    expect(rules({ code: view("<h3>{t('Country')}</h3>"), unwrapped: { settings: ['src/gone.tsx'] } })).toEqual([6])
  })

  test('text in a .ts file is not read for it', () => {
    expect(problems({ file: 'src/x.ts', code: "export const LABELS = ['Country']\n" })).toEqual([])
  })
})

describe('--fix', () => {
  const code = inFunction("return [t('Play'), t('{count, plural, one {# source} other {# sources}}', { count: props.count })]")

  test('sorts each catalogue, drops the keys no code uses, and names each beside the keys the catalogue lacks', () => {
    const { catalogues, notes } = fix(tree({ code, catalogues: { fr: { Play: 'Lire', '{count, plural, one {# sources} other {# sources}}': '{count, plural, one {# source} other {# sources}}' } } }))
    expect(catalogues).toEqual({ fr: { Play: 'Lire' } })
    expect(notes).toEqual([[
      'src/locales/fr.json: dropped, no code uses them:',
      '  "{count, plural, one {# sources} other {# sources}}": "{count, plural, one {# source} other {# sources}}"',
      '  beside the keys it lacks:',
      '  "{count, plural, one {# source} other {# sources}}"',
    ].join('\n')])
    expect(Object.keys(fix(tree({ code, catalogues: { de: { 'Play': 'Abspielen', '{count, plural, one {# source} other {# sources}}': 'x' } } })).catalogues.de))
      .toEqual(['Play', '{count, plural, one {# source} other {# sources}}'])
    expect(Object.keys(fix(tree({ code, catalogues: { de: { '{count, plural, one {# source} other {# sources}}': 'x', 'Play': 'Abspielen' } } })).catalogues.de))
      .toEqual(['Play', '{count, plural, one {# source} other {# sources}}'])
  })

  test('drops the listed files left with nothing to wrap, and keeps the rest', () => {
    const input = { sources: [{ file: 'src/a.tsx', code: inFunction('return <h3>Country</h3>') }, { file: 'src/b.tsx', code: IMPORT + inFunction("return <h3>{t('Country')}</h3>") }], catalogues: {}, offered: ['en'], unwrapped: { settings: ['src/a.tsx', 'src/b.tsx', 'src/gone.tsx'] } }
    expect(fix(input).unwrapped).toEqual({ settings: ['src/a.tsx'] })
  })
})
