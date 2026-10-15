import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// Where a home row's cards sit needs layout, which linkedom does not have. So this builds
// tests/media-section.tsx with the app's JSX setup and measures the real row, empty and filled.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://row.test'
// the app's own root font size and reset (src/index.tsx)
const PAGE = `<!doctype html>
<style>
  html { font-size: 62.5%; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-size: 1.6rem; }
</style>
<body><div id="row"></div><script type="module" src="/page.js"></script></body>`

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-media-section-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/media-section.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.fulfill({ path: join(dir, pathname) })
  })
})

// the row's own box, and its first card's, or the first placeholder standing in for it
const measure = async (page: Page, count: number) => {
  await page.evaluate(count => (window as unknown as { draw: (count: number) => void }).draw(count), count)
  const first = page.locator(count ? '.category-item' : '.list-container > .pending > *').first()
  await first.waitFor()
  const box = async (element: ReturnType<Page['locator']>) => {
    const { x, y, width, height } = (await element.boundingBox())!
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  }
  return { row: await box(page.locator('.list-container')), first: await box(first) }
}

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`at ${width} wide, an empty home row holds its first card's place and its own height until the cards land`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction(() => 'draw' in window)
    const empty = await measure(page, 0)
    const filled = await measure(page, 3)
    expect(filled.first.height, 'the control: a card was measured').toBeGreaterThan(0)
    expect(empty).toEqual(filled)
  })
}
