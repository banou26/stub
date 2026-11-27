// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'CaptionsOff', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Layers', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Search', 'Settings', 'SkipBack', 'SkipForward', 'SlidersHorizontal', 'TriangleAlert', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame
const APP = 'https://anime.fkn.app'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const posted: unknown[] = []
const tell = (previous: string | boolean, next: string | boolean) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-episode', previous, next },
    source: window,
    origin: APP,
  }))
})

const hosts: HTMLElement[] = []
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  posted.length = 0
  Object.assign(window, { location: { origin: APP }, postMessage: (data: unknown) => { posted.push(data) } })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
  for (const name of ['location', 'postMessage']) Reflect.deleteProperty(window, name)
})

describe('the Netflix player episode step controls', () => {
  test('render right after Play/Pause inside the control bar, show titles in aria-label, omit missing ends, and request navigation on click', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame}/>))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.media-button--play')).toBeTruthy())
    expect(host.querySelector('.media-button--previous')).toBeNull()
    expect(host.querySelector('.media-button--next')).toBeNull()

    tell('E1 - Pilot', 'E3 - Finale')
    await vi.waitFor(() => expect(host.querySelector('.media-button--next')).toBeTruthy())

    const leftGroup = host.querySelector('.media-button-group')!
    const buttons = [...leftGroup.querySelectorAll('button')].map(el => el.className)
    const playIdx = buttons.findIndex(cls => cls.includes('media-button--play'))
    const prevIdx = buttons.findIndex(cls => cls.includes('media-button--previous'))
    const nextIdx = buttons.findIndex(cls => cls.includes('media-button--next'))
    expect(prevIdx).toBe(playIdx + 1)
    expect(nextIdx).toBe(prevIdx + 1)

    const prevBtn = host.querySelector<HTMLButtonElement>('.media-button--previous')!
    const nextBtn = host.querySelector<HTMLButtonElement>('.media-button--next')!
    expect(prevBtn.getAttribute('aria-label')).toBe('E1 - Pilot')
    expect(nextBtn.getAttribute('aria-label')).toBe('E3 - Finale')

    posted.length = 0
    prevBtn.click()
    nextBtn.click()
    expect(posted).toEqual([
      { type: 'stub:embed-episode-request', direction: 'previous' },
      { type: 'stub:embed-episode-request', direction: 'next' },
    ])

    tell(false, true)
    await vi.waitFor(() => expect(host.querySelector('.media-button--previous')).toBeNull())
    expect(host.querySelector<HTMLButtonElement>('.media-button--next')?.getAttribute('aria-label')).toBe('Next episode')
  })
})
