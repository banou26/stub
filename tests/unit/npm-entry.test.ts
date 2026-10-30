import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vite-plus/test'

// a plain .mjs beside the other build scripts, so its exports arrive untyped
import { embedPageProblems, MAX_PACKED_FILES, npmEntryProblems, packedFilesProblems, packedPaths, unpackedFilesProblems } from '../../scripts/check-npm-entry.mjs'
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
  'build/assets/lib-chunk-Dx0.js': 'export const a = () => import("./lib-theme-player-Cz4.js")\n',
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

  // the theme player's code now sits in a chunk it shares with the player page, and its own chunk holds an import
  test('refuses a wasm file inlined in any chunk a page loads, and leaves a worker\'s to it', () => {
    const importing = (name: string) => `export * from "./${name}";\nexport const a = () => import("./lib-theme-player-Cz4.js")\n`
    const shared = { ...FILES, 'build/assets/lib-chunk-Dx0.js': importing('lib-dist-Dk2.js'), 'build/assets/lib-dist-Dk2.js': 'const wasm = "data:application/wasm;base64,AGFzbQEAAAA="\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(shared)).join('\n')).toContain('build/assets/lib-dist-Dk2.js carries a wasm file inlined')
    const worker = { ...FILES, 'build/assets/lib-worker-index-Dk2.js': 'const wasm = "data:application/wasm;base64,AGFzbQEAAAA="\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(worker))).toEqual([])
    // a page's own module named worker is lib-worker-<hash>.js, the prefix of the worker build's files
    const named = { ...FILES, 'build/assets/lib-chunk-Dx0.js': importing('lib-worker-DSkdrrCa.js'), 'build/assets/lib-worker-DSkdrrCa.js': worker['build/assets/lib-worker-index-Dk2.js'] }
    expect(npmEntryProblems(MANIFEST, treeOf(named)).join('\n')).toContain('build/assets/lib-worker-DSkdrrCa.js carries a wasm file inlined')
  })

  // jassub's default subtitle font, 146 KB of base64 in the chunk the player page starts with
  test('refuses a font inlined in a chunk a page loads', () => {
    const font = { ...FILES, 'build/assets/lib-theme-player-Cz4.js': 'const font = "data:font/woff2;base64,d09GMgABAAAA"\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(font)).join('\n')).toContain('build/assets/lib-theme-player-Cz4.js carries a font file inlined')
  })

  test('refuses a build with no theme player chunk to check', () => {
    const { 'build/assets/lib-theme-player-Cz4.js': _, ...withoutChunk } = FILES
    expect(npmEntryProblems(MANIFEST, treeOf(withoutChunk)).join('\n')).toContain('has no lib-theme-player chunk a page loads to check')
    const unreached = { ...FILES, 'build/assets/lib-chunk-Dx0.js': 'export const a = () => {}\n' }
    expect(npmEntryProblems(MANIFEST, treeOf(unreached)).join('\n'), 'one no page imports is not checked').toContain('has no lib-theme-player chunk a page loads to check')
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

  describe('what is left out', () => {
    // each language's two chunks as the lib build names them, stub's catalogue and the player's labels
    const LANGUAGES = ['lib-de-DQmxQTyn.js', 'lib-de-DphEdq0O-BM5XdUtZ.js', 'lib-es-419-D_M_JP1W.js', 'lib-es-419-D6gsvnn8-VS3RU2S7.js', 'lib-pt-BR-D6iy4qke.js', 'lib-pt-BR-wudK3giz-xrXcNP3R.js']
    const PLAYER_PAGE: Record<string, string> = {
      'build/index.js': 'export const a = () => import("./assets/lib-intl-Ch66zsrE.js")\n',
      'build/embed.html': '<script type="module" src="./assets/lib-embed-Dk2Ab_c-.js"></script><link rel="stylesheet" href="https://fonts.example/a.css">',
      // as the minifier writes them
      'build/assets/lib-embed-Dk2Ab_c-.js': 'import"./lib-intl-Ch66zsrE.js";\n',
      'build/assets/lib-intl-Ch66zsrE.js': `const c={${LANGUAGES.map(name => `"${name}":()=>import(\`./${name}\`)`).join(',')}},w=new URL(\`./lib-worker-index-B6VYNi0d.js\`,import.meta.url);\n`,
      'build/assets/lib-worker-index-B6VYNi0d.js': 'import("./lib-worker-stub-042-Dk2Ab_c-.js")\n',
      'build/assets/lib-worker-stub-042-Dk2Ab_c-.js': 'export {}\n',
      ...Object.fromEntries(LANGUAGES.map(name => [`build/assets/${name}`, 'export default {}\n'])),
    }
    const PACKED = ['build/index.js', 'build/embed.html', 'build/assets/lib-embed-Dk2Ab_c-.js', 'build/assets/lib-intl-Ch66zsrE.js', 'build/assets/lib-worker-index-B6VYNi0d.js', ...LANGUAGES.map(name => `build/assets/${name}`)]

    test('passes a package with the player page\'s files and each language\'s chunks, English having none, and no worker\'s shard', () => {
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), PACKED, ['en', 'de', 'es-419', 'pt-BR'])).toEqual([])
    })

    test('refuses a package missing a file the player page names', () => {
      const paths = PACKED.filter(path => !path.includes('lib-embed'))
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), paths, ['en']).join('\n')).toContain('build/embed.html names build/assets/lib-embed-Dk2Ab_c-.js')
    })

    test('refuses a package missing a chunk a page imports', () => {
      const paths = PACKED.filter(path => !path.includes('lib-intl'))
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), paths, ['en'])).toEqual(['a page imports build/assets/lib-intl-Ch66zsrE.js, and package.json "files" leaves it out'])
    })

    // es-419's chunks fell to the pattern meant for the history's shards, `*-[0-9][0-9][0-9]-*.js`, and Spanish
    // would have read as English in the package alone, with no error
    test('refuses a package missing an offered language\'s chunks, either of the two', () => {
      const spanish = PACKED.filter(path => !path.includes('es-419'))
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), spanish, ['en', 'es-419']).join('\n')).toContain('leaves it out')
      const labels = PACKED.filter(path => !path.endsWith('lib-de-DphEdq0O-BM5XdUtZ.js'))
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), labels, ['en', 'de'])).toEqual(['a page imports build/assets/lib-de-DphEdq0O-BM5XdUtZ.js, and package.json "files" leaves it out'])
    })

    test('refuses an offered language a page imports fewer than two chunks of, another tag\'s not counting', () => {
      const { 'build/assets/lib-de-DphEdq0O-BM5XdUtZ.js': _, ...unlabelled } = PLAYER_PAGE
      expect(unpackedFilesProblems(MANIFEST, treeOf(unlabelled), PACKED, ['en', 'de']).join('\n')).toContain('a page imports 1 of de\'s two chunks')
      expect(unpackedFilesProblems(MANIFEST, treeOf(PLAYER_PAGE), PACKED, ['pt']).join('\n')).toContain('a page imports 0 of pt\'s two chunks')
    })
  })

  test('package.json publishes one build of the page and each language, and none of the history\'s shards', () => {
    const root = mkdtempSync(join(tmpdir(), 'stub-npm-files-'))
    const published = [
      'build/index.js',
      'build/embed.html',
      'build/assets/lib-embed-Dk2Ab_c-.js',
      'build/assets/lib-de-DQmxQTyn.js',
      'build/assets/lib-de-DphEdq0O-BM5XdUtZ.js',
      'build/assets/lib-es-419-D_M_JP1W.js',
      'build/assets/lib-es-419-D6gsvnn8-VS3RU2S7.js',
      'build/assets/lib-worker-index-B6VYNi0d.js',
      'build/assets/lib-jassub-worker-CkfUMbe_.wasm',
    ]
    const left = [
      'build/assets/main-BvIGtXtY.js',
      'build/assets/de-CKTRf7mS.js',
      'build/assets/es-419-BuWA9Mss.js',
      'build/assets/stub-042-Dk2Ab_c-.js',
      'build/assets/lib-worker-dump-042-Dk2Ab_c-.js',
      'build/assets/lib-worker-stub-042-Dk2Ab_c-.js',
      'build/assets/lib-worker-history-shards--R5hLvQv.js',
    ]
    try {
      for (const path of [...published, ...left]) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), 'export {}\n')
      }
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', main: pkg.main, files: pkg.files }))
      const paths = packedPaths(JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })))
      expect(paths.filter(path => path.startsWith('build/')).sort()).toEqual([...published].sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
