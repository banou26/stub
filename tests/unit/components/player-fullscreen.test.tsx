// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

// Stub's own Netflix skin hands its fullscreen to the watch page once the page says it keeps it
// (src/embed-fullscreen.ts). The skin and video.js are the real ones; the embed is a top-level page here, so the
// page's word is a message from the window itself. linkedom has no Fullscreen API, so the skin's own fullscreen is
// unsupported until the page speaks.

const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame
const APP = 'https://anime.fkn.app'
const REQUEST = { type: 'stub:embed-fullscreen-request' }

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

// linkedom has no KeyboardEvent, and videojs reads only these fields off one
const press = (target: Element, key: string) => target.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), {
  key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false,
}))

const posted: unknown[] = []
const tell = (active: boolean) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'stub:embed-fullscreen', active }, source: window, origin: APP }))
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

describe("the Netflix player's fullscreen", () => {
  test('is the page\'s once it says it keeps it: the button and f ask the page, and the button shows the page\'s state', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame}/>))
    hosts.push(host)
    const button = () => host.querySelector<HTMLButtonElement>('.media-button--fullscreen')!
    await vi.waitFor(() => expect(host.querySelector('.media-button--playback-rate'), 'the store has the media').toBeTruthy())
    const container = host.querySelector<HTMLElement>('.media-default-skin')!
    const own = vi.fn(async () => {})
    Object.assign(container, { requestFullscreen: own })
    expect(button(), 'its own fullscreen, which this document cannot do').toBeNull()

    tell(false)
    await vi.waitFor(() => expect(button()).toBeTruthy())
    expect(button().getAttribute('aria-label')).toBe('Enter fullscreen')
    button().click()
    expect(posted).toEqual([REQUEST])
    press(container, 'f')
    expect(posted).toEqual([REQUEST, REQUEST])
    expect(own, 'never fullscreens itself').not.toHaveBeenCalled()

    tell(true)
    await vi.waitFor(() => expect(button().getAttribute('aria-label')).toBe('Exit fullscreen'))
    expect(button().hasAttribute('data-fullscreen')).toBe(true)
    button().click()
    expect(posted).toEqual([REQUEST, REQUEST, REQUEST])
  })
})
