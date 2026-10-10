import type { PluginStatus } from '../src/plugins'

import { loadEnabled, saveEnabled } from '../src/plugin-list'

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
  'npm:@spec/slow-source': { state: 'connecting' },
  'npm:@spec/broken-source': { state: 'error', error: "connecting to 'npm:@spec/broken-source' timed out" },
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

export const enablePlugin = async (uri: string): Promise<string | null> => {
  await new Promise(resolve => setTimeout(resolve, 500))
  if (!SPEC_PLUGINS[uri]) throw Object.assign(new Error(`'${uri}' is not an npm package or a local address FKN can install`), { code: 'invalid' })
  saveEnabled([...new Set([...loadEnabled(), uri])])
  notify()
  return uri
}

export const disablePlugin = async (uri: string): Promise<void> => {
  saveEnabled(loadEnabled().filter(enabled => enabled !== uri))
  notify()
}

export const addPlugins = async (): Promise<void> => {}
