import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { builtInSources } from '../src/sources/built-in'

// One build served under four names, as Pages serves stub.fkn.app, anime.fkn.app, movie.fkn.app and
// series.fkn.app: `*.localhost` stands in for fkn.app, and 127.0.0.1 is any other host, which shows
// everything. Built and served the way tests/title-page.spec.ts does, so JustWatch answers its four most
// popular films and shows (tests/fake-fetch.ts) and every request that leaves the server is refused.

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
let dir: string
let server: Server
let port: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-sites-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    build: { outDir: dir, emptyOutDir: true },
    plugins: [{
      name: 'spec-fakes',
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

const at = (host: string, path = '/') => `http://${host}:${port}${path}`
const row = (page: Page, title: string) => page.locator('.title', { hasText: new RegExp(`^${title}$`) })
const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const cards = (page: Page, title: string) => row(page, title).locator('xpath=..').locator('a[href^="/media/"]')
// a card is two links, its picture and its title
const titles = (page: Page, title: string) =>
  cards(page, title).evaluateAll(links => [...new Set(links.map(link => link.textContent?.trim()).filter(Boolean))])

test('anime.fkn.app lists the current season alone, with no category tabs', async ({ page }) => {
  await page.goto(at('anime.localhost'))
  await expect(row(page, 'Current season')).toBeVisible()
  await expect(page.locator('a[href^="/media/"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(row(page, 'Popular movies')).toHaveCount(0)
  await expect(row(page, 'Popular shows')).toHaveCount(0)
  await expect(tab(page, 'Movies')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search anime…')
})

test('movie.fkn.app lists JustWatch\'s popular films alone, with no category tabs', async ({ page }) => {
  await page.goto(at('movie.localhost'))
  await expect(row(page, 'Popular movies')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practical Magic' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(row(page, 'Current season')).toHaveCount(0)
  await expect(row(page, 'Popular shows')).toHaveCount(0)
  await expect(tab(page, 'Movies')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search movies…')
})

test('series.fkn.app lists JustWatch\'s popular shows, each a card of its own', async ({ page }) => {
  await page.goto(at('series.localhost'))
  await expect(row(page, 'Popular shows')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ted Lasso' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(row(page, 'Current season')).toHaveCount(0)
  await expect(row(page, 'Popular movies')).toHaveCount(0)
})

test('any other host lists all three rows under the category tabs, and a tab keeps its own row', async ({ page }) => {
  await page.goto(at('127.0.0.1'))
  for (const title of ['Current season', 'Popular movies', 'Popular shows']) await expect(row(page, title)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practical Magic' }).first()).toBeVisible({ timeout: 30_000 })
  await tab(page, 'Series').click()
  await expect(row(page, 'Popular shows')).toBeVisible()
  await expect(row(page, 'Popular movies')).toHaveCount(0)
})

test('movie.fkn.app\'s settings leave out the anime catalogues and their sign-ins', async ({ page }) => {
  const animeCatalogues = ['anilist', 'mal', 'kitsu', 'livechart', 'anizip', 'offline', 'cr']
  await page.goto(at('movie.localhost', '/settings#sources'))
  await expect(page.getByRole('switch')).toHaveCount(builtInSources.length - animeCatalogues.length)
  await expect(page.getByRole('switch', { name: 'AniList', exact: true })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'JustWatch', exact: true })).toBeVisible()
  await page.goto(at('movie.localhost', '/settings#accounts'))
  await expect(page.locator('[data-account="netflix"]')).toBeVisible()
  await expect(page.locator('[data-account="anilist"], [data-account="mal"], [data-account="crunchyroll"]')).toHaveCount(0)
})

test('search offers Category on stub alone, and Season and Format on anime and stub alone', async ({ page }) => {
  const filters = async (host: string) => {
    await page.goto(at(host, '/search'))
    await expect(page.locator('.filters .label').first()).toHaveText('Search')
    return page.locator('.filters .label').allTextContents()
  }
  expect(await filters('127.0.0.1')).toEqual(['Search', 'Genres & Tags', 'Year', 'Season', 'Format', 'Airing Status', 'Category'])
  expect(await filters('anime.localhost')).toEqual(['Search', 'Genres & Tags', 'Year', 'Season', 'Format', 'Airing Status'])
  expect(await filters('movie.localhost')).toEqual(['Search', 'Genres & Tags', 'Year'])
})

test('a Popular row draws nothing while JustWatch is off, rather than the store\'s films and shows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stub.sources.disabled', '["jw"]'))
  await page.goto(at('127.0.0.1'))
  await expect(cards(page, 'Current season').first(), 'the control: the season row fills from the other sources').toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(8_000)
  await expect(cards(page, 'Popular movies')).toHaveCount(0)
  await expect(cards(page, 'Popular shows')).toHaveCount(0)
})

test('a Popular row is JustWatch\'s answer in its order, also on the way back Home over a full store', async ({ page }) => {
  const films = ['Backrooms', 'Obsession', 'The End of Oak Street', 'Practical Magic']
  await page.goto(at('127.0.0.1'))
  await expect.poll(() => titles(page, 'Popular movies'), { timeout: 30_000 }).toEqual(films)
  await row(page, 'Current season').click()
  await expect(page).toHaveURL(/\/search\?/)
  await page.goBack()
  await expect(cards(page, 'Popular movies').first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(8_000)
  expect(await titles(page, 'Popular movies')).toEqual(films)
})

test('a title\'s address answers only on a site that keeps it', async ({ page }) => {
  const frieren = page.getByRole('heading', { level: 1, name: 'Frieren: Beyond Journey\'s End' })
  await page.goto(at('127.0.0.1', '/title/tmdb:209867-s1'))
  await expect(frieren, 'the control: stub keeps every title').toBeVisible({ timeout: 30_000 })
  await page.goto(at('series.localhost', '/title/tmdb:93405-s1'))
  await expect(page.getByRole('heading', { level: 1, name: 'Squid Game' }), 'and series keeps a live-action show').toBeVisible({ timeout: 30_000 })
  await page.goto(at('series.localhost', '/title/tmdb:209867-s1'))
  await page.waitForTimeout(8_000)
  await expect(frieren).toHaveCount(0)
})
