import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { catalogues, LANGUAGE_KEY } from './languages'
import { workerFakes } from './worker-fakes'

// HOR-1026 (stub in the viewer's language), step 9: Arabic and Hebrew as they ship (src/i18n/offered.json), on the real
// pages, built and served as tests/language-setting.spec.ts builds them. Each page reads right to left but the player,
// the series graph and the privacy and legal pages, which stay left to right.

test.describe.configure({ timeout: 180_000 })

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
const WATCH = '/watch/tmdb:93405-s1/tmdb:93405-s1e1/nf:81040344'
const TITLE = '/title/ag:(anilist:1,mal:1)'
const SERIES = '/title/ag:(anilist:900001)'

let dir: string
let server: Server
let port: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-right-to-left-'))
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
  port = String((server.address() as AddressInfo).port)
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route(url => url.port !== port, route => route.abort())
})

const at = (path = '/') => `http://stub.localhost:${port}${path}`
const pick = (page: Page, language: string) => page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
const direction = (page: Page, selector: string) => page.locator(selector).first().evaluate(element => getComputedStyle(element).direction)
const flipped = (page: Page, selector: string) => page.locator(selector).first().evaluate(element => getComputedStyle(element).scale)
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!

for (const language of ['ar', 'he']) {
  test.describe(language, () => {
    test.beforeEach(({ page }) => pick(page, language))

    for (const width of [390, 1280]) {
      test(`at ${width} px: every page scrolls no sideways, with the header's first item at the right`, async ({ page }) => {
        test.setTimeout(300_000)
        await page.setViewportSize({ width, height: 844 })
        const overflow: Record<string, number> = {}
        const drawn = async (path: string, selector: string) => {
          await page.goto(at(path))
          await expect(page.locator(selector).first()).toBeVisible({ timeout: 45_000 })
          overflow[path] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        }
        await drawn('/', '.theater .actions .play')
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        const start = await box(page, 'header .start')
        const actions = await box(page, 'header .actions')
        expect(start.x + start.width, 'the wordmark starts the row at the right').toBeGreaterThan(width - 40)
        expect(actions.x, 'the buttons end it at the left').toBeLessThan(start.x)

        await drawn(TITLE, '[data-themes] li')
        await drawn('/media/ag:(anilist:1,mal:1)', 'h1, .stack')
        await drawn(WATCH, '.player-container.fix button')
        await drawn('/search?genre=Action&format=TV', '.filters button.control')
        for (const section of ['sources', 'playback', 'language']) await drawn(`/settings#${section}`, `[data-section="${section}"]`)
        await drawn('/privacy', 'h1')
        expect(overflow).toEqual(Object.fromEntries(Object.keys(overflow).map(path => [path, 0])))
        expect(Object.keys(overflow), 'the control: every page was drawn').toHaveLength(9)
        // the control: the same reading sees a page wider than the window, which right to left grows to the left
        await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'width: 3000px; height: 1px' })))
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeGreaterThan(0)
      })
    }

    test('a row starts at the right and scrolls left, its arrows on their own sides and pointing outward', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 844 })
      await page.goto(at('/'))
      const row = page.locator('.home-row').first()
      const list = row.locator('.virtual-list').first()
      await expect(list.locator('a').first()).toBeVisible({ timeout: 45_000 })
      const first = (await list.locator('a').first().boundingBox())!
      expect(first.x + first.width, 'the first card sits at the right, past the gutter').toBeGreaterThan(1000)
      await expect(row.locator('.scroll-button')).toHaveCount(2)
      const previous = (await row.locator('.scroll-button.previous').boundingBox())!
      const next = (await row.locator('.scroll-button.next').boundingBox())!
      expect(previous.x, 'back is at the right, where the row starts').toBeGreaterThan(next.x)
      expect(await flipped(page, '.scroll-button.next svg')).toBe('-1 1')
      await row.hover()
      await row.locator('.scroll-button.next').click()
      await expect.poll(() => list.evaluate(element => element.scrollLeft), { timeout: 10_000 }).toBeLessThan(0)
    })

    test('the player stays left to right, inside a page that does not', async ({ page }) => {
      await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
      await page.setViewportSize({ width: 1280, height: 844 })
      await page.goto(at(TITLE))
      const row = page.locator('[data-themes] li').first()
      await expect(row).toBeVisible({ timeout: 45_000 })
      await row.locator('button').first().click()
      const bar = page.locator('[data-themes] .control-bar').first()
      await expect(bar).toBeAttached({ timeout: 30_000 })
      expect(await direction(page, 'main, #stub-root')).toBe('rtl')
      expect(await bar.evaluate(element => getComputedStyle(element).direction)).toBe('ltr')
    })

    test('the modal and the title page read right to left, the series graph left to right', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 844 })
      await page.goto(at(TITLE))
      await expect(page.locator('h1')).toBeVisible({ timeout: 45_000 })
      const title = (await page.locator('h1').boundingBox())!
      expect(title.x + title.width, 'the title starts at the right').toBeGreaterThan(640)
      expect(await page.locator('.chips').first().evaluate(element => getComputedStyle(element).maskImage), 'the chips fade at their end, the left').toContain('to left')

      await page.goto(at('/media/ag:(anilist:1,mal:1)'))
      await expect(page.locator('h2.title')).toBeVisible({ timeout: 45_000 })
      const heading = (await page.locator('h2.title').boundingBox())!
      const description = (await page.locator('.description').first().boundingBox())!
      expect(heading.x + heading.width, 'the modal\'s title starts at the right').toBeGreaterThan(640)
      expect(description.x + description.width, 'and so does its synopsis').toBeGreaterThan(640)

      await page.goto(at(SERIES))
      await page.locator('[data-franchise-open]').click()
      const graph = page.locator('[data-franchise] .react-flow')
      await expect(graph).toBeVisible()
      expect(await graph.evaluate(element => getComputedStyle(element).direction)).toBe('ltr')
      expect(await direction(page, '[data-franchise] .bar')).toBe('rtl')
      const close = (await page.locator('[data-franchise] .close').boundingBox())!
      expect(close.x, 'the sheet\'s close button ends the bar at the left').toBeLessThan(640)
    })

    test('a source\'s Latin title is cut at its own end, and its synopsis keeps its full stop after the last word, on the page\'s side', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(at(TITLE))
      const long = page.getByText('Session 10: Misunderstandings')
      await expect(long).toBeAttached({ timeout: 45_000 })
      const start = await long.evaluate(element => {
        const range = document.createRange()
        range.setStart(element.firstChild!, 0)
        range.setEnd(element.firstChild!, 1)
        return range.getBoundingClientRect().left - element.getBoundingClientRect().left
      })
      expect(start, 'the S is inside the box, and the end is what is cut').toBeGreaterThanOrEqual(0)

      await page.goto(at('/media/tmdb:93405-s1'))
      const synopsis = page.locator('.description').filter({ hasText: 'stakes.' }).first()
      await expect(synopsis).toBeVisible({ timeout: 45_000 })
      const ends = await synopsis.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        while (walker.nextNode() && !walker.currentNode.textContent!.includes('stakes.'));
        const text = walker.currentNode as Text
        const at = text.textContent!.indexOf('stakes.') + 'stakes'.length
        const left = (offset: number) => {
          const range = document.createRange()
          range.setStart(text, offset)
          range.setEnd(text, offset + 1)
          return range.getBoundingClientRect().left
        }
        return { word: left(at - 1), stop: left(at), right: element.getBoundingClientRect().right }
      })
      expect(ends.stop, 'the full stop follows the word').toBeGreaterThan(ends.word)
      await expect(synopsis).toBeInViewport()
    })

    test('the privacy and legal pages stay in English, left to right, under the page\'s own header', async ({ page }) => {
      for (const path of ['/privacy', '/legal']) {
        await page.goto(at(path))
        const doc = page.locator('[lang="en"]', { has: page.locator('h1') })
        await expect(doc).toHaveAttribute('dir', 'ltr', { timeout: 45_000 })
        expect(await doc.evaluate(element => getComputedStyle(element).direction)).toBe('ltr')
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      }
    })

    test('a switch\'s knob moves toward the left when turned on, and stays inside it', async ({ page }) => {
      await page.goto(at('/settings#playback'))
      const toggle = page.locator('[data-section="playback"] input[type="checkbox"]').first()
      await expect(toggle).toBeVisible({ timeout: 45_000 })
      const knob = (checked: boolean) => toggle.evaluate((input: HTMLInputElement, checked) => {
        input.checked = checked
        const { transform } = getComputedStyle(input, '::before')
        return new DOMMatrix(transform === 'none' ? undefined : transform).m41
      }, checked)
      await page.addStyleTag({ content: '*, *::before { transition: none !important }' })
      expect(await knob(false)).toBe(0)
      expect(await knob(true)).toBeLessThan(0)
    })
  })
}

test('a page in Arabic spaces no letters apart, while Hebrew keeps the spacing the design gave', async ({ page }) => {
  const spacing = async (language: string) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
    await page.goto(at('/'))
    await expect(page.locator('footer .wordmark')).toBeAttached({ timeout: 45_000 })
    return page.locator('footer .wordmark').evaluate(element => getComputedStyle(element).letterSpacing)
  }
  expect(await spacing('ar')).toBe('normal')
  expect(await spacing('he')).not.toBe('normal')
})

test('picking Arabic turns the page right to left, and picking English turns it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  await page.goto(at('/settings#language'))
  const select = page.getByRole('combobox', { name: 'Language' })
  await expect(select).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl')
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), select.selectOption('ar')])
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  const arabic = page.getByRole('combobox', { name: catalogues().ar!.Language })
  await expect(arabic).toHaveValue('ar')
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), arabic.selectOption('en')])
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl')
})

test('a browser asking for Hebrew or Arabic gets stub in it with nothing picked', async ({ browser }) => {
  for (const [locale, language] of [['he-IL', 'he'], ['ar-EG', 'ar']] as const) {
    const context = await browser.newContext({ locale })
    await context.route(url => url.port !== port, route => route.abort())
    try {
      const page = await context.newPage()
      await page.goto(at('/settings#language'))
      await expect(page.locator('html')).toHaveAttribute('lang', language, { timeout: 45_000 })
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      await expect(page.locator('header input')).toHaveAttribute('placeholder', catalogues()[language]!['Search anime, shows, movies…']!)
    } finally {
      await context.close()
    }
  }
})

test('in English the same readings find a left to right page: the wordmark at the left, the first card, nothing flipped', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  await page.goto(at('/'))
  const row = page.locator('.home-row').first()
  await expect(row.locator('.virtual-list a').first()).toBeVisible({ timeout: 45_000 })
  expect((await box(page, 'header .start')).x).toBeLessThan(40)
  expect(await flipped(page, '.scroll-button.next svg')).toBe('none')
  expect((await row.locator('.scroll-button.previous').boundingBox())!.x).toBeLessThan((await row.locator('.scroll-button.next').boundingBox())!.x)
  await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl')
})

test('a row steps as far right to left as left to right, onward and back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  const steps = async () => {
    await page.goto(at('/'))
    const row = page.locator('.home-row').first()
    const list = row.locator('.virtual-list').first()
    await expect(list.locator('a').first()).toBeVisible({ timeout: 45_000 })
    const settled = async () => {
      let last = NaN
      await expect.poll(async () => {
        const now = await list.evaluate(element => Math.abs(element.scrollLeft))
        const still = now === last
        last = now
        return still
      }, { timeout: 15_000, intervals: [300] }).toBe(true)
      return last
    }
    await row.locator('.scroll-button.next').click()
    const onward = await settled()
    await row.locator('.scroll-button.next').click()
    const further = await settled()
    await row.locator('.scroll-button.previous').click()
    return [onward, further, await settled()]
  }
  const english = await steps()
  expect(english[1], 'the control: a step moves the row').toBeGreaterThan(english[0]!)
  expect(english[2], 'the control: a step back brings it back').toBeLessThan(english[1]!)
  await pick(page, 'ar')
  expect(await steps()).toEqual(english)
})

// a player mounted anywhere else would mirror its seek bar on an Arabic page, which no reading of a page shows until someone adds one
test('every mount of the player sits in LeftToRight', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : [])
  const mounts = walk(join(ROOT, 'src')).filter(file => /<MediaPlayer\b|<VideoSurface\b/.test(readFileSync(file, 'utf8')))
  expect(mounts.length, 'the control: the player\'s mounts are found').toBeGreaterThanOrEqual(4)
  expect(mounts.filter(file => !readFileSync(file, 'utf8').includes('<LeftToRight>')).map(file => relative(ROOT, file))).toEqual([])
})
