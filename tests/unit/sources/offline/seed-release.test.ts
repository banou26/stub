// The seed's release coordinates are written twice: src/sources/offline/seed.ts is what the runtime
// downloads, .github/workflows/season-seed.yml is what the walk uploads. Nothing at run time can tell
// them apart when they drift, because a runtime 404 falls back to the bundle and looks exactly like
// nothing being wrong, while the workflow stays green. This file is what keeps them one fact.
//
// It also pins that every page the exporter opens carries both walk flags, which is the composition
// `refusesSeedAsset` cannot check for itself.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import {
  SEED_EPISODES_ASSET, SEED_INDEX_ASSET, SEED_MANIFEST_ASSET, SEED_RELEASE_TAG,
} from '../../../../src/sources/offline/seed'
import { readExportFlag, readNoSeedFlag } from '../../../../src/utils/export-flag'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')

const workflow = read('.github/workflows/season-seed.yml')
const exporter = read('scripts/export-season-seed.mjs')

test('the workflow uploads to the tag and the filenames the runtime downloads', () => {
  expect(workflow.match(/^\s*TAG:\s*(\S+)\s*$/m)?.[1]).toBe(SEED_RELEASE_TAG)

  const uploaded = [...workflow.matchAll(/gh release upload "\$TAG"\s+dist-seed\/(\S+)/g)].map(match => match[1])
  expect(uploaded, 'control: the publish step has to name assets for this to prove anything').toHaveLength(3)
  expect(uploaded.sort()).toEqual([SEED_EPISODES_ASSET, SEED_INDEX_ASSET, SEED_MANIFEST_ASSET].sort())
})

// On node 22 the unit suite this runs fails at tests/unit/sources/stub/opfs-store.test.ts, which needs
// navigator.locks, so the first scheduled walk would have stopped before publishing anything.
test('the walk runs on the repo\'s own node, as the unit suite it runs needs', () => {
  const setups = [...workflow.matchAll(/uses: actions\/setup-node@\S+\s+with:\s+((?:\s*(?:#.*|[\w-]+:.*)\n)+)/g)].map(match => match[1])
  expect(setups, 'control: the workflow has to set up node for this to prove anything').toHaveLength(1)
  expect(setups[0]).toMatch(/^\s*node-version-file: \.node-version$/m)
  expect(setups[0]).not.toMatch(/^\s*node-version:/m)
})

test('the relay census reads the manifest the exporter writes', () => {
  expect(workflow).toContain(`dist-seed/${SEED_MANIFEST_ASSET}`)
})

test('every page the exporter opens carries the export hook and the no-seed flag', () => {
  const query = exporter.match(/const WALK_QUERY = '([^']+)'/)?.[1]
  expect(query, 'control: the exporter has to declare one query for this to prove anything').toBeDefined()
  expect(readExportFlag(`https://anime.fkn.app/${query}`)).toBe(true)
  expect(readNoSeedFlag(`https://anime.fkn.app/${query}`)).toBe(true)

  // every navigation either carries the query itself or goes to the one path built with it, so a goto
  // added later with a bare url fails here rather than walking a page that reads the last publish
  const navigations = exporter.split('\n').filter(line => /page\.goto\(|const path = /.test(line))
  expect(navigations, 'control: the walk has to navigate somewhere').not.toHaveLength(0)
  for (const line of navigations) expect(line.trim(), line.trim()).toMatch(/WALK_QUERY|\$\{path\}/)
})

// The first real walk against the deployed site (2026-09-05, 273 runs, commit f96e66b) settled at a
// MEDIAN of 5264 ms with ZERO runs capped, which is the floor plus one poll: every page satisfied the
// quiet window in the first gap between two sources answering. It exported a median identity of ONE
// and a streaming share of 0.042, and the gate refused it on both. Three independent measurements
// from the same day say enrichment needs far longer: scripts/reproduce-season-weld.mjs waits 11000 ms
// a page and reproduces reliably, scripts/check-similar-media.mjs saw crunchyroll answer between
// 3.0 s and 9.4 s after navigation and needed a 15 s header window, and a 25 s probe of the home page
// read 231 clusters where this walk's 5.3 s read 197. So the floor is the number that decides whether
// a seed is worth publishing at all, and it is pinned here against the walk that measured it.
const settleConstant = (name: string) => Number(new RegExp(`const ${name} = ([\\d_]+)`).exec(exporter)?.[1]?.replace(/_/g, ''))

test('the settle window is wide enough for the enrichment the walk measured', () => {
  expect(settleConstant('SETTLE_FLOOR_MS'), 'a page enriched for 11 s in the weld script').toBeGreaterThanOrEqual(11_000)
  expect(settleConstant('SETTLE_CAP_MS'), 'the similarMedia consumer alone may take its 30 s timeout').toBeGreaterThanOrEqual(30_000)
  expect(settleConstant('SETTLE_QUIET_MS'), 'a gap between two sources answering is not a settled store').toBeGreaterThanOrEqual(3_000)
  expect(settleConstant('SETTLE_CAP_MS')).toBeGreaterThan(settleConstant('SETTLE_FLOOR_MS'))
})
