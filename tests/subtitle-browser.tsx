import type { Exchange } from 'urql'

import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Client, Provider } from 'urql'
import { filter, fromValue, mergeMap, never, pipe } from 'wonka'
import { Route, Router } from 'wouter'

import { intl } from '../src/i18n'
import Settings from '../src/router/settings'
import Watch from '../src/router/watch'
import { getRouterRoutePath, Route as Routes } from '../src/router/path'
import { TORRENT_ORIGIN } from './watch-stage-media'

const MEDIA_URI = 'ag:(cr:GSUB900)'
const EP1_URI = 'ag:(cr:GSUB900-1)'

const media = {
  uri: MEDIA_URI,
  titles: [{ title: 'Spec Subtitle Show' }],
  type: 'ANIME',
  categories: [],
  episodeCount: 1,
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
      titles: [{ title: 'Episode 1' }],
      thumbnails: [],
      handles: [
        { relation: 'SAME_AS', node: { uri: 'cr:GSUB1', origin: 'cr', id: 'GSUB1', url: 'https://www.crunchyroll.com/watch/GSUB1', shortDescriptions: [{ shortDescription: 'Crunchyroll Official' }] } },
        { relation: 'SAME_AS', node: { uri: `${TORRENT_ORIGIN}:rel1`, origin: TORRENT_ORIGIN, id: 'rel1', url: 'magnet:?xt=urn:btih:gsub1', shortDescriptions: [{ shortDescription: 'Release 1' }] } },
      ],
    },
  ],
}

const origins = {
  originPage: {
    nodes: [
      { id: 'cr', url: 'https://www.crunchyroll.com', name: 'Crunchyroll', icon: null, color: null, isApiOnly: false },
      { id: TORRENT_ORIGIN, url: 'https://torrents.spec.test', name: 'Spec Torrents', icon: null, color: null, isApiOnly: false },
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
        <Route path={getRouterRoutePath(Routes.SETTINGS)} component={Settings} />
      </Router>
    </Provider>
  </RawIntlProvider>,
  document.getElementById('root')!,
)
