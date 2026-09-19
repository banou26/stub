import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { npmEntryProblems } from '../../scripts/check-npm-entry.mjs'

// package.json's `main` is the only thing the platform reads to load this app: the sandbox appends
// <script type="module" src="/build/index.js"> and nothing else in this repo touches that file.
// 0.0.18 shipped without it and stayed green everywhere, so these are the checks that would have
// caught it, plus one control per rule proving each can say no.

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')) as {
  main: string
  files: string[]
  scripts: { build: string }
}

type Tree = { read: (path: string) => string | undefined, list: (path: string) => string[] }

const treeOf = (files: Record<string, string>): Tree => ({
  read: path => files[path],
  list: path => Object
    .keys(files)
    .filter(name => name.startsWith(`${path}/`))
    .map(name => name.slice(path.length + 1))
    .filter(name => !name.includes('/')),
})

const MANIFEST = { main: 'build/index.js', files: ['build', 'README.md'] }
const FILES = {
  'build/index.js': 'import { a } from "./assets/lib-chunk-Dx0.js";\na()\n',
  'build/assets/lib-chunk-Dx0.js': 'export const a = () => {}\n',
}

describe('the npm entry check', () => {
  test('passes a build that emits the module the manifest names', () => {
    expect(npmEntryProblems(MANIFEST, treeOf(FILES))).toEqual([])
  })

  // THE 0.0.18 CASE: an app build alone emits index.html and its assets, and no build/index.js
  test('refuses a build with no entry at all', () => {
    const { 'build/index.js': _, ...withoutEntry } = FILES
    expect(npmEntryProblems(MANIFEST, treeOf(withoutEntry)).join('\n')).toContain('build/index.js does not exist')
  })

  test('refuses an empty entry', () => {
    expect(npmEntryProblems(MANIFEST, treeOf({ ...FILES, 'build/index.js': '\n\n' })).join('\n')).toContain('is empty')
  })

  test('refuses an entry that is not an ES module', () => {
    const script = { ...FILES, 'build/index.js': 'console.log("mounted")\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(script)).join('\n')).toContain('not an ES module')
  })

  // the sandbox serves the tenant origin's root from the PACKAGE root and the entry sits at
  // /build/index.js, so '/assets/x' is looked up at the package root and 404s. vite.lib.config.ts
  // builds with base './' for this, and a build with base '/' emits exactly this shape.
  test('refuses an origin-root asset path, which the app build legitimately emits', () => {
    const absolute = { ...FILES, 'build/index.js': `${FILES['build/index.js']}new Worker("/assets/lib-worker-index-Cr3.js")\n` }
    expect(npmEntryProblems(MANIFEST, treeOf(absolute)).join('\n')).toContain('origin-root')
  })

  test('refuses a files list that would leave the entry out of the tarball', () => {
    expect(npmEntryProblems({ ...MANIFEST, files: ['README.md'] }, treeOf(FILES)).join('\n')).toContain('does not publish')
  })

  // a lib build emits its css as an asset nothing loads, because there is no html to link it from
  test('refuses a stylesheet left beside the entry with nothing loading it', () => {
    const orphan = { ...FILES, 'build/assets/lib-index-3a7.css': '.media-sr-only{}' }
    expect(npmEntryProblems(MANIFEST, treeOf(orphan)).join('\n')).toContain('would render unstyled')
  })

  test('refuses a manifest that names no entry', () => {
    expect(npmEntryProblems({ files: ['build'] }, treeOf(FILES)).join('\n')).toContain('no "main"')
  })
})

describe('the build script', () => {
  test('runs the lib build that emits the entry, and then checks it', () => {
    const build = pkg.scripts.build
    expect(build).toContain('vp build --config vite.lib.config.ts')
    expect(build).toContain('node scripts/check-npm-entry.mjs')
    expect(build.indexOf('vite.lib.config.ts')).toBeLessThan(build.indexOf('check-npm-entry.mjs'))
  })

  test('publishes the entry the platform loads', () => {
    expect(pkg.main).toBe('build/index.js')
    expect(pkg.files).toContain('build')
  })
})
