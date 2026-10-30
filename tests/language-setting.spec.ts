import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { catalogues, english, englishIn, LANGUAGE_KEY } from './languages'
import { workerFakes } from './worker-fakes'

// HOR-1026 (stub in the viewer's language), step 8: the languages stub offers, as it ships them (src/i18n/offered.json,
// no spec plugin adding any), picked in Settings or asked for by the browser. Built and served as
// tests/title-page.spec.ts builds it, with its fake sources (tests/fake-fetch.ts) and every other request refused.

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
// AniList answers Spec Late with its English and native titles, five seconds late
const LATE = 'ag:(anilist:900010,mal:900010)'

let dir: string
let server: Server
let origin: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-language-'))
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

test.beforeEach(async ({ context }) => {
  await context.route(url => !url.href.startsWith(origin), route => route.abort())
})

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// what the header says: the search field's placeholder, and every label of its field, links and buttons
const headerWords = (page: Page) => page.locator('header').evaluate(header => [...header.querySelectorAll('input, a, button')]
  .flatMap(element => ['placeholder', 'aria-label', 'title'].map(name => element.getAttribute(name)).filter((value): value is string => !!value)))

test('picking Français in Settings reloads the tab in French, and Automatic brings back the browser\'s English', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/settings#language`)
  const select = page.getByRole('combobox', { name: 'Language' })
  await expect(select).toHaveValue('')
  await expect(select.locator('option').first()).toHaveText('Automatic (English)')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const code = english()
  expect(englishIn(await headerWords(page), code).length, 'the control: the header reads English').toBeGreaterThan(2)

  const fr = catalogues().fr!
  const picked = Date.now()
  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), select.selectOption('fr')])
  // FKN answers nothing here, and the account's step would hold the reload its whole 8 s bound
  expect(Date.now() - picked, 'the reload waits two seconds for the account at most').toBeLessThan(8_000)
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.locator('header input')).toHaveAttribute('placeholder', fr['Search anime, shows, movies…']!)
  const words = await headerWords(page)
  expect(words).toContain(fr.Settings)
  expect(englishIn(words, code, fr)).toEqual([])
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('fr')
  await expect(page.getByRole('combobox', { name: fr.Language })).toHaveValue('fr')

  await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), page.getByRole('combobox', { name: fr.Language }).selectOption('')])
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('header input')).toHaveAttribute('placeholder', 'Search anime, shows, movies…')
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBeNull()
})

test('a browser asking for French gets stub in French with nothing picked, Automatic naming it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' })
  await context.route(url => !url.href.startsWith(origin), route => route.abort())
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/settings#language`)
    const fr = catalogues().fr!
    const select = page.getByRole('combobox', { name: fr.Language })
    await expect(select).toHaveValue('', { timeout: 30_000 })
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(select.locator('option').first()).toHaveText('Automatique (Français)')
    await expect(page.locator('header input')).toHaveAttribute('placeholder', fr['Search anime, shows, movies…']!)
  } finally {
    await context.close()
  }
})

const WATCH = '/watch/tmdb:93405-s1/tmdb:93405-s1e1/nf:81040344'

/** Each page's sideways scroll at `width`: home, a title, an episode's watch page and the three Settings categories. */
const pagesOverflow = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 844 })
  const overflow: Record<string, number> = {}
  const at = async (path: string, drawn: string) => {
    await page.goto(`${origin}${path}`)
    await expect(page.locator(drawn).first()).toBeVisible({ timeout: 45_000 })
    overflow[path] = await overflowX(page)
  }
  await at('/', '.theater .actions .play')
  await at('/title/ag:(anilist:1,mal:1)', '[data-themes] li')
  await at(`/title/${LATE}`, '.heading > .second')
  await at(WATCH, '.player-container.fix button')
  for (const section of ['sources', 'playback', 'language']) await at(`/settings#${section}`, `[data-section="${section}"]`)
  return overflow
}

for (const language of ['de', 'ja']) {
  test(`${language}: home, title, watch and settings scroll no sideways at 390 px`, async ({ page }) => {
    test.setTimeout(240_000)
    await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
    const overflow = await pagesOverflow(page, 390)
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    expect(overflow).toEqual(Object.fromEntries(Object.keys(overflow).map(path => [path, 0])))
    expect(Object.keys(overflow), 'the control: every page was drawn').toHaveLength(7)
    // the control: the same reading sees a page wider than the window
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'width: 2000px; height: 1px' })))
    expect(await overflowX(page)).toBeGreaterThan(0)

    // a label too long for its line wraps between words, never inside one, and a button keeps clear of the window's edges
    await page.goto(`${origin}${WATCH}`)
    const label = page.locator('.episode-step.next .step-label')
    await expect(label).toBeVisible({ timeout: 45_000 })
    const { lines, words } = await label.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return {
        lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size,
        words: element.textContent!.trim().split(/\s+/).length,
      }
    })
    expect(lines, 'Next episode wraps at most once per space').toBeLessThanOrEqual(words)
    const button = (await page.locator('.player-container.fix button').boundingBox())!
    expect(button.x).toBeGreaterThanOrEqual(16)
    expect(390 - button.x - button.width).toBeGreaterThanOrEqual(16)
  })
}

test('the tracking status select holds Add to list and every status, in every offered language', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}${WATCH}`)
  const select = page.locator('select[name$="-status"]').first()
  await expect(select).toBeVisible({ timeout: 45_000 })
  const ids = ['Add to list', ...['Watching', 'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped'].map(status => `${status}#list status`)]
  const texts = Object.entries(catalogues()).flatMap(([language, catalogue]) => ids.map(id => ({ language, text: catalogue[id]! })))
  // the control: a text longer than English's longest is found
  texts.push({ language: 'en', text: 'Plan to watch, then more' })
  // each text alone in a copy of the select sized to it, beside the select it would be shown in
  const wider = await select.evaluate((select: HTMLSelectElement, texts) => texts.filter(({ language, text }) => {
    const sized = select.cloneNode(false) as HTMLSelectElement
    sized.style.width = 'auto'
    sized.lang = language
    sized.append(new Option(text))
    select.after(sized)
    const over = sized.getBoundingClientRect().width > select.getBoundingClientRect().width
    sized.remove()
    return over
  }).map(({ language, text }) => `${language}: ${text}`), texts)
  expect(wider).toEqual(['en: Plan to watch, then more'])
})

test('the font stack ends in the system\'s own sans-serif, and a native title carries its own lang', async ({ page }) => {
  await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, 'zh-Hans'])
  await page.goto(`${origin}/title/${LATE}`)
  const second = page.locator('.heading > .second')
  await expect(second).toHaveText('スペック・レイト', { timeout: 45_000 })
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
  await expect(second).toHaveAttribute('lang', 'ja')
  await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'en')
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toBe('Montserrat, system-ui, sans-serif')
})
