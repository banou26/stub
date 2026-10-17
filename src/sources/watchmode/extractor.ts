import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, MediaHandle as GQLMediaHandle } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeMovieEpisode, isMovie, img } from '../utils'
// the same job over the same provider urls, shape tested per host and measured against a 3168 offer corpus
import { extractContentId, providerContentId } from '../justwatch/id'
import { mintableAsFilmHandle, streamPointers } from '../kitsu/stream-id'
import { partOf, sameAs } from '../utils'

const SCORE = 0.25

export const icon = 'https://api.watchmode.com/favicon.ico'
export const originUrl = 'https://www.watchmode.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Watchmode'
export const origin = 'watchmode'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['watchmode']
export const color = '#1fb6ff'

// The tRPC gateway www.watchmode.com's own client calls (read 2026-10-07), asked as that client asks:
// batched (`httpBatchLink`), from the site's origin. Its title reads need no sign-in, where every
// api.watchmode.com read needs a key.
const GATEWAY = 'https://gateway.watchmode.com/trpc'

/**
 * A hit of the site's quick search. `combinedID` is this source's media id, and its leading digits do
 * not say film or series: The Last of Us (2023, TV) is `01564613` and the film Breaking Bad Wolf is
 * `04146033` (2026-10-13). `slugTypeFolder` says it, `movie` or `tv`, the folder of the title's own url.
 */
interface WatchmodeHit {
  combinedID?: string
  slugTypeFolder?: string | null
  name?: string
  year?: number
  thumbnailURL?: string
  imdbId?: string | null
  tmdbId?: number | null
  tmdbType?: string | null
}

/** A provider row of a title page. `consolidatedProviders` holds every region's, the viewer's included. */
interface WatchmodeProvider {
  webLink?: string | null
}

/** A title as `fetchTitleDetails` answers it: the kind a search hit states, and its title page providers. */
interface WatchmodeTitle {
  slugTypeFolder?: string | null
  consolidatedProviders?: WatchmodeProvider[]
}

const trpc = <T>(procedure: string, input: object, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx
    .fetch(`${GATEWAY}/gateway.${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: input } }))}`, { headers: { origin: originUrl } })
    .then(r => r.json() as Promise<{ result?: { data?: { json?: T } } }[] | null>)
    .then(answer => answer?.[0]?.result?.data?.json)
    .catch(() => undefined)

// `tmdbType` is no substitute: it says `movie` for a TV special, which Watchmode files under `tv` with a
// season and an episode of its own (Planet Earth: A Celebration, 2026-10-13)
const isFilm = (title: { slugTypeFolder?: string | null }) => title.slugTypeFolder === 'movie'

// No Prime Video: its ids are per country, and a row here does not say whose (The Boys carries three
// primevideo.com ids), so JustWatch alone hands out the viewer's own
const STREAM_HOST_ORIGIN_MAP: { match: (host: string) => boolean, origin: string }[] = [
  { match: host => host.endsWith('crunchyroll.com'), origin: 'cr' },
  { match: host => host.endsWith('netflix.com'), origin: 'nf' },
  { match: host => host.endsWith('hulu.com'), origin: 'hulu' },
  { match: host => host.endsWith('disneyplus.com'), origin: 'disney' },
  { match: host => host.endsWith('max.com') || host.endsWith('hbomax.com'), origin: 'hbo' },
]

const streamOriginForHost = (host: string): string | undefined =>
  STREAM_HOST_ORIGIN_MAP.find(entry => entry.match(host))?.origin

/**
 * The provider id a Watchmode source row names, or undefined when it names none.
 *
 * READ BY `justwatch/id.ts`'s `extractContentId`, which is the same job over the same provider urls,
 * shape tested per host and measured against a 3168 offer corpus on 2026-09-01. This used to be
 * `new URL(webUrl).pathname.split('/').filter(Boolean).at(-1)`, a positional read with no shape test,
 * and the last segment is the id for almost none of these hosts:
 *
 *   watch.amazon.com/detail?gti=<id>          pathname is '/detail', so EVERY Amazon title minted
 *                                             the literal handle `amazon:detail`
 *   crunchyroll.com/series/<id>/<slug>        the last segment is the SLUG, shared by every run
 *   hulu.com/series/<uuid>                    a container uuid, shared by every season
 *
 * `providerContentId` then applies the refusals that go with those ids. Watchmode has no season
 * concept anywhere in this file, so it passes no season number, which is what makes the crunchyroll
 * refusal fire: a bare `/series/` id names the show and, on Crunchyroll, its films too.
 *
 * EVERY ID THAT SURVIVES OFF A SERIES IS STILL SHOW LEVEL, which is why this source was unplugged on
 * 2026-09-04 and why it is back: they are minted PART_OF now. A watchmode series record IS the show, so
 * `nf:80987039` off one names the Netflix title and not this run. As SAME_AS that welded every run of
 * the show; as PART_OF it is just the link, which is the only thing this source was ever for. A FILM's
 * per-title id is the exception, see `sourceToHandle`.
 *
 * THE FALLBACK IS GONE, and that is deliberate. It used to mint the WATCHMODE title id under the
 * provider's origin whenever the url would not parse, which asserts an id from one space inside
 * another: Netflix ids are integers too, so `nf:<watchmodeId>` can name a real and unrelated title.
 * No readable id now means no handle.
 */
const streamContentId = (webUrl: string, mappedOrigin: string): string | undefined => {
  const rawContentId = extractContentId(webUrl)
  return rawContentId ? providerContentId(mappedOrigin, rawContentId) : undefined
}

/**
 * A film's per-title id names the film itself, and `partOf` is the CONTAINER stamp: minted that way,
 * `nf:70000022` off a film arrived stamped CONTAINER, the flip is sticky in the store, and a film that
 * unogs and justwatch mint under that exact id as its own run lost its Netflix identity for every
 * later claimant in the session. So a film mints SAME_AS, and only for the ids kitsu's allowlist
 * measured as per-title (a Netflix /title/ or /watch/, see kitsu/stream-id.ts), read through the same
 * pointer so the two readers cannot disagree on the id. A series id names the show, as before.
 */
const sourceToHandle = (provider: WatchmodeProvider, film: boolean): GQLMediaHandle | undefined => {
  const webUrl = provider.webLink
  if (!webUrl) return undefined
  let host: string
  try {
    host = new URL(webUrl).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
  const mappedOrigin = streamOriginForHost(host)
  if (!mappedOrigin) return undefined
  const id = streamContentId(webUrl, mappedOrigin)
  if (!id) return undefined
  const node = makeMedia({ origin: mappedOrigin, id, url: webUrl })
  const pointer = streamPointers([webUrl])[0]
  if (film && pointer?.origin === mappedOrigin && pointer.id === id && mintableAsFilmHandle(pointer)) return sameAs(node)
  return partOf(node)
}

/**
 * The catalogue ids a Watchmode record publishes that are worth minting, both show level.
 *
 * A series record names the whole show, as its imdb id and its TMDB tv id do, so it claims to BE them:
 * three containers of one show, one card. As PART_OF it was a show hanging off itself, listed as a
 * second, thinner card beside the real one. A film links to them.
 *
 * A TMDB MOVIE id is refused outright: TMDB numbers movies and tv shows in separate sequences that both
 * start at 1, measured 2026-09-04, so `themoviedb.org/movie/550` is Fight Club and `/tv/550` is Till
 * Death Us Do Part, and stub's uri is `tmdb:550` for both. A claim pointing at the wrong ROW is not a
 * weaker claim, it is a wrong one.
 */
const idHandles = (hit: WatchmodeHit, film: boolean): GQLMediaHandle[] => {
  const nodes: GQLMedia[] = []
  if (hit.imdbId) nodes.push(makeMedia({ origin: 'imdb', id: hit.imdbId, url: `https://www.imdb.com/title/${hit.imdbId}`, scope: 'CONTAINER' }))
  if (hit.tmdbId != null && hit.tmdbType !== 'movie') {
    nodes.push(makeMedia({ origin: 'tmdb', id: String(hit.tmdbId), url: `https://www.themoviedb.org/tv/${hit.tmdbId}`, scope: 'CONTAINER' }))
  }
  return nodes.map(film ? partOf : sameAs)
}

const dedupeHandles = (handles: GQLMediaHandle[]): GQLMediaHandle[] => {
  const seen = new Set<string>()
  const out: GQLMediaHandle[] = []
  for (const handle of handles) {
    if (seen.has(handle.node.uri)) continue
    seen.add(handle.node.uri)
    out.push(handle)
  }
  return out
}

// Watchmode has no season concept, so a series record is the whole show: one id for every run of it.
// That is a CONTAINER, and only a film, which is its own single run, is a RUN. The type is what tells
// the graph's guards it is a film, which a category alone does not.
const kindOf = (film: boolean): Pick<GQLMedia, 'type' | 'categories' | 'scope'> =>
  film ? { type: 'MOVIE', categories: ['MOVIE'], scope: 'RUN' } : { categories: ['SERIES'], scope: 'CONTAINER' }

const normalizeHit = (hit: WatchmodeHit): GQLMedia | undefined => {
  const id = hit.combinedID
  if (!id) return undefined
  const film = isFilm(hit)
  return makeMedia({
    origin,
    id,
    url: `https://www.watchmode.com/title/${id}`,
    handles: idHandles(hit, film),
    score: SCORE,
    ...kindOf(film),
    titles: hit.name ? [{ language: 'en', title: hit.name, score: SCORE }] : [],
    // a title with no poster names `posters/blank.gif`
    covers: img(hit.thumbnailURL?.endsWith('/blank.gif') ? undefined : hit.thumbnailURL, SCORE),
    startDate: hit.year ? String(hit.year) : undefined,
  })
}

// This row is its kind and its links: the search hit that minted its id carries the title, the year
// and the catalogue ids.
const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const title = (await trpc<{ title?: WatchmodeTitle | null }>('fetchTitleDetails', { combinedTitleID: id }, ctx))?.title
  if (!title) return undefined
  const film = isFilm(title)
  const media = makeMedia({
    origin,
    id,
    url: `https://www.watchmode.com/title/${id}`,
    handles: dedupeHandles(
      (title.consolidatedProviders ?? [])
        .map(provider => sourceToHandle(provider, film))
        .filter((handle): handle is GQLMediaHandle => !!handle)
    ),
    score: SCORE,
    ...kindOf(film),
  })
  if (isMovie(media)) {
    media.episodes = [makeMovieEpisode(media)]
    media.episodeCount = 1
  }
  return media
}

// `type` is the API's `search_type` (api.watchmode.com/openapi.json): 2 is titles only, where 1 adds
// people, whose `07` ids would read as shows here
const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> =>
  ((await trpc<{ results?: WatchmodeHit[] }>('quickSearch', { q: query, type: 2 }, ctx))?.results ?? [])
    .map(normalizeHit)
    .filter((media): media is GQLMedia => !!media)

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const watchmodeUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: watchmodeUri ? (await getMedia(watchmodeUri.id, ctx)) ?? null : null }
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
    episodes: async (parent): Promise<GQLEpisode[]> => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      return isMovie(parent) ? [makeMovieEpisode(parent)] : []
    }
  }
}
