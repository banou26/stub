import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { expect, test } from 'vite-plus/test'

// HOR-1026 (stub in the viewer's language), step 9: a page in Arabic or Hebrew mirrors only what its CSS names by start and
// end, so one `margin-left` shows as a bug only to a viewer of those languages, long after it merged.
const ROOT = join(import.meta.dirname, '..', '..')
const SOURCES = join(ROOT, 'src')

// these stay left to right on a right to left page, so left is left
const LEFT_TO_RIGHT = [
  'src/components/player/index.tsx', 'src/components/volume-control.tsx', 'src/components/yt-minimal-player.tsx',
  'src/router/debug/episodes.tsx', 'src/router/debug/graph.tsx', 'src/router/debug/index.tsx', 'src/router/debug/inspector.tsx',
  'src/router/debug/value.tsx', 'src/router/privacy/index.tsx',
]
// `left: 0` that means the left: a pointer's place in the window, which the first mirrors itself, and a watched bar, which
// runs as the player's seek bar does
const TRULY_LEFT = ['src/components/party-cursor.tsx', 'src/router/home/media-details.tsx']

const PHYSICAL = /(?<![\w-])(?:(?:left|right|(?:margin|padding|border)-(?:left|right)(?:-\w+)?)\s*:\s*[^;}]+|text-align:\s*(?:left|right)\b)/g

const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? (entry.name === 'generated' ? [] : sources(join(directory, entry.name)))
  : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)]
  : [])

/** Each physical inline declaration of `code`'s css templates, but a centred element's `left: 50%`, whose translate is physical too. */
const physicalIn = (code: string) => [...code.matchAll(/(?:css|keyframes)`[\s\S]*?`/g)]
  .flatMap(([template]) => template.replace(/\/\*[\s\S]*?\*\//g, '').match(PHYSICAL) ?? [])
  .filter(declaration => !/^left:\s*50%/.test(declaration))

test('the page names its sides by start and end, but what stays left to right', () => {
  const found = sources(SOURCES).flatMap(file => {
    const path = relative(ROOT, file)
    if (LEFT_TO_RIGHT.includes(path)) return []
    return physicalIn(readFileSync(file, 'utf8'))
      .filter(declaration => !(TRULY_LEFT.includes(path) && declaration === 'left: 0'))
      .map(declaration => `${path}: ${declaration}`)
  })
  expect(found).toEqual([])
})

test('the control: each form is found, in a comment none', () => {
  expect(physicalIn('css`/* left: 1rem */ margin-left: 1rem; .a { right: 0; } text-align: right; border-left-color: red; left: 50%; margin-inline-start: 1rem;`'))
    .toEqual(['margin-left: 1rem', 'right: 0', 'text-align: right', 'border-left-color: red'])
})
