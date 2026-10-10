import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'

// The settings page as anime.fkn.app serves it: the app build, every path that is not a file answered
// with index.html as Pages does, and every request that leaves this origin refused, so nothing reaches
// FKN or any site. That is also why a sign out only shows its half on this device (the cookie half is
// FKN's, pinned in tests/unit).

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
  dir = mkdtempSync(join(tmpdir(), 'stub-settings-'))
  execFileSync(join(ROOT, 'node_modules', '.bin', 'vp'), ['build', '--config', 'vite.config.ts', '--outDir', dir], { cwd: ROOT, stdio: 'pipe' })

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

const CATEGORIES = ['Accounts', 'Sources']
const HOUR = 3_600_000

// what stub keeps in this browser, the API keys an older stub kept, and one key that belongs to nobody
const SEED = {
  'stub.apikeys': JSON.stringify({ omdb: 'a-key-for-the-spec' }),
  'stub-enabled-plugins': JSON.stringify(['npm:@banou/spec-example']),
  'stub.sessions': JSON.stringify(['anilist', 'mal']),
  'stub.site-status': JSON.stringify({ crunchyroll: { state: 'signed-in', checkedAt: Date.now() - 2 * HOUR } }),
  'not-stub': 'kept',
}

const readLocal = (page: Page): Promise<Record<string, string>> => page.evaluate(() =>
  Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map(key => [key, localStorage.getItem(key)!])))

/** Loads a page of the app, writes what stub keeps, and opens the settings page on it. */
const seeded = async (page: Page, path = '/settings') => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(seed => { for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value) }, SEED)
  await page.goto(`${origin}${path}`)
  await expect(panel(page)).toBeVisible()
}

const categories = (page: Page) => page.getByRole('navigation', { name: 'Settings categories' })
const panel = (page: Page) => page.locator('[data-section]')
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const headerBottom = (page: Page) => page.locator('header').first().evaluate(header => header.getBoundingClientRect().bottom)

test('the page lists two categories and shows Accounts alone, without the FKN row, keys, Data, Tracking or Playback', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(categories(page).getByRole('link')).toHaveText(CATEGORIES)
  for (const title of CATEGORIES) await expect(categories(page).getByRole('link', { name: title })).toHaveAttribute('href', `#${title.toLowerCase()}`)
  await expect(panel(page)).toHaveCount(1)
  await expect(panel(page)).toHaveAttribute('data-section', 'accounts')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Accounts')
  await expect(page.locator('[data-account]'), 'the header shows the FKN account, so this page does not').toHaveCount(4)
  await expect(page.locator('[data-account="fkn"]')).toHaveCount(0)
  await expect(page.locator('[data-account="crunchyroll"]')).toContainText('every fkn.app app')
  await expect(page.locator('input[type="password"]'), 'no key form').toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^(Data|Tracking|Playback|Built in)$/ })).toHaveCount(0)
  await expect(page.locator('[data-stored]')).toHaveCount(0)
})

/** Clicks a category, and checks it alone is shown, marked, below the header, with the page still at the top. */
const picks = async (page: Page, title: string) => {
  await categories(page).getByRole('link', { name: title }).click()
  // plugin-url.ts writes the added sources into the query, which the fragment follows
  await expect(page).toHaveURL(new RegExp(`/settings(\\?[^#]*)?#${title.toLowerCase()}$`))
  await expect(categories(page).locator('a[aria-current="true"]'), 'the list marks the category it shows, and only it').toHaveText([title])
  await expect(panel(page)).toHaveCount(1)
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(title)
  expect(await scrollY(page), 'the page stays at the top').toBe(0)
  expect((await panel(page).boundingBox())!.y).toBeGreaterThanOrEqual(await headerBottom(page))
}

test('clicking Sources shows Sources and hides Accounts, and back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await seeded(page)
  await picks(page, 'Sources')
  await expect(page.locator('[data-account]'), 'Accounts is hidden').toHaveCount(0)
  await expect(page.locator('[data-plugin]'), 'the seeded source is listed').toHaveCount(1)
  await picks(page, 'Accounts')
  await expect(page.locator('[data-account="anilist"]')).toBeVisible()
  await expect(page.locator('[data-plugin]')).toHaveCount(0)
  await page.goBack()
  await expect(panel(page), 'back returns to the category before').toHaveAttribute('data-section', 'sources')
})

test('a keyboard reaches the categories and switches between them', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await categories(page).getByRole('link', { name: 'Accounts' }).focus()
  await page.keyboard.press('Tab')
  await expect(categories(page).getByRole('link', { name: 'Sources' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  await expect(categories(page).getByRole('link', { name: 'Sources' })).toHaveAttribute('aria-current', 'true')
})

test('a link or a reload on #sources lands on Sources, and a category that is gone lands on Accounts', async ({ page }) => {
  await page.goto(`${origin}/settings#sources`)
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  await page.reload()
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  for (const gone of ['data', 'tracking', 'playback']) {
    await page.goto(`${origin}/legal`)
    await page.goto(`${origin}/settings#${gone}`)
    await expect(panel(page), gone).toHaveAttribute('data-section', 'accounts')
    await expect(categories(page).locator('a[aria-current="true"]')).toHaveText(['Accounts'])
  }
})

test('on a phone the categories are a row above the panel, the page stays at the top, and never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seeded(page, '/settings#accounts')
  const nav = await categories(page).boundingBox()
  expect(nav!.y + nav!.height).toBeLessThanOrEqual((await panel(page).boundingBox())!.y)
  for (const link of await categories(page).getByRole('link').all()) await expect(link).toBeInViewport()
  expect(await scrollY(page), 'a load on a category does not scroll to it').toBe(0)
  for (const title of ['Sources', 'Accounts']) {
    await picks(page, title)
    expect(await overflowX(page), title).toBeLessThanOrEqual(0)
  }
})

test('the API keys an older stub kept leave this browser on the next load, and nothing else does', async ({ page }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(seed => { for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value) }, SEED)
  expect((await readLocal(page))['stub.apikeys'], 'seeded').toBe(SEED['stub.apikeys'])

  await page.goto(`${origin}/settings`)
  await expect(panel(page)).toBeVisible()
  const local = await readLocal(page)
  expect(local['stub.apikeys'], 'gone').toBeUndefined()
  expect(local).toMatchObject(Object.fromEntries(Object.entries(SEED).filter(([key]) => key !== 'stub.apikeys')))
})

test('a confirmation opens on Cancel, Cancel gives focus back to its button, and a confirm leaves it on the row', async ({ page }) => {
  await seeded(page)
  const row = page.locator('[data-account="anilist"]')
  const signOut = row.getByRole('button', { name: 'Sign out of AniList', exact: true })
  await signOut.focus()
  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused()

  // so Enter, Enter is a Cancel, never a sign out
  await page.keyboard.press('Enter')
  await expect(signOut).toBeFocused()
  expect(JSON.parse((await readLocal(page))['stub.sessions']!)).toContain('anilist')

  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(row.getByRole('button', { name: 'Yes, sign out' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(row).toContainText('Not connected')
  expect(JSON.parse((await readLocal(page))['stub.sessions']!)).not.toContain('anilist')
  await expect(row.getByRole('heading', { name: 'AniList' }), 'the Sign out is gone, so focus goes to its row').toBeFocused()
})

test('signing out of AniList and MyAnimeList disconnects each on this device, one at a time', async ({ page }) => {
  await seeded(page, '/settings#accounts')
  for (const [site, title, left] of [['anilist', 'AniList', ['mal']], ['mal', 'MyAnimeList', []]] as const) {
    const row = page.locator(`[data-account="${site}"]`)
    await expect(row).toContainText('Connected on this device')
    await row.getByRole('button', { name: `Sign out of ${title}`, exact: true }).click()
    expect(JSON.parse((await readLocal(page))['stub.sessions']!), 'the first click only asks').toContain(site)
    await row.getByRole('button', { name: 'Yes, sign out' }).click()
    await expect(row).toContainText('Not connected')
    expect(JSON.parse((await readLocal(page))['stub.sessions']!)).toEqual(left)
    await expect(row.getByRole('heading', { name: title }), 'focus stays on the row, whose button is gone').toBeFocused()
  }
  await page.reload()
  await expect(page.locator('[data-account="anilist"]')).toContainText('Not connected')
  await expect(page.locator('[data-account="anilist"]').getByRole('button', { name: 'Sign in' })).toBeVisible()
})

const chip = (page: Page, site: string) => page.locator(`[data-account="${site}"] .head .state`)

test('Accounts shows what stub last learned of each sign-in and how long ago, asking no site to show it', async ({ page }) => {
  const asked: string[] = []
  page.on('request', request => { if (/crunchyroll\.com|anilist\.co|myanimelist\.net/.test(new URL(request.url()).hostname)) asked.push(request.url()) })
  await page.goto(`${origin}/legal`)
  await page.evaluate(day => {
    localStorage.setItem('stub.sessions', JSON.stringify(['anilist', 'mal']))
    localStorage.setItem('stub.site-status', JSON.stringify({
      crunchyroll: { state: 'signed-in', checkedAt: Date.now() - 2 * 3_600_000 },
      anilist: { state: 'signed-out', checkedAt: Date.now() - day },
    }))
  }, 26 * HOUR)
  await page.goto(`${origin}/settings#accounts`)

  await expect(chip(page, 'crunchyroll')).toHaveText('Signed in, checked 2 hours ago')
  await expect(chip(page, 'anilist')).toHaveText('Signed out, checked 1 day ago')
  await expect(chip(page, 'mal'), 'connected, and nothing learned yet').toHaveText('Connected on this device')
  for (const [site, name] of [['crunchyroll', 'Crunchyroll'], ['anilist', 'AniList'], ['mal', 'MyAnimeList']]) {
    await expect(page.locator(`[data-account="${site}"]`).getByRole('button', { name: `Check whether you are signed in to ${name}` }), site).toBeVisible()
  }
  await page.waitForTimeout(1_000)
  expect(asked, 'showing a state asks no site').toEqual([])
})

test('a site with nothing remembered says so, and a tracking site not connected here offers no Check now', async ({ page }) => {
  await page.goto(`${origin}/settings#accounts`)

  await expect(chip(page, 'crunchyroll')).toHaveText('Not checked yet')
  await expect(page.locator('[data-account="crunchyroll"]').getByRole('button', { name: 'Check whether you are signed in to Crunchyroll' })).toBeVisible()
  await expect(chip(page, 'anilist')).toHaveText('Not connected')
  await expect(page.locator('[data-account="anilist"]').getByRole('button', { name: /Check whether/ })).toHaveCount(0)
})

test('the privacy page says what stub keeps, and its link to Sources opens that category', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/privacy`)
  const body = page.locator('body')
  for (const title of ['Added sources', 'Search layout', 'Party name', "Stub's list"]) await expect(body).toContainText(title)
  await expect(body).not.toContainText('API key')
  await expect(body).not.toContainText('Everything else stub holds is cleared when you close or refresh the tab')
  await expect(body).not.toContainText('under Data')
  await page.getByRole('link', { name: 'Settings, under Sources' }).click()
  await expect(page).toHaveURL(/\/settings#sources$/)
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  expect(await scrollY(page)).toBe(0)
})
