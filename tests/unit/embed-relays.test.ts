import { afterEach, expect, test, vi } from 'vite-plus/test'

import { hearTriedRelays, tellTriedRelay, triedRelaysOf, triedRelaysParams } from '../../src/embed-relays'

// The watch page and its embed as fake windows, as in embed-title.test.ts: a message is delivered a
// task later, carries the sender as `source`, and is dropped when the target origin does not match.
// What the page remembers lasts the module's life, so every test names shows of its own.

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

test('the next episode of a show starts past every relay the embed moved away from, once each', async () => {
  const { page, embed, iframe } = makePage()
  stops.push(hearTriedRelays(iframe, 'cr:SHOW1-SEASON1-EPISODE1', page))
  tellTriedRelay('r1', embed)
  tellTriedRelay('r2', embed)
  tellTriedRelay('r1', embed)
  await vi.waitFor(() => expect(triedRelaysParams('cr:SHOW1-SEASON2-EPISODE9')).toEqual({ triedRelays: 'r1,r2' }))
  expect(triedRelaysOf(new URLSearchParams(triedRelaysParams('cr:SHOW1-SEASON1-EPISODE2')))).toEqual(['r1', 'r2'])

  expect(triedRelaysParams('cr:SHOW2-SEASON1-EPISODE1')).toEqual({})
  expect(triedRelaysOf(new URLSearchParams({ url: 'https://www.crunchyroll.com/watch/GX1' }))).toEqual([])
})

test('only the embed the page frames, on this app\'s origin, is heard', async () => {
  const framed = makePage()
  const other = makePage()
  stops.push(hearTriedRelays(framed.iframe, 'cr:SHOW3-SEASON1-EPISODE1', framed.page))
  // a document on another origin in the same iframe, another embed sending to this page, and another message of the embed's
  const tried = (relay: string) => ({ type: 'stub:embed-relay-tried', relay })
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: tried('r1'), source: framed.embed, origin: 'https://other.example' }))
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: tried('r2'), source: other.embed, origin: APP }))
  framed.page.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'stub:embed-title', relay: 'r3' }, source: framed.embed, origin: APP }))
  expect(triedRelaysParams('cr:SHOW3-SEASON1-EPISODE2')).toEqual({})

  tellTriedRelay('r4', framed.embed)
  await vi.waitFor(() => expect(triedRelaysParams('cr:SHOW3-SEASON1-EPISODE2')).toEqual({ triedRelays: 'r4' }))
})

test('an embed with no page around it tells nobody', async () => {
  const top = makeWindow(APP)
  const heard = vi.fn()
  top.addEventListener('message', heard)
  tellTriedRelay('r1', top as unknown as Window)
  await delivered()
  expect(heard).not.toHaveBeenCalled()
})
