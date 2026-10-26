// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

// what FKN threw on 2026-10-16 for a source installed with its entry file blocked
const BOOT = "packages.connect: 'https:dead.spec.test' failed to boot: Failed to load /index.js"

vi.mock('@fkn/lib', () => ({
  packages: {
    show: vi.fn(async () => { throw new Error(BOOT) }),
    hide: vi.fn(async () => {}),
    mount: vi.fn(async () => { throw new Error(BOOT) }),
  },
}))
vi.mock('../../../src/worker', () => ({ selectRemoteRelease: vi.fn(() => new Promise(() => {})) }))

const { SourcePopup } = await import('../../../src/components/source-popup')
const { PluginPlayer } = await import('../../../src/components/plugin-player')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })
vi.spyOn(console, 'warn').mockImplementation(() => {})
// the picker listens for Escape on the window, which node does not have
vi.stubGlobal('addEventListener', () => {})
vi.stubGlobal('removeEventListener', () => {})

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

test('a source whose picker fails to boot says so in one line, without FKN\'s message', async () => {
  const host = mount(<SourcePopup pluginUri="https:dead.spec.test" origin="nyaa" name="Nyaa" uris={['nyaa:1']} onPick={() => {}} onClose={() => {}}/>)
  hosts.push(host)
  await settle()
  expect(host.querySelector('.fallback')?.textContent).toBe('This source could not open its picker.')
  expect([host.querySelector('[role="dialog"]')?.getAttribute('aria-label'), host.querySelector('.close')?.textContent]).toEqual(['Choose a source from Nyaa', 'Close'])
})

test('a source whose player fails to boot says so in one line, without FKN\'s message', async () => {
  const host = mount(<PluginPlayer pluginUri="https:dead.spec.test" release={{ uri: 'nyaa:1' }} onUnplayable={() => {}}/>)
  hosts.push(host)
  await settle()
  expect(host.querySelector('.failed')?.textContent).toBe('This source could not start playback.')
})
