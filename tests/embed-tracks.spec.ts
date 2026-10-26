import type { Browser, Page } from '@playwright/test'
import type { Rig } from './embed-tracks-rig'

import { expect, firefox, test, webkit } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite-plus'

// The watch page's end of the tracks channel and the embed's (./embed-tracks-rig.ts), built with the app's own config.
// The page's ask on the frame's `load`, and a pick made from a timer, each have to reach the embed with the page as
// their `source`, which WebKit replaces with the embed's own window when the call is a tail call (see @banou/ponyfill's
// postMessage). In Chromium, Firefox and WebKit, headless and muted: WebKit through Playwright's own run-server
// (PW_WEBKIT_WS).

const ROOT = join(import.meta.dirname, '..')
const ORIGIN = 'https://tracks.test'
const PAGE = '<!doctype html><script type="module" src="/rig.js"></script>'

let dir: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-embed-tracks-'))
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    publicDir: false,
    build: {
      outDir: dir,
      emptyOutDir: true,
      rollupOptions: { input: { rig: join(ROOT, 'tests', 'embed-tracks-rig.ts') }, output: { entryFileNames: '[name].js' } },
    },
  })
})

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const tracksAcrossTheFrame = async (page: Page) => {
  await page.route('**/*', route => route.abort())
  await page.route(`${ORIGIN}/**`, route => {
    const { pathname } = new URL(route.request().url())
    return pathname.endsWith('.js') ? route.fulfill({ path: join(dir, pathname) }) : route.fulfill({ contentType: 'text/html', body: PAGE })
  })
  await page.goto(`${ORIGIN}/`)
  const embed = () => page.frames().find(frame => frame.url() === `${ORIGIN}/embed.html`)

  const heard = () => page.evaluate(() => (window as unknown as Rig).heard.map(tracks => tracks.busy))
  await expect.poll(heard, { message: 'the page hears the embed\'s answer to its ask' }).toContain(false)
  expect((await heard())[0], 'and the embed\'s own first send before it').toBe(true)

  await page.evaluate(() => (window as unknown as Rig).pick())
  await expect.poll(async () => await embed()?.evaluate(() => (window as unknown as Rig).picks), { message: 'the embed takes the page\'s pick' }).toEqual(['audio English'])
}

test('the page\'s ask and pick reach the embed, in Chromium', async ({ page }) => {
  await tracksAcrossTheFrame(page)
})

test('the same in Firefox', async () => {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  const installed = browsers && existsSync(browsers) ? readdirSync(browsers).find(name => name.startsWith('firefox-')) : undefined
  const executablePath = process.env.FIREFOX_PATH ?? (installed && join(browsers!, installed, 'firefox', 'firefox'))
  test.skip(!executablePath || !existsSync(executablePath), 'no Firefox installed')
  const browser = await firefox.launch({ executablePath, firefoxUserPrefs: { 'media.volume_scale': '0.0' } })
  try {
    await tracksAcrossTheFrame(await browser.newPage())
  } finally {
    await browser.close()
  }
})

test('the same in WebKit', async () => {
  test.skip(!process.env.PW_WEBKIT_WS, 'no WebKit server (PW_WEBKIT_WS)')
  const browser: Browser = await webkit.connect(process.env.PW_WEBKIT_WS!)
  try {
    await tracksAcrossTheFrame(await browser.newPage())
  } finally {
    await browser.close()
  }
})
