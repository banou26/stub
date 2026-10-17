// Every `src/...:<line>` citation on the site must land inside the file it names.
//
// This catches a cited file that shrank or went away, and nothing finer: a line that still exists but
// now holds other code passes, which is why a citation by name is preferred to one by line.
//
// Run from docs/. Paths in the pages are relative to the stub repo root.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CITATION = /(?<![\w./-])((?:src|tests|scripts)\/[\w./-]+\.\w+):(\d+(?:-\d+)?(?:,\s?\d+(?:-\d+)?)*)/g

const pages = execFileSync('find', ['src/content/docs', '-name', '*.md', '-o', '-name', '*.mdx'], { encoding: 'utf-8' })
  .split('\n').filter(Boolean).sort()

const lengths = new Map()
const lengthOf = path => {
  if (!lengths.has(path)) {
    const file = `../${path}`
    lengths.set(path, existsSync(file) ? readFileSync(file, 'utf-8').replace(/\n$/, '').split('\n').length : undefined)
  }
  return lengths.get(path)
}

const failures = []
let checked = 0
for (const page of pages) {
  readFileSync(page, 'utf-8').split('\n').forEach((text, index) => {
    for (const [citation, path, ranges] of text.matchAll(CITATION)) {
      checked++
      const length = lengthOf(path)
      const last = Math.max(...ranges.split(/[,-]\s?/).map(Number))
      if (length === undefined) failures.push(`${page}:${index + 1} ${citation}: no such file`)
      else if (last > length) failures.push(`${page}:${index + 1} ${citation}: the file has ${length} lines`)
    }
  })
}

// A run that matched nothing would report no failures and look like a pass.
if (checked === 0) {
  console.error('CONTROL FAILED: no citation matched, so this run proved nothing')
  process.exit(1)
}
if (failures.length) {
  console.error(`${failures.length} of ${checked} citations point outside their file:`)
  for (const failure of failures) console.error('  ' + failure)
  process.exit(1)
}
console.log(`${checked} citations checked, every one inside its file`)
