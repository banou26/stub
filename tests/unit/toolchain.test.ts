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

type LockEntry = { name?: string, version: string, dependencies?: Record<string, string>, engines?: { node?: string } }

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

// Cloudflare Pages builds on whatever .node-version names, and on node 22.16.0 without one, which is
// below vite-plus's own floor. npm only warns for a regular dependency, but drops an OPTIONAL native
// binding that fails its engine check without a word, so a floor raised past the pin breaks the deploy
// and nothing local. The ranges these packages publish are ^x.y.z and >=x.y.z joined by ||; anything
// else throws rather than being guessed at.
const parse = (version: string) => version.split('.').map(Number)
const atLeast = ([a, b, c]: number[], [x, y, z]: number[]) => a !== x ? a > x : b !== y ? b > y : c >= z
const satisfies = (version: string, range: string) => range.split('||').some(clause => {
  const match = /^(\^|>=)(\d+\.\d+\.\d+)$/.exec(clause.trim())
  if (!match) throw new Error(`unsupported engines clause: ${clause}`)
  const [have, floor] = [parse(version), parse(match[2])]
  return atLeast(have, floor) && (match[1] === '>=' || have[0] === floor[0])
})

describe('Pages builds on a node the toolchain accepts', () => {
  it('the range check can tell an accepted node from a refused one (control)', () => {
    expect(satisfies('24.21.0', '^20.19.0 || ^22.18.0 || >=24.11.0')).toBe(true)
    expect(satisfies('22.16.0', '^20.19.0 || ^22.18.0 || >=24.11.0')).toBe(false)
    expect(satisfies('21.0.0', '^20.19.0 || >=24.11.0')).toBe(false)
  })

  it('.node-version satisfies vite-plus, vite-plus-core and vitest', () => {
    const pinned = readFileSync(join(ROOT, '.node-version'), 'utf8').trim()
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    const refused = ['node_modules/vite-plus', 'node_modules/vite', 'node_modules/vitest']
      .map(path => [path, (lock.packages[path] as LockEntry).engines?.node] as const)
      .filter(([, range]) => !range || !satisfies(pinned, range))
    expect(refused).toEqual([])
  })
})
