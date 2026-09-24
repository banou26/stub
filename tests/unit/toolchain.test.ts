import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// vite-plus bundles its own vitest and ships vite as vite-plus-core, and its docs require a project to
// pin both to the same release ("Updating the Vitest Pin" at viteplus.dev). A pin left behind on a
// vite-plus bump keeps installing the previous runner. Stub had no vitest pin at all and carried the
// vulnerable vitest 4.1.10 (GHSA-82fw-gwwq-j7x9) under vite-plus 0.2.4 until 2026-09-24.
const ROOT = join(import.meta.dirname, '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))

type LockEntry = { name?: string, version: string, dependencies?: Record<string, string> }

const installed = (pattern: RegExp): [string, LockEntry][] =>
  Object.entries(lock.packages as Record<string, LockEntry>).filter(([path]) => pattern.test(path))

describe('the vite-plus toolchain is pinned as one release', () => {
  const vitePlus = lock.packages['node_modules/vite-plus'] as LockEntry
  const core = `npm:@voidzero-dev/vite-plus-core@${vitePlus.version}`

  it('the vite alias names the core of the installed vite-plus, everywhere npm reads it', () => {
    expect(manifest.devDependencies['vite-plus']).toBe(vitePlus.version)
    expect(manifest.devDependencies.vite).toBe(core)
    expect(manifest.overrides.vite).toBe(core)
    const vites = installed(/(^|\/)node_modules\/vite$/).map(([, entry]) => `${entry.name}@${entry.version}`)
    expect(vites).toEqual([`@voidzero-dev/vite-plus-core@${vitePlus.version}`])
  })

  it('the vitest pin is the vitest vite-plus itself depends on', () => {
    expect(vitePlus.dependencies?.vitest).toBeDefined()
    expect(manifest.overrides.vitest).toBe(vitePlus.dependencies?.vitest)
  })

  it('one vitest is installed, and every @vitest package is at the pinned version', () => {
    const copies = installed(/(^|\/)node_modules\/(vitest|@vitest\/[^/]+)$/)
    expect(copies.length, 'the scan found no vitest at all, so it proves nothing').toBeGreaterThan(1)
    const off = copies
      .filter(([, entry]) => entry.version !== manifest.overrides.vitest)
      .map(([path, entry]) => `${path}@${entry.version}`)
    expect(off).toEqual([])
    expect(copies.filter(([path]) => path.endsWith('node_modules/vitest'))).toHaveLength(1)
  })
})
