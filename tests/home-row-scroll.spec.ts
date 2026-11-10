import type { Page } from '@playwright/test'

import { expect, test, webkit } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// A row's sideways scroll needs layout, which linkedom does not have, so this builds tests/home-row-scroll.tsx with
// the app's JSX setup and walks STUB-412's steps on the browser's own history: a trip through a title page throws the
// home page away, and Back has to draw its row again where the viewer left it.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://rows.test'
// the app's own root font size and reset (src/index.tsx)
const PAGE = `<!doctype html>
<style>
  html { font-size: 62.5%; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-size: 1.6rem; }
</style>
<body><div id="app"></div><script type="module" src="/page.js"></script></body>`
// where two presses of the next arrow left Current season in the issue
const LEFT = 2620

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-home-row-scroll-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/home-row-scroll.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const open = async (page: Page) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === '/page.js'
      ? route.fulfill({ path: join(dir, pathname) })
      : route.fulfill({ contentType: 'text/html', body: PAGE })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${ORIGIN}/`)
  await page.locator('.category-item').first().waitFor()
}

test.beforeEach(({ page }) => open(page))

const row = (page: Page) => page.locator('.virtual-list').first()
const left = (page: Page) => row(page).evaluate(element => Math.round(element.scrollLeft))
// as the viewer's own scroll would, one frame for the scroll event to land
const scrollRow = (page: Page, to: number) => row(page).evaluate(async (element, to) => {
  element.scrollLeft = to
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}, to)
const navigate = (page: Page, to: string) => page.evaluate(to => (window as unknown as { navigate: (to: string) => void }).navigate(to), to)
const toTitle = async (page: Page) => {
  await navigate(page, '/title/ag:(anilist:3)')
  await expect(page.locator('.category-item'), 'the control: the title page threw the home page away').toHaveCount(0)
}
// the card in the middle of the row, as a pointer picks one: a locator's click would scroll its own card into view
const openCard = async (page: Page) => {
  const { x, y, width, height } = (await row(page).boundingBox())!
  await page.mouse.click(x + width / 2, y + height / 2)
  await expect(page).toHaveURL(/\/media\//)
}

test('Back through a card\'s preview from its title page draws the row where the viewer left it', async ({ page }) => {
  await scrollRow(page, LEFT)
  expect(await left(page), 'the control: the row scrolls that far').toBe(LEFT)
  await openCard(page)
  expect(await left(page), 'the preview opens over the same home page').toBe(LEFT)
  await toTitle(page)
  await page.goBack()
  await expect(page).toHaveURL(/\/media\//)
  await expect.poll(() => left(page)).toBe(LEFT)
  await page.goBack()
  await expect(page).toHaveURL(`${ORIGIN}/`)
  expect(await left(page)).toBe(LEFT)
})

// WebKit through Playwright's run-server (PW_WEBKIT_WS), as tests/watch-stage.spec.ts: its Navigation API is not
// Chromium's, since a navigate event there reads no state for the entry Back reaches (WebKit 26.4, 2026-11-11)
test('in WebKit too, Back through the title page draws the row where the viewer left it', async () => {
  test.skip(!process.env.PW_WEBKIT_WS, 'no WebKit server (PW_WEBKIT_WS)')
  const browser = await webkit.connect(process.env.PW_WEBKIT_WS!)
  try {
    const page = await browser.newPage()
    await open(page)
    await scrollRow(page, LEFT)
    expect(await left(page), 'the control: the row scrolls that far').toBe(LEFT)
    await openCard(page)
    await toTitle(page)
    await page.goBack()
    await expect(page).toHaveURL(/\/media\//)
    await expect.poll(() => left(page)).toBe(LEFT)
  } finally {
    await browser.close()
  }
})

test('a home page asked for from another page starts the row at its first card', async ({ page }) => {
  await scrollRow(page, LEFT)
  await toTitle(page)
  await navigate(page, '/')
  await page.locator('.category-item').first().waitFor()
  expect(await left(page)).toBe(0)
})

test('each home page in the history comes back where the viewer left that one', async ({ page }) => {
  await scrollRow(page, LEFT)
  await toTitle(page)
  await navigate(page, '/')
  await page.locator('.category-item').first().waitFor()
  expect(await left(page), 'the control: the home page asked for again starts at the first card').toBe(0)
  await scrollRow(page, 500)
  await toTitle(page)
  await page.goBack()
  await expect.poll(() => left(page)).toBe(500)
  await page.goBack()
  await expect(page.locator('.category-item')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(`${ORIGIN}/`)
  await expect.poll(() => left(page)).toBe(LEFT)
})

test('a reload of the title page keeps the rows for Back', async ({ page }) => {
  await scrollRow(page, LEFT)
  await openCard(page)
  await toTitle(page)
  await page.reload()
  await page.locator('h1').waitFor()
  await page.goBack()
  await expect(page).toHaveURL(/\/media\//)
  await expect.poll(() => left(page)).toBe(LEFT)
  await page.goBack()
  await expect(page).toHaveURL(`${ORIGIN}/`)
  await expect.poll(() => left(page)).toBe(LEFT)
})

test('a row whose cards arrive after Back goes where it was once they reach, unless the viewer moved it first', async ({ page }) => {
  await scrollRow(page, LEFT)
  await toTitle(page)
  // ten cards reach about half way
  await page.evaluate(() => Object.assign(window, { firstCards: 10 }))
  await page.goBack()
  await page.locator('.category-item').first().waitFor()
  const short = await left(page)
  expect(short, 'the control: ten cards stop short of it').toBeLessThan(LEFT)
  expect(short).toBeGreaterThan(0)
  await toTitle(page)
  await page.evaluate(() => Object.assign(window, { firstCards: 40 }))
  await page.goBack()
  await page.locator('.category-item').first().waitFor()
  await expect.poll(() => left(page), 'left before its cards reached, the row keeps where it was going').toBe(LEFT)

  await toTitle(page)
  await page.evaluate(() => Object.assign(window, { firstCards: 10 }))
  await page.goBack()
  await page.locator('.category-item').first().waitFor()
  await page.evaluate(() => (window as unknown as { cards: (count: number) => void }).cards(40))
  await expect.poll(() => left(page)).toBe(LEFT)

  await toTitle(page)
  await page.goBack()
  await page.locator('.category-item').first().waitFor()
  await scrollRow(page, 500)
  await page.evaluate(() => (window as unknown as { cards: (count: number) => void }).cards(40))
  await page.waitForTimeout(100)
  expect(await left(page), 'the viewer\'s own move stays').toBe(500)
})
