import type { Exchange } from 'urql'

import { render } from 'preact'
import { Client, Provider } from 'urql'
import { filter, fromValue, mergeMap, never, pipe } from 'wonka'
import { Route, Router } from 'wouter'

import Watch from '../src/router/watch'
import { getRouterRoutePath, Route as Routes } from '../src/router/path'
import { STAGE_MEDIA, stageEpisode } from './watch-stage-media'

// The watch page tests/watch-stage.spec.ts drives: the real page over a GraphQL client that answers a show of two
// Crunchyroll episodes, both out, and nothing else. The embed it frames is ./watch-stage-player.tsx.

const media = {
  uri: STAGE_MEDIA,
  titles: [{ title: 'Spec Stage' }],
  type: 'ANIME',
  categories: [],
  episodeCount: 2,
  status: 'FINISHED',
  settled: true,
  seasons: [],
  relations: [],
  handles: [],
  episodes: [1, 2].map(number => ({
    uri: stageEpisode(number),
    episodeNumber: number,
    releaseDate: '2020-01-01T00:00:00.000Z',
    titles: [{ title: `Stage ${number}` }],
    thumbnails: [],
    handles: [{ relation: 'SAME_AS', node: { uri: `cr:GSTAGE${number}`, origin: 'cr', id: `GSTAGE${number}`, url: `https://www.crunchyroll.com/watch/GSTAGE${number}` } }],
  })),
}
const origins = { originPage: { nodes: [{ id: 'cr', url: 'https://www.crunchyroll.com', name: 'Crunchyroll', icon: null, color: null, isApiOnly: false }] } }

const answers: Exchange = () => operations => pipe(
  operations,
  filter(operation => operation.kind !== 'teardown'),
  mergeMap(operation => {
    const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
    const name = definition && 'name' in definition ? definition.name?.value : undefined
    const data = name === 'GetWatchMedia' && operation.variables?.input?.uri === STAGE_MEDIA ? { media }
      : name === 'GetWatchOrigins' ? origins
      : undefined
    return data ? fromValue({ operation, data, stale: false, hasNext: false }) : never
  }),
)

const client = new Client({ url: 'https://stage.test/graphql', exchanges: [answers] })

render(
  <Provider value={client}>
    <Router>
      <Route path={getRouterRoutePath(Routes.WATCH)} component={Watch}/>
    </Router>
  </Provider>,
  document.getElementById('root')!,
)
