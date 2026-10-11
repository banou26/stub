import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// A card's height needs layout, which linkedom does not have. So this builds tests/media-relations.tsx
// with the app's JSX setup and measures the real relation row. Nothing leaves the browser, so the
// covers fail to load and keep the box their CSS gives them.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://relations.test'
// the app's own root font size and reset (src/index.tsx), which every rem below is measured against
const PAGE = `<!doctype html>
<style>
  html { font-size: 62.5%; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { padding: 16px; background: #0f0f0f; color: #fff; font-size: 1.6rem; }
</style>
<body><script type="module" src="/page.js"></script>`

// The modal's content box (media-modal.tsx): 130rem less 2.5rem of padding each side at 1440, and
// 0.6rem plus 1.5rem each side on a phone.
const WIDTHS = [
  { name: 'at 1440 wide', viewport: 1440, width: 1250, middleStacked: true },
  { name: 'on a 390 wide phone', viewport: 390, width: 348, middleStacked: false },
]

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-media-relations-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: {
      outDir: dir,
      rollupOptions: {
        input: join(ROOT, 'tests/media-relations.tsx'),
        // the trace link's lazy import of the whole app worker, which this page never opens
        external: [join(ROOT, 'src/worker.ts')],
        output: { entryFileNames: 'page.js' },
      },
    },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  // the last route registered is asked first
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.fulfill({ path: join(dir, pathname) })
  })
})

for (const { name, viewport, width, middleStacked } of WIDTHS) {
  test(`every relation card keeps its natural height ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport, height: 900 })
    await page.goto(`${ORIGIN}/?width=${width}`)
    const cards = page.locator('a.relation-card')
    await expect(cards).toHaveCount(4)

    const measured = await cards.evaluateAll(elements => elements.map(element => {
      const card = element as HTMLElement
      const height = card.getBoundingClientRect().height
      // flex-start takes the card out of any stretch, which leaves the height its own content gives it
      card.style.alignSelf = 'flex-start'
      const natural = card.getBoundingClientRect().height
      card.style.alignSelf = ''
      return { relation: card.querySelector('.relation')!.textContent!, height, natural }
    }))
    expect(measured.map(card => card.relation)).toEqual(['Prequel', 'Side story', 'Character', 'Sequel'])

    if (middleStacked) {
      // the reported layout: the Side story and Character cards stack in the middle lane, so it is
      // taller than any one card beside it
      const middle = (await page.locator('.lane.middle').boundingBox())!
      expect(middle.height).toBeGreaterThan(1.5 * Math.max(...measured.map(card => card.natural)))
    }
    for (const card of measured) expect(card.height, card.relation).toBeCloseTo(card.natural, 0)
  })
}
