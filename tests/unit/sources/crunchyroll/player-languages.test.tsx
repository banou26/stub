// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { MediaPlayerRemoteOptions } from '@banou/media-player'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// A language the viewer picks in the Crunchyroll player's menus goes to the watch page, which keeps it for the next
// episode. The player reports the pick (@banou/media-player tests that); what is pinned here is that the skin tells
// the page what it reports.

const player = vi.hoisted(() => ({ props: undefined as Partial<MediaPlayerRemoteOptions> | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: (props: Partial<MediaPlayerRemoteOptions>) => { player.props = props; return null },
}))
const told = vi.hoisted(() => [] as [string, string | null][])
vi.mock('../../../../src/embed-languages', () => ({
  tellTrackLanguage: (kind: string, language: string | null) => { told.push([kind, language]) },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../../src/sources/crunchyroll/cr-videojs-player')

let host: HTMLElement
beforeEach(() => {
  told.length = 0
  host = mount(<CrunchyrollVideoJSPlayer remote={null} frame={null} />)
})
afterEach(() => { unmount(host) })

test('tells the page the audio and subtitle languages the viewer picks, subtitles off included', () => {
  player.props!.onPreferredAudioLanguageChange!('Japanese')
  player.props!.onPreferredSubtitleLanguageChange!(null)
  player.props!.onPreferredSubtitleLanguageChange!('English')
  expect(told).toEqual([['audio', 'Japanese'], ['subtitles', null], ['subtitles', 'English']])
})
