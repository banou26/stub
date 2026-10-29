import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import preact from '@preact/preset-vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

import { catalogues, english, englishIn, LANGUAGE_KEY, offerEveryLanguage, PSEUDO } from './languages'

// HOR-1026 (stub in the viewer's language): the watch party's words in a language stub does not offer yet, which only
// a laid out page can show running past its box. So this builds tests/party-pages.tsx the way tests/party-grid.spec.ts
// builds its page, with every catalogue and the pseudo-language offered (tests/languages.ts).

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'http://party.test'
const WATCH = '/watch/a/b'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } :root { --stub-header-height: 6rem }</style><body style="background: #0f0f0f; color: #fff; font-size: 1.6rem; font-family: sans-serif"><div id="root"></div><script type="module" src="/page.js"></script>'

/** Each page, by its query: who this member is and how its party went (tests/party-grid-party.ts). */
const VIEWS = { host: 'view=host', guest: 'view=guest&as=me', joining: 'view=joining&as=me&join=pending', ended: 'view=ended&as=me', failed: 'view=failed&as=me&join=failed', idle: 'view=idle' }

let dir: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-party-pages-'))
  const party = join(ROOT, 'src/party/index.ts')
  await build({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'error',
    plugins: [
      offerEveryLanguage(),
      preact({ jsxImportSource: '@emotion/react' }),
      { name: 'party-on-the-page', load: id => id === party ? `export * from ${JSON.stringify(join(ROOT, 'tests/party-grid-party.ts'))}` : undefined },
    ],
    build: { outDir: dir, rollupOptions: { input: join(ROOT, 'tests/party-pages.tsx'), output: { entryFileNames: 'page.js' } } },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname === WATCH ? route.fulfill({ contentType: 'text/html', body: PAGE }) : route.fulfill({ path: join(dir, pathname) })
  })
})

/**
 * Draws `view` at `width` with the header's menu and the chat open, and returns its words (each text, the sentences
 * whose values are elements, and what a viewer reads in an attribute) and what runs past its box: the page, the menu,
 * the chat and the party page, beyond its content box or scrolling sideways.
 */
const drawn = async (page: Page, view: keyof typeof VIEWS, width: number) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`${ORIGIN}${WATCH}?${VIEWS[view]}`)
  const trigger = page.locator('header > button')
  await expect(trigger).toBeVisible()
  await expect(page.locator('.heading')).toBeVisible()
  // the chat first: a click outside the header's menu closes it
  if (view === 'host' || view === 'guest') {
    await page.locator('button.toggle').click()
    await expect(page.locator('.line.action').first()).toBeVisible()
  }
  if (view !== 'idle' && await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  if (view !== 'idle') await expect(page.locator('[role="dialog"] .title')).toBeVisible()
  return page.evaluate(() => {
    const words: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) if (walker.currentNode.textContent!.trim()) words.push(walker.currentNode.textContent!.trim())
    for (const element of document.querySelectorAll('.can, .status, .line.action, .tally > span')) words.push(element.textContent!.trim())
    for (const element of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      for (const name of ['aria-label', 'title', 'placeholder']) if (element.getAttribute(name)) words.push(element.getAttribute(name)!)
    }
    const past: string[] = []
    const named = (element: Element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${element.textContent!.trim().slice(0, 40)}"`
    const boxes = [...document.querySelectorAll('[role="dialog"]'), document.querySelector('.heading')!.parentElement!]
    for (const box of boxes) {
      const style = getComputedStyle(box)
      const rect = box.getBoundingClientRect()
      const [left, right] = [rect.left + parseFloat(style.paddingLeft) - 1, rect.right - parseFloat(style.paddingRight) + 1]
      // a box that clips what is inside it, a name cut with an ellipsis or a list that scrolls down, is checked itself
      const clipped = (element: Element) => {
        for (let at = element.parentElement; at && at !== box; at = at.parentElement) if (getComputedStyle(at).overflowX !== 'visible') return true
        return false
      }
      for (const element of box.querySelectorAll('*')) {
        if (clipped(element)) continue
        const own = element.getBoundingClientRect()
        if (own.width && (own.right > right || own.left < left)) past.push(named(element))
        const scrolls = getComputedStyle(element).overflowX !== 'visible' && getComputedStyle(element).textOverflow !== 'ellipsis'
        if (scrolls && !['INPUT', 'SELECT'].includes(element.tagName) && element.scrollWidth > element.clientWidth + 1) past.push(`${named(element)} scrolls`)
      }
    }
    // the grants' first row is cut with an ellipsis as a member's name is, but a word of the page has no reason to be;
    // a table cell's scrollWidth leaves the cut out, the text's own box does not
    const everyone = document.querySelector('tbody tr:first-child th')
    if (everyone) {
      const text = document.createRange()
      text.selectNodeContents(everyone)
      if (text.getBoundingClientRect().right > everyone.getBoundingClientRect().right - parseFloat(getComputedStyle(everyone).paddingRight) + 1) past.push(`${named(everyone)} is cut`)
    }
    return { words, past, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
}

test.describe('in a language stub does not offer yet', () => {
  for (const language of [PSEUDO, 'de', 'ja']) {
    test(`${language}: the party's button, menu, page and chat run past nothing at 1440 and 390 px, with none of their words in English`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
      const code = english()
      const translated = language === PSEUDO ? undefined : catalogues()[language]
      for (const width of [1440, 390]) {
        for (const view of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
          const { words, past, overflow } = await drawn(page, view, width)
          await expect(page.locator('html')).toHaveAttribute('lang', language)
          expect.soft([overflow, past], `${view} at ${width} px`).toEqual([0, []])
          expect.soft(englishIn(words, code, translated), `${view} at ${width} px`).toEqual([])
        }
      }
    })
  }

  test('the control: in English the same reading finds the area\'s own words', async ({ page }) => {
    test.setTimeout(120_000)
    const found = new Set<string>()
    for (const view of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
      const { words } = await drawn(page, view, 1440)
      for (const word of englishIn(words, english())) found.add(word)
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(found.size).toBeGreaterThan(60)
  })
})

// HOR-1066: the owner renamed the button to make it smaller, so in no language may it grow past its old name
const BEFORE: Record<string, string> = {
  en: 'Watch together', de: 'Gemeinsam schauen', 'es-419': 'Ver juntos', fr: 'Regarder ensemble', it: 'Guarda insieme',
  ja: '一緒に見る', ko: '함께 보기', pl: 'Oglądaj razem', 'pt-BR': 'Assistir juntos', ru: 'Смотреть вместе',
  tr: 'Birlikte izle', 'zh-Hans': '一起看', 'zh-Hant': '一起看',
}

test('in every language the header\'s party button is no wider than it was as Watch together', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${ORIGIN}${WATCH}?${VIEWS.idle}`)
  const grown: Record<string, number> = {}
  for (const [language, before] of Object.entries(BEFORE)) {
    await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [LANGUAGE_KEY, language])
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.locator('header > button .label')).toBeVisible()
    const [now, then, twice] = await page.evaluate(before => {
      const button = document.querySelector('header > button')!
      const label = button.querySelector('.label')!
      return [label.textContent!, before, `${before} ${before}`].map(text => {
        label.textContent = text
        return button.getBoundingClientRect().width
      })
    }, before)
    // the control: a longer label does widen the button
    expect(twice, language).toBeGreaterThan(then!)
    if (now! > then! + 0.5) grown[language] = Math.round(now! - then!)
  }
  expect(grown).toEqual({})
})
