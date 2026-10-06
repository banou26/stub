import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, desc, img } from '../utils'

const SCORE = 0.3
// The search every thetvdb.com page points its search box at (`window.TVDB_SEARCH_URL`, read
// 2026-10-07). It needs no key, where every v4 read does.
const SEARCH = 'https://api4.thetvdb.com/web/search/queries'

export const icon = 'https://www.thetvdb.com/images/icon.png'
export const originUrl = 'https://www.thetvdb.com'
export const categories = ['SERIES'] as const
export const name = 'TheTVDB'
export const origin = 'tvdb'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['tvdb']
export const color = '#6cd591'

type RemoteId = { id?: string, sourceName?: string }

/** A hit of the site's search. `name` is in the series' own language; both maps are keyed by ISO 639-2 code. */
type Hit = {
  id?: number
  name?: string
  first_air_date?: string
  image_url?: string
  primary_language?: string
  translations?: Record<string, string>
  overviews?: Record<string, string>
  remote_ids?: RemoteId[]
}

type SearchParams = { query: string, filters: string, hitsPerPage: number }

const search = (params: SearchParams, ctx: ExtractorServerContext): Promise<Hit[]> =>
  ctx
    .fetch(SEARCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ indexName: 'TVDB', params }] }),
    })
    .then(r => r.json() as Promise<{ results?: { hits?: Hit[] }[] }>)
    .then(answer => answer.results?.[0]?.hits ?? [])
    .catch(() => [])

// Movies, series, people and companies share one index and are numbered in separate sequences, so
// `id:1` alone matches a movie, a company and a list at once (measured 2026-10-07).
const seriesFilter = (id?: string) => (id ? `type:series AND id:${id}` : 'type:series')

// `tvdb:<id>` names the whole series, and the imdb id on it is the series' too, identical for every
// season, so both go out CONTAINER. No tmdb handle: a tmdb tv id names the show, while
// `tmdb/extractor.ts` mints season scoped runs a bare id would union, as trakt and simkl record.
const buildHandles = (remoteIds?: RemoteId[]): GQLMedia[] =>
  (remoteIds ?? [])
    .filter(remote => remote.sourceName === 'IMDB' && remote.id)
    .map(remote => makeMedia({ origin: 'imdb', id: remote.id!, url: `https://www.imdb.com/title/${remote.id}`, scope: 'CONTAINER' }))

const titlesOf = (hit: Hit) => {
  const english = hit.translations?.eng
  const titles = english ? [{ language: 'en', title: english, score: SCORE }] : []
  if (hit.name && hit.name !== english) titles.push({ language: hit.primary_language === 'jpn' ? 'jp' : 'en', title: hit.name, score: SCORE })
  return titles
}

const normalize = (hit: Hit): GQLMedia | undefined => {
  if (hit.id == null) return undefined
  const id = String(hit.id)
  return makeMedia({
    origin,
    id,
    url: `https://thetvdb.com/dereferrer/series/${id}`,
    scope: 'CONTAINER',
    handles: buildHandles(hit.remote_ids),
    categories: ['SERIES'],
    score: SCORE,
    titles: titlesOf(hit),
    ...desc(hit.overviews?.eng, SCORE),
    covers: img(hit.image_url, SCORE),
    startDate: hit.first_air_date || undefined,
  })
}

// No episode list. The site renders episodes only on its season pages, named in the series' own
// language whatever is asked, and a list spanning seasons would be refused anyway: `tvdb:<id>` names
// the whole series, and every media in this store is one run.
const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const hits = await search({ query: '', filters: seriesFilter(id), hitsPerPage: 1 }, ctx)
  const hit = hits.find(candidate => String(candidate.id) === id)
  return hit ? normalize(hit) : undefined
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> =>
  (await search({ query, filters: seriesFilter(), hitsPerPage: 10 }, ctx))
    .map(normalize)
    .filter((media): media is GQLMedia => !!media)

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const tvdbUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: tvdbUri ? (await getMedia(tvdbUri.id, ctx)) ?? null : null }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        yield { mediaPage: { nodes: await searchApi(search, ctx) } }
      }
    }
  }
}
