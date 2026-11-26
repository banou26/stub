import type { ExternalSubtitleTrack } from '@banou/media-player'
import type { ExternalSubtitleBundle } from '../../src/subtitles'

import { describe, expect, test, vi } from 'vite-plus/test'

import { serveEmbedExternalSubtitles, watchHostExternalSubtitles, watchHostSubtitleControls } from '../../src/embed-subtitles'

type Listener = (event: MessageEvent) => void

const makeWindowPair = (origin = 'https://stub.fkn.app') => {
  const hostListeners = new Set<Listener>()
  const embedListeners = new Set<Listener>()
  let hostWindow: Window
  let embedWindow: Window

  const dispatch = (listeners: Set<Listener>, source: Window, data: unknown, targetOrigin: string) => {
    if (targetOrigin !== origin) return
    const event = Object.assign(new Event('message'), { data, origin, source }) as MessageEvent
    for (const listener of [...listeners]) listener(event)
  }

  hostWindow = {
    location: { origin },
    addEventListener: (_type: string, fn: Listener) => hostListeners.add(fn),
    removeEventListener: (_type: string, fn: Listener) => hostListeners.delete(fn),
    postMessage: (data: unknown, targetOrigin: string) => dispatch(hostListeners, embedWindow, data, targetOrigin),
  } as unknown as Window

  embedWindow = {
    location: { origin },
    get parent() { return hostWindow },
    addEventListener: (_type: string, fn: Listener) => embedListeners.add(fn),
    removeEventListener: (_type: string, fn: Listener) => embedListeners.delete(fn),
    postMessage: (data: unknown, targetOrigin: string) => dispatch(embedListeners, hostWindow, data, targetOrigin),
  } as unknown as Window

  Object.defineProperty(hostWindow, 'parent', { get: () => hostWindow })
  const iframe = { contentWindow: embedWindow } as unknown as HTMLIFrameElement

  return { hostWindow, embedWindow, iframe }
}

describe('embed-subtitles postMessage bridge', () => {
  test('hands external track metadata to the embed and resolves/rejects lazy load calls', async () => {
    const { hostWindow, embedWindow, iframe } = makeWindowPair()
    const load = vi.fn(async (id: string) => {
      if (id === 'ok') return '1\n00:00:01,000 --> 00:00:02,000\nLine\n'
      throw new Error('Network error')
    })
    const bundle: ExternalSubtitleBundle = {
      tracks: [
        { id: 'ok', language: 'en', label: 'English', format: 'srt' },
        { id: 'bad', language: 'fr', label: 'French', format: 'vtt' },
      ],
      load,
    }

    const stopServe = serveEmbedExternalSubtitles(iframe, bundle, hostWindow)
    let latest: ExternalSubtitleTrack[] | undefined
    const seen: (string[] | undefined)[] = []
    const stopWatch = watchHostExternalSubtitles(tracks => {
      latest = tracks as typeof latest
      seen.push(tracks?.map(t => t.id))
    }, embedWindow)

    expect(seen.at(-1)).toEqual(['ok', 'bad'])
    await expect(latest![0]!.load!()).resolves.toContain('Line')
    await expect(latest![1]!.load!()).rejects.toThrow('Network error')
    expect(load).toHaveBeenCalledTimes(2)

    stopServe()
    const nextServe = serveEmbedExternalSubtitles(iframe, undefined, hostWindow)
    expect(seen.at(-1)).toBeUndefined()
    nextServe()
    stopWatch()
  })

  test('ignores messages from unexpected origins or windows', () => {
    const { hostWindow, embedWindow, iframe } = makeWindowPair()
    const load = vi.fn(async () => 'sub')
    const stopServe = serveEmbedExternalSubtitles(iframe, {
      tracks: [{ id: '1', language: 'en', label: 'EN', format: 'srt' }],
      load,
    }, hostWindow)
    const received = vi.fn()
    const stopWatch = watchHostExternalSubtitles(received, embedWindow)
    received.mockClear()

    // Foreign origin
    embedWindow.dispatchEvent?.(new MessageEvent('message', {
      data: { type: 'stub:embed-subtitles', tracks: [] },
      origin: 'https://evil.example',
      source: hostWindow,
    }))
    expect(received).not.toHaveBeenCalled()

    stopWatch()
    stopServe()
  })

  test('bridges browseSubtitles action and one-shot external track selection alongside tracks', () => {
    const { hostWindow, embedWindow, iframe } = makeWindowPair()
    const onBrowse = vi.fn()
    const load = vi.fn(async () => '1\n00:00:00,000 --> 00:00:02,000\nHi\n')
    const bundle: ExternalSubtitleBundle = {
      tracks: [{ id: 'pl-1', language: 'en', label: 'English', format: 'srt' }],
      load,
    }

    let latest: ReturnType<typeof Object> | undefined
    const stopWatch = watchHostSubtitleControls(controls => { latest = controls }, embedWindow)
    const stopServe = serveEmbedExternalSubtitles(iframe, bundle, {
      host: hostWindow,
      browse: 'Find subs',
      onBrowse,
      select: { id: 'pl-1', seq: 3 },
    })

    const state = latest as { tracks?: unknown[], browseSubtitles?: { title?: string, request: () => void }, selection?: { id: string, seq: number } }
    expect(state.tracks).toHaveLength(1)
    expect(state.browseSubtitles?.title).toBe('Find subs')
    expect(state.selection).toEqual({ id: 'pl-1', seq: 3 })

    state.browseSubtitles!.request()
    expect(onBrowse).toHaveBeenCalledTimes(1)

    stopServe()
    const stopDisabled = serveEmbedExternalSubtitles(iframe, undefined, { host: hostWindow, browse: false, onBrowse })
    const afterState = latest as { tracks?: unknown[], browseSubtitles?: unknown, selection?: unknown }
    expect(afterState.tracks).toBeUndefined()
    expect(afterState.browseSubtitles).toBeUndefined()
    expect(afterState.selection).toBeUndefined()

    stopDisabled()
    stopWatch()
  })

  test('delivers LOADED to the same iframe even after bundle update tears down the previous listener', async () => {
    const { hostWindow, embedWindow, iframe } = makeWindowPair()
    let finishLoad!: (text: string) => void
    const load = vi.fn(() => new Promise<string>(resolve => { finishLoad = resolve }))
    const bundle1: ExternalSubtitleBundle = {
      tracks: [{ id: 't1', language: 'en', label: 'English', format: 'srt' }],
      load,
    }
    const bundle2: ExternalSubtitleBundle = {
      tracks: [
        { id: 't1', language: 'en', label: 'English', format: 'srt' },
        { id: 't2', language: 'ja', label: 'Japanese', format: 'srt' },
      ],
      load,
    }

    const stop1 = serveEmbedExternalSubtitles(iframe, bundle1, hostWindow)
    let latest: ExternalSubtitleTrack[] | undefined
    const stopWatch = watchHostExternalSubtitles(tracks => { latest = tracks as typeof latest }, embedWindow)

    const loading = latest![0]!.load!()
    expect(load).toHaveBeenCalledTimes(1)

    // Bundle updates before `t1` finishes loading (e.g. plugin subtitles arrive).
    stop1()
    const stop2 = serveEmbedExternalSubtitles(iframe, bundle2, hostWindow)
    finishLoad('1\n00:00:00,000 --> 00:00:02,000\nArrived\n')

    await expect(loading).resolves.toContain('Arrived')
    stop2()
    stopWatch()
  })
})
