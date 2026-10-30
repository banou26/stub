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

const draw = (page: Page, count: number, typed: boolean) =>
  page.evaluate(([count, typed]) => (window as unknown as { draw: (count: number, typed: boolean) => void }).draw(count, typed), [count, typed] as const)

for (const [width, height, cardWidth] of [[1440, 900, 250], [390, 844, 150]] as const) {
  test(`at ${width} wide, a home card's tag names a movie or a series inside its cover, and moves nothing landing`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction(() => 'draw' in window)
    const cards = page.locator('.category-item')
    const layout = () => cards.evaluateAll(cards => cards.map(card => {
      const { x, y, width, height } = card.querySelector('.information')!.getBoundingClientRect()
      return [x, y, width, height]
    }))
    await draw(page, 4, false)
    await expect(cards).toHaveCount(4)
    const untagged = await layout()
    await expect(page.locator('.kind-tag'), 'the control: no format named, no tag').toHaveCount(0)
    await draw(page, 4, true)
    await expect(cards.locator('.kind-tag')).toHaveText(['Movie', 'Series', 'Series'])
    await expect(cards.nth(3).locator('.kind-tag')).toHaveCount(0)
    expect(await layout()).toEqual(untagged)
    const fits = await cards.evaluateAll(cards => cards.slice(0, 3).map(card => {
      const box = card.getBoundingClientRect()
      const { left, right, top, bottom } = card.querySelector('.kind-tag')!.getBoundingClientRect()
      return { width: box.width, inside: left > box.left && right < box.right && top > box.top && bottom < box.bottom }
    }))
    expect(fits).toEqual(Array(3).fill({ width: cardWidth, inside: true }))
    const tag = (await cards.first().locator('.kind-tag').boundingBox())!
    await page.mouse.click(tag.x + tag.width / 2, tag.y + tag.height / 2)
    expect(await page.evaluate(() => (window as unknown as { visited: string[] }).visited.at(-1)), 'a click on the tag opens the card').toMatch(/^\/media\//)
  })
}

// in steps: floating-ui opens on a move over the card after the one entering it, and closes on one after leaving
const hover = async (page: Page, index: number) => {
  await page.mouse.move(0, 0, { steps: 4 })
  await expect(page.locator('.title-hovercard')).toHaveCount(0)
  const { x, y, width, height } = (await page.locator('.category-item').nth(index).boundingBox())!
  await page.mouse.move(x + width / 2, y + height / 2, { steps: 4 })
  await page.mouse.move(x + width / 2 + 10, y + height / 2 + 10, { steps: 4 })
}

test('a home card\'s hover card tags it as the card does, its lines where an untagged one has them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => 'draw' in window)
  await draw(page, 4, true)
  const shownOn = async (index: number) => {
    await hover(page, index)
    // offsetTop, which the card's opening scale leaves alone
    return page.locator('.title-hovercard').evaluate(card => ({
      tag: card.querySelector('.kind-tag')?.textContent ?? null,
      description: card.querySelector<HTMLElement>('.description')!.offsetTop,
    }))
  }
  const shown = [await shownOn(0), await shownOn(1), await shownOn(2), await shownOn(3)]
  expect(shown.map(({ tag }) => tag)).toEqual(['Movie', 'Series', 'Series', null])
  expect(shown.map(({ description }) => description)).toEqual(Array(4).fill(shown[3]!.description))
})

test('a hover card wider than the window keeps its tag on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => 'draw' in window)
  await draw(page, 4, true)
  await hover(page, 0)
  const preview = page.locator('.title-hovercard')
  // offsetWidth, which the card's opening scale leaves alone
  expect(await preview.evaluate((card: HTMLElement) => card.offsetWidth), 'the control: the card runs past the window').toBeGreaterThan(390)
  await expect(preview.locator('.kind-tag')).toBeInViewport({ ratio: 1 })
  // read at once, under one moment of the card's opening scale
  expect(await preview.evaluate(card => {
    const tag = card.querySelector('.kind-tag')!.getBoundingClientRect()
    const line = card.querySelector('.top')!.getBoundingClientRect()
    return tag.top >= line.top && tag.bottom <= line.bottom
  }), 'the tag sits on its count\'s line').toBe(true)
})
