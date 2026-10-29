import type { AddressInfo } from 'node:net'
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import { builtInSources } from '../src/sources/built-in'
import { catalogues, english, englishIn, LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'

const ALL = builtInSources.length

// The settings page as anime.fkn.app serves it: the app build, every path that is not a file answered
// with index.html as Pages does, and every request that leaves this origin refused, so nothing reaches
// FKN or any site. That is also why a sign out only shows its half on this device (the cookie half is
// FKN's, pinned in tests/unit), and why the build swaps the plugin runtime for tests/fake-plugins.ts:
// a real install would wait on FKN forever. Every catalogue and the pseudo-language are offered (tests/languages.ts), so
// a test picks one by its setting, and a browser in English, as every other test's, gets English.

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
  const plugins = join(ROOT, 'src', 'plugins')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    build: { outDir: dir, emptyOutDir: true },
    plugins: [offerEveryLanguage(), {
      name: 'spec-fake-plugins',
      enforce: 'pre',
      resolveId: (source, importer) => importer && resolve(dirname(importer), source) === plugins ? join(ROOT, 'tests', 'fake-plugins.ts') : undefined,
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

const CATEGORIES = ['Sources', 'Playback']
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
const sourceSwitches = (page: Page) => page.getByRole('switch', { name: / source$/ })
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const headerBottom = (page: Page) => page.locator('header').first().evaluate(header => header.getBoundingClientRect().bottom)

// the owner, 2026-10-25 (HOR-1019): "I think we can completely remove that Accounts category and also merge it with the Sources category"
test('the page lists its two categories and shows Sources alone, its cards holding the sign-ins, without the FKN row, Data or Tracking', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(categories(page).getByRole('link')).toHaveText(CATEGORIES)
  for (const title of CATEGORIES) await expect(categories(page).getByRole('link', { name: title })).toHaveAttribute('href', `#${title.toLowerCase()}`)
  await expect(panel(page)).toHaveCount(1)
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Sources')
  await expect(page.locator('[data-source] [data-account]'), 'the header shows the FKN account, so this page does not').toHaveCount(5)
  await expect(page.locator('[data-account="fkn"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^(Accounts|Data|Tracking|Playback)$/ })).toHaveCount(0)
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

test('clicking Playback shows Playback and hides Sources, and back, from the top even when scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 })
  await seeded(page)
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  expect(await scrollY(page), 'Sources is taller than the window').toBeGreaterThan(0)
  await picks(page, 'Playback')
  await expect(page.locator('[data-source]'), 'Sources is hidden').toHaveCount(0)
  await picks(page, 'Sources')
  await expect(page.locator('[data-plugin]'), 'the seeded source is listed').toHaveCount(1)
  await expect(sourceSwitches(page), 'every source stub ships with, each with a switch').toHaveCount(ALL)
  await expect(page.locator('[data-account="anilist"]')).toBeVisible()
  await expect(panel(page).locator('input[type="password"]'), 'no key form').toHaveCount(0)
  await page.goBack()
  await expect(panel(page), 'back returns to the category before').toHaveAttribute('data-section', 'playback')
})

// the owner, 2026-10-10: "display all of the native sources and make the user able to disable/enable
// them. By default obviously all enabled."
test('every source stub ships with is on by default, and one turned off stays off across a reload', async ({ page }) => {
  await page.goto(`${origin}/settings#sources`)
  const simkl = page.getByRole('switch', { name: 'Simkl source', exact: true })
  // from the top of the page, not of the window: a click scrolls its target into view first
  const firstTop = () => sourceSwitches(page).first().evaluate(input => input.getBoundingClientRect().top + window.scrollY)
  await expect(page.getByRole('switch', { name: / source$/, checked: true })).toHaveCount(ALL)
  await expect(page.getByText(`All ${ALL} on`, { exact: true })).toBeVisible()
  const top = await firstTop()

  await simkl.click()
  await expect(simkl).not.toBeChecked()
  await expect(page.getByText(`${ALL - 1} of ${ALL} on`, { exact: true })).toBeVisible()
  expect(await firstTop(), 'turning one off moves nothing under the pointer').toBe(top)
  expect(await page.evaluate(() => localStorage.getItem('stub.sources.disabled'))).toBe('["simkl"]')

  await page.reload()
  await expect(simkl, 'kept in this browser').not.toBeChecked()
  await expect(page.locator('[data-source="simkl"]')).toHaveClass(/\boff\b/)
  await expect(page.getByRole('switch', { name: / source$/, checked: true })).toHaveCount(ALL - 1)
  const turnAllOn = page.getByRole('button', { name: 'Turn all on' })
  await turnAllOn.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('switch', { name: / source$/, checked: true })).toHaveCount(ALL)
  await expect(turnAllOn, 'the button stays, so the keyboard stays on it').toBeFocused()
  expect(await firstTop(), 'and turning all on moves nothing either').toBe(top)
  expect(await page.evaluate(() => localStorage.getItem('stub.sources.disabled'))).toBeNull()
})

test('a keyboard reaches the categories and switches between them', async ({ page }) => {
  await page.goto(`${origin}/settings`)
  await categories(page).getByRole('link', { name: 'Sources' }).focus()
  await page.keyboard.press('Tab')
  await expect(categories(page).getByRole('link', { name: 'Playback' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toHaveAttribute('data-section', 'playback')
  await expect(categories(page).getByRole('link', { name: 'Playback' })).toHaveAttribute('aria-current', 'true')
})

test('a link or a reload on #playback lands on Playback, and the header link or a category that is gone lands on Sources', async ({ page }) => {
  await page.goto(`${origin}/settings#playback`)
  await expect(panel(page)).toHaveAttribute('data-section', 'playback')
  await page.reload()
  await expect(panel(page)).toHaveAttribute('data-section', 'playback')
  await page.locator('header').getByRole('link', { name: 'Settings' }).click()
  await expect(page, 'the header\'s Settings link drops the fragment').toHaveURL(/\/settings(\?[^#]*)?$/)
  await expect(panel(page), 'and so shows Sources').toHaveAttribute('data-section', 'sources')
  await expect(categories(page).locator('a[aria-current="true"]')).toHaveText(['Sources'])
  for (const gone of ['accounts', 'data', 'tracking']) {
    await page.goto(`${origin}/legal`)
    await page.goto(`${origin}/settings#${gone}`)
    await expect(panel(page), gone).toHaveAttribute('data-section', 'sources')
    await expect(categories(page).locator('a[aria-current="true"]')).toHaveText(['Sources'])
  }
})

test('on a phone the categories are a row above the panel, the page stays at the top, and never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seeded(page, '/settings#sources')
  const nav = await categories(page).boundingBox()
  expect(nav!.y + nav!.height).toBeLessThanOrEqual((await panel(page).boundingBox())!.y)
  for (const link of await categories(page).getByRole('link').all()) await expect(link).toBeInViewport()
  expect(await scrollY(page), 'a load on a category does not scroll to it').toBe(0)
  for (const title of ['Playback', 'Sources']) {
    await picks(page, title)
    expect(await overflowX(page), title).toBeLessThanOrEqual(0)
  }
})

test('Playback has one switch, autoplay, on by default, and turned off it stays off across a reload', async ({ page }) => {
  await page.goto(`${origin}/settings#playback`)
  await expect(panel(page)).toHaveAttribute('data-section', 'playback')
  const autoplay = page.getByRole('switch', { name: 'Autoplay next episode', exact: true })
  await expect(page.getByRole('switch')).toHaveCount(1)
  await expect(autoplay).toBeChecked()
  await expect(panel(page), 'the play order is on the source cards').toHaveText(/^Playback\s*Autoplay next episode$/)

  await autoplay.click()
  await expect(autoplay).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('stub.player.autoplay'))).toBe('off')
  await page.reload()
  await expect(autoplay, 'kept in this browser').not.toBeChecked()

  await autoplay.click()
  await expect(autoplay).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('stub.player.autoplay'))).toBeNull()
})

test('Play order ranks the cards of stub\'s players and an added source, a moved card keeps the focus, and the order is kept and followed by another tab', async ({ page, context }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(() => localStorage.setItem('stub-enabled-plugins', JSON.stringify(['npm:@spec/anime-source'])))
  await page.goto(`${origin}/settings#sources`)
  const rows = (on: Page) => on.locator('ol.play-order > li h4')
  const move = (name: string) => page.getByRole('button', { name, exact: true })
  await expect(rows(page)).toHaveText(['Crunchyroll', 'Prime Video', 'Netflix', 'Spec Anime'])
  await expect(page.locator('ol.play-order > li .place')).toHaveText(['1', '2', '3', '4'])
  await expect(page.locator('ol.play-order').getByRole('button', { name: /^Move / }), 'only the sources Play tries can move').toHaveCount(8)
  await expect(move('Move Crunchyroll up')).toHaveAttribute('aria-disabled', 'true')
  await expect(move('Move Spec Anime down')).toHaveAttribute('aria-disabled', 'true')
  await expect(move('Move Netflix down')).not.toHaveAttribute('aria-disabled')

  await move('Move Spec Anime up').focus()
  for (const order of [['Crunchyroll', 'Prime Video', 'Spec Anime', 'Netflix'], ['Crunchyroll', 'Spec Anime', 'Prime Video', 'Netflix'], ['Spec Anime', 'Crunchyroll', 'Prime Video', 'Netflix']]) {
    await page.keyboard.press('Enter')
    await expect(rows(page)).toHaveText(order)
    await expect(move('Move Spec Anime up'), order.join()).toBeFocused()
  }
  await expect(move('Move Spec Anime up')).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Enter')
  await expect(rows(page), 'an end button moves nothing').toHaveText(['Spec Anime', 'Crunchyroll', 'Prime Video', 'Netflix'])

  await move('Move Crunchyroll down').click()
  await expect(rows(page)).toHaveText(['Spec Anime', 'Prime Video', 'Crunchyroll', 'Netflix'])
  await expect(move('Move Crunchyroll down')).toBeFocused()
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('stub.sources.play-order')))!)).toEqual(['spec-anime', 'amazon', 'cr', 'nf'])

  const other = await context.newPage()
  await other.route(url => !url.href.startsWith(origin), route => route.abort())
  await other.goto(`${origin}/settings#sources`)
  await expect(rows(other)).toHaveText(['Spec Anime', 'Prime Video', 'Crunchyroll', 'Netflix'])
  await move('Move Netflix up').click()
  await expect(rows(other), 'another tab follows').toHaveText(['Spec Anime', 'Prime Video', 'Netflix', 'Crunchyroll'])
  await page.reload()
  await expect(rows(page), 'kept in this browser').toHaveText(['Spec Anime', 'Prime Video', 'Netflix', 'Crunchyroll'])
})

const SPEC_SOURCES = ['npm:@spec/anime-source', 'npm:@spec/source-family', 'npm:@spec/slow-source', 'npm:@spec/broken-source'] as const

/** Opens Sources with these addresses added, each in the state tests/fake-plugins.ts gives it. */
const withSources = async (page: Page, uris: readonly string[]) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(list => localStorage.setItem('stub-enabled-plugins', JSON.stringify(list)), uris)
  await page.goto(`${origin}/settings#sources`)
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
}

test('Sources lists each added source with its state, and says so once none is left', async ({ page }) => {
  await withSources(page, SPEC_SOURCES)
  const row = (uri: string) => page.locator(`[data-plugin="${uri}"]`)
  const [connected, family, connecting, failed] = SPEC_SOURCES
  await expect(row(connected).locator('.pill')).toHaveText('Connected')
  await expect(row(family).locator('.meta')).toHaveText(`${family} · 3 sources · 1 unavailable`)
  await expect(row(connecting).locator('.pill')).toHaveText('Connecting')
  await expect(row(failed).locator('.pill')).toHaveText('Error')
  const failure = row(failed).locator('.failure')
  await expect(failure).toHaveText('Could not connect to this source.')
  expect(await failure.evaluate(element => element.scrollWidth <= element.clientWidth && element.clientHeight > 0), 'the whole error shows').toBe(true)

  for (const uri of SPEC_SOURCES) await row(uri).getByRole('button', { name: /^Remove / }).click()
  await expect(panel(page).locator('.empty')).toHaveText('No sources added yet.')
  expect(JSON.parse((await readLocal(page))['stub-enabled-plugins']!)).toEqual([])
})

// the owner, 2026-10-25 (HOR-1019): "right now custom sources can't be disabled besides just removing the plugin, but I want them visible too"
test('every source an added package registered has a card, and one turned off stays off across a reload with its package kept', async ({ page }) => {
  await withSources(page, SPEC_SOURCES)
  const card = (origin: string) => page.locator(`[data-source="${origin}"]`)
  for (const [origin, name, from] of [['spec-anime', 'Spec Anime', 'npm:@spec/anime-source'], ['spec-b', 'Spec Batches', 'npm:@spec/source-family']] as const) {
    await expect(card(origin).getByRole('heading', { name })).toBeVisible()
    await expect(card(origin).locator('.from')).toHaveText(from)
  }
  await expect(page.locator('[data-source^="spec-"]'), 'none for a package still connecting or that failed').toHaveCount(4)
  await expect(sourceSwitches(page)).toHaveCount(ALL + 4)

  const spec = page.getByRole('switch', { name: 'Spec Anime source', exact: true })
  await spec.click()
  await expect(spec).not.toBeChecked()
  await expect(page.getByText(`${ALL + 3} of ${ALL + 4} on`, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('stub.sources.disabled'))).toBe('["spec-anime"]')
  await page.reload()
  await expect(spec, 'kept in this browser').not.toBeChecked()
  await expect(card('spec-anime')).toHaveClass(/\boff\b/)
  await expect(page.locator('[data-plugin="npm:@spec/anime-source"] .pill'), 'its package stays').toHaveText('Connected')
})

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`at ${width}x${height} every card keeps its content inside it, and the page never scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await withSources(page, SPEC_SOURCES)
    const past = await page.locator('[data-source]').evaluateAll(cards => cards.flatMap(card => {
      const { left, right } = card.getBoundingClientRect()
      return [...card.querySelectorAll('*')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.width && (box.left < left - 0.5 || box.right > right + 0.5)
      }).map(element => `${card.getAttribute('data-source')}: ${element.tagName}.${element.className}`)
    }))
    expect(past).toEqual([])
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })
}

for (const [width, height, columns] of [[1440, 900, 2], [390, 844, 1]] as const) {
  test(`at ${width}x${height} Play order and Merge order are ${columns} per row in reading order, with the icons lined up in each column`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await withSources(page, SPEC_SOURCES)
    for (const list of ['ol.play-order', 'ol.merge-order']) {
      const boxes = await page.locator(`${list} > li`).evaluateAll(items => items.map(item => item.getBoundingClientRect()).map(({ left, top, bottom }) => ({ left: Math.round(left), top: Math.round(top), bottom: Math.round(bottom) })))
      expect(boxes.length, list).toBeGreaterThan(3)
      expect(new Set(boxes.map(box => box.left)).size, list).toBe(columns)
      expect(boxes.every((box, at) => at < columns || (box.left === boxes[at - columns]!.left && box.top >= boxes[at - columns]!.bottom)), `each card under the one a row before it in ${list}`).toBe(true)
      expect(boxes.slice(0, columns).every(box => box.top === boxes[0]!.top), `the first ${columns} on one row in ${list}`).toBe(true)
      expect(boxes.slice(0, columns).every((box, at) => !at || box.left > boxes[at - 1]!.left), `place 2 right of place 1 in ${list}`).toBe(true)
      expect(new Set(await page.locator(`${list} > li .icon`).evaluateAll(icons => icons.map(icon => Math.round(icon.getBoundingClientRect().left)))).size, `the icons line up past the ninth place in ${list}`).toBe(columns)
    }
  })
}

test('Merge order moves a card from the keyboard, keeps the focus on the button pressed, and is kept across a reload', async ({ page }) => {
  await page.goto(`${origin}/settings#sources`)
  const rows = page.locator('ol.merge-order > li h4')
  const up = page.getByRole('button', { name: 'Move AniList up in the merge order', exact: true })
  await expect(rows.first()).toHaveText('MyAnimeList')
  await expect(page.getByRole('button', { name: 'Move MyAnimeList up in the merge order', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await up.focus()
  for (const top of [['MyAnimeList', 'AniList', 'AniZip'], ['AniList', 'MyAnimeList', 'AniZip']]) {
    await page.keyboard.press('Enter')
    await expect(rows.nth(0)).toHaveText(top[0]!)
    await expect(rows.nth(1)).toHaveText(top[1]!)
    await expect(rows.nth(2)).toHaveText(top[2]!)
    await expect(up).toBeFocused()
  }
  await expect(page.locator('ol.merge-order > li.brief h4'), 'a player is ranked here too').toHaveText(['Crunchyroll', 'Netflix'])
  await expect(page.locator('ol.play-order > li h4'), 'the play order stays').toHaveText(['Crunchyroll', 'Prime Video', 'Netflix'])
  await page.reload()
  await expect(rows.first(), 'kept in this browser').toHaveText('AniList')
})

// what every write of a source order wrote to, as the settings store writes it with no FKN account
const countOrderWrites = (page: Page) => page.addInitScript(() => {
  const set = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (this: Storage, key: string, value: string) => void
  const writes: string[] = (window as unknown as { orderWrites: string[] }).orderWrites = []
  Storage.prototype.setItem = function (key: string, value: string) {
    if (/^stub\.sources\.(play|merge)-order$/.test(key)) writes.push(key)
    set.call(this, key, value)
  }
})
const orderWrites = (page: Page) => page.evaluate(() => (window as unknown as { orderWrites: string[] }).orderWrites)
const centre = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const grip = (page: Page, origin: string) => page.locator(`[data-source="${origin}"] .grip`)
/** Presses the mouse on `from` and moves it onto `onto` in steps, leaving it pressed. */
const dragOnto = async (page: Page, from: Locator, onto: Locator) => {
  const [start, end] = [await centre(from), await centre(onto)]
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
}
// the window scrolled so Play order starts 100px down, both lists' first rows clear of the edges that scroll the page,
// once Crunchyroll's card has its state: until then it is a line shorter, and the cards below it move when it comes
const openRanked = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await countOrderWrites(page)
  await page.goto(`${origin}/settings#sources`)
  await expect(page.locator('[data-account="crunchyroll"] .state')).toBeVisible()
  await page.locator('ol.play-order').evaluate(list => window.scrollBy({ top: list.getBoundingClientRect().top - 100, behavior: 'instant' }))
}

test('a card dragged by its grip onto another place in Merge order takes that place, from another column, with one write', async ({ page }) => {
  await openRanked(page)
  const rows = page.locator('ol.merge-order > li h4')
  await expect(rows.nth(0)).toHaveText('MyAnimeList')
  await expect(rows.nth(3)).toHaveText('LiveChart')
  const [moving, onto] = [page.locator('[data-source="livechart"]'), page.locator('ol.merge-order [data-source="mal"]')]
  expect((await moving.boundingBox())!.x, 'it starts in the other column').toBeGreaterThan((await onto.boundingBox())!.x)

  await dragOnto(page, grip(page, 'livechart'), onto)
  await expect(moving).toHaveAttribute('data-dragging')
  await expect(page.locator('[data-over]'), 'the card under the pointer is marked').toHaveAttribute('data-source', 'mal')
  await page.mouse.up()

  await expect(rows.first()).toHaveText('LiveChart')
  await expect(moving.locator('.place')).toHaveText('1')
  await expect(rows.nth(1)).toHaveText('MyAnimeList')
  await expect(page.locator('[data-dragging], [data-over]'), 'nothing stays marked').toHaveCount(0)
  expect(await moving.evaluate(card => card.style.transform)).toBe('')
  expect(await orderWrites(page), 'one write, of the merge order').toEqual(['stub.sources.merge-order'])
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('stub.sources.merge-order')))!).slice(0, 4)).toEqual(['livechart', 'mal', 'anizip', 'anilist'])
  await expect(page.locator('ol.play-order > li h4'), 'the play order stays').toHaveText(['Crunchyroll', 'Prime Video', 'Netflix'])
  await page.reload()
  await expect(rows.first(), 'kept in this browser').toHaveText('LiveChart')
})

test('Escape, a release over the other list and a plain click on a grip move nothing and write nothing', async ({ page }) => {
  await openRanked(page)
  const merge = page.locator('ol.merge-order > li h4')
  const play = page.locator('ol.play-order > li h4')
  const before = await merge.allTextContents()

  await dragOnto(page, grip(page, 'anilist'), page.locator('ol.merge-order [data-source="mal"]'))
  await expect(page.locator('[data-over]')).toHaveAttribute('data-source', 'mal')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-dragging], [data-over]'), 'Escape puts it back').toHaveCount(0)
  await page.mouse.up()

  await dragOnto(page, grip(page, 'anizip'), page.locator('ol.play-order [data-source="nf"]'))
  await expect(page.locator('[data-over]'), 'a card of the other list is never marked').toHaveCount(0)
  await page.mouse.up()

  await grip(page, 'nf').first().click()
  await expect(merge).toHaveText(before)
  await expect(play).toHaveText(['Crunchyroll', 'Prime Video', 'Netflix'])
  expect(await orderWrites(page)).toEqual([])
})

test('a wheel turned mid-drag carries the card with the pointer, and the release drops it on the card then under it', async ({ page }) => {
  await openRanked(page)
  const cards = page.locator('ol.merge-order > li')
  const names = () => cards.evaluateAll(all => all.map(card => card.getAttribute('data-source')!))
  const order = await names()
  const [source, first] = [order.at(-1)!, order.at(-3)!]
  const moving = page.locator(`ol.merge-order [data-source="${source}"]`)
  await moving.evaluate(card => window.scrollBy({ top: card.getBoundingClientRect().top - 500, behavior: 'instant' }))
  const target = page.locator(`ol.merge-order [data-source="${first}"]`)
  const pointer = await centre(target)

  await dragOnto(page, grip(page, source), target)
  await expect(page.locator('[data-over]')).toHaveAttribute('data-source', first)
  const [held, scrolled] = [await centre(moving), await scrollY(page)]
  await page.mouse.wheel(0, -300)
  await expect.poll(() => scrollY(page), 'the wheel scrolls the page up').toBe(scrolled - 300)

  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('ol.merge-order > li')?.getAttribute('data-source'), pointer)
  expect(under, 'the scroll put another card of Merge order under the pointer').toBeTruthy()
  expect(under).not.toBe(first)
  expect((await centre(moving)).y, 'the card stays under the pointer').toBeCloseTo(held.y, 0)
  await expect(page.locator('[data-over]'), 'the card under the pointer is marked').toHaveAttribute('data-source', under!)
  await page.mouse.up()

  expect((await names()).indexOf(source), 'it takes that card\'s place').toBe(order.indexOf(under!))
  expect(await orderWrites(page)).toEqual(['stub.sources.merge-order'])
  const dropped = await scrollY(page)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => scrollY(page)).toBe(dropped + 300)
  await expect(page.locator('[data-dragging], [data-over]'), 'a scroll after the drop moves nothing').toHaveCount(0)
  expect(await moving.evaluate(card => card.style.transform)).toBe('')
})

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
  test.skip(({ browserName }) => browserName !== 'chromium')

  // page.touchscreen has only a whole tap, so the touch goes through Chrome's own input
  test('a swipe on a card scrolls the page, and the last card of Merge order dragged by its grip to the top scrolls there and takes place 1', async ({ page }) => {
    await countOrderWrites(page)
    await page.goto(`${origin}/settings#sources`)
    const touch = await page.context().newCDPSession(page)
    const at = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const cards = page.locator('ol.merge-order > li')
    const last = cards.last()
    const name = await last.locator('h4').textContent()

    await cards.first().evaluate(card => window.scrollBy({ top: card.getBoundingClientRect().top - 500, behavior: 'instant' }))
    const scrolled = await scrollY(page)
    const body = await centre(cards.first().locator('.title'))
    await at('touchStart', body.x, body.y)
    for (let step = 1; step <= 10; step++) await at('touchMove', body.x, body.y - step * 30)
    await at('touchEnd')
    await expect.poll(async () => await scrollY(page) - scrolled, 'a swipe on a card scrolls').toBeGreaterThan(100)

    await last.scrollIntoViewIfNeeded()
    const start = await centre(last.locator('.grip'))
    await at('touchStart', start.x, start.y)
    for (let step = 1; step <= 10; step++) await at('touchMove', start.x, start.y - (start.y - 20) * step / 10)
    await expect(last).toHaveAttribute('data-dragging')
    const top = await headerBottom(page)
    // held at the top edge until place 1 is in sight below the header
    for (let wait = 0; wait < 400 && (await cards.first().boundingBox())!.y < top + 60; wait++) {
      await at('touchMove', start.x, 20 + wait % 2)
      await page.waitForTimeout(16)
    }
    const first = await centre(cards.first())
    await at('touchMove', start.x, first.y)
    await expect(page.locator('[data-over]')).toHaveAttribute('data-source', 'mal')
    await at('touchEnd')

    await expect(cards.first().locator('h4')).toHaveText(name!)
    await expect(cards.first().locator('.place')).toHaveText('1')
    await expect(page.locator('[data-dragging], [data-over]')).toHaveCount(0)
    expect(await orderWrites(page)).toEqual(['stub.sources.merge-order'])
  })
})

test('adding by address shows a refused address\'s error under the group, and a good one is added', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withSources(page, [])
  await expect(panel(page).locator('.empty')).toHaveText('No sources added yet.')
  const group = panel(page).locator('.group')
  const input = panel(page).getByLabel('Or add one by its address')
  const add = group.getByRole('button')
  const alert = panel(page).getByRole('alert')

  const [inputBox, addBox] = [await input.boundingBox(), await add.boundingBox()]
  expect(Math.abs(inputBox!.y - addBox!.y), 'one row at a phone\'s width').toBeLessThan(2)

  await input.fill('not a package')
  await add.click()
  await expect(add).toHaveText('Adding...')
  await expect(add).toBeDisabled()
  await expect(alert).toHaveText('Could not add this source. Check the address.')
  await expect(add).toHaveText('Add')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveValue('not a package')
  expect(await group.evaluate(element => getComputedStyle(element).borderTopColor), 'the group turns red').toBe('rgb(248, 113, 113)')
  expect(await overflowX(page), 'no sideways scroll with the error showing').toBeLessThanOrEqual(0)

  await input.fill('npm:@spec/anime-source')
  await add.click()
  await expect(panel(page).locator('[data-plugin="npm:@spec/anime-source"] .pill')).toHaveText('Connected')
  await expect(input).toHaveValue('')
  await expect(alert).toHaveText('')
  await expect(input).not.toHaveAttribute('aria-invalid')
})

test('too narrow for one row, the Add button drops under the input at its full width', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 700 })
  await withSources(page, [])
  const group = panel(page).locator('.group')
  const [groupBox, inputBox, addBox] = [await group.boundingBox(), await group.locator('input').boundingBox(), await group.getByRole('button').boundingBox()]
  expect(addBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 1)
  expect(addBox!.width, 'as wide as the input').toBeGreaterThanOrEqual(inputBox!.width - 1)
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width)
  expect(await overflowX(page)).toBeLessThanOrEqual(0)
})

/** Opens the prompt a link carrying this address raises. */
const linkedPrompt = async (page: Page, uri: string) => {
  await page.goto(`${origin}/settings?plugins=${uri}`)
  return page.getByRole('dialog', { name: 'Add this source?' }).locator('.dialog')
}

const lineCount = (locator: Locator) => locator.evaluate(element => {
  const range = document.createRange()
  range.selectNodeContents(element)
  return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size
})

/** The text of every element in the prompt that reaches past its left or right edge. */
const pastPrompt = (prompt: Locator) => prompt.evaluate(dialog => {
  const { left, right } = dialog.getBoundingClientRect()
  return [...dialog.querySelectorAll('*')].filter(element => {
    const box = element.getBoundingClientRect()
    return box.left < left - 0.5 || box.right > right + 0.5
  }).map(element => element.textContent)
})

for (const [width, height] of [[1920, 1080], [390, 844]] as const) {
  test(`at ${width}x${height} a linked source that fails to boot says so in one line under its address, inside the prompt`, async ({ page }) => {
    const DEAD = 'https:dead.spec.test'
    await page.setViewportSize({ width, height })
    const prompt = await linkedPrompt(page, DEAD)
    await prompt.getByRole('button', { name: 'Add source' }).click()
    const error = prompt.getByText('Could not add this source.', { exact: true })
    await expect(error).toBeVisible()
    expect(await lineCount(error), 'one line').toBe(1)
    await expect(prompt, 'FKN\'s own message stays out of the prompt').not.toContainText('failed to boot')
    await expect(prompt.getByRole('button', { name: 'Dismiss' })).toBeVisible()

    const uri = prompt.getByText(DEAD, { exact: true })
    expect(await lineCount(uri), 'the address keeps its width').toBe(1)
    const [uriBox, errorBox] = [await uri.boundingBox(), await error.boundingBox()]
    expect(errorBox!.y, 'the error is under the address').toBeGreaterThanOrEqual(uriBox!.y + uriBox!.height - 1)
    expect(await pastPrompt(prompt), 'nothing runs past the dialog').toEqual([])
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })

  test(`at ${width}x${height} a linked source still connecting shows adding… under its address, which keeps its width`, async ({ page }) => {
    const CONNECTING = 'https:still.connecting.spec.test'
    await page.setViewportSize({ width, height })
    const prompt = await linkedPrompt(page, CONNECTING)
    await prompt.getByRole('button', { name: 'Add source' }).click()
    const state = prompt.getByText('adding…', { exact: true })
    await expect(state).toBeVisible()

    const uri = prompt.getByText(CONNECTING, { exact: true })
    expect(await lineCount(uri), 'the address keeps its width').toBe(1)
    const [uriBox, stateBox] = [await uri.boundingBox(), await state.boundingBox()]
    expect(stateBox!.y, 'adding… is under the address').toBeGreaterThanOrEqual(uriBox!.y + uriBox!.height - 1)
  })
}

test('at 390x844 a source whose long host has nowhere to break keeps its error inside the prompt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const prompt = await linkedPrompt(page, 'https:asourcewhosehostnamehasnowheretobreak.spec.test')
  await prompt.getByRole('button', { name: 'Add source' }).click()
  await expect(prompt.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  expect(await pastPrompt(prompt), 'nothing runs past the dialog').toEqual([])
  expect(await overflowX(page)).toBeLessThanOrEqual(0)
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
  await expect(page.locator('[data-source="anilist"]').getByRole('heading', { name: 'AniList' }), 'the Sign out is gone, so focus goes to its card').toBeFocused()
})

test('signing out of AniList and MyAnimeList disconnects each on this device, one at a time', async ({ page }) => {
  await seeded(page, '/settings#sources')
  for (const [site, title, left] of [['anilist', 'AniList', ['mal']], ['mal', 'MyAnimeList', []]] as const) {
    const row = page.locator(`[data-account="${site}"]`)
    await expect(row).not.toContainText('Not connected')
    await row.getByRole('button', { name: `Sign out of ${title}`, exact: true }).click()
    expect(JSON.parse((await readLocal(page))['stub.sessions']!), 'the first click only asks').toContain(site)
    await row.getByRole('button', { name: 'Yes, sign out' }).click()
    await expect(row).toContainText('Not connected')
    expect(JSON.parse((await readLocal(page))['stub.sessions']!)).toEqual(left)
    await expect(page.locator(`[data-source="${site}"]`).getByRole('heading', { name: title }), 'focus stays on the card, whose button is gone').toBeFocused()
  }
  await page.reload()
  await expect(page.locator('[data-account="anilist"]')).toContainText('Not connected')
  await expect(page.locator('[data-account="anilist"]').getByRole('button', { name: 'Sign in' })).toBeVisible()
})

// a sign out sent on a BroadcastChannel alone reached the other tab before its storage had it (src/tracking/connections.ts)
test('a sign out of AniList in one tab reaches its row in another, and leaves MyAnimeList connected there', async ({ page, context }) => {
  await seeded(page, '/settings#sources')
  const other = await context.newPage()
  await other.route(url => !url.href.startsWith(origin), route => route.abort())
  await other.goto(`${origin}/settings#sources`)
  await expect(other.locator('[data-account="anilist"]')).not.toContainText('Not connected')

  const row = page.locator('[data-account="anilist"]')
  await row.getByRole('button', { name: 'Sign out of AniList', exact: true }).click()
  await row.getByRole('button', { name: 'Yes, sign out' }).click()

  await expect(other.locator('[data-account="anilist"]')).toContainText('Not connected')
  await expect(other.locator('[data-account="mal"]')).not.toContainText('Not connected')
})

const chip = (page: Page, site: string) => page.locator(`[data-account="${site}"] .state`)

// a check asks through FKN, which this page never reaches, so what a check leaves behind is the hidden
// frame it mounts first, named by its title and recorded even when a failed attach takes it out at once.
// @fkn/lib mounts an untitled frame of its own on every page.
const recordFrames = (page: Page) => page.addInitScript(() => {
  const titles: string[] = []
  Object.assign(window, { mountedFrames: titles })
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement && node.title) titles.push(node.title)
  }).observe(document, { childList: true, subtree: true })
})
const mountedFrames = (page: Page) => page.evaluate(() => (window as unknown as { mountedFrames: string[] }).mountedFrames)

test('the cards show what stub last learned of each sign-in, with no age and nothing to press to check it', async ({ page }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(() => {
    localStorage.setItem('stub.sessions', JSON.stringify(['anilist', 'mal']))
    localStorage.setItem('stub.site-status', JSON.stringify({
      crunchyroll: { state: 'signed-in', checkedAt: Date.now() - 2 * 3_600_000 },
      anilist: { state: 'signed-out', checkedAt: Date.now() - 26 * 3_600_000 },
    }))
  })
  await page.goto(`${origin}/settings#sources`)

  await expect(chip(page, 'crunchyroll')).toHaveText('Signed in')
  await expect(chip(page, 'anilist')).toHaveText('Signed out')
  await expect(chip(page, 'mal'), 'connected, and nothing learned yet').toHaveCount(0)
  await expect(panel(page)).not.toContainText(/checked|Check/)
  await expect(panel(page).getByRole('button', { name: /check/i })).toHaveCount(0)
})

test('a connected tracking site stub learned is signed out offers Sign in, never Sign out', async ({ page }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(() => {
    localStorage.setItem('stub.sessions', JSON.stringify(['anilist', 'mal']))
    localStorage.setItem('stub.site-status', JSON.stringify({
      anilist: { state: 'signed-out', checkedAt: Date.now() },
      mal: { state: 'signed-out', checkedAt: Date.now() },
    }))
  })
  await page.goto(`${origin}/settings#sources`)

  for (const [site, title] of [['anilist', 'AniList'], ['mal', 'MyAnimeList']] as const) {
    const row = page.locator(`[data-account="${site}"]`)
    await expect(chip(page, site)).toHaveText('Signed out')
    await expect(row.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Sign out of ${title}` })).toHaveCount(0)
  }
})

test('an AniList stub learned is signed out reads Signed in, with Sign out, once a sign in in another tab records it', async ({ page, context }) => {
  await page.goto(`${origin}/legal`)
  await page.evaluate(() => {
    localStorage.setItem('stub.sessions', JSON.stringify(['anilist', 'mal']))
    localStorage.setItem('stub.site-status', JSON.stringify({ anilist: { state: 'signed-out', checkedAt: Date.now() } }))
  })
  const other = await context.newPage()
  await other.route(url => !url.href.startsWith(origin), route => route.abort())
  await other.goto(`${origin}/settings#sources`)
  const row = other.locator('[data-account="anilist"]')
  await expect(chip(other, 'anilist')).toHaveText('Signed out')
  // once the backend is known: its answer renders the row again, which reads the new state with no listener
  await expect(row.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  // what a sign in to a site connected already records, and all it changes in storage
  await page.evaluate(() => localStorage.setItem('stub.site-status', JSON.stringify({ anilist: { state: 'signed-in', checkedAt: Date.now() } })))

  await expect(chip(other, 'anilist')).toHaveText('Signed in')
  await expect(row.getByRole('button', { name: 'Sign out of AniList', exact: true })).toBeVisible()
})

test('opening Sources checks a Crunchyroll stub knows of once what it learned is stale, asks no tracker site, and keeps the state when no answer comes', async ({ page }) => {
  await recordFrames(page)
  const seed = (age: number) => page.evaluate(age => {
    localStorage.setItem('stub.sessions', JSON.stringify(['mal']))
    localStorage.setItem('stub.site-status', JSON.stringify({
      crunchyroll: { state: 'signed-in', checkedAt: Date.now() - age },
      mal: { state: 'signed-in', checkedAt: Date.now() - age },
    }))
  }, age)
  const backendKnown = () => expect(page.locator('[data-account="crunchyroll"]').getByRole('button', { name: 'Sign out of Crunchyroll' })).toBeVisible()
  await page.goto(`${origin}/legal`)

  await seed(0)
  await page.goto(`${origin}/settings#sources`)
  await backendKnown()
  await page.waitForTimeout(1_000)
  expect(await mountedFrames(page), 'learned just now, so nothing is asked').toEqual([])

  await seed(2 * HOUR)
  await page.reload()
  await backendKnown()
  await expect.poll(() => mountedFrames(page)).toEqual(['Sign-in check'])
  await page.waitForTimeout(1_000)
  expect(await mountedFrames(page), "the trackers' own paced reads keep their sites' states").toEqual(['Sign-in check'])
  await expect(chip(page, 'crunchyroll')).toHaveText('Signed in')
  await expect(chip(page, 'mal')).toHaveText('Signed in')
  await expect(page.locator('[data-account] [role="status"]')).toHaveText(['', '', '', ''])
})

// HOR-755: a session stub never saw cannot be checked without a permission, which Sign in asks for
test('with nothing remembered Crunchyroll reads signed out with Sign in alone, a site not connected says so, and nothing is asked', async ({ page }) => {
  await recordFrames(page)
  await page.goto(`${origin}/settings#sources`)

  await expect(page.locator('[data-account="crunchyroll"]').getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(chip(page, 'crunchyroll')).toHaveText('Signed out')
  await expect(page.locator('[data-account="crunchyroll"]').getByRole('button', { name: 'Sign out of Crunchyroll' })).toHaveCount(0)
  await expect(chip(page, 'anilist')).toHaveText('Not connected')
  await page.waitForTimeout(1_000)
  expect(await mountedFrames(page), 'Crunchyroll is checked only once stub knows of it').toEqual([])
})

test('the privacy page says what stub keeps, and its link to Sources opens that category', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`${origin}/privacy`)
  const body = page.locator('body')
  for (const title of ['Added sources', 'Party name', "Stub's list"]) await expect(body).toContainText(title)
  await expect(page.locator('li strong').filter({ hasText: /^Settings\.$/ }), 'one item for every setting').toHaveCount(1)
  await expect(body).not.toContainText('Search layout')
  await expect(body).not.toContainText('API key')
  await expect(body).not.toContainText('Everything else stub holds is cleared when you close or refresh the tab')
  await expect(body).not.toContainText('under Data')
  await page.getByRole('link', { name: 'Settings, under Sources' }).first().click()
  await expect(page).toHaveURL(/\/settings#sources$/)
  await expect(panel(page)).toHaveAttribute('data-section', 'sources')
  expect(await scrollY(page)).toBe(0)
})

test.describe('in Toronto', () => {
  test.use({ timezoneId: 'America/Toronto' })

  test('Country is Automatic, naming Canada, until one is picked, which stays across a reload', async ({ page }) => {
    await page.goto(`${origin}/settings`)
    const country = () => page.getByRole('combobox', { name: 'Country' })
    await expect(country().locator('option:checked')).toHaveText('Automatic (Canada)')
    await expect(page.locator('[data-setting="country"]'), 'first, before the sign-ins').toBeVisible()
    expect((await panel(page).locator('.rows > .row').first().getAttribute('data-setting'))).toBe('country')

    await country().selectOption('JP')
    expect((await readLocal(page))['stub.country']).toBe('JP')
    await page.reload()
    await expect(country().locator('option:checked')).toHaveText('Japan')

    await country().selectOption('')
    await expect(country().locator('option:checked')).toHaveText('Automatic (Canada)')
    expect((await readLocal(page))['stub.country'], 'Automatic keeps nothing').toBeUndefined()
  })
})

// HOR-1026 (stub in the viewer's language): the page's own words and its prompt's, each text run and label, a run split
// where the page joins its counts with ` · `
const wordsIn = (page: Page, selector: string) => page.evaluate(selector => {
  const words: string[] = []
  const walk = (element: Element) => {
    for (const name of ['aria-label', 'title', 'placeholder']) if (element.getAttribute(name)) words.push(element.getAttribute(name)!)
    let run = ''
    for (const child of [...element.childNodes, null]) {
      if (child?.nodeType === Node.TEXT_NODE) run += child.textContent
      else {
        words.push(...run.split(' · ').map(part => part.trim()).filter(Boolean))
        run = ''
        if (child instanceof Element) walk(child)
      }
    }
  }
  for (const root of document.querySelectorAll(selector)) walk(root)
  return words
}, selector)

/** Each element in `selector` that reaches past the left or right edge of the box `within` holds it. */
const pastEdges = (page: Page, selector: string, within: string) => page.locator(selector).evaluateAll((roots, within) => roots.flatMap(root => {
  const { left, right } = (root.closest(within) ?? root).getBoundingClientRect()
  return [...root.querySelectorAll('*')].filter(element => {
    const box = element.getBoundingClientRect()
    return box.width && (box.left < left - 0.5 || box.right > right + 0.5)
  }).map(element => `${element.tagName}.${element.className}: ${element.textContent}`)
}), within)

const SETTINGS = 'h1, nav.index, [data-section]'

/**
 * Draws Sources with an added source in each state, a source off, a sign out asked, an address refused, then Playback,
 * then the prompts a link raises, at `width`, and returns their words and what runs past its card, its section or
 * its dialog. Picks no element by its English.
 */
const drawnWords = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 })
  const past: string[] = []
  const overflow: number[] = []
  const settled = async () => {
    past.push(...await pastEdges(page, '[data-source]', '[data-source]'), ...await pastEdges(page, '[data-section]', '[data-section]'))
    overflow.push(await overflowX(page))
  }
  await page.goto(`${origin}/legal`)
  await page.evaluate(list => {
    localStorage.setItem('stub-enabled-plugins', JSON.stringify(list))
    localStorage.setItem('stub.sessions', JSON.stringify(['anilist', 'mal']))
    localStorage.setItem('stub.sources.disabled', JSON.stringify(['simkl']))
    localStorage.setItem('stub.site-status', JSON.stringify({ crunchyroll: { state: 'signed-in', checkedAt: Date.now() }, anilist: { state: 'signed-out', checkedAt: Date.now() } }))
  }, SPEC_SOURCES)
  await page.goto(`${origin}/settings#sources`)
  await expect(page.locator('[data-account="mal"] .actions button')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(`[data-plugin="${SPEC_SOURCES[0]}"] .pill[data-state="connected"]`)).toBeVisible()
  await page.locator('[data-account="mal"] .actions button').click()
  await expect(page.locator('[data-account="mal"] .confirm')).toBeVisible()
  await settled()
  const words = await wordsIn(page, SETTINGS)
  await page.locator('.group input').fill('not a package')
  await page.locator('.group button').click()
  await expect(page.locator('[role="alert"]')).not.toHaveText('')
  await settled()
  words.push(...await wordsIn(page, '.by-address'))

  await page.goto(`${origin}/settings#playback`)
  await expect(page.locator('[data-section="playback"]')).toBeVisible()
  await settled()
  words.push(...await wordsIn(page, SETTINGS))

  await page.goto(`${origin}/legal`)
  await page.evaluate(() => localStorage.removeItem('stub-enabled-plugins'))
  await page.goto(`${origin}/settings?plugins=${SPEC_SOURCES[0]}`)
  await expect(page.locator('[role="dialog"] .dialog')).toBeVisible()
  words.push(...await wordsIn(page, '[role="dialog"]'))
  await page.goto(`${origin}/settings?plugins=https:dead.spec.test&plugins=https:still.connecting.spec.test`)
  await page.locator('[role="dialog"] .actions button:not(.decline)').click()
  await expect(page.locator('[role="dialog"] .dismiss')).toBeVisible()
  past.push(...await pastPrompt(page.locator('[role="dialog"] .dialog')))
  overflow.push(await overflowX(page))
  words.push(...await wordsIn(page, '[role="dialog"]'))
  return { words, past, overflow }
}

test.describe('in a language stub does not offer yet', () => {
  test.use({ timezoneId: 'America/Toronto' })

  for (const language of [PSEUDO, 'de', 'ja']) {
    test(`${language}: Sources, Playback and the prompt run past nothing at 1440 and 390 px, with none of their own words in English`, async ({ page }) => {
      test.setTimeout(240_000)
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
      const code = english()
      const translated = language === PSEUDO ? undefined : catalogues()[language]
      for (const width of [1440, 390]) {
        const { words, past, overflow } = await drawnWords(page, width)
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        expect(overflow, `${width} px`).toEqual([0, 0, 0, 0])
        expect(past, `${width} px`).toEqual([])
        expect(words.length, `${width} px: the control, the page's words were read`).toBeGreaterThan(400)
        expect(englishIn(words, code, translated), `${width} px`).toEqual([])
      }
    })
  }

  test('the control: in English the same reading finds the page\'s own words', async ({ page }) => {
    test.setTimeout(120_000)
    const { words } = await drawnWords(page, 1440)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(englishIn(words, english()).length).toBeGreaterThan(60)
  })
})
