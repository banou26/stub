// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { seekTimeline } from '../../../../src/sources/crunchyroll/cr-page'
import { skipEventsToChapters } from '../../../../src/sources/crunchyroll/skip-events'
import { CREDITS_ONLY, OPENING_ONLY } from './skip-events-fixture'

// The real player of @banou/media-player, handed the chapters Crunchyroll's skip events map to. Its
// two CommonJS dependencies cannot reach the react alias under node (see vitest.config.ts), and
// neither draws anything this test reads.
vi.mock('react-feather', () => Object.fromEntries(
  ['AlertTriangle', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../../src/sources/crunchyroll/cr-videojs-player')

// the handle's listener methods are own closures, as on the real one (see timeline-seek.test.ts)
const makeRemote = (duration: number, currentTime: number) => {
  const target = new EventTarget()
  Object.defineProperties(target, {
    addEventListener: { configurable: true, value: target.addEventListener.bind(target) },
    removeEventListener: { configurable: true, value: target.removeEventListener.bind(target) },
    dispatchEvent: { configurable: true, value: target.dispatchEvent.bind(target) },
  })
  return Object.assign(target, {
    currentTime, duration, paused: true, volume: 1, readyState: 4, seeking: false,
    // the source fields are what lets the store seek it at all, as it seeks the real handle
    src: 'blob:episode', currentSrc: 'blob:episode',
    play: async () => {}, pause: () => {}, load: () => {},
  }) as unknown as RemoteVideoElement
}

const makeFrame = () => ({ evaluate: vi.fn(async () => {}) })

// linkedom lays nothing out, so the bar is given one pixel per second of the episode
const hover = (host: HTMLElement, duration: number, seconds: number) => {
  const bar = host.querySelector<HTMLElement>('.progress-bar')!
  bar.getBoundingClientRect = () => ({ left: 0, right: duration, width: duration, top: 0, bottom: 4, height: 4, x: 0, y: 0, toJSON: () => ({}) })
  const move = new Event('mousemove', { bubbles: true })
  Object.defineProperty(move, 'clientX', { value: seconds })
  act(() => { bar.dispatchEvent(move) })
}

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const show = (duration: number, currentTime: number, events: unknown) => {
  const remote = makeRemote(duration, currentTime)
  const frame = makeFrame()
  const host = mount(
    <CrunchyrollVideoJSPlayer
      remote={remote}
      frame={frame as unknown as Frame}
      chapters={skipEventsToChapters(events, duration)}
    />,
  )
  hosts.push(host)
  return { host, remote, frame }
}

const skipButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.skip-chapter')

describe('the skip events in the player', () => {
  test('the credits offer Skip Ending, which seeks Crunchyroll to where they end', async () => {
    const { host, remote, frame } = show(1_770, 1_690, CREDITS_ONLY)
    await vi.waitFor(() => expect(skipButton(host)?.textContent).toBe('Skip Ending'))
    expect(skipButton(host)!.parentElement!.classList.contains('show')).toBe(true)

    act(() => { skipButton(host)!.click() })
    await vi.waitFor(() => expect(frame.evaluate).toHaveBeenCalledWith(seekTimeline, expect.objectContaining({ time: 1_767 })))
    expect(remote.currentTime).toBe(1_767)
  })

  test('the seekbar is broken where the credits start, and names the chapter under the pointer', async () => {
    const { host } = show(1_770, 0, CREDITS_ONLY)
    await vi.waitFor(() => expect(host.querySelector('.time')?.textContent).toContain('29:30'))

    const masked = host.querySelector<HTMLElement>('.track')?.getAttribute('style') ?? ''
    // 1680 s of 1770 s; the credits end 3 s before the episode does, too close to the edge to draw
    expect(masked).toContain('94.9153%')
    hover(host, 1_770, 1_700)
    expect(host.querySelector('.chapter-title')?.textContent).toBe('Ending')
    hover(host, 1_770, 600)
    expect(host.querySelector('.chapter-title')?.textContent).toBe('Episode')
  })

  test('an opening after a short cold open, with nothing else marked, still offers Skip Opening', async () => {
    const { host } = show(1_440, 59.5, OPENING_ONLY)
    await vi.waitFor(() => expect(skipButton(host)?.textContent).toBe('Skip Opening'))
  })

  test('an episode with no events offers nothing and draws an unbroken bar', async () => {
    const { host } = show(1_770, 1_690, {})
    await vi.waitFor(() => expect(host.querySelector('.time')?.textContent).toContain('29:30'))
    expect(skipButton(host)).toBeNull()
    expect(host.querySelector('.track')?.getAttribute('style') ?? '').not.toContain('mask')
  })
})
