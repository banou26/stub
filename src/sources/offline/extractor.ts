import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

import { fromAggregatedUri, fromUri, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia } from '../utils'
import { MEDIA_SEASONS, animeSeasonOf } from '../season'
import { origin as sourceOrigin, SCORE, parseSeasonKey, recordId, seasonKey, seasonPage, type ManamiRecord } from './normalize'
import {
  INDEXED_ORIGINS,
  catalogRefs,
  rowId,
  type CatalogRow,
} from './index-lookup'
import { loadCatalog } from './catalog'
import { historyEntry, historyMedia, type ShardLoader } from './history'

// No icon, deliberately, and anizip is the precedent: it is the other source that exists to link
// records rather than to be visited, and it ships none either. A badge would imply the show lives on
// a site you can go to, for what is actually a table compiled at build time.
//
// But know what actually keeps this out of the UI, because it is NOT the missing icon.
// `SourceLinks` in `src/router/home/media-details.tsx` really does render the origin row as
// `if (!origin.icon) return undefined`, and that check is real, but it is unreachable from here:
// `isApiOnly` below is true, and all three
// `originPage` consumers pass `OriginFilter.IsNotApiOnly`, which `db.ts:144-146` resolves to keeping
// only `!isApiOnly`. Kitsu is `isApiOnly = true` too, so it is absent from that row as well. So the
// icon is dead weight rather than a hazard, and nobody should later treat its absence as the guard.
//
// `metadataOnly` gates nothing at all, for anybody: `normalizeOrigin` drops it, it is not in the
// GraphQL schema, and the one value read of it feeds a field nothing consumes.
//
// `originUrl` is never rendered anywhere, so it carries no weight in the UI. It names the database
// that supplies the seasonal listings, which is the visible half. It is NOT the attribution: this
// source merges TWO upstreams with different licenses, manami under ODbL and @kawaiioverflow/arm
// under MIT, and one string cannot credit both. Both are named in the header of every generated
// artifact, in its `sources` field, which is the attribution of record.
export const originUrl = 'https://github.com/manami-project/anime-offline-database'
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'Offline database'
export const origin = sourceOrigin
export const official = false
export const metadataOnly = true
export const isApiOnly = true
// Answers about other catalogues' uris, not only its own, which is the anizip pattern. Note this
// export is declarative only: nothing in the worker reads it, so what actually decides is the
// resolver below.
export const supportedUris = ['offline', ...INDEXED_ORIGINS]
export const color = '#2b6cb0'

type SeasonBundle = { tag: string, updated: string, seasons: Record<string, ManamiRecord[]> }

/**
 * Answered from the two generated modules below and the history's shards (./history.ts), compiled
 * into the app and read from memory, with no request of its own. It is the source that survives
 * every other source failing at once, which is not hypothetical: on 2026-08-16 the homepage
 * rendered "Current season" with zero media because AniList answered 403 and Jikan 504 at the same
 * time, with the user's connection perfectly healthy.
 *
 * READ THE NAME CAREFULLY. "offline" describes the bundled DATA, an offline database in the sense its
 * upstream uses the word, compiled in rather than queried. It does NOT mean stub works offline. stub
 * has no service worker and no Cache Storage (grepped, with a control), so those bundles arrive over
 * the same network as every other chunk and are just as unavailable to a disconnected user. What this
 * survives is an UPSTREAM outage, which is the failure that actually happened. If stub ever does gain
 * a worker, this source becomes the offline catalogue for real, but that is a separate piece of work
 * and nothing here should be read as having done it.
 *
 * TWO bundles, loaded independently, because they are wanted at different moments. The homepage
 * needs seasons and never the index; opening one show needs the index and never the seasons. Split
 * this way a visitor who only browses the season row never fetches the 146 KB id table.
 */
let seasons: Promise<SeasonBundle> | undefined

/**
 * Loaded through a dynamic import, and memoized. The id table is ./catalog.ts, loaded the same way and
 * shared with the stub tracker.
 *
 * The import has to sit somewhere genuinely reachable. Exporting a loader that nothing calls gets
 * the chunk tree-shaken away by rolldown, silently, leaving a source that always answers empty.
 * Keeping the call inside a resolver path is what makes it reachable.
 *
 * A failure resolves to an empty bundle rather than rejecting. This is the fallback source, so it
 * is the one thing that must not be able to make the page worse by failing.
 */
const loadSeasons = (): Promise<SeasonBundle> =>
  (seasons ??= import('../../generated/anime-seasons')
    .then(module => module.default as SeasonBundle)
    .catch(error => {
      console.error('offline: the bundled season data could not be loaded', error)
      return { tag: 'unavailable', updated: '', seasons: {} }
    }))

/**
 * One season's rows, read from the bundle rather than requested, and NOTHING when it holds no such
 * bucket.
 *
 * The window is six buckets anchored on the dump's cut date (anchor quarter minus 1, plus 4), so a
 * season outside it is not late data, it is data this build will never have: there is no history
 * behind the anchor. Answering a different season instead would be worse than answering nothing. The
 * store's filter is strict on season so those rows are dropped anyway, the upstream call is wasted,
 * and on any axis that filter cannot see the wrong season leaks onto the page.
 *
 * Deliberately not keyed on manami's own `status`, which is a snapshot from the cut date and decays
 * within weeks of being written.
 */
const bundledSeason = async (key: string): Promise<GQLMedia[]> => {
  const data = await loadSeasons()
  const records = data.seasons[key]
  if (!records) {
    console.warn(`offline: no bundled data for ${key}; the dump (${data.tag}) holds ${Object.keys(data.seasons).join(', ') || 'nothing'}`)
    return []
  }
  return seasonPage(records, key)
}

/** Every (origin, id) pair named by a uri, whether it is a single uri or an aggregated one. */
const urisOf = (uri: string): { origin: string, id: string }[] => {
  if (isAggregatedUri(uri)) return fromAggregatedUri(uri)?.handleUrisValues ?? []
  if (isUri(uri)) {
    const parsed = fromUri(uri)
    return parsed ? [parsed] : []
  }
  return []
}

/**
 * A media that renders nothing and exists only to be merged.
 *
 * This is the whole point of shipping the index. The record carries no title, no cover and no
 * description, so it cannot win a field in `aggregateMedia` and cannot show up as a card. What it
 * does carry is one handle per catalogue, and `db.ts` turns every handle into a
 * `graph.link(mediaUri, handleUri, MEDIA_SAME_AS)`. So a record that knows only a MyAnimeList id
 * and one that knows only an AniList id land in the same union-find component through this, instead
 * of being guessed at by comparing their titles.
 *
 * Same shape as anizip, which also answers about other catalogues' uris, with even less payload.
 *
 * No categories are claimed either. A format claim would be a second assertion this row has no
 * evidence for, and `aggregateMedia` enforces one format per media, so the safe thing to say is
 * nothing.
 */
const rowHandles = (row: CatalogRow): GQLMedia[] => {
  const handles: GQLMedia[] = []
  if (row.mal) handles.push(makeMedia({ origin: 'mal', id: String(row.mal), url: `https://myanimelist.net/anime/${row.mal}` }))
  if (row.anilist) handles.push(makeMedia({ origin: 'anilist', id: String(row.anilist), url: `https://anilist.co/anime/${row.anilist}` }))
  if (row.kitsu) handles.push(makeMedia({ origin: 'kitsu', id: String(row.kitsu), url: `https://kitsu.app/anime/${row.kitsu}` }))
  if (row.anidb) handles.push(makeMedia({ origin: 'anidb', id: String(row.anidb), url: `https://anidb.net/anime/${row.anidb}` }))
  if (row.ann) handles.push(makeMedia({ origin: 'ann', id: String(row.ann), url: `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${row.ann}` }))
  return handles
}

const handleCarrier = (row: CatalogRow): GQLMedia | undefined => {
  const id = rowId(row)
  if (!id) return undefined

  const handles = rowHandles(row)
  // A single handle links nothing to anything, so the record would be an orphan node carrying no
  // information. Only rows that actually bridge two catalogues are worth returning.
  if (handles.length < 2) return undefined

  return makeMedia({ origin, id, handles, score: SCORE })
}

const calendarIndex = (key: string) => {
  const season = parseSeasonKey(key)
  return season ? season.year * 4 + MEDIA_SEASONS.indexOf(season.season) : -1
}

/**
 * The seasonal record for an id, which carries a title and a cover the index row does not.
 *
 * A work bundled in several seasons takes the earliest one not yet over, else the latest, so the
 * current season keeps it and its season only moves forward with the clock. The bucket key is the
 * only statement of a record's season, and the bundle lists its keys in the dump's order, not the
 * calendar's.
 */
const seasonalById = async (id: string): Promise<GQLMedia | undefined> => {
  const { seasons } = await loadSeasons()
  const now = calendarIndex(seasonKey(animeSeasonOf()))
  const keys = Object.keys(seasons)
    .filter(key => seasons[key]!.some(record => recordId(record) === id))
    .sort((a, b) => calendarIndex(a) - calendarIndex(b))
  const key = keys.find(candidate => calendarIndex(candidate) >= now) ?? keys.at(-1)
  return key ? seasonPage(seasons[key]!, key).find(candidate => candidate.id === id) : undefined
}

const KEYED: readonly string[] = ['mal', 'anilist', 'kitsu']

/** The keys a history record could be filed under for these catalogue ids, in their order. */
const keysOf = (refs: readonly { origin: string, id: number }[]) =>
  refs.filter(({ origin, id }) => id && KEYED.includes(origin)).map(({ origin, id }) => `${origin}-${id}`)

/**
 * The history's record for the first of `keys` it holds, with the record's own catalogue id as its one handle:
 * the history pairs no ids, so only the index row's handles may join it to anything else.
 */
const fromHistory = async (keys: readonly string[]): Promise<GQLMedia | undefined> => {
  // Imported here, so its map of 256 shard chunks stays out of the worker every page starts. A failure answers
  // nothing, as a shard's does.
  const load: ShardLoader = await import('./history-shards').then(module => module.loadShard, error => {
    console.error('offline: the history could not be loaded', error)
    return async () => undefined
  })
  for (const key of keys) {
    const entry = await historyEntry(key, load)
    if (!entry) continue
    const [catalogue, id] = entry.key.split('-')
    return historyMedia(entry, rowHandles({ mal: 0, anilist: 0, kitsu: 0, anidb: 0, [catalogue!]: Number(id) }))
  }
  return undefined
}

/**
 * Whatever this source knows about a uri, richest first.
 *
 * The seasonal half and the index half deliberately use the same id scheme, so a show in the
 * current season resolves to one node supplied twice rather than two nodes needing a merge. The
 * seasonal record is preferred when both exist, because it carries a title and a cover, and it takes
 * the index row's handles, because only the row carries AniDB's and Anime News Network's ids. A show
 * outside the bundled seasons answers its history record (./history.ts), with the row's handles too.
 */
export const getMedia = async (uri: string): Promise<GQLMedia | null> => {
  const uris = urisOf(uri)
  if (!uris.length) return null

  // The seasonal record wherever one exists, because it is the only half carrying a title and a
  // cover. This must NOT return when it misses: a uri naming this source is the COMMON case once it
  // has contributed once, so an early return here made the index unreachable in production and
  // answered null for every show outside the season window. Its row is looked up by its own id
  // alone, so another id in a mixed address never lends it a second show's handles.
  const own = uris.find(candidate => candidate.origin === origin)
  const seasonal = own && await seasonalById(own.id)
  const refs = catalogRefs(seasonal ? [own] : uris, origin)
  if (!refs.length) return seasonal ?? null

  const table = await loadCatalog()
  for (const ref of refs) {
    const row = table.lookup(ref.origin, ref.id)
    if (!row) continue
    const carrier = handleCarrier(row)
    if (!carrier) continue
    const media = seasonal ?? await seasonalById(carrier.id) ?? await fromHistory(keysOf([{ origin: 'mal', id: row.mal }, { origin: 'anilist', id: row.anilist }, { origin: 'kitsu', id: row.kitsu }]))
    return media ? { ...media, handles: carrier.handles } : carrier
  }
  return seasonal ?? await fromHistory(keysOf(refs)) ?? null
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      // Always yield at least once. A subscription generator that completes without yielding makes
      // yoga answer 204 No Content, which is not the same thing as "this source knows nothing".
      subscribe: async function* (_, { input: { uri } }) {
        if (!uri) return yield { media: null }
        yield { media: await getMedia(uri) }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { status, season, seasonYear } }) {
        // BOTH halves or no key: a season with no year names four buckets of the window and a year
        // with no season names six, and picking one of them would be the substitution this refuses.
        const asked = season && seasonYear ? seasonKey({ season, year: seasonYear }) : undefined

        // Search is deliberately unanswered. The seasonal bundle holds only a window of recent
        // seasons, so it would return a handful of hits for a query the live sources answer
        // properly, and every hit carries no synopsis. A partial catalogue is worse than none in a
        // ranked result set.
        //
        // A named season is answered whatever the status, because a bucket is a listing of a season
        // and not of a moment, and manami's status is the field this source refuses to publish. A
        // season named that no key can be built for answers nothing, never the clock's.
        //
        // BOTH halves of the pair gate this, not just `season`. A year alone with status RELEASING
        // used to fall through to the clock: asking for 2024 answered the 2026 bucket, which the
        // store's filter then dropped, so the substitution was invisible rather than absent.
        if (!asked && (season || seasonYear || status !== 'RELEASING')) return yield { mediaPage: { nodes: [] } }

        const key = asked ?? seasonKey(animeSeasonOf())
        yield { mediaPage: { nodes: await bundledSeason(key) } }
      }
    }
  }
}
