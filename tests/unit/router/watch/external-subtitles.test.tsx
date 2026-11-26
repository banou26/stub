// FIRST: ../../components/dom installs the document @emotion/react / preact hooks environment
import { mount, unmount } from '../../components/dom'

import type { WatchExternalSubtitles } from '../../../../src/router/watch/external-subtitles'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  relayFetch: vi.fn<(input: string) => Promise<Response>>(),
  directFetch: vi.fn<(input: string) => Promise<Response>>(),
  findRemoteSubtitles: vi.fn(),
  loadRemoteSubtitle: vi.fn<(origin: string, trackId: string) => Promise<string>>(),
  statuses: [] as { uri: string, state: 'connecting' | 'connected' | 'error', sources?: { origin: string, name: string, hasSubtitles?: true, subtitlesOnly?: true, hasSubtitlePicker?: true }[] }[],
  listeners: new Set<() => void>(),
  disabled: [] as string[],
}))

vi.mock('../../../../src/utils/fetch', () => ({ fetch: mocks.relayFetch }))
vi.mock('../../../../src/worker/browser-fetch', () => ({ browserFetch: mocks.directFetch }))
vi.mock('../../../../src/worker/direct-fetch', () => ({
  withDirectFetch:
    (relay: (input: string) => Promise<Response>, direct: (input: string) => Promise<Response>) =>
    (input: string) =>
      String(input).startsWith('https://opensubtitles-v3.strem.io') ? direct(input) : relay(input),
}))
vi.mock('../../../../src/worker', () => ({
  findRemoteSubtitles: mocks.findRemoteSubtitles,
  loadRemoteSubtitle: mocks.loadRemoteSubtitle,
}))
vi.mock('../../../../src/plugins', () => ({
  pluginStatuses: () => mocks.statuses,
  onPluginsChange: (listener: () => void) => {
    mocks.listeners.add(listener)
    return () => { mocks.listeners.delete(listener) }
  },
}))
vi.mock('../../../../src/sources/disabled-sources', () => ({
  readDisabledSources: () => mocks.disabled,
  watchDisabledSources: () => () => {},
}))
vi.mock('../../../../src/viewer-languages', () => ({
  viewerLanguages: () => ({ language: 'en', audio: 'en', subtitles: 'en' }),
}))

const { useExternalSubtitles } = await import('../../../../src/router/watch/external-subtitles')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
})

beforeEach(() => {
  mocks.relayFetch.mockReset()
  mocks.directFetch.mockReset()
  mocks.findRemoteSubtitles.mockReset()
  mocks.loadRemoteSubtitle.mockReset()
  mocks.statuses = []
  mocks.disabled = []
  mocks.listeners.clear()

  mocks.relayFetch.mockImplementation(async () => new Response('', { status: 404 }))
  mocks.directFetch.mockImplementation(async () => Response.json({
    subtitles: [
      { id: 'os-1', url: 'https://subs5.strem.io/1.srt', lang: 'eng', subtitleFileName: 'Show.S01E01.Remux.EN.srt' },
      { id: 'os-2', url: 'https://subs5.strem.io/2.srt', lang: 'fra', subtitleFileName: 'Show.S01E01.WEB.FR.srt' },
    ],
  }))
  mocks.findRemoteSubtitles.mockResolvedValue([])
})

describe('useExternalSubtitles', () => {
  test('separates plugin fetches from built-ins, preserves picked subtitles across source switches, and caches search OpenSubtitles requests', async () => {
    let current!: WatchExternalSubtitles
    const Harness = ({ sourceUri }: { sourceUri: string }) => {
      current = useExternalSubtitles({
        enabled: true,
        mediaUri: 'ag:(imdb:tt1234567)',
        episodeUri: 'ag:(imdb:tt1234567-1)',
        media: { uri: 'ag:(imdb:tt1234567)', titles: [{ title: 'Show' }] },
        episode: { episodeNumber: 1, titles: [{ title: 'Ep 1' }] },
        selected: { uri: sourceUri, origin: sourceUri.split(':')[0]!, shortDescriptions: [{ shortDescription: 'Release One' }] },
        film: false,
        locale: 'en',
      })
      return null
    }

    const host = mount(<Harness sourceUri="cr:GX1" />)
    hosts.push(host)

    await vi.waitFor(() => expect(current.bundle?.tracks.map(t => t.id)).toEqual(['opensubtitles:en:os-1', 'opensubtitles:fr:os-2']))
    expect(mocks.directFetch).toHaveBeenCalledTimes(1)
    expect(mocks.findRemoteSubtitles).not.toHaveBeenCalled()

    // Viewer picks a custom subtitle; switching video source within the same episode keeps it and refetches nothing
    act(() => {
      current.pickSubtitle({
        id: 'picked:1',
        language: 'ja',
        label: 'Japanese (Picked)',
        format: 'srt',
        content: 'picked-content',
        source: 'plugin',
        sourceName: 'Picked',
      })
    })
    await vi.waitFor(() => expect(current.selectRequest?.id).toBe('picked:1'))

    const prevRelayCalls = mocks.relayFetch.mock.calls.length
    const { render } = await import('preact')
    act(() => { render(<Harness sourceUri="extsrc:a" />, host) })
    await act(async () => { await Promise.resolve() })
    expect(mocks.directFetch).toHaveBeenCalledTimes(1)
    expect(mocks.relayFetch).toHaveBeenCalledTimes(prevRelayCalls)
    expect(current.selectRequest?.id).toBe('picked:1')
    expect(current.bundle?.tracks.some(t => t.id === 'picked:1')).toBe(true)

    // Asynchronous connection of a searchable subtitlesOnly plugin queries plugins alone and merges tracks cleanly
    mocks.findRemoteSubtitles.mockResolvedValue([{
      id: 'plugin:subsonly:p1',
      language: 'en',
      label: 'English (SubsOnly)',
      format: 'srt',
      content: 'subsonly-content',
      source: 'plugin',
      sourceName: 'SubsOnly',
      pluginOrigin: 'subsonly',
      remoteTrackId: 'p1',
    }])
    act(() => {
      mocks.statuses = [{
        uri: 'npm:@spec/subsonly',
        state: 'connected',
        sources: [{ origin: 'subsonly', name: 'SubsOnly', subtitlesOnly: true, hasSubtitles: true }],
      }]
      for (const listener of mocks.listeners) listener()
    })

    await vi.waitFor(() => expect(current.bundle?.tracks.some(t => t.id === 'plugin:subsonly:p1')).toBe(true))
    expect(mocks.directFetch).toHaveBeenCalledTimes(1)
    expect(mocks.findRemoteSubtitles).toHaveBeenCalledTimes(1)
    expect(current.bundle?.tracks.some(t => t.id === 'opensubtitles:en:os-1')).toBe(true)

    // Repeated debounced queries in SubtitleBrowser reuse the cached OpenSubtitles fetch
    const firstSearch = await current.search('remux')
    const secondSearch = await current.search('web')
    expect(mocks.directFetch).toHaveBeenCalledTimes(2)
    expect(firstSearch.some(c => c.id === 'opensubtitles:en:os-1')).toBe(true)
    expect(firstSearch.some(c => c.id === 'opensubtitles:fr:os-2')).toBe(false)
    expect(secondSearch.some(c => c.id === 'opensubtitles:fr:os-2')).toBe(true)
    expect(secondSearch.some(c => c.id === 'opensubtitles:en:os-1')).toBe(false)
  })

  test('defers anime plugin auto-search until AniZip resolves imdbId so plugins are queried once, not twice', async () => {
    let finishAnizip!: (res: Response) => void
    mocks.relayFetch.mockImplementation(url => {
      if (url.startsWith('https://api.ani.zip/mappings?anilist_id=154587')) {
        return new Promise<Response>(resolve => { finishAnizip = resolve })
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })
    mocks.statuses = [{
      uri: 'npm:@spec/subsonly',
      state: 'connected',
      sources: [{ origin: 'subsonly', name: 'SubsOnly', subtitlesOnly: true, hasSubtitles: true }],
    }]

    let current!: WatchExternalSubtitles
    const AnimeHarness = () => {
      current = useExternalSubtitles({
        enabled: true,
        mediaUri: 'ag:(anilist:154587)',
        episodeUri: 'ag:(anilist:154587-1)',
        media: { uri: 'ag:(anilist:154587)', categories: ['ANIME'], titles: [{ title: 'Frieren' }] },
        episode: { episodeNumber: 1, titles: [{ title: 'Ep 1' }] },
        selected: { uri: 'cr:GX1', origin: 'cr', shortDescriptions: [{ shortDescription: 'Frieren.S01E01' }] },
        film: false,
        locale: 'en',
      })
      return null
    }
    const host = mount(<AnimeHarness />)
    hosts.push(host)

    await act(async () => { await Promise.resolve() })
    expect(mocks.findRemoteSubtitles).toHaveBeenCalledTimes(0)

    finishAnizip(Response.json({ mappings: { imdb_id: 'tt21209876' }, episodes: {} }))
    await vi.waitFor(() => expect(mocks.findRemoteSubtitles).toHaveBeenCalledTimes(1))
    expect(mocks.findRemoteSubtitles.mock.calls[0]![0]).toMatchObject({ imdbId: 'tt21209876' })
    expect(current.context.imdbId).toBe('tt21209876')
  })

  test('starts plugin auto-search once AniZip settles before slow OpenSubtitles/Xunlei finish, and keeps search IMDb across pickSubtitle on the same episode', async () => {
    let finishAnizip!: (res: Response) => void
    const searchAnizipResolvers: Array<(res: Response) => void> = []
    let finishOpenSubtitles!: (res: Response) => void
    let holdOpenSubtitles = true
    let holdSearch = false
    let builtIn222222Calls = 0
    let heldInitial154587 = false
    mocks.relayFetch.mockImplementation(url => {
      if (url.startsWith('https://api.ani.zip/mappings?anilist_id=154587')) {
        if (!heldInitial154587) {
          heldInitial154587 = true
          return new Promise<Response>(resolve => { finishAnizip = resolve })
        }
        return Promise.resolve(new Response('', { status: 404 }))
      }
      if (url.startsWith('https://api.ani.zip/mappings?anilist_id=222222')) {
        if (holdSearch) {
          return new Promise<Response>(resolve => { searchAnizipResolvers.push(resolve) })
        }
        builtIn222222Calls += 1
        return Promise.resolve(new Response('', { status: 404 }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })
    // Keep OpenSubtitles pending while verifying plugin search begins immediately when AniZip resolves.
    mocks.directFetch.mockImplementation(() => holdOpenSubtitles
      ? new Promise<Response>(resolve => { finishOpenSubtitles = resolve })
      : Promise.resolve(Response.json({ subtitles: [] })))
    mocks.statuses = [{
      uri: 'npm:@spec/subsonly',
      state: 'connected',
      sources: [{ origin: 'subsonly', name: 'SubsOnly', subtitlesOnly: true, hasSubtitles: true }],
    }]

    let current!: WatchExternalSubtitles
    const AnimeHarness = ({ mediaId, epUri }: { mediaId: string, epUri: string }) => {
      current = useExternalSubtitles({
        enabled: true,
        mediaUri: `ag:(anilist:${mediaId})`,
        episodeUri: epUri,
        media: { uri: `ag:(anilist:${mediaId})`, categories: ['ANIME'], titles: [{ title: 'Show' }] },
        episode: { episodeNumber: 1, titles: [{ title: 'Ep 1' }] },
        selected: { uri: 'cr:GX1', origin: 'cr', shortDescriptions: [{ shortDescription: 'Show.S01E01' }] },
        film: false,
        locale: 'en',
      })
      return null
    }
    const host = mount(<AnimeHarness mediaId="154587" epUri="ag:(anilist:154587-1)" />)
    hosts.push(host)

    await act(async () => { await Promise.resolve() })
    expect(mocks.findRemoteSubtitles).toHaveBeenCalledTimes(0)

    finishAnizip(Response.json({ mappings: { imdb_id: 'tt21209876' }, episodes: {} }))
    await vi.waitFor(() => expect(mocks.findRemoteSubtitles).toHaveBeenCalledTimes(1))
    expect(current.context.imdbId).toBe('tt21209876')
    holdOpenSubtitles = false
    finishOpenSubtitles?.(Response.json({ subtitles: [] }))

    // Switch to a second episode whose AniZip failed during built-in resolve, then trigger search() which resolves IMDb while pickSubtitle increments seqRef.
    const { render } = await import('preact')
    act(() => { render(<AnimeHarness mediaId="222222" epUri="ag:(anilist:222222-1)" />, host) })
    await vi.waitFor(() => expect(builtIn222222Calls).toBe(1))

    holdSearch = true
    let searching!: Promise<unknown>
    act(() => { searching = current.search('') })
    act(() => {
      current.pickSubtitle({
        id: 'picked:same-ep',
        language: 'en',
        label: 'Picked',
        format: 'srt',
        content: '1',
        source: 'plugin',
        sourceName: 'Picked',
      })
    })
    await vi.waitFor(() => expect(searchAnizipResolvers.length).toBeGreaterThan(0))
    searchAnizipResolvers.shift()!(Response.json({ mappings: { imdb_id: 'tt9998887' }, episodes: {} }))
    await vi.waitFor(() => expect(searchAnizipResolvers.length).toBeGreaterThan(0))
    holdSearch = false
    searchAnizipResolvers.shift()!(Response.json({ mappings: { imdb_id: 'tt9998887' }, episodes: {} }))
    await searching
    await vi.waitFor(() => expect(current.context.imdbId).toBe('tt9998887'))

    // Switching episodeUri while an earlier search() IMDb lookup is in flight must drop the stale resolution.
    let staleSearch!: Promise<unknown>
    act(() => { render(<AnimeHarness mediaId="222222" epUri="ag:(anilist:222222-2)" />, host) })
    await vi.waitFor(() => expect(builtIn222222Calls).toBe(2))
    holdSearch = true
    act(() => { staleSearch = current.search('again') })
    await vi.waitFor(() => expect(searchAnizipResolvers.length).toBeGreaterThan(0))
    searchAnizipResolvers.shift()!(Response.json({ mappings: { imdb_id: 'tt0000111' }, episodes: {} }))
    await vi.waitFor(() => expect(searchAnizipResolvers.length).toBeGreaterThan(0))
    holdSearch = false
    act(() => { render(<AnimeHarness mediaId="222222" epUri="ag:(anilist:222222-3)" />, host) })
    await vi.waitFor(() => expect(builtIn222222Calls).toBe(3))
    searchAnizipResolvers.shift()!(Response.json({ mappings: { imdb_id: 'tt0000111' }, episodes: {} }))
    await staleSearch
    expect(current.context.imdbId).toBeUndefined()
  })
})
