import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { serveEmbedEpisodeNavigation, watchHostEpisodeNavigation } from '../../src/embed-episode'

const APP = 'https://anime.fkn.app'

type FakeWindow = EventTarget & {
  location: { origin: string }
  parent: FakeWindow
  postMessage: (data: unknown, targetOrigin: string) => void
}

const makeWindow = (origin: string) => {
  const win = Object.assign(new EventTarget(), { location: { origin }, postMessage: vi.fn() }) as unknown as FakeWindow
  win.parent = win
  return win
}

const deliver = (target: FakeWindow, source: FakeWindow) => (data: unknown, targetOrigin: string) => {
  if (targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const makePage = ({ embedOrigin = APP } = {}) => {
  const page = makeWindow(APP)
  const embed = makeWindow(embedOrigin)
  embed.parent = page
  page.postMessage = deliver(page, embed)
  embed.postMessage = deliver(embed, page)
  const iframe = { contentWindow: embed } as unknown as HTMLIFrameElement
  return { page: page as unknown as Window, embed: embed as unknown as Window, iframe }
}

const stops: (() => void)[] = []
afterEach(() => { while (stops.length) stops.pop()!() })

describe('embed episode navigation bridge', () => {
  test('serveEmbedEpisodeNavigation pushes state, answers re-asks, and forwards only enabled step clicks', async () => {
    const { page, embed, iframe } = makePage()
    const states: unknown[] = []
    const onStep = vi.fn()

    stops.push(serveEmbedEpisodeNavigation(iframe, { previous: 'E1 - Pilot', next: false }, onStep, page))
    stops.push(watchHostEpisodeNavigation(nav => states.push(nav), embed))

    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(1))
    const first = states.at(-1) as { previous: { title?: string, request: () => void } | null, next: { title?: string, request: () => void } | null }
    expect(first.previous?.title).toBe('E1 - Pilot')
    expect(first.next).toBeNull()

    first.previous?.request()
    await vi.waitFor(() => expect(onStep).toHaveBeenCalledExactlyOnceWith('previous'))

    // Disabled direction or wrong origin must not invoke onStep
    page.dispatchEvent(Object.assign(new Event('message'), {
      data: { type: 'stub:embed-episode-request', direction: 'next' },
      source: embed,
      origin: APP,
    }))
    page.dispatchEvent(Object.assign(new Event('message'), {
      data: { type: 'stub:embed-episode-request', direction: 'previous' },
      source: embed,
      origin: 'https://evil.example',
    }))
    expect(onStep).toHaveBeenCalledTimes(1)
  })

  test('watchHostEpisodeNavigation maps boolean/string titles and yields undefined when both ends are disabled', async () => {
    const { page, embed, iframe } = makePage()
    const states: unknown[] = []

    stops.push(serveEmbedEpisodeNavigation(iframe, { previous: true, next: 'E3 - Finale' }, () => {}, page))
    stops.push(watchHostEpisodeNavigation(nav => states.push(nav), embed))

    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(1))
    const first = states[0] as { previous: { title?: string } | null, next: { title?: string } | null }
    expect(first.previous?.title).toBeUndefined()
    expect(first.next?.title).toBe('E3 - Finale')

    stops.push(serveEmbedEpisodeNavigation(iframe, { previous: false, next: false }, () => {}, page))
    await vi.waitFor(() => expect(states.at(-1)).toBeUndefined())
  })
})
