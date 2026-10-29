// FIRST: ../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from '../components/dom'

import type { HostFullscreen } from '@banou/media-player'
import type { ComponentChildren } from 'preact'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

// Stub's two embeds on @banou/media-player hand it the fullscreen the watch page keeps, once the page says it keeps
// it (src/embed-fullscreen.ts). The player records what it is handed; the embed is a top-level page here, so the
// page's word is a message from the window itself.

const player = vi.hoisted(() => ({ fullscreen: undefined as HostFullscreen | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({ fullscreen, children }: { fullscreen?: HostFullscreen, children?: ComponentChildren }) => {
    player.fullscreen = fullscreen
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')
const { default: PrimeMediaPlayer } = await import('../../../src/sources/amazon/prime-media-player')

const APP = 'https://anime.fkn.app'
const posted: unknown[] = []
const tell = (active: boolean) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'stub:embed-fullscreen', active }, source: window, origin: APP }))
})

const hosts: HTMLElement[] = []
beforeEach(() => {
  player.fullscreen = undefined
  posted.length = 0
  Object.assign(window, { location: { origin: APP }, postMessage: (data: unknown) => { posted.push(data) } })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  for (const name of ['location', 'postMessage']) Reflect.deleteProperty(window, name)
})

describe.each([
  ['Crunchyroll', () => <CrunchyrollVideoJSPlayer remote={null} frame={null}/>],
  ['Prime Video', () => <PrimeMediaPlayer remote={null} frame={null} video={{ video: 'video' }}/>],
])('the %s player', (_, element) => {
  test('keeps its own fullscreen until the page says it keeps it, then follows the page and asks it', async () => {
    hosts.push(mount(withIntl(element())))
    expect(player.fullscreen, 'its own').toBeUndefined()

    tell(false)
    expect(player.fullscreen?.active).toBe(false)
    player.fullscreen!.request()
    expect(posted).toEqual([{ type: 'stub:embed-fullscreen-request' }])

    tell(true)
    expect(player.fullscreen?.active).toBe(true)
  })
})
