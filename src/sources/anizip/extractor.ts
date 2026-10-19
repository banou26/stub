import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, MediaHandle as GQLMediaHandle } from '../../generated/schema/types.generated'
import { fromAggregatedUri, isAggregatedUri } from '../../utils/uri'
import { dropCredit, makeMedia, makeEpisode, partOf, tmdbLink } from '../utils'

export const originUrl = 'https://api.ani.zip/' as const
export const origin = 'anizip' as const
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'AniZip' as const
export const official = false as const
export const metadataOnly = true as const
export const isApiOnly = true
export const supportedUris = ['anidb', 'mal']

const SCORE = 0.9

// AniDB, whose titles and summaries these are, writes every apostrophe as a backtick: "Frieren: Beyond Journey`s End"
const apostrophes = (text: string) => text.replaceAll('`', '\'')

const titlesOf = ({ en, ja }: { en?: string, ja?: string }) => [
  ...en ? [{ language: 'en', title: apostrophes(en), score: SCORE }] : [],
  ...ja ? [{ language: 'ja', title: apostrophes(ja), score: SCORE }] : [],
]

const DAY_MS = 86_400_000

// An episode not dated yet carries `airdate: ''`, which as a date would hide every other source's. TheTVDB's
// `airDateUtc` 2 or more days from AniDB's `airdate` is mostly a week late. Of 15 such episodes airing the week of
// 2026-10-18, `airdate` was AniList's day in Japan on 14 and Syoboi Calendar's first broadcast on 10, the other 4
// streaming on AniList's day ahead of a later TV slot. Within 2 days of `airdate`, `airDateUtc` was within an hour
// of Syoboi's time on 70 of 73.
const airedAt = ({ airDateUtc, airdate }: Episode) =>
  airDateUtc && airdate && Math.abs(Date.parse(airDateUtc) - Date.parse(airdate)) >= 2 * DAY_MS
    ? airdate
    : airDateUtc || airdate || undefined

const normalizeMedia = (media: AnimeSeries) => {
  const id = media.mappings.anidb_id.toString()
  const uri = `${origin}:${id}`

  const { thetvdb_id: tvdbId, imdb_id: imdbId, themoviedb_id: tmdbId } = media.mappings
  const handles: (GQLMedia | GQLMediaHandle)[] = [
    media.mappings.mal_id ? makeMedia({
      origin: 'mal',
      id: String(media.mappings.mal_id),
      url: `https://myanimelist.net/anime/${media.mappings.mal_id}`,
    }) : undefined,
    media.mappings.anilist_id ? makeMedia({
      origin: 'anilist',
      id: String(media.mappings.anilist_id),
      url: `https://anilist.co/anime/${media.mappings.anilist_id}`,
    }) : undefined,
    // links, never identity: a community mapping, and the tv ids name the whole show rather than this run.
    // No TMDB link on a film: its `themoviedb_id` is often the series' (mal 5 has 30991, which is a
    // different film at /movie/30991), and nothing in the answer tells the two apart
    tmdbId && media.mappings.type !== 'MOVIE' ? tmdbLink(tmdbId, false) : undefined,
    tvdbId ? partOf(makeMedia({ origin: 'tvdb', id: String(tvdbId), url: `https://thetvdb.com/dereferrer/series/${tvdbId}` })) : undefined,
    imdbId ? partOf(makeMedia({ origin: 'imdb', id: imdbId, url: `https://www.imdb.com/title/${imdbId}` })) : undefined,
  ].filter((handle): handle is NonNullable<typeof handle> => Boolean(handle))

  return makeMedia({
    origin,
    id,
    categories: ['ANIME', media.mappings.type === 'MOVIE' ? 'MOVIE' : 'SERIES'],
    url: `https://api.ani.zip/mappings?anidb_id=${id}`,
    handles,
    titles: titlesOf(media.titles),
    covers: media.images
      ?.filter(image => image.coverType === 'Poster')
      .map(image => ({ url: image.url, score: SCORE }))
      ?? [],
    // TheTVDB's `Banner` is a 758x140 strip, which a 16:9 header blows up 5x and cuts to its middle
    // third; its `Fanart` is 1920x1080 (measured 2026-10-17)
    banners: media.images
      ?.filter(image => image.coverType === 'Fanart')
      .map(image => ({ url: image.url, score: SCORE }))
      ?? [],
    episodeCount: media.episodeCount,
    episodes:
      Object
        .entries(media.episodes)
        .map(([episodeId, episode]) => {
          const epId = `${id}-${episodeId}`
          const summary = episode.summary && dropCredit(apostrophes(episode.summary))
          return makeEpisode({
            origin,
            id: epId,
            mediaUri: uri,
            url: `https://api.ani.zip/mappings?anidb_id=${id}`,
            score: SCORE,
            titles: titlesOf(episode.title),
            descriptions: episode.overview
              ? [{ language: 'en', description: episode.overview, score: SCORE }]
              : [],
            shortDescriptions: summary
              ? [{ language: 'en', shortDescription: summary, score: SCORE }]
              : episode.overview
                ? [{ language: 'en', shortDescription: episode.overview, score: SCORE }]
                : [],
            thumbnails: episode.image ? [{ url: episode.image, score: SCORE }] : [],
            seasonNumber: episode.seasonNumber,
            /**
             * The KEY, not `episode.episodeNumber`, and the difference is a duplicated episode list.
             *
             * anizip numbers within the SEASON while its entry is one broadcast run, so a split cour
             * comes back numbered from where the previous cour stopped: anidb 18104 is Mushoku Tensei
             * season 2 part 2, whose twelve episodes are keyed 1 to 12 and carry `episodeNumber` 13 to
             * 24 (measured 2026-09-09). Every other source numbers that run 1 to 12, so nothing
             * matched, and the modal listed the same twelve episodes twice: kitsu's numbered 1 to 12
             * with no titles, then anizip's numbered 13 to 24 with all the titles and dates.
             *
             * The key is the position within THIS entry, which is the row this episode hangs off, so
             * it is the number that agrees with whatever else describes the same run. It is exact
             * rather than inferred: no offset is guessed at. A special is keyed `S1`, which is not a
             * number and stays unnumbered, exactly as it was.
             *
             * `absoluteEpisodeNumber` is untouched and still carries anizip's series-wide count, which
             * is the field that is supposed to be bigger than the run.
             */
            episodeNumber: /^\d+$/.test(episodeId) ? Number(episodeId) : episode.episodeNumber,
            absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
            runtime: episode.runtime ?? episode.length,
            releaseDate: airedAt(episode),
          })
        })
  })
}

const fetchAnizipJsonMappings = (providerId: 'anilist' | 'mal' | 'anidb', id: string, context: ExtractorServerContext) =>
  context.fetch(`https://api.ani.zip/mappings?${providerId}_id=${id}&specials=1`)
    .then(res => res.json() as Promise<AnimeSeries>)

const fetchAnizipMappings = (providerId: 'anilist' | 'mal' | 'anidb', id: string, context: ExtractorServerContext) =>
  fetchAnizipJsonMappings(providerId, id, context)
    // api.ani.zip answers unknown ids with a 200 "Not Found" string rather than an AnimeSeries
    .then(animeData => animeData?.mappings?.anidb_id != null ? normalizeMedia(animeData) : null)

const fetchMALMappings = (id: string, context: ExtractorServerContext) => fetchAnizipMappings('mal', id, context)

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      // always yield once: a subscription generator that completes without yielding makes yoga respond 204 No Content
      subscribe: async function*(_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !isAggregatedUri(uri)) return yield { media: null }
        const uris = fromAggregatedUri(uri)
        const malId = uris?.handleUrisValues.find(uri => uri.origin === 'mal')
        if (!malId) return yield { media: null }
        yield { media: await fetchMALMappings(malId.id, ctx) }
      }
    }
  }
}

interface EpisodeTitle {
  ja?: string
  en?: string
  fr?: string
  'x-jat'?: string
}

interface Episode {
  tvdbShowId: number
  tvdbId: number
  seasonNumber: number
  episodeNumber: number
  absoluteEpisodeNumber: number
  title: EpisodeTitle
  /**
   * Both ABSENT on a special, which is what makes the fallback below a real branch rather than the
   * dead one this interface used to claim. Measured live 2026-09-08 over ten ids from
   * `dist-seed/snapshots.jsonl`, 132 episodes: `airdate` on 132, `airDateUtc` on 94, neither on 0. On
   * anidb 16392 the twelve numbered episodes carry both and the eight specials carry `airdate` alone.
   *
   * The two shapes differ, so a reader gets one or the other: `airDateUtc` is an instant
   * (`2026-07-07T11:30:00Z`, seconds precision, always Z) and `airdate` names a day
   * (`2026-08-28`). See `src/utils/release-date.ts` for why the difference has to survive to the UI.
   */
  airDate?: string
  airDateUtc?: string
  runtime: number
  overview?: string
  image?: string
  episode: string
  anidbEid: number
  length: number
  airdate: string
  rating: string
  summary?: string
  finaleType?: 'season' | 'series'
}

interface Image {
  coverType: 'Banner' | 'Poster' | 'Fanart' | 'Clearlogo'
  url: string
}

interface Mappings {
  animeplanet_id: string
  kitsu_id: number
  mal_id: number
  type: 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL'
  anilist_id: number
  anisearch_id: number
  anidb_id: number
  notifymoe_id: string
  livechart_id: number
  thetvdb_id: number | null
  imdb_id: string | null
  themoviedb_id: string | null
}

interface AnimeSeries {
  titles: { [key: string]: string | undefined; en?: string; ja?: string }
  episodes: { [episodeNumber: string]: Episode }
  episodeCount: number
  specialCount: number
  images?: Image[]
  mappings: Mappings
}
