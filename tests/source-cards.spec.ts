import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'vite-plus'

import { LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'

// What a watch page card shows of its languages depends on hover, focus and layout, which linkedom has
// none of. So this builds tests/source-cards.tsx with the app's JSX setup, and reads the real card. The
// worker, @fkn/lib and the plugin runtime, which only a plugin's own release picker and the notice of
// the link that added it reach, are stood in for, since they need the app's Node polyfills: the
// picker's frame shows at once and is never answered, and every source a link names installs at once.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://cards.test'
// the app's own root font size and reset (src/index.tsx)
const PAGE = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { font-size: 62.5%; --stub-header-height: 7rem; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-size: 1.6rem; }
</style>
<body><div id="sources" style="width: 30rem"></div><script type="module" src="/page.js"></script></body>`

// the link's source, connected with Nyaa and YTS
const NO_PLUGINS = `
  const statuses = [{ uri: 'https:stub.plugins.banou.dev', state: 'connected', sources: [{ origin: 'ny', name: 'Nyaa' }, { origin: 'yts', name: 'YTS' }] }]
  export const pluginStatuses = () => statuses
  export const onPluginsChange = () => () => {}
  export const enabledPluginUris = () => []
  export const installedPlugins = async () => []
  export const supportsTemporary = async () => false
  export const enablePlugin = async uri => ({ uri, connected: Promise.resolve() })
  export const installPlugin = async () => null
  export const addedByLink = () => {}
  export const disablePlugin = async () => {}
  export const makeTemporary = async () => {}
  export const showTemporary = () => {}
`

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-source-cards-'))
  const worker = join(ROOT, 'src', 'worker')
  const plugins = join(ROOT, 'src', 'plugins')
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [
      offerEveryLanguage(),
      preact({ jsxImportSource: '@emotion/react' }),
      {
        name: 'spec-no-worker',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === '@fkn/lib' ? '\0no-lib'
          : importer && resolve(dirname(importer), source) === worker ? '\0no-worker'
          : importer && resolve(dirname(importer), source) === plugins ? '\0no-plugins'
          : undefined,
        load: id =>
          id === '\0no-lib' ? 'export const packages = { show: async () => ({ hide: () => {} }), hide: async () => {} }'
          : id === '\0no-worker' ? 'export const selectRemoteRelease = () => new Promise(() => {})'
          : id === '\0no-plugins' ? NO_PLUGINS
          : undefined,
      },
    ],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/source-cards.tsx'), output: { entryFileNames: 'page.js' } } },
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

// the hidden rest is a box of its own, which an accessible name sets apart with a space
const ALL = /Japanese, English, French ?, German, Spanish/
const audio = (page: Page) => page.locator('.languages').first()
const shown = (line: Locator) => line.evaluate(element => {
  const rest = element.querySelector('.rest')!.getBoundingClientRect()
  const more = element.querySelector('.more')!.getBoundingClientRect()
  return { rest: rest.width > 1 && rest.height > 1, more: more.width > 0 }
})

const open = async (page: Page) => {
  await page.goto(`${ORIGIN}/`)
  await expect(audio(page)).toBeVisible()
}

test('where a pointer can hover, a card names three languages and how many more, and reads every one out', async ({ page }) => {
  await open(page)
  expect(await shown(audio(page))).toEqual({ rest: false, more: true })
  await expect(audio(page).locator('.more')).toHaveText('+2')
  await expect(page.getByRole('link'), 'a screen reader hears them all, and not the count').toHaveAccessibleName(ALL)
  await expect(page.getByRole('link')).not.toHaveAccessibleName(/\+2/)
})

test('a card the keyboard is on names every language', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link')).toBeFocused()
  expect(await shown(audio(page))).toEqual({ rest: true, more: false })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('a card names every language', async ({ page }) => {
    await open(page)
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches), 'the control: a phone cannot hover').toBe(false)
    expect(await shown(audio(page))).toEqual({ rest: true, more: false })
    await expect(audio(page)).toContainText(ALL)
  })
})

test('a mark no font mirrors turns with the line, right to left only', async ({ page }) => {
  const scales = async () => {
    await page.goto(`${ORIGIN}/?marks`)
    await expect(page.locator('.chevron.closed')).toBeVisible()
    await expect(page.locator('.ext')).toBeVisible()
    return Promise.all(['.chevron.closed', '.ext'].map(mark => page.locator(mark).evaluate(element => getComputedStyle(element).scale)))
  }
  expect(await scales(), 'the control: left to right, as drawn').toEqual(['none', 'none'])
  await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, 'ar'])
  expect(await scales()).toEqual(['-1 1', '-1 1'])
})

// on a desktop window the picker's Close bar sits where the notice of the link that added its source does
test('the release picker\'s Close is over the link\'s notice, and Close, Escape and the backdrop each close it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${ORIGIN}/?picker`)
  const notice = page.locator('[role="status"] .notice')
  await expect(notice).toContainText('Source enabled: Nyaa, YTS')
  const card = page.locator('#sources button[aria-haspopup="dialog"]')
  const picker = page.getByRole('dialog', { name: 'Choose a source from Nyaa' })
  const close = picker.getByRole('button', { name: 'Close' })
  await card.click()
  await expect(close).toBeVisible()
  const box = (await close.boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const under = (await notice.boundingBox())!
  expect(centre.x > under.x && centre.x < under.x + under.width && centre.y > under.y && centre.y < under.y + under.height,
    'the control: the notice is where Close is').toBe(true)
  expect(await close.evaluate((button, { x, y }) => document.elementFromPoint(x, y) === button, centre)).toBe(true)
  await page.mouse.click(centre.x, centre.y)
  await expect(picker).toHaveCount(0)
  await expect(notice, 'and the notice is still there once the picker is closed').toBeVisible()

  await card.click()
  await expect(close).toBeVisible()
  // the picker listens for the key from an effect, after its first paint
  await expect(async () => {
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0, { timeout: 250 })
  }).toPass()

  await card.click()
  await expect(close).toBeVisible()
  await page.mouse.click(4, 450)
  await expect(picker).toHaveCount(0)
})

// HOR-1026 (stub in the viewer's language): the card's label, its languages' names and how many more, in the language
// shown; FormatJS's pseudo-language is English to Intl, so its names stay English
test.describe('in German, Japanese and the pseudo-language', () => {
  const SHOWN: Record<string, { label?: string, names: string[] }> = {
    [PSEUDO]: { names: ['Japanese', 'English', 'French', 'German', 'Spanish'] },
    de: { label: 'Audio', names: ['Japanisch', 'Englisch', 'Französisch', 'Deutsch', 'Spanisch'] },
    ja: { label: '音声', names: ['日本語', '英語', 'フランス語', 'ドイツ語', 'スペイン語'] },
  }
  for (const [language, { label: expected, names }] of Object.entries(SHOWN)) {
    for (const width of [1440, 390]) {
      test(`${language} at ${width} px: a card names its languages in the language, within the card`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
        await open(page)
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        const line = audio(page)
        const label = await line.locator('.languages-label').textContent()
        if (expected) expect(label).toBe(expected)
        else expect(label, 'the pseudo-language\'s').not.toBe('Audio')
        for (const part of [label!, ...names]) expect(await line.getAttribute('title')).toContain(part)
        await expect(line.locator('.more')).toHaveText('+2')
        expect(await page.locator('#sources a').evaluate(card => [...card.querySelectorAll('*')]
          .filter(element => element.getBoundingClientRect().right > card.getBoundingClientRect().right + 1 && element.getBoundingClientRect().width > 1)
          .map(element => element.className)), 'nothing past the card').toEqual([])
      })
    }
  }
})
