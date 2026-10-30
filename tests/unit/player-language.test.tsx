// FIRST: ./components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from './components/dom'

import type { MediaPlayerRemoteOptions } from '@banou/media-player'
import type { VNode } from 'preact'

import { afterAll, expect, test, vi } from 'vite-plus/test'

import { startLanguage } from '../../src/i18n'

// HOR-1026 (stub in the viewer's language): each player stub mounts shows its own labels in the page's language, and
// its numbers in the page's locale

const player = vi.hoisted(() => ({ props: undefined as Partial<MediaPlayerRemoteOptions> | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: (props: Partial<MediaPlayerRemoteOptions>) => { player.props = props; return null },
}))
vi.mock('@banou/media-player/remote', () => ({ exposePlayer: () => () => {} }))

const { default: CrunchyrollVideoJSPlayer } = await import('../../src/sources/crunchyroll/cr-videojs-player')
const { default: PrimeMediaPlayer } = await import('../../src/sources/amazon/prime-media-player')
const { default: ThemePlayer } = await import('../../src/router/title/theme-player')

afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

test.each<[string, () => VNode]>([
  ['Crunchyroll', () => <CrunchyrollVideoJSPlayer remote={null} frame={null}/>],
  ['Prime Video', () => <PrimeMediaPlayer remote={null} frame={null} video={{ video: 'video' }}/>],
  ['theme', () => <ThemePlayer url="https://themes.example/op.webm"/>],
])('the %s player is handed the page\'s language, as dates and numbers are written', async (_, element) => {
  const shownIn = async (language: string, languages: string[]) => {
    await startLanguage({ language, languages })
    player.props = {}
    unmount(mount(withIntl(element())))
    return player.props.language
  }
  expect(await shownIn('en', ['en-GB'])).toBe('en-GB')
  expect(await shownIn('fr', ['fr-CA', 'en-US'])).toBe('fr-CA')
  expect(await shownIn('de', ['en-US'])).toBe('de')
})
