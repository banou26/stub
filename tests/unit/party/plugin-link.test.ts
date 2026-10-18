// A source package's player as the same link the built-in embed produces, driven with a fake source.
import { describe, expect, test, vi } from 'vite-plus/test'

import { pluginPlaybackLink } from '../../../src/party/plugin-link'

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
