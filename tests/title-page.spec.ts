import type { AddressInfo } from 'node:net'
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import SEASONS from '../src/generated/anime-seasons'
import { DISABLED_SOURCES_KEY } from '../src/sources/disabled-sources'
import { HIDDEN_ICONS_KEY } from '../src/sources/hidden-icons'
import { PLAYER_VOLUME_KEY } from '../src/utils/player-volume'
import { recordId, seasonKey } from '../src/sources/offline/normalize'
import { mediaSeasonNow } from '../src/sources/season'

// The title page as anime.fkn.app serves it, built and served the way tests/settings.spec.ts does: every
// request that leaves this origin is refused, so the works are the season the bundled catalogue lists,
// AniList answers each of them with Cowboy Bebop's credits and one sequel, Spec Sequel, AniZip with 26
// episodes and Frieren's ids, AnimeThemes with Frieren's themes, one without a video, IMDb answers
// Breaking Bad, TMDB Squid Game's three seasons, the first two with one episode each, and Frieren's one,
// TVmaze Spec Maze's two seasons, and MyAnimeList Cowboy Bebop's title and credits pages for mal:1
// (tests/fake-fetch.ts).

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

/** Draws the white Play button alone over pure white, and expects each edge darker than white and its inside white. */
const expectEdge = async (page: Page, play: Locator, where: string) => {
  await play.scrollIntoViewIfNeeded()
  await page.addStyleTag({ content: 'html, body { background: #fff !important } body * { visibility: hidden } .play, .play * { visibility: visible }' })
  const { x, y, width, height } = (await play.boundingBox())!
  expect(y + height, `${where}: the button is on screen`).toBeLessThanOrEqual(page.viewportSize()!.height)
  const png = (await page.screenshot({ animations: 'disabled' })).toString('base64')
  const { edge, inside } = await page.evaluate(async ({ png, x, y, width, height }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: 'image/png' }))
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const pixel = (px: number, py: number) => context.getImageData(px, py, 1, 1).data.slice(0, 3)
    const brightest = (px: number, py: number) => Math.max(...pixel(px, py))
    const darkest = (px: number, py: number) => Math.min(...pixel(px, py))
    const [midX, midY, right, bottom] = [Math.floor(x + width / 2), Math.floor(y + height / 2), x + width, y + height]
    // each edge's 1 px ring falls on one or both of these two pixels, wherever the edge sits inside a pixel
    const edges = [
      [brightest(Math.floor(x - 1), midY), brightest(Math.floor(x), midY)],
      [brightest(Math.floor(right), midY), brightest(Math.floor(right + 1), midY)],
      [brightest(midX, Math.floor(y - 1)), brightest(midX, Math.floor(y))],
      [brightest(midX, Math.floor(bottom)), brightest(midX, Math.floor(bottom + 1))],
    ]
    const inside = [darkest(Math.ceil(x) + 3, midY), darkest(Math.floor(right) - 4, midY), darkest(midX, Math.ceil(y) + 3), darkest(midX, Math.floor(bottom) - 4)]
    return { edge: Math.max(...edges.map(pair => Math.min(...pair))), inside: Math.min(...inside) }
  }, { png, x, y, width, height })
  expect(edge, `${where}: the edge is darker than white`).toBeLessThanOrEqual(250)
  expect(inside, `${where}: the inside stays white`).toBeGreaterThanOrEqual(254)
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

/**
 * Presses Back from inside the page in the very moment it first draws each text of `drawn` in its selector on an address
 * holding `path`, before that drawing's effects have run, and resolves to the address once the frame after the Back has
 * run its own.
 */
const backOnDraw = (page: Page, path: string, drawn: Record<string, string>) =>
  page.evaluate(({ path, drawn }) => new Promise<string>(resolve => {
    new MutationObserver((_, observer) => {
      const shown = Object.entries(drawn).every(([selector, text]) => document.querySelector(selector)?.textContent?.includes(text))
      if (!location.pathname.includes(path) || !shown) return
      observer.disconnect()
      addEventListener('popstate', () => requestAnimationFrame(() => setTimeout(() => resolve(location.pathname))), { once: true })
      history.back()
    }).observe(document.body, { childList: true, subtree: true })
  }), { path, drawn })

test('Back pressed as the page draws the answer that grows its address returns to the modal', async ({ page }) => {
  const title = await openModal(page)
  // AnimeThemes answers the page and not the modal, so its songs and the address they grow come in one drawing
  const back = backOnDraw(page, '/title/', { '[data-themes]': 'Yuusha' })
  await modal(page).getByRole('link', { name: 'More details' }).click()
  expect(await back).toMatch(/^\/media\//)
  await expect(modal(page).locator('.header > span.title')).toHaveText(title)
})

const SEQUEL = 'ag:(anilist:900001)'

test('on the page, a relation card and a series graph node open the work\'s page with the flags carried', async ({ page }) => {
  await page.goto(`${origin}/`)
  const card = page.locator('a[href^="/media/"]').first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await page.goto(`${origin}${(await card.getAttribute('href'))!.replace('/media/', '/title/')}?store=graph`)

  await page.locator('[data-franchise-open]').click()
  await expect(page.locator('.work-node[title="Spec Sequel"]')).toHaveAttribute('href', `/title/${SEQUEL}?store=graph`)
  await page.keyboard.press('Escape')

  const relation = page.locator('[data-relations] a.relation-card')
  await expect(relation).toHaveAttribute('href', `/title/${SEQUEL}?store=graph`)
  await relation.click()
  await expect(page).toHaveURL(`${origin}/title/${SEQUEL}?store=graph`)
  await expect(heading(page)).toHaveText('Spec Sequel')
  await expect(modal(page)).toHaveCount(0)
})

test('a title opened from a relation starts fresh: what was opened on the last one does not carry over', async ({ page }) => {
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Expand' }).click()
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible()
  await page.locator('[data-relations] a.relation-card').filter({ hasText: 'Spec Third' }).click()
  await expect(heading(page)).toHaveText('Spec Third', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Expand' }), 'its description opens clamped').toBeVisible()
})

test('Back pressed as another title opened in the page draws the answer that grows its address returns to the first', async ({ page }) => {
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  // Spec Third's songs are AnimeThemes' answer, which grows its address; Spec Sequel shows the same songs until it is gone
  const back = backOnDraw(page, 'anilist:900002', { h1: 'Spec Third', '[data-themes]': 'Yuusha' })
  await page.locator('[data-relations] a.relation-card').filter({ hasText: 'Spec Third' }).click()
  expect(await back).toContain('anilist:900001')
  await expect(heading(page)).toHaveText('Spec Sequel')
})

// Spec Third carries no MyAnimeList id, so AniZip is never asked and no source names a row of it
const THIRD = 'ag:(anilist:900002)'

test('a title no source lists an episode of keeps its Episodes heading, and says so once every source has answered, in the modal too', async ({ page }) => {
  // four sources fetch what this rig refuses and never answer, so the message waits on their 30 s bound
  test.setTimeout(180_000)
  await page.goto(`${origin}/title/${THIRD}`)
  await expect(heading(page)).toHaveText('Spec Third', { timeout: 30_000 })
  const episodes = page.locator('[data-episodes]')
  await expect(episodes.getByRole('heading', { name: 'Episodes' })).toBeVisible()
  await expect(episodes.locator('.episode.placeholder').first(), 'rows held while a source is out').toBeVisible()
  await expect(episodes.locator('.episodes')).toHaveText('No episodes found', { timeout: 45_000 })
  await page.goto(`${origin}/media/${THIRD}`)
  await expect(modal(page).locator('.episode.placeholder').first()).toBeVisible({ timeout: 30_000 })
  await expect(modal(page).locator('.episodes')).toHaveText('No episodes found', { timeout: 45_000 })
})

const AIRING = 'ag:(anilist:900080)'

test('an unreleased episode AniList schedules reads when it airs, the next counting down, on the page and in the modal', async ({ page }) => {
  const dates = ['Sep 29, 2023', 'Sep 29, 2023', 'Sep 29, 2023', /^in (1 day|23 hours, \d+ mins)$/, 'in 8 days', 'in 15 days']
  await page.goto(`${origin}/title/${AIRING}`)
  await expect(heading(page)).toHaveText('Spec Airing', { timeout: 30_000 })
  await expect(page.locator('[data-episodes] .episode .side')).toHaveText(dates, { timeout: 30_000 })
  await page.goto(`${origin}/media/${AIRING}`)
  await expect(modal(page).locator('.episode .side')).toHaveText(dates, { timeout: 30_000 })
})

test('the page is a screen tall before anything has answered, so the footer waits below the fold, at 1440 and 390 px', async ({ page }) => {
  // screens taller than the page's placeholders, which on a 900 px screen already reach past the fold
  for (const [width, height] of [[1440, 2000], [390, 2400]] as const) {
    await page.setViewportSize({ width, height })
    // an address no source answers for, so the page stays as it first draws
    await page.goto(`${origin}/title/ag:(zz:1)`)
    await expect(page.locator('footer'), `${width}: drawn`).toBeAttached({ timeout: 30_000 })
    await expect(page.locator('h1 > [aria-hidden="true"]'), `${width}: the title held`).toBeVisible()
    expect(await page.locator('footer').evaluate(footer => footer.getBoundingClientRect().top), `${width}: below the fold`).toBeGreaterThanOrEqual(height)
  }
})

const height = (locator: Locator) => locator.evaluate(element => Math.round(element.getBoundingClientRect().height))
// a well-known show's sources: nine icons, copies of the first one drawn
const nineIcons = (origins: Locator) => origins.evaluate(row => { row.innerHTML = row.firstElementChild!.outerHTML.repeat(9) })
// whether a row scrolls sideways to what it cuts off
const scrolls = (row: Element) => {
  row.scrollLeft = row.scrollWidth
  return row.scrollLeft > 0
}

test('the preview\'s header and description are one size before the details answer and after, at 1440 and 390 px', async ({ page }) => {
  for (const [width, viewport] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height: viewport })
    const header = page.locator('.modal > .content > .header')
    const description = page.locator('.modal > .content > .description')
    // an address no source answers for, so the preview stays as it first draws
    await page.goto(`${origin}/media/ag:(zz:1)`)
    await expect(header.locator('.title-pending'), `${width}: held`).toBeVisible({ timeout: 30_000 })
    const held = { header: await height(header), description: await height(description) }

    // Spec Sequel, whose description is long enough to collapse at both widths: the placeholder holds the collapsed size
    await page.goto(`${origin}/media/${SEQUEL}`)
    await expect(header.locator('span.title')).toHaveText('Spec Sequel', { timeout: 30_000 })
    await expect(description).toHaveClass(/collapsed/)
    await expect(header.locator('.origins > .origin').first()).toBeVisible({ timeout: 30_000 })
    await nineIcons(header.locator('.origins'))
    expect({ header: await height(header), description: await height(description) }, `${width}`).toEqual(held)
    if (width === 390) {
      const middle = async (locator: Locator) => { const box = (await locator.boundingBox())!; return Math.round(box.y + box.height / 2) }
      expect(await middle(header.locator('.origins')), 'the icons share More details\' line').toBe(await middle(header.locator('.more')))
      expect(await header.locator('.origins').evaluate(scrolls), 'and scroll past its edge').toBe(true)
      expect(await header.locator('.origins').evaluate(row => getComputedStyle(row).maskImage), 'fading there').toContain('linear-gradient')
      expect(await overflowX(page)).toBe(0)
    }
  }
})

test('390 px wide, the title page holds two lines for its title, and its buttons are one row whatever its sources', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const buttons = page.locator('.actions > .buttons')
  await page.goto(`${origin}/title/ag:(zz:1)`)
  await expect(page.locator('h1 > [aria-hidden="true"]'), 'held').toBeVisible({ timeout: 30_000 })
  const held = { title: await height(heading(page)), buttons: await height(buttons) }

  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  // the control: a title of one line
  expect(held.title).toBe(2 * await height(heading(page)))
  await expect(buttons.locator('.origins > .origin').first()).toBeVisible({ timeout: 30_000 })
  await nineIcons(buttons.locator('.origins'))
  expect(await height(buttons)).toBe(held.buttons)
  expect(await buttons.evaluate(scrolls), 'the icons scroll past its edge').toBe(true)
  expect(await buttons.evaluate(row => getComputedStyle(row).maskImage), 'fading there').toContain('linear-gradient')
  expect(await overflowX(page)).toBe(0)
})

test('390 px wide, the title page holds its description collapsed with Expand under it, and its chips are one row whatever its sources', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const chips = page.locator('.heading > .chips')
  // from the description's top to the heading's bottom, under Expand once drawn
  const description = () => page.locator('.heading').evaluate(heading => Math.round(heading.getBoundingClientRect().bottom - heading.querySelector('.description')!.getBoundingClientRect().top))
  await page.goto(`${origin}/title/ag:(zz:1)`)
  await expect(page.locator('h1 > [aria-hidden="true"]'), 'held').toBeVisible({ timeout: 30_000 })
  const held = { description: await description(), chips: await height(chips) }

  // Spec Sequel, whose description is long enough to collapse
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible()
  expect(await description()).toBe(held.description)
  await chips.evaluate(row => { row.innerHTML = row.firstElementChild!.outerHTML.repeat(9) })
  expect(await height(chips)).toBe(held.chips)
  expect(await chips.evaluate(scrolls), 'the chips scroll past its edge').toBe(true)
  expect(await overflowX(page)).toBe(0)
})

test('in the preview, Relations and the episode list sit 4rem under what is above them, 2.5rem on a phone, held rows and drawn ones alike', async ({ page }) => {
  // from the block above to what `selector` names, the episode rows or the rows held while a source is out
  const gap = (selector: string) => page.locator('.modal > .content').evaluate((content, selector) => {
    const target = content.querySelector(selector)!
    const root = [...content.children].find(child => child.contains(target))!
    let above = root.previousElementSibling
    while (above && !above.getBoundingClientRect().height) above = above.previousElementSibling
    return { gap: Math.round(target.getBoundingClientRect().top - above!.getBoundingClientRect().bottom), relations: above!.hasAttribute('data-relations') }
  }, selector)
  for (const [width, height, expected] of [[1440, 900, 40], [390, 844, 25]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto(`${origin}/media/${THIRD}`)
    await expect(modal(page).locator('.episode.placeholder').first()).toBeVisible({ timeout: 30_000 })
    expect((await gap('.episodes')).gap, `${width} px, held`).toBe(expected)
    await openModal(page)
    await expect(modal(page).locator('[data-relations]')).toBeVisible({ timeout: 30_000 })
    await expect(modal(page).locator('.episode:not(.placeholder)').first()).toBeVisible({ timeout: 30_000 })
    expect((await gap('[data-relations]')).gap, `${width} px, Relations`).toBe(expected)
    expect(await gap('.episodes'), `${width} px, drawn under Relations`).toEqual({ gap: expected, relations: true })
  }
})

test('390 px wide, an episode row is as tall with its source icons and description as without them, and holds them all', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openModal(page)
  const rows = modal(page).locator('.episode')
  await expect(rows).toHaveCount(12, { timeout: 30_000 })
  const heights = () => rows.evaluateAll(episodes => episodes.map(row => Math.round(row.getBoundingClientRect().height)))
  const before = await heights()
  expect(new Set(before).size, 'every row one height').toBe(1)
  // the fixture matches no sources and describes no episode, so the first row gets five icons the size the
  // compact selector draws, and a description longer than the row shows
  await rows.first().locator('.content').evaluate(content => {
    content.querySelector('.origins')!.innerHTML = `<div style="display: flex; gap: 0.7rem">${'<span style="width: 2.8rem; height: 2.8rem; flex-shrink: 0"></span>'.repeat(5)}</div>`
    content.insertAdjacentHTML('beforeend', `<div class="description"><div class="ellipsis">${'A long episode description. '.repeat(20)}</div></div>`)
  })
  expect(await heights()).toEqual(before)
  const outside = await rows.first().evaluate(row => {
    const { bottom } = row.getBoundingClientRect()
    return [...row.querySelectorAll('.title, .origins > *, .description, .date')].map(element => Math.max(0, element.getBoundingClientRect().bottom - bottom))
  })
  expect(outside).toEqual(outside.map(() => 0))
})

test('a wider spelling of the same title keeps the page as it is', async ({ page }) => {
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Expand' }).click()
  // what the page itself does once a source names the work by more ids
  await page.evaluate(() => history.replaceState(null, '', '/title/ag:(anilist:900001,mal:900001)'))
  await expect(page).toHaveURL(/mal:900001/)
  await page.waitForTimeout(500)
  await expect(page.getByRole('button', { name: 'Collapse' }), 'the description stays open').toBeVisible()
})

test('in the modal, a relation card and a series graph node still open the modal', async ({ page }) => {
  await openModal(page)
  await expect(modal(page).locator('a.relation-card')).toHaveAttribute('href', `/media/${SEQUEL}`)
  await modal(page).locator('[data-franchise-open]').click()
  await expect(page.locator('.work-node[title="Spec Sequel"]')).toHaveAttribute('href', `/media/${SEQUEL}`)
})

// The Apothecary Diaries season 3's relations, five that play, and One Piece's 61 (tests/fake-fetch.ts)
const RELATED = [['ag:(anilist:900020)', 2], ['ag:(anilist:900030)', 21]] as const

test('in the modal, Relations are even rows of three a page, one card a row on a phone', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [width, height, columns] of [[1440, 900, 3], [390, 844, 1]] as const) {
    await page.setViewportSize({ width, height })
    for (const [uri, pages] of RELATED) {
      await page.goto(`${origin}/media/${uri}`)
      const relations = modal(page).locator('[data-relations]')
      const cards = relations.locator('a.relation-card')
      await expect(cards).toHaveCount(3, { timeout: 30_000 })
      // each card from the grid's top left corner
      const boxes = () => relations.evaluate(section => {
        const grid = section.querySelector('.grid')!.getBoundingClientRect()
        const cards = [...section.querySelectorAll('a.relation-card')].map(card => card.getBoundingClientRect())
        return { width: grid.width, cards: cards.map(card => ({ left: card.left - grid.left, top: card.top - grid.top, width: card.width })) }
      })
      const first = await boxes()
      const column = (first.width - (columns - 1) * 12) / columns
      first.cards.forEach((card, index) => {
        const where = `${width} px, ${uri}, card ${index + 1}`
        expect(card.width, where).toBeCloseTo(column, 0)
        expect(card.left, where).toBeCloseTo((index % columns) * (column + 12), 0)
        if (index % columns) expect(card.top, `${where}: beside the one before`).toBeCloseTo(first.cards[index - 1]!.top, 0)
        else if (index) expect(card.top, `${where}: under the one before`).toBeGreaterThan(first.cards[index - 1]!.top)
      })
      await relations.getByRole('navigation', { name: 'Relations pages' }).getByRole('button', { name: `Page ${pages}` }).click()
      await expect(relations.getByRole('button', { name: `Page ${pages}` })).toHaveAttribute('aria-current', 'page')
      const last = await boxes()
      for (const card of last.cards) expect(card.width, `${width} px, ${uri}, the last page`).toBeCloseTo(column, 0)
    }
  }
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

// AniList's fake lists Spike, Faye and Ed; MyAnimeList's page adds Jet, its other dubs and its staff.
test('MyAnimeList\'s characters and staff join AniList\'s on the page, given name first', async ({ page }) => {
  await page.goto(`${origin}/title/ag:(anilist:1,mal:1)`)
  const characters = page.locator('[data-characters]')
  const jet = characters.locator('li').filter({ hasText: 'Jet Black' })
  await expect(jet).toContainText('Unshou Ishizuka', { timeout: 30_000 })
  await expect(jet.locator('img').first()).toHaveAttribute('src', 'https://cdn.myanimelist.net/images/characters/11/253723.jpg')
  await expect(characters.locator('li').filter({ hasText: 'Spike Spiegel' })).toHaveCount(1)
  await characters.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'French' })
  await expect(jet).toContainText('Philippe Roullier')
  const staff = page.locator('[data-staff] li')
  await expect(staff.filter({ hasText: 'Shinichirou Watanabe' })).toHaveCount(1)
  await expect(staff.filter({ hasText: 'Kazuhiko Ikeguchi' })).toContainText('Producer')
})

test('a live-action title draws its cast and staff with no language picker', async ({ page }) => {
  await page.goto(`${origin}/title/ag:(omdb:tt0903747)`)
  await expect(heading(page)).toHaveText('Breaking Bad', { timeout: 30_000 })
  const characters = page.locator('[data-characters]')
  await expect(characters.locator('li').first()).toHaveText('Walter WhiteBryan Cranston')
  await expect(characters.getByRole('combobox')).toHaveCount(0)
  await expect(page.locator('[data-staff] li').filter({ hasText: 'Vince Gilligan' })).toContainText('Creator')
})

test('a show\'s page links each of its seasons, its own marked, at 1440 and 390 px with no sideways scroll', async ({ page }) => {
  const seasons = page.locator('[data-seasons] a')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${origin}/title/tmdb:93405-s2`)
    await expect(heading(page)).toHaveText('Squid Game', { timeout: 30_000 })
    await expect(seasons).toHaveText(['Season 1', 'Season 2', 'Season 3'], { timeout: 30_000 })
    await expect(seasons.nth(1)).toHaveAttribute('aria-current', 'page')
    expect(await overflowX(page)).toBe(0)
  }
  await seasons.nth(2).click()
  await expect(page).toHaveURL(/\/title\/ag:\([^/]*tmdb:93405-s3[,)]/)
  await expect(seasons.nth(2)).toHaveAttribute('aria-current', 'page', { timeout: 30_000 })
  // the modal links each season to its own modal
  await page.goto(`${origin}/media/tmdb:93405-s2`)
  await expect(modal(page).locator('[data-seasons] a').nth(0)).toHaveAttribute('href', '/media/ag:(tmdb:93405-s1)', { timeout: 30_000 })
})

test('a show\'s own address opens its first season, the Seasons row marking it', async ({ page }) => {
  await page.goto(`${origin}/title/tmdb:93405`)
  await expect(page).toHaveURL(/\/title\/ag:\([^/]*tmdb:93405-s1[,)]/, { timeout: 30_000 })
  const seasons = page.locator('[data-seasons] a')
  await expect(seasons).toHaveText(['Season 1', 'Season 2', 'Season 3'], { timeout: 30_000 })
  await expect(seasons.nth(0)).toHaveAttribute('aria-current', 'page')
})

// an address naming TVmaze alone drew an empty page: the source waited for a run nothing else could name, then refused
// the show (HOR-1003, Game of Thrones at series.fkn.app/title/ag:(tvmaze:82), 2026-10-25). The show's IMDb id then grew
// its address in the very commit that redirects to season 1, and on the page and in the modal that growth replaced the
// redirect with an address that drew nothing.
test('a show\'s own TVmaze address draws the show and opens its first season', async ({ page }) => {
  const seasons = page.locator('[data-seasons] a')
  for (const address of ['ag:(tvmaze:900200)', 'ag:(imdb:tt9002000,tvmaze:900200)']) {
    await page.goto(`${origin}/title/${address}`)
    await expect(heading(page), address).toHaveText('Spec Maze', { timeout: 30_000 })
    await expect(seasons.nth(0), address).toHaveAttribute('aria-current', 'page', { timeout: 30_000 })
    await expect(page, address).toHaveURL(/\/title\/ag:\([^/]*tvmaze:900200-s1[,)]/)
  }
  await expect(page.locator('.description')).toHaveText('Two ways out of one maze.')
  await expect(seasons).toHaveText(['Season 1', 'Season 2'])
  await page.reload()
  await expect(heading(page)).toHaveText('Spec Maze', { timeout: 30_000 })
  await expect(seasons.nth(0)).toHaveAttribute('aria-current', 'page', { timeout: 30_000 })

  await page.goto(`${origin}/media/ag:(tvmaze:900200)`)
  await expect(modal(page).locator('[data-seasons] a').nth(0)).toHaveAttribute('aria-current', 'page', { timeout: 30_000 })
  await expect(page).toHaveURL(/\/media\/ag:\([^/]*tvmaze:900200-s1[,)]/)
})

test('a show with one season draws no Seasons row', async ({ page }) => {
  await page.goto(`${origin}/title/tmdb:209867-s1`)
  await expect(heading(page)).toHaveText('Frieren: Beyond Journey\'s End', { timeout: 30_000 })
  await expect(page.locator('[data-seasons]')).toHaveCount(0)
})

test('Themes lists each song, plays one at a time in the media player under its row, and 390 px wide has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
  // every script the page loads, read for a string only @banou/media-player's styles carry
  const scripts: Promise<string>[] = []
  page.on('response', response => { if (response.request().resourceType() === 'script') scripts.push(response.text().catch(() => '')) })
  const playerLoaded = async () => (await Promise.all(scripts)).some(script => script.includes('var(--mp-unit)'))
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
  expect(await playerLoaded(), 'the player loads on the first Play, not with the page').toBe(false)
  const advances = () => expect.poll(() => videos.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0)

  await rows.nth(0).getByRole('button', { name: 'Play' }).click()
  await expect(rows.nth(0).locator('video')).toHaveAttribute('src', 'https://v.animethemes.moe/SousouNoFrieren-OP1.webm')
  await advances()
  await expect.poll(playerLoaded).toBe(true)
  await expect(rows.nth(0).getByRole('button', { name: 'Full screen' }), 'the media player\'s controls').toHaveCount(1)
  await rows.nth(1).getByRole('button', { name: 'Play' }).click()
  await expect(videos).toHaveCount(1)
  await expect(rows.nth(1).locator('video')).toHaveAttribute('src', 'https://v.animethemes.moe/SousouNoFrieren-OP2.webm')
  await advances()
  expect(await videos.evaluate(video => (video as HTMLVideoElement).muted)).toBe(false)
  expect(await overflowX(page)).toBe(0)
  await rows.nth(1).getByRole('button', { name: 'Stop' }).click()
  await expect(videos).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), PLAYER_VOLUME_KEY), 'nothing kept for a viewer who changed nothing').toBeNull()
})

test('a theme starts at the volume and mute last left in a player, and the next one at what was picked in it', async ({ page }) => {
  await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  await page.evaluate(([key, kept]) => localStorage.setItem(key!, kept!), [PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0.3, muted: true })])
  const rows = page.locator('[data-themes] li')
  const sound = (row: Locator) => () => row.locator('video').evaluate(video => ({ volume: (video as HTMLVideoElement).volume, muted: (video as HTMLVideoElement).muted }))

  await rows.nth(0).getByRole('button', { name: 'Play' }).click({ timeout: 30_000 })
  await expect.poll(sound(rows.nth(0))).toEqual({ volume: 0.3, muted: true })
  const mute = rows.nth(0).getByRole('button', { name: 'Mute' })
  await expect(mute).toHaveAttribute('aria-pressed', 'true')

  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await rows.nth(1).getByRole('button', { name: 'Play' }).click()
  await expect.poll(sound(rows.nth(1))).toEqual({ volume: 0.3, muted: false })
})

test('the source row links the TMDB, TheTVDB and IMDb ids AniZip names', async ({ page }) => {
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const origins = page.locator('.origins')
  await expect(origins.locator('a[title="TMDB"]')).toHaveAttribute('href', 'https://www.themoviedb.org/tv/209867', { timeout: 30_000 })
  await expect(origins.locator('a[title="TheTVDB"]')).toHaveAttribute('href', 'https://thetvdb.com/dereferrer/series/424536')
  await expect(origins.locator('a[title="IMDb"]')).toHaveAttribute('href', 'https://www.imdb.com/title/tt22248376')
})

test('an icon hidden in Settings leaves the row beside Play', async ({ page }) => {
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const origins = page.locator('.actions .origins')
  await expect(origins.locator('a[title="AnimeThemes"]'), 'the control: drawn while shown').toBeVisible({ timeout: 30_000 })
  const title = page.url()

  await page.addInitScript(key => localStorage.setItem(key, '["animethemes"]'), HIDDEN_ICONS_KEY)
  await page.goto(title)
  // its songs on the page are AnimeThemes' answer, so its icon would be drawn by now
  await expect(page.locator('[data-themes] li').first()).toContainText('Yuusha', { timeout: 30_000 })
  await expect(origins.locator('a[title="TMDB"]')).toBeVisible()
  await expect(origins.locator('a[title="AnimeThemes"]')).toHaveCount(0)
})

test('the watch page lists no source it has nothing to open for', async ({ page }) => {
  // TMDB names the episode but has no page for it; the Netflix release named in the address is the control
  await page.goto(`${origin}/watch/tmdb:93405-s1/tmdb:93405-s1e1/nf:81040344`)
  const list = page.locator('.list')
  await expect(list.locator('a[title="Netflix"]')).toBeVisible({ timeout: 30_000 })
  await expect(list.locator('a[title="TMDB"]')).toHaveCount(0)
})

const box = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect)

/** The second episode's watch page of the first work the home page lists, once both its neighbours are linked. */
const secondEpisode = async (page: Page) => {
  await openModal(page)
  await page.goto(`${origin}${await modal(page).locator('a.episode-link').nth(1).getAttribute('href')}`)
  await expect(page.getByRole('link', { name: 'Previous episode' })).toHaveAttribute('title', /^E1 - /, { timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Next episode' })).toHaveAttribute('title', /^E3 - /)
}

// HOR-1011: big buttons at the page's two ends, each naming the episode it opens
test('the watch page\'s episode buttons stand big at the two ends of its row, Back returns, and below 1100 px they share a line under the episode', async ({ page }) => {
  await secondEpisode(page)
  const previous = page.getByRole('link', { name: 'Previous episode' })
  const next = page.getByRole('link', { name: 'Next episode' })
  await expect(next.locator('.step-target')).toHaveText(/^E3 - /)
  await next.click()
  await expect(page.locator('.episode-title')).toHaveText(/^E3 - /)
  await page.goBack()
  await expect(page.locator('.episode-title')).toHaveText(/^E2 - /)

  const row = page.locator('.episode-row')
  const main = page.locator('.episode-main')
  for (const [width, height] of [[1440, 900], [1101, 800], [1100, 800], [1024, 768], [820, 1180], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    const [edges, left, right, episode] = await Promise.all([box(row), box(previous), box(next), box(main)])
    expect(Math.abs(left.left - edges.left), `${width} px: Previous at the row's left end`).toBeLessThan(1)
    expect(Math.abs(right.right - edges.right), `${width} px: Next at its right end`).toBeLessThan(1)
    expect(Math.min(left.height, right.height), `${width} px: big enough to hit`).toBeGreaterThanOrEqual(56)
    if (width > 1100) {
      expect(left.right, `${width} px: the episode between them`).toBeLessThan(episode.left)
      expect(right.left).toBeGreaterThan(episode.right)
    } else {
      expect(episode.width, `${width} px: the episode across the row`).toBeCloseTo(edges.width, 0)
      expect(left.top, `${width} px: the buttons under it`).toBeGreaterThanOrEqual(episode.bottom)
      expect(right.top, 'on one line').toBe(left.top)
    }
  }
  expect(await overflowX(page)).toBe(0)
})

// HOR-1011: between a phone and a wide window the two buttons squeezed the episode into a column 81 px
// wide and the row 384 px tall (769 px, the review of 2026-10-26)
test('the watch page\'s episode buttons leave the episode at least half its row, however long the episodes they name', async ({ page }) => {
  await secondEpisode(page)
  await page.locator('.step-target').evaluateAll(([previous, next]) => {
    previous!.textContent = "E1 - The Journey's End and the Long Road Home"
    next!.textContent = 'E3 - Killing Magic Is Not the Same as Being Strong'
  })
  const row = page.locator('.episode-row')
  for (const [width, height] of [[1440, 900], [1101, 800], [1024, 768], [820, 1180], [769, 1024]] as const) {
    await page.setViewportSize({ width, height })
    const [edges, episode] = await Promise.all([box(row), box(page.locator('.episode-main'))])
    expect(episode.width / edges.width, `${width} px: the episode's share of the row`).toBeGreaterThanOrEqual(0.5)
    expect(edges.height, `${width} px: the row's height`).toBeLessThan(200)
  }
})

// HOR-1011: on a wide window Previous is drawn first and Next last, while the page lists them after the
// episode for a phone, which draws them under it
test('Tab reaches the watch page\'s episode buttons in the order they are drawn, at 1440 px and at 820 px', async ({ page }) => {
  await secondEpisode(page)
  await expect(page.locator('.watch-info .tracking-compact .group.platforms > *').first()).toBeVisible({ timeout: 30_000 })
  const order = async () => {
    await page.locator('.episode-row').evaluate(row => {
      const start = Object.assign(document.createElement('button'), { className: 'tab-start' })
      row.before(start)
      start.focus()
    })
    const reached: string[] = []
    for (let step = 0; step < 40 && reached.at(-1) !== 'last'; step++) {
      await page.keyboard.press('Tab')
      const at = await page.evaluate(() => {
        const focused = document.activeElement
        if (!focused?.closest('.episode-row')) return 'last'
        return focused.closest('.episode-step')?.classList.contains('previous') ? 'previous'
          : focused.closest('.episode-step') ? 'next'
          : 'episode'
      })
      if (reached.at(-1) !== at) reached.push(at)
    }
    await page.locator('.tab-start').evaluate(start => start.remove())
    return reached
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  expect(await order()).toEqual(['previous', 'episode', 'next', 'last'])
  await page.setViewportSize({ width: 820, height: 1180 })
  expect(await order(), 'the episode first where it is drawn first').toEqual(['episode', 'previous', 'next', 'last'])
})

// HOR-1011: the score, status, episodes and trackers together, right under the title
test('the watch page\'s tracking sits under the title, its trackers right after its controls, at 1440 px and at 390 px', async ({ page }) => {
  await secondEpisode(page)
  const info = page.locator('.episode-info')
  const tracking = page.locator('.watch-info .tracking-compact')
  const controls = tracking.locator('.group.edit')
  const trackers = tracking.locator('.group.platforms')
  await expect(trackers.locator('> *').first()).toBeVisible({ timeout: 30_000 })

  await page.setViewportSize({ width: 1440, height: 900 })
  const [title, row, edit, chips] = await Promise.all([box(info), box(tracking), box(controls), box(trackers)])
  expect(row.top, 'under the title').toBeGreaterThanOrEqual(title.bottom)
  expect(Math.abs(row.left - title.left), 'from the title\'s left edge').toBeLessThan(1)
  expect(Math.abs(chips.top - edit.top), 'the trackers on the controls\' line').toBeLessThan(4)
  expect(chips.left - edit.right, 'and right after them').toBeLessThan(20)

  await page.setViewportSize({ width: 390, height: 844 })
  expect((await box(tracking)).top).toBeGreaterThanOrEqual((await box(info)).bottom)
  expect(await overflowX(page)).toBe(0)
})

test('a theme still plays when the player\'s chunk is gone, as after a deploy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
  await page.route(/\/theme-player-[^/]*\.js$/, route => route.fulfill({ status: 404 }))
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const row = page.locator('[data-themes] li').nth(0)
  await row.getByRole('button', { name: 'Play' }).click({ timeout: 30_000 })
  const video = row.locator('video')
  await expect(video).toHaveAttribute('src', 'https://v.animethemes.moe/SousouNoFrieren-OP1.webm')
  await expect.poll(() => video.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  const [player, box] = await Promise.all([row.locator('.player').boundingBox(), video.boundingBox()])
  expect(box, 'the video fills its 16:9 box').toEqual(player)
  expect(await overflowX(page)).toBe(0)
})

test('a playing theme takes its keys only from inside the player, so Space and the arrows still scroll the page and press its buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://v.animethemes.moe/**', route => route.fulfill({ path: join(ROOT, 'tests', 'fixtures', 'themes', 'theme.webm'), contentType: 'video/webm' }))
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const row = page.locator('[data-themes] li').nth(0)
  await row.getByRole('button', { name: 'Play' }).click({ timeout: 30_000 })
  const video = row.locator('video')
  await expect(row.getByRole('button', { name: 'Full screen' })).toHaveCount(1)
  // the fixture lasts 4 seconds, and an ended video reads as paused
  await video.evaluate(video => { (video as HTMLVideoElement).loop = true })
  await expect.poll(() => video.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  const paused = () => video.evaluate(video => (video as HTMLVideoElement).paused)
  // a click on the heading before each key, since a second key scroll after the first was measured
  // dropped by Chromium in 3 runs of 60
  const scrolls = async (key: string) => {
    await heading(page).click()
    const before = await page.evaluate(() => scrollY)
    await page.keyboard.press(key)
    await expect.poll(() => page.evaluate(() => scrollY), `${key} on the page heading scrolls the page`).toBeGreaterThan(before)
  }

  await scrolls('Space')
  expect(await paused(), 'Space outside the player leaves the video playing').toBe(false)
  const volume = await video.evaluate(video => (video as HTMLVideoElement).volume)
  await scrolls('ArrowDown')
  expect(await video.evaluate(video => (video as HTMLVideoElement).volume), 'ArrowDown outside the player leaves the volume').toBe(volume)

  // the control: a key from inside the player is still its own
  await video.click()
  await expect.poll(paused, 'a click on the video pauses it').toBe(true)
  await page.keyboard.press('Space')
  await expect.poll(paused, 'and Space then plays it').toBe(false)

  await row.getByRole('button', { name: 'Stop' }).focus()
  await page.keyboard.press('Space')
  await expect(video, 'Space on Stop stops the theme').toHaveCount(0)
})

test('Episodes draws a page of 12, in the modal too, and its controls move through the rest', async ({ page }) => {
  await openModal(page)
  // the control: AniZip lists 26 episodes (tests/fake-fetch.ts)
  await expect(modal(page).locator('.episode')).toHaveCount(12, { timeout: 30_000 })
  await expect(modal(page).getByRole('navigation', { name: 'Episodes pages' }).getByRole('button', { name: 'Page 3' })).toBeVisible()
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const episodes = page.locator('[data-episodes]')
  const numbers = episodes.locator('.episode .number')
  await expect(numbers).toHaveText(Array.from({ length: 12 }, (_, index) => `${index + 1}`), { timeout: 30_000 })
  const pages = episodes.getByRole('navigation', { name: 'Episodes pages' })
  await pages.getByRole('button', { name: 'Next page' }).click()
  await expect(numbers).toHaveText(Array.from({ length: 12 }, (_, index) => `${index + 13}`))
  await pages.getByRole('button', { name: 'Page 3' }).click()
  await expect(numbers).toHaveText(['25', '26'])
  await expect(pages.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page')
  await expect(pages.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true')
})

// how far a list's controls sit below the list's top, each slot's left edge, and how many lines they take
const place = (pages: Locator) => pages.evaluate(nav => {
  const slots = [...nav.children].filter(slot => slot.getAttribute('role') !== 'status').map(slot => slot.getBoundingClientRect())
  const below = nav.getBoundingClientRect().top - nav.previousElementSibling!.getBoundingClientRect().top
  return { below: Math.round(below), lefts: slots.map(slot => Math.round(slot.left)), lines: new Set(slots.map(slot => Math.round(slot.top))).size }
})

// AniZip lists 1,100 episodes for mal:21 (tests/fake-fetch.ts), 92 pages of 12
const LONG = `/title/ag:(mal:21)`

test('a long list draws one page, and its controls move through it in place, at 1440 and 390 px', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${origin}${LONG}`)
    const episodes = page.locator('[data-episodes]')
    const numbers = episodes.locator('.episode .number')
    const pages = episodes.getByRole('navigation', { name: 'Episodes pages' })
    await expect(pages.getByRole('button')).toHaveText(['', '1', '2', '3', '4', '5', '…', '92', ''], { timeout: 30_000 })
    await expect(numbers).toHaveCount(12)
    const first = await place(pages)
    expect(first.lines, `${width}: the controls sit on one line`).toBe(1)

    await pages.getByRole('button', { name: 'Next page' }).click()
    await expect(numbers.first()).toHaveText('13')
    await expect(pages.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
    // the list is taller than the screen, so paging from under it brings its first row back into view, under the header
    const { y } = (await episodes.locator('.episode').first().boundingBox())!
    const header = (await page.locator('header').first().boundingBox())!
    expect(y, `${width}: the new page's first row is clear of the header`).toBeGreaterThanOrEqual(header.y + header.height)
    expect(y, `${width}: the new page's first row is in view`).toBeLessThan(844)

    await pages.getByRole('button', { name: 'Page 5' }).click()
    await expect(pages.getByRole('button')).toHaveText(['', '1', '…', '4', '5', '6', '…', '92', ''])
    expect((await place(pages)).lefts, `${width}: the slots stay put`).toEqual(first.lefts)
    // the gap after page 6 leads halfway to 92
    await pages.getByRole('button', { name: 'Page 49' }).click()
    await expect(numbers.first()).toHaveText('577')
    await expect(pages.getByRole('button')).toHaveText(['', '1', '…', '48', '49', '50', '…', '92', ''])
    expect((await place(pages)).lefts, `${width}: the slots stay put`).toEqual(first.lefts)
    await pages.getByRole('button', { name: 'Page 92' }).click()
    await expect(numbers).toHaveText(Array.from({ length: 8 }, (_, index) => `${index + 1093}`))
    expect((await place(pages)).lefts, `${width}: the slots stay put`).toEqual(first.lefts)
    expect(await overflowX(page)).toBe(0)
  }
})

test('paging a list that is all on screen to its short last page leaves the controls where they were', async ({ page }) => {
  for (const width of [1440, 390]) {
    // at 390 px the controls end at 3,075 px, under the facts held for the sources this rig never answers
    await page.setViewportSize({ width, height: 3400 })
    await page.goto(`${origin}${LONG}`)
    const episodes = page.locator('[data-episodes]')
    const numbers = episodes.locator('.episode .number')
    const pages = episodes.getByRole('navigation', { name: 'Episodes pages' })
    await expect(numbers).toHaveCount(12, { timeout: 30_000 })
    // AniList answers last, with one relation, so the page of them held above the list at 390 px settles: a click on a
    // control still moving is retried by Playwright with the control scrolled to the screen's middle, which this would then measure
    await expect(page.locator('[data-relations]')).toBeVisible({ timeout: 30_000 })
    const first = await place(pages)
    const scrolled = await page.evaluate(() => scrollY)
    await pages.getByRole('button', { name: 'Page 92' }).click()
    await expect(numbers).toHaveCount(8)
    expect(await place(pages), `${width}: the controls stay put`).toEqual(first)
    expect(await page.evaluate(() => scrollY), `${width}: and the page did not scroll`).toBe(scrolled)
  }
})

const onPage = (locator: Locator) => locator.evaluate(element => Math.round(element.getBoundingClientRect().top + scrollY))

// where `selector` sits on the page in every frame drawn from now on, so a move undone a frame later is seen too
const everyFrame = async (page: Page, selector: string) => {
  await page.evaluate(selector => {
    const tops = new Set<number>()
    const record = () => {
      const element = document.querySelector(selector)
      if (element) tops.add(Math.round(element.getBoundingClientRect().top + scrollY))
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
    Object.assign(window, { tops })
  }, selector)
  return () => page.evaluate(() => [...(window as unknown as { tops: Set<number> }).tops])
}

// AniList answers anilist:900010 five seconds late, after AniZip's title and 26 episodes for mal:900010, with its
// description, facts and four relations, and AniZip names that AniList id, so the MAL address reaches AniList through
// it (tests/fake-fetch.ts)
for (const late of ['ag:(anilist:900010,mal:900010)', 'ag:(mal:900010)']) {
  test(`390 px wide, the description, facts and Relations keep their place while AniList answers ${late} late, so the episode page buttons stay put`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/title/${late}`)
    const pages = page.locator('[data-episodes]').getByRole('navigation', { name: 'Episodes pages' })
    await expect(pages).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-relations]'), 'the control: AniList has not answered yet').toHaveCount(0)
    const held = await onPage(pages)
    const tops = await everyFrame(page, '[data-episodes] nav')
    await expect(page.locator('[data-relations] a.relation-card')).toHaveCount(3, { timeout: 30_000 })
    await expect(page.locator('.facts'), 'the control: with its facts').toContainText('Spec Tag 30')
    await expect(page.getByRole('button', { name: 'Expand' }), 'and its description').toBeVisible()
    expect(await tops()).toEqual([held])
    // a short value's box runs to the line's end, so the fade there is past its text
    expect(await page.locator('.facts > div').first().evaluate(line => Math.round(line.getBoundingClientRect().right - line.querySelector('dd')!.getBoundingClientRect().right))).toBe(0)
    // a Japanese title, drawn in a fallback font, keeps its line as tall as the rest
    const line = page.locator('.facts > div').first()
    const tall = await height(line)
    await line.locator('dd').evaluate(value => { value.textContent = '薬屋のひとりごと' })
    expect(await height(line)).toBe(tall)
    expect(await overflowX(page)).toBe(0)
  })
}

test('1440 px wide, the Relations held are a row of cards as tall as the row drawn, with no page buttons, which a row seldom needs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/title/ag:(anilist:900010,mal:900010)`)
  const held = page.locator('.relations.placeholder')
  await expect(held).toBeVisible({ timeout: 30_000 })
  const row = await height(held)
  const relations = page.locator('[data-relations]')
  await expect(relations.locator('a.relation-card')).toHaveCount(3, { timeout: 30_000 })
  // from the heading's top to the cards' bottom, above the page buttons four relations need
  expect(await relations.evaluate(section => Math.round(section.querySelector('.grid')!.getBoundingClientRect().bottom - section.getBoundingClientRect().top))).toBe(row)
})

test('a fact is one line where the facts sit above the lists, at a tablet\'s 800 px too, and wraps beside them at 1440 px', async ({ page }) => {
  const line = (label: string) => page.locator('.facts > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
  for (const [width, oneLine] of [[800, true], [1440, false]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${origin}/title/ag:(anilist:900010,mal:900010)`)
    await expect(line('Tags')).toContainText('Spec Tag 30', { timeout: 30_000 })
    expect(await height(line('Tags')) === await height(line('Format')), `${width} px`).toBe(oneLine)
  }
})

// AniList answers Spec Rated with its score and one relation, and JustWatch, finding it by that title, five seconds
// later with four ratings (tests/fake-fetch.ts)
const RATED = 'ag:(anilist:900040,mal:900040)'
const RATED_CHIPS = ['26 Episodes', 'TV Show', 'Finished', '82%', 'IMDb 8.0', 'TMDB 8.7', 'Rotten Tomatoes 92%', 'JustWatch 95%']

test('390 px wide, the ratings JustWatch gives late are chips after the score, so the episode page buttons stay put', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/title/${RATED}`)
  const pages = page.locator('[data-episodes]').getByRole('navigation', { name: 'Episodes pages' })
  await expect(page.locator('[data-relations]'), 'AniList has answered').toBeVisible({ timeout: 30_000 })
  await expect(pages).toBeVisible()
  const ratings = page.locator('.body').getByText(/IMDb 8\.0/)
  await expect(ratings, 'the control: JustWatch has not answered yet').toHaveCount(0)
  const held = await onPage(pages)
  const tops = await everyFrame(page, '[data-episodes] nav')
  await expect(ratings).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  expect(await tops()).toEqual([held])
  const row = page.locator('.heading > .chips')
  const chips = row.locator('.chip')
  await expect(chips).toHaveText(RATED_CHIPS)
  expect(await overflowX(page), 'the row scrolls, not the page').toBe(0)
  expect(await chips.evaluateAll(boxes => boxes.every(chip => chip.scrollWidth <= chip.clientWidth && chip.scrollHeight <= chip.clientHeight)), 'each chip\'s text fits it').toBe(true)
  await row.evaluate(box => { box.scrollLeft = box.scrollWidth })
  expect(await row.evaluate(box => Math.round(box.getBoundingClientRect().right - box.lastElementChild!.getBoundingClientRect().right)), 'scrolled to its end, the last chip is clear of the 3rem fade').toBeGreaterThanOrEqual(30)
})

test('the ratings are chips after the score, one row at 1024 px as at 1440 px, where all show, and a title JustWatch alone names shows them too', async ({ page }) => {
  const row = page.locator('.heading > .chips')
  const chips = row.locator('.chip')
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${origin}/title/${RATED}`)
    await expect(chips).toHaveText(RATED_CHIPS, { timeout: 30_000 })
    expect(await height(row), `${width} px: one row`).toBe(await height(chips.first()))
  }
  await expect(chips.last()).toBeInViewport({ ratio: 1 })
  // its second season, listed with no episodes, so its ratings are its only chips
  await page.goto(`${origin}/title/jw:900040-900042`)
  await expect(heading(page)).toHaveText('Spec Rated', { timeout: 30_000 })
  await expect(chips).toHaveText(RATED_CHIPS.slice(4))
})

// AniList answers Spec Film, a film with a description and one relation, and JustWatch, finding it by that title, five
// seconds later with its TMDB id and seven services that link out (tests/fake-fetch.ts)
const FILM = 'ag:(anilist:900050)'
const FILM_SOURCES = ['HIDIVE', 'Hoopla', 'Philo', 'Plex', 'Pluto TV', 'The Roku Channel', 'Tubi']
const FILM_VIEWS = [
  { path: `/media/${FILM}`, row: '.modal .description + .watch', below: '.modal [data-relations]' },
  { path: `/title/${FILM}`, row: '.heading > .description ~ .watch', below: '.body > .actions' },
]

// what a film's button looks like: the watch page's 3.2rem icon, its name at 1.45rem weight 600, and ↗ for a site
const look = (link: Element) => {
  const icon = link.querySelector('.icon')!.getBoundingClientRect()
  const name = getComputedStyle(link.querySelector('.name')!)
  return { icon: [Math.round(icon.width), Math.round(icon.height)], name: [name.fontSize, name.fontWeight], marker: link.querySelector('.ext')?.textContent }
}
// how many lines a film's buttons take, how far a name falls short of its box, whether a line left room for the
// button wrapped after it, and whether each one is inside their row
const packing = (buttons: Locator) => buttons.evaluateAll(links => {
  const row = links[0]!.parentElement!
  const { left, right } = row.getBoundingClientRect()
  const gap = parseFloat(getComputedStyle(row).columnGap)
  const boxes = links.map(link => link.getBoundingClientRect())
  const range = document.createRange()
  const slack = links.map(link => {
    const name = link.querySelector('.name')!
    range.selectNodeContents(name)
    return name.getBoundingClientRect().width - range.getBoundingClientRect().width
  })
  const wrapped = (index: number) => index > 0 && Math.round(boxes[index]!.top) > Math.round(boxes[index - 1]!.top)
  return {
    lines: 1 + boxes.filter((_, index) => wrapped(index)).length,
    slack: Math.round(Math.max(...slack)),
    roomLeft: boxes.some((box, index) => wrapped(index) && boxes[index - 1]!.right + gap + box.width <= right),
    inside: boxes.every(box => box.left >= left && box.right <= right),
  }
})

test('a film lists every place to watch it under its description as the watch page\'s buttons, side by side, in the modal and on its page, and with none in stub has no play bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const { path, row } of FILM_VIEWS) {
    await page.goto(`${origin}${path}`)
    const buttons = page.locator(row).locator('a')
    await expect(buttons, path).toHaveCount(FILM_SOURCES.length, { timeout: 30_000 })
    expect((await buttons.locator('.name').allTextContents()).sort(), path).toEqual(FILM_SOURCES)
    const button = (name: string) => buttons.filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
    await expect(button('Tubi')).toHaveAttribute('href', 'https://tubitv.com/movies/900051')
    await expect(button('Plex')).toHaveAttribute('href', 'https://watch.plex.tv/movie/spec-film?utm_content=5d77708f594b2b001e74d1ea')
    expect(await buttons.evaluateAll(links => links.every(link => link.getAttribute('target') === '_blank')), `${path}: each opens its site in a new tab`).toBe(true)
    expect(await buttons.first().evaluate(look), path).toEqual({ icon: [32, 32], name: ['14.5px', '600'], marker: '↗' })
    await expect(page.locator(row).locator('.label'), `${path}: no label`).toHaveCount(0)
    const { lines, slack, roomLeft, inside } = await packing(buttons)
    expect(slack, `${path}: each as wide as what it holds`).toBe(0)
    expect(roomLeft, `${path}: a line holds every button that fits`).toBe(false)
    expect(lines, `${path}: side by side`).toBeLessThan(FILM_SOURCES.length)
    expect(inside, `${path}: none past the row's edge`).toBe(true)
    if (path.startsWith('/media/')) {
      await expect(modal(page).locator('.movie > .facts'), 'the control: the film\'s line').toHaveCount(1)
      await expect(modal(page).locator('.movie .play-bar')).toHaveCount(0)
    }
  }
})

// the modal's play bar holds Play's place until then, and no Play comes, so it goes as the buttons land
test('390 px wide, a film\'s buttons are as wide as what they hold, as many to a line as fit, the first line landing in the place held for it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const { path, row, below } of FILM_VIEWS) {
    await page.goto(`${origin}${path}`)
    const buttons = page.locator(row).locator('a')
    const bar = page.locator('.modal .movie .play-bar')
    const pending = page.locator(row).locator('.pending')
    await expect(page.locator(below), path).toBeVisible({ timeout: 30_000 })
    await expect(pending, `${path}: the control: held while JustWatch has not answered`).toBeVisible()
    const placeholder = (await pending.boundingBox())!
    const heldRow = await height(page.locator(row))
    const held = await onPage(page.locator(below))
    const film = await page.locator('.modal .movie').evaluateAll(blocks => blocks.map(block => Math.round(block.getBoundingClientRect().height)))
    const tops = await everyFrame(page, below)
    await expect(buttons, path).toHaveCount(FILM_SOURCES.length, { timeout: 30_000 })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await expect(bar, path).toHaveCount(0)
    const drop = film.length ? film[0]! - await height(page.locator('.modal .movie')) : 0
    const first = (await buttons.first().boundingBox())!
    expect(Math.round(first.height), `${path}: a button is as tall as the place held`).toBe(Math.round(placeholder.height))
    expect(Math.round(first.y), `${path}: and lands in it`).toBe(Math.round(placeholder.y) - drop)
    const grow = await height(page.locator(row)) - heldRow
    expect(await tops(), `${path}: what is under them moves by the lines past the first`).toEqual([...new Set([held, held - drop + grow])])
    const { lines, slack, roomLeft, inside } = await packing(buttons)
    expect(slack, `${path}: each as wide as what it holds`).toBe(0)
    expect(roomLeft, `${path}: a line holds every button that fits`).toBe(false)
    expect(lines, `${path}: they wrap`).toBeGreaterThan(1)
    expect(lines, `${path}: side by side, not one column`).toBeLessThan(FILM_SOURCES.length)
    expect(inside, `${path}: none past the row's edge`).toBe(true)
    expect(await overflowX(page), `${path}: nothing runs past the page`).toBe(0)
  }
})

test('390 px wide, a film\'s button with a name longer than its row wraps the name and stays inside, its marker shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const { path, row } of FILM_VIEWS) {
    await page.goto(`${origin}${path}`)
    const buttons = page.locator(row).locator('a')
    await expect(buttons, path).toHaveCount(FILM_SOURCES.length, { timeout: 30_000 })
    const name = buttons.first().locator('.name')
    const tall = await height(buttons.first())
    await name.evaluate(name => { name.textContent = 'A Streaming Service With A Very Long Name, With Ads' })
    expect(await height(buttons.first()), `${path}: the name takes a second line`).toBeGreaterThan(tall)
    expect(await name.evaluate(name => name.scrollWidth <= name.clientWidth), `${path}: none of the name cut off`).toBe(true)
    expect(await buttons.first().evaluate(link => link.querySelector('.ext')!.getBoundingClientRect().right <= link.getBoundingClientRect().right), `${path}: the marker inside`).toBe(true)
    expect((await packing(buttons)).inside, `${path}: none past the row's edge`).toBe(true)
    expect(await overflowX(page), `${path}: nothing runs past the page`).toBe(0)
  }
})

// every site the icon row at `row` draws from the first frame, however briefly
const recordSites = (page: Page, row: string) => page.addInitScript(row => {
  const seen = new Set<string>()
  const record = () => {
    for (const site of document.querySelectorAll(`${row} > .origin`)) seen.add(site.getAttribute('title')!)
    requestAnimationFrame(record)
  }
  requestAnimationFrame(record)
  Object.assign(window, { seen })
}, row)
const sitesSeen = (page: Page) => page.evaluate(() => [...(window as unknown as { seen: Set<string> }).seen])

test('a film\'s title page keeps the catalogue sites beside Play, and none of the services its buttons name, at any point, opened again at the address it grew to', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const row = '.body > .actions .origins'
  await recordSites(page, row)
  for (const load of ['opened', 'reloaded', 'reloaded again']) {
    await (load === 'opened' ? page.goto(`${origin}/title/${FILM}`) : page.reload())
    // JustWatch alone names TMDB, so the row has drawn its sites for every origin JustWatch's answer named
    await expect(page.locator(`${row} > [title="TMDB"]`), `${load}: JustWatch has answered`).toHaveCount(1, { timeout: 30_000 })
    const seen = await sitesSeen(page)
    expect(seen, `${load}: the control: a catalogue site stays`).toContain('AniList')
    expect(seen.filter(site => FILM_SOURCES.includes(site)), load).toEqual([])
    await expect(page, `${load}: the control: at the address naming every service`).toHaveURL(/jw:900050/)
  }
})

test('a film\'s modal keeps the catalogue sites next to its title, and none of the services its buttons name, at any point', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const row = '.modal .content > .header .origins'
  await recordSites(page, row)
  await page.goto(`${origin}/media/${FILM}`)
  await expect(page.locator(`${row} > [title="TMDB"]`), 'JustWatch has answered').toHaveCount(1, { timeout: 30_000 })
  await expect(modal(page).locator('.description + .watch a'), 'the control: the services are the buttons').toHaveCount(FILM_SOURCES.length)
  const seen = await sitesSeen(page)
  expect(seen, 'the control: a catalogue site stays').toContain('AniList')
  expect(seen.filter(site => FILM_SOURCES.includes(site))).toEqual([])
})

// an old bookmark or party link names the work by one source, and JustWatch searches only for a work asked as a cluster
test('a film opened at its bare AniList address lists every place to watch it, and its address grows to name them, in the modal and on its page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const { path, row } of FILM_VIEWS) {
    const bare = path.replace(FILM, 'anilist:900050')
    await page.goto(`${origin}${bare}`)
    const buttons = page.locator(row).locator('a')
    await expect(buttons, bare).toHaveCount(FILM_SOURCES.length, { timeout: 30_000 })
    expect((await buttons.locator('.name').allTextContents()).sort(), bare).toEqual(FILM_SOURCES)
    await expect(page, bare).toHaveURL(new RegExp(`/${path.split('/')[1]}/ag:\\([^/]*jw:900050`))
  }
})

test('a series opened at its bare AniList address shows the ratings JustWatch gives, and its address grows to name JustWatch, on its page and in the modal', async ({ page }) => {
  await page.goto(`${origin}/title/anilist:900040`)
  await expect(page.locator('.heading > .chips .chip')).toHaveText(RATED_CHIPS, { timeout: 30_000 })
  await expect(page).toHaveURL(/\/title\/ag:\([^/]*jw:900040/)
  await page.goto(`${origin}/media/anilist:900040`)
  await expect(page).toHaveURL(/\/media\/ag:\([^/]*jw:900040/, { timeout: 30_000 })
})

// AniList answers Spec Prime Film, and JustWatch, five seconds later, with Prime Video on amazon.co.jp, which stub plays
// for a viewer in Japan, and Tubi (tests/fake-fetch.ts)
const PRIME_FILM = 'ag:(anilist:900070)'

test.describe('a viewer in Japan', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test('a film Prime Video plays in stub has Play in the modal and its button opens the watch page; turned off, Play goes and it links out', async ({ page }) => {
    const bar = modal(page).locator('.movie .play-bar')
    const button = (name: string) => modal(page).locator('.description + .watch a').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
    await page.goto(`${origin}/media/${PRIME_FILM}`)
    await expect(bar.locator('a.play')).toBeVisible({ timeout: 30_000 })
    await expect(button('Prime Video')).toHaveAttribute('href', /^\/watch\/.+\/amazon:amzn1\.dv\.gti\.900070$/)
    expect(await button('Prime Video').getAttribute('target')).toBeNull()
    await expect(button('Tubi'), 'the control: a service that links out').toHaveAttribute('target', '_blank')
    await expect(bar.locator('a:not(.play), img'), 'no source beside Play').toHaveCount(0)

    await page.addInitScript(key => localStorage.setItem(key, '["amazon"]'), DISABLED_SOURCES_KEY)
    await page.goto(`${origin}/media/${PRIME_FILM}`)
    await expect(button('Prime Video')).toHaveAttribute('target', '_blank', { timeout: 30_000 })
    await expect(button('Prime Video')).toHaveAttribute('href', 'https://watch.amazon.co.jp/detail?gti=amzn1.dv.gti.900070')
    await expect(bar).toHaveCount(0)
  })

  test('a film Prime Video plays in stub has Play in the modal at its bare AniList address too', async ({ page }) => {
    await page.goto(`${origin}/media/anilist:900070`)
    await expect(modal(page).locator('.movie .play-bar a.play')).toBeVisible({ timeout: 30_000 })
  })

  test('a film Prime Video plays in stub is on the watch page an old link opens by its bare AniList address', async ({ page }) => {
    await page.goto(`${origin}/watch/anilist:900070/jw:900070-1`)
    await expect(page.locator('.list a[title="Prime Video"]')).toBeVisible({ timeout: 30_000 })
  })

  // HOR-1011: the sources follow the player and the episode's row, so another source never takes its height from the video
  test('the player stays 16:9 however many sources the watch page lists, with the episode under it on the first screen, and the sources below', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/watch/${PRIME_FILM}/jw:900070-1/amazon:amzn1.dv.gti.900070`)
    const player = page.locator('.player-container')
    const cards = page.locator('.watch-info .list > *')
    await expect(player.locator('iframe'), 'Prime Video plays here for a viewer in Japan').toBeVisible({ timeout: 30_000 })
    await expect(cards).toHaveCount(1, { timeout: 30_000 })
    const ratio = async () => { const { width, height } = await box(player); return width / height }
    expect(await ratio()).toBeCloseTo(16 / 9, 2)

    // five more, as a title more sources list
    await cards.first().evaluate(card => { for (let i = 0; i < 5; i++) card.parentElement!.append(card.cloneNode(true)) })
    await expect(cards).toHaveCount(6)
    expect(await ratio(), 'the same player with six').toBeCloseTo(16 / 9, 2)
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const last = await box(cards.last())
    expect(last.top, 'the last reached by scrolling the page').toBeGreaterThan(0)
    expect(last.bottom).toBeLessThanOrEqual(844)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    const [screen, row] = await Promise.all([box(player), box(page.locator('.episode-row'))])
    expect(screen.height, 'as tall as the first screen leaves it').toBeGreaterThan(600)
    expect(row.top).toBeGreaterThanOrEqual(screen.bottom)
    expect(row.bottom, 'the episode on the first screen').toBeLessThanOrEqual(900)
    expect((await box(page.locator('.watch-info .list'))).top, 'the sources below it').toBeGreaterThanOrEqual(row.bottom)
    expect(await overflowX(page)).toBe(0)
  })

  // HOR-1011: a fixed allowance for the row let a taller one, as the stacked buttons make it below 1100 px,
  // end 66 px under a 768 px screen (the review of 2026-10-26)
  test('the player gives up height so a taller episode row still ends on the first screen, and keeps it on a short window', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${origin}/watch/${PRIME_FILM}/jw:900070-1/amazon:amzn1.dv.gti.900070`)
    const player = page.locator('.player-container')
    await expect(player.locator('iframe')).toBeVisible({ timeout: 30_000 })
    // 120 px more row, as long titles and the buttons under them make it
    await page.locator('.episode-main').evaluate(main => { main.append(Object.assign(document.createElement('div'), { style: 'height: 120px' })) })
    const [screen, row] = await Promise.all([box(player), box(page.locator('.episode-row'))])
    expect(row.bottom, 'the episode on the first screen').toBeLessThanOrEqual(768)
    expect(screen.height, 'the player shorter for it').toBeLessThan(1024 * 9 / 16 - 100)
    expect((await box(page.locator('.watch-info .list'))).top, 'the sources below it').toBeGreaterThanOrEqual(row.bottom)

    await page.setViewportSize({ width: 844, height: 390 })
    const short = await box(player)
    expect(short.height, 'a phone on its side keeps the player the screen\'s height').toBeGreaterThanOrEqual(390 - short.top - 1)
    expect((await box(page.locator('.watch-info .list'))).top, 'and the sources still below the row').toBeGreaterThanOrEqual((await box(page.locator('.episode-row'))).bottom)
  })
})

// AniList answers Spec Late Film, and JustWatch, the one source naming a place to watch it, forty seconds later, after
// the rest have settled on their 30 s bound (tests/fake-fetch.ts); its joining turns the media unsettled again
const LATE_FILM = 'ag:(anilist:900060)'

test('390 px wide, a film\'s place to watch landing after its sources settled holds no place in the modal a second time', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const row = page.locator('.modal .description + .watch')
  await page.goto(`${origin}/media/${LATE_FILM}`)
  await expect(row.locator('.pending'), 'the control: held while a source is out').toBeVisible({ timeout: 30_000 })
  await expect(modal(page).locator('.movie .play-bar'), 'and Play\'s place').toHaveClass(/held/)
  await expect(modal(page).locator('.movie .play-bar'), 'every source has answered with none').toHaveText('No sources yet', { timeout: 45_000 })
  await expect(row).toHaveCount(0)
  // every place held from now on, however briefly
  await page.evaluate(() => {
    const seen = new Set<string>()
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.type === 'attributes' ? [record.target] : [...record.addedNodes]) {
          if (!(node instanceof Element)) continue
          for (const element of [node, ...node.querySelectorAll('*')]) if (element.matches('.watch .pending, .play-bar.held')) seen.add(element.className)
        }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    Object.assign(window, { seen })
  })
  await expect(row.locator('a .name')).toHaveText('Tubi', { timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  expect(await page.evaluate(() => [...(window as unknown as { seen: Set<string> }).seen])).toEqual([])
  await expect(modal(page).locator('.movie .play-bar'), 'nothing left in the bar').toHaveCount(0)
})

test('390 px wide, Relations\' held place goes once every source has answered and AniList named none', async ({ page }) => {
  // four sources fetch what this rig refuses and never answer, so it waits on their 30 s bound
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/title/${THIRD}`)
  await expect(heading(page)).toHaveText('Spec Third', { timeout: 30_000 })
  const held = page.locator('.relations.placeholder')
  await expect(held, 'held while a source is out').toBeVisible()
  await expect(held).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('[data-relations]')).toHaveCount(0)
  await expect(page.locator('[data-episodes] .episodes'), 'the control: every source has answered').toHaveText('No episodes found')
})

test('the episode list opens on the page of the viewer\'s next episode, and stays where it is paged to', async ({ page }) => {
  await page.goto(`${origin}${LONG}`)
  const episodes = page.locator('[data-episodes]')
  const numbers = episodes.locator('.episode .number')
  const pages = episodes.getByRole('navigation', { name: 'Episodes pages' })
  await expect(numbers.first(), 'the control: nothing tracked opens the first page').toHaveText('1', { timeout: 30_000 })
  const tracking = page.getByRole('region', { name: 'Quick tracking' })
  await tracking.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Watching' })
  await tracking.getByLabel('Episodes').fill('30')
  await tracking.getByLabel('Episodes').press('Enter')
  await expect(page.locator('.actions .play')).toHaveText('Continue', { timeout: 30_000 })
  // episode 31 is the 31st of 1,100, on the third page of 12
  await expect(numbers.first()).toHaveText('25')
  await page.reload()
  await expect(numbers.first()).toHaveText('25', { timeout: 30_000 })
  await expect(pages.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page')
  await pages.getByRole('button', { name: 'Page 1' }).click()
  const play = page.locator('.actions .play')
  const continued = (await play.getAttribute('href'))!
  await tracking.getByLabel('Episodes').fill('40')
  await tracking.getByLabel('Episodes').press('Enter')
  await expect(play, 'the control: the progress moved').not.toHaveAttribute('href', continued)
  await expect(numbers.first(), 'a page picked stays picked').toHaveText('1')
  // episode 41 is on the fourth page, in the modal too
  await page.goto(`${origin}${LONG.replace('/title/', '/media/')}`)
  const inModal = modal(page)
  await expect(inModal.locator('.episode .number').first()).toHaveText('37', { timeout: 30_000 })
  await expect(inModal.getByRole('navigation', { name: 'Episodes pages' }).getByRole('button', { name: 'Page 4', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('each of a title\'s lists draws a page at a time: characters, staff, relations and themes', async ({ page }) => {
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  // Spec Sequel's 14 characters, 14 people, 4 relations and 14 songs (tests/fake-fetch.ts)
  for (const [list, rows, label, size, last] of [
    ['[data-characters]', 'li', 'Characters', 12, 2],
    ['[data-staff]', 'li', 'Staff', 12, 2],
    ['[data-relations]', 'a.relation-card', 'Relations', 3, 1],
    ['[data-themes]', 'li', 'Themes', 12, 2],
  ] as const) {
    const section = page.locator(list)
    await expect(section.locator(rows), label).toHaveCount(size, { timeout: 30_000 })
    await section.getByRole('navigation', { name: `${label} pages` }).getByRole('button', { name: 'Next page' }).click()
    await expect(section.locator(rows), label).toHaveCount(last)
  }
})

test('a theme playing on one page stops when the list is paged away, and no row of another page takes its place', async ({ page }) => {
  await page.goto(`${origin}/title/${SEQUEL}`)
  const themes = page.locator('[data-themes]')
  const rows = themes.locator('li')
  const pages = themes.getByRole('navigation', { name: 'Themes pages' })
  await expect(rows).toHaveCount(12, { timeout: 30_000 })
  await rows.nth(0).getByRole('button', { name: 'Play' }).click()
  await expect(themes.locator('video'), 'the control: the first song plays').toHaveCount(1)
  await expect(rows.nth(0).getByRole('button', { name: 'Stop' })).toBeVisible()
  await pages.getByRole('button', { name: 'Next page' }).click()
  await expect(rows.first()).toContainText('Sequel Song 13')
  await expect(themes.locator('video')).toHaveCount(0)
  await expect(rows.first().getByRole('button', { name: 'Play' })).toBeVisible()
  await pages.getByRole('button', { name: 'Previous page' }).click()
  await expect(rows.first()).toContainText(/Sequel Song 1(?!\d)/)
  await expect(themes.locator('video'), 'back on its page, nothing plays').toHaveCount(0)
  await expect(rows.first().getByRole('button', { name: 'Play' })).toBeVisible()
})

test('another title opened in the page starts its lists on their first page', async ({ page }) => {
  const characters = page.locator('[data-characters]')
  const staff = page.locator('[data-staff]')
  const current = (section: Locator) => section.locator('nav button[aria-current="page"]')
  // to Spec Third and back first, so each title is drawn whole as soon as it is opened again
  await page.goto(`${origin}/title/${SEQUEL}`)
  await expect(characters.locator('li').first()).toContainText(/Sequel Character 1(?!\d)/, { timeout: 30_000 })
  await page.locator('[data-relations] a.relation-card').filter({ hasText: 'Spec Third' }).click()
  await expect(characters.locator('li').filter({ hasText: 'Spike Spiegel' })).toHaveCount(1, { timeout: 30_000 })
  await page.goBack()
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  for (const section of [characters, staff]) {
    await section.getByRole('navigation').getByRole('button', { name: 'Page 2' }).click()
    await expect(current(section), 'the control: paged').toHaveText('2')
  }
  await page.goForward()
  await expect(heading(page)).toHaveText('Spec Third', { timeout: 30_000 })
  await expect(characters.locator('li').filter({ hasText: 'Spike Spiegel' })).toHaveCount(1)
  await page.goBack()
  await expect(heading(page)).toHaveText('Spec Sequel', { timeout: 30_000 })
  await expect(characters.locator('li').first()).toContainText(/Sequel Character 1(?!\d)/)
  await expect(staff.locator('li').first()).toContainText(/Sequel Animator 1(?!\d)/)
  for (const section of [characters, staff]) await expect(current(section)).toHaveText('1')
})

test('390 px wide, each episode row keeps its date and its source icons inside it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const rows = page.locator('[data-episodes] .episode')
  await expect(rows.first().locator('.date')).toHaveText('Sep 29, 2023', { timeout: 30_000 })
  // the fixture matches no sources, so the first row gets five icons the size the compact selector draws
  await rows.first().locator('.origins').evaluate(origins => {
    origins.innerHTML = `<div style="display: flex; gap: 0.7rem">${'<span style="width: 2.8rem; height: 2.8rem; flex-shrink: 0"></span>'.repeat(5)}</div>`
  })
  const outside = await rows.evaluateAll(episodes => episodes.flatMap(row => {
    const { right, bottom } = row.getBoundingClientRect()
    return [...row.querySelectorAll('.date, .origins > *')].map(element => {
      const box = element.getBoundingClientRect()
      return Math.max(0, box.right - right, box.right - innerWidth, box.bottom - bottom)
    })
  }))
  expect(outside).toEqual(outside.map(() => 0))
})

test('the page\'s cover style stays on its own cover, off the relation cards\' covers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  await expect(heading(page)).toBeVisible()
  const shadow = await page.locator('.relation-card .cover').evaluate(cover => getComputedStyle(cover).boxShadow)
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

// MAL outranks AniList on a start date, so its page has to keep the year alone too
test('a film AniList and MAL date by its year alone reads Releases and the year, not a January 1', async ({ page }) => {
  await page.goto(`${origin}/media/ag:(anilist:900100,mal:900100)`)
  await expect(modal(page).locator('.description'), 'the control: MAL\'s page is in').toContainText('MyAnimeList describes', { timeout: 30_000 })
  const movie = modal(page).locator('.movie')
  await expect(movie.locator('.when')).toHaveText('Releases 2099')
  await expect(movie.locator('.facts')).toHaveText(/^Movie · 2099\b/)
})

// AniList describes Spec Unsafe with a script, an image's onerror, a handler, a javascript: link, a style attribute, a
// style sheet and a form, and a remote image (tests/fake-fetch.ts)
test('a description draws its paragraphs, breaks, italics, bold, links and remote images, and none of its scripts, handlers, styles or forms, in the modal and on its page', async ({ page }) => {
  for (const [path, selector] of [['/media/ag:(anilist:900110)', '.modal > .content > .description'], ['/title/ag:(anilist:900110)', '.heading > .description']] as const) {
    await page.goto(`${origin}${path}`)
    const description = page.locator(selector)
    await expect(description, path).toContainText('A quiet town.Its sequel, a link and a span.', { timeout: 30_000 })
    await description.getByText('a span').hover()
    // each image has loaded or failed, so an onerror left in has run
    await description.evaluate(element => Promise.all([...element.querySelectorAll('img')].map(image => image.decode().catch(() => {}))))
    expect(await description.evaluate(element => ({
      text: element.textContent,
      formatting: ['p', 'br', 'i', 'b', 'a[href="https://anilist.co/anime/1"]'].filter(tag => !element.querySelector(tag)),
      elements: [...element.querySelectorAll('script, style, form')].map(child => child.localName),
      attributes: [...element.querySelectorAll('*')].flatMap(child => child.getAttributeNames().filter(name => name.startsWith('on') || name === 'style')),
      links: [...element.querySelectorAll('a[href]')].map(link => link.getAttribute('href')!).filter(href => !href.startsWith('https:')),
      images: [...element.querySelectorAll('img')].map(image => image.getAttribute('src')),
      ran: (window as { ran?: string }).ran,
    })), path).toEqual({
      text: 'A quiet town.Its sequel, a link and a span.', formatting: [], elements: [], attributes: [], links: [],
      images: ['https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg', 'x'], ran: undefined,
    })
  }
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

test('the white Play button shows its edge over a white backdrop, hovered too, in the hero, the modal and the title page', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  // the bundled catalogue has no short description, so the hero shows no show, and no movie, so the modal no
  // play bar: a Play button is placed where each draws one
  const placePlay = async (parent: Locator, html: string) => {
    // first: appended to a long modal, the button sat below the screenshot in 5 runs of 20 (measured 2026-10-12)
    await parent.evaluate((element, html) => element.insertAdjacentHTML('afterbegin', html), html)
    return parent.locator('.play')
  }
  await page.goto(`${origin}/`)
  const hero = await placePlay(page.locator('.theater .actions'), '<a class="play" href="#">Play</a>')
  await expectEdge(page, hero, 'the hero')
  await hero.hover()
  await expectEdge(page, hero, 'the hero hovered')

  await openModal(page)
  const movie = await placePlay(page.locator('.modal > .content'), '<div class="movie"><div class="play-bar"><a class="play" href="#">Play</a></div></div>')
  await expectEdge(page, movie, 'the modal')
  await movie.hover()
  await expectEdge(page, movie, 'the modal hovered')

  await openModal(page)
  await modal(page).getByRole('link', { name: 'More details' }).click()
  const title = page.locator('.actions .play')
  await expect(title).toBeVisible({ timeout: 30_000 })
  await expectEdge(page, title, 'the title page')
  await title.hover()
  await expectEdge(page, title, 'the title page hovered')
})

test('a season\'s last episode links the first of the next season, which links back, and Back returns', async ({ page }) => {
  await page.goto(`${origin}/watch/tmdb:93405-s1/tmdb:93405-s1e1`)
  const row = page.locator('.episode-row')
  const next = row.getByRole('link', { name: 'Next episode' })
  await expect(next).toHaveAttribute('title', 'E1 - Bread and Lottery', { timeout: 30_000 })
  await expect(row.getByRole('link', { name: 'Previous episode' }), 'the first season has none before it').toHaveCount(0)
  await next.click()
  await expect(page).toHaveURL(/\/watch\/[^/]*tmdb:93405-s2\b/)
  await expect(page.locator('.episode-title')).toHaveText('E1 - Bread and Lottery', { timeout: 30_000 })
  await expect(row.getByRole('link', { name: 'Previous episode' })).toHaveAttribute('title', 'E1 - Red Light, Green Light', { timeout: 30_000 })
  await expect(next, 'the third season lists no episode').toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.episode-title')).toHaveText('E1 - Red Light, Green Light')
})

test('a work the bundle lists in this season and an earlier one shows this season once AniList answers it', async ({ page }) => {
  const now = mediaSeasonNow()
  const keys = Object.keys(SEASONS.seasons)
  const earlier = new Set(keys.slice(0, keys.indexOf(seasonKey(now))).flatMap(key => SEASONS.seasons[key]!.map(record => record.al)))
  const work = SEASONS.seasons[seasonKey(now)]?.find(record => record.al && earlier.has(record.al))
  expect(work, 'the control: the bundle lists a work of this season in an earlier one too').toBeDefined()
  await page.goto(`${origin}/title/ag:(offline:${recordId(work!)})`)
  const season = page.locator('.facts > div', { has: page.getByText('Season', { exact: true }) }).locator('dd')
  await expect(season).toHaveText(new RegExp(`^${now.season} ${now.year}$`, 'i'), { timeout: 30_000 })
})
