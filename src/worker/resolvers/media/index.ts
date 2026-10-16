import type { ExtractorServerContext } from '../../extractor'
import type { Media, MediaPage, MediaPageResolvers, Resolvers, SubscriptionResolver, SubscriptionResolvers } from '../../../generated/schema/types.generated'

// @ts-expect-error
import _schema from './schema.gql?raw'
import { implementsSimilarMedia, proxyRequestToExtractors, similarOutcomeFrom } from '../../extractor'
import { resolveSimilarRuns } from '../../similar-consumer'
import { findAggregatedMedia, findAllAggregatedMedia, findAggregatedEpisodesForMedia, findMediaForPage, findRunEpisodes, hideAttachedContainers } from '../../store/db'
import { applyMediaSorts, isListing, pageRows, siteMedia, thinLast } from '../../store/filter'
import { fuzzyMergeMediaClusters } from '../../store/fuzzy-merge'
import { aggregateMedia, aggregateEpisode, sameAsHandleUris } from '../../store/aggregate'
import { askAddressOf, createMediaReader, createPageReader, episodesOf, passSettled, readStore } from '../../graph'
import { listen, listenIterator, listenMultipleIterator, debouncedListenIterator } from '../../store/events'
import { createSettling } from '../../fanout'
import { parseHTMLDescription, parseTextDescription } from '../utils'
import { SEARCH_RELEVANCE_THRESHOLD, searchRelevance } from '../../../sources/utils'
import { MediaDescriptionContentType } from '../../../generated/graphql'
import { decodeRouteUri, isAggregatedUri, isUri, originsOfUri } from '../../../utils/uri'

export const schema = _schema as string

// the app's own asks of `similarMedia`, budgeted under one caller like any source's
const askSimilar = similarOutcomeFrom('app')

export const resolvers = {
  Query: {},
  Mutation: {},
  Subscription: {
    media: {
      resolve: (parent: Media) => parent,
      subscribe: async function* (_parent, args, ctx: ExtractorServerContext) {
        const requestedUri = decodeRouteUri(args.input.uri ?? undefined)
        if (!requestedUri || !(isUri(requestedUri) || isAggregatedUri(requestedUri))) {
          // a refused page and a slow one are indistinguishable from outside the worker without this
          console.warn(`media: refused '${args.input.uri}', which names no uri`)
          return
        }
        // THE READ STORE IS READ ONCE, at subscribe time: a flag that moved mid subscription would
        // give one generator two shapes of wake, and the flag only ever moves at boot.
        const reader = readStore() === 'graph' ? createMediaReader(requestedUri) : undefined
        const iterator: AsyncIterableIterator<unknown> & { wake: () => void } =
          reader
            // 6.6: one event, named, so the wake test below can refuse the ones that are not ours
            ? listenIterator('view:changed', { abortSignal: ctx.request.signal })
            : listenMultipleIterator(['media:changed', 'episode:changed'], { abortSignal: ctx.request.signal })
        // Every source asked about this media, re-asks and the similar asks made on its behalf included,
        // and a read once the last of them has settled, which is what `settled` reports. What a READ
        // starts is never counted itself, only the asks it leads to: a read that counted its own work
        // would wake the next read as that work settled, and the page would never stop reading.
        const settling = createSettling(() => iterator.wake())
        const { subscriptions, close, askOrigins, root } = proxyRequestToExtractors(ctx, 'MEDIA', undefined, settling)

        /**
         * The uri the sources were asked about is the one the caller had at subscribe time, and a card
         * on the home page links to a narrow one: the listing builds its media without running the
         * mappers that mint a `cr:` handle (sources/anilist/extractor.ts:320 against :295). A source
         * can only recognise itself by finding its own handle in the uri it is handed, so every source
         * missing from that narrow uri answered "not mine" and ENDED, milliseconds before another
         * source contributed its id.
         *
         * So track which origins have been asked with a uri that actually named them, and re-ask the
         * ones that only just became addressable. Asking the newly named origins rather than re-running
         * the whole fan-out matters: nothing caches this path (@envelop/response-cache hooks onExecute
         * and skips subscriptions), so a blanket re-fan would re-hit every upstream on every merge.
         *
         * Terminates: an origin enters the set once and never leaves, and the cluster only ever gains
         * members (union-find unions, it never splits), so each source is asked at most twice.
         */
        const askedOrigins = new Set(originsOfUri(requestedUri))
        const askUnasked = (mediaUri: string) => {
          const unasked = originsOfUri(mediaUri).filter(origin => !askedOrigins.has(origin))
          if (!unasked.length) return
          for (const origin of unasked) askedOrigins.add(origin)
          const variables = ctx.params.variables as { input?: Record<string, unknown> } | undefined
          askOrigins(unasked, { ...variables, input: { ...variables?.input, uri: mediaUri } })
        }

        /**
         * 7.1 step 3, and the GRAPH PATH ONLY: the cluster's placeholders and `address` pointers are
         * re-asked beside its members.
         *
         * A placeholder is a uri a member's claim named that no source has described, so it is not a
         * member and it is in neither `media.uri` nor `handles`. Walking those alone therefore asks
         * nobody about it, its row never arrives, and it never becomes a member: measured 2026-09-12
         * on `ag:(anilist:108465)`, where `kitsu:42323` was answered ONCE on the old store and 0
         * TIMES here, so the page drew four members against the old store's six. The old store had no
         * such gap for the wrong reason: its union-find made every uri a claim named a member, so the
         * aggregated uri carried them whether or not anything had described them.
         *
         * The uri handed over names the MEMBERS AND THE PLACEHOLDERS, because a source recognises
         * itself by finding its own handle in the uri it is asked with: handing over the placeholders
         * alone would ask jikan about `mal:39535` and leave a source addressable by two origins with
         * only one of them. `askUnasked` still keys on origins, so an origin enters the asked set
         * once and never leaves, which is what makes the loop terminate.
         */
        const askPlaceholders = async (clusterId: string, mediaUri: string) => {
          const address = await askAddressOf(clusterId, mediaUri).catch(error => {
            // an ask that failed must not take the page down: the row it would have fetched is
            // missing, which is the state the read already renders
            console.error(new Error('media: the placeholder ask failed', { cause: error }))
            return ''
          })
          if (address) askUnasked(address)
        }

        // a MEDIA root by construction: only this resolver runs it, so a listing never asks. The
        // consumer still reads the OLD store's cluster, which is what spec step 4 rewires; skipping
        // it here would take the `containing` asks the fold depends on down for a whole step.
        // Resolves once its asks are made, not answered: the consumer makes them all in one pass
        // (`drive` calls `deps.ask` before its first await), so the first is the last to wait for.
        const askSimilarRuns = (cluster: Awaited<ReturnType<typeof findMediaForPage>>) =>
          new Promise<void>(asked => {
            if (!cluster.length) return asked()
            const ask: typeof askSimilar = (origin, input) => {
              asked()
              return settling.track(askSimilar(origin, input))
            }
            void resolveSimilarRuns(cluster, root, { ask, implemented: implementsSimilarMedia }).then(() => asked())
          })

        /** The media, and `asking`, which resolves once the asks the read leads to have been made. */
        const read = async () => {
          if (reader) {
            // 6.2 resolves and then looks up: membership before publication, the container's
            // `preferredRun` followed, and nothing hidden, because the hide rule is a listing rule.
            const media = await reader.read()
            if (!media) return undefined
            askUnasked(String(media.uri))
            const asking = Promise.all([
              // the placeholders of the cluster this read landed on, which is the one the page draws:
              // `resolveMedia` follows a container's `preferredRun`, so `_id` is not always the uri's
              askPlaceholders(String(media._id ?? ''), String(media.uri)),
              findMediaForPage(requestedUri).then(askSimilarRuns, error => {
                console.error(new Error('media: the similar asks failed', { cause: error }))
              }),
            ])
            return { media: siteMedia(media as unknown as Media), asking }
          }
          // A show whose run is in the store is shown as that run: see `preferAttachedRun` in
          // store/db.ts, where the choice lives so it can be pinned (this module reaches urql and
          // cannot load under vitest).
          const cluster = await findMediaForPage(requestedUri)
          if (!cluster.length) return undefined
          const media = aggregateMedia(cluster, location.origin)
          askUnasked(media.uri)
          return { media: siteMedia(media), asking: askSimilarRuns(cluster) }
        }

        const answer = async () => {
          // on the graph path the last answers' rows are a pass away from the read
          if (reader && settling.settled()) await passSettled()
          const found = await read()
          if (!found?.media) return undefined
          // after the read, which may have asked a source the cluster has only just named, and with nothing
          // out, after the asks it makes past awaits of its own, or the page hears settled as one starts
          if (settling.settled()) await found.asking
          return { ...found.media, settled: settling.settled() }
        }

        try {
          const first = await answer()
          if (first) yield first

          for await (const detail of iterator) {
            // An empty cluster yields nothing and WAITS, on its requested uris until one resolves and
            // on its cluster id after that. Every other cluster's event is refused here rather than
            // costing a read that answers the same row. No detail is the sources settling.
            if (reader && detail && !reader.wakes(detail as { clusters: string[], uris: string[] })) continue
            const next = await answer()
            if (next) yield next
          }
        } finally {
          settling.close()
          close()
          await Promise.allSettled(subscriptions.map(subscription => subscription.unsubscribe()))
        }
      }
    },
    mediaPage: {
      resolve: (parent: Media[]) => ({ nodes: parent }),
      subscribe: async function* (_parent, args, ctx: ExtractorServerContext) {
        const page = readStore() === 'graph' ? createPageReader() : undefined
        // THE DEBOUNCE STAYS AT 100 ms and the NAMES are collected beside it, because the debounced
        // iterator coalesces events into one wake and drops their payloads with them. A page must
        // re-read every cluster named since its last read, not the clusters of the last event.
        const named = new Set<string>()
        const unlisten = page
          ? listen('view:changed', detail => { for (const id of detail.clusters) named.add(id) })
          : undefined
        const iterator = debouncedListenIterator([page ? 'view:changed' : 'media:changed'], 100, { abortSignal: ctx.request.signal })
        const listing = isListing(args.input)
        const { subscriptions, insertedUris, close } =
          proxyRequestToExtractors(
            ctx,
            'MEDIA_PAGE',
            (result: { data: { mediaPage: MediaPage } }) => {
              const uris = result?.data?.mediaPage?.nodes?.map(({ uri }) => uri)
              // an answer the store already holds changes nothing and so fires no event, and a
              // listing, which only ever draws what was answered, would never draw it
              if (listing && uris?.length) iterator.wake()
              return uris
            }
          )

        // How many uris the last SEED read. The seed of 6.1 is a function of `insertedUris`, so a
        // grown fan-out is a new seed rather than an increment: an incremental re-read only ever
        // names clusters that moved, and a uri answered late names a cluster that did not.
        let seeded = -1

        /**
         * Everything decidable from an aggregated row or a card, in one pinned place and VERBATIM on
         * both stores: the graph's page is the same three functions over the same fields, which is
         * what makes the two paths comparable at all.
         */
        const sortPage = async (rows: Media[], uris: string[]) => {
          // It runs AFTER the hide, which on the graph path is store-wide and written into the
          // cluster: dropping a run before the hide leaves its container behind as an orphan card.
          let aggregated = pageRows(rows, args.input, uris)

          const search = args.input.search
          if (search) {
            const scored = await Promise.all(
              aggregated.map(async media => ({
                media,
                score: await searchRelevance(search, (media.titles ?? []).map(title => title.title))
              }))
            )
            aggregated = thinLast(
              scored
                .filter(entry => entry.score >= SEARCH_RELEVANCE_THRESHOLD)
                .sort((a, b) => b.score - a.score || (b.media.popularity ?? 0) - (a.media.popularity ?? 0))
                .map(entry => entry.media)
            )
          }

          // `POPULARITY` is ascending and `POPULARITY_DESC` descending, the reading the `_DESC` suffix
          // carries everywhere else, this app's own AniList calls included. Both members pointed the
          // other way until 2026-09-12. The home row and the search page ask for `POPULARITY_DESC` and
          // render the list in the order given, so this is what puts the most popular card first.
          return applyMediaSorts(aggregated, args.input.sorts)
        }

        const getPage = async () => {
          const uris = [...insertedUris]
          if (listing && !uris.length) {
            named.clear()
            return []
          }
          if (page) {
            const ids = [...named]
            named.clear()
            const cards = uris.length === seeded ? await page.apply(ids, uris) : await page.read(uris)
            seeded = uris.length
            return sortPage(cards as unknown as Media[], uris)
          }
          // THE WHOLE-STORE FALLBACK IS LOAD BEARING, and it does not look it.
          //
          // `insertedUris` is empty until a source answers, so this is the first yield's only content.
          // Refusing it and answering [] instead is the obvious way to keep a filtered page from
          // opening on the previous page's results, and it BREAKS the page outright: this generator
          // only re-runs on `media:changed`, and a second subscription over a warm store changes
          // nothing, because `graph.set` is idempotent (tests/unit/worker/store/edge-idempotence.test.ts).
          // So no event ever fires and the page stays empty. Measured 2026-09-06 on the search page:
          // picking a format on a loaded season sat at 0 cards for 60 seconds, where the same url
          // opened cold answered 24.
          //
          // What keeps the fallback honest is `applyMediaFilters` below, which runs on it like any
          // other page: a stale row from an earlier query only survives if it genuinely matches the
          // season, format, genres and tags now being asked for. A listing is the one page that answers
          // [] instead, since no filter can tell its rows from the store's, and it is woken by its own
          // sources' answers rather than by a store change.
          let clusters = await findAllAggregatedMedia(uris.length ? uris : undefined)
          if (await fuzzyMergeMediaClusters(clusters)) {
            clusters = await findAllAggregatedMedia(uris.length ? uris : undefined)
          }
          clusters = hideAttachedContainers(clusters)
          // a container is only hidden when a run cluster in the SAME LIST points at it, which is why
          // the hide runs here and the filter runs inside `sortPage`
          return sortPage(clusters.map(cluster => aggregateMedia(cluster, location.origin)), uris)
        }

        try {
          yield await getPage()
          for await (const _ of iterator) {
            yield await getPage()
          }
        } finally {
          unlisten?.()
          void iterator.return?.()
          close()
          await Promise.allSettled(subscriptions.map(subscription => subscription.unsubscribe()))
        }
      }
    }
  },
  Media: {
    _id: (parent) => parent._id,
    categories: (parent) => parent.categories ?? [],
    episodes: async (parent) => {
      if (readStore() === 'graph') {
        // ONE LOOKUP of the cluster's own materialized list (6.4), never a walk from a media uri, so
        // it can never be handed a container's flat list of every season at once. A HANDLE NODE
        // answers `[]` for free: its `_id` is the member's own uri and matches no `Cluster.id`.
        return await episodesOf(String(parent._id ?? '')) as unknown as NonNullable<typeof parent.episodes>
      }
      // SAME_AS ONLY. See `sameAsHandleUris`, which carries the reasoning and the test: this module
      // cannot be imported under vitest, so the rule lives where it can be pinned.
      const handleUris = sameAsHandleUris(parent.handles)
      if (!handleUris.length) return parent.episodes ?? []

      // findRunEpisodes, not the bare walk: a member that packages this run inside a longer season
      // brings that season's whole list with it, and only the part of it that fits the run is this
      // run's. See store/consensus.ts.
      //
      // The cluster is read from the FIRST HANDLE, not from `parent.uri` through findMediaForPage:
      // that one falls back through handles and prefers an attached run, so it can answer with a
      // different set from the one whose episodes are being walked, and the counts deciding the trim
      // have to come from exactly the rows that supplied the episodes.
      // the FIRST handle that resolves, not the first handle. They all reach the same cluster, but a
      // uri whose row has not landed yet resolves to nothing, and taking that as "no cluster" dropped
      // the page onto the unwindowed walk, where a lent season's whole 24 episodes are drawn
      let cluster: Awaited<ReturnType<typeof findAggregatedMedia>> = []
      for (const uri of handleUris) {
        cluster = await findAggregatedMedia(uri)
        if (cluster.length) break
      }
      const episodeGroups = cluster.length
        ? await findRunEpisodes(cluster)
        : await findAggregatedEpisodesForMedia(handleUris)
      if (!episodeGroups.length) return parent.episodes ?? []

      const allEpisodes = episodeGroups.flat()
        .filter(ep => ep.episodeNumber != null)
      const grouped = new Map<number, typeof allEpisodes>()
      for (const ep of allEpisodes) {
        if (!grouped.has(ep.episodeNumber!)) grouped.set(ep.episodeNumber!, [])
        grouped.get(ep.episodeNumber!)!.push(ep)
      }

      return [...grouped.values()]
        .map(group => aggregateEpisode(group, location.origin))
        .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
    },
    descriptions: (parent, args) => {
      const descriptions =
        parent
          .descriptions
          ?.slice(0, args.input?.count ? args.input.count : undefined)
          .map(mediaDescription => {
            const parsed =
              args.input?.type === MediaDescriptionContentType.Html ? parseHTMLDescription(mediaDescription.description)
              : args.input?.type === MediaDescriptionContentType.Text ? parseTextDescription(mediaDescription.description)
              : parseTextDescription(mediaDescription.description)

            return {
              ...mediaDescription,
              shortDescription: parsed
            }
          })

      return descriptions
    },
    shortDescriptions: (parent, args) => {
      const shortDescriptions =
        parent
          .shortDescriptions
          ?.slice(0, args.input?.count ? args.input.count : undefined)
          ?.map(mediaShortDescription => {
            const parsed =
              args.input?.type === MediaDescriptionContentType.Html ? parseHTMLDescription(mediaShortDescription.shortDescription)
              : args.input?.type === MediaDescriptionContentType.Text ? parseTextDescription(mediaShortDescription.shortDescription)
              : parseTextDescription(mediaShortDescription.shortDescription)

            return {
              ...mediaShortDescription,
              shortDescription: parsed
            }
          })
          .filter((mediaShortDescription): mediaShortDescription is NonNullable<typeof mediaShortDescription> => Boolean(mediaShortDescription))

      return shortDescriptions
    },
    handles: (parent) => parent.handles ?? [],
  }
} satisfies Resolvers
