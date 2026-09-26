import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { receiveEmbedTitle, serveEmbedTitle } from '../../src/embed-title'

// The watch page and its embed as two fake windows. A message is delivered a task later, as the
// browser does, carries the sender as `source`, and is dropped when the target origin does not match.

type FakeWindow = EventTarget & {
  location: { origin: string }
  parent: FakeWindow
  postMessage: (data: unknown, targetOrigin: string) => void
}

const makeWindow = (origin: string) => {
  const win = Object.assign(new EventTarget(), { location: { origin } }) as FakeWindow
  win.parent = win
  return win
}

const deliver = (target: FakeWindow, source: FakeWindow) => (data: unknown, targetOrigin: string) => {
  if (targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const APP = 'https://anime.fkn.app'

const makePage = (embedOrigin = APP) => {
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

describe('the embed title', () => {
  test('reaches an embed that starts after the page sent it, by the embed asking', async () => {
    const { page, embed, iframe } = makePage()
    stops.push(serveEmbedTitle(iframe, 'E5 - The Rain Stops', page))
    // the page's first send landed on the blank document the iframe held before the embed loaded
    await new Promise(resolve => setTimeout(resolve, 5))

    const titles: string[] = []
    stops.push(receiveEmbedTitle(title => titles.push(title), embed))
    await vi.waitFor(() => expect(titles).toEqual(['E5 - The Rain Stops']))
  })

  test('follows a title that changes after the embed started', async () => {
    const { page, embed, iframe } = makePage()
    const titles: string[] = []
    stops.push(receiveEmbedTitle(title => titles.push(title), embed))
    // nothing is served yet, so the embed's ask goes unanswered
    await new Promise(resolve => setTimeout(resolve, 5))

    const stop = serveEmbedTitle(iframe, 'Episode 5', page)
    await vi.waitFor(() => expect(titles).toEqual(['Episode 5']))
    stop()
    stops.push(serveEmbedTitle(iframe, 'E5 - The Rain Stops', page))
    await vi.waitFor(() => expect(titles).toEqual(['Episode 5', 'E5 - The Rain Stops']))
  })

  test('is never delivered to an embed on another origin', async () => {
    const { page, embed, iframe } = makePage('https://player.example')
    const titles: string[] = []
    stops.push(receiveEmbedTitle(title => titles.push(title), embed))
    stops.push(serveEmbedTitle(iframe, 'E5 - The Rain Stops', page))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(titles).toEqual([])
  })
})
