// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { resolveObjectURL } from 'node:buffer'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { parseBif } from '../../../../src/sources/crunchyroll/bif'
import { createBifThumbnails } from '../../../../src/sources/crunchyroll/seek-thumbnails'
import { buildBif, fixtureImage } from './bif-fixture'

// The real seek bar of @banou/media-player, drawing Crunchyroll's storyboard. Its two CommonJS
// dependencies cannot reach the react alias under node (see vitest.config.ts), and neither draws
// anything this test reads.
vi.mock('react-feather', () => Object.fromEntries(
  ['AlertTriangle', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../../src/sources/crunchyroll/cr-videojs-player')

const DURATION = 1_770

// the handle's listener methods are own closures, as on the real one (see timeline-seek.test.ts)
const makeRemote = () => {
  const target = new EventTarget()
  Object.defineProperties(target, {
    addEventListener: { configurable: true, value: target.addEventListener.bind(target) },
    removeEventListener: { configurable: true, value: target.removeEventListener.bind(target) },
    dispatchEvent: { configurable: true, value: target.dispatchEvent.bind(target) },
  })
  return Object.assign(target, {
    currentTime: 0, duration: DURATION, paused: true, volume: 1, readyState: 4, seeking: false,
    play: async () => {}, pause: () => {},
  }) as unknown as RemoteVideoElement
}

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame

// linkedom lays nothing out, so the bar is given one pixel per second of the episode
const hover = (host: HTMLElement, seconds: number) => {
  const bar = host.querySelector<HTMLElement>('.progress-bar')!
  bar.getBoundingClientRect = () => ({ left: 0, right: DURATION, width: DURATION, top: 0, bottom: 4, height: 4, x: 0, y: 0, toJSON: () => ({}) })
  const move = new Event('mousemove', { bubbles: true })
  Object.defineProperty(move, 'clientX', { value: seconds })
  act(() => { bar.dispatchEvent(move) })
}

// the bar measures against the duration, which the store reads off the media after it attaches
const ready = (host: HTMLElement) => vi.waitFor(() => expect(host.querySelector('.time')?.textContent).toContain('29:30'))

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

describe('the seek preview', () => {
  test('shows the storyboard image for the hovered time, over the time readout', async () => {
    const thumbnails = createBifThumbnails(parseBif(buildBif({ timestamps: [10_000, 20_000, 30_000] })))
    const host = mount(<CrunchyrollVideoJSPlayer remote={makeRemote()} frame={frame} thumbnails={thumbnails} />)
    hosts.push(host)
    await ready(host)

    hover(host, 25)
    const src = host.querySelector('.thumbnail img')?.getAttribute('src')
    expect(src).toMatch(/^blob:/)
    expect([...new Uint8Array(await resolveObjectURL(src!)!.arrayBuffer())]).toEqual(fixtureImage(1))
    expect(host.querySelector('.cursor-time')?.textContent).toBe('00:25')

    hover(host, 900)
    const later = host.querySelector('.thumbnail img')?.getAttribute('src')
    expect([...new Uint8Array(await resolveObjectURL(later!)!.arrayBuffer())]).toEqual(fixtureImage(2))
    thumbnails.dispose()
  })

  test('with no storyboard the preview is the time alone', async () => {
    const host = mount(<CrunchyrollVideoJSPlayer remote={makeRemote()} frame={frame} />)
    hosts.push(host)
    await ready(host)

    hover(host, 25)
    expect(host.querySelector('.thumbnail img')).toBeNull()
    expect(host.querySelector('.cursor-time')?.textContent).toBe('00:25')
  })
})
