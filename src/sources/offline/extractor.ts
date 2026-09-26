import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

import { fromAggregatedUri, fromUri, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia } from '../utils'
import { animeSeasonOf } from '../season'
import { origin as sourceOrigin, SCORE, seasonKey, seasonPage, type ManamiRecord } from './normalize'
import {
  INDEXED_ORIGINS,
  catalogRefs,
  rowId,
  type CatalogRow,
} from './index-lookup'
import { loadCatalog } from './catalog'
import { loadSeedEpisodes, loadSeedIndex, seedMedia, seedRunFor, seedSeasonPage } from './seed-source'

// No icon, deliberately, and anizip is the precedent: it is the other source that exists to link
// records rather than to be visited, and it ships none either. A badge would imply the show lives on
// a site you can go to, for what is actually a table compiled at build time.
//
// But know what actually keeps this out of the UI, because it is NOT the missing icon.
// `media-modal.tsx:662` really does render the origin row as `if (!origin.icon) return undefined`,
// and that check is real, but it is unreachable from here: `isApiOnly` below is true, and all three
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
 * TWO HALVES, and only one of them touches the network.
 *
 * The BUNDLED half is the two generated modules below, compiled into the app and answered from
 * memory. It is the source that survives every other source failing at once, which is not
 * hypothetical: on 2026-08-16 the homepage rendered "Current season" with zero media because AniList
 * answered 403 and Jikan 504 at the same time, with the user's connection perfectly healthy. It is
 * still what every resolver here yields FIRST.
 *
 * The SEEDED half is ./seed-source.ts, a release asset walked from the live sources on a schedule and
 * fetched at runtime through the relay. It is a network request and it can fail. Every one of its
 * failure paths resolves to undefined and leaves the bundled answer exactly as it was: a timeout, a
 * 404 before the first publish, a body that is not gzip, a payload the gate refuses. Nothing here may
 * be written so that a bad seed makes the page worse than no seed.
 *
 * READ THE NAME CAREFULLY. "offline" describes the bundled DATA, an offline database in the sense its
 * upstream uses the word, compiled in rather than queried. It does NOT mean stub works offline. stub
 * has no service worker and no Cache Storage (grepped, with a control), so those bundles arrive over
 * the same network as every other chunk and are just as unavailable to a disconnected user, and the
 * seed asset is a plain fetch on top. What this survives is an UPSTREAM outage, which is the failure
 * that actually happened. If stub ever does gain a worker, this source becomes the offline catalogue
 * for real, but that is a separate piece of work and nothing here should be read as having done it.
 *
 * TWO bundles, loaded independently, because they are wanted at different moments. The homepage
 * needs seasons and never the index; opening one show needs the index and never the seasons. Split
 * this way a visitor who only browses the season row never fetches the 114 KB id table.
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
const handleCarrier = (row: CatalogRow): GQLMedia | undefined => {
  const id = rowId(row)
  if (!id) return undefined

  const handles: GQLMedia[] = []
  if (row.mal) handles.push(makeMedia({ origin: 'mal', id: String(row.mal), url: `https://myanimelist.net/anime/${row.mal}` }))
  if (row.anilist) handles.push(makeMedia({ origin: 'anilist', id: String(row.anilist), url: `https://anilist.co/anime/${row.anilist}` }))
  if (row.kitsu) handles.push(makeMedia({ origin: 'kitsu', id: String(row.kitsu), url: `https://kitsu.app/anime/${row.kitsu}` }))
  if (row.anidb) handles.push(makeMedia({ origin: 'anidb', id: String(row.anidb), url: `https://anidb.net/anime/${row.anidb}` }))

  // A single handle links nothing to anything, so the record would be an orphan node carrying no
  // information. Only rows that actually bridge two catalogues are worth returning.
  if (handles.length < 2) return undefined

  return makeMedia({ origin, id, handles, score: SCORE })
}

/**
 * The seasonal record for an id, which carries a title and a cover the index row does not.
 *
 * Walked as entries rather than values because the bucket key is the only statement of the record's
 * season anywhere in the bundle, and iterating the values throws it away.
 */
const seasonalById = async (id: string): Promise<GQLMedia | undefined> => {
  const data = await loadSeasons()
  for (const [key, records] of Object.entries(data.seasons)) {
    const media = seasonPage(records, key).find(candidate => candidate.id === id)
    if (media) return media
  }
  return undefined
}

/**
 * Whatever this source knows about a uri, richest first.
 *
 * The seasonal half and the index half deliberately use the same id scheme, so a show in the
 * current season resolves to one node supplied twice rather than two nodes needing a merge. The
 * seasonal record is preferred when both exist, because it carries a title and a cover.
 */
const getMedia = async (uri: string): Promise<GQLMedia | null> => {
  const uris = urisOf(uri)
  if (!uris.length) return null

  // The seasonal record wherever one exists, because it is the only half carrying a title and a
  // cover. This must NOT return when it misses: a uri naming this source is the COMMON case once it
  // has contributed once, so an early return here made the index unreachable in production and
  // answered null for every show outside the season window.
  const own = uris.find(candidate => candidate.origin === origin)
  if (own) {
    const seasonal = await seasonalById(own.id)
    if (seasonal) return seasonal
  }

  const refs = catalogRefs(uris, origin)
  if (!refs.length) return null

  const table = await loadCatalog()
  for (const ref of refs) {
    const row = table.lookup(ref.origin, ref.id)
    if (!row) continue
    const carrier = handleCarrier(row)
    if (!carrier) continue
    return (await seasonalById(carrier.id)) ?? carrier
  }
  return null
}

// Both resolvers yield the BUNDLED answer first and the seeded one second, and the order is the
// point: the seed exists to make a cold page fast, so it must never delay the first paint. Every
// early return below leaves the bundled yield standing.
export const resolvers: Resolvers = {
  Subscription: {
    media: {
      // Always yield at least once. A subscription generator that completes without yielding makes
      // yoga answer 204 No Content, which is not the same thing as "this source knows nothing".
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri) return yield { media: null }
        yield { media: await getMedia(uri) }

        const index = await loadSeedIndex(ctx.fetch)
        if (!index) return
        const run = seedRunFor(index, urisOf(uri))
        if (!run) return
        // asked for only once a seeded run is actually named, so browsing the season row never
        // fetches the episode file
        const episodes = await loadSeedEpisodes(ctx.fetch, index)
        yield { media: seedMedia(run, episodes?.episodes[run.key]) }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { status, season, seasonYear } }, ctx: ExtractorServerContext) {
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

        const index = await loadSeedIndex(ctx.fetch)
        if (!index) return
        // The seed carries exactly the current and the next season, so any other key answers empty
        // here and leaves the bundled yield standing. The next season's runs are carried so a media
        // ask naming one resolves instantly.
        const nodes = seedSeasonPage(index, key)
        if (nodes.length) yield { mediaPage: { nodes } }
      }
    }
  }
}
