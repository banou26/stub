// Both mappers between the graphql row and the store row are hand written, so a new field is dropped
// silently unless something pins it. `scope` is the field whose loss reopens the season weld.
import { beforeEach, expect, test } from 'vite-plus/test'

import { aggregateMedia } from '../../../../src/worker/store/aggregate'
import { resetStore } from '../../../../src/worker/store/db'
import { normalizeToStoreMedia } from '../../../../src/worker/store/normalize'

const gql = (uri: string, scope?: 'RUN' | 'CONTAINER' | null, fields: Record<string, unknown> = {}) => ({
  _id: uri,
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  handles: [],
  categories: [],
  titles: [],
  descriptions: [],
  shortDescriptions: [],
  trailers: [],
  covers: [],
  banners: [],
  episodes: [],
  ...scope === undefined ? {} : { scope },
  ...fields,
}) as any

const row = (uri: string, scope: 'RUN' | 'CONTAINER') => ({ ...normalizeToStoreMedia(gql(uri)), scope })

beforeEach(() => { resetStore() })

test('normalizeToStoreMedia carries CONTAINER through', () => {
  expect(normalizeToStoreMedia(gql('cr:G24H1N3MP', 'CONTAINER')).scope).toBe('CONTAINER')
  expect(normalizeToStoreMedia(gql('anilist:108465', 'RUN')).scope).toBe('RUN')
})

test('normalizeToStoreMedia defaults an absent scope to RUN', () => {
  expect(normalizeToStoreMedia(gql('anilist:108465')).scope).toBe('RUN')
  expect(normalizeToStoreMedia(gql('anilist:108465', null)).scope).toBe('RUN')
})

test('normalizeToStoreMedia carries season, seasonYear, genres and tags through', () => {
  const stored = normalizeToStoreMedia(gql('anilist:108465', 'RUN', {
    season: 'SUMMER', seasonYear: 2026, genres: ['Sci-Fi', 'Action'], tags: ['Time Skip'],
  }))
  expect(stored.season).toBe('SUMMER')
  expect(stored.seasonYear).toBe(2026)
  expect(stored.genres).toEqual(['Sci-Fi', 'Action'])
  expect(stored.tags).toEqual(['Time Skip'])
})

// null and undefined read the same through `??`, so nothing downstream notices the difference until a
// row crosses a boundary that drops undefined keys. The store's row type promises null, and the
// promise is only kept here.
test('an absent browse field lands as null or as an empty array, never undefined', () => {
  const stored = normalizeToStoreMedia(gql('anilist:108465'))
  expect(stored.season).toBeNull()
  expect(stored.seasonYear).toBeNull()
  expect(stored.genres).toEqual([])
  expect(stored.tags).toEqual([])
  expect(Object.keys(stored)).toEqual(expect.arrayContaining(['season', 'seasonYear', 'genres', 'tags']))
})

test('aggregateMedia reports CONTAINER over a container singleton', () => {
  const aggregated = aggregateMedia([row('cr:G24H1N3MP', 'CONTAINER')], 'https://x')
  expect(aggregated.scope).toBe('CONTAINER')
  expect(aggregated.handles[0]!.node.scope, 'the handle node is the row, scope included').toBe('CONTAINER')
})

test('aggregateMedia reports RUN over a run cluster, and over a run singleton', () => {
  expect(aggregateMedia([row('anilist:108465', 'RUN'), row('kitsu:42323', 'RUN')], 'https://x').scope).toBe('RUN')
  expect(aggregateMedia([row('anilist:108465', 'RUN')], 'https://x').scope).toBe('RUN')
})

// a cluster is a container only when every member is: a mixed cluster from before scope existed still
// names a run, and two shows that are one show are still a show
test('aggregateMedia over a cluster reads every member', () => {
  expect(aggregateMedia([row('anilist:108465', 'RUN'), row('cr:G24H1N3MP', 'CONTAINER')], 'https://x').scope).toBe('RUN')
  expect(aggregateMedia([row('cr:G24H1N3MP', 'CONTAINER'), row('tvmaze:52279', 'CONTAINER')], 'https://x').scope).toBe('CONTAINER')
})

// The third of the three edits a new field needs. The other two are pinned in aggregate-fields.test.ts;
// this is the one that decides whether the field ever reaches the store at all.
test('normalizeToStoreMedia carries the next airing and the schedule through, and spells absence as null', () => {
  const airing = { episodeNumber: 11, airingAt: 'Sun, 06 Sep 2026 15:30:00 GMT' }
  const scheduled = normalizeToStoreMedia(gql('anilist:1', 'RUN', { nextAiringEpisode: airing, airingSchedule: [airing] }))
  expect(scheduled.nextAiringEpisode).toEqual(airing)
  expect(scheduled.airingSchedule).toEqual([airing])
  expect(normalizeToStoreMedia(gql('anilist:1', 'RUN')).nextAiringEpisode).toBeNull()
  expect(normalizeToStoreMedia(gql('anilist:1', 'RUN')).airingSchedule).toBeNull()
})
