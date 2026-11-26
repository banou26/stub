import type { Exchange } from 'urql'

import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Client, Provider } from 'urql'
import { filter, fromValue, mergeMap, never, pipe } from 'wonka'
import { Route, Router } from 'wouter'

import { intl } from '../src/i18n'
import Watch from '../src/router/watch'
import { getRouterRoutePath, Route as Routes } from '../src/router/path'
import { TORRENT_ORIGIN } from './watch-stage-media'

const MEDIA_URI = 'ag:(anilist:900101)'
const EP1_URI = 'ag:(anilist:900101-1)'
const EP2_URI = 'ag:(anilist:900101-2)'

const media = {
  uri: MEDIA_URI,
  titles: [{ title: 'Spec Switcher' }],
  type: 'ANIME',
  categories: [],
  episodeCount: 2,
  status: 'FINISHED',
  settled: true,
  seasons: [],
  relations: [],
  handles: [],
  episodes: [
    {
      uri: EP1_URI,
      episodeNumber: 1,
      releaseDate: '2020-01-01T00:00:00.000Z',
      titles: [{ title: 'Multi Source' }],
      thumbnails: [],
      handles: [
        { relation: 'SAME_AS', node: { uri: 'cr:GSWITCH1', origin: 'cr', id: 'GSWITCH1', url: 'https://www.crunchyroll.com/watch/GSWITCH1', shortDescriptions: [{ shortDescription: 'Crunchyroll Official' }] } },
        { relation: 'SAME_AS', node: { uri: `${TORRENT_ORIGIN}:rel1`, origin: TORRENT_ORIGIN, id: 'rel1', url: 'magnet:?xt=urn:btih:rel1', shortDescriptions: [{ shortDescription: 'Release 1' }] } },
        { relation: 'SAME_AS', node: { uri: `${TORRENT_ORIGIN}:rel2`, origin: TORRENT_ORIGIN, id: 'rel2', url: 'magnet:?xt=urn:btih:stage1', shortDescriptions: [{ shortDescription: 'Release 2' }] } },
        ...Array.from({ length: 24 }, (_, idx) => {
          const n = idx + 1
          return {
            relation: 'SAME_AS',
            node: {
              uri: `spec-archive:item-${n}`,
              origin: 'spec-archive',
              id: `item-${n}`,
              url: `https://archive.spec.test/watch/item-${n}`,
              shortDescriptions: [{ shortDescription: `Archive Item ${n}` }],
            },
          }
        }),
      ],
    },
    {
      uri: EP2_URI,
      episodeNumber: 2,
      releaseDate: '2020-01-08T00:00:00.000Z',
      titles: [{ title: 'Single Source' }],
      thumbnails: [],
      handles: [
        { relation: 'SAME_AS', node: { uri: 'cr:GSWITCH2', origin: 'cr', id: 'GSWITCH2', url: 'https://www.crunchyroll.com/watch/GSWITCH2' } },
      ],
    },
  ],
}

const origins = {
  originPage: {
    nodes: [
      { id: 'cr', url: 'https://www.crunchyroll.com', name: 'Crunchyroll', icon: null, color: null, isApiOnly: false },
      { id: TORRENT_ORIGIN, url: 'https://torrents.spec.test', name: 'Spec Torrents', icon: null, color: null, isApiOnly: false },
      { id: 'spec-archive', url: 'https://archive.spec.test', name: 'Spec Archive', icon: null, color: null, isApiOnly: false },
    ],
  },
}

const answers: Exchange = () => operations => pipe(
  operations,
  filter(operation => operation.kind !== 'teardown'),
  mergeMap(operation => {
    const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
    const name = definition && 'name' in definition ? definition.name?.value : undefined
    const data = name === 'GetWatchMedia' && operation.variables?.input?.uri === MEDIA_URI ? { media }
      : name === 'GetWatchOrigins' ? origins
      : undefined
    return data ? fromValue({ operation, data, stale: false, hasNext: false }) : never
  }),
)

const client = new Client({ url: 'https://stage.test/graphql', exchanges: [answers] })

render(
  <RawIntlProvider value={intl}>
    <Provider value={client}>
      <Router>
        <Route path={getRouterRoutePath(Routes.WATCH)} component={Watch} />
      </Router>
    </Provider>
  </RawIntlProvider>,
  document.getElementById('root')!,
)
