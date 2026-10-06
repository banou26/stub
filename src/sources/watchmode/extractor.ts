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

// The tRPC gateway www.watchmode.com's own client calls (read 2026-10-07). Its title reads need no
// sign-in, where every api.watchmode.com read needs a key.
const GATEWAY = 'https://gateway.watchmode.com/trpc'

/**
 * A hit of the site's quick search. `combinedID` is the title id behind a type prefix, `01` for a film
 * and `03` for a series (`01182444` is Inception, `03195245` is Frieren), and is this source's media id.
 */
interface WatchmodeHit {
  combinedID?: string
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

const trpc = <T>(procedure: string, input: object, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx
    .fetch(`${GATEWAY}/gateway.${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`)
    .then(r => r.json() as Promise<{ result?: { data?: { json?: T } } }>)
    .then(answer => answer.result?.data?.json)
    .catch(() => undefined)

const isFilm = (id: string) => id.startsWith('01')

const STREAM_HOST_ORIGIN_MAP: { match: (host: string) => boolean, origin: string }[] = [
  { match: host => host.endsWith('crunchyroll.com'), origin: 'cr' },
  { match: host => host.endsWith('netflix.com'), origin: 'nf' },
  { match: host => host.endsWith('hulu.com'), origin: 'hulu' },
  { match: host => host.endsWith('disneyplus.com'), origin: 'disney' },
  { match: host => host.endsWith('primevideo.com') || host.includes('amazon.'), origin: 'amazon' },
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
 * The catalogue ids a Watchmode record publishes that are worth minting.
 *
 * `tmdb` is not one of them, and it fails in both of its two forms, exactly as simkl's does. A tv id
 * names the SHOW and this file has no season concept to scope it with. A MOVIE id is worse than
 * unscoped: TMDB numbers movies and tv shows in separate sequences that both start at 1, measured
 * 2026-09-04, so `themoviedb.org/movie/550` is Fight Club and `/tv/550` is Till Death Us Do Part.
 * Stub's uri is `tmdb:550` for both, and `tmdb_type` decided the URL here while the ID stayed bare, so
 * a film could weld to whatever unrelated series holds its number. `tmdb/extractor.ts` is
 * `categories = ['SERIES']` and reads `/tv/` pages only, so it could not resolve a movie id anyway.
 *
 * `imdb` stays, as PART_OF: a `tt` id names the show and there is no season-level equivalent, which is
 * the whole reason `SHOW_LEVEL_ORIGINS` exists. Saying so here rather than relying on that Set to
 * demote it means the claim is honest at the point it is made.
 */
const idHandles = (hit: WatchmodeHit): GQLMediaHandle[] => {
  const handles: GQLMediaHandle[] = []
  const imdbId = hit.imdbId
  if (imdbId) handles.push(partOf(makeMedia({ origin: 'imdb', id: imdbId, url: `https://www.imdb.com/title/${imdbId}` })))
  // A TMDB TV id names the show, so PART_OF is honest for it. A MOVIE id is refused outright and
  // PART_OF cannot rescue it: TMDB numbers films and shows in separate sequences that both start at 1,
  // so `tmdb:550` is Fight Club as a movie and Till Death Us Do Part as a series. A PART_OF pointing at
  // the wrong ROW is not a weaker claim, it is a wrong one.
  const tmdbId = hit.tmdbId
  if (tmdbId != null && hit.tmdbType !== 'movie') {
    handles.push(partOf(makeMedia({ origin: 'tmdb', id: String(tmdbId), url: `https://www.themoviedb.org/tv/${tmdbId}` })))
  }
  return handles
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
// That is a CONTAINER, and only a film, which is its own single run, is a RUN.
const kindOf = (id: string): Pick<GQLMedia, 'categories' | 'scope'> =>
  isFilm(id) ? { categories: ['MOVIE'], scope: 'RUN' } : { categories: ['SERIES'], scope: 'CONTAINER' }

const normalizeHit = (hit: WatchmodeHit): GQLMedia | undefined => {
  const id = hit.combinedID
  if (!id) return undefined
  return makeMedia({
    origin,
    id,
    url: `https://www.watchmode.com/title/${id}`,
    handles: idHandles(hit),
    score: SCORE,
    ...kindOf(id),
    titles: hit.name ? [{ language: 'en', title: hit.name, score: SCORE }] : [],
    // a title with no poster names `posters/blank.gif`
    covers: img(hit.thumbnailURL?.endsWith('/blank.gif') ? undefined : hit.thumbnailURL, SCORE),
    startDate: hit.year ? `${hit.year}-01-01` : undefined,
  })
}

// The title page's providers carry no title, so this row is its links alone: the search hit that
// minted its id carries the title, the year and the catalogue ids.
const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const providers = await trpc<{ consolidatedProviders?: WatchmodeProvider[] }>('fetchTitlePageProviders', { combinedTitleID: id }, ctx)
  if (!providers) return undefined
  const film = isFilm(id)
  const media = makeMedia({
    origin,
    id,
    url: `https://www.watchmode.com/title/${id}`,
    handles: dedupeHandles(
      (providers.consolidatedProviders ?? [])
        .map(provider => sourceToHandle(provider, film))
        .filter((handle): handle is GQLMediaHandle => !!handle)
    ),
    score: SCORE,
    ...kindOf(id),
  })
  if (isMovie(media)) {
    media.episodes = [makeMovieEpisode(media)]
    media.episodeCount = 1
  }
  return media
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> =>
  ((await trpc<{ results?: WatchmodeHit[] }>('quickSearch', { q: query, type: 1 }, ctx))?.results ?? [])
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
