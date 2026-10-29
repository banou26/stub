// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from '../../components/dom'

import type { DelegatedTracks } from '@banou/media-player'
import type { ComponentChildren } from 'preact'
import type { CrunchyrollTracks } from '../../../../src/sources/crunchyroll/cr-native-controls'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// Crunchyroll's quality choices, from the page's own menu through the real skin to @banou/media-player's settings menu

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))
vi.mock('../../../../src/sources/crunchyroll/seek-thumbnails', () => ({
  loadCrunchyrollThumbnails: () => new Promise(() => {}),
}))

const TRACKS: CrunchyrollTracks = {
  quality: {
    options: [{ id: 'Highest Available', label: 'Highest Available' }, { id: 'Moderate', label: 'Moderate' }, { id: 'Data Saver', label: 'Data Saver' }],
    selectedId: 'Highest Available',
  },
}
const controls = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', () => ({
  discoverCrunchyrollTracks: async () => TRACKS,
  selectCrunchyrollTrack: controls.select,
}))

const player = vi.hoisted(() => ({ quality: undefined as DelegatedTracks | undefined }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({ quality, children }: { quality?: DelegatedTracks, children?: ComponentChildren }) => {
    player.quality = quality
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const frame = {
  goto: async () => {},
  addStyleTag: async () => {},
  locator: (selector: string) => ({
    exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
    videoElement: async () => document.createElement('video'),
  }),
  evaluate: () => new Promise(() => {}),
}

const hosts: HTMLElement[] = []

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  lib.attachFrame.mockReset().mockResolvedValue(frame)
  controls.select.mockReset().mockResolvedValue(TRACKS)
  player.quality = undefined
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

test('the media player is handed Crunchyroll\'s qualities, and its pick switches Crunchyroll\'s', async () => {
  hosts.push(mount(withIntl(<CrunchyrollPlayer url="https://www.crunchyroll.com/watch/GAAAAAAAA/one" mediaUri="" episodeUri="" sourceUri="" />)))

  await vi.waitFor(() => expect(player.quality?.selection).toMatchObject(TRACKS.quality!), { timeout: 5_000 })
  await player.quality!.selection.select('Moderate')
  expect(controls.select.mock.calls.map(([, , kind, id]) => [kind, id])).toEqual([['quality', 'Moderate']])
})
