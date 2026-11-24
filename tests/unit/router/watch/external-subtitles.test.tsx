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
    act(() => { render(<Harness sourceUri="nyaa:a" />, host) })
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
})
