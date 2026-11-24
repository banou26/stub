import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { serveEmbedSourceSwitch, watchHostSourceSwitch } from '../../src/embed-source-switch'

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

describe('embed source switch bridge', () => {
  test('serveEmbedSourceSwitch pushes state, answers re-asks, and forwards enabled requests only', async () => {
    const { page, embed, iframe } = makePage()
    const states: unknown[] = []
    const onRequest = vi.fn()

    stops.push(serveEmbedSourceSwitch(iframe, 'Switch', onRequest, page))
    stops.push(watchHostSourceSwitch(sourceSwitch => states.push(sourceSwitch), embed))

    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(1))
    const current = states.at(-1) as { title?: string, request: () => void }
    expect(current.title).toBe('Switch')

    current.request()
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1))

    // Wrong origin or different source must not invoke onRequest
    page.dispatchEvent(Object.assign(new Event('message'), {
      data: { type: 'stub:embed-source-switch-request' },
      source: embed,
      origin: 'https://evil.example',
    }))
    page.dispatchEvent(Object.assign(new Event('message'), {
      data: { type: 'stub:embed-source-switch-request' },
      source: page,
      origin: APP,
    }))
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  test('watchHostSourceSwitch maps boolean true to default label and clears on false or empty string', async () => {
    const { page, embed, iframe } = makePage()
    const states: unknown[] = []
    const onRequest = vi.fn()

    const stopEnabled = serveEmbedSourceSwitch(iframe, true, onRequest, page)
    stops.push(stopEnabled)
    stops.push(watchHostSourceSwitch(sourceSwitch => states.push(sourceSwitch), embed))

    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(1))
    expect((states.at(-1) as { title?: string }).title).toBeUndefined()

    stopEnabled()
    stops.push(serveEmbedSourceSwitch(iframe, false, onRequest, page))
    await vi.waitFor(() => expect(states.at(-1)).toBeUndefined())

    page.dispatchEvent(Object.assign(new Event('message'), {
      data: { type: 'stub:embed-source-switch-request' },
      source: embed,
      origin: APP,
    }))
    expect(onRequest).not.toHaveBeenCalled()
  })
})
