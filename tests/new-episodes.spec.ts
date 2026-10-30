import type { AddressInfo } from 'node:net'
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { workerFakes } from './worker-fakes'

// HOR-1114 (home's New episodes row: a heading like Current season's, its own page, and a place under Current
// season): home as stub.fkn.app serves it, built and served the way tests/title-page.spec.ts does, the viewer's
// lists being the device's own, written through the title page's Quick tracking.

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
const VIEWPORTS = [[1440, 900], [390, 844]] as const
const WATCHED = 5
let dir: string
let server: Server
let origin: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-new-episodes-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    worker: { plugins: workerFakes },
    build: { outDir: dir, emptyOutDir: true },
    plugins: [{
      name: 'spec-fake-plugins',
      enforce: 'pre',
      resolveId: (source, importer) => {
        const path = importer && resolve(dirname(importer), source)
        return path === plugins ? join(ROOT, 'tests', 'fake-plugins.ts')
          : path === fetch ? join(ROOT, 'tests', 'fake-fetch.ts')
          : undefined
      },
    }],
  })
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://app').pathname)
    const file = join(dir, path)
    const served = !relative(dir, file).startsWith('..') && existsSync(file) && statSync(file).isFile() ? file : join(dir, 'index.html')
    response.writeHead(200, { 'content-type': TYPES[extname(served)] ?? 'application/octet-stream' })
    createReadStream(served).pipe(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route(url => !url.href.startsWith(origin), route => route.abort())
  // every load records whether the empty line was ever put on the page, however briefly
  await page.addInitScript(() => {
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.textContent?.includes('No new episodes')))) Object.assign(window, { sawNone: true })
    }).observe(document, { childList: true, subtree: true })
  })
})

const sawNone = (page: Page) => page.evaluate(() => Boolean((window as { sawNone?: boolean }).sawNone))

const season = (page: Page) => page.locator('.title', { hasText: /^Current season$/ })
const heading = (page: Page) => page.getByRole('link', { name: 'New episodes', exact: true })

const box = async (locator: Locator) => {
  const { x, y, width, height } = (await locator.boundingBox())!
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

// what the page paints at the middle of the element, scrolled into view: the element itself, or what covers it
const painted = async (locator: Locator) => {
  await locator.scrollIntoViewIfNeeded()
  return locator.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    const hit = document.elementFromPoint(x + width / 2, y + height / 2)
    return hit && element.contains(hit) ? 'itself' : `${hit?.tagName}.${hit?.className}`
  })
}

// the count once it holds still for two seconds: a card only stub's merged data can count lands after the rest
const settledCount = async (locator: Locator) => {
  const counts: number[] = []
  await expect.poll(async () => {
    counts.push(await locator.count())
    return counts.length > 2 && counts.slice(-3).every(count => count === counts.at(-1))
  }, { intervals: [1_000], timeout: 30_000 }).toBe(true)
  return counts.at(-1)!
}

/** Marks the work Watching with episode 1 watched; false when its Quick tracking takes no episode (a film's) or no status. */
const watch = async (page: Page, uri: string) => {
  await page.goto(`${origin}/title/${uri}`)
  const tracking = page.getByRole('region', { name: 'Quick tracking' })
  const status = tracking.getByRole('combobox', { name: 'Status' })
  const episodes = tracking.getByLabel('Episodes')
  if (!await expect(status).toBeEnabled({ timeout: 30_000 }).then(() => true, () => false) || !await episodes.isVisible()) return false
  await status.selectOption({ label: 'Watching' })
  await episodes.fill('1')
  await episodes.press('Enter')
  await expect(page.locator('.actions .play')).toHaveText('Continue', { timeout: 30_000 })
  return true
}

test('the New episodes row lands under Current season, headed as it is, and its heading opens a page of them all', async ({ page }) => {
  test.setTimeout(600_000)
  const top: Record<number, number> = {}
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/`)
    await expect(season(page)).toBeVisible({ timeout: 60_000 })
    top[width] = (await box(season(page))).y
  }
  await page.goto(`${origin}/continue`)
  await expect(page.getByText('No new episodes', { exact: true }), 'nothing watched yet').toBeVisible({ timeout: 60_000 })
  expect(await sawNone(page), 'the control: the record sees the line').toBe(true)

  await page.goto(`${origin}/`)
  const cards = page.locator('a[href^="/media/"]')
  await expect(cards.nth(2 * WATCHED)).toBeVisible({ timeout: 60_000 })
  const uris = [...new Set(await cards.evaluateAll(links => links.map(link => link.getAttribute('href')!.slice('/media/'.length))))]
  let watched = 0
  for (const uri of uris) if (watched < WATCHED && await watch(page, uri)) watched++
  expect(watched, 'the control: enough works tracked by episode').toBe(WATCHED)

  // the device's own list names no status or schedule, so every card waits on stub's merged data
  await page.goto(`${origin}/continue`)
  await expect(page.locator('a.card').first()).toBeVisible({ timeout: 30_000 })
  expect(await sawNone(page), 'no empty line before the cards').toBe(false)

  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/`)
    await expect(heading(page)).toBeVisible({ timeout: 60_000 })
    const row = page.locator('section', { has: heading(page) }).locator('a.card')
    // a work of the season with nothing out yet has nothing new, so the row may hold fewer than were watched
    const count = await settledCount(row)
    expect(count, 'the control: enough of them to run past a 390 px screen').toBeGreaterThanOrEqual(3)
    const [own, theirs] = [await box(heading(page)), await box(season(page))]
    expect.soft(theirs.y, `${width}: Current season's top, as before the row landed`).toBe(top[width])
    expect.soft(own.y, `${width}: the row sits under Current season`).toBeGreaterThan(theirs.y)
    expect([own.x, own.height], `${width}: the heading is Current season's size and place`).toEqual([theirs.x, theirs.height])
    expect(await painted(heading(page)), `${width}: nothing paints over the heading`).toBe('itself')
    if (width === 390) {
      const last = await box(row.last())
      expect(last.x + last.width, 'the control: the row holds more than the phone shows').toBeGreaterThan(width)
    }

    await heading(page).click()
    await expect(page).toHaveURL(`${origin}/continue`)
    const listed = page.locator('a.card')
    await expect(listed).toHaveCount(count, { timeout: 30_000 })
    for (const card of await listed.all()) {
      const { x, width: cardWidth } = await box(card)
      expect(x + cardWidth, `${width}: every card fits across the screen`).toBeLessThanOrEqual(width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: no sideways scroll`).toBe(0)
  }

  const first = page.locator('a.card').first()
  const href = (await first.getAttribute('href'))!
  await first.click()
  await expect(page).toHaveURL(`${origin}${href}`)
  await expect(page.locator('.modal h2.title')).toHaveText(/\S/, { timeout: 30_000 })
})
