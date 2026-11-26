import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'vite-plus'

import { addMontserrat } from './montserrat'
import { PLAYER_ORIGIN, PLUGIN_ORIGIN, STAGE_PLUGIN } from './watch-stage-media'

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'https://stage.test'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><meta name="viewport" content="width=device-width, initial-scale=1.0"><body style="margin: 0; background: #0f0f0f; color: #fff"><div id="root"></div><script type="module" src="/main.js"></script>'
const EMBED = readFileSync(join(ROOT, 'embed.html'), 'utf8').replace('/src/embed.tsx', '/embed.js')
const framePage = (script: string) => `<!doctype html><html><body style="margin: 0"><script type="module" src="/${script}"></script>`
const PLUGIN_PLAYER = join(ROOT, 'src', 'components', 'plugin-player.tsx')

const MULTI_PATH = '/watch/ag:(anilist:900101)/ag:(anilist:900101-1)/cr:GSWITCH1'
const SINGLE_PATH = '/watch/ag:(anilist:900101)/ag:(anilist:900101-2)/cr:GSWITCH2'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-quick-switch-'))
  const swaps: Record<string, string> = {
    [join(ROOT, 'src', 'worker')]: join(ROOT, 'tests', 'watch-stage-worker.ts'),
    [join(ROOT, 'src', 'plugins')]: join(ROOT, 'tests', 'fake-plugins.ts'),
    [join(ROOT, 'src', 'sources', 'crunchyroll', 'relay-check')]: join(ROOT, 'tests', 'watch-stage-crunchyroll.ts'),
    [join(ROOT, 'src', 'utils', 'fetch')]: join(ROOT, 'tests', 'watch-stage-relay.ts'),
  }
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    publicDir: false,
    plugins: [{
      name: 'quick-switch-fakes',
      enforce: 'pre',
      resolveId: (source, importer) => importer === PLUGIN_PLAYER && source === '@fkn/lib'
        ? join(ROOT, 'tests', 'watch-stage-packages.ts')
        : importer ? swaps[resolve(dirname(importer), source)] : undefined,
    }],
    build: {
      outDir: dir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: join(ROOT, 'tests', 'quick-source-switcher.tsx'),
          embed: join(ROOT, 'tests', 'watch-stage-player.tsx'),
          plugin: join(ROOT, 'tests', 'watch-stage-plugin.ts'),
          player: join(ROOT, 'tests', 'watch-stage-ripple.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const serve = async (page: Page) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname.startsWith('/watch/') ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : pathname === '/embed.html' ? route.fulfill({ contentType: 'text/html', body: EMBED })
      : route.fulfill({ path: join(dir, pathname) })
  })
  for (const [origin, html, script] of [[PLUGIN_ORIGIN, '/plugin.html', 'plugin.js'], [PLAYER_ORIGIN, '/player.html', 'player.js']] as const) {
    await page.route(`${origin}/**`, route => {
      const { pathname } = new URL(route.request().url())
      return pathname === html ? route.fulfill({ contentType: 'text/html', body: framePage(script) })
        : pathname === '/late.png' ? route.fulfill({ status: 404 })
        : route.fulfill({ path: join(dir, pathname) })
    })
  }
  await page.addInitScript(([origin, uri]) => {
    if (location.origin === origin) localStorage.setItem('stub-enabled-plugins', JSON.stringify([uri]))
  }, [ORIGIN, STAGE_PLUGIN])
  await addMontserrat(page)
}

test('switches sources and subsources from inside the player without leaving fullscreen, places sources beside episodes on desktop, and toggles Cards/List', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await serve(page)
    await page.goto(`${ORIGIN}${MULTI_PATH}`)

    const embed = page.frameLocator('.stage iframe')
    const switchBtn = embed.locator('button.source-switch')
    await expect(switchBtn).toBeVisible({ timeout: 30_000 })

    // Inline /watch places sources on the left and episodes on the right on wide viewports, with collapsed Cards default
    const [sourcesBox, episodesBox] = await Promise.all([
      page.locator('.watch-info.sources').boundingBox(),
      page.locator('.watch-info.episodes').boundingBox(),
    ])
    expect(sourcesBox).toBeTruthy()
    expect(episodesBox).toBeTruthy()
    expect(sourcesBox!.x).toBeLessThan(episodesBox!.x)
    expect(sourcesBox!.x + sourcesBox!.width).toBeLessThanOrEqual(episodesBox!.x + 1)

    const inlineCardsBtn = page.locator('.watch-info.sources .view-btn', { hasText: 'Cards' })
    const inlineListBtn = page.locator('.watch-info.sources .view-btn', { hasText: 'List' })
    await expect(inlineCardsBtn).toHaveAttribute('aria-pressed', 'true')
    const folderCard = page.locator('.watch-info.sources .list button.source').first()
    await expect(folderCard).not.toHaveAttribute('aria-expanded', /.*/)
    await expect(page.locator('.watch-info.sources a.release')).toHaveCount(0)

    await folderCard.click()
    await expect(page.locator('.watch-info.sources button.back-btn')).toBeVisible()
    await expect(page.locator('.watch-info.sources a.release[title="Release 2"]')).toBeVisible()
    await page.locator('.watch-info.sources button.back-btn').click()
    await expect(folderCard).toBeVisible()

    await inlineListBtn.click()
    await expect(inlineListBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.watch-info.sources a.release[title="Release 2"]')).toBeVisible()
    await inlineCardsBtn.click()

    // Verify source switch sits before settings in the right control group
    const order = await page.frames().find(f => f.url().startsWith(`${ORIGIN}/embed.html?`))!.evaluate(() => {
      const buttons = [...document.querySelectorAll('.actions .right button')]
      return buttons.map(b => b.className)
    })
    const switchIdx = order.findIndex(cls => cls.includes('source-switch'))
    const settingsIdx = order.findIndex(cls => cls.includes('settings'))
    expect(switchIdx).toBeGreaterThan(-1)
    expect(switchIdx).toBeLessThan(settingsIdx)

    await embed.locator('button.full-screen').click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    await switchBtn.click()
    const dialog = page.locator('[role="dialog"][aria-label="Switch source"]')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    // Focus moves out of the player iframe into the dialog so Escape dismisses cleanly
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    await switchBtn.click()
    await expect(dialog).toBeVisible()

    // Dialog defaults to unified List view with Release 2 directly clickable without extra expands
    await expect(dialog.locator('.view-btn', { hasText: 'List' })).toHaveAttribute('aria-pressed', 'true')
    const release2 = dialog.locator('button[title="Release 2"]')
    await expect(release2).toBeVisible()
    await release2.click()

    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/spec-torrent:rel2/)
    await expect(page.locator('.stage iframe')).toBeAttached()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    // Single source & single release episode hides the switch button
    await page.goto(`${ORIGIN}${SINGLE_PATH}`)
    await expect(page.frameLocator('.stage iframe').locator('button.full-screen')).toBeVisible({ timeout: 30_000 })
    await expect(page.frameLocator('.stage iframe').locator('button.source-switch')).toHaveCount(0)
  } finally {
    await page.close()
  }
})
