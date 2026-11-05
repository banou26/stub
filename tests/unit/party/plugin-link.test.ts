// A source package's player as the same link the built-in embed produces, driven with a fake source.
import type { Mock } from 'vite-plus/test'
import type { PlaybackCorrection } from '../../../src/party/playback'
import type { PlaybackState } from '../../../src/party/protocol'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { NUDGE_RATE } from '../../../src/party/playback'
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

  // A host seeking where its player has not loaded reports as it starts waiting, at the time it was sent to: told to
  // the party, a follower seeks there and plays on, then seeks back once the host's seek lands
  test('a report made while the player seeks is kept from the party, and the one as it lands goes on', () => {
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink(source)!
    const heard = vi.fn()
    link.onReport(heard)
    report({ ...STATE, time: 160, seeking: true, readyState: 1 } as typeof STATE)
    expect(heard).not.toHaveBeenCalled()
    report({ ...STATE, time: 160, seeking: false, readyState: 4 } as typeof STATE)
    expect(heard).toHaveBeenCalledWith({ ...STATE, time: 160 })
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

/**
 * A package's player as stub-plugin serves it, from 100 s: it reports every five seconds while it plays and on a new
 * speed, a stall or a seek landing, and does what `exact` says. `play` moves both players on in half seconds, the
 * host's from 100 s at 1x, following it every two seconds as heartbeats have it, a host report off by `misread` for
 * each; `stall` holds the player still, waiting for data, and `seekTakes` is how long a seek holds it.
 */
const packagePlayer = ({ seekTakes = 0 } = {}) => {
  let ear: ((state: PlaybackState & { ended?: boolean, seeking?: boolean, readyState?: number }) => void) | undefined
  const player = { paused: false, ended: false, time: 100, rate: 1, seeking: false, readyState: 4 }
  const told: (PlaybackState & { exact?: PlaybackCorrection })[] = []
  const toldAt: number[] = []
  const start = Date.now()
  let stands = 0
  let host = 100
  let step = 0
  const report = () => ear?.({ ...player, at: Date.now() })
  const link = pluginPlaybackLink({
    onPlayback: async listener => { ear = listener },
    applyPlayback: async state => {
      told.push(state)
      toldAt.push(Date.now())
      const { seek, rate } = state.exact ?? {}
      if (seek !== undefined) { player.time = seek; player.seeking = seekTakes > 0; stands = seekTakes }
      if (rate !== undefined) { player.rate = rate; report() }
    },
  })!
  report()
  const play = async (seconds: number, { follow = true, misread = [0] } = {}) => {
    const end = step + seconds * 2
    for (; step < end; step++) {
      if (follow && step % 4 === 0) link.follow!({ paused: false, time: host + misread[step / 4 % misread.length]!, rate: 1, at: Date.now() })
      if (step % 10 === 7) report()
      await vi.advanceTimersByTimeAsync(500)
      host += 0.5
      if (stands > 0) {
        stands -= 0.5
        if (stands <= 0) { player.seeking = false; player.readyState = 4; report() }
      } else player.time += 0.5 * player.rate
    }
  }
  const stall = (seconds: number) => { stands = seconds; player.readyState = 2; report() }
  // what the package was told to do, leaving out the applies that told it nothing
  const moves = () => told.map(state => state.exact).filter(exact => exact && Object.keys(exact).length)
  return {
    link, player, told, toldAt, moves, play, stall, report,
    hostSeek: (by: number) => { host += by },
    drift: () => host - player.time,
    // where the host's player is at `at`, a host that never seeked
    hostAt: (at: number) => 100 + (at - start) / 1000,
  }
}

describe('a package\'s player followed', () => {
  afterEach(() => { vi.useRealTimers() })

  test('is left alone through jitter, an outlier included, and told so beside the host\'s state', async () => {
    vi.useFakeTimers()
    const { told, moves, play, link } = packagePlayer()
    await play(120, { misread: [0.2, -0.15, 0.1, -0.2, 0.45, 0.2, -0.1, 0.15, -0.2, 0.05] })
    expect(moves()).toEqual([])
    // a package from before `exact` follows the host's state by its own rule, as it always did
    expect(told.at(-1)).toEqual({ paused: false, time: expect.any(Number), rate: 1, at: expect.any(Number), exact: {} })
    link.dispose()
  })

  // the catch-up is planned to end, and nothing has to be followed then for it to
  test('closes a 2 s stall with one gentle catch-up, then the host\'s speed on time, with nothing followed meanwhile', async () => {
    vi.useFakeTimers()
    const { moves, play, stall, drift, link } = packagePlayer()
    await play(10)
    stall(2)
    await play(20)
    expect(moves()).toEqual([{ rate: NUDGE_RATE }])
    await play(60, { follow: false })
    expect(moves()).toEqual([{ rate: NUDGE_RATE }, { rate: 1 }])
    expect(Math.abs(drift())).toBeLessThan(0.1)
    link.dispose()
  })

  // a package from before `exact` trusts a state's age up to 2 s, so a state as old as the catch-up would seek it back
  test('ends a catch-up beside where the host is by then, for a package that keeps its own rule', async () => {
    vi.useFakeTimers()
    const { told, toldAt, play, stall, hostAt, link } = packagePlayer()
    await play(10)
    stall(2)
    await play(20)
    await play(60, { follow: false })
    const end = told.at(-1)!
    const at = toldAt.at(-1)!
    expect(end.exact).toEqual({ rate: 1 })
    expect(end.time + Math.min(at - end.at, 2_000) / 1000 * end.rate).toBeCloseTo(hostAt(at))
    link.dispose()
  })

  test('tells nothing once the link is gone, a catch-up running then included', async () => {
    vi.useFakeTimers()
    const { told, moves, play, stall, link } = packagePlayer()
    await play(10)
    stall(2)
    await play(20)
    expect(moves()).toEqual([{ rate: NUDGE_RATE }])
    const before = told.length
    link.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(told).toHaveLength(before)
  })

  // read as playing on from the report that said it stalled, a follow inside the stall would see the player jump back
  test('reads a stall it was told of standing still, so the stall is caught up rather than seeked', async () => {
    vi.useFakeTimers()
    const { moves, play, stall, drift, link } = packagePlayer()
    await play(11)
    stall(2.5)
    await play(120)
    expect(moves().every(move => move?.seek === undefined && move?.rate !== undefined && move.rate >= 1)).toBe(true)
    expect(Math.abs(drift())).toBeLessThan(0.15)
    link.dispose()
  })

  test('a speed set while a catch-up runs is not undone when the catch-up ends', async () => {
    vi.useFakeTimers()
    const { moves, player, play, stall, report, link } = packagePlayer()
    await play(10)
    stall(2)
    await play(20)
    player.rate = 1.5
    report()
    await play(60, { follow: false })
    expect(moves()).toEqual([{ rate: NUDGE_RATE }])
    link.dispose()
  })

  test('follows the host\'s jump with one seek, never sent again before a report shows it', () => {
    vi.useFakeTimers()
    const { link, moves } = packagePlayer()
    expect(link.follow!({ paused: false, time: 130, rate: 1, at: Date.now() })).toEqual({ seek: 130 })
    // the package has not reported since, so its last report is still the old time
    expect(link.follow!({ paused: false, time: 130.1, rate: 1, at: Date.now() })).toEqual({})
    expect(moves()).toEqual([{ seek: 130 }])
    link.dispose()
  })

  // a seek sent again before the last one landed starts the wait over, and a slow network never gets to play
  test('whose seeks take 7 s to land is not seeked again meanwhile, and aims the next as far ahead as it landed behind', async () => {
    vi.useFakeTimers()
    const { moves, play, hostSeek, drift, link } = packagePlayer({ seekTakes: 7 })
    await play(10)
    hostSeek(10)
    await play(80)
    expect(moves()).toEqual([{ seek: 120 }, { seek: 135 }])
    expect(Math.abs(drift())).toBeLessThan(0.1)
    link.dispose()
  })

  test('an ended player is left alone unless the host is somewhere else', () => {
    vi.useFakeTimers()
    const { link, player, moves, report } = packagePlayer()
    Object.assign(player, { paused: true, ended: true, time: 1440 })
    report()
    const now = Date.now()
    link.follow!({ paused: false, time: 1440, rate: 1, at: now })
    expect(link.follow!({ paused: false, time: 1440.2, rate: 1, at: now })).toEqual({})
    expect(link.follow!({ paused: false, time: 600, rate: 1, at: now })).toEqual({ seek: 600, play: true })
    expect(moves()).toEqual([{ seek: 600, play: true }])
    link.dispose()
  })

  test('nothing is told before the player first reports', () => {
    const applyPlayback = vi.fn(async () => {})
    const link = pluginPlaybackLink({ onPlayback: async () => {}, applyPlayback })!
    expect(link.follow!({ paused: false, time: 100, rate: 1, at: Date.now() })).toEqual({})
    expect(applyPlayback).not.toHaveBeenCalled()
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

  test('a wish the last report matches still goes out over an ask on its way', () => {
    const offerEnding = vi.fn(async () => {})
    const { source, report } = fakeSource()
    const link = pluginPlaybackLink({ ...source, offerEnding })!
    link.offerEnding!(false)
    link.offerEnding!(true)
    expect(offerEnding.mock.calls).toEqual([[false], [true]])

    report({ ...STATE, endingOffered: false } as typeof STATE)
    link.offerEnding!(false)
    expect(offerEnding.mock.calls, 'the stale word, with the true on its way').toEqual([[false], [true], [false]])
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

  // STUB-358: asked together, the player two frames down could take the keys before Chrome 156 had given them to the
  // package's frame, which then kept them
  test('f on the page fullscreens the stage, the package\'s frame taking the keys before the request and its player once in', async () => {
    const { host, document, stage, change } = page()
    const { source } = fullscreenSource()
    const order: string[] = []
    const frame = { blur: () => {}, focus: () => { order.push('frame') } } as unknown as HTMLIFrameElement
    let enter = () => {}
    stage.requestFullscreen.mockImplementation(() => {
      order.push('request')
      return new Promise<void>(resolve => { enter = resolve })
    })
    const stop = servePluginFullscreen({ ...source, focus: async () => { order.push('player') } }, stage, host, frame)
    const f = () => document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'f' }))
    f()
    expect(order).toEqual(['frame', 'request'])
    enter()
    await vi.waitFor(() => expect(order).toEqual(['frame', 'request', 'player']))
    change(stage)
    f()
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(order, 'leaving moves no keys').toEqual(['frame', 'request', 'player'])
    stop()
    change(null)
    f()
    expect(stage.requestFullscreen, 'not once stopped').toHaveBeenCalledTimes(1)
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
