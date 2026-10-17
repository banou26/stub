import type { AddressInfo } from 'node:net'
import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { build } from 'vite-plus'

import SEASONS from '../src/generated/anime-seasons'
import { HIDDEN_ICONS_KEY } from '../src/sources/hidden-icons'
import { PLAYER_VOLUME_KEY } from '../src/utils/player-volume'
import { recordId, seasonKey } from '../src/sources/offline/normalize'
import { mediaSeasonNow } from '../src/sources/season'

// The title page as anime.fkn.app serves it, built and served the way tests/settings.spec.ts does: every
// request that leaves this origin is refused, so the works are the season the bundled catalogue lists,
// AniList answers each of them with Cowboy Bebop's credits and one sequel, Spec Sequel, AniZip with 26
// episodes and Frieren's ids, AnimeThemes with Frieren's themes, one without a video, IMDb answers
// Breaking Bad, TMDB Squid Game's three seasons, the first two with one episode each, and Frieren's one,
// and MyAnimeList Cowboy Bebop's title and credits pages for mal:1 (tests/fake-fetch.ts).

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

test('the watch page links the episodes either side beside the title, Back returns, and at 390 px they fit under it', async ({ page }) => {
  await openModal(page)
  await page.goto(`${origin}${await modal(page).locator('a.episode-link').nth(1).getAttribute('href')}`)
  const nav = page.locator('.episode-nav')
  const next = nav.getByRole('link', { name: 'Next episode' })
  await expect(nav.getByRole('link', { name: 'Previous episode' })).toHaveAttribute('title', /^E1 - /, { timeout: 30_000 })
  await expect(next).toHaveAttribute('title', /^E3 - /)
  await next.click()
  await expect(page.locator('.episode-title')).toHaveText(/^E3 - /)
  await page.goBack()
  await expect(page.locator('.episode-title')).toHaveText(/^E2 - /)

  const box = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect)
  const info = page.locator('.episode-info')
  // clear of the bottom right corner, where FKN draws its toasts over the page
  await page.setViewportSize({ width: 1920, height: 1080 })
  expect((await box(nav)).left - (await box(info)).right).toBeLessThan(20)

  await page.setViewportSize({ width: 390, height: 844 })
  expect((await box(nav)).top).toBeGreaterThanOrEqual((await box(info)).bottom)
  const outside = () => nav.locator('a').evaluateAll(links => links.map(link => Math.max(0, link.getBoundingClientRect().right - innerWidth)))
  expect(await outside()).toEqual([0, 0])
  // the control: the same check reads a link pushed past the edge
  await nav.evaluate(element => { element.style.marginLeft = '400px' })
  expect((await outside()).every(Boolean)).toBe(true)
})

// the page is as tall as the window and the player takes what the rest leaves, so a line of its own
// would come off the player
test('the watch page\'s tracking row sits on the title\'s line at 1920 px, and under it at 390 px', async ({ page }) => {
  await openModal(page)
  await page.goto(`${origin}${await modal(page).locator('a.episode-link').nth(1).getAttribute('href')}`)
  const row = page.locator('.watch-info .tracking-compact')
  const info = page.locator('.episode-info')
  const nav = page.locator('.episode-nav')
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(nav.getByRole('link', { name: 'Next episode' })).toBeVisible({ timeout: 30_000 })
  const box = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect)

  await page.setViewportSize({ width: 1920, height: 1080 })
  expect((await box(row)).top).toBeLessThan((await box(info)).bottom)
  expect((await box(row)).left).toBeGreaterThanOrEqual((await box(nav)).right)

  await page.setViewportSize({ width: 390, height: 844 })
  expect((await box(row)).top).toBeGreaterThanOrEqual((await box(nav)).bottom)
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
  const nav = page.locator('.episode-nav')
  const next = nav.getByRole('link', { name: 'Next episode' })
  await expect(next).toHaveAttribute('title', 'E1 - Bread and Lottery', { timeout: 30_000 })
  await expect(nav.getByRole('link', { name: 'Previous episode' }), 'the first season has none before it').toHaveCount(0)
  await next.click()
  await expect(page).toHaveURL(/\/watch\/[^/]*tmdb:93405-s2\b/)
  await expect(page.locator('.episode-title')).toHaveText('E1 - Bread and Lottery', { timeout: 30_000 })
  await expect(nav.getByRole('link', { name: 'Previous episode' })).toHaveAttribute('title', 'E1 - Red Light, Green Light', { timeout: 30_000 })
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
