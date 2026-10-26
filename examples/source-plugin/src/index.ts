import type { Media } from '../../../src/generated/schema/types.generated'
import type { StubPluginAPI } from '../../../src/plugin-api'

// import subpaths, never the '@fkn/lib' barrel: it pulls in the webvpn net/http surface, which needs node stream polyfills a plain vite config does not install
import * as packages from '@fkn/lib/packages'
import { info } from '@fkn/lib/account'
import { fetch } from '@fkn/lib/cloud/fetch'
// the promises subpath: '@fkn/lib/cloud/fs' is the node callback-style api
import { writeFile } from '@fkn/lib/cloud/fs/promises'

// publish this package with the keywords in package.json and it becomes discoverable in stub's Add sources picker

const media = (entry: { id: string, title: string, description: string, cover: string }): Media => ({
  _id: `example:${entry.id}`,
  uri: `example:${entry.id}`,
  origin: 'example',
  id: entry.id,
  categories: ['ANIME'],
  titles: [{ language: 'en', title: entry.title }],
  descriptions: [{ language: 'en', description: entry.description }],
  covers: [{ url: entry.cover }],
  handles: [],
} as unknown as Media)

const CATALOG = [
  media({
    id: '1',
    title: 'The Example Saga',
    description: 'A demonstration entry served by the stub example source plugin.',
    cover: 'https://placehold.co/460x650/1f2933/e5e7eb.png?text=The+Example+Saga',
  }),
  media({
    id: '2',
    title: 'Plugin Protocol II',
    description: 'The second demonstration entry, mostly here so search has something to find.',
    cover: 'https://placehold.co/460x650/1f2933/e5e7eb.png?text=Plugin+Protocol+II',
  }),
]

// the request goes through the PACKAGE's own `fetch`, so the bytes meter against the package rather than against the app embedding it
const pullCoverArt = async (): Promise<void> => {
  for (const entry of CATALOG) {
    const url = entry.covers?.[0]?.url
    if (!url) continue
    try {
      const response = await fetch(url)
      const bytes = (await response.arrayBuffer()).byteLength
      console.log(`Example Source: pulled ${bytes} bytes of cover art from ${url}`)
    } catch (error) {
      console.warn(`Example Source: could not pull ${url}`, error)
    }
  }
}

// cloud storage is keyed on the package, like its usage and its quota, so two apps hosting this source see one cache, not two
const cacheCatalog = async (): Promise<void> => {
  try {
    // encrypted storage is sealed until the account is unlocked, and a write while sealed is what asks the host app's page for that unlock: failing here is normal on a first run and costs only the cache
    await writeFile('catalog.json', JSON.stringify(CATALOG))
    console.log('Example Source: cached its catalog in its own cloud storage')
  } catch (error) {
    console.warn('Example Source: could not cache the catalog', error)
  }
}

packages.onConnect(() => ({
  origin: 'example',
  originUrl: 'https://github.com/banou26/stub',
  name: 'Example Source',
  isApiOnly: false,
  metadataOnly: true,
  // what playing this source's releases needs; a source whose site needs a sign in says 'account' or 'paid', and
  // serves `account: async () => 'signed-in'` (or 'signed-out', or 'no-plan') so Play knows whether the viewer has one
  access: 'none',
  resolvers: {
    Query: {},
    Mutation: {},
    Subscription: {
      media: {
        subscribe: async function* (_, { input }) {
          yield { media: CATALOG.find(entry => entry.uri === input?.uri) ?? null }
        },
      },
      mediaPage: {
        subscribe: async function* (_, { input }) {
          const search = input?.search?.toLowerCase()
          yield {
            mediaPage: {
              nodes:
                search
                  ? CATALOG.filter(entry => entry.titles?.some(title => title?.title.toLowerCase().includes(search)))
                  : CATALOG,
            },
          }
        },
      },
    },
  },
} satisfies StubPluginAPI), ({ name, version, from, protocol }) => {
  console.log(`${name}@${version}: connected by ${from} over ${protocol}`)
  info().then(account => console.log(`${name}: signed in as`, account?.name ?? 'nobody'))
  pullCoverArt().then(cacheCatalog).catch(() => {})
})
