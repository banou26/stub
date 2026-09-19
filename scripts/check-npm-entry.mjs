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
// undoes any of them reds the build rather than the next release.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** a static or dynamic ES import, which is what makes the file a module rather than a script */
const ES_MODULE = /(?:^|[\s;}])(?:import|export)\s*[{*"'(]|(?:^|[\s;}])(?:import|export)\s+\w/

/** an origin-root asset url, which the sandbox cannot resolve: see vite.lib.config.ts on `base` */
const ORIGIN_ROOT_ASSET = /["'`]\/assets\//

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
  const orphans = tree
    .list(join(dirname(main), 'assets'))
    .filter(name => name.startsWith('lib-') && name.endsWith('.css'))
  if (orphans.length) {
    problems.push(`the entry loads no stylesheet, yet the build emitted ${orphans.join(', ')} beside it, so the app would render unstyled. The entry has to carry its css.`)
  }

  return problems
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const problems = npmEntryProblems(pkg, readTree(root))
  if (problems.length) {
    console.error(`the built package cannot be loaded as an app:\n${problems.map(line => `  - ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`${pkg.main} is an ES module the platform can load`)
}
