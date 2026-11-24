// FIRST: ./dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from './dom'

import type { BrowseSubtitles, ExternalSubtitleSelection, ExternalSubtitleTrack } from '@banou/media-player'
import type { ComponentChildren } from 'preact'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

const captured = vi.hoisted(() => ({
  externalSubtitles: undefined as ExternalSubtitleTrack[] | undefined,
  browseSubtitles: undefined as BrowseSubtitles | undefined,
  externalSubtitleSelection: undefined as ExternalSubtitleSelection | undefined,
}))

vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({
    externalSubtitles,
    browseSubtitles,
    externalSubtitleSelection,
    children,
  }: {
    externalSubtitles?: ExternalSubtitleTrack[]
    browseSubtitles?: BrowseSubtitles
    externalSubtitleSelection?: ExternalSubtitleSelection
    children?: ComponentChildren
  }) => {
    captured.externalSubtitles = externalSubtitles
    captured.browseSubtitles = browseSubtitles
    captured.externalSubtitleSelection = externalSubtitleSelection
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')
const { default: PrimeMediaPlayer } = await import('../../../src/sources/amazon/prime-media-player')

const APP = 'https://anime.fkn.app'
const posted: unknown[] = []
const tell = (payload: {
  tracks?: { id: string, language: string, label: string, format: 'srt' | 'ass' | 'vtt', content?: string }[]
  browse?: string | boolean
  select?: { id: string, seq: number }
}) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-subtitles', tracks: [], ...payload },
    source: window,
    origin: APP,
  }))
})

const hosts: HTMLElement[] = []
beforeEach(() => {
  captured.externalSubtitles = undefined
  captured.browseSubtitles = undefined
  captured.externalSubtitleSelection = undefined
  posted.length = 0
  Object.assign(window, { location: { origin: APP }, postMessage: (data: unknown) => { posted.push(data) } })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  for (const name of ['location', 'postMessage']) Reflect.deleteProperty(window, name)
})

describe.each([
  ['Crunchyroll', () => <CrunchyrollVideoJSPlayer remote={null} frame={null} />],
  ['Prime Video', () => <PrimeMediaPlayer remote={null} frame={null} video={{ video: 'video' }} />],
])('%s embed subtitle controls', (_, element) => {
  test('forwards externalSubtitles, browseSubtitles, and externalSubtitleSelection from useHostSubtitleControls', () => {
    hosts.push(mount(withIntl(element())))
    expect(captured.externalSubtitles).toBeUndefined()
    expect(captured.browseSubtitles).toBeUndefined()
    expect(captured.externalSubtitleSelection).toBeUndefined()

    tell({
      tracks: [{ id: 'pl:1', language: 'en', label: 'English (Plugin)', format: 'srt', content: 'hi' }],
      browse: 'Browse subtitles',
      select: { id: 'pl:1', seq: 3 },
    })

    expect(captured.externalSubtitles).toEqual([
      { id: 'pl:1', language: 'en', label: 'English (Plugin)', format: 'srt', content: 'hi' },
    ])
    expect(captured.externalSubtitleSelection).toEqual({ id: 'pl:1', seq: 3 })
    expect(captured.browseSubtitles?.title).toBe('Browse subtitles')
    captured.browseSubtitles!.request()
    expect(posted).toContainEqual({ type: 'stub:embed-subtitles-browse' })
  })
})
