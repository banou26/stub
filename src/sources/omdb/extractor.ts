import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, MediaScope } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img } from '../utils'
import { percentScore } from '../average-score'
import { charactersByName, type SourceCredits, type SourcePerson } from '../credits'

const SCORE = 0.3
// IMDb's own GraphQL, which imdb.com's web app calls. It needs no key and answers 403 without the web
// app's client name (measured 2026-10-07). Every answer carries IMDb's notice that public, commercial
// or non-private use of its data is not allowed.
const GRAPHQL = 'https://caching.graphql.imdb.com/'
const CLIENT_NAME = 'imdb-web-next-localized'

// The origin stays `omdb`, so every uri minted under it still resolves; the data was always IMDb's.
export const icon = 'https://www.imdb.com/favicon.ico'
export const originUrl = 'https://www.imdb.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'IMDb'
export const origin = 'omdb'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['omdb']
export const color = '#f5c518'

type Day = { year?: number | null, month?: number | null, day?: number | null } | null
type Plot = { plotText?: { plainText?: string | null } | null } | null
type EpisodeNode = {
  id?: string
  titleText?: { text?: string } | null
  plot?: Plot
  releaseDate?: Day
  primaryImage?: { url?: string } | null
  series?: { episodeNumber?: { seasonNumber?: number | null, episodeNumber?: number | null } | null } | null
}
type Title = {
  id?: string
  titleText?: { text?: string } | null
  titleType?: { id?: string } | null
  releaseYear?: { year?: number | null } | null
  releaseDate?: Day
  ratingsSummary?: { aggregateRating?: number | null } | null
  plot?: Plot
  primaryImage?: { url?: string } | null
  episodes?: { seasons?: { number?: number }[] | null, episodes?: { edges?: { node?: EpisodeNode | null }[] | null } | null } | null
  cast?: { edges?: { node?: { name?: Name | null, characters?: { name?: string }[] | null } | null }[] | null } | null
  crew?: { category?: { id?: string } | null, credits?: { name?: Name | null }[] | null }[] | null
}
type Name = { id?: string, nameText?: { text?: string } | null, primaryImage?: { url?: string } | null }

const TITLE_FIELDS = 'id titleText { text } titleType { id } releaseYear { year } primaryImage { url }'
const SEARCH_QUERY = `query Search($q: String!) { mainSearch(first: 10, options: { searchTerm: $q, type: TITLE }) { edges { node { entity { ... on Title { ${TITLE_FIELDS} } } } } } }`
// The first season's episodes ride along, and are kept only when the series has that one season.
const titleQuery = (details: string) => `query Title($id: ID!) { title(id: $id) { ${TITLE_FIELDS} releaseDate { year month day } ratingsSummary { aggregateRating } plot { plotText { plainText } } episodes { seasons { number } episodes(first: 250, filter: { includeSeasons: ["1"] }) { edges { node { id titleText { text } plot { plotText { plainText } } releaseDate { year month day } primaryImage { url } series { episodeNumber { seasonNumber episodeNumber } } } } } }${details} } }`
// The relay caches on the whole body, so the modal's leaves out what only the title page's `details` reads
const TITLE_QUERY = titleQuery('')
const NAME_FIELDS = 'id nameText { text } primaryImage { url }'
const TITLE_DETAILS_QUERY = titleQuery(` cast: credits(first: 25, filter: { categories: ["cast"] }) { edges { node { name { ${NAME_FIELDS} } ... on Cast { characters { name } } } } } crew: principalCredits(filter: { categories: ["director", "writer", "creator"] }) { category { id } credits { name { ${NAME_FIELDS} } } }`)

const graphql = <T>(query: string, variables: Record<string, string>, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx
    .fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-imdb-client-name': CLIENT_NAME },
      body: JSON.stringify({ query, variables }),
    })
    .then(r => r.json() as Promise<{ data?: T }>)
    .then(answer => answer.data)
    .catch(() => undefined)

const FILM_TYPES = new Set(['movie', 'tvMovie'])
const SERIES_TYPES = new Set(['tvSeries', 'tvMiniSeries'])

const pad = (value: number) => String(value).padStart(2, '0')
const dayOf = (date: Day | undefined): string | undefined =>
  date?.year && date.month && date.day ? `${date.year}-${pad(date.month)}-${pad(date.day)}` : undefined

// The row is keyed by an IMDb id and IMDb models no seasons, so a series row names the whole show
// and is CONTAINER, as is the imdb handle minted beside it. A film's id names the film: RUN. Anything
// else IMDb lists (an episode, a game, a short) is no row of this source.
const normalizeMedia = (title: Title): GQLMedia | undefined => {
  const type = title.titleType?.id ?? ''
  const film = FILM_TYPES.has(type)
  if (!title.id || !(film || SERIES_TYPES.has(type))) return undefined
  const scope: MediaScope = film ? 'RUN' : 'CONTAINER'
  const url = `https://www.imdb.com/title/${title.id}`
  const year = title.releaseYear?.year
  return makeMedia({
    origin,
    id: title.id,
    url,
    scope,
    handles: [makeMedia({ origin: 'imdb', id: title.id, url, scope })],
    // the type is what tells the graph's guards this is a film, which a category alone does not
    type: film ? 'MOVIE' : undefined,
    categories: film ? ['MOVIE'] : ['SERIES'],
    score: SCORE,
    titles: title.titleText?.text ? [{ language: 'en', title: title.titleText.text, score: SCORE }] : [],
    ...desc(title.plot?.plotText?.plainText, SCORE),
    covers: img(title.primaryImage?.url, SCORE),
    averageScore: percentScore(title.ratingsSummary?.aggregateRating, 10),
    startDate: dayOf(title.releaseDate) ?? (year ? `${year}-01-01` : undefined),
  })
}

// IMDb's url names the full-size original, 749 KB for one face (2026-10-12); `UY256` asks a copy 256 px
// tall, 9 KB
const personOf = (name: Name | null | undefined): SourcePerson | undefined =>
  name?.id && name.nameText?.text
    ? { id: `imdb:${name.id}`, name: name.nameText.text, image: name.primaryImage?.url?.replace(/\._V1_\.jpg$/, '._V1_UY256_.jpg'), url: `https://www.imdb.com/name/${name.id}` }
    : undefined

/**
 * A title's first 25 actors, each under the first part IMDb lists for them, and its directors, writers
 * and creators as staff. One part only: on a sketch or variety show one actor has hundreds.
 */
export const parseCredits = ({ cast, crew }: Title): SourceCredits => ({
  characters: charactersByName((cast?.edges ?? []).flatMap(({ node }) => {
    const person = personOf(node?.name)
    return person ? (node?.characters ?? []).slice(0, 1).flatMap(({ name }) => (name ? [{ name, language: null, person }] : [])) : []
  })),
  staff: (crew ?? []).flatMap(({ category, credits }) => (credits ?? []).flatMap(({ name }) => {
    const person = personOf(name)
    return person && category?.id ? [{ person, roles: [category.id.charAt(0).toUpperCase() + category.id.slice(1)] }] : []
  })),
})

const normalizeEpisode = (node: EpisodeNode, mediaId: string, mediaUri: string): GQLEpisode => {
  const season = node.series?.episodeNumber?.seasonNumber ?? 1
  const number = node.series?.episodeNumber?.episodeNumber ?? undefined
  return makeEpisode({
    origin,
    id: node.id ?? `${mediaId}-s${season}e${number}`,
    mediaUri,
    score: SCORE,
    titles: node.titleText?.text ? [{ language: 'en', title: node.titleText.text, score: SCORE }] : [],
    ...desc(node.plot?.plotText?.plainText, SCORE),
    thumbnails: img(node.primaryImage?.url, SCORE),
    seasonNumber: season,
    episodeNumber: number,
    releaseDate: dayOf(node.releaseDate),
  })
}

const getMedia = async (id: string, ctx: ExtractorServerContext, details?: boolean | null): Promise<GQLMedia | undefined> => {
  const title = (await graphql<{ title?: Title | null }>(details ? TITLE_DETAILS_QUERY : TITLE_QUERY, { id }, ctx))?.title
  const media = title ? normalizeMedia(title) : undefined
  if (!title || !media) return undefined
  if (details) Object.assign(media, { credits: parseCredits(title) })
  if (isMovie(media)) {
    media.episodes = [makeMovieEpisode(media)]
    media.episodeCount = 1
    return media
  }
  // A SHOW with more than one season has no honest episode list here, and this media is show level by
  // construction: its id is an IMDb id, which `worker/store/db.ts` exempts outright because IMDb
  // models no seasons. Every media in this store is one run, so `episodeNumber` is within-season, and
  // `Media.episodes` groups the union by episodeNumber ALONE: flattened seasons put 24 rows on a 14
  // episode season page, measured live 2026-08-31. The media itself stays, since search mints these ids.
  const seasons = title.episodes?.seasons ?? []
  if (seasons.length === 1) {
    media.episodes = (title.episodes?.episodes?.edges ?? [])
      .flatMap(edge => edge.node ? [normalizeEpisode(edge.node, id, media.uri)] : [])
    media.episodeCount = media.episodes.length
  }
  return media
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const search = await graphql<{ mainSearch?: { edges?: { node?: { entity?: Title | null } | null }[] } | null }>(SEARCH_QUERY, { q: query }, ctx)
  return (search?.mainSearch?.edges ?? [])
    .map(edge => (edge.node?.entity ? normalizeMedia(edge.node.entity) : undefined))
    .filter((media): media is GQLMedia => !!media)
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri, details } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const omdbUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: omdbUri ? (await getMedia(omdbUri.id, ctx, details)) ?? null : null }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        yield { mediaPage: { nodes: await searchApi(search, ctx) } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      if (isMovie(parent)) return [makeMovieEpisode(parent)]
      return (await getMedia(parent.id, ctx))?.episodes ?? []
    }
  }
}
