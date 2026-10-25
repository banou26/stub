import type { Page } from '@playwright/test'

import { expect, firefox, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// Where a tracker's card and its score menu land, and what a pointer or a finger does on a chip, need
// layout and real event bubbling, which linkedom has neither of. So this builds tests/tracking-card.tsx
// with the app's JSX setup and drives the real row, on a page that carries the app's global
// `.hidden { display: none !important }` (src/index.tsx).

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://tracking.test'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><meta name="viewport" content="width=device-width, initial-scale=1"><style>.hidden { display: none !important; }</style><body style="margin: 0; background: #000; color: #fff; font-family: sans-serif"><script type="module" src="/page.js"></script>'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-tracking-card-'))
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [preact({ jsxImportSource: '@emotion/react' })],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/tracking-card.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === '/'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.fulfill({ path: join(dir, pathname) })
  })
})

const open = async (page: Page, top = 100, clip?: number) => {
  await page.goto(`${ORIGIN}/?top=${top}${clip ? `&clip=${clip}` : ''}`)
  await expect(page.locator('[data-chip="stub"]')).toBeVisible()
}
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`)
const logo = (page: Page, id: string) => page.locator(`[data-chip="${id}"] .logo-button`)
const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const writes = (page: Page) => page.evaluate(() => (window as unknown as { writes: unknown[] }).writes)
// whether a pointer there lands on the card, which a card clipped or drawn under another one does not
const reaches = (page: Page, id: string, at: { x: number, y: number }) =>
  page.evaluate(({ id, x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(`[data-card="${id}"]`)), { id, ...at })

// 450 and 700 px leave room beside the controls for one chip and not for three
test('on a phone or a tablet, the row is as tall before the trackers have answered as once they have', async ({ page }) => {
  const height = async (query: string) => {
    await page.goto(`${ORIGIN}/?top=0${query}`)
    const row = page.locator('.tracking-compact')
    await expect(row).toBeVisible()
    return (await row.boundingBox())!.height
  }
  for (const width of [450, 700]) {
    await page.setViewportSize({ width, height: 844 })
    const answered = await height('')
    await expect(page.locator('[data-chip="stub"]'), 'the control: the chips are drawn').toBeVisible()
    expect(await height('&waiting'), `${width} px`).toBe(answered)
  }
})

test('a card opens on hover and stays open while the pointer crosses into it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  const from = await centre(page, '[data-chip="stub"] .logo-button')
  await page.mouse.move(from.x, from.y)
  await expect(card(page, 'stub')).toBeVisible()
  const to = await centre(page, '[data-card="stub"]')
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.waitForTimeout(300)
  await expect(card(page, 'stub')).toBeVisible()
  await page.mouse.move(5, 5, { steps: 5 })
  await expect(card(page, 'stub'), 'the control: a pointer leaving closes it').toBeHidden()
})

test('typing in a card while the pointer rests on another chip keeps the card and the whole number', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  await logo(page, 'stub').hover()
  const input = card(page, 'stub').locator('input[type="number"]')
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('1')
  // up out of the card, which sits under the other chips, and onto MyAnimeList's
  const over = await centre(page, '[data-chip="mal"] .logo-button')
  await page.mouse.move(over.x, over.y, { steps: 4 })
  await page.waitForTimeout(300)
  await expect(card(page, 'mal')).toBeHidden()
  await expect(input).toBeFocused()
  await page.keyboard.type('2')
  await expect.poll(() => writes(page), { timeout: 3000 }).toEqual([[['stub'], { status: 'WATCHING', progress: 12 }]])
})

test('with a mouse, a press anywhere on a chip but its logo checks or unchecks it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  const check = page.locator('input[name="compact-target-stub"]')
  const chip = (await page.locator('[data-chip="stub"]').boundingBox())!
  const ring = (await page.locator('[data-chip="stub"] label').boundingBox())!
  await page.mouse.click(chip.x + chip.width - 2, chip.y + chip.height / 2)
  await expect(check, 'its right padding').not.toBeChecked()
  await page.mouse.click(ring.x + ring.width / 2, chip.y + chip.height - 2)
  await expect(check, 'under the ring').toBeChecked()
  const logoBox = (await logo(page, 'stub').boundingBox())!
  await page.mouse.click(logoBox.x + logoBox.width + 2, chip.y + chip.height / 2)
  await expect(check, 'the gap after the logo').not.toBeChecked()
})

test('a card running past a box that clips, as the modal does, can still be pointed at', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, 100, 120)
  await logo(page, 'anilist').click()
  const shown = (await card(page, 'anilist').boundingBox())!
  expect(shown.y + shown.height, 'runs past the box').toBeGreaterThan(100 + 120)
  expect(await reaches(page, 'anilist', { x: shown.x + shown.width / 2, y: shown.y + shown.height - 4 })).toBe(true)
})

test("after a press inside one card, hovering another chip keeps it, and a press on that chip's logo shows that card alone", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  await logo(page, 'stub').hover()
  await card(page, 'stub').locator('.more').click()
  await logo(page, 'mal').hover()
  await page.waitForTimeout(300)
  await expect(card(page, 'stub')).toBeVisible()
  await expect(card(page, 'mal')).toBeHidden()
  await logo(page, 'mal').click()
  await expect(card(page, 'mal')).toBeVisible()
  await expect(card(page, 'stub')).toBeHidden()
  const shown = (await card(page, 'mal').boundingBox())!
  expect(await reaches(page, 'mal', { x: shown.x + shown.width / 2, y: shown.y + 8 })).toBe(true)
})

test('near the bottom edge a card flips over its chip, and its score menu stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 })
  await open(page, 700)
  await logo(page, 'anilist').click()
  const chip = (await page.locator('[data-chip="anilist"]').boundingBox())!
  const shown = (await card(page, 'anilist').boundingBox())!
  expect(shown.y + shown.height, 'above its chip').toBeLessThanOrEqual(chip.y)
  expect(shown.y).toBeGreaterThanOrEqual(0)
  await card(page, 'anilist').locator('.star').click()
  const menu = (await card(page, 'anilist').getByRole('dialog', { name: 'Score' }).boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(0)
  expect(menu.y + menu.height).toBeLessThanOrEqual(760)
})

test("with room below, the row's score menu opens under the star", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 760 })
  await open(page)
  const star = (await page.locator('.row > .edit .star').boundingBox())!
  await page.locator('.row > .edit .star').click()
  const menu = (await page.locator('.row > .edit').getByRole('dialog', { name: 'Score' }).boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(star.y + star.height)
})

test("Crunchyroll's chip is a check, its card offers the episodes, 5 stars with no No score and Plan to watch alone, and the row's + reaches it", async ({ page }) => {
  await page.goto(`${ORIGIN}/?top=100&cr`)
  const chip = page.locator('[data-chip="cr"]')
  await expect(chip.locator('input[type="checkbox"]')).toBeChecked()
  await expect(page.locator('[data-differs="PROGRESS"]')).toHaveAttribute('title', 'AniList 3, Crunchyroll 4')

  await chip.hover()
  const own = card(page, 'cr')
  await expect(own.locator('input[type="number"]')).toHaveValue('4')
  await expect(own.locator('select option')).toHaveText(['Add to list', 'Plan to watch'])
  await own.locator('.star').click()
  await expect(own.getByRole('dialog', { name: 'Score' }).locator('.grid button')).toHaveCount(5)
  await expect(own.getByRole('dialog', { name: 'Score' }).getByRole('button', { name: 'No score' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.mouse.move(0, 0)
  await page.locator('.row > .edit .more').click()
  await expect.poll(() => writes(page)).toHaveLength(3)
  const sent = (await writes(page) as [string[], unknown][]).map(([targets, fields]) => [targets[0]!, fields] as const)
  expect(sent.sort(([a], [b]) => a.localeCompare(b))).toEqual([
    ['anilist', { progress: 5 }],
    ['cr', { progress: 5 }],
    ['stub', { status: 'WATCHING', progress: 5, score: 70 }],
  ])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("with Crunchyroll's chip too, every chip and its card stay on screen", async ({ page }) => {
    await page.goto(`${ORIGIN}/?top=100&cr`)
    for (const id of ['anilist', 'mal', 'stub', 'cr']) {
      const shown = (await page.locator(`[data-chip="${id}"]`).boundingBox())!
      expect(shown.x + shown.width, id).toBeLessThanOrEqual(390 - 16)
    }
    await logo(page, 'cr').tap()
    const shown = (await card(page, 'cr').boundingBox())!
    expect(shown.x).toBeGreaterThanOrEqual(0)
    expect(shown.x + shown.width).toBeLessThanOrEqual(390)
  })

  test("every card stays on screen, and the row keeps to one line with Remove from list offered, which never widens the menu", async ({ page }) => {
    await open(page)
    await expect(page.locator('.row > .edit select option', { hasText: 'Remove from list' })).toHaveCount(1)
    const boxes = await page.locator('.row > .edit > *').evaluateAll(elements => elements.map(element => {
      const { top, bottom } = element.getBoundingClientRect()
      return { top, bottom }
    }))
    // on one line, every control overlaps every other one vertically
    expect(Math.max(...boxes.map(box => box.top))).toBeLessThan(Math.min(...boxes.map(box => box.bottom)))
    for (const id of ['anilist', 'mal', 'stub']) {
      await logo(page, id).tap()
      const shown = (await card(page, id).boundingBox())!
      expect(shown.x, id).toBeGreaterThanOrEqual(0)
      expect(shown.x + shown.width, id).toBeLessThanOrEqual(390)
      if (id === 'stub') {
        // stub lists nothing, so its menu is the row's without Remove from list, which never widens it
        const [row, own] = await Promise.all([page.locator('.row > .edit select'), card(page, id).locator('select')].map(async select => (await select.boundingBox())!.width))
        expect(row).toBe(own)
      }
      await page.touchscreen.tap(195, 20)
      await expect(card(page, id), 'a tap outside closes it').toBeHidden()
    }
  })

  test('a tap on the check toggles it and opens no card, and a tap on the logo opens it', async ({ page }) => {
    await open(page)
    const check = page.locator('input[name="compact-target-stub"]')
    await expect(check).toBeChecked()
    await page.locator('[data-chip="stub"] label').tap()
    await expect(check).not.toBeChecked()
    await page.waitForTimeout(300)
    await expect(card(page, 'stub')).toBeHidden()
    await logo(page, 'stub').tap()
    await expect(card(page, 'stub')).toBeVisible()
    await expect(check).not.toBeChecked()
  })
})

test("in the media modal, each chip's check and the row's announcements reach the keyboard and a screen reader", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`${ORIGIN}/?modal`)
  const check = page.getByRole('checkbox', { name: 'Save to Stub' })
  await expect(check).toHaveCount(1)
  await logo(page, 'stub').focus()
  await page.keyboard.press('Tab')
  await expect(check).toBeFocused()
  await page.keyboard.press('Space')
  await expect(check).not.toBeChecked()
  await page.keyboard.press('Space')
  await expect(check).toBeChecked()
  await page.locator('.row > .edit select').selectOption('PLANNING')
  await expect(page.getByRole('status')).toHaveText(/^Saved to (AniList|Stub)$/)
  const dismissed = () => page.evaluate(() => (window as unknown as { dismissed: boolean }).dismissed)
  await page.locator('[data-chip="stub"] > label').click()
  expect(await dismissed(), 'a press inside keeps the modal').toBe(false)
  await page.mouse.click(700, 880)
  expect(await dismissed(), 'a press on the backdrop closes it').toBe(true)
})

test('Escape inside a card closes it and hands focus back to its logo', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  await page.locator('.row .expand').focus()
  for (let step = 0; step < 20 && !await logo(page, 'stub').evaluate(element => element === document.activeElement); step++) {
    await page.keyboard.press('Tab')
  }
  await expect(card(page, 'stub'), 'opened by the keyboard').toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  expect(await card(page, 'stub').evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(card(page, 'stub')).toBeHidden()
  await expect(logo(page, 'stub')).toBeFocused()
  await page.waitForTimeout(300)
  await expect(card(page, 'stub'), 'and it stays closed').toBeHidden()
})

// HOR-1018: the trackers fold into a grid two tiles high before the controls, which end the row where the chips used to
const folded = async (page: Page) => {
  const [row, tiles, toggle, star, controls] = await Promise.all(
    ['.tracking-compact', '.tiles', '.expand', '.row > .edit .star', '.row > .edit'].map(selector => page.locator(selector).boundingBox()),
  )
  const tops = await page.locator('[data-tile]').evaluateAll(tiles => tiles.map(tile => Math.round(tile.getBoundingClientRect().top)))
  return { row: row!, tiles: tiles!, toggle: toggle!, star: star!, controls: controls!, rows: new Set(tops).size, count: tops.length }
}
const expectFolded = async (page: Page, where: string) => {
  const { row, tiles, toggle, star, controls, rows, count } = await folded(page)
  expect(count, `${where}: a tile a tracker`).toBe(3)
  expect(rows, `${where}: two tiles high`).toBe(2)
  expect(tiles.height, `${where}: no taller than the controls`).toBeLessThanOrEqual(controls.height)
  expect(Math.abs(toggle.y - star.y), `${where}: on the controls' line`).toBeLessThan(4)
  expect(toggle.x + toggle.width, `${where}: before them`).toBeLessThanOrEqual(star.x)
  expect(Math.abs(controls.x + controls.width - (row.x + row.width)), `${where}: the controls end the row`).toBeLessThan(1)
}

test('the trackers start as tiles two high before the controls, and their button expands them into chips and back', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`${ORIGIN}/?tiles`)
  const toggle = page.getByRole('button', { name: /^AniList: connected\s*MyAnimeList: signed out\s*Stub: connected$/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expectFolded(page, 'folded')
  await expect(page.locator('[data-chip]')).toHaveCount(0)

  await toggle.focus()
  await page.keyboard.press('Enter')
  const expanded = page.getByRole('button', { name: 'Trackers', exact: true })
  await expect(expanded).toHaveAttribute('aria-expanded', 'true')
  await expect(expanded, 'focus stays on it').toBeFocused()
  await expect(page.locator('[data-chip]')).toHaveCount(3)
  await expect(page.locator('[data-tile]')).toHaveCount(0)
  const [row, chips, controls] = await Promise.all(['.tracking-compact', '.platforms', '.row > .edit'].map(selector => page.locator(selector).boundingBox()))
  expect(chips!.x + chips!.width, 'the chips before the controls').toBeLessThanOrEqual(controls!.x)
  expect(Math.abs(controls!.x + controls!.width - (row!.x + row!.width)), 'which still end the row').toBeLessThan(1)

  await page.keyboard.press('Enter')
  await expect(page.locator('[data-tile]')).toHaveCount(3)
  await expect(page.locator('[data-chip]')).toHaveCount(0)
})

// 430 px leaves room beside the controls for the one loading tile and not for three tiles
const expectOwnLine = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 844 })
  const height = async (query: string) => {
    await page.goto(`${ORIGIN}/?top=0&tiles${query}`)
    const row = page.locator('.tracking-compact')
    await expect(row.locator('.tile').first()).toBeVisible()
    return (await row.boundingBox())!.height
  }
  const answered = await height('')
  const { row, toggle, tiles, controls, rows } = await folded(page)
  expect(rows, `${width} px`).toBe(2)
  expect(tiles.y + tiles.height, `${width} px: over the controls`).toBeLessThanOrEqual(controls.y)
  expect([toggle.x, controls.x].map(left => Math.round(left - row.x)), `${width} px: both from the left edge`).toEqual([0, 0])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  expect(await height('&waiting'), `${width} px: as tall before they answer`).toBe(answered)
  await expect(page.getByRole('img', { name: 'Trackers loading' }), 'the control: before they have answered').toHaveCount(1)
}
// on a tablet the tiles fit beside the controls, so the row is one line
const expectBeside = async (page: Page, where: string) => {
  await page.setViewportSize({ width: 700, height: 844 })
  await page.goto(`${ORIGIN}/?top=0&tiles`)
  await expect(page.locator('[data-tile]')).toHaveCount(3)
  const { toggle, star, controls } = await folded(page)
  const row = (await page.locator('.row').boundingBox())!
  expect(Math.abs(toggle.y - star.y), `${where}: on the controls' line`).toBeLessThan(4)
  expect(toggle.x + toggle.width, `${where}: before them`).toBeLessThanOrEqual(star.x)
  expect(row.height, `${where}: one line`).toBeLessThanOrEqual(controls.height + 1)
}

test('on a phone the tiles take a line of their own over the controls, as tall before the trackers have answered, with no sideways scroll', async ({ page }) => {
  for (const width of [390, 430]) await expectOwnLine(page, width)
})

test('on a tablet the tiles sit on the controls\' line, and the chips take a line of their own', async ({ page }) => {
  await expectBeside(page, 'tiles')
  await page.locator('.expand').click()
  await expect(page.locator('[data-chip]')).toHaveCount(3)
  const [chips, controls] = await Promise.all(['.platforms', '.row > .edit'].map(selector => page.locator(selector).boundingBox()))
  expect(chips!.y + chips!.height, 'the control: the chips over the controls').toBeLessThanOrEqual(controls!.y)
})

test("a note that sends to a tracker's card opens it from the folded tiles, with focus on its logo", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`${ORIGIN}/?long&tiles`)
  const note = page.locator('[data-note="anilist"]')
  await expect(note).toHaveText(/^AniList: set progress on its card/)
  await note.getByRole('button', { name: 'Open' }).click()
  await expect(card(page, 'anilist')).toBeVisible()
  await expect(logo(page, 'anilist')).toBeFocused()
  await expect(page.locator('.expand')).toHaveAttribute('aria-expanded', 'true')
  await expect(card(page, 'anilist').locator('.of'), 'counted on its own episodes').toHaveText('/ 48')
})

// HOR-1024 broke a layout in Firefox alone, and CI installs no Firefox
test('in Firefox too, the tiles are two high before the controls that end the row, beside them on a tablet and over them on a phone', async () => {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  const build = browsers && existsSync(browsers) ? readdirSync(browsers).find(name => name.startsWith('firefox-')) : undefined
  const executablePath = process.env.FIREFOX_PATH ?? (build && join(browsers!, build, 'firefox', 'firefox'))
  test.skip(!executablePath || !existsSync(executablePath), 'no Firefox installed')
  const browser = await firefox.launch({ executablePath, firefoxUserPrefs: { 'media.volume_scale': '0.0' } })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.route(`${ORIGIN}/**`, route => {
      const { pathname } = new URL(route.request().url())
      return pathname === '/'
        ? route.fulfill({ contentType: 'text/html', body: PAGE })
        : route.fulfill({ path: join(dir, pathname) })
    })
    await page.goto(`${ORIGIN}/?tiles`)
    await expect(page.locator('[data-tile]')).toHaveCount(3)
    await expectFolded(page, 'Firefox')
    await expectBeside(page, 'Firefox')
    await expectOwnLine(page, 430)
  } finally {
    await browser.close()
  }
})
