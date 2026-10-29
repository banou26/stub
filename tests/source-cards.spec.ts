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
// worker and @fkn/lib, which only a plugin's own release picker reaches, are left out, since they need
// the app's Node polyfills.

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://cards.test'
// the app's own root font size and reset (src/index.tsx)
const PAGE = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { font-size: 62.5%; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #fff; font-size: 1.6rem; }
</style>
<body><div id="sources" style="width: 30rem"></div><script type="module" src="/page.js"></script></body>`

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-source-cards-'))
  const worker = join(ROOT, 'src', 'worker')
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
          : undefined,
        load: id =>
          id === '\0no-lib' ? 'export const packages = {}'
          : id === '\0no-worker' ? 'export const selectRemoteRelease = () => {}'
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
