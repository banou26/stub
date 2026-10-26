import type { PluginStatus } from '../src/plugins'

import { loadDevice, loadEnabled, saveDevice } from '../src/plugin-list'

// What tests/settings.spec.ts builds the app with in place of src/plugins.ts. FKN never answers there,
// so a real install or connection would wait forever: here each address in SPEC_PLUGINS is installed at
// once and stays in the state written beside it, any other added address reads as connecting, and an
// install of an address not in the table is refused the way FKN refuses one.

export const SPEC_PLUGINS: Record<string, Omit<PluginStatus, 'uri'>> = {
  'npm:@spec/anime-source': { state: 'connected', sources: [{ origin: 'spec-anime', name: 'Spec Anime' }] },
  'npm:@spec/source-family': {
    state: 'connected',
    sources: [{ origin: 'spec-a', name: 'Spec Releases' }, { origin: 'spec-b', name: 'Spec Batches' }, { origin: 'spec-c', name: 'Spec Archive' }],
    rejected: [{ origin: 'spec-d', reason: 'declares no catalogue' }],
  },
  // the package tests/watch-stage.spec.ts mounts to play its torrents
  'npm:@spec/stage-player': { state: 'connected', sources: [{ origin: 'spec-torrent', name: 'Spec Torrents' }] },
  'npm:@spec/slow-source': { state: 'connecting' },
  'https:still.connecting.spec.test': { state: 'connecting' },
  'npm:@spec/broken-source': { state: 'error' },
  'https:dead.spec.test': { state: 'error' },
  'https:asourcewhosehostnamehasnowheretobreak.spec.test': { state: 'error' },
}

const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export const onPluginsChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const pluginStatuses = (): PluginStatus[] =>
  loadEnabled().map(uri => ({ uri, ...SPEC_PLUGINS[uri] ?? { state: 'connecting' as const } }))

export const enabledPluginUris = (): string[] => loadEnabled()

export const installPlugin = async (uri: string): Promise<string | null> => {
  await new Promise(resolve => setTimeout(resolve, 500))
  if (!SPEC_PLUGINS[uri]) throw Object.assign(new Error(`'${uri}' is not an npm package or a local address FKN can install`), { code: 'invalid' })
  saveDevice([...new Set([...loadDevice(), uri])])
  notify()
  return uri
}

// as src/plugins.ts does, it settles once the source connects: a failed one throws, one still connecting never settles
export const enablePlugin = async (uri: string): Promise<string | null> => {
  const installed = await installPlugin(uri)
  const { state } = SPEC_PLUGINS[uri]!
  // what FKN threw on 2026-10-16 for a source installed with its entry file blocked
  if (state === 'error') throw new Error(`packages.connect: '${uri}' failed to boot: Failed to load /index.js`)
  if (state === 'connecting') await new Promise(() => {})
  return installed
}

export const disablePlugin = async (uri: string): Promise<void> => {
  saveDevice(loadDevice().filter(enabled => enabled !== uri))
  notify()
}

export const addPlugins = async (): Promise<void> => {}
