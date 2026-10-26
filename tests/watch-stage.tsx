import type { Exchange } from 'urql'

import { render } from 'preact'
import { Client, Provider } from 'urql'
import { filter, fromValue, mergeMap, never, pipe } from 'wonka'
import { Route, Router } from 'wouter'

import Watch from '../src/router/watch'
import { getRouterRoutePath, Route as Routes } from '../src/router/path'
import { CHAPTERLESS_ON_CRUNCHYROLL, CHAPTERLESS_TORRENT, STAGE_MEDIA, TORRENT_MEDIA, TORRENT_ORIGIN, stageEpisode, torrentEpisode } from './watch-stage-media'

// The watch page tests/watch-stage.spec.ts drives: the real page over a GraphQL client that answers a show of two
// Crunchyroll episodes and a show of three torrents, all out, and nothing else; the second torrent's episode is on
// Crunchyroll too. The embed it frames for the first is ./watch-stage-player.tsx, the package it mounts for the second
// ./watch-stage-plugin.ts.

const show = (uri: string, count: number, episodeUri: (number: number) => string, handle: (number: number) => object[]) => ({
  uri,
  titles: [{ title: 'Spec Stage' }],
  type: 'ANIME',
  categories: [],
  episodeCount: count,
  status: 'FINISHED',
  settled: true,
  seasons: [],
  relations: [],
  handles: [],
  episodes: Array.from({ length: count }, (_, index) => index + 1).map(number => ({
    uri: episodeUri(number),
    episodeNumber: number,
    releaseDate: '2020-01-01T00:00:00.000Z',
    titles: [{ title: `Stage ${number}` }],
    thumbnails: [],
    handles: handle(number).map(node => ({ relation: 'SAME_AS', node })),
  })),
})
const shows: Record<string, object> = {
  [STAGE_MEDIA]: show(STAGE_MEDIA, 2, stageEpisode, number => [{ uri: `cr:GSTAGE${number}`, origin: 'cr', id: `GSTAGE${number}`, url: `https://www.crunchyroll.com/watch/GSTAGE${number}` }]),
  [TORRENT_MEDIA]: show(TORRENT_MEDIA, 3, torrentEpisode, number => [
    { uri: `${TORRENT_ORIGIN}:${number}`, origin: TORRENT_ORIGIN, id: String(number), url: `magnet:?xt=urn:btih:stage${number}` },
    ...number === CHAPTERLESS_TORRENT ? [{ uri: 'cr:GTORRENT2', origin: 'cr', id: 'GTORRENT2', url: CHAPTERLESS_ON_CRUNCHYROLL }] : [],
  ]),
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
    const media = name === 'GetWatchMedia' ? shows[operation.variables?.input?.uri] : undefined
    const data = media ? { media }
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
