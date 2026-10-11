import type { EmbedTracks, TrackKind } from '../../src/embed-tracks'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { embedTracks, serveEmbedTracks } from '../../src/embed-tracks'

// The watch page and its embed as fake windows, as in embed-title.test.ts: a message is delivered a
// task later, carries the sender as `source`, and is dropped when the target origin is neither `*`
// nor the target's.

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
  if (targetOrigin !== '*' && targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const APP = 'https://anime.fkn.app'

const makePage = (embedOrigin = APP, pageOrigin = APP) => {
  const page = makeWindow(pageOrigin)
  const embed = makeWindow(embedOrigin)
  embed.parent = page
  page.postMessage = deliver(page, embed)
  embed.postMessage = deliver(embed, page)
  const iframe = Object.assign(new EventTarget(), { contentWindow: embed }) as unknown as HTMLIFrameElement
  return { page: page as unknown as Window, embed: embed as unknown as Window, iframe }
}

const load = (iframe: HTMLIFrameElement) => iframe.dispatchEvent(new Event('load'))

const TRACKS: EmbedTracks = {
  subtitles: { ids: ['English', 'Deutsch'], selected: 'English' },
  audio: { ids: ['Japanese', 'English'], selected: 'Japanese' },
  busy: false,
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const noPick = () => {}

const stops: (() => void)[] = []
afterEach(() => { while (stops.length) stops.pop()!() })

describe('the embed tracks', () => {
  test('the page asks an embed that started first once its document has loaded, and not before', async () => {
    const { page, embed, iframe } = makePage()
    stops.push(serveEmbedTracks(TRACKS, noPick, embed))
    // the embed's own send reached a page that was not listening yet
    await wait(5)

    const link = embedTracks(iframe, page)
    stops.push(link.dispose)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    // before its load the iframe's window can still be the previous episode's document
    await wait(20)
    expect(heard).toEqual([])
    load(iframe)
    await vi.waitFor(() => expect(heard).toEqual([TRACKS]))
  })

  test('a disposed link neither asks nor hears', async () => {
    const { page, embed, iframe } = makePage()
    const link = embedTracks(iframe, page)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    link.dispose()
    const asked: unknown[] = []
    embed.addEventListener('message', event => asked.push(event.data))

    stops.push(serveEmbedTracks(TRACKS, noPick, embed))
    load(iframe)
    await wait(20)
    expect(heard).toEqual([])
    expect(asked).toEqual([])
  })

  test('the page hears every change, and a late ear gets the last one at once', async () => {
    const { page, embed, iframe } = makePage()
    const link = embedTracks(iframe, page)
    stops.push(link.dispose)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    // nothing is served yet, so the page's ask goes unanswered
    await wait(5)

    const stop = serveEmbedTracks(TRACKS, noPick, embed)
    await vi.waitFor(() => expect(heard).toEqual([TRACKS]))
    stop()
    const switching = { ...TRACKS, busy: true }
    stops.push(serveEmbedTracks(switching, noPick, embed))
    await vi.waitFor(() => expect(heard).toEqual([TRACKS, switching]))

    const late: EmbedTracks[] = []
    link.onTracks(tracks => late.push(tracks))
    expect(late).toEqual([switching])
  })

  test('the embed\'s other messages to the page are not heard as tracks', async () => {
    const { page, embed, iframe } = makePage()
    const link = embedTracks(iframe, page)
    stops.push(link.dispose)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    // the title channel's ask, which the same embed sends its page
    embed.parent.postMessage({ type: 'stub:embed-title?' }, APP)
    await wait(20)
    expect(heard).toEqual([])
  })

  test('a pick reaches the embed for each kind, subtitles off included', async () => {
    const { page, embed, iframe } = makePage()
    const picks: [TrackKind, string | null][] = []
    stops.push(serveEmbedTracks(TRACKS, (kind, id) => picks.push([kind, id]), embed))
    const link = embedTracks(iframe, page)
    stops.push(link.dispose)

    link.select('subtitles', 'Deutsch')
    link.select('audio', 'English')
    link.select('subtitles', null)
    await vi.waitFor(() => expect(picks).toEqual([['subtitles', 'Deutsch'], ['audio', 'English'], ['subtitles', null]]))
  })

  test('an embed on another origin is neither heard nor sent a pick', async () => {
    const { page, embed, iframe } = makePage('https://player.example')
    const picks: unknown[] = []
    stops.push(serveEmbedTracks(TRACKS, (...pick) => picks.push(pick), embed))
    const link = embedTracks(iframe, page)
    stops.push(link.dispose)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    link.select('audio', 'English')
    // and posted straight at each other's origin, each is still refused by the other's origin
    deliver(page as unknown as FakeWindow, embed as unknown as FakeWindow)({ type: 'stub:embed-tracks', tracks: TRACKS }, APP)
    deliver(embed as unknown as FakeWindow, page as unknown as FakeWindow)({ type: 'stub:embed-track-pick', kind: 'audio', id: 'English' }, 'https://player.example')
    await wait(20)
    expect(heard).toEqual([])
    expect(picks).toEqual([])
  })

  test('an embed no page frames posts nothing', () => {
    const alone = makeWindow(APP)
    alone.postMessage = vi.fn()
    stops.push(serveEmbedTracks(TRACKS, noPick, alone as unknown as Window))
    expect(alone.postMessage).not.toHaveBeenCalled()
  })

  test('nothing is posted to a window on another origin, either way', async () => {
    const foreignEmbed = makePage('https://player.example')
    const foreignPage = makePage(APP, 'https://player.example')
    const received: unknown[] = []
    foreignEmbed.embed.addEventListener('message', event => received.push(event.data))
    foreignPage.page.addEventListener('message', event => received.push(event.data))

    const link = embedTracks(foreignEmbed.iframe, foreignEmbed.page)
    stops.push(link.dispose)
    link.select('audio', 'English')
    stops.push(serveEmbedTracks(TRACKS, noPick, foreignPage.embed))
    await wait(20)
    expect(received).toEqual([])
  })

  test('another window on the same origin is neither heard as the embed nor obeyed as the page', async () => {
    const { page, embed, iframe } = makePage()
    const other = makeWindow(APP) as FakeWindow
    const link = embedTracks(iframe, page)
    stops.push(link.dispose)
    const heard: EmbedTracks[] = []
    link.onTracks(tracks => heard.push(tracks))
    await wait(5)
    const picks: unknown[] = []
    stops.push(serveEmbedTracks(TRACKS, (...pick) => picks.push(pick), embed))
    await vi.waitFor(() => expect(heard).toEqual([TRACKS]))

    // a second frame on the page posting as an embed, and a stranger posting a pick to the embed
    deliver(page as unknown as FakeWindow, other)({ type: 'stub:embed-tracks', tracks: { busy: true } }, APP)
    deliver(embed as unknown as FakeWindow, other)({ type: 'stub:embed-track-pick', kind: 'audio', id: 'English' }, APP)
    await wait(20)
    expect(heard).toEqual([TRACKS])
    expect(picks).toEqual([])
  })
})
