import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'vite-plus'

import { builtInSources } from '../src/sources/built-in'
import { addMontserrat } from './montserrat'
import { PLAYER_ORIGIN, PLUGIN_ORIGIN, STAGE_PLUGIN } from './watch-stage-media'

const ALL_BUILTIN = builtInSources.length
const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'https://stage.test'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><meta name="viewport" content="width=device-width, initial-scale=1.0"><body style="margin: 0; background: #0f0f0f; color: #fff"><div id="root"></div><script type="module" src="/main.js"></script>'
const EMBED = readFileSync(join(ROOT, 'embed.html'), 'utf8').replace('/src/embed.tsx', '/embed.js')
const framePage = (script: string) => `<!doctype html><html><body style="margin: 0"><script type="module" src="/${script}"></script>`
const PLUGIN_PLAYER = join(ROOT, 'src', 'components', 'plugin-player.tsx')

const WATCH_PATH = '/watch/ag:(cr:GSUB900)/ag:(cr:GSUB900-1)/cr:GSUB1'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-subtitle-browser-'))
  const swaps: Record<string, string> = {
    [join(ROOT, 'src', 'worker')]: join(ROOT, 'tests', 'subtitle-browser-worker.ts'),
    [join(ROOT, 'src', 'plugins')]: join(ROOT, 'tests', 'subtitle-browser-plugins.ts'),
    [join(ROOT, 'src', 'sources', 'crunchyroll', 'relay-check')]: join(ROOT, 'tests', 'watch-stage-crunchyroll.ts'),
    [join(ROOT, 'src', 'utils', 'fetch')]: join(ROOT, 'tests', 'watch-stage-relay.ts'),
  }
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    publicDir: false,
    plugins: [{
      name: 'subtitle-browser-fakes',
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
          main: join(ROOT, 'tests', 'subtitle-browser.tsx'),
          embed: join(ROOT, 'tests', 'watch-stage-player.tsx'),
          plugin: join(ROOT, 'tests', 'watch-stage-plugin.ts'),
          player: join(ROOT, 'tests', 'watch-stage-nested-player.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const serve = async (page: Page, enabledPlugins: string[], extraStorage: Record<string, string> = {}) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname.startsWith('/watch/') || pathname === '/settings'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : pathname === '/embed.html' ? route.fulfill({ contentType: 'text/html', body: EMBED })
      : route.fulfill({ path: join(dir, pathname) })
  })
  for (const [origin, html, script] of [[PLUGIN_ORIGIN, '/plugin.html', 'plugin.js'], [PLAYER_ORIGIN, '/player.html', 'player.js']] as const) {
    await page.route(`${origin}/**`, route => {
      const { pathname } = new URL(route.request().url())
      return pathname === html ? route.fulfill({ contentType: 'text/html', body: framePage(script) })
        : route.fulfill({ path: join(dir, pathname) })
    })
  }
  await page.addInitScript(({ origin, plugins, storage }) => {
    if (location.origin !== origin) return
    localStorage.setItem('stub-enabled-plugins', JSON.stringify(plugins))
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
  }, { origin: ORIGIN, plugins: enabledPlugins, storage: extraStorage })
  await addMontserrat(page)
}

test('keeps CC menu visible at 0 tracks, browses and picks external subtitles inside fullscreen stage, and hides subtitlesOnly plugins from video source UI', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await serve(page, [STAGE_PLUGIN, 'npm:@spec/subtitles-only'], { 'spec.subs.auto': '0' })
    await page.goto(`${ORIGIN}${WATCH_PATH}`)

    const embed = page.frameLocator('.stage iframe')
    const ccBtn = embed.locator('button[aria-label="Subtitles"]')
    await expect(embed.locator('button.full-screen')).toBeVisible({ timeout: 30_000 })
    await expect(ccBtn).toBeVisible()

    // subtitlesOnly plugin stays out of watch SourceSelector
    await expect(page.locator('.watch-info.sources')).not.toContainText('Spec Subtitles')

    await embed.locator('button.full-screen').click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    await ccBtn.click()
    const browseBtn = embed.locator('.browse-subtitles')
    await expect(browseBtn).toHaveText('Look for more')
    await browseBtn.click()

    const dialog = page.locator('.player-container [role="dialog"][aria-label="Subtitles"]')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    // Typing search text works cleanly without triggering player shortcuts or exiting fullscreen
    const searchInput = dialog.locator('.search-input')
    await expect(searchInput).toBeFocused()
    await page.keyboard.type('hello')
    await expect(searchInput).toHaveValue('hello')
    await expect(dialog.locator('.item')).toHaveCount(2, { timeout: 10_000 })

    const selects = dialog.locator('select.select')
    await selects.nth(0).selectOption('ja')
    await expect(dialog.locator('.item')).toHaveCount(1)
    await expect(dialog.locator('.item').first()).toContainText('Show.S01E01.Hello.JA')

    await selects.nth(0).selectOption('')
    await selects.nth(1).selectOption('plugin:spec-subs')
    await expect(dialog.locator('.item')).toHaveCount(2)

    // Closing via the close button keeps stage fullscreen
    await dialog.locator('button.close').click()
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')

    // Reopen Look for more, pick the English plugin subtitle, and verify cues activate while keeping stage fullscreen
    await ccBtn.click()
    await browseBtn.click()
    await expect(dialog).toBeVisible()
    await dialog.locator('.search-input').fill('hello')
    const englishItem = dialog.locator('.item').filter({ hasText: 'Show.S01E01.Hello.1080p.WEB' })
    await expect(englishItem).toBeVisible()
    await englishItem.click()

    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? null)).toBe('stage')
    await expect(embed.locator('.subtitle-cue-line')).toHaveText('Plugin subtitle line')

    // Quick source switcher stays restricted to video sources
    await embed.locator('button.source-switch').click()
    const switchDialog = page.locator('[role="dialog"][aria-label="Switch source"]')
    await expect(switchDialog).toBeVisible()
    await expect(switchDialog).not.toContainText('Spec Subtitles')
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(switchDialog).toBeHidden()

    // Escape dismisses the subtitle browser dialog cleanly
    await ccBtn.click()
    await browseBtn.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally {
    await page.close()
  }
})

test('lists subtitlesOnly plugins in a dedicated Settings Subtitles section out of Play order and included in Turn all on', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await serve(page, ['npm:@spec/subtitles-only'])
    await page.goto(`${ORIGIN}/settings#sources`)

    await expect(page.locator('[data-section="sources"]')).toBeVisible()
    await expect(page.locator('h3.part', { hasText: 'Subtitles' })).toBeVisible()

    const card = page.locator('.subtitle-sources [data-source="spec-subs"]')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Spec Subtitles')

    await expect(page.locator('.play-order [data-source="spec-subs"]')).toHaveCount(0)
    await expect(page.locator('.merge-order [data-source="spec-subs"]')).toHaveCount(0)

    const sourceSwitch = page.getByRole('switch', { name: 'Spec Subtitles source', exact: true })
    await expect(sourceSwitch).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Spec Subtitles icon', exact: true })).toHaveCount(0)

    await expect(page.getByText(`All ${ALL_BUILTIN + 1} on`, { exact: true })).toBeVisible()
    await sourceSwitch.click()
    await expect(sourceSwitch).not.toBeChecked()
    await expect(page.getByText(`${ALL_BUILTIN} of ${ALL_BUILTIN + 1} on`, { exact: true })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('stub.sources.disabled'))).toBe('["spec-subs"]')

    await page.getByRole('button', { name: 'Turn all on' }).click()
    await expect(sourceSwitch).toBeChecked()
    await expect(page.getByText(`All ${ALL_BUILTIN + 1} on`, { exact: true })).toBeVisible()
  } finally {
    await page.close()
  }
})
