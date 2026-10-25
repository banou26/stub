import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { embedPageProblems, MAX_PACKED_FILES, npmEntryProblems, packedFilesProblems, packedPaths } from '../../scripts/check-npm-entry.mjs'
import { EMBED_PAGE } from '../../scripts/embed-page'

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
  'build/assets/lib-theme-player-Cz4.js': 'const wasm = new URL(new URL("lib-jassub-worker-C7b.wasm", import.meta.url).href)\n',
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

  test('refuses a theme player chunk with a wasm file inlined in it', () => {
    const inlined = { ...FILES, 'build/assets/lib-theme-player-Cz4.js': 'const wasm = "data:application/wasm;base64,AGFzbQEAAAA="\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(inlined)).join('\n')).toContain('build/assets/lib-theme-player-Cz4.js carries a wasm file inlined')
  })

  test('refuses a build with no theme player chunk to check', () => {
    const { 'build/assets/lib-theme-player-Cz4.js': _, ...withoutChunk } = FILES
    expect(npmEntryProblems(MANIFEST, treeOf(withoutChunk)).join('\n')).toContain('has no lib-theme-player chunk to check')
  })

  test('refuses a manifest that names no entry', () => {
    expect(npmEntryProblems({ files: ['build'] }, treeOf(FILES)).join('\n')).toContain('no "main"')
  })
})

// Under fkn.app/app the tenant serves the package root, so the player page is /build/embed.html and
// nothing at the origin root is the package's. 0.0.27 framed '/embed.html' and that page named
// '/assets/...', and both answered 502 not-listed there while anime.fkn.app played fine.
const PAGE = {
  ...FILES,
  'build/embed.html': [
    '<script type="module" crossorigin src="./assets/embed-D1N.js"></script>',
    '<link rel="stylesheet" crossorigin href="./assets/embed-3a7.css">',
    '<iframe src="https://fkn.app/api"></iframe>',
  ].join('\n'),
  'build/assets/embed-D1N.js': 'import "./uri-Dv8.js"\n',
  'build/assets/embed-3a7.css': '.media-sr-only{}',
  'build/assets/main-D0k.js': 'const src = `${new URL(`../embed.html`,import.meta.url).href}?${params}`\n',
}

describe('the embed page check', () => {
  test('passes a page that names its files relative to itself, and a frame on another origin', () => {
    expect(embedPageProblems(MANIFEST, treeOf(PAGE))).toEqual([])
  })

  // THE 0.0.27 CASE, as the app build emits it with base '/'
  test('refuses a page that names an origin-root file', () => {
    const absolute = { ...PAGE, 'build/embed.html': PAGE['build/embed.html'].replace('./assets/embed-D1N.js', '/assets/embed-D1N.js') }
    expect(embedPageProblems(MANIFEST, treeOf(absolute)).join('\n')).toContain("origin-root '/assets/embed-D1N.js'")
  })

  test('refuses a page that names a file the build does not have', () => {
    const { 'build/assets/embed-3a7.css': _, ...withoutSheet } = PAGE
    expect(embedPageProblems(MANIFEST, treeOf(withoutSheet)).join('\n')).toContain('build/assets/embed-3a7.css is not in the build')
  })

  test('refuses a build with no page beside the entry', () => {
    const { 'build/embed.html': _, ...withoutPage } = PAGE
    expect(embedPageProblems(MANIFEST, treeOf(withoutPage)).join('\n')).toContain('build/embed.html does not exist')
  })

  test('refuses a files list that would leave the page out of the tarball', () => {
    expect(embedPageProblems({ ...MANIFEST, files: ['build/index.js'] }, treeOf(PAGE)).join('\n')).toContain('does not publish build/embed.html')
  })

  // THE 0.0.27 CASE on the watch route's side, in the lib entry and in the app chunk alike
  test('refuses a chunk that frames the origin-root page', () => {
    const rooted = { ...PAGE, 'build/index.js': `${FILES['build/index.js']}const src = \`/embed.html?\${params}\`\n` }
    expect(embedPageProblems(MANIFEST, treeOf(rooted)).join('\n')).toContain("build/index.js names an origin-root '/embed.html'")
  })

  test('refuses a chunk the page url was never rendered into', () => {
    const unrendered = { ...PAGE, 'build/assets/main-D0k.js': `const src = \`\${${EMBED_PAGE}}?\${params}\`\n` }
    expect(embedPageProblems(MANIFEST, treeOf(unrendered)).join('\n')).toContain(`build/assets/main-D0k.js still names ${EMBED_PAGE}`)
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

describe('the published file list', () => {
  const paths = (count: number) => Array.from({ length: count }, (_, index) => `build/assets/file-${index}.js`)

  test('a package with more files than the signature can list is refused, as 0.0.61\'s 832 were', () => {
    expect(packedFilesProblems(paths(832))).toHaveLength(1)
    expect(packedFilesProblems(paths(MAX_PACKED_FILES + 1))).toHaveLength(1)
  })

  test('the control: 0.0.60\'s 62 files pass', () => {
    expect(packedFilesProblems(paths(62))).toEqual([])
  })

  test('npm pack\'s report reads the same from npm 11\'s array and npm 12\'s object keyed by name', () => {
    const report = { name: '@banou/stub', files: [{ path: 'build/index.js' }, { path: 'fkn.json' }] }
    expect(packedPaths([report])).toEqual(['build/index.js', 'fkn.json'])
    expect(packedPaths({ '@banou/stub': report })).toEqual(['build/index.js', 'fkn.json'])
    expect(() => packedPaths({}), 'the control: no report is an error, not an empty list').toThrow()
  })

  test('package.json leaves the offline history\'s shards and their maps out of the package', () => {
    expect(pkg.files).toContain('!build/assets/*-[0-9][0-9][0-9]-*.js')
    expect(pkg.files).toContain('!build/assets/*history-shards-*.js')
  })
})
