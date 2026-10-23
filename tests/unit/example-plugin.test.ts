import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

// The root type-checks and lints examples/source-plugin against the ROOT's installs, so the example's
// own manifest can drift with every check here still green.
const ROOT = join(import.meta.dirname, '..', '..')
const read = (file: string) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
const root = read('package.json')
const example = read('examples/source-plugin/package.json')
const lock = read('package-lock.json')

// ^0.y.z admits 0.y.w for w >= z; any other range throws rather than being guessed at
const admits = (range: string, version: string) => {
  const match = /^\^0\.([1-9]\d*)\.(\d+)$/.exec(range)
  if (!match) throw new Error(`unsupported range: ${range}`)
  const [major, minor, patch = -1] = version.split('.').map(Number)
  return major === 0 && minor === Number(match[1]) && patch >= Number(match[2])
}

describe('the example plugin asks for what the root builds it against', () => {
  it('the range check can tell an admitted version from a refused one (control)', () => {
    expect(admits('^0.9.61', '0.9.61')).toBe(true)
    expect(admits('^0.9.61', '0.9.70')).toBe(true)
    expect(admits('^0.9.61', '0.9.60')).toBe(false)
    expect(admits('^0.6.0', '0.9.61')).toBe(false)
    expect(admits('^0.9.61', '1.9.61')).toBe(false)
    expect(() => admits('^1.4.0', '1.4.0')).toThrow('unsupported range')
    expect(() => admits('^0.0.3', '0.0.3')).toThrow('unsupported range')
  })

  it('asks for the vite-plus the root pins as its floor', () => {
    expect(example.devDependencies['vite-plus']).toBe(`^${root.devDependencies['vite-plus']}`)
  })

  it('asks for an @fkn/lib range that admits the one the root installs', () => {
    const installed = lock.packages['node_modules/@fkn/lib'].version
    expect(admits(example.devDependencies['@fkn/lib'], installed)).toBe(true)
  })
})
