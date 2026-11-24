// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import { PLUGIN_VALUES_KEY } from '../../../src/plugin-list'
import { setAutoplay } from '../../../src/utils/autoplay'
import { keepAudioLanguage, keepSubtitleLanguage } from '../../../src/utils/track-languages'

// FKN's mount of a package into the player's frame: each call is one document of the package, serving `source`
const fkn = vi.hoisted(() => ({ mounts: 0, unmounted: 0, fail: false, source: {} as object }))
vi.mock('@fkn/lib', () => ({
  packages: {
    mount: async () => {
      fkn.mounts++
      if (fkn.fail) throw new Error('no broker')
      return { remote: fkn.source, unmount: () => { fkn.unmounted++ } }
    },
  },
}))

const { PluginPlayer } = await import('../../../src/components/plugin-player')

const PACKAGE = 'https:stub.plugins.banou.dev'
const release = (n: number) => ({ uri: `nyaa:${n}`, url: `magnet:?xt=urn:btih:${n}` })
const playing = () => {
  const played: string[] = []
  const source = {
    play: vi.fn(async ({ uri }: { uri: string, languages?: object }) => { played.push(uri); return uri !== 'nyaa:9' }),
    onPlayback: vi.fn(async (_listener: (report: object) => void) => {}),
    applyPlayback: vi.fn(async () => {}),
    onFullscreenRequest: vi.fn(async () => {}),
    applyFullscreen: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    applyAutoplay: vi.fn(async (_on: boolean) => {}),
  }
  fkn.source = source
  return { played, source }
}
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const props = { onUnplayable: vi.fn(), onPlayback: vi.fn() }
const player = (n: number, extra: object = {}) => withIntl(<PluginPlayer pluginUri={PACKAGE} release={release(n)} {...props} {...extra}/>)
const hosts: HTMLElement[] = []
const shown = async (n: number, extra?: object) => {
  const host = mount(player(n, extra))
  hosts.push(host)
  await settle()
  return { host, next: async (m: number) => { act(() => { render(player(m, extra), host) }); await settle() } }
}

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  vi.stubGlobal('navigator', { languages: ['fr-FR', 'en'] })
})
afterEach(async () => {
  while (hosts.length) unmount(hosts.pop()!)
  // a package goes once its mount settles
  await settle()
  Object.assign(fkn, { mounts: 0, unmounted: 0, fail: false })
  props.onUnplayable.mockClear()
  props.onPlayback.mockClear()
  Reflect.deleteProperty(document, 'fullscreenEnabled')
  vi.unstubAllGlobals()
})

test("the source's player is handed the release and the viewer's languages", async () => {
  const { source } = playing()
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  await shown(1)
  expect(source.play).toHaveBeenCalledWith({ uri: 'nyaa:1', url: 'magnet:?xt=urn:btih:1', languages: { language: 'fr-FR', audio: 'ja', subtitles: null, alwaysSubtitles: false } })
})

test('a track the viewer picks in the source\'s player is what the next release starts in', async () => {
  const { source } = playing()
  let ear: ((report: object) => void) | undefined
  source.onPlayback.mockImplementation(async (listener: (report: object) => void) => { ear = listener })
  const { next } = await shown(1)
  const state = { paused: false, time: 42, rate: 1, at: 1 }
  ear!({ ...state, picked: { audio: 'jpn' } })
  ear!({ ...state, picked: { subtitles: 'Français' } })
  ear!({ ...state, picked: { alwaysSubtitles: true } })
  ear!({ ...state, picked: { audio: 7, subtitles: {} } })
  await next(2)
  expect(source.play).toHaveBeenLastCalledWith({ uri: 'nyaa:2', url: 'magnet:?xt=urn:btih:2', languages: { language: 'fr-FR', audio: 'ja', subtitles: 'fr', alwaysSubtitles: true } })
  ear!({ ...state, picked: { subtitles: null } })
  await next(3)
  expect(source.play.mock.lastCall![0].languages, 'subtitles turned off').toMatchObject({ subtitles: null })
  ear!({ ...state, picked: { subtitles: 'Signs & Songs' } })
  await next(4)
  expect(source.play.mock.lastCall![0].languages, 'a track picked by its title').toMatchObject({ titledSubtitles: true })
  expect(source.play.mock.lastCall![0].languages).not.toHaveProperty('subtitles')
})

test('the document that plays is not the one the worker connected to, so it takes the saved values before it plays', async () => {
  const told: string[] = []
  const configure = vi.fn(async () => { told.push('configure') })
  const source = { play: vi.fn(async () => { told.push('play'); return true }), configure }
  fkn.source = source
  stored.set(PLUGIN_VALUES_KEY, JSON.stringify({ [PACKAGE]: { apiKey: 'a-saved-value' }, 'npm:@spec/another': { apiKey: 'not-its-own' } }))
  await shown(1)
  expect(configure).toHaveBeenCalledExactlyOnceWith({ apiKey: 'a-saved-value' })
  expect(told).toEqual(['configure', 'play'])
})

test('a release the viewer left while the document took its values is not played', async () => {
  const takes: (() => void)[] = []
  const { played, source } = playing()
  fkn.source = { ...source, configure: () => new Promise<void>(resolve => { takes.push(resolve) }) }
  const { next } = await shown(1)
  await next(2)
  for (const take of takes) take()
  await settle()
  expect(played).toEqual(['nyaa:2'])
})

test('one document of the package plays each release of its source in turn, and goes with the player', async () => {
  const { played } = playing()
  const { next } = await shown(1)
  await next(2)
  expect(fkn.mounts, 'mounted once').toBe(1)
  expect(played).toEqual(['nyaa:1', 'nyaa:2'])
  expect(fkn.unmounted, 'kept between its releases').toBe(0)
  unmount(hosts.pop()!)
  await settle()
  expect(fkn.unmounted).toBe(1)
})

test('each release has a link of its own, and the last one\'s goes as the next plays', async () => {
  playing()
  const { next } = await shown(1)
  await next(2)
  const [first, gone, second] = props.onPlayback.mock.calls.map(([link]) => link)
  expect(first).toBeTypeOf('object')
  expect(gone).toBeUndefined()
  expect(second).toBeTypeOf('object')
  expect(second).not.toBe(first)
})

test('a mount that failed says so, and is tried again for the next release', async () => {
  const { played } = playing()
  fkn.fail = true
  const { host, next } = await shown(1)
  expect(host.querySelector('.failed')).not.toBeNull()
  fkn.fail = false
  await next(2)
  expect(fkn.mounts).toBe(2)
  expect(played).toEqual(['nyaa:2'])
  expect(host.querySelector('.failed')).toBeNull()
})

test('a release its source cannot play falls back, and the package stays for the next', async () => {
  const { played } = playing()
  const { next } = await shown(9)
  expect(props.onUnplayable).toHaveBeenCalledTimes(1)
  expect(fkn.unmounted).toBe(0)
  await next(2)
  expect(fkn.mounts).toBe(1)
  expect(played).toEqual(['nyaa:9', 'nyaa:2'])
})

test('its fullscreen is kept on the stage it is given, a release at a time, and left to the player without one', async () => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  const { source } = playing()
  await shown(1)
  expect(source.onFullscreenRequest).not.toHaveBeenCalled()
  unmount(hosts.pop()!)
  const { next } = await shown(2, { stage: { current: document.createElement('div') } })
  expect(source.onFullscreenRequest).toHaveBeenCalledTimes(1)
  expect(source.applyFullscreen).toHaveBeenCalledWith(false)
  await next(3)
  source.applyFullscreen.mockClear()
  document.dispatchEvent(new Event('fullscreenchange'))
  expect(source.applyFullscreen, 'told for the release playing only').toHaveBeenCalledTimes(1)
})

test('its player shows the autoplay setting, told on each change for the release playing only', async () => {
  const { source } = playing()
  const { next } = await shown(1)
  expect(source.applyAutoplay.mock.calls).toEqual([[true]])
  await next(2)
  source.applyAutoplay.mockClear()
  act(() => { setAutoplay(false) })
  expect(source.applyAutoplay.mock.calls).toEqual([[false]])
})

test('its link hands the keys to the package, after focusing the package\'s frame', async () => {
  const { source } = playing()
  const { host } = await shown(1)
  const frame = host.querySelector('iframe')!
  const order: string[] = []
  frame.focus = () => { order.push('frame') }
  source.focus.mockImplementation(async () => { order.push('package') })
  const link = props.onPlayback.mock.calls[0]![0] as { focus: () => void }
  link.focus()
  await settle()
  expect(order).toEqual(['frame', 'package'])
})

test('updates episodeNavigation and externalSubtitles without restarting playback, and forwards step clicks and subtitle loads', async () => {
  let stepListener: ((dir: 'previous' | 'next') => void) | undefined
  let subListener: ((trackId: string) => void) | undefined
  const onStep = vi.fn()
  const load = vi.fn(async (id: string) => `content:${id}`)

  const applyEpisodeNavigation = vi.fn(async () => {})
  const onEpisodeNavigation = vi.fn(async (fn: (dir: 'previous' | 'next') => void) => { stepListener = fn })
  const applyExternalSubtitles = vi.fn(async () => {})
  const onSubtitleLoadRequest = vi.fn(async (fn: (trackId: string) => void) => { subListener = fn })
  const provideExternalSubtitle = vi.fn(async () => {})

  const { played } = playing()
  Object.assign(fkn.source, {
    applyEpisodeNavigation,
    onEpisodeNavigation,
    applyExternalSubtitles,
    onSubtitleLoadRequest,
    provideExternalSubtitle,
  })

  const nav1 = { previous: 'E1', next: 'E3', onStep }
  const subs1 = { tracks: [{ id: 's1', language: 'en', label: 'English', format: 'srt' as const }], load }
  const host = mount(player(1, { episodeNavigation: nav1, externalSubtitles: subs1 }))
  hosts.push(host)
  await settle()

  expect(played).toEqual(['nyaa:1'])
  expect(applyEpisodeNavigation).toHaveBeenCalledWith({ previous: 'E1', next: 'E3' })
  expect(applyExternalSubtitles).toHaveBeenCalledWith(subs1.tracks)

  stepListener?.('next')
  expect(onStep).toHaveBeenCalledExactlyOnceWith('next')
  subListener?.('s1')
  await settle()
  expect(provideExternalSubtitle).toHaveBeenCalledWith('s1', 'content:s1')

  const nav2 = { previous: 'E1', onStep }
  const subs2 = { tracks: [{ id: 's2', language: 'fr', label: 'French', format: 'vtt' as const }], load }
  act(() => { render(player(1, { episodeNavigation: nav2, externalSubtitles: subs2 }), host) })
  await settle()

  // Updating navigation or external subtitles syncs without re-calling source.play()
  expect(played).toEqual(['nyaa:1'])
  expect(applyEpisodeNavigation).toHaveBeenLastCalledWith({ previous: 'E1', next: false })
  expect(applyExternalSubtitles).toHaveBeenLastCalledWith(subs2.tracks)
})

test('forwards browseSubtitles and triggers selectExternalSubtitle once per seq without restarting playback', async () => {
  let browseListener: (() => void) | undefined
  const onBrowse = vi.fn()
  const load = vi.fn(async (id: string) => `content:${id}`)

  const applyBrowseSubtitles = vi.fn(async () => {})
  const onBrowseSubtitles = vi.fn(async (fn: () => void) => { browseListener = fn })
  const applyExternalSubtitles = vi.fn(async () => {})
  const onSubtitleLoadRequest = vi.fn(async () => {})
  const provideExternalSubtitle = vi.fn(async () => {})
  const selectExternalSubtitle = vi.fn(async () => {})

  const { played } = playing()
  Object.assign(fkn.source, {
    applyBrowseSubtitles,
    onBrowseSubtitles,
    applyExternalSubtitles,
    onSubtitleLoadRequest,
    provideExternalSubtitle,
    selectExternalSubtitle,
  })

  const subs1 = { tracks: [{ id: 's1', language: 'en', label: 'English', format: 'srt' as const }], load }
  const host = mount(player(1, {
    browseSubtitles: { title: 'Browse', onRequest: onBrowse },
    externalSubtitles: subs1,
    externalSubtitleSelection: { id: 's1', seq: 1 },
  }))
  hosts.push(host)
  await settle()

  expect(played).toEqual(['nyaa:1'])
  expect(applyBrowseSubtitles).toHaveBeenCalledWith('Browse')
  expect(selectExternalSubtitle).toHaveBeenCalledTimes(1)
  expect(selectExternalSubtitle).toHaveBeenLastCalledWith('s1')

  browseListener?.()
  expect(onBrowse).toHaveBeenCalledTimes(1)

  // Re-rendering with unchanged seq does not re-select
  act(() => {
    render(player(1, {
      browseSubtitles: { title: 'Browse', onRequest: onBrowse },
      externalSubtitles: subs1,
      externalSubtitleSelection: { id: 's1', seq: 1 },
    }), host)
  })
  await settle()
  expect(selectExternalSubtitle).toHaveBeenCalledTimes(1)

  // Incrementing seq for a newly added track selects it after applying tracks
  const subs2 = {
    tracks: [
      ...subs1.tracks,
      { id: 's2', language: 'ja', label: 'Japanese', format: 'ass' as const },
    ],
    load,
  }
  act(() => {
    render(player(1, {
      browseSubtitles: { onRequest: onBrowse },
      externalSubtitles: subs2,
      externalSubtitleSelection: { id: 's2', seq: 2 },
    }), host)
  })
  await settle()
  expect(played).toEqual(['nyaa:1'])
  expect(applyBrowseSubtitles).toHaveBeenLastCalledWith(true)
  expect(selectExternalSubtitle).toHaveBeenCalledTimes(2)
  expect(selectExternalSubtitle).toHaveBeenLastCalledWith('s2')
})
