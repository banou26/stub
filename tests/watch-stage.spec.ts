import type { Browser, Frame, Page } from '@playwright/test'

import { expect, firefox, test, webkit } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'vite-plus'

import { PLAYER_ORIGIN, PLUGIN_ORIGIN, STAGE_PLUGIN, stageWatchPath, torrentWatchPath } from './watch-stage-media'

// HOR-1014: fullscreen kept across episodes. The real watch page (./watch-stage.tsx, built with the app's own
// config) frames stub's own Crunchyroll player over a fake video (./watch-stage-player.tsx), which hands its
// fullscreen to the page. A click on the player's fullscreen button fullscreens the page's stage; the episode then
// ends, Next opens the next one, whose frame replaces the first, and the stage is still what is fullscreen, with the
// next player taking the keys. A torrent plays two frames down, as stub-plugin plays one in ripple: the page mounts a
// source package (./watch-stage-plugin.ts) that frames its player (./watch-stage-ripple.ts), and the same holds, with
// Next offered from the file's own chapters and the keys reaching the player after Next and after a countdown alike.
// In Chromium, Firefox and WebKit, headless and muted: WebKit through Playwright's own run-server (PW_WEBKIT_WS, as
// fkn-client's scripts/webkit-server.sh serves it), whose container has no audio device.

const ROOT = join(import.meta.dirname, '..')
// a secure origin, as stub always has: the players' channels ask for crypto.randomUUID
const ORIGIN = 'https://stage.test'
const PAGE = '<!doctype html><html style="font-size: 62.5%"><body style="margin: 0; background: #0f0f0f; color: #fff"><div id="root"></div><script type="module" src="/main.js"></script>'
// the app's own embed page, running the fixture
const EMBED = readFileSync(join(ROOT, 'embed.html'), 'utf8').replace('/src/embed.tsx', '/embed.js')
const framePage = (script: string) => `<!doctype html><html><body style="margin: 0"><script type="module" src="/${script}"></script>`
const PLUGIN_PLAYER = join(ROOT, 'src', 'components', 'plugin-player.tsx')

let dir: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-watch-stage-'))
  const swaps: Record<string, string> = {
    [join(ROOT, 'src', 'worker')]: join(ROOT, 'tests', 'watch-stage-worker.ts'),
    [join(ROOT, 'src', 'plugins')]: join(ROOT, 'tests', 'fake-plugins.ts'),
  }
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    publicDir: false,
    plugins: [{
      name: 'watch-stage-fakes',
      enforce: 'pre',
      resolveId: (source, importer) => importer === PLUGIN_PLAYER && source === '@fkn/lib'
        ? join(ROOT, 'tests', 'watch-stage-packages.ts')
        : importer ? swaps[resolve(dirname(importer), source)] : undefined,
    }],
    // the app's two entries, named alike so they replace its index.html and embed.html
    build: {
      outDir: dir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: join(ROOT, 'tests', 'watch-stage.tsx'),
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
  // the package's frame and its player's, each on an origin of its own, from the same build
  for (const [origin, html, script] of [[PLUGIN_ORIGIN, '/plugin.html', 'plugin.js'], [PLAYER_ORIGIN, '/player.html', 'player.js']] as const) {
    await page.route(`${origin}/**`, route => {
      const { pathname } = new URL(route.request().url())
      return pathname === html ? route.fulfill({ contentType: 'text/html', body: framePage(script) }) : route.fulfill({ path: join(dir, pathname) })
    })
  }
  // the torrents' package added on this device
  await page.addInitScript(([origin, uri]) => {
    if (location.origin === origin) localStorage.setItem('stub-enabled-plugins', JSON.stringify([uri]))
  }, [ORIGIN, STAGE_PLUGIN])
}

// read after each press, never before one, since an evaluate carries a user activation in Chromium
const fullscreenElement = (page: Page) => page.evaluate(() => {
  const element = document.fullscreenElement
  return element ? element.className || element.tagName : null
})

const fullscreenAcrossEpisodes = async (page: Page) => {
  await serve(page)
  await page.goto(`${ORIGIN}${stageWatchPath(1)}`)
  const embed = page.frameLocator('.stage iframe')
  const button = embed.locator('button.full-screen')
  await button.click({ timeout: 30_000 })
  await expect.poll(() => fullscreenElement(page), { message: 'the player\'s button fullscreens the stage' }).toBe('stage')
  await expect(button, 'the player is told the stage is fullscreen').toHaveAttribute('aria-pressed', 'true')
  // Firefox takes the fullscreen window to its headless screen's 1366x768, past the viewport set
  const screen = await page.evaluate(() => [innerWidth, innerHeight])
  const box = (await page.locator('.stage iframe').boundingBox())!
  expect([Math.round(box.width), Math.round(box.height)], 'the player fills the screen').toEqual(screen)

  // the episode plays from its own key and ends, and Next is drawn on the stage
  await page.keyboard.press('k')
  const next = page.locator('.stage .up-next')
  await expect(next).toBeVisible()
  await next.click()
  await expect(page.locator('.stage iframe')).toHaveAttribute('src', /GSTAGE2/)
  const second = () => page.frames().find(frame => frame.url().startsWith(`${ORIGIN}/embed.html?`) && frame.url().includes('GSTAGE2'))
  await expect.poll(async () => await second()?.evaluate(() => document.readyState) ?? null).toBe('complete')
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null), { message: 'the next player takes the keys' }).toBe('IFRAME')
  await page.waitForTimeout(500)
  expect(await fullscreenElement(page), 'the stage is still fullscreen once the next player is in').toBe('stage')

  await page.keyboard.press('k')
  await expect.poll(async () => await second()!.evaluate(() => (window as unknown as { keys: string[] }).keys), { message: 'a key reaches the next player' }).toContain('k')
  await expect(button, 'the next player hears the stage is fullscreen').toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('f')
  await expect.poll(() => fullscreenElement(page), { message: 'the next player\'s f leaves fullscreen' }).toBe(null)
  await expect(button, 'the next player is told the stage left fullscreen').toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('f')
  await expect.poll(() => fullscreenElement(page), { message: 'and fullscreens the stage again' }).toBe('stage')

  // an address naming a release the episode does not hold: a render with nothing to play keeps the stage, its
  // fullscreen, and the episode drawn in it
  await page.evaluate(path => history.pushState(null, '', path), stageWatchPath(2).replace('cr:GSTAGE2', 'cr:GSTAGE9'))
  await expect(page.locator('.stage iframe')).toHaveCount(0)
  await expect(page.locator('.stage .episode-card')).toBeVisible()
  await expect(page.locator('.stage .episode-card')).toHaveText('E2 - Stage 2')
  expect(await fullscreenElement(page), 'the stage is still fullscreen with no player in it').toBe('stage')
}

// the torrent's player, two frames down, once its document is up
const torrentPlayer = (page: Page) => page.frames().find(frame => frame.url() === `${PLAYER_ORIGIN}/player.html` && !frame.isDetached())
const heard = async (frame: Frame | undefined) => frame && !frame.isDetached()
  ? await frame.evaluate(() => (window as unknown as { keys: string[] }).keys).catch(() => [])
  : []
const nextPlayer = async (page: Page, previous: Frame) => {
  await expect.poll(() => previous.isDetached(), { timeout: 15_000, message: 'the next episode replaces the player' }).toBe(true)
  await expect.poll(async () => await torrentPlayer(page)?.evaluate(() => document.readyState).catch(() => null) ?? null).toBe('complete')
  return torrentPlayer(page)!
}

const torrentAcrossEpisodes = async (page: Page) => {
  await serve(page)
  await page.goto(`${ORIGIN}${torrentWatchPath(1)}`)
  const button = page.frameLocator('.stage iframe').frameLocator('iframe').locator('button.full-screen')
  // in Chromium an early click can reach the page instead, on the package's frame, and never the player (Chrome 155,
  // 2026-10-26), so it is clicked until the player hears it
  await expect(async () => {
    await button.click()
    await expect(button).toHaveAttribute('data-clicked', { timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
  await expect.poll(() => fullscreenElement(page), { message: 'the player\'s button two frames down fullscreens the stage' }).toBe('stage')
  await expect(button, 'the player is told the stage is fullscreen').toHaveAttribute('aria-pressed', 'true')

  // played from just before its ending: Next episode comes from the file's own chapters, before the end
  await page.keyboard.press('k')
  const offered = page.locator('.stage .up-next.offered')
  await expect(offered).toBeVisible()
  // Next pressed, a click on the page
  const first = torrentPlayer(page)!
  await offered.click()
  const second = await nextPlayer(page, first)
  await expect(button, 'the next player hears the stage is fullscreen').toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('k')
  await expect.poll(() => heard(second), { message: 'a key after Next reaches the next player' }).toContain('k')
  expect(await fullscreenElement(page), 'the stage is still fullscreen').toBe('stage')

  // no click on the page: the end counts down and opens the next episode by itself
  await page.keyboard.press('e')
  await expect(page.locator('.stage .up-next.counting')).toBeVisible()
  const third = await nextPlayer(page, second)
  await page.keyboard.press('k')
  await expect.poll(() => heard(third), { message: 'a key after the countdown reaches the next player' }).toContain('k')
  expect(await fullscreenElement(page), 'the stage is still fullscreen').toBe('stage')
  await page.keyboard.press('f')
  await expect.poll(() => fullscreenElement(page), { message: 'the player\'s f leaves fullscreen' }).toBe(null)
  await expect(button, 'the player is told the stage left fullscreen').toHaveAttribute('aria-pressed', 'false')
}

const VIEWPORT = { width: 1280, height: 720 }

const launchFirefox = async () => {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  const installed = browsers && existsSync(browsers) ? readdirSync(browsers).find(name => name.startsWith('firefox-')) : undefined
  const executablePath = process.env.FIREFOX_PATH ?? (installed && join(browsers!, installed, 'firefox', 'firefox'))
  test.skip(!executablePath || !existsSync(executablePath), 'no Firefox installed')
  return firefox.launch({ executablePath, firefoxUserPrefs: { 'media.volume_scale': '0.0' } })
}

const connectWebKit = async (): Promise<Browser> => {
  test.skip(!process.env.PW_WEBKIT_WS, 'no WebKit server (PW_WEBKIT_WS)')
  return webkit.connect(process.env.PW_WEBKIT_WS!)
}

for (const [journey, run] of [['', fullscreenAcrossEpisodes], [' for a torrent two frames down', torrentAcrossEpisodes]] as const) {
  test(`the stage stays fullscreen across a next episode, and its player takes the keys${journey}, in Chromium`, async ({ browser }) => {
    test.setTimeout(90_000)
    const page = await browser.newPage({ viewport: VIEWPORT })
    try {
      await run(page)
    } finally {
      await page.close()
    }
  })

  test(`the same${journey} in Firefox`, async () => {
    test.setTimeout(90_000)
    const browser = await launchFirefox()
    try {
      await run(await browser.newPage({ viewport: VIEWPORT }))
    } finally {
      await browser.close()
    }
  })

  test(`the same${journey} in WebKit`, async () => {
    test.setTimeout(90_000)
    const browser = await connectWebKit()
    try {
      await run(await browser.newPage({ viewport: VIEWPORT }))
    } finally {
      await browser.close()
    }
  })
}
