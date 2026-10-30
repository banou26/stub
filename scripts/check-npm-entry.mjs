#!/usr/bin/env node
// The npm entry gate, run by `npm run build` right after the two vite builds.
//
// The platform loads an npm app by appending `<script type="module" src="<entry>">` to a sandbox
// document, and the entry it reads is package.json's `main`. Nothing else in this repo observes that
// file: anime.fkn.app serves index.html, the playwright suite drives the test build, and the unit
// suite never sees build/. So 0.0.18 published a package whose `main` did not exist, every check
// stayed green, and the only symptom was a blank page at https://fkn.app/app/npm:@banou/stub.
//
// Each rule below pins one thing that was measured broken while fixing that, so a config edit that
// undoes any of them reds the build rather than the next release. The embed page rules are the same
// story for 0.0.27, whose player answered 502 under /app while anime.fkn.app played fine. The icon
// rules keep the manifest and icons in the signed release, the only place fkn.app reads an icon from.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EMBED_PAGE } from './embed-page.ts'

/** a static or dynamic ES import, which is what makes the file a module rather than a script */
const ES_MODULE = /(?:^|[\s;}])(?:import|export)\s*[{*"'(]|(?:^|[\s;}])(?:import|export)\s+\w/

/** an origin-root asset url, which the sandbox cannot resolve: see vite.lib.config.ts on `base` */
const ORIGIN_ROOT_ASSET = /["'`]\/assets\//

/** a url naming another origin, or none, rather than a file of this package */
const ELSEWHERE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i

/** an attribute of a built html page that the browser fetches */
const FETCHED_URL = /\s(?:src|href)="([^"]*)"/g

/** an ES import of a file of the package: static, re-exported, side effect only or dynamic, minified or not */
const IMPORTED = /\b(?:from|import)\s*\(?\s*["'`](\.\.?\/[^"'`]+\.js)["'`]/g

/** a wasm file or a font a build inlined as base64 */
const INLINED = /data:(?:application\/(wasm)|(font)\/)/

/** The files of the package `page` names, as paths from the package root. */
const namedBy = (tree, page) => [...(tree.read(page) ?? '').matchAll(FETCHED_URL)]
  .map(([, url]) => url)
  .filter(url => url && !ELSEWHERE.test(url) && !url.startsWith('/'))
  .map(url => posix.join(posix.dirname(page), url.split(/[?#]/)[0]))

/**
 * Every file of the build a page of the package loads by ES import, from the entry and the player page's scripts on,
 * those included. A worker's files are named by `new URL` and never imported, so none of them is here.
 */
const pageFiles = (pkg, tree) => {
  const seen = new Set()
  const visit = path => {
    const code = tree.read(path)
    if (code === undefined || seen.has(path)) return
    seen.add(path)
    for (const [, specifier] of code.matchAll(IMPORTED)) visit(posix.join(posix.dirname(path), specifier))
  }
  ;[pkg.main, ...namedBy(tree, posix.join(dirname(pkg.main), 'embed.html')).filter(file => file.endsWith('.js'))].forEach(visit)
  return [...seen]
}

/**
 * Whether `files` would publish `path`. Conservative and NOT a reimplementation of npm's matching:
 * an absent `files` publishes everything, and an entry publishes a path when it names it exactly or
 * names a directory above it. `npm pack --dry-run` is the complete answer and this is not it; this
 * only has to be right about the entry, which is the one path a consumer cannot do without.
 */
const publishes = (files, path) => {
  if (!Array.isArray(files)) return true
  const wanted = path.replace(/^\.?\//, '')
  return files.some(entry => {
    if (typeof entry !== 'string') return false
    const named = entry.replace(/^\.?\//, '').replace(/\/+$/, '')
    return named === wanted || wanted.startsWith(`${named}/`)
  })
}

/**
 * Reads a package root for the checks below. `read` answers undefined for a missing file and `list`
 * answers [] for a missing directory, so a missing build is a reported problem rather than a throw.
 */
export const readTree = (root) => ({
  read: (path) => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined,
  list: (path) => existsSync(join(root, path)) ? readdirSync(join(root, path)) : [],
})

/**
 * Every reason this package would not load as an app, worst first. An empty array is a pass.
 *
 * @param pkg  the parsed package.json, of which only `main` and `files` are read
 * @param tree the package root, as returned by `readTree`
 * @returns {string[]} one line per problem, each naming the file it is about
 */
export const npmEntryProblems = (pkg, tree) => {
  const main = pkg.main
  if (typeof main !== 'string' || !main.trim()) {
    return ['package.json declares no "main", so the platform has no module to load']
  }

  const problems = []
  const code = tree.read(main)

  if (code === undefined) {
    problems.push(`${main} does not exist. package.json names it as "main" and the platform loads exactly that file, so the build has to emit it.`)
  } else if (!code.trim()) {
    problems.push(`${main} is empty`)
  } else {
    if (!ES_MODULE.test(code)) {
      problems.push(`${main} carries no import or export, so it is not an ES module and <script type="module"> would load a script that exports nothing`)
    }
    if (ORIGIN_ROOT_ASSET.test(code)) {
      problems.push(`${main} names an origin-root '/assets/...' path. The sandbox serves the tenant origin's root from the package root and the entry sits under ${dirname(main)}/, so that path is not in the tarball. Build it with base './'.`)
    }
  }

  if (!publishes(pkg.files, main)) {
    problems.push(`package.json "files" does not publish ${main}, so the tarball would not carry the entry`)
  }

  // the app build links its stylesheet from index.html; a lib build has no html, so a stylesheet
  // left beside the entry is one nothing loads. vite.lib.config.ts inlines them into the entry.
  const assets = join(dirname(main), 'assets')
  const orphans = tree
    .list(assets)
    .filter(name => name.startsWith('lib-') && name.endsWith('.css'))
  if (orphans.length) {
    problems.push(`the entry loads no stylesheet, yet the build emitted ${orphans.join(', ')} beside it, so the app would render unstyled. The entry has to carry its css.`)
  }

  // a lib build inlines every asset, and jassub's wasm inlined made the first theme Play load 6.2 MB:
  // see the stub-lib-asset-files plugin in vite.lib.config.ts. Every chunk a page loads, since the player
  // shares the theme player's code with the embed page, so that chunk holds only an import
  const loaded = pageFiles(pkg, tree)
  if (!loaded.some(path => posix.basename(path).startsWith('lib-theme-player-'))) problems.push(`${assets} has no lib-theme-player chunk a page loads to check for inlined files`)
  for (const path of loaded) {
    const inlined = tree.read(path)?.match(INLINED)
    if (inlined) problems.push(`${path} carries a ${inlined[1] ?? inlined[2]} file inlined as base64, which every page loading it would download`)
  }

  return problems
}

/** the watch route's url for the page up to 0.0.27, which only anime.fkn.app answers */
const ORIGIN_ROOT_EMBED = /["'`]\/embed\.html/

/**
 * Every reason stub's player page would not load wherever the package is served, worst first.
 *
 * fkn.app/app serves the PACKAGE root, so the page is `<dir of main>/embed.html` there and nothing at
 * the origin root is the package's: see scripts/embed-page.ts. Takes the same arguments as
 * `npmEntryProblems`, and an empty array is a pass.
 *
 * @returns {string[]} one line per problem, each naming the file it is about
 */
export const embedPageProblems = (pkg, tree) => {
  if (typeof pkg.main !== 'string' || !pkg.main.trim()) return []

  const problems = []
  const dir = dirname(pkg.main)
  const page = posix.join(dir, 'embed.html')
  const html = tree.read(page)

  if (html === undefined) {
    problems.push(`${page} does not exist. The watch route frames it from beside the running build's html, so the lib build has to emit it there.`)
  } else {
    if (!publishes(pkg.files, page)) {
      problems.push(`package.json "files" does not publish ${page}, so the tarball would not carry the player`)
    }
    for (const [, url] of html.matchAll(FETCHED_URL)) {
      if (!url || ELSEWHERE.test(url)) continue
      if (url.startsWith('/')) {
        problems.push(`${page} names the origin-root '${url}'. fkn.app/app serves the package root, where that path is not the package's, so the page has to name its files relative to itself.`)
        continue
      }
      const file = posix.join(dir, url.split(/[?#]/)[0])
      if (tree.read(file) === undefined) problems.push(`${page} names '${url}', and ${file} is not in the build`)
    }
  }

  for (const chunk of [...tree.list(dir).map(name => posix.join(dir, name)), ...tree.list(posix.join(dir, 'assets')).map(name => posix.join(dir, 'assets', name))]) {
    if (!chunk.endsWith('.js')) continue
    const code = tree.read(chunk) ?? ''
    if (code.includes(EMBED_PAGE)) {
      problems.push(`${chunk} still names ${EMBED_PAGE}, so the build that emitted it ran without the stub-embed-page plugin and the watch route would throw`)
    }
    if (ORIGIN_ROOT_EMBED.test(code)) {
      problems.push(`${chunk} names an origin-root '/embed.html', which fkn.app/app answers with 502 not-listed. The page's url has to come from ${EMBED_PAGE}.`)
    }
  }

  return problems
}

/** The web app manifest the build copies from public/ to the root of the build. */
export const APP_MANIFEST = 'app.webmanifest'

const LINK_TAG = /<link\b[^>]*>/gi
const attributeOf = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1]

/**
 * Every reason the package would show no icon, worst first.
 *
 * fkn.app's package page reads an app's icon ONLY from a web app manifest in the signed release
 * contents, and resolves each icon against the manifest's own path inside the release. anime.fkn.app
 * serves the same build as its origin root. So the manifest and its icons have to be in the build and
 * in the tarball, named relative to the manifest, and index.html has to link the manifest and an icon
 * that exists. Takes the same arguments as `npmEntryProblems`, and an empty array is a pass.
 *
 * @returns {string[]} one line per problem, each naming the file it is about
 */
export const appIconProblems = (pkg, tree) => {
  if (typeof pkg.main !== 'string' || !pkg.main.trim()) return []

  const dir = posix.dirname(pkg.main)
  const path = posix.join(dir, APP_MANIFEST)
  const text = tree.read(path)
  if (text === undefined) {
    return [`${path} does not exist. fkn.app reads the app's icon from it, so the build has to copy it from public/.`]
  }

  const problems = []
  if (!publishes(pkg.files, path)) {
    problems.push(`package.json "files" does not publish ${path}, so the signed release would carry no icon`)
  }

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    return [...problems, `${path} is not valid JSON`]
  }

  const icons = Array.isArray(manifest?.icons) ? manifest.icons : []
  if (!icons.some(icon => icon?.type === 'image/png')) {
    problems.push(`${path} declares no png icon, the kind fkn.app's package page picks first`)
  }
  for (const icon of icons) {
    const src = typeof icon?.src === 'string' ? icon.src : ''
    if (!src || ELSEWHERE.test(src) || src.startsWith('/')) {
      problems.push(`${path} names the icon '${src}', which is not relative to the manifest, so fkn.app cannot find it inside the release`)
      continue
    }
    const file = posix.join(dir, src)
    if (tree.read(file) === undefined) problems.push(`${path} names '${src}', and ${file} is not in the build`)
    else if (!publishes(pkg.files, file)) problems.push(`package.json "files" does not publish ${file}, which ${path} names`)
  }

  const page = posix.join(dir, 'index.html')
  const links = [...(tree.read(page) ?? '').matchAll(LINK_TAG)].map(([tag]) => ({
    rel: (attributeOf(tag, 'rel') ?? '').toLowerCase().split(/\s+/),
    href: attributeOf(tag, 'href') ?? '',
  }))
  if (!links.some(link => link.rel.includes('manifest') && link.href === `/${APP_MANIFEST}`)) {
    problems.push(`${page} does not link /${APP_MANIFEST}`)
  }
  const iconLinks = links.filter(link => link.rel.includes('icon'))
  if (!iconLinks.length) problems.push(`${page} links no icon`)
  for (const { href } of iconLinks) {
    if (ELSEWHERE.test(href) || !href.startsWith('/') || tree.read(posix.join(dir, href)) === undefined) {
      problems.push(`${page} links the icon '${href}', and that is not a file at the root of the build`)
    }
  }

  // the consent card on fkn.app asks the app's origin for /favicon.ico before reading any html
  if (tree.read(posix.join(dir, 'favicon.ico')) === undefined) {
    problems.push(`${dir}/favicon.ico does not exist, so anime.fkn.app answers /favicon.ico with its html`)
  }

  return problems
}

/**
 * The most files a release can carry: the publish signs the package in place, and the signature's file
 * list (fkn.json) is refused past 16,384 bytes. 0.0.61's first publish carried 832 files, the offline
 * history's 768 shards among them, and its fkn.json came to 123,981 bytes, about 149 bytes a file.
 */
export const MAX_PACKED_FILES = 100

/**
 * The paths `npm pack --dry-run --json` would publish. npm 11 answers an array of reports and npm 12
 * an object keyed by the package's name; anything else throws rather than passing as an empty list.
 */
export const packedPaths = (json) => {
  const report = Array.isArray(json) ? json[0] : Object.values(json ?? {})[0]
  if (!Array.isArray(report?.files)) throw new Error('npm pack --dry-run --json gave no file list')
  return report.files.map(file => file.path)
}

/** Why `npm pack` would publish a package the signer refuses: too many files for its list. */
export const packedFilesProblems = (paths) => paths.length > MAX_PACKED_FILES
  ? [`the package would publish ${paths.length} files, and its signature lists at most about ${MAX_PACKED_FILES}: leave generated data out of "files" in package.json`]
  : []

/** `language`'s chunks as the lib build names them: stub's catalogue `lib-de-<hash>.js`, the player's labels `lib-de-<its hash>-<hash>.js` */
const languageChunk = language => new RegExp(`^lib-${language.replace(/[^\w-]/g, '')}-(?:[\\w-]{8}-)?[\\w-]{8}\\.js$`)

/**
 * Why `npm pack` would publish a package missing what it loads: a file the player page names, a chunk a page imports,
 * or one of an offered language's two chunks (stub's text and the player's labels). Each reads as a working app, the
 * first on the disk `embedPageProblems` looks at, a language's partly in English. Takes `npmEntryProblems`'s
 * arguments, then what `packedPaths` read and the offered languages, English among them with no chunk.
 *
 * @returns {string[]} one line per problem, each naming the file it is about
 */
export const unpackedFilesProblems = (pkg, tree, paths, languages) => {
  const page = posix.join(dirname(pkg.main), 'embed.html')
  const named = namedBy(tree, page)
  const loaded = pageFiles(pkg, tree)
  return [
    ...named.filter(file => !paths.includes(file)).map(file => `${page} names ${file}, and package.json "files" leaves it out`),
    ...loaded.filter(file => !paths.includes(file) && !named.includes(file)).map(file => `a page imports ${file}, and package.json "files" leaves it out`),
    ...languages.filter(language => language !== 'en').flatMap(language => {
      const chunks = loaded.filter(file => languageChunk(language).test(posix.basename(file)))
      return chunks.length < 2 ? [`a page imports ${chunks.length} of ${language}'s two chunks, stub's text and the player's labels, so a viewer of that language would read the package partly in English`] : []
    }),
  ]
}

const isMain =process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const tree = readTree(root)
  const packed = packedPaths(JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })))
  const languages = JSON.parse(readFileSync(join(root, 'src/i18n/offered.json'), 'utf8'))
  const problems = [...npmEntryProblems(pkg, tree), ...embedPageProblems(pkg, tree), ...appIconProblems(pkg, tree), ...packedFilesProblems(packed), ...unpackedFilesProblems(pkg, tree, packed, languages)]
  if (problems.length) {
    console.error(`the built package cannot be loaded as an app:\n${problems.map(line => `  - ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`${pkg.main} is an ES module the platform can load, ${posix.join(dirname(pkg.main), 'embed.html')} loads from wherever ${dirname(pkg.main)}/ is served, and ${posix.join(dirname(pkg.main), APP_MANIFEST)} names icons the package ships`)
}
