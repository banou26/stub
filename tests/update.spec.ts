import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect as baseExpect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import config from '../playwright.config'
import { layer } from '../src/layers'
import { catalogues, english, englishIn, LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'
import { workerFakes } from './worker-fakes'

// Stub's own update, end to end: the real app, built as tests/sites.spec.ts builds it (with
// tests/party-grid-party.ts in place of the party module, so a party starts without FKN), served the
// way Pages serves it (`max-age=0, must-revalidate`, etags and 304s, any missing path answering the
// app's html). A deploy is the server's `/` naming a renamed stylesheet and a marker, which is how a
// page tells one build from the next. Every catalogue and the pseudo-language are offered (tests/languages.ts), and a
// browser in English gets English.

const expect = baseExpect.configure({ timeout: 30_000 })
// every request that leaves the server is refused by name, since a route would turn the browser's
// HTTP cache off and the reload is meant to be served from it. `use` replaces the config's args, so
// they are spread back in, the mute with them.
const launchOptions = config.use?.launchOptions
test.use({ launchOptions: { ...launchOptions, args: [...launchOptions?.args ?? [], '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1'] } })
test.describe.configure({ timeout: 180_000 })

const ROOT = join(import.meta.dirname, '..')
const CACHE = 'public, max-age=0, must-revalidate'
const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}

let dir: string
let server: Server
let port: string
let index: string
let stylesheet: string
/** The build `/` serves, 0 being the one built. */
let deployed = 0
/** The html of the same code built at another commit, which `/` serves as build SAME_CODE. */
let sameCode: string
const SAME_CODE = -1
let asked: { path: string, dest?: string, status: number }[] = []

/** Build `n`: the built html, its stylesheet renamed and its number in a meta tag. */
const html = (n: number) => {
  if (n === SAME_CODE) return sameCode
  const page = index.replace('<head>', `<head><meta name="stub-build" content="${n}">`)
  return n === 0 ? page : page.replace(stylesheet, renamed(n))
}
const renamed = (n: number) => stylesheet.replace(/\.css$/, `.v${n}.css`)

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-update-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  const party = join(ROOT, 'src', 'party', 'index.ts')
  const built = async (commit: string, outDir: string) => {
    process.env.CF_PAGES_COMMIT_SHA = commit
    await build({
      configFile: join(ROOT, 'vite.config.ts'),
      root: ROOT,
      logLevel: 'error',
      worker: { plugins: workerFakes },
      build: { outDir, emptyOutDir: true },
      plugins: [offerEveryLanguage(), {
        name: 'spec-fakes',
        enforce: 'pre',
        resolveId: (source, importer) => {
          const path = importer && resolve(dirname(importer), source)
          return path === plugins ? join(ROOT, 'tests', 'fake-plugins.ts')
            : path === fetch ? join(ROOT, 'tests', 'fake-fetch.ts')
            : undefined
        },
        load: id => id === party ? `export * from ${JSON.stringify(join(ROOT, 'tests', 'party-grid-party.ts'))}` : undefined,
      }],
    })
    return readFileSync(join(outDir, 'index.html'), 'utf8')
  }
  const commit = process.env.CF_PAGES_COMMIT_SHA
  try {
    sameCode = await built('bbbbbbb000', join(dir, 'same-code'))
    index = await built('aaaaaaa000', dir)
  } finally {
    if (commit === undefined) delete process.env.CF_PAGES_COMMIT_SHA
    else process.env.CF_PAGES_COMMIT_SHA = commit
  }
  stylesheet = index.match(/\/assets\/main-[\w-]{8}\.css/)![0]

  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://app').pathname)
    const file = join(dir, path.replace(/\.v\d+\.css$/, '.css'))
    const isFile = path !== '/index.html' && !relative(dir, file).startsWith('..') && existsSync(file) && statSync(file).isFile()
    const body = isFile ? readFileSync(file) : Buffer.from(html(deployed))
    const etag = `"${createHash('md5').update(body).digest('hex')}"`
    const status = request.headers['if-none-match'] === etag ? 304 : 200
    asked.push({ path, dest: request.headers['sec-fetch-dest'] as string | undefined, status })
    response.writeHead(status, {
      'cache-control': CACHE,
      etag,
      'content-type': isFile ? TYPES[extname(file)] ?? 'application/octet-stream' : 'text/html; charset=utf-8',
    })
    response.end(status === 304 ? undefined : body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = String((server.address() as AddressInfo).port)
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  deployed = 0
  asked = []
  // the page shows Updating Stub only for the moment before its reload, so it is recorded where the
  // next page can read it
  await page.addInitScript(() => {
    new MutationObserver(records => {
      for (const { addedNodes } of records) for (const node of addedNodes) {
        if (!(node instanceof HTMLElement) || node.textContent !== 'Updating Stub') continue
        const { width, height } = node.getBoundingClientRect()
        sessionStorage.setItem('spec-updating', JSON.stringify({
          from: document.querySelector('meta[name="stub-build"]')?.getAttribute('content'),
          covers: width === document.documentElement.clientWidth && height === document.documentElement.clientHeight
            && document.elementFromPoint(width / 2, height / 2) === node,
        }))
      }
    }).observe(document, { childList: true, subtree: true })
  })
})

const at = (host: string, path = '/') => `http://${host}:${port}${path}`
const marker = (page: Page) => page.locator('meta[name="stub-build"]')
const loads = () => asked.filter(({ dest }) => dest === 'document').length
const updating = async (page: Page) => JSON.parse(await page.evaluate(() => sessionStorage.getItem('spec-updating')) ?? 'null')
/** What the page does when its tab comes back into view: checks for a deploy. */
const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
/** Waits until the page has downloaded build `n`'s new stylesheet, the last step of a check that found it. */
const downloaded = (n: number) => expect.poll(() => asked.some(({ path, dest }) => path === renamed(n) && dest === 'empty')).toBe(true)
/** No reload, a few seconds after the check found the build. */
const holds = async (page: Page, n: number) => {
  await downloaded(n)
  const before = loads()
  await page.waitForTimeout(3_000)
  expect(loads()).toBe(before)
  expect(await updating(page)).toBeNull()
}
/** Reloaded onto build `n` behind Updating Stub, from the build before. */
const reloadedOnto = async (page: Page, n: number, from: number) => {
  await expect(marker(page)).toHaveAttribute('content', String(n))
  await expect(page.locator('#stub-root')).toBeAttached()
  expect(await updating(page)).toEqual({ from: String(from), covers: true })
  await page.evaluate(() => sessionStorage.removeItem('spec-updating'))
}

/** Opens build 0 at `path`, once the app's modules ran (its root is the last thing they make). */
const open = async (page: Page, path = '/', host = 'anime.localhost') => {
  await page.goto(at(host, path))
  await expect(marker(page)).toHaveAttribute('content', '0')
  await expect(page.locator('#stub-root')).toBeAttached()
}

test('a page left open finds the new build, shows Updating Stub over everything and reloads onto it, warm', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Watch party' })).toBeVisible()
  deployed = 1
  await look(page)
  await reloadedOnto(page, 1, 0)
  expect(loads()).toBe(2)
  const reload = asked.findLastIndex(({ dest }) => dest === 'document')
  const before = asked.slice(0, reload)
  const after = asked.slice(reload)
  expect(before.filter(({ path }) => path === renamed(1)), 'downloaded before the reload').toEqual([{ path: renamed(1), dest: 'empty', status: 200 }])
  expect(after.filter(({ path }) => path === renamed(1)), 'and revalidated by it').toEqual([{ path: renamed(1), dest: 'style', status: 304 }])
})

const commitOf = (page: string) => page.match(/name="stub-commit" content="(\w+)"/)?.[1]
const namesOf = (page: string) => [...page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(([, name]) => name)

test('a deploy of the same code at another commit is not a new build, and the footer names the commit its page carries', async ({ page }) => {
  expect(namesOf(sameCode)).toEqual(namesOf(index))
  expect([commitOf(index), commitOf(sameCode)], 'the control: two commits').toEqual(['aaaaaaa', 'bbbbbbb'])
  await open(page)
  await expect(page.locator('footer')).toContainText('aaaaaaa')
  deployed = SAME_CODE
  asked = []
  await look(page)
  await expect.poll(() => asked.some(({ path, dest }) => path === '/' && dest === 'empty'), 'the check ran').toBe(true)
  await page.waitForTimeout(3_000)
  expect(loads()).toBe(0)
  await page.reload()
  await expect(page.locator('footer')).toContainText('bbbbbbb')
})

test('a link a lazy chunk adds to the head is not a new build', async ({ page }) => {
  await open(page)
  // what Vite's preload helper appends as a lazy chunk loads
  await page.evaluate(() => {
    for (const [rel, href] of [['modulepreload', '/assets/theme-player-DxwoSNuJ.js'], ['stylesheet', '/assets/theme-player-B1x2y3z4.css']]) {
      document.head.append(Object.assign(document.createElement('link'), { rel, href }))
    }
  })
  asked = []
  await look(page)
  await expect.poll(() => asked.some(({ path, dest }) => path === '/' && dest === 'empty'), 'the check ran').toBe(true)
  await page.waitForTimeout(3_000)
  expect(loads()).toBe(0)
  expect(await updating(page)).toBeNull()
})

test('an update waits while the page is on /watch, and goes once it leaves', async ({ page }) => {
  await open(page, '/watch/anilist-154587/1')
  deployed = 1
  await look(page)
  await holds(page, 1)
  await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')) })
  await reloadedOnto(page, 1, 0)
})

test('an update waits for a party to end', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Watch party' }).click()
  await expect(page.getByRole('button', { name: /Hosting/ })).toBeVisible()
  deployed = 1
  await look(page)
  await holds(page, 1)
  await page.getByRole('button', { name: /Hosting/ }).click()
  await page.getByRole('button', { name: 'End party' }).click()
  await reloadedOnto(page, 1, 0)
})

test('an update waits while a search is being typed, and goes once the field blurs', async ({ page }) => {
  await open(page)
  const search = page.locator('header').getByRole('textbox', { name: 'Search' })
  await search.click()
  await search.pressSequentially('frie')
  deployed = 1
  await look(page)
  await holds(page, 1)
  await search.blur()
  await reloadedOnto(page, 1, 0)
})

test('a third update within five minutes waits, showing nothing', async ({ page }) => {
  await open(page)
  for (const n of [1, 2]) {
    deployed = n
    await look(page)
    await reloadedOnto(page, n, n - 1)
  }
  deployed = 3
  await look(page)
  await holds(page, 3)
  await expect(marker(page)).toHaveAttribute('content', '2')
})

test('a page off stub\'s own hosts, as in an FKN tenant, never checks', async ({ page }) => {
  await open(page, '/', '127.0.0.1')
  deployed = 1
  asked = []
  await look(page)
  await page.waitForTimeout(3_000)
  expect(asked.filter(({ path }) => path === '/' || path === renamed(1))).toEqual([])
})

// HOR-1026 (stub in the viewer's language)
test.describe('Updating Stub in German, Japanese and the pseudo-language', () => {
  for (const language of [PSEUDO, 'de', 'ja']) {
    test(`${language}: reads in that language and fits the screen at 1440 and 390 px`, async ({ page }) => {
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
      await page.addInitScript(zIndex => {
        new MutationObserver(records => {
          for (const { addedNodes } of records) for (const node of addedNodes) {
            if (!(node instanceof HTMLElement) || node.style.zIndex !== String(zIndex)) continue
            const html = document.documentElement
            sessionStorage.setItem('spec-updating-text', JSON.stringify({
              text: node.textContent,
              fits: node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().width === html.clientWidth,
            }))
          }
        }).observe(document, { childList: true, subtree: true })
      }, layer.updating)
      const translated = language === PSEUDO ? undefined : catalogues()[language]
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        deployed = 0
        await open(page)
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        deployed = 1
        await look(page)
        await expect(marker(page)).toHaveAttribute('content', '1')
        const shown = JSON.parse(await page.evaluate(() => sessionStorage.getItem('spec-updating-text')) ?? 'null') as { text: string, fits: boolean } | null
        expect(shown?.text, `${width} px: the control, the page was drawn`).toBeTruthy()
        expect(shown?.fits, `${width} px`).toBe(true)
        expect(englishIn([shown!.text], english(), translated), `${width} px`).toEqual([])
        await page.evaluate(() => sessionStorage.removeItem('spec-updating-text'))
      }
    })
  }
})
