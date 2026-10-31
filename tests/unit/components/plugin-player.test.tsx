// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import { PLUGIN_VALUES_KEY } from '../../../src/plugin-list'
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
    play: vi.fn(async ({ uri }: { uri: string }) => { played.push(uri); return uri !== 'nyaa:9' }),
    onPlayback: vi.fn(async () => {}),
    applyPlayback: vi.fn(async () => {}),
    onFullscreenRequest: vi.fn(async () => {}),
    applyFullscreen: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
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
  expect(source.play).toHaveBeenCalledWith({ uri: 'nyaa:1', url: 'magnet:?xt=urn:btih:1', languages: { language: 'fr-FR', audio: 'ja', subtitles: null } })
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
