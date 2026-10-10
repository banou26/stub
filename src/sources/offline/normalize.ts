// Turning a bundled offline-database record into a stub media, kept apart from the extractor so it can be
// tested. The extractor pulls in the generated data module, which only exists after `npm run
// data:build`, and through the source barrel it also reaches a CommonJS `require('react')` that
// cannot load outside a browser. Same reason src/sources/season.ts and kitsu/season-paging.ts are
// their own files.

import type { Media as GQLMedia } from '../../generated/schema/types.generated'

import { MediaType } from '../../generated/graphql'
import { makeMedia } from '../utils'
import { malLargeImage } from '../mal-image'
import { MEDIA_SEASONS, type MediaSeasonName } from '../season'

export const origin = 'offline'

/**
 * Low on purpose, and below kitsu's 0.3.
 *
 * The media-level score decides which source wins `status`, `startDate`, `episodeCount`, `type` and
 * `averageScore`. This data is a static dump that can be weeks old, so on every one of those fields
 * it is by construction staler than a live API and should lose. Nothing is given up by being low:
 * the aggregate falls through with `??`, so a low-scored source still supplies any field no other
 * source has.
 *
 * The same value is used for the per-item title and cover scores, and that part matters more than
 * it looks. Titles at 0.9 would tie with anilist, jikan and anizip and push this dump's titles into
 * the six-slot profile the fuzzy merge compares clusters on, changing which titles every merge
 * decision sees. That is the exact mechanism behind the digit-residue regression that once welded
 * 68 unrelated shows into one component.
 */
export const SCORE = 0.2

const COVER_PREFIX = 'https://cdn.myanimelist.net/images/anime/'

/**
 * The cover url for a manami record, which is NOT always a MyAnimeList one.
 *
 * The bundle strips `COVER_PREFIX` to save about 42 bytes a row, and that is worth doing, but manami
 * takes each entry's picture from whichever source supplied it. Nine hosts appear in practice, so the
 * strip is a no-op on those rows and they stay absolute. Re-adding the prefix to one of them builds
 * `cdn.myanimelist.net/images/anime/https://media.kitsu.app/...`, which resolves nowhere.
 *
 * Measured 2026-09-01 against the shipped bundle: 380 of 874 season rows, 43%, carry an absolute url,
 * and 326 of those serve a real image once asked for the url they actually name. The rest fail
 * honestly: anime-planet declines a hotlink (0 of 3 rendered on an anime.fkn.app page, 2026-10-10),
 * and the livechart failures read in detail answered HTTP 500 to any referer (2026-10-09), while
 * LiveChart's current posters rendered 12 of 12 there.
 */
const coverUrl = (picture: string) =>
  malLargeImage(picture.startsWith('http') ? picture : `${COVER_PREFIX}${picture}`)

export type ManamiRecord = {
  t: string
  ty: string
  p: string
  ep?: number
  ml?: number
  al?: number
  ku?: number
  sc?: number
  /** MyAnimeList's member count for the current season, attached at build time; see scripts/season-order.mjs */
  pop?: number
  /** MyAnimeList's synopsis, current season only: what the homepage hero selects on */
  sy?: string
  /** a youtube id for the hero's trailer, current season only */
  tr?: string
  /** that trailer's thumbnail */
  th?: string
  // No genres and no tags: the measurement that keeps them out of the bundle is in `seasonMedia`.
}

/** `2026-SUMMER`, the key the generated bundle is keyed on. `animeSeasonOf` answers in lower case. */
export const seasonKey = ({ season, year }: { season: string, year: number }) =>
  `${year}-${season.toUpperCase()}`

const SEASON_KEY = /^(\d{4})-([A-Z]+)$/

/**
 * The inverse of `seasonKey`: the season and year a bundle key names, or nothing when it names none.
 *
 * TOTAL on purpose. The keys reach here off a generated module and, through the page resolver, off a
 * caller's input, so a string neither of those promises has to leave a row without a season rather
 * than take a page down. `MEDIA_SEASONS` is the validator so the four names stay spelled in one
 * place, which is the whole reason sources/season.ts exists.
 */
export const parseSeasonKey = (key: string): { season: MediaSeasonName, year: number } | undefined => {
  const match = SEASON_KEY.exec(key)
  const season = MEDIA_SEASONS.find(candidate => candidate === match?.[2])
  return match && season ? { season, year: Number(match[1]) } : undefined
}

const TYPES: Record<string, MediaType> = {
  TV: MediaType.Tv,
  MOVIE: MediaType.Movie,
  OVA: MediaType.Ova,
  ONA: MediaType.Ona,
  SPECIAL: MediaType.Special,
}

/**
 * A stable identity for a record that has no id of its own.
 *
 * manami is an aggregate over other catalogs and issues no id, so identity is borrowed from the
 * catalog ids it carries, in a fixed order so the same show keeps the same uri across builds. A
 * record carrying none is not rendered at all (see `seasonMedia`), which is why there is no
 * title-derived fallback here: a title is not an identity, and inventing one would produce a uri
 * that silently changes the day upstream fixes a typo.
 */
export const recordId = (record: ManamiRecord): string | undefined =>
  record.ml ? `mal-${record.ml}`
  : record.al ? `anilist-${record.al}`
  : record.ku ? `kitsu-${record.ku}`
  : undefined

const handles = (record: ManamiRecord): GQLMedia[] => {
  const list: GQLMedia[] = []
  if (record.ml) list.push(makeMedia({ origin: 'mal', id: String(record.ml), url: `https://myanimelist.net/anime/${record.ml}` }))
  if (record.al) list.push(makeMedia({ origin: 'anilist', id: String(record.al), url: `https://anilist.co/anime/${record.al}` }))
  if (record.ku) list.push(makeMedia({ origin: 'kitsu', id: String(record.ku), url: `https://kitsu.app/anime/${record.ku}` }))
  return list
}

/**
 * One record as a stub media, or nothing when it carries no catalog id.
 *
 * Dropping the id-less ones is the whole duplicate-control story. A record with no id cannot union
 * with anything, so if another source already describes that show the user sees the same title
 * twice with no way for the store to know. For SUMMER 2026 that is 79 of 219 records, and the ones
 * lost are overwhelmingly the obscure shorts and promos the other sources do not carry either.
 *
 * Deliberately absent: `status`, `startDate` and `endDate`. Its `status` is a snapshot taken when the
 * dump was cut which decays immediately
 * (the 2026-07-04 dump calls 192 of its 219 SUMMER 2026 entries UPCOMING, and every one was airing
 * six weeks later).
 *
 * `popularity` IS published now, and manami still has none: it is MyAnimeList's member count, fetched
 * per season at build time (scripts/build-anime-data.mjs). Without it the listing, which sorts on
 * popularity, swept every bundled row to the tail and painted whatever order the bundle happened to
 * ship in. It is safe at this score because jikan publishes the same count at 0.9 and wins the
 * aggregate, so the value is restated rather than contradicted. A row the fetch did not cover carries
 * none, which sorts it behind the covered ones.
 *
 * `season` and `seasonYear` come from the BUCKET KEY, which is the only place the bundle states them:
 * the records themselves carry no season, so a caller that has lost the key gets null for both rather
 * than a guess. Deriving them from a start date is refused schema-wide for the reason `MediaSeason`
 * records, and this source publishes no date to derive from anyway.
 *
 * `genres` and `tags` are absent for a different reason again, a size one rather than a staleness
 * one. manami does carry tags (mean 10.2 a record, 981 distinct strings over the 874 window records),
 * and adding them verbatim takes the generated payload from 121,935 to 247,301 raw bytes and 29,628
 * to 48,538 brotli bytes, a 64% increase over the wire, for a field anilist and jikan both answer
 * live. Interning them into a string table saves 75 KB raw and only 1.7 KB brotli, so it does not
 * change the answer. `makeMedia` leaves both as [], and the store's filter is strict, so a genre or
 * tag filter drops these rows instead of reading a claim they cannot back.
 */
export const seasonMedia = (record: ManamiRecord, key?: string): GQLMedia | undefined => {
  const id = recordId(record)
  if (!id) return undefined

  const type = TYPES[record.ty]
  const season = key ? parseSeasonKey(key) : undefined
  return makeMedia({
    origin,
    id,
    handles: handles(record),
    score: SCORE,
    season: season?.season ?? null,
    seasonYear: season?.year ?? null,
    categories: type === MediaType.Movie ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES'],
    type,
    titles: [{ language: 'en', title: record.t, score: SCORE }],
    covers: record.p ? [{ url: coverUrl(record.p), score: SCORE }] : [],
    episodeCount: record.ep || undefined,
    popularity: record.pop || undefined,
    // The hero keeps only media carrying titles AND shortDescriptions (utils/theater.ts), and manami
    // has no synopsis, so the homepage rendered an empty hero until a live source answered. Both this
    // and the trailer ride the same build-time jikan call as the member counts, current season only.
    ...record.sy
      ? {
        descriptions: [{ language: 'en', description: record.sy, score: SCORE }],
        shortDescriptions: [{ language: 'en', shortDescription: record.sy, score: SCORE }],
      }
      : {},
    trailers: record.tr
      ? [{
        uri: `yt:${record.tr}`,
        origin: 'yt',
        id: record.tr,
        url: `https://www.youtube.com/watch?v=${record.tr}`,
        language: 'en',
        ...record.th ? { thumbnail: record.th } : {},
      }]
      : [],
    // manami scores on 1 to 10, the schema's averageScore is 0 to 100.
    averageScore: record.sc ? Math.round(record.sc * 10) : undefined,
  })
}

/** One bucket as rows. `key` is the bucket's own, and is what stamps each row's season. */
export const seasonPage = (records: readonly ManamiRecord[], key?: string): GQLMedia[] =>
  records.map(record => seasonMedia(record, key)).filter((media): media is GQLMedia => Boolean(media))
