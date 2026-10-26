import type { HostFullscreen } from '@banou/media-player'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { serveEmbedFullscreen, watchHostFullscreen } from '../../src/embed-fullscreen'

// The watch page and its embed as fake windows, as in embed-title.test.ts: a message is delivered a task later,
// carries the sender as `source`, and is dropped when the target origin does not match. The page's document says
// whether it can fullscreen and what is fullscreen, and `enter` and `leave` stand for the browser changing it.

type FakeDocument = EventTarget & {
  fullscreenEnabled: boolean
  fullscreenElement: Element | null
  exitFullscreen: () => Promise<void>
}

type FakeWindow = EventTarget & {
  location: { origin: string }
  parent: FakeWindow
  document: FakeDocument
  postMessage: (data: unknown, targetOrigin: string) => void
}

const makeWindow = (origin: string, fullscreenEnabled = true) => {
  const document = Object.assign(new EventTarget(), { fullscreenEnabled, fullscreenElement: null, exitFullscreen: vi.fn(async () => {}) })
  const win = Object.assign(new EventTarget(), { location: { origin }, document }) as unknown as FakeWindow
  win.parent = win
  return win
}

const deliver = (target: FakeWindow, source: FakeWindow) => (data: unknown, targetOrigin: string) => {
  if (targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const APP = 'https://anime.fkn.app'

const makePage = ({ embedOrigin = APP, fullscreenEnabled = true } = {}) => {
  const page = makeWindow(APP, fullscreenEnabled)
  const embed = makeWindow(embedOrigin)
  embed.parent = page
  page.postMessage = deliver(page, embed)
  embed.postMessage = deliver(embed, page)
  const iframe = { contentWindow: embed } as unknown as HTMLIFrameElement
  const stage = { requestFullscreen: vi.fn(async () => {}) } as unknown as HTMLElement & { requestFullscreen: ReturnType<typeof vi.fn> }
  const change = (element: Element | null) => {
    page.document.fullscreenElement = element
    page.document.dispatchEvent(new Event('fullscreenchange'))
  }
  return { page: page as unknown as Window, document: page.document, embed: embed as unknown as Window, iframe, stage, change }
}

const delivered = () => new Promise(resolve => setTimeout(resolve, 5))

const stops: (() => void)[] = []
afterEach(() => { while (stops.length) stops.pop()!() })

describe('the embed\'s fullscreen, kept by the watch page', () => {
  test('a request from the embed fullscreens the stage, and leaves fullscreen once the page is in it', async () => {
    const { page, document, embed, iframe, stage, change } = makePage()
    const states: HostFullscreen[] = []
    stops.push(watchHostFullscreen(state => states.push(state), embed))
    // nothing is served yet, so the embed's ask goes unanswered
    await delivered()
    stops.push(serveEmbedFullscreen(iframe, stage, page))
    await vi.waitFor(() => expect(states.map(state => state.active)).toEqual([false]))

    states.at(-1)!.request()
    await vi.waitFor(() => expect(stage.requestFullscreen).toHaveBeenCalledTimes(1))
    expect(document.exitFullscreen).not.toHaveBeenCalled()

    change(stage)
    await vi.waitFor(() => expect(states.map(state => state.active)).toEqual([false, true]))
    states.at(-1)!.request()
    await vi.waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledTimes(1))
    expect(stage.requestFullscreen).toHaveBeenCalledTimes(1)

    change(null)
    await vi.waitFor(() => expect(states.map(state => state.active)).toEqual([false, true, false]))
  })

  test('an embed that starts after the page served it hears the state by asking', async () => {
    const { page, embed, iframe, stage } = makePage()
    stops.push(serveEmbedFullscreen(iframe, stage, page))
    // the page's first word landed on the blank document the iframe held before the embed loaded
    await delivered()

    const states: boolean[] = []
    stops.push(watchHostFullscreen(state => states.push(state.active), embed))
    await vi.waitFor(() => expect(states).toEqual([false]))
  })

  test('where the page cannot fullscreen, the embed is never told, so it keeps its own fullscreen, and a request does nothing', async () => {
    const { page, embed, iframe, stage } = makePage({ fullscreenEnabled: false })
    stops.push(serveEmbedFullscreen(iframe, stage, page))
    const states: boolean[] = []
    stops.push(watchHostFullscreen(state => states.push(state.active), embed))
    embed.parent.postMessage({ type: 'stub:embed-fullscreen-request' }, APP)
    await delivered()
    expect(states).toEqual([])
    expect(stage.requestFullscreen).not.toHaveBeenCalled()
  })

  test('nothing is heard from or told to an embed on another origin', async () => {
    const { page, embed, iframe, stage } = makePage({ embedOrigin: 'https://player.example' })
    stops.push(serveEmbedFullscreen(iframe, stage, page))
    const states: boolean[] = []
    stops.push(watchHostFullscreen(state => states.push(state.active), embed))
    // the embed's own post, aimed at the page's origin, which the fake delivers with the embed's
    ;(embed.parent as unknown as FakeWindow).postMessage({ type: 'stub:embed-fullscreen-request' }, APP)
    await delivered()
    expect(states).toEqual([])
    expect(stage.requestFullscreen).not.toHaveBeenCalled()
  })

  test('an embed framed by a page on another origin hears nothing from it', async () => {
    const foreign = makeWindow('https://player.example')
    const embed = makeWindow(APP)
    embed.parent = foreign
    foreign.postMessage = () => {}
    const states: boolean[] = []
    stops.push(watchHostFullscreen(state => states.push(state.active), embed as unknown as Window))
    deliver(embed, foreign)({ type: 'stub:embed-fullscreen', active: true }, APP)
    await delivered()
    expect(states).toEqual([])
  })

  test('the page hears only its embed, and the embed only the page, even from this origin', async () => {
    const { page, embed, iframe, stage } = makePage()
    const states: boolean[] = []
    stops.push(watchHostFullscreen(state => states.push(state.active), embed))
    await delivered()
    stops.push(serveEmbedFullscreen(iframe, stage, page))
    await vi.waitFor(() => expect(states).toEqual([false]))

    const other = makeWindow(APP)
    deliver(page as unknown as FakeWindow, other)({ type: 'stub:embed-fullscreen-request' }, APP)
    deliver(embed as unknown as FakeWindow, other)({ type: 'stub:embed-fullscreen', active: true }, APP)
    // the source WebKit gave the page's word when it was sent from a listener's tail call
    deliver(embed as unknown as FakeWindow, embed as unknown as FakeWindow)({ type: 'stub:embed-fullscreen', active: true }, APP)
    await delivered()
    expect(stage.requestFullscreen).not.toHaveBeenCalled()
    expect(states).toEqual([false])
  })

  test('the stop leaves the embed\'s requests unheard', async () => {
    const { page, embed, iframe, stage } = makePage()
    const states: HostFullscreen[] = []
    stops.push(watchHostFullscreen(state => states.push(state), embed))
    await delivered()
    const stop = serveEmbedFullscreen(iframe, stage, page)
    await vi.waitFor(() => expect(states).toHaveLength(1))
    stop()
    states[0]!.request()
    await delivered()
    expect(stage.requestFullscreen).not.toHaveBeenCalled()
  })
})
