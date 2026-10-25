import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { assetNames, newBuildReady, watchBuild } from '../../../src/update/build-check'

// The head of anime.fkn.app's html as served on 2026-10-25, and the same build after a deploy that
// renamed the entry and the worker chunk.
const head = (main: string, worker: string) => `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
  <link rel="manifest" href="/app.webmanifest" />
  <script type="module" crossorigin src="/assets/${main}"></script>
  <link rel="modulepreload" crossorigin href="/assets/dist-sBTuRPnX.js">
  <link rel="modulepreload" crossorigin href="/assets/player-volume-DTOJyhLh.js">
  <link rel="modulepreload" crossorigin href="/assets/${worker}">
  <link rel="stylesheet" crossorigin href="/assets/main-CSyC6ryz.css">
</head><body><iframe src="https://fkn.app/api"></iframe></body></html>`

const A = head('main-Rl2aCtul.js', 'worker-IlzMjJx_.js')
const B = head('main-DdWNbs0D.js', 'worker-C2hf38q7.js')
const RUNNING = ['/assets/dist-sBTuRPnX.js', '/assets/main-CSyC6ryz.css', '/assets/main-Rl2aCtul.js', '/assets/player-volume-DTOJyhLh.js', '/assets/worker-IlzMjJx_.js']

const js = () => new Response('export {}', { headers: { 'content-type': 'application/javascript' } })
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

/** A server answering `/` with `page` and any asset with `asset(path)`, recording what was asked. */
const serve = (page: () => Response | Promise<Response>, asset: (path: string) => Response = js) => {
  const asked: { path: string, cache?: RequestCache }[] = []
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    asked.push({ path: input, cache: init?.cache })
    return input === '/' ? page() : asset(input)
  })
  return asked
}

beforeEach(() => {
  const { DOMParser } = parseHTML('')
  vi.stubGlobal('DOMParser', DOMParser)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a build is named by the /assets/ files its html loads, and nothing else', () => {
  expect(assetNames(parseHTML(A).document)).toEqual(RUNNING)
})

describe('newBuildReady', () => {
  test('the same build is not one, and downloads nothing', async () => {
    const asked = serve(() => html(A))
    expect(await newBuildReady(RUNNING)).toBe(false)
    expect(asked).toEqual([{ path: '/', cache: 'no-store' }])
  })

  test('a build naming new files is ready once each of them downloaded, and only those', async () => {
    const asked = serve(() => html(B))
    expect(await newBuildReady(RUNNING)).toBe(true)
    expect(asked.map(({ path }) => path)).toEqual(['/', '/assets/main-DdWNbs0D.js', '/assets/worker-C2hf38q7.js'])
  })

  test('a new file answering html is a deploy still reaching this edge, so not ready', async () => {
    serve(() => html(B), path => path.includes('worker') ? html(A) : js())
    expect(await newBuildReady(RUNNING)).toBe(false)
  })

  test('a new file the server refuses is not downloaded, whatever type it names', async () => {
    serve(() => html(B), path => path.includes('worker') ? new Response('', { status: 404, headers: { 'content-type': 'application/javascript' } }) : js())
    expect(await newBuildReady(RUNNING)).toBe(false)
  })

  test('an error page is not a build', async () => {
    serve(() => new Response('<!doctype html><title>502 Bad Gateway</title>', { status: 502 }))
    expect(await newBuildReady(RUNNING)).toBe(false)
  })
})

describe('watchBuild', () => {
  let window: Window & typeof globalThis
  let document: Document
  let visibility: DocumentVisibilityState

  beforeEach(() => {
    ;({ window, document } = parseHTML(A) as unknown as { window: Window & typeof globalThis, document: Document })
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { get: () => visibility })
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', document)
  })

  const show = async (state: DocumentVisibilityState) => {
    visibility = state
    document.dispatchEvent(new window.Event('visibilitychange'))
    await vi.waitFor(() => {})
  }

  test('a tab coming back into view checks, and a hidden one does not', async () => {
    const asked = serve(() => html(B))
    const ready = vi.fn()
    watchBuild(ready)
    await show('hidden')
    expect(asked, 'the control: hiding asks nothing').toEqual([])
    await show('visible')
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  })

  test('a check still on its way is not started again', async () => {
    let answer!: () => void
    const asked = serve(() => new Promise(resolve => { answer = () => resolve(html(B)) }))
    const ready = vi.fn()
    watchBuild(ready)
    await show('visible')
    await show('visible')
    window.dispatchEvent(new window.Event('vite:preloadError'))
    expect(asked).toEqual([{ path: '/', cache: 'no-store' }])
    answer()
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
    await show('visible')
    expect(ready).toHaveBeenCalledOnce()
  })

  test('a lazy chunk that fails to load checks', async () => {
    serve(() => html(B))
    const ready = vi.fn()
    watchBuild(ready)
    window.dispatchEvent(new window.Event('vite:preloadError'))
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
  })

  test('an open tab checks every 15 minutes, and stops once a build is ready', async () => {
    vi.useFakeTimers()
    let page = A
    const asked = serve(() => html(page))
    const ready = vi.fn()
    watchBuild(ready)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(asked).toHaveLength(1)
    expect(ready, 'the control: nothing moved').not.toHaveBeenCalled()
    page = B
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(ready).toHaveBeenCalledOnce()
    const after = asked.length
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    await show('visible')
    expect(asked).toHaveLength(after)
    expect(ready).toHaveBeenCalledOnce()
  })

  test('a link a lazy load adds to the head after startup is not an update', async () => {
    const asked = serve(() => html(A))
    const ready = vi.fn()
    watchBuild(ready)
    // what Vite's preload helper appends when the theme player loads
    for (const [rel, href] of [['modulepreload', '/assets/theme-player-DxwoSNuJ.js'], ['stylesheet', '/assets/theme-player-B1x2y3z4.css']]) {
      const link = document.createElement('link')
      Object.assign(link, { rel, href })
      link.setAttribute('href', href!)
      document.head.append(link)
    }
    await show('visible')
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    expect(ready).not.toHaveBeenCalled()
  })
})
