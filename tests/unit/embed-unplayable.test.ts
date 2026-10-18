import { afterEach, expect, test, vi } from 'vite-plus/test'

import { hearUnplayable, tellUnplayable } from '../../src/embed-unplayable'

// The watch page and its embed as fake windows, as in embed-relays.test.ts: a message is delivered a
// task later, carries the sender as `source`, and is dropped when the target origin does not match.

type FakeWindow = EventTarget & {
  location: { origin: string }
  parent: FakeWindow
  postMessage: (data: unknown, targetOrigin: string) => void
}

const makeWindow = (origin: string) => {
  const win = Object.assign(new EventTarget(), { location: { origin } }) as FakeWindow
  win.parent = win
  win.postMessage = deliver(win, win)
  return win
}

const deliver = (target: FakeWindow, source: FakeWindow) => (data: unknown, targetOrigin: string) => {
  if (targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const APP = 'https://anime.fkn.app'

const makePage = () => {
  const page = makeWindow(APP)
  const embed = makeWindow(APP)
  embed.parent = page
  page.postMessage = deliver(page, embed)
  const iframe = { contentWindow: embed } as unknown as HTMLIFrameElement
  return { page: page as unknown as Window, embed: embed as unknown as Window, iframe }
}

const delivered = () => new Promise(resolve => setTimeout(resolve, 5))

const stops: (() => void)[] = []
afterEach(() => { while (stops.length) stops.pop()!() })

test('the page hears the embed it frames say its source cannot play the episode', async () => {
  const { page, embed, iframe } = makePage()
  const heard = vi.fn()
  stops.push(hearUnplayable(iframe, heard, page))
  tellUnplayable(embed)
  await vi.waitFor(() => expect(heard).toHaveBeenCalledOnce())
})

test('only the embed the page frames, on this app\'s origin, is heard, and nothing once stopped', async () => {
  const framed = makePage()
  const other = makePage()
  const heard = vi.fn()
  const stop = hearUnplayable(framed.iframe, heard, framed.page)
  const unplayable = { type: 'stub:embed-unplayable' }
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: unplayable, source: framed.embed, origin: 'https://other.example' }))
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: unplayable, source: other.embed, origin: APP }))
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'stub:embed-relay-tried', relay: 'r1' }, source: framed.embed, origin: APP }))
  expect(heard).not.toHaveBeenCalled()

  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: unplayable, source: framed.embed, origin: APP }))
  expect(heard, 'the control: the same message from the framed embed').toHaveBeenCalledOnce()

  stop()
  tellUnplayable(framed.embed)
  await delivered()
  expect(heard).toHaveBeenCalledOnce()
})

test('an embed with no page around it tells nobody', async () => {
  const top = makeWindow(APP)
  const heard = vi.fn()
  top.addEventListener('message', heard)
  tellUnplayable(top as unknown as Window)
  await delivered()
  expect(heard).not.toHaveBeenCalled()
})
