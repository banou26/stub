// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { keepAudioLanguage, keepSubtitleLanguage } from '../../../src/utils/track-languages'

const play = vi.fn(async (_release: unknown) => true)
vi.mock('@fkn/lib', () => ({
  packages: { mount: vi.fn(async () => ({ remote: { sources: [{ origin: 'nyaa', play }] }, unmount: () => {} })) },
}))

const { PluginPlayer } = await import('../../../src/components/plugin-player')

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  play.mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  vi.stubGlobal('navigator', { languages: ['fr-FR', 'en'] })
})
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

test("the source's player is handed the release and the viewer's languages", async () => {
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  hosts.push(mount(<PluginPlayer pluginUri="https:nyaa.spec.test" release={{ uri: 'nyaa:1', url: 'magnet:?xt=urn:btih:1' }} onUnplayable={() => {}}/>))
  await settle()
  expect(play).toHaveBeenCalledWith({ uri: 'nyaa:1', url: 'magnet:?xt=urn:btih:1', languages: { language: 'fr-FR', audio: 'ja', subtitles: null } })
})
