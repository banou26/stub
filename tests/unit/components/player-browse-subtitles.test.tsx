// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

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

const tell = (payload: {
  tracks?: { id: string, language: string, label: string, format: 'srt' | 'vtt' | 'ass', content?: string }[]
  browse?: string | boolean
  select?: { id: string, seq: number }
}) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-subtitles', tracks: [], ...payload },
    source: window,
    origin: APP,
  }))
})

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

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

describe('VideoSurface browseSubtitles and host subtitle selection', () => {
  test('shows Subtitles menu with Look for more even at 0 tracks, supports custom titles, and activates external selection', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} />))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.media-button--mute')).toBeTruthy())
    expect(host.querySelector('button[aria-label="Subtitles"]')).toBeNull()

    tell({ tracks: [], browse: true })
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Subtitles"]')).toBeTruthy())

    act(() => { (host.querySelector('button[aria-label="Subtitles"]') as HTMLButtonElement).click() })
    await vi.waitFor(() => expect(host.querySelector('.browse-subtitles')).toBeTruthy())
    expect(host.querySelector('.subtitle-options-btn')).toBeNull()
    expect(host.querySelectorAll('.stub-menu__item')).toHaveLength(0)
    expect(host.querySelector('.browse-subtitles')?.textContent).toBe('Look for more')

    posted.length = 0
    act(() => { (host.querySelector('.browse-subtitles') as HTMLButtonElement).click() })
    expect(posted).toContainEqual({ type: 'stub:embed-subtitles-browse' })

    tell({ tracks: [], browse: '   ' })
    act(() => { (host.querySelector('button[aria-label="Subtitles"]') as HTMLButtonElement).click() })
    await vi.waitFor(() => expect(host.querySelector('.browse-subtitles')?.textContent).toBe('Look for more'))

    tell({ tracks: [], browse: 'Search catalog' })
    await vi.waitFor(() => expect(host.querySelector('.browse-subtitles')?.textContent).toBe('Search catalog'))

    tell({
      tracks: [
        { id: 'pl-1', language: 'en', label: 'English (Plugin)', format: 'srt', content: '1\n00:00:00,000 --> 00:00:10,000\nHello from plugin\n' },
      ],
      browse: true,
      select: { id: 'pl-1', seq: 1 },
    })
    await flush()
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cue-line')?.textContent).toBe('Hello from plugin'))
    expect(host.querySelector('.subtitle-options-btn')).toBeTruthy()
  })

  test('updates CC menu reactively when browseSubtitles transitions from undefined to defined with 0 tracks', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} />))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.media-button--mute')).toBeTruthy())

    expect(host.querySelector('button[aria-label="Subtitles"]')).toBeNull()
    tell({ tracks: [], browse: false })
    await flush()
    expect(host.querySelector('button[aria-label="Subtitles"]')).toBeNull()

    tell({ tracks: [], browse: true })
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Subtitles"]')).toBeTruthy())

    act(() => { (host.querySelector('button[aria-label="Subtitles"]') as HTMLButtonElement).click() })
    await vi.waitFor(() => expect(host.querySelector('.browse-subtitles')?.textContent).toBe('Look for more'))

    tell({ tracks: [], browse: false })
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Subtitles"]')).toBeNull())
  })
})
