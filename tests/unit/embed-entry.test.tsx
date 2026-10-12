// FIRST: ./components/dom installs the document the embed renders into.
import './components/dom'

import type { PlayerProps } from '../../src/sources/players'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// stub's own embed page, which reads what to play from its url and hands it to the source's player

const played = vi.hoisted(() => [] as PlayerProps[])
vi.mock('../../src/sources/players', () => ({
  getPlayer: () => (props: PlayerProps) => {
    played.push(props)
    return null
  },
}))
vi.mock('../../src/embed-title', () => ({ receiveEmbedTitle: () => () => {} }))

const lib = vi.hoisted(() => ({ extension: false }))
vi.mock('@fkn/lib', () => ({ isExtensionExposed: () => lib.extension }))

const check = vi.hoisted(() => ({ calls: [] as unknown[][], answer: Promise.resolve(['r3']) }))
vi.mock('../../src/sources/crunchyroll/relay-check', () => ({
  unlistedRelays: (...args: unknown[]) => {
    check.calls.push(args)
    return check.answer
  },
}))

// the embed reads its url once, as its module loads
const open = async (params: Record<string, string>) => {
  vi.stubGlobal('location', { search: `?${new URLSearchParams(params)}` })
  vi.resetModules()
  await import('../../src/embed')
  await vi.waitFor(() => expect(played).not.toHaveLength(0))
  return played.at(-1)!
}

const CRUNCHYROLL = { mediaUri: 'ag:(anilist:1)', episodeUri: 'ag:(anilist:1-1,cr:S-A-E1)', sourceUri: 'cr:S-A-E1', url: 'https://www.crunchyroll.com/watch/E1', triedRelays: 'r1,r2' }

beforeEach(() => {
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }))
  played.length = 0
  check.calls = []
  lib.extension = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the player starts past the relays the watch page handed over', async () => {
  expect((await open(CRUNCHYROLL)).triedRelays).toEqual(['r1', 'r2'])
})

test('a Crunchyroll episode is checked past those relays as the page loads, and the player gets the answer', async () => {
  const props = await open(CRUNCHYROLL)

  expect(check.calls).toEqual([['https://www.crunchyroll.com/watch/E1', ['r1', 'r2']]])
  expect(props.unlistedRelays).toBe(check.answer)
})

test('with the extension nothing is checked, as its frame has no relay to choose', async () => {
  lib.extension = true
  const props = await open(CRUNCHYROLL)

  expect(check.calls).toEqual([])
  expect(props.unlistedRelays).toBeUndefined()
})

test('another source\'s episode is not checked', async () => {
  const props = await open({ mediaUri: 'ag:(tmdb:1)', episodeUri: 'ag:(tmdb:1-1,amazon:G)', sourceUri: 'amazon:G', url: 'https://watch.amazon.co.jp/watch?gti=amzn1.dv.gti.G' })

  expect(check.calls).toEqual([])
  expect(props.unlistedRelays).toBeUndefined()
})
