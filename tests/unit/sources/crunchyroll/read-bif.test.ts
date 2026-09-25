import type { BifRead, BifReadOptions } from '../../../../src/sources/crunchyroll/read-bif'

import { parseHTML } from 'linkedom'
import { runInNewContext } from 'node:vm'
import { describe, expect, test, vi } from 'vite-plus/test'

import { parseBif } from '../../../../src/sources/crunchyroll/bif'
import { readCrunchyrollBif } from '../../../../src/sources/crunchyroll/read-bif'
import { buildBif } from './bif-fixture'

// frame.evaluate ships the function as SOURCE into Crunchyroll's realm, so it is run the same way
// here: its text, evaluated in a fresh vm context whose only globals are a synthetic page. Anything
// it captured from its module would be a ReferenceError in there, as it would be on the real page.

const NAMED_URL = 'https://www.crunchyroll.com/imgsrv/bifs/2026-09-26/bif.bif?Policy=abc&Signature=def'
const SEARCH_URL = 'https://static.crunchyroll.com/renamed/bifs/2026-09-26/bif.bif'
const DECOY_URL = 'https://static.crunchyroll.com/decoy/bifs/other/bif.bif'
const OPTIONS: BifReadOptions = { waitMs: 1_500, fetchMs: 1_000, maxBytes: 1024 * 1024 }
const PLAYER_HTML = '<div class="video-player-wrapper"><div class="video-player"><video></video></div></div>'

type Fiber = { memoizedProps: Record<string, unknown>, return?: Fiber }

// React's own shape: every host element carries its fiber under a per-root random suffix, and a
// context provider is a fiber with no element whose props carry `value`
const attachFibers = (document: Document, value: unknown) => {
  const root: Fiber = { memoizedProps: {} }
  const wrapper: Fiber = { memoizedProps: { className: 'video-player-wrapper' }, return: root }
  const provider: Fiber = { memoizedProps: { value, children: {} }, return: wrapper }
  const player: Fiber = { memoizedProps: { className: 'video-player' }, return: provider }
  const video: Fiber = { memoizedProps: {}, return: player }
  const key = '__reactFiber$q8x2k1'
  Object.assign(document.querySelector('.video-player-wrapper')!, { [key]: wrapper })
  Object.assign(document.querySelector('.video-player')!, { [key]: player })
  Object.assign(document.querySelector('video')!, { [key]: video })
}

const served = (body: ArrayBuffer, init?: ResponseInit) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, init))

const runInPage = ({ html = PLAYER_HTML, value, fetch, options = OPTIONS, later }: {
  html?: string
  value?: unknown
  fetch: ReturnType<typeof vi.fn>
  options?: BifReadOptions
  later?: (document: Document) => void
}) => {
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  if (value !== undefined) attachFibers(document, value)
  if (later) setTimeout(() => later(document), 700)
  const pageFunction = runInNewContext(`(${readCrunchyrollBif.toString()})`, {
    document, window, fetch, setTimeout, clearTimeout, AbortController,
  }) as typeof readCrunchyrollBif
  return pageFunction(options) as Promise<BifRead>
}

const bif = buildBif({ timestamps: [10_000, 20_000, 30_000] })

const player = (bifUrl: string) => {
  const self: Record<string, unknown> = {
    // reached one level before the named path's url, so a search that ran instead would land here
    decoy: { url: DECOY_URL },
    playerOrchestrator: { thumbnailOrchestrator: { _currentBifUrl: bifUrl } },
  }
  self.self = self
  return self
}

describe('readCrunchyrollBif, run in the page', () => {
  test('reads the url off the named path and brings the file back as bytes', async () => {
    const fetch = served(bif)
    const answer = await runInPage({ value: { volumeVM: { _player: player(NAMED_URL) } }, fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe(NAMED_URL)
    if (!('bytes' in answer)) throw new Error(`no bytes: ${JSON.stringify(answer)}`)
    expect(answer.via).toBe('named')
    expect(parseBif(answer.bytes)).toHaveLength(3)
  })

  // the minified names moved: the search finds the url among the context values instead
  test('finds a renamed url by searching the player\'s objects', async () => {
    const value = {
      title: 'An episode',
      assets: ['/assets/bif-icon.png', 'https://static.crunchyroll.com/manifest.mpd', 'no url here.bif'],
      v9: { _p: { cycle: undefined as unknown, o: { t: { _u: SEARCH_URL } } } },
    }
    value.v9._p.cycle = value
    const fetch = served(bif)
    const answer = await runInPage({ value, fetch })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([SEARCH_URL])
    expect(answer).toMatchObject({ via: 'search' })
  })

  test('searches the named player when only its thumbnail path moved', async () => {
    const renamed = { volumeVM: { _player: { po: { to: { u: SEARCH_URL } } } } }
    const fetch = served(bif)
    expect(await runInPage({ value: renamed, fetch })).toMatchObject({ via: 'search' })
    expect(fetch.mock.calls[0]![0]).toBe(SEARCH_URL)
  })

  test('waits for a player that mounts late', async () => {
    const fetch = served(bif)
    const answer = await runInPage({
      html: '<div class="video-player-wrapper"></div>',
      fetch,
      later: document => {
        document.querySelector('.video-player-wrapper')!.innerHTML = '<div class="video-player"><video></video></div>'
        attachFibers(document, { volumeVM: { _player: player(NAMED_URL) } })
      },
    })
    expect(answer).toMatchObject({ via: 'named' })
  })

  // an unfocused tab never mounts Crunchyroll's player: the read gives up by its deadline, by name
  test('answers no-player by the deadline when the page has no player, and fetches nothing', async () => {
    const fetch = served(bif)
    const started = Date.now()
    expect(await runInPage({ html: '<div class="video-player-wrapper"><div class="spacer"></div></div>', fetch })).toEqual({ none: 'no-player' })
    expect(Date.now() - started).toBeLessThan(OPTIONS.waitMs + 1_000)
    expect(fetch).not.toHaveBeenCalled()
  }, 5_000)

  test('answers no-bif when the player carries no .bif url', async () => {
    const fetch = served(bif)
    expect(await runInPage({ value: { volumeVM: { _player: { src: 'https://static.crunchyroll.com/manifest.mpd' } } }, fetch })).toEqual({ none: 'no-bif' })
    expect(fetch).not.toHaveBeenCalled()
  }, 5_000)

  test('a refused or failed fetch, or a file over the cap, is a named answer rather than a throw', async () => {
    const value = { volumeVM: { _player: player(NAMED_URL) } }
    expect(await runInPage({ value, fetch: served(bif, { status: 403 }) })).toEqual({ none: 'fetch-failed', detail: 'HTTP 403' })
    const refused = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await runInPage({ value, fetch: refused })).toMatchObject({ none: 'fetch-failed', detail: expect.stringContaining('Failed to fetch') })
    expect(await runInPage({ value, fetch: served(bif), options: { ...OPTIONS, maxBytes: 64 } })).toMatchObject({ none: 'too-large' })
  })
})
