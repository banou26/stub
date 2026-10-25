import type { AddressInfo } from 'node:net'
import type { Page, Request } from '@playwright/test'

import { expect as baseExpect, test } from '@playwright/test'
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { build } from 'vite-plus'

import { frame, letterboxed, withPhoneChrome } from './fixtures/scene/frame'
import { workerFakes } from './worker-fakes'

// The scene search on anime.fkn.app, built and served the way tests/sites.spec.ts does: one build under the
// sites' names, every request that leaves the server refused, AniList answering Spec Rated (anilist:900040) and
// AniZip its 26 episodes (tests/fake-fetch.ts). trace.moe is answered here, and only here can it be told apart from
// the relay: a request that reaches this route left the browser itself, since tests/fake-fetch.ts stands in for the
// relay and hands anything it does not know to FKN's cloud, which every test refuses.

// a site draws nothing until its worker has booted, 13 to 17 s with the browser held to 10% of a CPU (sites.spec.ts)
const expect = baseExpect.configure({ timeout: 30_000 })
test.describe.configure({ timeout: 180_000 })

const ROOT = join(import.meta.dirname, '..')
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
// what tests/fixtures/scene/frame.ts codes to (tests/unit/scene/code.test.ts)
const FRAME_CODE = 'eOOEIPhB0IQhB8IQg-TPYQg-D0IQ'
const png = (pixels: ReturnType<typeof frame>) =>
  PNG.sync.write(Object.assign(new PNG({ width: pixels.width, height: pixels.height }), { data: Buffer.from(pixels.data) }))
const FRAME = png(frame())
// a portrait phone's screenshot of the frame, its clock and indicators lit in the bars, which coded whole is another picture
const PHONE = png(withPhoneChrome(letterboxed(frame(), 640, 1386)))

let dir: string
let server: Server
let port: string

test.beforeAll(async () => {
  test.setTimeout(300_000)
  dir = mkdtempSync(join(tmpdir(), 'stub-scene-'))
  const plugins = join(ROOT, 'src', 'plugins')
  const fetch = join(ROOT, 'src', 'utils', 'fetch')
  await build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'error',
    worker: { plugins: workerFakes },
    build: { outDir: dir, emptyOutDir: true },
    plugins: [{
      name: 'spec-fakes',
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
  port = String((server.address() as AddressInfo).port)
})

test.afterAll(async () => {
  await new Promise(resolve => server ? server.close(resolve) : resolve(undefined))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// trace.moe's answer for the frame, in its own shape (a real one, 2026-10-24, is in tests/unit/scene/search.test.ts):
// Spec Rated's episode 1 in two copies, a special of Spec Sequel with no episode, and a show under the 0.9 bar
const ANSWER = {
  frameCount: 1736418809, error: '', quota: 100, quotaUsed: 1,
  result: [
    { anilist: 900040, filename: 'Spec Rated - 01 (BD).mp4', episode: 1, episode_start: 1, episode_end: 1, from: 282.3, at: 289.8, to: 292.7, similarity: 0.9922 },
    { anilist: 900040, filename: 'Spec Rated - 01 (TV).mp4', episode: 1, episode_start: 1, episode_end: 1, from: 272.19, at: 279.8, to: 282.7, similarity: 0.9844 },
    { anilist: 900001, filename: 'Spec Sequel - OVA.mp4', episode: null, episode_start: null, episode_end: null, from: 97.7, at: 98.2, to: 98.9, similarity: 0.944 },
    { anilist: 900010, filename: 'Spec Late - 07.mp4', episode: 7, episode_start: 7, episode_end: 7, from: 1252, at: 1252.2, to: 1255.2, similarity: 0.5676 },
  ],
}

/**
 * Answers trace.moe as a CORS-open upstream does, and keeps every request it got and every request the page made,
 * the worker's included, wherever it went. A preflight would be one more request to trace.moe.
 */
const traceMoe = async (page: Page, answer: () => { status: number, json: unknown } = () => ({ status: 200, json: ANSWER })) => {
  const asked: Request[] = []
  const sent: Request[] = []
  page.context().on('request', request => { sent.push(request) })
  await page.context().route(url => url.port !== port, route => route.abort())
  await page.context().route('https://api.trace.moe/**', route => {
    asked.push(route.request())
    return route.fulfill({ ...answer(), headers: { 'access-control-allow-origin': '*' } })
  })
  return { asked, sent }
}

const at = (host: string, path = '/') => `http://${host}:${port}${path}`
const field = (page: Page) => page.getByRole('textbox', { name: 'Search by title' })
const sceneUrl = new RegExp(`/search\\?scene=${FRAME_CODE}$`)

/**
 * What a drop or a paste hands the page: the file itself, built in the page from its bytes. Answers whether the page
 * took each event from the browser, which opens a dropped file in the tab when its dragover or its drop is not taken.
 */
const handOver = (page: Page, kind: 'drop' | 'paste', bytes: Buffer, name: string) =>
  page.evaluate(({ kind, bytes, name }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    const events = kind === 'paste'
      ? [new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })]
      : ['dragover', 'drop'].map(type => new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }))
    return events.map(event => {
      document.dispatchEvent(event)
      return event.defaultPrevented
    })
  }, { kind, bytes: [...bytes], name })

test('a picture picked on anime.fkn.app\'s search page finds its show, from the browser, by its color code alone', async ({ page }) => {
  const { asked, sent } = await traceMoe(page)
  await page.goto(at('anime.localhost', '/search'))
  await expect(field(page)).toBeVisible()
  await page.locator('.text-field input[type="file"]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: FRAME })
  await expect(page).toHaveURL(sceneUrl)

  await expect(page.locator('.heading')).toHaveText('Scene search')
  await expect(page.locator('.credit')).toHaveText('Scenes found by trace.moe')
  const scenes = page.locator('.scene')
  await expect(scenes).toHaveCount(2)
  await expect(scenes.nth(0)).toContainText('Spec Rated')
  await expect(scenes.nth(0).locator('a[href^="/media/"]').first()).toHaveAttribute('href', /anilist:900040\b/)
  const moment = scenes.nth(0).locator('a.moment')
  await expect(moment, 'the earliest copy of episode 1').toHaveText('Episode 1, 4:32')
  await expect(moment).toHaveAttribute('href', /^\/watch\/[^?]+\/[^?]+\?t=272$/)
  await expect(scenes.nth(1), 'the special').toContainText('Spec Sequel')
  await expect(scenes.nth(1).locator('.moment'), 'a moment with no episode opens only the show').toHaveCount(0)

  expect(asked.map(request => [request.method(), request.url()])).toEqual([['GET', `https://api.trace.moe/search?vector=${FRAME_CODE}`]])
  const [search] = asked
  expect(search!.headers().origin, 'asked by the page itself, which a relay is not').toBe(at('anime.localhost', ''))
  expect(search!.postDataBuffer(), 'no body').toBeNull()
  expect(sent.filter(request => request.postDataBuffer()).map(request => request.url()), 'no request carries a body, so none the picture').toEqual([])
  expect(sent.filter(request => request.url().includes(FRAME_CODE)).map(request => request.url()), 'the code goes to trace.moe alone').toEqual([`https://api.trace.moe/search?vector=${FRAME_CODE}`])

  await moment.click()
  await expect(page, 'the episode opens at the scene').toHaveURL(/\/watch\/.+\?t=272$/)
})

test('a phone screenshot dropped on the page is searched as its frame, and a pasted one too', async ({ page }) => {
  const { asked } = await traceMoe(page)
  await page.goto(at('anime.localhost', '/search?q=spec'))
  await expect(field(page)).toBeVisible()
  expect(await handOver(page, 'drop', PHONE, 'phone.png'), 'its dragover and its drop taken').toEqual([true, true])
  await expect(page, 'the same code as the frame').toHaveURL(sceneUrl)
  await expect(page.locator('.scene').first()).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/search\?q=spec$/)
  await expect(field(page)).toHaveValue('spec')
  expect(await handOver(page, 'paste', PHONE, 'phone.png')).toEqual([true])
  await expect(page).toHaveURL(sceneUrl)
  await expect(page.locator('.scene').first()).toBeVisible()
  expect(asked.map(request => request.url()), 'one ask per open').toEqual([
    `https://api.trace.moe/search?vector=${FRAME_CODE}`,
    `https://api.trace.moe/search?vector=${FRAME_CODE}`,
  ])
})

test('the address alone reopens the search on a reload, and a refusal is its one line', async ({ page }) => {
  let refuse = false
  const { asked } = await traceMoe(page, () => refuse
    ? { status: 402, json: { quota: 100, quotaUsed: 100, error: 'Search quota depleted (quota per 24 hours: 100, used: 100)' } }
    : { status: 200, json: ANSWER })
  await page.goto(at('anime.localhost', `/search?scene=${FRAME_CODE}`))
  await expect(page.locator('.scene').first()).toBeVisible()
  refuse = true
  await page.reload()
  await expect(page.locator('.status')).toHaveText("trace.moe's daily limit is reached. Try again tomorrow.")
  await expect(page.locator('.credit')).toHaveText('Scenes found by trace.moe')
  expect(asked).toHaveLength(2)
})

test('movies.fkn.app offers no scene search, and asks trace.moe nothing for a scene address', async ({ page }) => {
  const { asked } = await traceMoe(page)
  await page.goto(at('anime.localhost', '/search'))
  await expect(page.getByRole('button', { name: 'Search by picture' }), 'the control').toBeVisible()
  await page.goto(at('movies.localhost', `/search?scene=${FRAME_CODE}`))
  await expect(field(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search by picture' })).toHaveCount(0)
  await expect(page.locator('.heading')).not.toHaveText('Scene search')
  expect(await handOver(page, 'paste', FRAME, 'shot.png'), 'left to the browser').toEqual([false])
  await page.waitForTimeout(1_000)
  await expect(page).toHaveURL(at('movies.localhost', `/search?scene=${FRAME_CODE}`))
  expect(asked).toEqual([])
})
