// A media as the link the party's playback sync reads: reports on the events a person can cause and
// on a clock while playing, applies or follows a state by the rules in playback.ts, and answers a new ear
// at once. Driven with a fake media, the same shape @banou/media-player's remote player has.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { linkMedia } from '../../../src/party/bridge'
import { HEARTBEAT_MS, NUDGE_RATE } from '../../../src/party/playback'

const fakeMedia = () => {
  const target = new EventTarget()
  return Object.assign(target, {
    paused: true,
    ended: false,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(async () => { media.paused = false }),
    pause: vi.fn(() => { media.paused = true }),
  })
}
let media = fakeMedia()
afterEach(() => { vi.useRealTimers(); media = fakeMedia() })

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('linkMedia', () => {
  // the browser pauses a player at its end, and the party must not read that as anyone's pause
  test('says when the player has ended', () => {
    const link = linkMedia(media)
    expect(link.ended?.()).toBe(false)
    media.ended = true
    expect(link.ended?.()).toBe(true)
    link.dispose()
  })

  // what a follower tells the host: where its player is and what it holds, read off the mirror when asked
  test('says where the player is, how ready it is and what it holds', async () => {
    const ranges = [[0, 31.5], [598, 640]]
    const link = linkMedia(Object.assign(media, {
      currentTime: 600,
      readyState: 4,
      buffered: { length: 2, start: (index: number) => ranges[index]![0]!, end: (index: number) => ranges[index]![1]! },
    }))
    await expect(link.buffer?.()).resolves.toEqual({ time: 600, readyState: 4, ranges })
    link.dispose()
  })

  // the watch page counts an episode as watched on the share of it played (tracking/watched.ts)
  test('says how long the media is', () => {
    const link = linkMedia(Object.assign(media, { duration: 1440 }))
    expect(link.duration?.()).toBe(1440)
    link.dispose()
  })

  test('reports at the end, as ended', async () => {
    const link = linkMedia(media)
    const heard = vi.fn()
    link.onReport(heard)
    await flush()
    heard.mockClear()
    media.ended = true
    media.dispatchEvent(new Event('ended'))
    expect(heard).toHaveBeenCalledTimes(1)
    expect(link.ended?.()).toBe(true)
    link.dispose()
  })

  test('a new ear is told where the player is, then every event', async () => {
    const link = linkMedia(media)
    const heard = vi.fn()
    link.onReport(heard)
    await flush()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ paused: true, time: 0, rate: 1 }))
    media.currentTime = 30
    media.dispatchEvent(new Event('seeked'))
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ time: 30 }))
    link.dispose()
  })

  test('a heartbeat while playing, none while paused, none after dispose', async () => {
    vi.useFakeTimers()
    const link = linkMedia(media)
    const heard = vi.fn()
    link.onReport(heard)
    await vi.advanceTimersByTimeAsync(0)
    heard.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2)
    expect(heard).not.toHaveBeenCalled()
    media.paused = false
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2)
    expect(heard).toHaveBeenCalledTimes(2)
    link.dispose()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2)
    expect(heard).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('apply seeks only past the tolerance, and plays, pauses and sets the rate only when they differ', () => {
    const link = linkMedia(media)
    const now = Date.now()
    link.apply({ paused: false, time: 100, rate: 1, at: now })
    expect(media.play).toHaveBeenCalledTimes(1)
    expect(Math.abs(media.currentTime - 100)).toBeLessThan(0.5)

    media.paused = false
    media.currentTime = 100.3
    link.apply({ paused: false, time: 100, rate: 1, at: now })
    // inside the tolerance nothing moves: the host's own player answers an ask with this, and is never corrected after
    expect(media.currentTime, 'inside the tolerance').toBe(100.3)
    expect(media.playbackRate, 'at the asked speed').toBe(1)
    expect(media.play).toHaveBeenCalledTimes(1)

    link.apply({ paused: true, time: 100.3, rate: 1.5, at: now })
    expect(media.pause).toHaveBeenCalledTimes(1)
    expect(media.playbackRate).toBe(1.5)
    link.dispose()
  })

  // the catch-up is planned to end, and nothing has to be applied then for it to: a follower that stopped following
  // would otherwise be left fast for good
  test('follow catches up and goes back to the host\'s speed on time, with nothing applied meanwhile', async () => {
    vi.useFakeTimers()
    const link = linkMedia(Object.assign(media, { paused: false, currentTime: 100 }))
    // the host plays on from 100 s and is followed every two seconds, as heartbeats have it; the player stalls 2 s at 10 s
    let host = 100
    const play = async (seconds: number, follow: boolean) => {
      for (let step = 0; step < seconds * 2; step++) {
        if (follow && step % 4 === 0) link.follow!({ paused: false, time: host, rate: 1, at: Date.now() }, true)
        await vi.advanceTimersByTimeAsync(500)
        host += 0.5
        media.currentTime += 0.5 * media.playbackRate
      }
    }
    await play(10, true)
    media.currentTime -= 2
    await play(10, true)
    expect(media.playbackRate, 'catching up').toBe(NUDGE_RATE)
    await play(60, false)
    expect(media.playbackRate, 'back at the host\'s speed').toBe(1)
    expect(Math.abs(host - media.currentTime)).toBeLessThan(0.1)
    link.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('follow leaves an ended player alone unless the host is somewhere else', () => {
    vi.useFakeTimers()
    const link = linkMedia(Object.assign(media, { paused: true, ended: true, currentTime: 1440 }))
    const now = Date.now()
    link.follow!({ paused: false, time: 1440, rate: 1, at: now })
    expect(link.follow!({ paused: false, time: 1440.2, rate: 1, at: now })).toEqual({})
    expect(media.play).not.toHaveBeenCalled()
    expect(link.follow!({ paused: false, time: 600, rate: 1, at: now })).toEqual({ seek: 600, play: true })
    expect(media.currentTime).toBe(600)
    link.dispose()
  })

  test('dispose stops the ears and runs the close it was given', () => {
    const onClose = vi.fn()
    const link = linkMedia(media, onClose)
    const heard = vi.fn()
    link.onReport(heard)
    link.dispose()
    media.dispatchEvent(new Event('play'))
    expect(heard).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
