// FIRST: ./components/dom installs the document the embed renders into.
import './components/dom'

import type { PlayerProps } from '../../src/sources/players'

import { expect, test, vi } from 'vite-plus/test'

// stub's own embed page, which reads what to play from its url and hands it to the source's player

const played = vi.hoisted(() => [] as PlayerProps[])
vi.mock('../../src/sources/players', () => ({
  getPlayer: () => (props: PlayerProps) => {
    played.push(props)
    return null
  },
}))
vi.mock('../../src/embed-title', () => ({ receiveEmbedTitle: () => () => {} }))

test('the player starts past the relays the watch page handed over', async () => {
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)
  const search = new URLSearchParams({ mediaUri: 'ag:(anilist:1)', episodeUri: 'ag:(anilist:1-1,cr:S-A-E1)', sourceUri: 'cr:S-A-E1', url: 'https://www.crunchyroll.com/watch/E1', triedRelays: 'r1,r2' })
  vi.stubGlobal('location', { search: `?${search}` })
  await import('../../src/embed')
  await vi.waitFor(() => expect(played.at(-1)?.triedRelays).toEqual(['r1', 'r2']))
  vi.unstubAllGlobals()
})
