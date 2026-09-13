import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Recorded source answers never enter git: the dump under corpus/ is ignored, and a case names the
// answer keys it was built from (source.answers) rather than carrying the raw rows. Owner's rule,
// 2026-09-12. The two checks below are what turn the rule into a build failure.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const CASES = join(ROOT, 'tests', 'corpus', 'cases')
const TESTS = join(ROOT, 'tests')

const DUMP_READ = /corpus\/season\/[^'"`\s]+\/answers\.jsonl/

const testFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return testFilesUnder(path)
    return entry.name.endsWith('.test.ts') ? [path] : []
  })

const hasRawKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasRawKey)
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => key === 'raw' || hasRawKey(entry))
}

describe('no raw source data in git', () => {
  it('corpus/ is ignored, so a season dump cannot be staged', () => {
    const status = execFileSync('git', ['check-ignore', '-q', 'corpus/season/any/answers.jsonl'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] })
    expect(status).toBeDefined()
  })

  it('a control that must NOT be ignored proves the check can fail', () => {
    expect(() => execFileSync('git', ['check-ignore', '-q', 'tests/corpus/README.md'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] })).toThrow()
  })

  it('no case file carries a raw key at any depth', () => {
    const files = readdirSync(CASES).filter(file => file.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter(file => hasRawKey(JSON.parse(readFileSync(join(CASES, file), 'utf8'))))
    expect(offenders).toEqual([])
  })

  // The dump is ignored, so a runner that has never walked a season does not have one. A test that
  // reads it without checking passes on a machine that has and fails on CI, and the branch cannot
  // see that for itself: test.yml runs on main and pull requests only, so a long lived branch first
  // learns of it from the push that deploys. tests/unit/sources/unogs/search-year.test.ts did
  // exactly that on 2026-09-14 and took the first Test run on main down with it.
  it('every test reading the ignored season dump guards on its absence', () => {
    const readers = testFilesUnder(TESTS)
      .filter(file => file !== import.meta.filename)
      .filter(file => DUMP_READ.test(readFileSync(file, 'utf8')))
    expect(readers.length, 'the scan found no reader, so it cannot fail and proves nothing').toBeGreaterThan(1)
    const unguarded = readers
      .filter(file => !readFileSync(file, 'utf8').includes('existsSync'))
      .map(file => relative(ROOT, file))
    expect(unguarded).toEqual([])
  })

  it('the raw detector sees a nested raw key (control)', () => {
    expect(hasRawKey({ rows: [{ uri: 'x', raw: {} }] })).toBe(true)
    expect(hasRawKey({ rows: [{ uri: 'x' }] })).toBe(false)
  })
})
