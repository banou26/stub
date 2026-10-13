import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// How many lines a card's title is clamped to needs layout, which linkedom does not have. So this
// builds tests/media-title.tsx with the app's JSX setup and measures the real card.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://card.test'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><body style="margin: 0; display: flex; gap: 20px; background: #000; font-family: sans-serif"><div id="reused"></div><div id="fresh"></div><script type="module" src="/page.js"></script>'
const LONG = 'American Horror Story: Freak Show and the Hotel Cortez'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-media-title-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/media-title.tsx'), output: { entryFileNames: 'page.js' } } },
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

const draw = (page: Page, id: string, title: string) =>
  page.evaluate(([id, title]) => (window as unknown as { draw: (id: string, title: string) => void }).draw(id!, title!), [id, title])

// the clamp is written once the title has been measured, with the height it sets
const clamp = async (page: Page, id: string) => {
  const text = page.locator(`#${id} .title-text > div`)
  await expect(text).toHaveAttribute('style', /height/)
  return text.evaluate(element => ({ lines: getComputedStyle(element).webkitLineClamp, height: element.clientHeight }))
}

test('a card handed a longer title clamps it as a fresh card does', async ({ page }) => {
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => 'draw' in window)
  await draw(page, 'reused', 'Lioness')
  const short = await clamp(page, 'reused')
  await draw(page, 'reused', LONG)
  await draw(page, 'fresh', LONG)
  const fresh = await clamp(page, 'fresh')
  expect(Number(fresh.lines), 'the control: the long title takes more lines than the short one').toBeGreaterThan(Number(short.lines))
  await expect.poll(() => clamp(page, 'reused')).toEqual(fresh)
})
