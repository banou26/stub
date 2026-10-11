import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

// The title page as anime.fkn.app serves it, built and served the way tests/settings.spec.ts does: every
// request that leaves this origin is refused, so the works are the season the bundled catalogue lists,
// AniList answers each of them with Cowboy Bebop's credits, AniZip with 26 episodes and Frieren's ids,
// and AnimeThemes with Frieren's themes, one without a video (tests/fake-fetch.ts).

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
let dir: string
let server: Server
let origin: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-title-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
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
})

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const modal = (page: Page) => page.locator('.modal')
const heading = (page: Page) => page.getByRole('heading', { level: 1 })

/** Opens the modal of the first work the home page lists, and returns its title once drawn. */
const openModal = async (page: Page) => {
  await page.goto(`${origin}/`)
  const card = page.locator('a[href^="/media/"]').first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await page.goto(`${origin}${await card.getAttribute('href')}`)
  const title = modal(page).locator('.header > span.title')
  await expect(title).toHaveText(/\S/, { timeout: 30_000 })
  return (await title.textContent())!
}

test('More details opens the page, and Back returns to the modal', async ({ page }) => {
  const title = await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  await expect(page).toHaveURL(/\/title\/ag:\(/)
  await expect(modal(page)).toHaveCount(0)
  await expect(heading(page)).toHaveText(title)
  await page.goBack()
  await expect(page).toHaveURL(/\/media\/ag:\(/)
  await expect(modal(page).locator('.header > span.title')).toHaveText(title)
})

test('390 px wide, the page stacks with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const title = await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  await expect(heading(page)).toHaveText(title)
  await expect(page.locator('.facts')).toBeVisible()
  expect(await overflowX(page)).toBe(0)
  // the control: the same check reads a page that is too wide
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'width: 500px; height: 1px' })))
  expect(await overflowX(page)).toBeGreaterThan(0)
})

test('Characters shows the Japanese cast, a picked dub swaps it, and 390 px wide has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const characters = page.locator('[data-characters]')
  await expect(characters).toBeVisible({ timeout: 30_000 })
  const spike = characters.locator('li').filter({ hasText: 'Spike Spiegel' })
  await expect(spike).toContainText('Kouichi Yamadera')
  await expect(spike).not.toContainText('Steven Blum')
  await characters.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'English' })
  await expect(spike).toContainText('Steven Blum')
  await expect(spike).not.toContainText('Kouichi Yamadera')
  await expect(page.locator('[data-staff]')).toContainText('Shinichirou Watanabe')
  await expect(page.locator('.facts')).toContainText('Sunrise')
  expect(await overflowX(page)).toBe(0)
  // a long character name leaves its actor half the card rather than a word per line
  const ed = characters.locator('li').filter({ hasText: 'Edward Wong Hau Pepelu Tivrusky IV' })
  const [name, actors] = await ed.evaluate(card => [...card.children].map(half => half.getBoundingClientRect().width))
  expect(Math.abs(name! - actors!)).toBeLessThan(1)
})

test('Themes lists each song, plays one at a time under its row, and 390 px wide has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const rows = page.locator('[data-themes] li')
  await expect(rows).toHaveText([/OP1.*Yuusha.*YOASOBI/, /OP2.*Haru.*Yorushika/, /ED1.*Anytime Anywhere.*milet/, /ED.*bliss.*milet/], { timeout: 30_000 })
  await expect(rows.nth(3).getByRole('button')).toHaveCount(0)
  const lefts = await rows.locator('.kind').evaluateAll(kinds => kinds.map(kind => kind.getBoundingClientRect().left))
  expect(new Set(lefts).size, `a song without a video keeps its label in line: ${lefts.join(', ')}`).toBe(1)
  // the credit AnimeThemes asks for is its link in the source row
  await expect(page.locator('.origins a[title="AnimeThemes"]')).toHaveAttribute('href', 'https://animethemes.moe/anime/sousou_no_frieren')
  const videos = page.locator('[data-themes] video')
  await expect(videos, 'nothing plays before a click').toHaveCount(0)
  const advances = () => expect.poll(() => videos.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0)

  await rows.nth(0).getByRole('button', { name: 'Play' }).click()
  await expect(rows.nth(0).locator('video')).toHaveAttribute('src', 'https://v.animethemes.moe/SousouNoFrieren-OP1.webm')
  await advances()
  await rows.nth(1).getByRole('button', { name: 'Play' }).click()
  await expect(videos).toHaveCount(1)
  await expect(rows.nth(1).locator('video')).toHaveAttribute('src', 'https://v.animethemes.moe/SousouNoFrieren-OP2.webm')
  await advances()
  expect(await videos.evaluate(video => (video as HTMLVideoElement).muted)).toBe(false)
  expect(await overflowX(page)).toBe(0)
  await rows.nth(1).getByRole('button', { name: 'Stop' }).click()
  await expect(videos).toHaveCount(0)
})

test('the source row links the TMDB, TheTVDB and IMDb ids AniZip names', async ({ page }) => {
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const origins = page.locator('.origins')
  await expect(origins.locator('a[title="TMDB"]')).toHaveAttribute('href', 'https://www.themoviedb.org/tv/209867', { timeout: 30_000 })
  await expect(origins.locator('a[title="TheTVDB"]')).toHaveAttribute('href', 'https://thetvdb.com/dereferrer/series/424536')
  await expect(origins.locator('a[title="IMDb"]')).toHaveAttribute('href', 'https://www.imdb.com/title/tt22248376')
})

test('Episodes draws the first 12, and Show all the rest', async ({ page }) => {
  await openModal(page)
  // the control: the modal draws every episode AniZip lists (tests/fake-fetch.ts)
  await expect(modal(page).locator('.episode')).toHaveCount(26, { timeout: 30_000 })
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const episodes = page.locator('[data-episodes]')
  await expect(episodes.locator('.episode')).toHaveCount(12, { timeout: 30_000 })
  await episodes.getByRole('button', { name: 'Show all' }).click()
  await expect(episodes.locator('.episode')).toHaveCount(26)
  await expect(episodes.getByRole('button', { name: 'Show all' })).toHaveCount(0)
})

test('the page\'s cover style stays on its own cover, off the relation cards\' covers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  await expect(heading(page)).toBeVisible()
  // the bundled catalogue has no relations, so a card's cover is placed where the Relations grid is
  const shadow = await page.locator('.main').evaluate(main => {
    const card = main.appendChild(Object.assign(document.createElement('a'), { className: 'relation-card' }))
    return getComputedStyle(card.appendChild(Object.assign(document.createElement('div'), { className: 'cover' }))).boxShadow
  })
  expect(shadow).toBe('none')
  // the control: the hero's cover does carry it
  expect(await page.locator('.body > .cover').evaluate(cover => getComputedStyle(cover).boxShadow)).not.toBe('none')
})

test('the modal opens with focus on its box, unringed, not on More details', async ({ page }) => {
  await openModal(page)
  const link = modal(page).getByRole('link', { name: 'More details' })
  await expect(link).toBeVisible()
  await expect(modal(page)).toBeFocused()
  expect(await link.evaluate(element => element === document.activeElement)).toBe(false)
  expect(await modal(page).evaluate(box => getComputedStyle(box).outlineStyle), 'and the box draws no ring').toBe('none')
})

test('a long title wraps beside the modal\'s links rather than pushing them under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openModal(page)
  const title = modal(page).locator('.header > span.title')
  await title.evaluate(element => { element.textContent = 'A Long Light Novel Title '.repeat(8) })
  const titleBox = (await title.boundingBox())!
  const linkBox = (await modal(page).getByRole('link', { name: 'More details' }).boundingBox())!
  expect(linkBox.y).toBeLessThan(titleBox.y + titleBox.height)
})
