import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// How the trailer sits in its box needs layout, which linkedom does not have. So this builds
// tests/trailer-crop.tsx with the app's JSX setup and measures the real player in boxes of several
// shapes, sized here rather than read off the surfaces. Nothing leaves the browser: YouTube's embed is
// a stub that answers the handshake, which is what shows the frame.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://trailer.test'
// the margin keeps the box apart from the viewport, which a container unit falls back to
const MARGIN = 100
const PAGE = `<!doctype html><body style="margin: ${MARGIN}px"><script type="module" src="/page.js"></script>`
const EMBED = `<!doctype html><script>addEventListener('message', event => {
  if (JSON.parse(event.data).event === 'listening') parent.postMessage(JSON.stringify({ event: 'onReady' }), '*')
})</script>`

/** where YouTube's title bar and logo row reach, from the frame's top and bottom edges (measured 2026-10-10) */
const CHROME = 70

const BOXES = [
  { name: 'a 16:9 box', width: 1000, height: 562.5 },
  { name: 'a box wider than 16:9', width: 1920, height: 1030 },
  { name: 'a box far wider than 16:9', width: 3440, height: 1390 },
  { name: 'a box narrower than 16:9', width: 1400, height: 850 },
  { name: 'a box taller than wide', width: 390, height: 794 },
  { name: 'a box inside a link', width: 700, height: 392.5, link: true },
]

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-trailer-crop-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/trailer-crop.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  // the last route registered is asked first
  await page.route('**/*', route => route.abort())
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: EMBED }))
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.fulfill({ path: join(dir, pathname) })
  })
})

for (const { name, width, height, link } of BOXES) {
  test(`the trailer fills ${name}, with YouTube's chrome cropped off`, async ({ page }) => {
    await page.setViewportSize({ width: Math.ceil(width) + 2 * MARGIN, height: Math.ceil(height) + 2 * MARGIN })
    await page.goto(`${ORIGIN}/?width=${width}&height=${height}${link ? '&link' : ''}`)
    const iframe = page.locator('iframe')
    await expect(iframe).toBeVisible()
    const box = (await page.locator('#box').boundingBox())!
    const frame = (await iframe.boundingBox())!

    // YouTube fits the video inside its frame, so a frame taller than 16:9 shows it at the frame's
    // full width, centred, with bands above and below
    const pictureHeight = frame.width * 9 / 16
    expect(frame.height).toBeGreaterThanOrEqual(pictureHeight)
    const picture = { left: frame.x, right: frame.x + frame.width, top: frame.y + (frame.height - pictureHeight) / 2, bottom: frame.y + (frame.height + pictureHeight) / 2 }
    expect(picture.left).toBeLessThanOrEqual(box.x + 0.5)
    expect(picture.top).toBeLessThanOrEqual(box.y + 0.5)
    expect(picture.right).toBeGreaterThanOrEqual(box.x + box.width - 0.5)
    expect(picture.bottom).toBeGreaterThanOrEqual(box.y + box.height - 0.5)
    // centred, and no bigger than covering takes: the picture meets the box on one axis
    expect(Math.abs(picture.left + picture.right - (2 * box.x + box.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(picture.top + picture.bottom - (2 * box.y + box.height))).toBeLessThanOrEqual(1)
    expect(Math.min(frame.width - box.width, pictureHeight - box.height)).toBeLessThanOrEqual(1)
    // the bands carry YouTube's chrome, so they have to reach past the box's edges by all of it
    expect(frame.y).toBeLessThanOrEqual(box.y - CHROME)
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(box.y + box.height + CHROME)
    // and what shows of the frame is the box alone: an IntersectionObserver's rect is clipped by every
    // ancestor, and the player's own wrapper is the only clip the hero has
    const shown = await iframe.evaluate(element => new Promise<DOMRectInit>(resolve => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect()
        const { x, y, width, height } = entry!.intersectionRect
        resolve({ x, y, width, height })
      })
      observer.observe(element)
    }))
    expect(shown).toEqual({
      x: expect.closeTo(box.x, 0),
      y: expect.closeTo(box.y, 0),
      width: expect.closeTo(box.width, 0),
      height: expect.closeTo(box.height, 0),
    })

    if (link) {
      // the frame takes no pointer events, so a click on the trailer lands on the link itself
      const href = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.getAttribute('href'))
      expect(href).toBe('/media')
    }
  })
}
