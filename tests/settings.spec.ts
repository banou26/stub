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

const SECTIONS = ['Accounts', 'Sources', 'Tracking', 'Playback']
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
  await expect(page.locator('section#accounts')).toBeVisible()
}

const index = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' })

test('every section renders, in order, under an index that names each one', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.locator('section[id] > h2')).toHaveText(SECTIONS)
  await expect(index(page).getByRole('link')).toHaveText(SECTIONS)
  for (const title of SECTIONS) await expect(index(page).getByRole('link', { name: title })).toHaveAttribute('href', `#${title.toLowerCase()}`)
  await expect(page.locator('[data-account="fkn"]'), 'the header shows the FKN account').toHaveCount(0)
  await expect(page.locator('[data-account="crunchyroll"]')).toContainText('every fkn.app app')
  await expect(page.locator('section#sources [data-source]'), 'no list of the sources stub ships with').toHaveCount(0)
  await expect(page.locator('section#sources')).not.toContainText('Built in')
  await expect(page.locator('section#sources input[type="password"]'), 'no source asks for a key').toHaveCount(0)
  await expect(page.locator('section#playback')).toContainText('does not remember')
  await expect(page.locator('section#data'), 'no Data section').toHaveCount(0)
  await expect(page.locator('[data-stored]')).toHaveCount(0)
})

const headerBottom = (page: Page) => page.locator('header').first().evaluate(header => header.getBoundingClientRect().bottom)

const jumpsTo = async (page: Page, title: string, id: string) => {
  await index(page).getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(new RegExp(`#${id}$`))
  await expect(index(page).locator('a[aria-current="true"]'), 'the index marks the section it jumped to, and only it').toHaveText([title])
  const heading = page.locator(`section#${id} > h2`)
  await expect(heading).toBeInViewport()
  // below the fixed header, not under it
  await expect.poll(async () => (await heading.boundingBox())!.y - await headerBottom(page)).toBeGreaterThanOrEqual(0)
}

test('the index jumps to each section, landing it below the header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/settings`)
  for (const title of [...SECTIONS].reverse()) await jumpsTo(page, title, title.toLowerCase())
})

test('on a phone the index is a row above the sections, the page never scrolls sideways, and it jumps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/settings`)
  const nav = await index(page).boundingBox()
  const accounts = await page.locator('section#accounts').boundingBox()
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(accounts!.y)
  for (const link of await index(page).getByRole('link').all()) await expect(link).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await jumpsTo(page, 'Playback', 'playback')
  await jumpsTo(page, 'Accounts', 'accounts')
})

test('a link to a section opens the page at it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/settings#playback`)
  await expect(page.locator('section#playback > h2')).toBeInViewport()
  await expect(page.locator('section#accounts > h2')).not.toBeInViewport()
})

test('the API keys an older stub kept leave this browser on the next load, and nothing else does', async ({ page }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(seed => { for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value) }, SEED)
  expect((await readLocal(page))['stub.apikeys'], 'seeded').toBe(SEED['stub.apikeys'])

  await page.goto(`${origin}/settings`)
  await expect(page.locator('section#accounts')).toBeVisible()
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

test('the privacy page says what stub keeps', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/privacy`)
  const body = page.locator('body')
  for (const title of ['Added sources', 'Search layout', 'Party name', "Stub's list"]) await expect(body).toContainText(title)
  await expect(body).not.toContainText('API key')
  await expect(body).not.toContainText('Everything else stub holds is cleared when you close or refresh the tab')
})
