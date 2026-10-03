import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8')) as { fkn?: { url?: unknown } }

// HOR-226: fkn.app sends a top-level visit of /app/npm:@banou/stub to this address once it is a verified
// source of stub's app; @fkn/sign refuses any spelling other than the one the URL parser writes
test('the release declares anime.fkn.app as stub\'s own address, spelled as the URL parser writes it', () => {
  expect(pkg.fkn?.url).toBe('https://anime.fkn.app/')
  expect(new URL(pkg.fkn!.url as string).href).toBe(pkg.fkn!.url)
})
