import type { Ways } from '../../../../src/router/watch/auto-pick'

import { expect, test } from 'vite-plus/test'

import { adjacentRun, neighbours, sourceFor } from '../../../../src/router/watch/neighbours'

const AHEAD = '2099-01-01'
const run = (uri: string, ...dates: (string | undefined)[]) =>
  ({ uri, episodes: dates.map((releaseDate, index) => ({ episodeNumber: index + 1, releaseDate, name: `${uri} E${index + 1}` })) })
type Named = { mediaUri: string, episode: { name: string } } | undefined
const names = ({ previous, next }: { previous: Named, next: Named }) =>
  ({ previous: previous && [previous.mediaUri, previous.episode.name], next: next && [next.mediaUri, next.episode.name] })

const three = run('s1', undefined, undefined, AHEAD)

test('previous is the row before, next the row after only once it is out', () => {
  expect(names(neighbours([undefined, three, undefined], 1))).toEqual({ previous: ['s1', 's1 E1'], next: undefined })
  expect(names(neighbours([undefined, three, undefined], 0))).toEqual({ previous: undefined, next: ['s1', 's1 E2'] })
  expect(names(neighbours([undefined, run('s1', undefined, undefined, undefined), undefined], 2)), 'the last row').toEqual({ previous: ['s1', 's1 E2'], next: undefined })
})

test('next is out by the time it is given, not the time it is read', () => {
  const airing = { ...run('s1', undefined, undefined, undefined), nextAiringEpisode: { episodeNumber: 3, airingAt: '2099-01-01T14:00:00Z' } }
  expect(names(neighbours([undefined, airing, undefined], 1, new Date('2099-01-01T13:59:30Z'))).next).toBeUndefined()
  expect(names(neighbours([undefined, airing, undefined], 1, new Date('2099-01-01T14:00:30Z'))).next).toEqual(['s1', 's1 E3'])
})

test('an episode missing from the list has neither', () => {
  expect(names(neighbours([run('s0', undefined), three, run('s2', undefined)], -1))).toEqual({ previous: undefined, next: undefined })
})

test('past a run\'s last episode, next is the first of the run after, once it is out', () => {
  const done = run('s1', undefined, undefined)
  expect(names(neighbours([undefined, done, run('s2', undefined, AHEAD)], 1))).toEqual({ previous: ['s1', 's1 E1'], next: ['s2', 's2 E1'] })
  expect(names(neighbours([undefined, done, run('s2', AHEAD)], 1)), 'not out').toEqual({ previous: ['s1', 's1 E1'], next: undefined })
  expect(names(neighbours([undefined, done, { ...run('s2', undefined), status: 'NOT_YET_RELEASED' }], 1)), 'announced').toEqual({ previous: ['s1', 's1 E1'], next: undefined })
  expect(names(neighbours([undefined, done, run('s2')], 1)), 'no episode listed yet').toEqual({ previous: ['s1', 's1 E1'], next: undefined })
})

test('before a run\'s first episode, previous is the last of the run before', () => {
  expect(names(neighbours([run('s1', undefined, undefined), run('s2', undefined, undefined), undefined], 0))).toEqual({ previous: ['s1', 's1 E2'], next: ['s2', 's2 E2'] })
})

const seasons = [{ number: 1, uri: 'tmdb:9-s1' }, { number: 2, uri: 'tmdb:9-s2' }, { number: 3, uri: 'tmdb:9-s3' }]
const answersTo = (...uris: string[]) => uris.map(uri => ({ node: { uri } }))

// a bare `tmdb:9-s3` is answered by TMDB alone, so its episodes would carry none of the other sources' handles
test('a show\'s run beside this one is the season beside it in its list, as a cluster', () => {
  const second = { handles: answersTo('tvdb:5', 'tmdb:9-s2'), seasons }
  expect(adjacentRun(second, 1)).toBe('ag:(tmdb:9-s3)')
  expect(adjacentRun(second, -1)).toBe('ag:(tmdb:9-s1)')
  const last = { handles: answersTo('tmdb:9-s3'), seasons, relations: [{ relation: 'SEQUEL', format: 'TV', node: { uri: 'anilist:7' } }] }
  expect(adjacentRun(last, 1), 'the last season has none, whatever else is listed').toBeUndefined()
  expect(adjacentRun({ handles: answersTo('tmdb:9-s1'), seasons }, -1)).toBeUndefined()
})

const relations = [
  { relation: 'ADAPTATION', format: 'MANGA', node: { uri: 'anilist:100' } },
  { relation: 'SEQUEL', format: 'MANGA', node: { uri: 'anilist:101' } },
  { relation: 'SEQUEL', format: 'TV', node: { uri: 'anilist:2' } },
  { relation: 'PREQUEL', format: 'MOVIE', node: { uri: 'anilist:0' } },
]

test('an anime\'s run beside this one is its sequel or prequel that plays', () => {
  const anime = { handles: answersTo('anilist:1'), seasons: null, relations }
  expect(adjacentRun(anime, 1)).toBe('anilist:2')
  expect(adjacentRun(anime, -1)).toBe('anilist:0')
  expect(adjacentRun({ ...anime, relations: relations.slice(0, 2) }, 1), 'only a book follows it').toBeUndefined()
  expect(adjacentRun({ handles: answersTo('anilist:1'), relations: [] }, 1)).toBeUndefined()
})

// AniList's own lists, read 2026-10-16, in the uri order the graph store gives them
const edge = (relation: string, id: number, format: string) => ({ relation, format, node: { uri: `anilist:${id}` } })

test('an anime\'s sequel or prequel of its own format comes first, else any that plays', () => {
  const tv = (id: number, ...edges: ReturnType<typeof edge>[]) => ({ handles: answersTo(`anilist:${id}`), type: 'TV', relations: edges })
  expect(adjacentRun(tv(11757, edge('SEQUEL', 20021, 'SPECIAL'), edge('SEQUEL', 20594, 'TV')), 1), 'Sword Art Online, past its recap').toBe('anilist:20594')
  expect(adjacentRun(tv(101922, edge('SEQUEL', 112151, 'MOVIE'), edge('SEQUEL', 129874, 'TV')), 1), 'Demon Slayer, past the film').toBe('anilist:129874')
  expect(adjacentRun(tv(142329, edge('PREQUEL', 112151, 'MOVIE'), edge('PREQUEL', 129874, 'TV')), -1), 'and back').toBe('anilist:129874')
  expect(adjacentRun(tv(131681, edge('SEQUEL', 146984, 'SPECIAL')), 1), 'a special that ends the story').toBe('anilist:146984')
})

test('a film has no run beside it', () => {
  const film = { handles: answersTo('anilist:112151'), relations: [edge('PREQUEL', 101922, 'TV'), edge('SEQUEL', 142329, 'TV')] }
  expect(adjacentRun({ ...film, type: 'MOVIE' }, 1)).toBeUndefined()
  expect(adjacentRun({ ...film, type: 'MOVIE' }, -1)).toBeUndefined()
  expect(adjacentRun({ ...film, categories: ['MOVIE'] }, 1), 'a film by its categories').toBeUndefined()
  expect(adjacentRun({ ...film, type: 'TV' }, 1), 'the control').toBe('anilist:142329')
})

const ways: Ways = {
  builtIn: origin => origin === 'cr',
  selfPlaying: origin => origin === 'nyaa',
  off: () => false,
  order: ['cr', 'amazon', 'nf'],
  possible: () => true,
  settled: () => false,
}
const third = [
  { uri: 'cr:GX3', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX3' },
  { uri: 'nyaa:b', origin: 'nyaa', url: 'magnet:?xt=urn:btih:b' },
  { uri: 'nyaa:c', origin: 'nyaa', url: 'magnet:?xt=urn:btih:c' },
]

test('the other episode opens on the origin playing now, a release on its first release', () => {
  expect(sourceFor(third, 'nyaa', ways)).toBe('nyaa:b')
  expect(sourceFor(third, 'cr', ways)).toBe('cr:GX3')
})

test('an origin the other episode lacks, or cannot play there, names no source', () => {
  expect(sourceFor(third, 'amazon', ways)).toBeUndefined()
  expect(sourceFor([{ uri: 'amazon:us', origin: 'amazon', url: 'https://watch.amazon.com/watch?gti=us' }], 'amazon', ways)).toBeUndefined()
  expect(sourceFor(third, undefined, ways)).toBeUndefined()
  expect(sourceFor(third, 'nyaa', { ...ways, off: origin => origin === 'nyaa' }), 'an origin turned off').toBeUndefined()
})
