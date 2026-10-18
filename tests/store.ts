import { use, expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiShallowDeepEqual from 'chai-shallow-deep-equal'

use(chaiAsPromised)
use(chaiShallowDeepEqual)

export const test = async () => {
  const { upsertMedia, findAggregatedMedia, findAllAggregatedMedia } = await import('../src/worker/store/db')

  await upsertMedia(
    [
      { uri: 'anilist:1', origin: 'anilist', id: '1', url: null, score: 0.9, type: null, categories: [], status: null, titles: [{ language: 'en', title: 'Test Show' }], descriptions: [], shortDescriptions: [], trailers: [], covers: [], banners: [], averageScore: null, popularity: 1000, startDate: null, endDate: null, isAdult: null, episodeCount: null, nextAiringEpisode: null, airingSchedule: null, season: null, seasonYear: null, genres: [], tags: [], scope: 'RUN', relations: [], franchise: null },
      { uri: 'mal:1', origin: 'mal', id: '1', url: null, score: 0.5, type: null, categories: [], status: null, titles: [{ language: 'en', title: 'Test Show' }], descriptions: [], shortDescriptions: [], trailers: [], covers: [], banners: [], averageScore: null, popularity: null, startDate: null, endDate: null, isAdult: null, episodeCount: null, nextAiringEpisode: null, airingSchedule: null, season: null, seasonYear: null, genres: [], tags: [], scope: 'RUN', relations: [], franchise: null },
    ],
    [{ mediaUri: 'anilist:1', handleUri: 'mal:1' }]
  )

  const cluster = await findAggregatedMedia('anilist:1')
  expect(cluster.length).to.equal(2)

  const allMedia = await findAllAggregatedMedia()
  expect(allMedia.length).to.equal(1)

  await upsertMedia(
    [{ uri: 'anilist:1', origin: 'anilist', id: '1', url: null, score: 0.9, type: null, categories: [], status: null, titles: [], descriptions: [], shortDescriptions: [], trailers: [], covers: [], banners: [], averageScore: null, popularity: 1000, startDate: null, endDate: null, isAdult: null, episodeCount: null, nextAiringEpisode: null, airingSchedule: null, season: null, seasonYear: null, genres: [], tags: [], scope: 'RUN', relations: [], franchise: null }],
    []
  )

  const updatedCluster = await findAggregatedMedia('anilist:1')
  const anilist = updatedCluster.find(m => m.uri === 'anilist:1')!
  expect(anilist.titles.length).to.equal(1)
  expect(anilist.titles[0]!.title).to.equal('Test Show')

  await upsertMedia(
    [{ uri: 'anilist:1', origin: 'anilist', id: '1', url: null, score: 0.9, type: null, categories: [], status: null, titles: [], descriptions: [], shortDescriptions: [], trailers: [], covers: [], banners: [], averageScore: null, popularity: 2000, startDate: null, endDate: null, isAdult: null, episodeCount: null, nextAiringEpisode: null, airingSchedule: null, season: null, seasonYear: null, genres: [], tags: [], scope: 'RUN', relations: [], franchise: null }],
    []
  )
  const updated2 = await findAggregatedMedia('anilist:1')
  const anilist2 = updated2.find(m => m.uri === 'anilist:1')!
  expect(anilist2.popularity).to.equal(2000)
  expect(anilist2.titles.length).to.equal(1)
}

export const fuzzyMerge = async () => {
  const { upsertMedia, findAllAggregatedMedia } = await import('../src/worker/store/db')
  const { fuzzyMergeMediaClusters } = await import('../src/worker/store/fuzzy-merge')

  const media = (uri: string, title: string, fields: Record<string, any> = {}) => {
    const [origin, id] = uri.split(':')
    return {
      uri, origin: origin!, id: id!, url: null, score: 0.5, type: null,
      categories: ['SERIES'], status: null,
      titles: [{ language: 'en', title }],
      descriptions: [], shortDescriptions: [], trailers: [], covers: [], banners: [], averageScore: null, popularity: null,
      startDate: null, endDate: null, isAdult: null, episodeCount: null,
      ...fields,
    } as any
  }

  await upsertMedia(
    [
      media('anilist:100', "Frieren: Beyond Journey's End", { startDate: '2023-09-29', categories: ['ANIME', 'SERIES'] }),
      media('tmdb:200', 'Frieren Beyond Journeys End', { startDate: '2023-01-01' }),
      media('tvmaze:300', "Frieren: Beyond Journey's End", { startDate: '2016-01-01' }),
      media('omdb:400', 'Solo Leveling', { startDate: '2023-01-01' }),
      media('jw:500', "Frieren: Beyond Journey's End", { startDate: '2023-01-01', categories: ['MOVIE'] }),
      media('kitsu:600', "Frieren: Beyond Journey's End"),
      media('nf:700', "Frieren: Beyond the Journey's End", { startDate: '2023-01-01' }),
      media('anilist:800', 'Heart of Gold', { startDate: '2016-01-01', categories: ['ANIME', 'SERIES'], type: 'SPECIAL' }),
      media('nf:900', 'Heart of Gold', { startDate: '2016-01-01', categories: ['MOVIE'] }),
    ],
    []
  )

  let clusters = await findAllAggregatedMedia()
  expect(clusters.length).to.equal(9)

  expect(await fuzzyMergeMediaClusters(clusters)).to.equal(true)

  clusters = await findAllAggregatedMedia()
  expect(clusters.length).to.equal(6)
  const merged = clusters.find(cluster => cluster.length === 3)!
  expect(merged.map(m => m.uri).sort()).to.deep.equal(['anilist:100', 'nf:700', 'tmdb:200'])
  const special = clusters.find(cluster => cluster.some(m => m.uri === 'anilist:800'))!
  expect(special.map(m => m.uri).sort()).to.deep.equal(['anilist:800', 'nf:900'])

  expect(await fuzzyMergeMediaClusters(clusters)).to.equal(false)
}

export const graphLabels = async () => {
  const { createGraph } = await import('../src/worker/store/graph')

  const g = createGraph<{ name: string; tags: string[] }>()

  const mergeFn = (incoming: any, existing: any) => ({ ...existing, ...incoming })
  g.registerLabel('person', { merge: mergeFn })

  g.registerLabel('person', { merge: mergeFn })

  g.registerLabel('tag')

  const merge = (incoming: any, existing: any) => {
    const result = { ...existing }
    for (const key in incoming) {
      const val = incoming[key]
      if (Array.isArray(val)) {
        const ex = existing[key]
        result[key] = (Array.isArray(ex) && ex.length > val.length) ? ex : val
      } else {
        result[key] = val ?? existing[key]
      }
    }
    return result
  }

  const g2 = createGraph<{ name: string; tags: string[] }>()
  g2.registerLabel('item', { merge })

  g2.set('a', { name: 'Alice', tags: ['x', 'y'] }, { addLabels: ['item'] })
  expect(g2.get('a')).to.deep.equal({ name: 'Alice', tags: ['x', 'y'] })

  g2.set('a', { name: 'Bob', tags: ['z'] }, { addLabels: ['item'] })
  expect(g2.get('a')!.name).to.equal('Bob')
  expect(g2.get('a')!.tags).to.deep.equal(['x', 'y'])

  g2.set('a', { name: 'Carol', tags: ['a', 'b', 'c'] })
  expect(g2.get('a')!.name).to.equal('Carol')
  expect(g2.get('a')!.tags).to.deep.equal(['a', 'b', 'c'])

  const g3 = createGraph<{ name: string; tags: string[] }>()
  g3.set('b', { name: 'first', tags: ['1', '2'] })
  g3.set('b', { name: 'second', tags: [] })
  expect(g3.get('b')).to.deep.equal({ name: 'second', tags: [] })

  const g4 = createGraph<{ name: string; tags: string[] }>()
  g4.set('c', { name: 'test', tags: [] })
  g4.setLabel('c', 'item', 'special')

  expect(g4.labeled('item').has('c')).to.equal(true)
  expect(g4.labeled('special').has('c')).to.equal(true)
  expect(g4.labeled('nonexistent').size).to.equal(0)

  g4.registerLabel('special')
  g4.set('c', { name: 'updated', tags: [] }, { removeLabels: ['special'] })
  expect(g4.labeled('special').has('c')).to.equal(false)
  expect(g4.labeled('item').has('c')).to.equal(true)

  const g5 = createGraph<{ name: string; tags: string[] }>()
  g5.registerLabel('media')
  g5.registerLabel('episode')

  g5.set('m1', { name: 'Show A', tags: [] }, { addLabels: ['media'] })
  g5.set('m2', { name: 'Show A alt', tags: [] }, { addLabels: ['media'] })
  g5.set('e1', { name: 'Ep 1', tags: [] }, { addLabels: ['episode'] })
  g5.link('m1', 'm2', 'same_as')
  g5.edge('m1', 'e1', 'has_ep')

  const mediaClusters = g5.clusters('same_as', 'media')
  expect(mediaClusters.length).to.equal(1)
  expect(mediaClusters[0]!.length).to.equal(2)

  const allClusters = g5.clusters('same_as')
  expect(allClusters.length).to.equal(2)
}

export const movieAsSingleEpisode = async () => {
  const { upsertMedia, upsertEpisodes, findAggregatedMedia, findAggregatedEpisodesForMedia } = await import('../src/worker/store/db')
  const { makeMedia, makeMovieEpisode, isMovie } = await import('../src/sources/utils')

  const movie = (origin: string, id: string, title: string) =>
    makeMedia({ origin, id, score: 0.2, categories: ['MOVIE'], titles: [{ language: 'en', title, score: 0.2 }] })

  const nf = movie('nf', 'movie-81234567', 'Blade Runner 2049')
  const jw = movie('jw', 'movie-99', 'Blade Runner 2049')
  const nfEpisode = makeMovieEpisode(nf, { url: `https://www.netflix.com/watch/${nf.id}` })
  const jwEpisode = makeMovieEpisode(jw)

  // the episode uri suffixes the media uri: reusing it makes graph.set throw, since the node would carry both the 'media' and 'episode' labels and each registers a merge function
  expect(isMovie(nf)).to.equal(true)
  expect(nfEpisode.uri).to.equal(`${nf.uri}-1`)
  expect(nfEpisode.mediaUri).to.equal(nf.uri)
  expect(nfEpisode.episodeNumber).to.equal(1)
  expect(nfEpisode.url).to.equal('https://www.netflix.com/watch/movie-81234567')
  expect(nfEpisode.titles[0]!.title).to.equal('Blade Runner 2049')

  // The store narrows uri to `${string}:${string}`; the generated GraphQL types widen it to string.
  await upsertMedia([nf, jw] as any, [{ mediaUri: nf.uri, handleUri: jw.uri }])
  await upsertEpisodes([nfEpisode, jwEpisode] as any, [])

  const cluster = await findAggregatedMedia(nf.uri)
  expect(cluster.map(media => media.uri).sort()).to.deep.equal(['jw:movie-99', 'nf:movie-81234567'])

  const groups = await findAggregatedEpisodesForMedia([nf.uri, jw.uri])
  const episodes = groups.flat().filter(episode => episode.episodeNumber != null)
  expect(episodes.map(episode => episode.uri).sort()).to.deep.equal(['jw:movie-99-1', 'nf:movie-81234567-1'])

  // mirrors the group-by-episodeNumber in resolvers/media/index.ts
  const grouped = new Map<number, typeof episodes>()
  for (const episode of episodes) {
    if (!grouped.has(episode.episodeNumber!)) grouped.set(episode.episodeNumber!, [])
    grouped.get(episode.episodeNumber!)!.push(episode)
  }
  expect(grouped.size).to.equal(1)
  expect(grouped.get(1)!.length).to.equal(2)
}
