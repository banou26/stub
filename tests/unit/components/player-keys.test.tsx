// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

// linkedom has no KeyboardEvent, and videojs reads only these fields off one
const press = (target: Element, key: string, shiftKey = false) => {
  const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), {
    key, shiftKey, ctrlKey: false, altKey: false, metaKey: false, repeat: false,
  })
  target.dispatchEvent(event)
  return event
}

const hosts: HTMLElement[] = []
beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

describe("the Netflix player's keys", () => {
  test('leave "<" and ">" to the frame steps, and keep speed to its control', async () => {
    const { remote } = makeRemoteVideo()
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame}/>))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.media-button--playback-rate'), 'the store has the media').toBeTruthy())
    const container = host.querySelector('.media-default-skin')!

    for (const [key, shiftKey] of [['>', true], ['<', true], ['>', false], ['<', false]] as const) {
      const event = press(container, key, shiftKey)
      expect(event.defaultPrevented, `${shiftKey ? 'Shift ' : ''}${key} is not taken`).toBe(false)
      expect(remote.playbackRate, `${shiftKey ? 'Shift ' : ''}${key} leaves the speed`).toBe(1)
    }

    expect(press(container, 'm').defaultPrevented, 'the control: its other keys still act').toBe(true)
    expect(remote.muted).toBe(true)

    host.querySelector<HTMLButtonElement>('.media-button--playback-rate')!.click()
    expect(remote.playbackRate, 'the speed control still changes it').not.toBe(1)
  })
})
