import type { PluginStatus } from '../src/plugins'

import { loadDevice, loadEnabled, saveDevice } from '../src/plugin-list'

// What tests/settings.spec.ts builds the app with in place of src/plugins.ts. FKN never answers there,
// so a real install or connection would wait forever: here each address in SPEC_PLUGINS is installed at
// once and stays in the state written beside it, any other added address reads as connecting, and an
// install of an address not in the table is refused the way FKN refuses one.

/** An added source that plays its own releases, with no sign in or extension. */
export const FREE_RELEASES = 'npm:@spec/free-releases'

/** An added source like FREE_RELEASES whose releases need an account, and whose `account` answers what SPEC_ACCOUNT_KEY holds. */
export const ACCOUNT_RELEASES = 'npm:@spec/account-releases'
export const SPEC_ACCOUNT_KEY = 'spec.account'

export const SPEC_PLUGINS: Record<string, Omit<PluginStatus, 'uri'>> = {
  'npm:@spec/anime-source': { state: 'connected', sources: [{ origin: 'spec-anime', name: 'Spec Anime' }] },
  'npm:@spec/source-family': {
    state: 'connected',
    sources: [{ origin: 'spec-a', name: 'Spec Releases' }, { origin: 'spec-b', name: 'Spec Batches' }, { origin: 'spec-c', name: 'Spec Archive' }],
    rejected: [{ origin: 'spec-d', reason: 'declares no catalogue' }],
  },
  'npm:@spec/slow-source': { state: 'connecting' },
  'https:still.connecting.spec.test': { state: 'connecting' },
  'npm:@spec/broken-source': { state: 'error' },
  'https:dead.spec.test': { state: 'error' },
  'https:asourcewhosehostnamehasnowheretobreak.spec.test': { state: 'error' },
  // connected once the worker has registered them, below
  [FREE_RELEASES]: { state: 'connecting' },
  [ACCOUNT_RELEASES]: { state: 'connecting' },
}

const row = (origin: string, id: string, fields: object = {}) => ({
  _id: `${origin}:${id}`, uri: `${origin}:${id}`, origin, id,
  handles: [], categories: [], titles: [], descriptions: [], shortDescriptions: [], covers: [], banners: [], trailers: [], episodes: [], thumbnails: [],
  ...fields,
})

const release = (origin: string, id: string, score: number, media = '900070', episodeNumber = 1) =>
  row(origin, id, { mediaUri: `${origin}:${media}`, episodeNumber, url: `magnet:?xt=urn:btih:${id}`, score })

// Registered in the worker itself while added, as src/plugins.ts registers a package's connection, so it is
// asked like any source. It plays its own releases, as the stub plugin's Nyaa does, and answers Spec Prime
// Film (anilist:900070, tests/fake-fetch.ts) with three releases of its one episode, each ranked in its score
// as Nyaa ranks them, the first with the highest id, and Spec Rated (anilist:900040) with one release of each
// of its first three episodes.
const releasing = (origin: string, name: string, fields: object = {}) => ({
  origin,
  originUrl: `https://${origin}.test`,
  name,
  isApiOnly: false,
  metadataOnly: false,
  play: async () => true,
  ...fields,
  resolvers: {
    Query: {},
    Mutation: {},
    Subscription: {
      media: {
        subscribe: async function* (_: unknown, { input }: { input?: { uri?: string } }) {
          if (/\banilist:900040\b/.test(input?.uri ?? '')) {
            return yield {
              media: row(origin, '900040', {
                handles: [{ relation: 'SAME_AS', node: row('anilist', '900040') }],
                episodes: [1, 2, 3].map(number => release(origin, `900040-${number}`, 0.3, '900040', number)),
              }),
            }
          }
          if (!/\banilist:900070\b/.test(input?.uri ?? '')) return yield { media: null }
          yield {
            media: row(origin, '900070', {
              categories: ['MOVIE'],
              handles: [{ relation: 'SAME_AS', node: row('anilist', '900070') }],
              episodes: [release(origin, '900070-1', 0.3), release(origin, '900070-0b', 0.2999), release(origin, '900070-0a', 0.2998)],
            }),
          }
        },
      },
    },
  },
})

const REGISTERED: Record<string, object> = {
  [FREE_RELEASES]: releasing('spec-free', 'Spec Free'),
  [ACCOUNT_RELEASES]: releasing('spec-paid', 'Spec Paid', { access: 'account', account: async () => localStorage.getItem(SPEC_ACCOUNT_KEY) }),
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

for (const [uri, source] of Object.entries(REGISTERED)) {
  if (!loadEnabled().includes(uri)) continue
  void Promise.all([import('@fkn/lib/packages'), import('../src/worker')]).then(async ([{ attach }, { registerRemoteSource }]) => {
    const { port1, port2 } = new MessageChannel()
    void attach(port1, source)
    const result = await registerRemoteSource(port2, uri)
    if ('ok' in result) SPEC_PLUGINS[uri] = { state: 'connected', sources: result.ok.sources }
    notify()
  })
}
