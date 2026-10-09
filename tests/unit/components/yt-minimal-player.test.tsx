// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import YoutubeMinimalPlayer from '../../../src/components/yt-minimal-player'

// The trailer player against a fake YouTube embed that answers the handshake the way the live one
// does, measured on anime.fkn.app 2026-10-09: the first `listening` a player gets is answered with
// `onReady`, and every later one with `alreadyInitialized`, never a second `onReady`.
//
// linkedom gives an iframe no `contentWindow`, and node has no global `addEventListener` or
// `location`, so the test supplies exactly those: a fake embed behind each frame, and the linkedom
// window as the page the embed posts to, which is what the global listener is in a browser.

const YOUTUBE = 'https://www.youtube.com'
const TRAILER = 'https://www.youtube.com/watch?v=phKPnPXm74c'
const OTHER = 'https://youtu.be/iiuRyNg3giw'

type Posted = { event: string, func?: string, args?: unknown[] }

/**
 * One per document a frame loads, so a new `src` on the same element is a new embed, as it is in a
 * browser. It stands in for both the frame's WindowProxy and the embed inside it.
 */
class FakeEmbed {
  readonly posted: Posted[] = []
  /** Whether the player's own script is running. Until it is, the embed answers nothing. */
  running = true
  /** Whether this player already answered a handshake. */
  initialized = false
  /** Set for an unavailable video, which reports this code as its own message right after its `onReady`. */
  error: number | null = null

  constructor (readonly src: string | null) {}

  postMessage (message: string, targetOrigin: string) {
    expect(targetOrigin).toBe(YOUTUBE)
    const data = JSON.parse(message) as Posted
    this.posted.push(data)
    if (data.event !== 'listening' || !this.running) return
    const answer = this.initialized ? 'alreadyInitialized' : 'onReady'
    const error = this.initialized ? null : this.error
    this.initialized = true
    // a posted message is delivered as a later task, never inside the sender's call
    setTimeout(() => this.send({ event: answer, info: null, channel: 'widget', id: 1 }), 0)
    if (error !== null) setTimeout(() => this.send({ event: 'onError', info: error, channel: 'widget', id: 1 }), 0)
  }

  send (payload: object) {
    window.dispatchEvent(Object.assign(new Event('message'), { origin: YOUTUBE, source: this, data: JSON.stringify(payload) }))
  }
}

const embeds = new WeakMap<object, FakeEmbed>()
const iframePrototype = Object.getPrototypeOf(document.createElement('iframe')) as object

const hosts: HTMLElement[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', { origin: 'https://anime.fkn.app' })
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window))
  Object.defineProperty(iframePrototype, 'contentWindow', {
    configurable: true,
    get (this: Element) {
      const src = this.getAttribute('src')
      let embed = embeds.get(this)
      if (embed?.src !== src) embeds.set(this, embed = new FakeEmbed(src))
      return embed
    },
  })
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  delete (iframePrototype as { contentWindow?: unknown }).contentWindow
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

type Props = Parameters<typeof YoutubeMinimalPlayer>[0]

const player = (props: Props) => {
  const host = mount(<YoutubeMinimalPlayer {...props}/>)
  hosts.push(host)
  return {
    host,
    rerender: (next: Props) => act(() => { render(<YoutubeMinimalPlayer {...next}/>, host) }),
    frame: () => host.querySelector('iframe')!,
    embed: () => host.querySelector('iframe')!.contentWindow as unknown as FakeEmbed,
  }
}

const elapse = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const listening = (embed: FakeEmbed) => embed.posted.filter(message => message.event === 'listening').length
const commands = (embed: FakeEmbed) => embed.posted.filter(message => message.event === 'command').map(message => message.func)

// CONTROL: the rig can see a frame go from hidden to shown, and the ready state drive the player.
test('shows the trailer once the embed answers the handshake with onReady', () => {
  const { frame, embed } = player({ url: TRAILER, volume: 0, onError: () => {} })
  expect(frame().style.display, 'hidden until the embed answers').toBe('none')

  elapse(300)
  expect(listening(embed())).toBe(1)
  expect(frame().style.display).toBe('')
  expect(commands(embed())).toEqual(['mute', 'playVideo'])
})

// Every parent's onError is keyed on live data, so a new one arrives after the embed is ready.
// Restarting the handshake for it hides the frame for good, since the embed answers only
// `alreadyInitialized` from then on: the trailer plays on behind display: none, and the pause and
// volume controls are dead.
test('a parent handing a new onError after ready leaves the trailer showing and controllable', () => {
  const { frame, embed, rerender } = player({ url: TRAILER, volume: 0, onError: () => {} })
  elapse(300)
  expect(frame().style.display).toBe('')
  const asked = listening(embed())

  rerender({ url: TRAILER, volume: 0, onError: () => {} })
  expect(frame().style.display, 'still shown right after the re-render').toBe('')
  elapse(15_000)
  expect(frame().style.display, 'still shown once the timers ran').toBe('')
  expect(listening(embed()), 'the embed was not asked again').toBe(asked)

  rerender({ url: TRAILER, volume: 0, paused: true, onError: () => {} })
  expect(commands(embed()).at(-1)).toBe('pauseVideo')
})

test('asks until the embed answers, and stops once it has', () => {
  const { frame, embed } = player({ url: TRAILER, onError: () => {} })
  embed().running = false
  elapse(1_000)
  expect(listening(embed()), 'repeated while the player is not running yet').toBe(4)
  expect(frame().style.display).toBe('none')

  embed().running = true
  elapse(300)
  expect(frame().style.display).toBe('')
  elapse(15_000)
  expect(listening(embed())).toBe(5)
})

// Pins the ref: dropping onError from the effect's dependencies alone would call the first one
// forever, and the modal's first one spreads a stale list of banned trailers.
test('an embed error reaches the latest onError', () => {
  const first = vi.fn()
  const latest = vi.fn()
  const { embed, rerender } = player({ url: TRAILER, onError: first })
  elapse(300)
  rerender({ url: TRAILER, onError: latest })

  act(() => { embed().send({ event: 'onError', info: 150, channel: 'widget', id: 1 }) })
  expect(latest).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
})

// An unavailable video answers `onReady` and then `onError` 150 as two messages (measured on a live
// embed 2026-10-09). The theater keeps the errored url once every candidate is banned, so the frame
// has to stay hidden through a new onError.
test('an embed error hides the frame for good while the parent keeps the url', () => {
  const onError = vi.fn()
  const { frame, embed, rerender } = player({ url: TRAILER, onError })
  embed().error = 150
  elapse(300)
  expect(onError).toHaveBeenCalledTimes(1)
  expect(frame().style.display, 'hidden by the error').toBe('none')

  rerender({ url: TRAILER, onError: () => onError() })
  elapse(15_000)
  expect(frame().style.display, 'still hidden').toBe('none')
  expect(onError, 'reported once').toHaveBeenCalledTimes(1)
})

// What a parent does on an error: ban that trailer and pass the next one, which has to show.
test('an embed error belongs to its video: the next trailer still shows', () => {
  const { frame, embed, rerender } = player({ url: TRAILER, onError: () => {} })
  embed().error = 150
  elapse(300)
  expect(frame().style.display).toBe('none')

  rerender({ url: OTHER, onError: () => {} })
  elapse(300)
  expect(listening(embed())).toBe(1)
  expect(frame().style.display, 'the next trailer shows').toBe('')
})

// The modal opens over the theater, so two players share the page's `message` listeners.
test('another player on the page erroring leaves this one shown and unreported', () => {
  const mine = vi.fn()
  const theirs = vi.fn()
  const a = player({ url: TRAILER, onError: mine })
  const b = player({ url: OTHER, onError: theirs })
  elapse(300)
  expect(a.frame().style.display).toBe('')
  expect(b.frame().style.display).toBe('')

  act(() => { b.embed().send({ event: 'onError', info: 150, channel: 'widget', id: 1 }) })
  expect(b.frame().style.display, 'the erroring one is hidden').toBe('none')
  expect(theirs).toHaveBeenCalledTimes(1)
  expect(a.frame().style.display, 'this one stays shown').toBe('')
  expect(mine).not.toHaveBeenCalled()
})

test('a url that names no video is reported once per url, to the latest onError', () => {
  const first = vi.fn()
  const latest = vi.fn()
  const { host, rerender } = player({ url: 'https://example.com/trailer.mp4', onError: first })
  expect(host.querySelector('iframe')).toBeNull()
  expect(first).toHaveBeenCalledTimes(1)

  rerender({ url: 'https://example.com/trailer.mp4', onError: latest })
  expect(latest, 'the same url was already reported').not.toHaveBeenCalled()

  // what follows a ban when the next trailer cannot be addressed either
  rerender({ url: 'https://vimeo.com/1', onError: latest })
  expect(latest).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledTimes(1)
})

// Changing `src` on a loaded frame pushes a session history entry, so Back would step the trailer
// rather than the app: measured on a live embed 2026-10-09, history.length went from 2 to 3 on a
// video change with one element, and stayed at 2 with a new element per video.
test('a new video gets a new frame, hidden until its own embed answers', () => {
  const { frame, embed, rerender } = player({ url: TRAILER, onError: () => {} })
  elapse(300)
  const before = frame()

  rerender({ url: OTHER, onError: () => {} })
  expect(frame(), 'a new element, so no history entry').not.toBe(before)
  expect(frame().getAttribute('src')).toContain('/embed/iiuRyNg3giw?')
  expect(frame().style.display).toBe('none')

  elapse(300)
  expect(listening(embed())).toBe(1)
  expect(frame().style.display).toBe('')
})
