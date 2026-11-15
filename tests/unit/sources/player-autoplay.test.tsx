// FIRST: ../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from '../components/dom'

import type { MediaPlayerRemoteOptions } from '@banou/media-player'
import type { PageVideo } from '../../../src/sources/frame-step-page'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// The player's autoplay switch in stub's own embeds shows the setting the page keeps, follows it as it changes, and
// tells the page a flip, which the page keeps: the embed writes nothing, since account sync runs in the page alone.

const player = vi.hoisted(() => ({ props: undefined as Partial<MediaPlayerRemoteOptions> | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: (props: Partial<MediaPlayerRemoteOptions>) => { player.props = props; return null },
}))
vi.mock('@banou/media-player/remote', () => ({ exposePlayer: () => () => {} }))
const told = vi.hoisted(() => [] as boolean[])
vi.mock('../../../src/embed-languages', () => ({
  tellTrackLanguage: () => {},
  tellAlwaysSubtitles: () => {},
  tellAutoplay: (on: boolean) => { told.push(on) },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')
const { default: PrimeMediaPlayer } = await import('../../../src/sources/amazon/prime-media-player')
const { AUTOPLAY_KEY, setAutoplay } = await import('../../../src/utils/autoplay')

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  told.length = 0
  player.props = undefined
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

test.each([
  ['Crunchyroll', () => <CrunchyrollVideoJSPlayer remote={null} frame={null} />],
  ['Prime Video', () => <PrimeMediaPlayer remote={null} frame={null} video={{} as PageVideo} />],
])('the %s player shows the setting, follows it, and tells the page a flip without keeping it', (_, element) => {
  stored.set(AUTOPLAY_KEY, 'off')
  const host = mount(withIntl(element()))
  try {
    expect(player.props!.autoplayNext).toBe(false)
    act(() => { setAutoplay(true) })
    expect(player.props!.autoplayNext).toBe(true)

    player.props!.onAutoplayNextChange!(false)
    expect(told).toEqual([false])
    expect(stored.has(AUTOPLAY_KEY), 'the page keeps it, not the embed').toBe(false)
  } finally {
    unmount(host)
  }
})
