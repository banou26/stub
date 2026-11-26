#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc')
const ENTRY = join(ROOT, 'src', 'plugin-sdk.ts')
const OUT_DIR = join(ROOT, 'build')
const OUT_JS = join(OUT_DIR, 'plugin.js')
const OUT_DTS = join(OUT_DIR, 'plugin.d.ts')

mkdirSync(OUT_DIR, { recursive: true })

const tempDir = mkdtempSync(join(tmpdir(), 'stub-sdk-'))
try {
  execFileSync(
    TSC,
    [
      ENTRY,
      '--ignoreConfig',
      '--declaration',
      '--outDir',
      tempDir,
      '--strict',
      '--target',
      'ESNext',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' },
  )
  const emittedJs = join(tempDir, 'plugin-sdk.js')
  const emittedDts = join(tempDir, 'plugin-sdk.d.ts')
  if (!existsSync(emittedJs)) throw new Error('build-plugin-sdk: missing emitted plugin-sdk.js')
  if (!existsSync(emittedDts)) throw new Error('build-plugin-sdk: missing emitted plugin-sdk.d.ts')
  const js = readFileSync(emittedJs, 'utf8')
  const dts = readFileSync(emittedDts, 'utf8')
  if (!js.trim()) throw new Error('build-plugin-sdk: empty runtime output for src/plugin-sdk.ts')
  if (!dts.trim()) throw new Error('build-plugin-sdk: empty declaration output for src/plugin-sdk.ts')
  if (/^\s*import\s+/m.test(js)) {
    throw new Error('build-plugin-sdk: build/plugin.js must remain self-contained without external imports')
  }
  if (/^\s*import\s+/m.test(dts)) {
    throw new Error('build-plugin-sdk: build/plugin.d.ts must remain self-contained without external imports')
  }
  writeFileSync(OUT_JS, js, 'utf8')
  writeFileSync(OUT_DTS, dts, 'utf8')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

console.log('built build/plugin.js and build/plugin.d.ts')
