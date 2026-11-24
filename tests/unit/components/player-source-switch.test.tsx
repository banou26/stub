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
const tell = (value: string | boolean) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-source-switch', value },
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

describe('the VideoSurface source switch button', () => {
  test('renders right after Volume and before Subtitles when enabled, and posts request on click', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} />))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.media-button--mute')).toBeTruthy())
    expect(host.querySelector('.media-button--source-switch')).toBeNull()

    tell(true)
    await vi.waitFor(() => expect(host.querySelector('.media-button--source-switch')).toBeTruthy())

    const rightGroup = host.querySelectorAll('.media-button-group')[1]!
    const buttons = [...rightGroup.querySelectorAll('button')].map(el => el.className)
    const muteIdx = buttons.findIndex(cls => cls.includes('media-button--mute'))
    const switchIdx = buttons.findIndex(cls => cls.includes('media-button--source-switch'))
    expect(switchIdx).toBe(muteIdx + 1)

    const switchBtn = host.querySelector<HTMLButtonElement>('.media-button--source-switch')!
    expect(switchBtn.getAttribute('aria-label')).toBe('Switch source')

    posted.length = 0
    switchBtn.click()
    expect(posted).toEqual([{ type: 'stub:embed-source-switch-request' }])

    tell('Change release')
    await vi.waitFor(() => expect(host.querySelector('.media-button--source-switch')?.getAttribute('aria-label')).toBe('Change release'))

    tell(false)
    await vi.waitFor(() => expect(host.querySelector('.media-button--source-switch')).toBeNull())
  })
})
