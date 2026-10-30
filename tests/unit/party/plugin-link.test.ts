// A source package's player as the same link the built-in embed produces, driven with a fake source.
import type { Mock } from 'vite-plus/test'

import { describe, expect, test, vi } from 'vite-plus/test'

import { BUFFER_WAIT_MS, pluginPlaybackLink, servePluginFullscreen } from '../../../src/party/plugin-link'

const STATE = { paused: false, time: 42, rate: 1, at: 1 }

const fakeSource = () => {
  let ear: ((state: typeof STATE) => void) | undefined
  const applied: (typeof STATE)[] = []
  return {
    source: {
      onPlayback: vi.fn(async (listener: (state: typeof STATE) => void) => { ear = listener }),
      applyPlayback: vi.fn(async (state: typeof STATE) => { applied.push(state) }),
    },
    report: (state = STATE) => ear?.(state),
    applied,
  }
}

describe('pluginPlaybackLink', () => {
  // The package is what every plugin written before this shipped: `play` and nothing else.
  test('a source without the surface has no link, and is simply not synced', () => {
    expect(pluginPlaybackLink({})).toBeUndefined()
    expect(pluginPlaybackLink({ onPlayback: async () => {} })).toBeUndefined()
    expect(pluginPlaybackLink({ applyPlayback: async () => {} })).toBeUndefined()
  })

  test('registers an ear with the package and fans out to every report listener', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    expect(source.onPlayback).toHaveBeenCalledTimes(1)

    const a = vi.fn()
    const b = vi.fn()
    link.onReport(a)
    const offB = link.onReport(b)
    report()
    expect(a).toHaveBeenCalledWith(STATE)
    expect(b).toHaveBeenCalledWith(STATE)

    offB()
    report()
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // The package greets its player on every registration and the player answers with a report, so a
  // party that starts against a paused player is told where it is rather than waiting for the host to
  // touch the controls. Found in review, 2026-09-07.
  test('every new report listener registers the ear again, which is how the player is asked where it is', () => {
    const { source } = fakeSource()
    const link = pluginPlaybackLink(source)!
    expect(source.onPlayback).toHaveBeenCalledTimes(1)
    link.onReport(vi.fn())
    expect(source.onPlayback).toHaveBeenCalledTimes(2)
    link.onReport(vi.fn())
    expect(source.onPlayback).toHaveBeenCalledTimes(3)
  })

  // the browser pauses an ended player itself, and the party must not read that pause as a person's
  test('the link says the player ended when the package\'s last report did', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    const heard = vi.fn()
    link.onReport(heard)
    expect(link.ended?.()).toBe(false)
    report({ ...STATE, paused: true, ended: true } as typeof STATE)
    expect(link.ended?.()).toBe(true)
    // and only the playback state goes on, since the host's snapshot carries it to every follower
    expect(heard).toHaveBeenCalledWith({ ...STATE, paused: true })
    report(STATE)
    expect(link.ended?.()).toBe(false)
  })

  // undefined is a package from before it said the length, or live media, which the watch page reads as
  // a player that never says it, rather than as 0, a length not known yet, which it waits on
  test('the link says how long the package\'s player is, and nothing for a package that never says or live media', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    const heard = vi.fn()
    link.onReport(heard)
    report()
    expect(link.duration?.()).toBeUndefined()
    report({ ...STATE, duration: 0 } as typeof STATE)
    expect(link.duration?.()).toBe(0)
    report({ ...STATE, duration: 1420.5 } as typeof STATE)
    expect(link.duration?.()).toBe(1420.5)
    expect(heard).toHaveBeenLastCalledWith(STATE)
    for (const junk of [NaN, -Infinity, -1]) {
      report({ ...STATE, duration: junk } as typeof STATE)
      expect(link.duration?.(), String(junk)).toBe(0)
    }
    for (const none of ['1420', Infinity]) {
      report({ ...STATE, duration: none } as never)
      expect(link.duration?.(), String(none)).toBeUndefined()
    }
  })

  test('apply crosses to the package', () => {
    const { source, applied } = fakeSource()
    pluginPlaybackLink(source)!.apply(STATE)
    expect(applied).toEqual([STATE])
  })

  // The package keeps calling the ear it was given for as long as its player lives, which can be
  // after the page has moved on. A disposed link has to swallow those rather than move a player the
  // party has stopped watching. The listener is added AFTER dispose on purpose: dispose also empties
  // the set, so a listener added before it would prove only that, and not that a report arriving on
  // a dead link is dropped.
  test('a disposed link hears nothing more, whoever listens to it', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    link.dispose()
    const heard = vi.fn()
    link.onReport(heard)
    report()
    expect(heard).not.toHaveBeenCalled()
  })

  test('a package that refuses either call does not take the page down', async () => {
    const link = pluginPlaybackLink({
      onPlayback: async () => { throw new Error('gone') },
      applyPlayback: async () => { throw new Error('gone') },
    })!
    expect(() => link.apply(STATE)).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})

// The package is another origin's code. What it reports goes into the host's snapshot and out to
// every follower, so a report that is not a playback state stops here.
test('a report that is not a playback state is dropped at the link', () => {
  const { source, report } = fakeSource()
  const link = pluginPlaybackLink(source)!
  const heard = vi.fn()
  link.onReport(heard)
  for (const junk of [null, 'playing', { paused: 'no', time: 1, rate: 1, at: 1 }, { paused: false, time: -1, rate: 1, at: 1 }, { paused: false, time: 1, rate: 0, at: 1 }]) {
    report(junk as never)
  }
  expect(heard).not.toHaveBeenCalled()
  report(STATE)
  expect(heard).toHaveBeenCalledWith(STATE)
})

// What a follower tells the host about its player comes from here for a torrent: the package reads
// ripple's player when asked, and the page vets the answer like any other the package gives.
describe('a package\'s buffer', () => {
  const BUFFER = { time: 600, readyState: 4, ranges: [[0, 31.5], [598, 640]] }
  const withBuffer = (buffer: () => Promise<unknown>) => pluginPlaybackLink({ ...fakeSource().source, buffer })!

  test('is what the link\'s buffer answers, asked of the package each time', async () => {
    const buffer = vi.fn(async () => BUFFER)
    const link = withBuffer(buffer)
    await expect(link.buffer!()).resolves.toEqual(BUFFER)
    await expect(link.buffer!()).resolves.toEqual(BUFFER)
    expect(buffer).toHaveBeenCalledTimes(2)
  })

  test('a package without it gives a link without it', () => {
    expect(pluginPlaybackLink(fakeSource().source)!.buffer).toBeUndefined()
  })

  test('an answer of the wrong shape, nothing playing, or a refusal is nothing', async () => {
    for (const junk of [
      undefined, null, 'ready', {},
      { ...BUFFER, time: -1 }, { ...BUFFER, time: NaN }, { ...BUFFER, readyState: 5 }, { ...BUFFER, readyState: '4' },
      { ...BUFFER, ranges: 'all' }, { ...BUFFER, ranges: [[1]] }, { ...BUFFER, ranges: [[2, 1]] }, { ...BUFFER, ranges: [[0, Infinity]] },
    ]) await expect(withBuffer(async () => junk).buffer!(), JSON.stringify(junk)).resolves.toBeUndefined()
    await expect(withBuffer(async () => { throw new Error('gone') }).buffer!()).resolves.toBeUndefined()
  })

  // a package document that stops answering without going away: the follower must not sit on its last word
  test('a package that never answers is nothing once its time is up', async () => {
    vi.useFakeTimers()
    try {
      let answer: unknown = 'pending'
      void withBuffer(() => new Promise(() => {})).buffer!().then(value => { answer = value })
      await vi.advanceTimersByTimeAsync(BUFFER_WAIT_MS - 1)
      expect(answer).toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      expect(answer).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

// What the watch page reads to offer Next episode as a torrent's ending starts: the file's own chapters, vetted
// like the rest of the report, and kept off what goes on to the party.
describe('a package\'s chapters', () => {
  const CHAPTERS = [{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1390, title: 'ED' }]

  test('are the last report\'s, nothing for a package that never says, and stay out of the playback state', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    const heard = vi.fn()
    link.onReport(heard)
    report()
    expect(link.chapters?.()).toBeUndefined()
    report({ ...STATE, chapters: CHAPTERS.map(chapter => ({ ...chapter, extra: 1 })) } as typeof STATE)
    expect(link.chapters?.()).toEqual(CHAPTERS)
    expect(heard).toHaveBeenLastCalledWith(STATE)
    report({ ...STATE, chapters: [] } as typeof STATE)
    expect(link.chapters?.()).toEqual([])
  })

  test('a list of the wrong shape is nothing', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    for (const junk of [
      'ED', {}, [null], [{ start: 0, end: 1 }], [{ start: '0', end: 1, title: 'A' }], [{ start: -1, end: 1, title: 'A' }],
      [{ start: 2, end: 1, title: 'A' }], [{ start: 0, end: Infinity, title: 'A' }], [CHAPTERS[0], { start: 0, end: NaN, title: 'B' }],
    ]) {
      report({ ...STATE, chapters: CHAPTERS } as typeof STATE)
      report({ ...STATE, chapters: junk } as never)
      expect(link.chapters?.(), JSON.stringify(junk)).toBeUndefined()
    }
  })
})

// two frames down, a focus on the package's frame stops in the package's document, so the package hands the keys on,
// once its document holds the focus the page gave it
describe('a package\'s focus', () => {
  test('focuses the package\'s frame afresh, then asks the package to hand the keys on', () => {
    const order: string[] = []
    const frame = { blur: () => { order.push('blur') }, focus: () => { order.push('frame') } } as unknown as HTMLIFrameElement
    const focus = vi.fn(async () => { order.push('package') })
    pluginPlaybackLink({ ...fakeSource().source, focus }, frame)!.focus!()
    expect(order).toEqual(['blur', 'frame', 'package'])
  })

  // a plain function, since a vi.fn handles the promise it returns and a refusal through it is never unhandled
  test('is absent for a package without it, and does nothing once the link is disposed or refused', async () => {
    expect(pluginPlaybackLink(fakeSource().source)!.focus).toBeUndefined()
    let asked = 0
    const focus = async () => { asked++; throw new Error('gone') }
    const link = pluginPlaybackLink({ ...fakeSource().source, focus })!
    expect(() => link.focus!()).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    link.dispose()
    link.focus!()
    expect(asked).toBe(1)
  })
})

// Next episode takes the corner of the player's Skip Ending only on the player's own word, read off its reports
describe('a package\'s ending offer', () => {
  test('reads what the player reports, and asks only for a change from it', () => {
    const offerEnding = vi.fn(async () => {})
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink({ ...source, offerEnding })!
    expect(link.endingOffered!()).toBe(true)
    link.offerEnding!(true)
    expect(offerEnding).not.toHaveBeenCalled()
    link.offerEnding!(false)
    expect(offerEnding).toHaveBeenCalledExactlyOnceWith(false)

    report({ ...STATE, endingOffered: false } as typeof STATE)
    expect(link.endingOffered!()).toBe(false)
    link.offerEnding!(false)
    expect(offerEnding).toHaveBeenCalledTimes(1)
    link.offerEnding!(true)
    expect(offerEnding).toHaveBeenLastCalledWith(true)

    report()
    expect(link.endingOffered!(), 'a report that says nothing, from a player that cannot').toBe(true)
  })

  test('asks again while the player has not said, for a player that came up since', () => {
    const offerEnding = vi.fn(async () => {})
    const link = pluginPlaybackLink({ ...fakeSource().source, offerEnding })!
    link.offerEnding!(false)
    link.offerEnding!(false)
    expect(offerEnding).toHaveBeenCalledTimes(2)
  })

  test('is absent for a package without it, whatever its reports say, and does nothing once disposed or refused', async () => {
    const { source, report } = fakeSource()
    const without = pluginPlaybackLink(source)!
    report({ ...STATE, endingOffered: false } as typeof STATE)
    expect(without.offerEnding).toBeUndefined()
    expect(without.endingOffered).toBeUndefined()

    const asked: boolean[] = []
    const offerEnding = async (offered: boolean) => { asked.push(offered); throw new Error('gone') }
    const link = pluginPlaybackLink({ ...fakeSource().source, offerEnding })!
    expect(() => link.offerEnding!(false)).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    link.dispose()
    link.offerEnding!(false)
    expect(asked).toEqual([false])
  })
})

// the next episode's release, fetched ahead by the package's player
describe('a package\'s prepare', () => {
  test('hands the release to the package, is absent for a package without it, and does nothing once disposed or refused', async () => {
    expect(pluginPlaybackLink(fakeSource().source)!.prepare).toBeUndefined()
    const asked: object[] = []
    const prepare = async (release: object) => { asked.push(release); throw new Error('gone') }
    const link = pluginPlaybackLink({ ...fakeSource().source, prepare })!
    const release = { uri: 'nyaa:b', url: 'magnet:?xt=urn:btih:b' }
    expect(() => link.prepare!(release)).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    link.dispose()
    link.prepare!(release)
    expect(asked).toEqual([release])
  })
})

// HOR-1014: a torrent's player two frames down asks the watch page for fullscreen through the package, and the page
// fullscreens its stage, so the fullscreen outlasts the package's frame when the next episode's replaces it
describe('a package\'s fullscreen, kept on the stage', () => {
  const page = (enabled = true) => {
    const events = new EventTarget()
    const document = Object.assign(events, {
      fullscreenEnabled: enabled,
      fullscreenElement: null as Element | null,
      exitFullscreen: vi.fn(async () => {}),
    })
    const stage = { requestFullscreen: vi.fn(async () => {}) } as unknown as HTMLElement & { requestFullscreen: Mock }
    const change = (element: Element | null) => {
      document.fullscreenElement = element
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    return { host: { document } as unknown as Window, document, stage, change }
  }
  const fullscreenSource = () => {
    let ear: (() => void) | undefined
    const told: boolean[] = []
    return {
      source: {
        onFullscreenRequest: vi.fn(async (listener: () => void) => { ear = listener }),
        applyFullscreen: vi.fn(async (active: boolean) => { told.push(active) }),
      },
      request: () => ear?.(),
      told,
    }
  }

  test('a request fullscreens the stage, and leaves fullscreen once in it', () => {
    const { host, document, stage, change } = page()
    const { source, request } = fullscreenSource()
    servePluginFullscreen(source, stage, host)
    expect(source.onFullscreenRequest).toHaveBeenCalledTimes(1)
    request()
    expect(stage.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(document.exitFullscreen).not.toHaveBeenCalled()
    change(stage)
    request()
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(stage.requestFullscreen).toHaveBeenCalledTimes(1)
  })

  test('the package is told the page\'s state at once and on every change, until stopped', () => {
    const { host, document, stage, change } = page()
    const { source, request, told } = fullscreenSource()
    const stop = servePluginFullscreen(source, stage, host)
    expect(told).toEqual([false])
    change(stage)
    change(null)
    expect(told).toEqual([false, true, false])
    stop()
    request()
    expect(stage.requestFullscreen, 'no request acted on once stopped').not.toHaveBeenCalled()
    change(stage)
    request()
    expect(document.exitFullscreen).not.toHaveBeenCalled()
    expect(told, 'and nothing told').toEqual([false, true, false])
  })

  test('a page that cannot fullscreen, or a package without the pair, leaves the player its own', () => {
    const cannot = page(false)
    const { source } = fullscreenSource()
    servePluginFullscreen(source, cannot.stage, cannot.host)
    expect(source.onFullscreenRequest).not.toHaveBeenCalled()
    expect(source.applyFullscreen).not.toHaveBeenCalled()
    const { host, stage } = page()
    const onFullscreenRequest = vi.fn(async () => {})
    servePluginFullscreen({ onFullscreenRequest }, stage, host)
    servePluginFullscreen({ applyFullscreen: vi.fn(async () => {}) }, stage, host)
    expect(onFullscreenRequest).not.toHaveBeenCalled()
  })

  // plain functions, since a vi.fn handles the promise it returns and a refusal through it is never unhandled
  test('a refusal from the browser or the package does not take the page down', async () => {
    const { host, document, change } = page()
    let refused = 0
    const refuse = async () => { refused++; throw new TypeError('no activation') }
    const stage = { requestFullscreen: refuse } as unknown as HTMLElement
    Object.assign(document, { exitFullscreen: refuse })
    let request = () => {}
    const failing = {
      onFullscreenRequest: async (listener: () => void) => { request = listener },
      applyFullscreen: async () => { throw new Error('gone') },
    }
    expect(() => servePluginFullscreen(failing, stage, host)).not.toThrow()
    request()
    change(stage)
    request()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refused, 'a request and an exit, both refused').toBe(2)
    servePluginFullscreen({ onFullscreenRequest: async () => { throw new Error('gone') }, applyFullscreen: async () => {} }, stage, host)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
