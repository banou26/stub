// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from '../../components/dom'

import type { MediaPlayerRemoteOptions } from '@banou/media-player'
import type { Frame } from '@fkn/lib'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { startLanguage } from '../../../../src/i18n'

import { makeRemoteVideo } from '../../components/remote-video'

// A language the viewer picks in the Crunchyroll player's menus goes to the watch page, which keeps it for the next
// episode. The player reports the pick (@banou/media-player tests that); what is pinned here is that the skin tells
// the page what it reports.

const player = vi.hoisted(() => ({ props: undefined as Partial<MediaPlayerRemoteOptions> | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: (props: Partial<MediaPlayerRemoteOptions>) => { player.props = props; return null },
}))
const exposed = vi.hoisted(() => new Set<unknown>())
vi.mock('@banou/media-player/remote', () => ({
  exposePlayer: (media: unknown) => { exposed.add(media); return () => { exposed.delete(media) } },
}))
const told = vi.hoisted(() => [] as [string, string | null][])
vi.mock('../../../../src/embed-languages', () => ({
  tellTrackLanguage: (kind: string, language: string | null) => { told.push([kind, language]) },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../../src/sources/crunchyroll/cr-videojs-player')

let host: HTMLElement
beforeEach(() => {
  told.length = 0
  exposed.clear()
  host = mount(withIntl(<CrunchyrollVideoJSPlayer remote={null} frame={null} />))
})
afterEach(() => { unmount(host) })

test('tells the page the audio and subtitle languages the viewer picks, subtitles off included', () => {
  player.props!.onPreferredAudioLanguageChange!('Japanese')
  player.props!.onPreferredSubtitleLanguageChange!(null)
  player.props!.onPreferredSubtitleLanguageChange!('English')
  expect(told).toEqual([['audio', 'Japanese'], ['subtitles', null], ['subtitles', 'English']])
})

// held while the player switches to the languages kept, whose restore would undo the page's seek to where the viewer stopped
test('serves the watch page the player only once it may', () => {
  const { remote } = makeRemoteVideo()
  const frame = {} as Frame
  act(() => { render(withIntl(<CrunchyrollVideoJSPlayer remote={remote} frame={frame} expose={false} />), host) })
  expect(exposed.size).toBe(0)
  act(() => { render(withIntl(<CrunchyrollVideoJSPlayer remote={remote} frame={frame} expose />), host) })
  expect(exposed.size).toBe(1)
})

// HOR-1026 (stub in the viewer's language): the player's own labels follow the page's, its numbers the page's locale
test('hands the player the page\'s language, as dates and numbers are written', async () => {
  const shownIn = async (language: string, languages: string[]) => {
    await startLanguage({ language, languages })
    act(() => { render(withIntl(<CrunchyrollVideoJSPlayer remote={null} frame={null} />), host) })
    return player.props!.language
  }
  try {
    expect(await shownIn('en', ['en-GB'])).toBe('en-GB')
    expect(await shownIn('fr', ['fr-CA', 'en-US'])).toBe('fr-CA')
    expect(await shownIn('de', ['en-US'])).toBe('de')
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})
