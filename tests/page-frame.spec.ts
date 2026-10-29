import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { catalogues, english, englishIn, LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'
import { workerFakes } from './worker-fakes'

// HOR-1026 (stub in the viewer's language): the text around a page's own, in German, Japanese and the
// pseudo-language. The app is built as tests/title-page.spec.ts builds it, with every catalogue and the pseudo-language
// offered (tests/languages.ts) and the legal page swapped for one that throws while it renders, so /legal draws the
// error page.
// Spec Sequel (anilist:900001) has a long description and lists of 14 (tests/fake-fetch.ts).

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
const SEQUEL = 'ag:(anilist:900001)'
const SCENE_CODE = 'eOOEIPhB0IQhB8IQg-TPYQg-D0IQ'
// trace.moe's three refusals, as its docs answer them (src/scene/search.ts)
const REFUSALS = [
  { status: 402, json: { error: 'Search quota depleted (quota per 24 hours: 100, used: 100)' } },
  { status: 503, json: { error: 'Search queue is full' } },
  { status: 400, json: { error: 'Failed to process image' } },
]

let dir: string
let server: Server
let origin: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-frame-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  const legal = join(ROOT, 'src', 'router', 'legal', 'index.tsx')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    worker: { plugins: workerFakes },
    build: { outDir: dir, emptyOutDir: true },
    plugins: [offerEveryLanguage(), {
      name: 'spec-fakes',
      enforce: 'pre',
      resolveId: (source, importer) => {
        const path = importer && resolve(dirname(importer), source)
        return path === plugins ? join(ROOT, 'tests', 'fake-plugins.ts')
          : path === fetch ? join(ROOT, 'tests', 'fake-fetch.ts')
          : undefined
      },
      // an error with no message, so the page says so in its own words
      load: id => id === legal ? 'export default () => { throw new Error() }' : undefined,
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

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route(url => !url.href.startsWith(origin), route => route.abort())
})

/**
 * The texts `text` draws and the labels `labels` carry, and each of `text` that runs past the viewport or spills
 * out of its own box, with the page if it scrolls sideways. `hidden` is read but not measured, being drawn 1 px wide
 * for a screen reader.
 */
const drawnNow = (page: Page, { text = [], labels = [], hidden = [] }: { text?: string[], labels?: string[], hidden?: string[] }) =>
  page.evaluate(({ text, labels, hidden }) => {
    const all = (selectors: string[]) => selectors.flatMap(selector => [...document.querySelectorAll(selector)])
    const words = [
      ...all([...text, ...hidden]).map(element => element.textContent!.trim()),
      ...all(labels).flatMap(element => ['aria-label', 'title'].map(name => element.getAttribute(name)).filter(value => value !== null)),
    ]
    const outside = all(text).flatMap(element => {
      const box = element.getBoundingClientRect()
      const spills = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
      return box.width && (spills || box.left < -0.5 || box.right > innerWidth + 0.5) ? [`${element.textContent!.trim()} runs past its box`] : []
    })
    const html = document.documentElement
    return { words, problems: html.scrollWidth > html.clientWidth + 1 ? [...outside, 'the page scrolls sideways'] : outside }
  }, { text, labels, hidden })

/** Draws the footer, Spec Sequel's lists and their pages, its modal's description, the not-found, sign-in and error pages and each scene refusal at `width`. */
const areaDrawn = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 })
  const words: string[] = []
  const problems: string[] = []
  const read = async (view: string, selectors: Parameters<typeof drawnNow>[1]) => {
    const now = await drawnNow(page, selectors)
    words.push(...now.words)
    problems.push(...now.problems.map(problem => `${view}: ${problem}`))
  }
  const lists = ['[data-characters]', '[data-staff]', '[data-themes]']

  await page.goto(`${origin}/title/${SEQUEL}`)
  for (const list of lists) await expect(page.locator(`${list} nav`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('footer')).toBeVisible()
  await read('the title page', { text: ['footer a'], labels: ['footer .version', ...lists.flatMap(list => [`${list} nav`, `${list} nav button`])] })
  for (const list of lists) await page.locator(`${list} nav button`).last().click()
  await read('a page picked', { hidden: lists.map(list => `${list} nav [role="status"]`) })

  await page.goto(`${origin}/media/${SEQUEL}`)
  const toggle = page.locator('.modal .toggle-button')
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  await read('the modal', { text: ['.modal .toggle-button'] })
  await toggle.click()
  await read('the modal, its description open', { text: ['.modal .toggle-button'] })

  for (const path of ['/nowhere', '/login/callback']) {
    await page.goto(`${origin}${path}`)
    await expect(page.locator('.content > div')).not.toBeEmpty()
    await read(path, { text: ['.content > div'] })
  }

  await page.goto(`${origin}/legal`)
  await expect(page.locator('.panel h2')).toBeVisible({ timeout: 30_000 })
  await read('the error page', { text: ['.panel h2', '.panel .message', '.panel button'] })
  const copy = page.locator('.panel button').last()
  const uncopied = (await copy.textContent())!
  await copy.click()
  await expect(copy).not.toHaveText(uncopied)
  await read('the error page, its details copied', { text: ['.panel button'] })

  for (const refusal of REFUSALS) {
    await page.unroute('https://api.trace.moe/**')
    await page.route('https://api.trace.moe/**', route => route.fulfill({ ...refusal, headers: { 'access-control-allow-origin': '*' } }))
    await page.goto(`${origin}/search?scene=${SCENE_CODE}`)
    await expect(page.locator('.status')).toBeVisible({ timeout: 30_000 })
    await read(`trace.moe answering ${refusal.status}`, { text: ['.status'] })
  }
  return { words, problems }
}

test.describe('in German, Japanese and the pseudo-language', () => {
  for (const language of [PSEUDO, 'de', 'ja']) {
    test(`${language}: the footer, paging, toggle, error and refusal lines fit at 1440 and 390 px, with none of their words in English`, async ({ page }) => {
      test.setTimeout(240_000)
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
      const code = english()
      const translated = language === PSEUDO ? undefined : catalogues()[language]
      for (const width of [1440, 390]) {
        const { words, problems } = await areaDrawn(page, width)
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        expect(problems, `${width} px`).toEqual([])
        expect(words.length, `${width} px: the control, the area's words were read`).toBeGreaterThan(30)
        expect(englishIn(words, code, translated), `${width} px`).toEqual([])
      }
    })
  }

  test('the control: in English the same reading finds the area\'s own words', async ({ page }) => {
    test.setTimeout(120_000)
    const { words } = await areaDrawn(page, 1440)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(englishIn(words, english()).length).toBeGreaterThan(25)
  })
})
