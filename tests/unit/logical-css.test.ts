import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test } from 'vite-plus/test'

// a page in Arabic or Hebrew mirrors only what its CSS names by start and end, so one `margin-left` shows as a bug only to a
// viewer of those languages, long after it merged.
const ROOT = join(import.meta.dirname, '..', '..')
const SOURCES = join(ROOT, 'src')

// these stay left to right on a right to left page, so left is left
const LEFT_TO_RIGHT = [
  'src/components/player/index.tsx', 'src/components/volume-control.tsx',
  'src/router/debug/episodes.tsx', 'src/router/debug/graph.tsx', 'src/router/debug/index.tsx', 'src/router/debug/inspector.tsx',
  'src/router/debug/value.tsx', 'src/router/privacy/index.tsx',
]
// physical on purpose: a pointer's place in the window, which the first mirrors itself, a watched bar, which runs as the
// player's seek bar does, and a shimmer, which reads the same from either side
const TRULY_PHYSICAL: Record<string, string> = {
  'src/components/party-cursor.tsx': 'left: 0',
  'src/router/home/media-details.tsx': 'left: 0',
  'src/components/placeholder.tsx': 'linear-gradient(90deg',
}

const PHYSICAL = /(?<![\w-])(?:(?:left|right|(?:margin|padding|border)-(?:left|right)(?:-\w+)?)\s*:\s*[^;}]+|text-align:\s*(?:left|right)\b|(?:linear-gradient\(\s*(?:90deg|270deg|to (?:left|right)\b))|box-shadow:\s*inset\s+-?(?:0?\.\d*[1-9]|[1-9])[\d.]*\w*)/g
const PHYSICAL_STYLE = /\b(?:margin|padding|border)(?:Left|Right)\w*\s*:|\btextAlign:\s*['"](?:left|right)|\bstyle=\{\{[^}]*\b(?:left|right):\s*['"`\d]/g

const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? (entry.name === 'generated' ? [] : sources(join(directory, entry.name)))
  : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)]
  : [])

/**
 * Each physical inline declaration of `code`'s css templates and style objects, but a centred element's `left: 50%`,
 * whose translate is physical too, and a positioned popover's `left: x`, a place in the window.
 */
const physicalIn = (code: string) => [
  ...[...code.matchAll(/(?:css|keyframes)`[\s\S]*?`/g)].flatMap(([template]) => template.replace(/\/\*[\s\S]*?\*\//g, '').match(PHYSICAL) ?? []),
  ...code.match(PHYSICAL_STYLE) ?? [],
].filter(declaration => !/^left:\s*50%/.test(declaration))

test('the page names its sides by start and end, but what stays left to right', () => {
  const found = sources(SOURCES).flatMap(file => {
    const path = relative(ROOT, file)
    if (LEFT_TO_RIGHT.includes(path)) return []
    return physicalIn(readFileSync(file, 'utf8'))
      .filter(declaration => declaration !== TRULY_PHYSICAL[path])
      .map(declaration => `${path}: ${declaration}`)
  })
  expect(found).toEqual([])
})

test('the control: each form is found, in a comment none', () => {
  expect(physicalIn('css`/* left: 1rem */ margin-left: 1rem; .a { right: 0; } text-align: right; border-left-color: red; left: 50%; margin-inline-start: 1rem;`'))
    .toEqual(['margin-left: 1rem', 'right: 0', 'text-align: right', 'border-left-color: red'])
  expect(physicalIn('css`background: linear-gradient(90deg, red, blue); mask: linear-gradient(to left, red, blue); background: linear-gradient(to var(--inline-end, right), red, blue); background: linear-gradient(to top, red, blue);`'))
    .toEqual(['linear-gradient(90deg', 'linear-gradient(to left'])
  expect(physicalIn('css`box-shadow: inset 0.3rem 0 0 #fff; box-shadow: inset 0 0 0 1px #fff; box-shadow: inset -2px 0 #fff; box-shadow: inset calc(0.3rem * var(--inline-sign, 1)) 0 #fff;`'))
    .toEqual(['box-shadow: inset 0.3rem', 'box-shadow: inset -2px'])
  expect(physicalIn('<a style={{ marginLeft: 1, marginInlineStart: 2 }}/><a style={{ width: 1, left: 0 }}/><a style={{ left: x }}/><a style={{ textAlign: \'right\' }}/>'))
    .toEqual(['marginLeft:', 'style={{ width: 1, left: 0', 'textAlign: \'right'])
})

test('each root of what stays left to right says so, and a player mount through LeftToRight', () => {
  const says = (path: string) => /dir="ltr"|<LeftToRight>/.test(readFileSync(join(ROOT, path), 'utf8'))
  expect(['src/components/player/index.tsx', 'src/components/volume-control.tsx', 'src/router/debug/index.tsx', 'src/components/legal-doc.tsx'].filter(path => !says(path))).toEqual([])
  expect(says('src/components/footer.tsx'), 'the control: a page that follows the viewer says nothing').toBe(false)
})
