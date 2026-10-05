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
// FKN or any site. That is also why the FKN account reads as signed out here, and why a sign out only
// shows its half on this device (the cookie half is FKN's, pinned in tests/unit).

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

const SECTIONS = ['Accounts', 'Sources', 'Tracking', 'Playback', 'Data']

// every key stub writes, and one that belongs to nobody, plus a file beside stub's list
const SEED = {
  local: {
    'stub.apikeys': JSON.stringify({ omdb: 'a-key-for-the-spec' }),
    'stub-enabled-plugins': JSON.stringify(['npm:@banou/spec-example']),
    'stub-search-display-mode': 'list',
    'stub.tracking.compact': JSON.stringify({ advanced: true, targets: { mal: false } }),
    'stub.sessions': JSON.stringify(['anilist', 'mal']),
    'not-stub': 'kept',
  },
  session: {
    'stub-party-name': 'Spec',
    'not-stub-either': 'kept',
  },
}
const MARKER = 'spec-marker.txt'

type Stores = { local: Record<string, string>, session: Record<string, string>, marker: string | null }

const readStores = (page: Page): Promise<Stores> => page.evaluate(async marker => {
  const all = (storage: Storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).map(key => [key, storage.getItem(key)!]))
  let text: string | null = null
  try {
    const root = await navigator.storage.getDirectory()
    const tracking = await (await root.getDirectoryHandle('tracking')).getDirectoryHandle('v1')
    text = await (await (await tracking.getFileHandle(marker)).getFile()).text()
  } catch {}
  return { local: all(localStorage), session: all(sessionStorage), marker: text }
}, MARKER)

/** Loads a page of the app, writes every store, and opens the settings page on them. */
const seeded = async (page: Page, path = '/settings') => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(async ({ seed, marker }) => {
    for (const [key, value] of Object.entries(seed.local)) localStorage.setItem(key, value)
    for (const [key, value] of Object.entries(seed.session)) sessionStorage.setItem(key, value)
    const root = await navigator.storage.getDirectory()
    const tracking = await (await root.getDirectoryHandle('tracking', { create: true })).getDirectoryHandle('v1', { create: true })
    const writable = await (await tracking.getFileHandle(marker, { create: true })).createWritable()
    await writable.write('the list is not the settings page\'s to clear')
    await writable.close()
  }, { seed: SEED, marker: MARKER })
  await page.goto(`${origin}${path}`)
  await expect(page.locator('section#data')).toBeVisible()
}

const index = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' })

test('every section renders, in order, under an index that names each one', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.locator('section[id] > h2')).toHaveText(SECTIONS)
  await expect(index(page).getByRole('link')).toHaveText(SECTIONS)
  for (const title of SECTIONS) await expect(index(page).getByRole('link', { name: title })).toHaveAttribute('href', `#${title.toLowerCase()}`)
  // with no FKN reachable the account reads as not connected once the read gives up
  await expect(page.locator('[data-account="fkn"]')).toContainText('Not connected', { timeout: 10_000 })
  await expect(page.locator('[data-account="crunchyroll"]')).toContainText('every fkn.app app')
  await expect(page.locator('section#sources')).toContainText('Crunchyroll')
  await expect(page.locator('section#sources')).toContainText('OMDb')
  await expect(page.locator('section#sources h3'), 'its parts are headings, under the section\'s own').toHaveText(['Built in', 'Your keys', 'Added'])
  await expect(page.locator('section#playback')).toContainText('does not remember')
  for (const id of ['api-keys', 'added-sources', 'search-layout', 'quick-tracking', 'connected-sites', 'party-name', 'party-invite', 'stub-list', 'site-sign-ins', 'fkn-account', 'player', 'fetched']) {
    await expect(page.locator(`[data-stored="${id}"]`), id).toBeVisible()
  }
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
  await jumpsTo(page, 'Data', 'data')
  await jumpsTo(page, 'Accounts', 'accounts')
})

test('a link to a section opens the page at it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/settings#data`)
  await expect(page.locator('section#data > h2')).toBeInViewport()
  await expect(page.locator('section#accounts > h2')).not.toBeInViewport()
})

// each Clear is named for its row, since the page holds five of them
const CLEARED: Record<string, { store: 'local' | 'session', key: string, after: string | undefined, name: string }> = {
  'api-keys': { store: 'local', key: 'stub.apikeys', after: undefined, name: 'Clear API keys' },
  // the plugin list writes the list it has left, which is none
  'added-sources': { store: 'local', key: 'stub-enabled-plugins', after: '[]', name: 'Clear added sources' },
  'search-layout': { store: 'local', key: 'stub-search-display-mode', after: undefined, name: 'Clear search layout' },
  'quick-tracking': { store: 'local', key: 'stub.tracking.compact', after: undefined, name: 'Clear quick tracking choices' },
  'party-name': { store: 'session', key: 'stub-party-name', after: undefined, name: 'Clear party name' },
}

for (const [id, { store, key, after, name }] of Object.entries(CLEARED)) {
  test(`Clear on ${id} clears that store, after asking, and nothing else`, async ({ page }) => {
    await seeded(page)
    const row = page.locator(`[data-stored="${id}"]`)
    const before = await readStores(page)
    expect(before[store][key], 'seeded').toBe((SEED[store] as Record<string, string>)[key])
    const added = page.locator('section#sources .row.plugin')
    if (id === 'added-sources') await expect(added, 'the seeded source is listed under Sources').toHaveCount(1)

    await row.getByRole('button', { name, exact: true }).click()
    expect((await readStores(page))[store][key], 'the first click only asks').toBe(before[store][key])
    await row.getByRole('button', { name: 'Yes, clear' }).click()
    await expect(row).toContainText('Nothing kept')
    // FKN never answers here, so this is the list moving without waiting on the uninstall
    if (id === 'added-sources') await expect(added, 'and leaves the Sources list on the same page').toHaveCount(0)

    const now = await readStores(page)
    const expected = { ...before, [store]: { ...before[store] } }
    if (after === undefined) delete expected[store][key]
    else expected[store][key] = after
    expect(now).toEqual(expected)
    expect(now.marker, "stub's list is untouched").toBe(before.marker)

    // and it stays cleared on the next load
    await page.reload()
    await expect(page.locator(`[data-stored="${id}"]`)).toContainText('Nothing kept')
  })
}

test('cleared keys leave the key fields empty', async ({ page }) => {
  await seeded(page)
  await expect(page.locator('input#omdb')).toHaveValue('a-key-for-the-spec')
  const row = page.locator('[data-stored="api-keys"]')
  await row.getByRole('button', { name: 'Clear API keys', exact: true }).click()
  await row.getByRole('button', { name: 'Yes, clear' }).click()
  await expect(page.locator('input#omdb')).toHaveValue('')
})

test('a confirmation opens on Cancel, Cancel gives focus back to its button, and a confirm leaves it on the row', async ({ page }) => {
  await seeded(page)
  const row = page.locator('[data-stored="search-layout"]')
  const clear = row.getByRole('button', { name: 'Clear search layout', exact: true })
  await clear.focus()
  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused()

  // so Enter, Enter is a Cancel, never a clear
  await page.keyboard.press('Enter')
  await expect(clear).toBeFocused()
  expect((await readStores(page)).local['stub-search-display-mode']).toBe('list')

  await page.keyboard.press('Enter')
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(row.getByRole('button', { name: 'Yes, clear' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(row).toContainText('Nothing kept')
  expect((await readStores(page)).local['stub-search-display-mode']).toBeUndefined()
  await expect(row.getByRole('heading', { name: 'Search layout' }), 'the Clear is gone, so focus goes to its row').toBeFocused()
})

test('signing out of AniList and MyAnimeList disconnects each on this device, one at a time', async ({ page }) => {
  await seeded(page, '/settings#accounts')
  for (const [site, title, left] of [['anilist', 'AniList', ['mal']], ['mal', 'MyAnimeList', []]] as const) {
    const row = page.locator(`[data-account="${site}"]`)
    await expect(row).toContainText('Connected on this device')
    await row.getByRole('button', { name: `Sign out of ${title}`, exact: true }).click()
    expect(JSON.parse((await readStores(page)).local['stub.sessions']!), 'the first click only asks').toContain(site)
    await row.getByRole('button', { name: 'Yes, sign out' }).click()
    await expect(row).toContainText('Not connected')
    expect(JSON.parse((await readStores(page)).local['stub.sessions']!)).toEqual(left)
    await expect(row.getByRole('heading', { name: title }), 'focus stays on the row, whose button is gone').toBeFocused()
  }
  await page.reload()
  await expect(page.locator('[data-account="anilist"]')).toContainText('Not connected')
  await expect(page.locator('[data-account="anilist"]').getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('the privacy page says what stub keeps, and links to where it is cleared', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/privacy`)
  const body = page.locator('body')
  for (const title of ['API keys', 'Added sources', 'Search layout', 'Party name', "Stub's list"]) await expect(body).toContainText(title)
  await expect(body).not.toContainText('Everything else stub holds is cleared when you close or refresh the tab')
  await page.getByRole('link', { name: 'Settings, under Data' }).click()
  await expect(page).toHaveURL(/\/settings#data$/)
  await expect(page.locator('section#data > h2')).toBeInViewport()
})
