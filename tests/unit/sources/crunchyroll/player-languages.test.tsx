// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { MediaPlayerRemoteOptions } from '@banou/media-player'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY } from '../../../../src/utils/track-languages'

// A language the viewer picks in the Crunchyroll player's menus is kept for the next episode. The player reports the
// pick (@banou/media-player tests that); what is pinned here is that the skin keeps what it reports.

const player = vi.hoisted(() => ({ props: undefined as Partial<MediaPlayerRemoteOptions> | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: (props: Partial<MediaPlayerRemoteOptions>) => { player.props = props; return null },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../../src/sources/crunchyroll/cr-videojs-player')

const stored = new Map<string, string>()
let host: HTMLElement
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
  host = mount(<CrunchyrollVideoJSPlayer remote={null} frame={null} />)
})
afterEach(() => {
  unmount(host)
  vi.unstubAllGlobals()
})

test('keeps the audio and subtitle languages the viewer picks, subtitles off included', () => {
  player.props!.onPreferredAudioLanguageChange!('Japanese')
  player.props!.onPreferredSubtitleLanguageChange!(null)
  expect(stored.get(AUDIO_LANGUAGE_KEY)).toBe('Japanese')
  expect(stored.get(SUBTITLE_LANGUAGE_KEY)).toBe('off')
  player.props!.onPreferredSubtitleLanguageChange!('English')
  expect(stored.get(SUBTITLE_LANGUAGE_KEY)).toBe('English')
})
