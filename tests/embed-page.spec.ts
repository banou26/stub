import type { AddressInfo } from 'node:net'

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'

// fkn.app/app serves the PACKAGE root on the tenant origin, so nothing at that origin's root is the
// package's. 0.0.27's player answered 502 there (measured 2026-09-26): the watch route framed
// '/embed.html' and the page named '/assets/...'. This builds the package as `npm run build` does and
// serves it under a prefix, where an origin-root url 404s just as the tenant refuses it.

const ROOT = join(import.meta.dirname, '..')
const PREFIX = '/some/prefix/'
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }

/** the url a built chunk computes for the page, as scripts/embed-page.ts renders it */
const FRAMED = /new URL\(\s*(["'`])([^"'`]*embed\.html)\1\s*,\s*import\.meta\.url\s*\)/g

let pkg: string
let server: Server
let origin: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  pkg = mkdtempSync(join(tmpdir(), 'stub-embed-page-'))
  // the two vite builds of `npm run build`, written to a package root of their own so build/ is untouched
  for (const config of ['vite.config.ts', 'vite.lib.config.ts']) {
    execFileSync(join(ROOT, 'node_modules', '.bin', 'vp'), ['build', '--config', config, '--outDir', join(pkg, 'build')], { cwd: ROOT, stdio: 'pipe' })
  }

  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://package').pathname)
    const file = path.startsWith(PREFIX) ? join(pkg, path.slice(PREFIX.length)) : undefined
    if (!file || relative(pkg, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not in the package')
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (pkg) rmSync(pkg, { recursive: true, force: true })
})

test('the player page loads from under a prefix, with every file it names', async ({ page }) => {
  // the page frames the fkn.app api, which has nothing to do with whether its own files resolve
  await page.route(url => !url.href.startsWith(origin), route => route.abort())
  const answered: string[] = []
  page.on('response', response => {
    if (response.url().startsWith(origin)) answered.push(`${response.status()} ${response.url().slice(origin.length)}`)
  })

  await page.goto(`${origin}${PREFIX}build/embed.html`)

  // with no source to play the page says so, which only its module can do
  await expect(page.locator('#app')).toHaveText('Unsupported or missing parameters')
  expect(answered.filter(line => !line.startsWith('200 '))).toEqual([])
  expect(answered.some(line => line.startsWith(`200 ${PREFIX}build/assets/embed-`) && line.endsWith('.js'))).toBe(true)
  // a stylesheet that failed to load is still in the list, with no rules
  const sheets = await page.evaluate(() => [...document.styleSheets].filter(sheet => sheet.href).map(sheet => sheet.cssRules.length))
  expect(sheets.length).toBeGreaterThan(0)
  expect(sheets.every(rules => rules > 0)).toBe(true)
})

test('the watch route frames the page beside whichever build runs it', async ({ request }) => {
  const chunks = [
    'build/index.js',
    ...readdirSync(join(pkg, 'build', 'assets')).filter(name => name.endsWith('.js')).map(name => `build/assets/${name}`),
  ]
  const framed = chunks.flatMap(chunk =>
    [...readFileSync(join(pkg, chunk), 'utf8').matchAll(FRAMED)].map(([, , path]) => ({ chunk, url: new URL(path!, `${origin}${PREFIX}${chunk}`).href })),
  )

  // build/index.js is what fkn.app/app runs; the app build's chunk is what anime.fkn.app runs
  expect(framed.map(({ chunk }) => chunk)).toContain('build/index.js')
  expect(framed.some(({ chunk }) => chunk.startsWith('build/assets/'))).toBe(true)
  for (const { url } of framed) {
    expect(url).toBe(`${origin}${PREFIX}build/embed.html`)
    const response = await request.get(url)
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('<title>Stub - Embed</title>')
  }
})
