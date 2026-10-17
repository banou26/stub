# What the app needs from the store, and what the tests pin

Everything below is read off the tree at `/home/banou/dev/stub` on 2026-09-11, HEAD `cfd0f1f`. Every
claim carries a `file:line`. A claim I could not confirm from a file is marked `(unconfirmed)`.

Absolute paths are relative to `/home/banou/dev/stub/`.

---

## 0. The shape of the pipe, in one paragraph

The app is a Preact SPA talking GraphQL to a yoga server that runs inside a Web Worker. `src/worker.ts`
spawns `src/worker/index?worker` and exposes `handleRequest` plus seven other osra methods over a
MessagePort (`src/worker.ts:11`, `src/worker.ts:32-49`). Inside the worker, `src/worker/yoga.ts:26-38`
builds the app-facing yoga; `src/worker/yoga.ts:70-76` exposes the osra surface. Each of the 24 first
party sources, plus every registered plugin source, is its OWN yoga server with its OWN urql client
(`src/worker/extractor.ts:411-549`, list built at `src/worker/extractor.ts:551`). The app-facing
resolvers never call a source directly: they fan a subscription out to every source client
(`src/worker/extractor.ts:777-851`) and then READ THE STORE, which the sources have written into as a
side effect of resolving (`src/worker/extractor.ts:469-498`). The store is the only join point.

---

## 1. Write entry points

### 1.1 The three store writers

| function | signature | file:line |
| --- | --- | --- |
| `upsertMedia` | `(newMedias: Media[], handles: Claim[])`, `Claim = { mediaUri, handleUri, relation?: 'SAME_AS' \| 'PART_OF' }` | `src/worker/store/db.ts:132-201`, claim type `db.ts:110` |
| `upsertEpisodes` | `(newEpisodes: Episode[], handles: { episodeUri, handleUri, relation? }[])` | `src/worker/store/db.ts:400-415` |
| `upsertOrigins` | `(newOrigins: Origin[])` | `src/worker/store/db.ts:515-521` |

Three further writers exist for the fuzzy pass only, and they take PAIRS OF URIS rather than rows:

| function | what it may do | file:line |
| --- | --- | --- |
| `linkSameMediaPairs` | union two RUNs; refuses a pair with a CONTAINER on either side | `src/worker/store/db.ts:216-224` |
| `linkSameContainerPairs` | union two CONTAINERs; refuses a pair with a RUN on either side | `src/worker/store/db.ts:231-239` |
| `linkPartOfPairs` | directed RUN -> CONTAINER edge; refuses any other scope order | `src/worker/store/db.ts:247-255` |

All three return `boolean` (whether anything was new) and emit `media:changed` when it was
(`db.ts:222`, `db.ts:237`, `db.ts:253`). Their only caller is `fuzzyMergeMediaClusters`
(`src/worker/store/fuzzy-merge.ts:661`, `:663`, `:664`).

`resetStore()` (`src/worker/store/db.ts`) is TESTS ONLY and is deliberately not exported
through `src/worker/store/index.ts` (which re-exports types, events, db, aggregate, export).

### 1.2 Trigger A: the `useOnResolve` hook, keyed on the NAMED TYPE of the resolved field

```ts
addPlugin(useOnResolve(({ info }) =>
  async ({ result }) => {
    if (getNamedType(info.returnType).name === 'Media') { ...mediaInserter... }
    else if (getNamedType(info.returnType).name === 'Episode') { ...episodeInserter... }
    else if (getNamedType(info.returnType).name === 'Origin') { ...originInserter... }
  }))
```
`src/worker/extractor.ts:471-497`. Three consequences the redesign has to keep or deliberately
change:

- It fires on the RESOLVER'S RETURN VALUE, not on the selection set, so a whole `Media` row lands even
  when the caller selected three fields of it (`src/worker/similar-document.ts:8-11`).
- It is per RESOLVED FIELD. `media.episodes` is only written if the `episodes` field is actually
  RESOLVED, because only then does a field of named type `Episode` exist to hook. An unselected
  `episodes` writes zero episode rows. Measured 2026-09-10: the same Netflix cluster stored 10 `nf`
  episode rows when reached through a page that selected them, and 0 through the `similarMedia`
  document that did not (`src/worker/similar-document.ts:12-22`).
- `mediaInserter` never writes `media.episodes` itself: it passes `normalizeToStoreMedia` rows and
  handle pairs and nothing else (`src/worker/extractor.ts:127`), and `normalizeToStoreMedia` has no
  `episodes` field at all (`src/worker/store/normalize.ts:13-78`).

The hook runs on EVERY source server, including plugin ones, because it is installed in `makeExtractor`
(`src/worker/extractor.ts:469-498`), which every source goes through (`src/worker/extractor.ts:551`,
and for plugins `src/worker/extractor.ts:681`).

### 1.3 The three DataLoaders and what they do to a row on the way in

- `mediaInserter` (`src/worker/extractor.ts:106-134`): flatMaps `recursivelyUnwrapMediaHandles` over
  every media in the batch (`:107`), then builds `handlePairs` deduped on
  `mediaUri \0 handleUri \0 relation` (`:113-125`), dropping any handle whose `node` is absent
  (`:117-118`), then calls `upsertMedia(allUnwrapped.map(normalizeToStoreMedia), handlePairs)` (`:127`).
  Options: `cache: false`, `batch: true`, `maxBatchSize: 250`, `batchScheduleFn: setTimeout(cb, 50)`
  (`:129-134`).
- `episodeInserter` (`src/worker/extractor.ts:136-152`): handle pairs are NOT deduped here (`:137-143`),
  then `upsertEpisodes(episodes.map(normalizeToStoreEpisode), handlePairs)` (`:145`). Same loader
  options, `maxBatchSize: 250`, 50ms schedule (`:147-152`).
- `originInserter` (`src/worker/extractor.ts`): `maxBatchSize: 50`, 50ms schedule.

The 50ms flush timer is load bearing in a way the redesign must know about: the fuzzy pass awaits the
wasm matcher hundreds of times, and a DataLoader flush during that window can grow a component that has
already been judged, which is why every verdict is re-checked against the component AS IT STANDS before
being applied (`src/worker/store/fuzzy-merge.ts:637-655`).

Row shapes on the way in:

- `normalizeToStoreMedia` (`src/worker/store/normalize.ts:13-78`): every nullable field becomes `null`
  rather than `undefined`, `scope` defaults to `'RUN'` (`:39`), `relations` are FLATTENED from edges to
  `{relation, format, uri, origin, id, url, titles, covers, status, episodeCount, startDate}`
  (`:42-58`), `franchise` is copied whole or `null` (`:59-77`).
- `normalizeToStoreEpisode` (`src/worker/extractor.ts:53-70`): 17 fields, every one nullable coalesced.
- `normalizeOrigin` (`src/worker/extractor.ts:72-79`): `{id, url, name, icon, color, isApiOnly}`.

### 1.4 What `upsertMedia` does with a claim (the merge rules the replacement inherits)

- A PLACEHOLDER row is not stored at all: a row whose every field other than `uri`, `origin`, `id`,
  `scope` is null or an empty array, and which is not stamped CONTAINER (`src/worker/store/db.ts:104-108`,
  skipped at `:140`). `buildHandlesFromUri` in `src/sources/utils.ts` mints exactly these.
- Scope is STICKY toward CONTAINER: once any row for a uri said CONTAINER, a later RUN row does not flip
  it back (`src/worker/store/db.ts:142-146`).
- `SHOW_LEVEL_ORIGINS = new Set(['imdb'])` forces CONTAINER for any `imdb:` uri (`db.ts:42`, read at
  `db.ts:91-92`).
- A claim naming a uri no stored row describes is DEFERRED in `pendingClaims` keyed by that uri and
  applied when the row lands (`db.ts:124-130`, deferred at `:179-183`, replayed at `:154-160`). This is
  what stops arrival order deciding a union.
- The relation is DERIVED from the two scopes, never taken at face value (`db.ts:164-197`):
  RUN x RUN SAME_AS unions; RUN x RUN PART_OF is an edge; RUN x CONTAINER is always an edge run ->
  container whichever side claimed; CONTAINER x CONTAINER SAME_AS unions in the container space.
- Every applied claim is ALSO recorded under `ASSERTED_LABELS` (`db.ts:66-70`, written at `:189`, `:192`,
  `:195`), an adjacency-only second record whose ONLY reader is the export (`db.ts:55-64`). Those writes'
  return values are discarded on purpose so they cannot drive `changed` (`db.ts:173-176`).

### 1.5 Trigger B: the fan-out, which DISCARDS return values

`proxyRequestToExtractors(ctx, operation, extractUris?)` (`src/worker/extractor.ts:777-851`) subscribes
every source to the app's own document and returns `{subscriptions, insertedUris, askOrigins, root, close}`.

- `joinFanout` subscribes with a callback that returns immediately unless an `extractUris` was supplied:
  `subscribe((result) => { if (!fanout.extractUris) return; ... })` (now `askEntry` in `src/worker/fanout.ts`).
  So on the `media` path (`src/worker/resolvers/media/index.ts:39`, no third argument) EVERY source
  result is thrown away by the caller. The data reaches the app only because `useOnResolve` wrote it to
  the store and the resolver re-reads on `media:changed`.
- On the `mediaPage` path the callback keeps URIS ONLY, into `fanout.insertedUris`
  (`src/worker/resolvers/media/index.ts:99-107` supplies the extractor, collected at
  `src/worker/extractor.ts:753-755`).
- `askOrigins` re-subscribes a SUBSET of sources with a wider uri and discards their results outright:
  `.subscribe(() => {})` (`src/worker/extractor.ts:833`). Matching is on `answersForOrigins`, which is
  the source's own origin OR any of its declared `supportedUris` (`src/sources/supported.ts:27-29`,
  called at `src/worker/extractor.ts:829-831`).
- The `origin` and `originPage` resolvers do the same: `.subscribe(() => {})` twice
  (`src/worker/resolvers/origin/index.ts:21-26`, `:50-55`).
- A source registering MID-FLIGHT joins every open fan-out (`src/worker/extractor.ts:743`,
  `:689`), and leaving removes it (`:720`).
- `close()` deletes the fan-out and closes the request-context root (`src/worker/extractor.ts:849`).

So: **the write path and the read path are joined only by the store and its events.** No resolver ever
consumes a source's payload directly. Both media resolvers re-read from scratch on every event
(`src/worker/resolvers/media/index.ts:67-78` and `:110-163`).

### 1.6 Trigger C: the similar consumer, the app's own merge decision

`resolveSimilarRuns(cluster, root, deps)` is called from the media resolver only, with `void` so it
cannot delay a yield (`src/worker/resolvers/media/index.ts:76`). Its claim is a WRITE WITH NO ROWS:

```ts
await upsertMedia([], [{ mediaUri: ask.runUri, handleUri: result.media.uri, relation: 'SAME_AS' }])
```
`src/worker/similar-consumer.ts:255`. The answer's own row lands through the answering extractor's
`useOnResolve` insertion, and this claim waits under `pendingClaims` until it does
(`src/worker/similar-consumer.ts:272-277`). The claim is refused before it is made when another run of
that origin is already in the cluster (`similar-consumer.ts:239-245`) or when the answer's titles do not
name our show (`similar-consumer.ts:246-253`). It reads the store three ways: `findPartOfMedia`
(`:282`), `findAggregatedEpisodesForMedia` (`:284`), `findAggregatedMedia` (`:239`).

Caps and keys the replacement must carry: `MAX_ASKS_PER_PAIR = 4` (`similar-consumer.ts:41`, enforced
`:207-211`), one driver per record (`:188-194`), records keyed by container uri and found by MEMBER
INTERSECTION rather than by component id because `carryComponentId` keeps only one of two ids on a union
(`similar-consumer.ts:85-125`). `resetSimilarAsks()` is tests only (`:306`).

The funnel around it lives in the extractor: `similarOutcomeFrom(caller)`
(`src/worker/extractor.ts:314-397`) with `SIMILAR_MEDIA_TIMEOUT_MS = 30_000` (`:198`),
`MAX_CONCURRENT_SIMILAR_MEDIA = 32` (`:216`), `MAX_SIMILAR_MEDIA_PER_CALLER = 8` (`:227`),
`SAFE_SHOW_ID = /^[A-Za-z0-9._~-]{1,128}$/` (`:244`), in-flight dedupe on the normalised question
(`:349-355`), and an answer that is not a RUN of the asked origin refused outright (`:371-374`). The
app's own asks are budgeted under the caller name `'app'` (`src/worker/resolvers/media/index.ts:24`).

### 1.7 Trigger D: the fuzzy pass, run from the LISTING read

`fuzzyMergeMediaClusters(clusters)` is called from `mediaPage`'s `getPage` and nowhere else in `src/`
(`src/worker/resolvers/media/index.ts:127`; only other hits are comments, confirmed by grep). It returns
`true` when it linked anything, and the resolver then RE-READS all clusters (`:127-129`). Its writes go
through the three pair linkers above, so the same scope refusals apply
(`src/worker/store/fuzzy-merge.ts:659-666`).

### 1.8 Trigger E: sources reading the store back, mid-resolve

`ExtractorServerContext` gives every source four functions (`src/worker/extractor.ts:34-44`,
constructed `:529-539`):

- `fetch` (backoff-wrapped), `key(origin)` (the user's API keys, set by `setUserKeys`,
  `src/worker/extractor.ts:50-51`, exposed at `src/worker/yoga.ts:43`).
- `findAggregatedMedia(uri) => Promise<Media | undefined>`: the aggregated GraphQL Media, falling back
  through an aggregated uri's handle uris (`src/worker/extractor.ts:81-92`).
- `listenForMediaChanges({uri}, {abortSignal}) => AsyncGenerator<Media | undefined>`: yields once
  immediately then on every `media:changed` or `episode:changed` (`src/worker/extractor.ts:94-104`).
- `similarMedia(origin, input)` bound to the calling source (`src/worker/extractor.ts:537`).

The read-back pair is used by `waitForMedia` (`src/sources/utils.ts`), whose callers are
unogs (`src/sources/unogs/extractor.ts:350`, `:463`), appletv (`:230`, `:334`), tmdb (`:158`),
crunchyroll (`:457`), justwatch (`:571`, `:637`) and tvmaze (`:168`). A source therefore BLOCKS on the
store answering, with a 15s or 30s deadline. Any replacement must keep a read that can be awaited from
inside a source resolver while other sources are still writing.

---

## 2. Read entry points

### 2.1 The five reads the app makes, and their exact return shapes

Everything the app sees is one of four GraphQL subscription fields. There are no queries and no
mutations: `Query` and `Mutation` are empty objects in every resolver module
(`src/worker/resolvers/media/index.ts:27-28`, `origin/index.ts:13-14`, `episode/index.ts:10-12`,
`playback-source/index.ts:8-10`).

#### `Subscription.media(input: MediaInput!): Media`

`src/worker/resolvers/media/index.ts:30-93`. Schema at `src/worker/resolvers/media/schema.gql:532`.

1. `decodeRouteUri(args.input.uri)`, then refuse anything that is neither a uri nor an aggregated uri,
   with a `console.warn` so a refusal is distinguishable from slowness (`media/index.ts:33-38`).
2. `proxyRequestToExtractors(ctx, 'MEDIA')` (`:39`), then a `listenMultipleIterator(['media:changed',
   'episode:changed'])` (`:40`) with NO debounce.
3. `read()` (`:67-78`): `findMediaForPage(requestedUri)` -> `aggregateMedia(cluster, location.origin)`
   -> `askUnasked(media.uri)` -> `void resolveSimilarRuns(...)`. Yields `undefined` for an empty
   cluster, which means nothing is yielded at all until a source answers.
4. `askUnasked` tracks which ORIGINS have been asked with a uri that named them, and re-asks only the
   newly addressable ones (`:58-65`). Termination argument is written at `:55-56`: an origin enters the
   set once, the cluster only gains members, so each source is asked at most twice (plus once per
   declared `supportedUris` origin, `src/worker/extractor.ts:812-819`).

Store functions used: `findMediaForPage` (`db.ts:349-364`), which resolves the uri, then for an
aggregated uri walks its handle uris preferring one that names a RUN, then applies `preferAttachedRun`
(`db.ts:334-339`) which swaps a container-only cluster for its earliest attached run.

#### `Subscription.mediaPage(input: MediaPageInput!): MediaPage!`

`src/worker/resolvers/media/index.ts:94-175`.

1. `proxyRequestToExtractors(ctx, 'MEDIA_PAGE', result => result.data.mediaPage.nodes.map(({uri}) => uri))`
   (`:97-107`).
2. `debouncedListenIterator(['media:changed'], 100)` (`:108`). 100ms, and `episode:changed` is NOT
   listened to here.
3. `getPage()` (`:110-163`):
   - `findAllAggregatedMedia(uris.length ? uris : undefined)` (`:126`). **The whole-store fallback is
     load bearing**: `insertedUris` is empty until a source answers, and answering `[]` instead breaks
     the page outright because the generator only re-runs on `media:changed` and `graph.set` is
     idempotent, so no event ever fires. Measured 2026-09-06: picking a format on a loaded season sat
     at 0 cards for 60 seconds where the same url opened cold answered 24 (`:112-125`).
   - `fuzzyMergeMediaClusters(clusters)`, and on `true` a re-read (`:127-129`).
   - `hideAttachedContainers(clusters)` (`:130`, defined `db.ts:391-398`).
   - `aggregateMedia` per cluster (`:131`).
   - `applyMediaFilters(aggregated, args.input)` (`:137`), which MUST run after
     `hideAttachedContainers` or a dropped run leaves its container behind as an orphan card
     (`:133-136`).
   - `searchRelevance` scoring with `SEARCH_RELEVANCE_THRESHOLD = 0.7`, sorted by score then popularity
     (`:21`, `:139-152`).
   - `sorts`: `POPULARITY` sorts descending, `POPULARITY_DESC` sorts ascending (`:154-161`; the names
     are inverted relative to the sort, which is what the code does today).

#### `Subscription.origin(input) : Origin` and `Subscription.originPage(input): OriginPage`

`src/worker/resolvers/origin/index.ts:16-72`. `originPage` returns nothing at all for an EMPTY id list
(`:48`), which is what made an episode row with no derivable origin ids render zero icons
(`src/router/home/episode-origins.ts:6-10`). Filters are `IS_API_ONLY` / `IS_NOT_API_ONLY`
(`origin/index.ts:57`, applied in `db.ts:539-543`). Both re-yield on `origin:changed` and yield one last
time in `finally` (`origin/index.ts:38-42`, `:67-70`).

#### `Media.episodes` (the most dangerous read in the tree)

`src/worker/resolvers/media/index.ts:180-218`:

1. `sameAsHandleUris(parent.handles)` (`aggregate.ts:103-104`): SAME_AS ONLY. A PART_OF node is a SHOW,
   and unogs hangs every season's episodes, each renumbered 1..n, off exactly that kind of uri, so
   passing one in reproduces the 24-rows-on-a-14-episode-season defect (`aggregate.ts:96-101`).
2. The cluster is read from the FIRST HANDLE THAT RESOLVES, not from `parent.uri` through
   `findMediaForPage`, because that one prefers an attached run and can answer with a different set from
   the one whose episodes are being walked (`media/index.ts:190-201`).
3. `findRunEpisodes(cluster)` when a cluster was found, else `findAggregatedEpisodesForMedia(handleUris)`
   (`:202-204`). `findRunEpisodes` applies `alignRunEpisodes` then `runEpisodes`
   (`db.ts:424-430`), which trims a lent season's tail.
4. Groups by `episodeNumber` ALONE, drops episodes with a null number, `aggregateEpisode` per group,
   sorts by number (`:207-217`).

### 2.2 The aggregated shapes the app is handed

`aggregateMedia(medias, locationOrigin) => GQLMedia` (`src/worker/store/aggregate.ts:306-399`):

- `_id` = `graph.componentId(member, IDENTITY_LABELS[space])`, the union-find ROOT of the cluster's
  identity space, not the smallest member uri (`aggregate.ts:290-294`).
- `uri`/`id` = `ag:(<sorted, comma-joined routable member uris>)` (`aggregate.ts:296-304`), filtered by
  `isRoutableUri` so a `,` `/` `(` `)` in an id cannot break the route
  (`src/utils/uri.ts:82-88`).
- `origin: 'ag'`, `url` = the app's own `/media/<uri>` route (`aggregate.ts:357-358`).
- `score` = max member score (`:359`), `scope` = CONTAINER only when EVERY member is (`:264-265`).
- `handles` = every member as a SAME_AS edge in score order, then `findPartOfMedia(medias)` as PART_OF
  edges (`:364-367`, and `:315` for a single-member cluster). Read by the store rather than by the
  caller so no caller can forget them (`:361-363`).
- Scalars are FIRST-NON-NULL-IN-SCORE-ORDER (`:328-337`); arrays are unioned (`:338-347`);
  `franchise` is the first supplier's WHOLE graph, never spliced (`:348-351`).
- `episodeCount` is `runLength(medias)` (tiered consensus) falling back to the reduce (`:386`,
  `src/worker/store/consensus.ts:62`).
- `relations` deduped on `relation \0 node.uri` with self edges dropped (`:249-261`, `:387`).
- `categories` reconciled to ANIME plus exactly one of MOVIE/SERIES (`:9-15`, `:388`).
- `season`/`seasonYear` taken as a PAIR from one member (`:47-53`, `:389`).
- `genres`/`tags` deduped case-insensitively keeping the best-scored spelling (`:55-65`, `:390-391`).
- `titles` deduped by title after score sort; descriptions, covers, banners score sorted; trailers
  deduped by uri (`:392-397`).

`aggregateEpisode(episodes, locationOrigin) => GQLEpisode` (`aggregate.ts:401-451`). Note the case that
bit the UI: a cluster of ONE returns the member's RAW uri, not an `ag:(...)` one (`:403-409`), which is
why episode origins are read off handles and never off the uri
(`src/router/home/episode-origins.ts:4-10`).

### 2.3 What the UI does with each field

Fragments (the identity floor every document pulls in):

- `MediaFragment`: `_id uri origin id url handles { relation node { _id uri origin id url } }`
  (`src/worker/resolvers/media/fragment.ts:4`, text in `src/generated/gql.ts:25`).
- `EpisodeFragment`: the same plus `mediaUri` on both levels (`src/worker/resolvers/episode/fragment.ts:4`,
  `src/generated/gql.ts:24`).
- `OriginFragment`: `id url name icon color isApiOnly` (`src/worker/resolvers/origin/fragment.ts:10`).

| consumer | document | fields it needs | what it does with them |
| --- | --- | --- | --- |
| home row | `GetReleasingMediaPage`, `src/router/home/index.tsx:18-53` | MediaFragment, score, episodeCount, titles, shortDescriptions(count 1), covers, banners, trailers, popularity | cards; input names `season` + `seasonYear` + `sorts: [POPULARITY]` (`:78-87`) |
| home hero | `GET_THEATHER_MEDIA`, since removed from `src/router/home/theater.tsx` | MediaFragment, titles, shortDescriptions, covers, banners, trailers, popularity | picks one candidate and re-subscribes `media` by ITS uri (`:174-183`); the pick is HELD by key so a growing cluster does not reroll it (`:166-172`) |
| search page | `SearchMediaPage`, `src/router/search/index.tsx:24-70` | the home set plus genres, tags, averageScore, status, type, season, seasonYear, nextAiringEpisode { episodeNumber airingAt }, covers.color | card / row / title layouts (`:360-373`), all three keyed on `node._id` |
| media modal | `GetMediaModal`, now `GetMediaDetails` in `src/router/home/media-details.tsx` | MediaFragment, titles(language/title/score), descriptions(input), covers, banners, trailers, popularity, categories, franchise { nodes{uri format status episodeCount startDate titles{title}} edges{from to relation} }, relations { relation format node{...} }, episodes { EpisodeFragment, episodeNumber, releaseDate, titles, shortDescriptions, thumbnails, handles{relation node{...}} }, handles two levels deep with the inner nodes' episodes, episodeCount | see below |
| watch page | `GetWatchMedia`, `src/router/watch/index.tsx:32-90` | `_id uri origin id`, titles, episodes { EpisodeFragment, episodeNumber, titles, thumbnails, handles{relation node{... url embedUrl mediaUri episodeNumber titles shortDescriptions}} }, handles two levels deep | picks the episode by `matchAggregatedUris` (`:196-203`), derives origins from the EPISODE's aggregated uri (`:205-210`), dedupes them because one origin can contribute several handles and `findOrigins` maps positionally (`:213-216`), then builds one release per SAME_AS handle (`:299-320`) |
| episode row origins | `GetMediaModalOrigins`, now `GetMediaOrigins` in `src/router/home/media-details.tsx` | OriginFragment | icons; ids come from `episodeOriginIds(episode)`, SAME_AS only (`src/router/home/episode-origins.ts:15-21`) |

Field-by-field, what breaks if it changes:

- **`_id`**: the urql graphcache key for `Media` and `Episode` (`src/urql-keys.ts:17`, `:38`). Must be
  stable as a cluster GROWS, or every card's DOM node is replaced on each source landing
  (`tests/unit/worker/store/stable-id.test.ts:1-5`). Every edge type keys to `null` so it embeds:
  `MediaHandle`, `MediaRelationEdge`, `MediaFranchise`, `MediaFranchiseNode`, `MediaFranchiseEdge`,
  `EpisodeHandle` (`src/urql-keys.ts:22-30`). `MediaTrailer` keys on `uri` (`:37`).
- **`uri`**: the route. `/media/:uri` and `/media/:uri/:mediaUri` (`src/router/path.ts:18-19`,
  `:42-43`). The modal rewrites its own address as the cluster grows, guarded by `shouldGrowAddress`
  (now `shouldRewriteAddress`; `media-modal.tsx:395-407`, `src/utils/uri.ts`), and the whole party feature syncs a PATH
  between viewers (`src/party/protocol.ts:28`, `:32`, validated by `isAppPath` at `:111-115`), so an
  aggregated uri is a shared, pasteable address, not an internal id.
- **`handles`**: four separate readers. Origin badges take BOTH relations, SAME_AS first then anything,
  and read `node.url` (`SourceLinks`, `media-details.tsx`). The franchise graph takes `handle.node.uri` for every
  handle to mark the current node (`media-modal.tsx:497-499`). The origin id set is the UNION of the
  aggregated uri's origins and `handles[].node.origin` (`SourceLinks`, `media-details.tsx`). Playback takes
  SAME_AS ONLY, on both media and episode (`src/router/watch/index.tsx:29-30`,
  `media-modal.tsx:491-497`, `src/router/home/episode-origins.ts:18-20`).
- **`episodes`**: rows in the modal keyed on `episode.episodeNumber ?? episode.uri ?? index`
  (`Episodes`, `media-details.tsx`), each row rendering number, thumbnail (with per-source fallback on error,
  `:472-474`), title, shortDescription, a release date that falls back to a handle's
  (`:479`), and up to five sources sorted internal-first (`:488-523`).
- **`relations`**: `MediaRelations` draws a grid of cards and navigates to `asAggregatedUri(node.uri)`
  (`src/components/media-relations.tsx:1-11`). A bare source uri must be wrapped as `ag:(...)` or the
  page opens pinned to one source (`src/utils/uri.ts:107-128`).
- **`franchise`**: `MediaFranchise` lays out nodes and edges as inline SVG, arithmetic in
  `src/utils/franchise-layout.ts` (`src/components/media-franchise.tsx:11`, `:18-36`).
- **filters**: `applyMediaFilters` is STRICT, so an absent field never passes a filter
  (`src/worker/store/filter.ts:31-52`). That is only true if aggregation actually carries `type`,
  `season`, `seasonYear`, `genres`, `tags`, `status` through, which is why
  `tests/unit/worker/store/aggregate-fields.test.ts:1-5` exists.
- **export**: `exportStore` reaches the page only behind `?export=store`, as `window.__stubExportStore`
  (`src/store-export.ts:1-18`), and osra derives the plugin origins to exclude itself so a caller cannot
  decline to exclude them (`src/worker/yoga.ts:52-62`). Its promises: reads and never writes, walks ONLY
  `ASSERTED_LABELS` pairs and never a fuzzy union, drops a cluster whose published members are all
  CONTAINER, byte-identical output for two calls on one store (`src/worker/store/export.ts:12-30`). Two
  kinds of refusal, `excludeOrigins` (not walked through) and `passThroughOrigins` (walked through, not
  published), and conflating them cost a walk its identity because the offline row is the hub bridging
  mal, anilist and kitsu (`export.ts:20-27`).

### 2.4 Reads the store exposes that the app does not call directly

`findPartOfMedia` (`db.ts:276-296`), `findRunsOfContainer` (`db.ts:303-317`), `preferAttachedRun`
(`db.ts:334-339`), `hideAttachedContainers` (`db.ts:391-398`), `mergeByEpisodeNumber`
(`db.ts:475-494`), `clusterAnomalies` (`src/worker/store/anomalies.ts`). The last one has no
runtime caller in `src/` (it is imported by `tests/unit/worker/store/anomalies.test.ts:5`), and
is the only place that states what a cluster contradicting ITSELF looks like: two ids of one origin that
are not the same id at different precision (`anomalies.ts:18-46`), and a run listing more episodes than
its sources agree it is long (`anomalies.ts:48-67`).

---

## 3. The event contract

```ts
type StoreEventMap = {
  'media:changed': { uris?: string[] }
  'episode:changed': { uris?: string[] }
  'origin:changed': { ids?: string[] }
}
```
`src/worker/store/events.ts:1-5`. A single module-level `EventTarget` (`eventBus`).

**The payload is always empty.** Every emit site passes `{}`: `db.ts:200`, `:222`, `:237`, `:253`,
`:414`, `:520`. The `uris` and `ids` fields are declared and never populated, and no listener reads
them. Any replacement may therefore start carrying uris without breaking a reader, but no reader gains
anything until one is written to use them.

| event | emitted when | file:line |
| --- | --- | --- |
| `media:changed` | a media row is NEW (not on an update of an existing row), or a union or PART_OF edge was NEW | `db.ts:141-151` then `:200`; pair linkers `:222`, `:237`, `:253` |
| `episode:changed` | UNCONDITIONALLY on every `upsertEpisodes` call | `db.ts:414` |
| `origin:changed` | UNCONDITIONALLY on every `upsertOrigins` call | `db.ts:520` |

Listeners:

| listener | events | debounce | file:line |
| --- | --- | --- | --- |
| `Subscription.media` | `media:changed` + `episode:changed` | none | `src/worker/resolvers/media/index.ts:40` |
| `Subscription.mediaPage` | `media:changed` only | 100ms trailing | `src/worker/resolvers/media/index.ts:108` |
| `ctx.listenForMediaChanges` (every source) | `media:changed` + `episode:changed` | none | `src/worker/extractor.ts:100` |
| `Subscription.origin` | `origin:changed` | none | `src/worker/resolvers/origin/index.ts:31` |
| `Subscription.originPage` | `origin:changed` | none | `src/worker/resolvers/origin/index.ts:61` |

Iterator mechanics that the timing rests on:

- `listenIterator` BUFFERS every detail it cannot deliver immediately (`events.ts:76-108`), so an origin
  listener never misses an event.
- `listenMultipleIterator` and `debouncedListenIterator` COLLAPSE: `makeAsyncIterator` holds a single
  `pending` boolean, so ten events while the consumer is awaiting a read become one wake-up
  (`events.ts:30-70`). This is what keeps a burst of 24 sources landing from running 24 full page reads.
- The debounce RESTARTS the timer on each event (`events.ts:133-138`), so a continuously writing store
  starves the listing until writes pause for 100ms.
- Every iterator is torn down on `ctx.request.signal` abort (`events.ts:49-54`, `:88-93`) and the
  resolvers additionally `close()` the fan-out and unsubscribe in `finally`
  (`media/index.ts:88-91`, `:170-173`).

What breaks if the timing changes:

- **An event that does not fire leaves a page empty forever.** The media resolver's first `read()` may
  return `undefined` and then nothing wakes it (`media/index.ts:81-87`). This is the failure the
  whole-store fallback in `getPage` exists to avoid on the listing side (`media/index.ts:112-125`),
  where a second subscription over a warm store changes nothing because `graph.set` is idempotent.
- **An event that fires when nothing changed is not free.** It re-runs the whole fuzzy merge pass and
  wakes every subscribed page, and the sources re-mint constantly because the DataLoader flushes on a
  50ms timer and the media page re-asks every origin
  (`tests/unit/worker/store/edge-idempotence.test.ts:1-8`). That is the reason `graph.edge` reports
  newness at all and the reason the ASSERTED writes' return values are discarded (`db.ts:173-176`).
- **`upsertEpisodes` emitting unconditionally** is a known asymmetry (`db.ts:414`): it wakes
  `Subscription.media` and every source's `listenForMediaChanges` on every episode batch, changed or
  not. A replacement that fixes this MUST check that `waitForMedia`'s seven callers still get woken
  (`src/sources/utils.ts`).
- **Ordering between the two media events matters to `askUnasked`.** The re-ask fires from inside
  `read()` (`media/index.ts:148`), so a source whose id lands in a batch must see a `media:changed`
  AFTER that batch, not merged into one that preceded it.

---

## 4. Remote plugin sources

### 4.1 Registration

`registerRemoteExtractor(port, pluginUri)` (`src/worker/extractor.ts`), reached from the app
through osra as `registerRemoteSource` (`src/worker/yoga.ts`, re-exported
`src/worker.ts:32-49`, driven by `src/plugins.ts:5`). Flow:

1. `attach(port)` from `@fkn/lib/packages` gives the payload (`extractor.ts:668`).
2. `readPluginSources(remote, pluginUri)` validates it (`src/worker/plugin-sources.ts:44-83`).
3. A reconnect re-registers, so the plugin's previous entries are dropped first
   (`extractor.ts:671-672`).
4. Per source: an origin already registered by another source THROWS and is reported rather than
   replacing it (`extractor.ts:678-680`); a `makeExtractor` is built with delegating resolvers
   (`:681`); `entry.pluginUri` is stamped (`:682`); it is pushed onto `extractors` (`:683`); it joins
   every in-flight fan-out (`:689`).
5. Returns `{sources: [{origin, name}], rejected: [{origin, reason}]}`; if nothing registered at all it
   throws with the reasons joined (`:701-706`).

`unregisterRemoteExtractor(pluginUri)` removes pickers, players and extractor entries and leaves every
fan-out (`extractor.ts:709-722`).

### 4.2 What a plugin may DECLARE

`readPluginSources` accepts either ONE source or a `sources` array, and the single shape stays supported
because it is what the example plugin and every plugin written before this sends
(`plugin-sources.ts:30-52`). Per source it mints a `PluginSourceMeta`
(`plugin-sources.ts:18-26`, built `:68-79`):

- `origin`: must match `PLUGIN_ORIGIN_TOKEN = /^[a-z0-9][a-z0-9-]{0,31}$/` (`plugin-sources.ts:4`,
  checked `:59-62`), else rejected with `'origin must be a short lowercase token'`.
- `originUrl`: string or `''`.
- `name`: string, SLICED TO 64 CHARS, defaulting to the origin (`:73`).
- `icon`, `color`: string or null. `isApiOnly`, `metadataOnly`: strict `=== true` (`:76-77`).
- A repeat of an origin inside one payload keeps the first and rejects the repeat (`:63-67`).
- A malformed source costs only itself; siblings still register (`plugin-sources.ts:36-42`).
- `PluginSourceMeta` carries NO `supportedUris`, so a plugin is only ever re-asked on its own origin
  (`src/worker/extractor.ts:827-829`).

### 4.3 What a plugin may SERVE, and what it may MINT

Three subscription fields are delegated, and only if the plugin actually supplied a `subscribe`:
`media`, `mediaPage`, `similarMedia` (`src/worker/extractor.ts:601-635`, wired `:629-633`). The app-side
type is `StubSource` (`src/plugin-api.ts:8-46`), protocol tag `'stub-source@1'`
(`src/plugin-api.ts:56`).

The two enforcement points:

- **`enforcePluginOrigin`** (`src/worker/extractor.ts:580-599`): a `media` or `similarMedia` payload
  whose `origin` is not the plugin's is replaced with `null` and logged; a `mediaPage` has its
  offending nodes filtered out. `similarMedia` is held to the same rule as `media`, because without it
  a plugin asked about its own show could answer with someone else's uri and have it linked as an
  identity (`:584-586`). NESTED handles are exempt on purpose: cross-origin handles are how clustering
  works, an accepted residual bounded by the aggregation score threshold (`:577`).
- **`readPluginPayload` / `readPluginHandles`** (`src/worker/plugin-sources.ts:97-141`): a BARE ROW in
  `handles` reads as the SAME_AS it always meant, an edge passes through with its node read the same
  way, a row carrying only `origin` and `id` gains a derived `uri`, anything else is dropped
  (`:90-104`). Depth cap 4 for media, 1 for an episode's handles (`:123-128`). This exists because
  `stub-source@1` plugins were written against `handles: [Media!]!`; when the schema made a handle an
  edge on 2026-09-04 a bare row became an edge with no node, the unwrap dereferenced it, and THE SHARED
  INSERT BATCH REJECTED FOR EVERY EXTRACTOR IN IT, first-party sources included (2026-09-05, on the
  deployed site) (`plugin-sources.ts:111-121`).

Beyond that a plugin's rows go through exactly the same `useOnResolve` insertion as a first party
source's, because `makeExtractor` is shared (`extractor.ts:681`). So a plugin can mint any uri it likes
inside `handles`, and the store's scope rules are the only thing between it and a union.

### 4.4 What a plugin is HANDED

```ts
type RemotePluginContext = { similarMedia: ExtractorServerContext['similarMedia'] }
```
`src/worker/extractor.ts:556`, supplied at `:620`. Exactly one function and never the real ctx: the
proxy fetch, the user's API keys and the store reads do not cross to third-party code
(`:607-619`). The deliberate residual is written down next to it: a plugin CAN cause a key-gated source
to spend the user's key on a request it did not initiate.

### 4.5 The two side channels

- `selectRelease(uris) => Promise<string | null>`: registered into `pickers` keyed by origin
  (`extractor.ts:684-687`), read by `remotePicker(origin)` (`:642-645`) and driven by
  `selectRemoteRelease` (`:647-651`), both exposed over osra (`src/worker/yoga.ts:63-65`) and used by
  the watch page (`src/router/watch/index.tsx:246-249`).
- `play(release)`: registers the origin in `players` (`extractor.ts:688`), read by `remotePlayer`
  (`:659-662`). The call is made on a DIFFERENT connection: stub mounts the package's frame in its
  player area, so all the worker publishes is which package to mount (`:653-657`). The optional
  `onPlayback` / `applyPlayback` pair makes a plugin player syncable in a watch party
  (`src/plugin-api.ts:36-45`, `src/party/plugin-link.ts:20-43`).
- Export: plugin origins are excluded from `exportStore` by the worker itself, derived from
  `entry.pluginUri`, so a caller cannot decline to exclude them: a plugin's rows are that user's, never
  the product's (`src/worker/yoga.ts:52-62`).

---

## 5. Test inventory

74 test files in the three directories: **25 under `tests/unit/worker/`** (244 `test(`/`it(` calls),
**45 under `tests/unit/sources/`** (562 calls), **4 under `tests/unit/router/`** (55 calls). Counts from
`grep -c '^\s*test(\|^\s*it('`. `tests/unit/worker/store/merge-fixtures.ts` is a fixture module, not a
test file, and its 13 cases are each run twice by the harness (the corpus extraction counted them: `MERGE_CASES.length` is 13).

Verdict key: **KEEP** = pins a behaviour the app depends on and does not name a doomed internal.
**REWRITE** = pins the right behaviour against internals that go away. **DROP** = pins an internal that
goes away and nothing else.

### 5.1 `tests/unit/worker/` (25 files)

| file | what it pins | verdict |
| --- | --- | --- |
| `backoff.test.ts` (14) | retryable statuses, backoff growth, `Retry-After` parsing, init travelling with every attempt | KEEP, untouched by the store |
| `plugin-sources.test.ts` (13) | the plugin payload contract: single and family shapes, per-source rejection, name cap, bare-row handles reading as SAME_AS | KEEP |
| `request-context.test.ts` (8) | a listing refuses cross-source work and a detail view spends it; a forged token is a miss; `contextMisses` moves | KEEP |
| `similar-consumer.test.ts` (22) | the whole consumer contract: one ask per (cluster, container), evidence from the cluster, refusal and re-ask rules, the cap, record merging, the claim as SAME_AS of the run | REWRITE: the behaviour is the contract, but it drives `upsertMedia`/`findAggregatedMedia`/`resetStore` directly (`:143`) |
| `similar-document.test.ts` (4) | the funnel's selection validates against the schema, titles selected whole, every episode field and array selected | KEEP |
| `store/aggregate-fields.test.ts` (12) | aggregation carries season, seasonYear, genres, tags, nextAiringEpisode; the season PAIR comes from one source; tiered episodeCount | REWRITE: right behaviour, calls `aggregateMedia` + `resetStore` |
| `store/arrival-order.test.ts` (7) | a claim naming an in-flight row waits and lands as an EDGE, never a union; a placeholder is not a media; a bare CONTAINER stamp is a description | REWRITE: the rule survives, `pendingClaims` is an internal |
| `store/consensus.test.ts` (31) | `tieredConsensus`, `runEpisodes` trimming a lent season, `alignmentOffset` by shared dates, `alignRunEpisodes` | KEEP: pure functions, the merge policy the plugins inherit |
| `store/container-page.test.ts` (6) | a show page follows to its attached run, earliest first; a mixed bookmark resolves to its run | REWRITE |
| `store/container-scope.test.ts` (8) | the scope derivation table: cross-scope is always an edge, CONTAINER is sticky, the handle-less linkers refuse a cross-scope pair, imdb reads as CONTAINER | REWRITE: this is the single most important rule to carry |
| `store/db.test.ts` (2) | a show-level imdb handle does not merge two seasons; an ordinary handle still merges | REWRITE |
| `store/edge-idempotence.test.ts` (2) | `graph.edge` reports newness; re-asserting a PART_OF emits no second `media:changed` | REWRITE: the second case is the event contract, the first names `graph.edge` |
| `store/episode-merge.test.ts` (10) | `mergeByEpisodeNumber`: two metadata sources over one run become ONE list; specials and non-positive numbers never collide; order kept | KEEP for the pure half, REWRITE for `findAggregatedEpisodesForMedia` |
| `store/export.test.ts` (9) | the export walks ASSERTED pairs only, never a fuzzy union; exclude vs pass-through; the `uris` filter; a deferred claim counts as asserted when it lands | REWRITE: the promises are contract, the labels are internal |
| `store/filter.test.ts` (14) | `applyMediaFilters`: ANY-match categories and formats, ALL-match genres and tags, strictness, status enforced | KEEP: pure, and it is the whole distance between what the user asked for and what the page lists |
| `store/fuzzy-merge.test.ts` (21) | the title matcher: year-only Japanese titles, season labels, companion entries, order independence, run vs container riding an edge | REWRITE: this becomes a merge plugin, the cases are the spec for it |
| `store/graph.test.ts` (9) | `lastWriteLongestArray` field merge, `neighbours`, `connect` unioning nothing, label isolation, `clear` | DROP, except `lastWriteLongestArray`: its rule (an incoming empty array never beats a filled one, an incoming null scalar keeps the existing value) is the seed's whole safety argument (`:1-3`) and must be restated wherever field merging lands |
| `store/merge-fixtures.test.ts` (3 harness tests over 13 fixture cases) | real 2026-08-31 payloads from api.ani.zip, kitsu.io and graphql.anilist.co, with hand-decided `together`/`apart` answers and a written `why`; both directions required; every cluster also checked for self-contradiction | KEEP: the answers do not come from the implementation (`merge-fixtures.ts:11-17`), only the harness is rewired |
| `store/mushoku-parts.test.ts` (3) | one season's two PARTS stay two media, with real titles and dates; this is the exact case the redesign is named for | KEEP as a corpus case, rewire the harness |
| `store/normalize.test.ts` (8) | the GraphQL row to store row mapper carries scope, season, genres, tags, nextAiringEpisode; absence is null or `[]`, never undefined; `aggregateMedia` reports the cluster scope | REWRITE: "source results stored exactly as returned" may delete the mapper, but the absence-spelling rule and the scope reporting survive |
| `store/part-of-subtree.test.ts` (6) | the unwrap STOPS at a PART_OF node: the row arrives with its url and NO handles, so two runs pointing at one show contribute no pair through it | REWRITE: the rule is the core of the design, `recursivelyUnwrapMediaHandles` is not |
| `store/part-of.test.ts` (8) | an imdb handle reaches the aggregated media carrying its url; it is PART_OF however it was offered; the episode read takes SAME_AS uris only | REWRITE |
| `store/season-separation.test.ts` (15) | the four mechanisms that keep two seasons apart, IN FIRING ORDER, plus a deliberately pinned KNOWN GAP (a year-only silent side still welds to a season-3 cluster) | KEEP: mechanism-independent statements about outcomes |
| `store/season-weld.test.ts` (1) | the live Mushoku Tensei S1/S3 weld: search path plus media path must leave two media | KEEP: the regression that justifies the whole scope split |
| `store/stable-id.test.ts` (8) | `_id` survives growth from either side, survives the container cut, an old id still resolves the grown cluster, run and container ids differ, media and episode spaces never share an id | REWRITE: the behaviour is the urql cache contract, `IDENTITY_LABELS` and `graph.componentId` are internals |

Worker totals: KEEP 9, REWRITE 15, DROP 1.

### 5.2 `tests/unit/router/` (4 files)

| file | what it pins | verdict |
| --- | --- | --- |
| `episode-origins.test.ts` (4) | which origins an episode row may show: SAME_AS handles only, never the uri, because a single-member episode cluster has a raw uri | KEEP |
| `scroll-reset.test.ts` (19) | every navigation the app makes against the scroll rule (a canonical uri replacing the address must not move the page) | KEEP |
| `search-display.test.ts` (6) | the display-mode codec in localStorage | KEEP |
| `search-params.test.ts` (27) | the search url codec: filters, genres, seasons, years, headings | KEEP |

### 5.3 `tests/unit/sources/` (45 files)

Source-level normalization. Only five reach into `src/worker/store/**` at all (grep for `worker/store`):
`offline/seed-source.test.ts`, `offline/seed-build.test.ts`, `offline/seed.test.ts`,
`omdb/extractor.test.ts` and `watchmode/extractor.test.ts`, and the last two only in comments.

| file | what it pins | verdict |
| --- | --- | --- |
| `aired-date.test.ts` (10) | which date answers `startDate`, AniList's FuzzyDate first | KEEP |
| `anilist/extractor.test.ts` (16) | the Crunchyroll mapper asks `ctx.similarMedia` instead of walking another source's API | KEEP |
| `anilist/frontend.test.ts` (20) | the frontend session, token extraction, the GraphQL url | KEEP |
| `appletv/extractor.test.ts` (11) | a bare Apple content id goes out scoped CONTAINER; a film or season-scoped row is a RUN | KEEP |
| `average-score.test.ts` (5) | `averageScore` is 0 to 100 in every source that fills it | KEEP |
| `catalogue-gate.test.ts` (29) | the search gate: title ranking, `CONFIDENT_TITLE_THRESHOLD`, closest season by air date | KEEP |
| `crunchyroll/extractor.test.ts` (42) | a show id has no honest episode list; season-scoped ids; the 24-rows defect | KEEP |
| `crunchyroll/timeline-seek.test.ts` (6) | the player's timeline seek | KEEP |
| `crunchyroll/title-gate.test.ts` (13) | the search gate threshold, kept in step with the extractor's | KEEP |
| `index.test.ts` (5) | the exported source list IS what runs, so a disabled source cannot be silently re-enabled | KEEP |
| `jikan/extractor.test.ts` (19) | MAL's two AniDB link shapes and the ids they yield | KEEP |
| `jikan/season-scrape.test.ts` (21) | the MAL season page scrape against real bytes | KEEP |
| `justwatch/extractor.test.ts` (18) | show-level offers ride PART_OF; the season suffix that wrote JustWatch's numbering into Netflix's id space is gone | KEEP |
| `justwatch/id.test.ts` (23) | one node carrying three seasons must not hand all three the same id | KEEP |
| `kitsu/extractor.test.ts` (5) | a streaming link on a season record is the SHOW's url | KEEP |
| `kitsu/season-paging.test.ts` (7) | `page[offset]` paging | KEEP |
| `kitsu/season-request.test.ts` (9) | which season the walk asks for and what the rows may claim | KEEP |
| `kitsu/stream-id.test.ts` (10) | `streamPointers` scope and id per url shape | KEEP |
| `mal-image.test.ts` (5) | the large-image spelling upgrade | KEEP |
| `next-airing.test.ts` (4) | the next airing read by TIMESTAMP, never by position | KEEP |
| `offline/index-lookup.test.ts` (11) | the delta-encoded id index | KEEP |
| `offline/normalize.test.ts` (18) | manami record to media | KEEP |
| `offline/season-order.test.ts` (3) | the bundled season must not paint the alphabet | KEEP |
| `offline/season-popularity.test.ts` (3) | the owner's cold-page target order | KEEP |
| `offline/season-window.test.ts` (13) | six season buckets; a season the build does not hold answers NOTHING | KEEP |
| `offline/seed-build.test.ts` (17) | the builder against `StoreExport` literals shaped exactly as `worker/store/export.ts` emits them | REWRITE if the export envelope changes, else KEEP; it names `ExportedCluster`/`StoreExport` types (`:9`) |
| `offline/seed-gate.test.ts` (27) | the publish gate, each check with a control that passes and a mutation that must fail exactly once | KEEP |
| `offline/seed-popularity.test.ts` (3) | the seed carries popularity or the feature cannot work | KEEP |
| `offline/seed-release.test.ts` (5) | the runtime's release coordinates and the workflow's stay one fact | KEEP |
| `offline/seed-source.test.ts` (20) | a live row beats a seed row in BOTH arrival orders; every fetch failure leaves the bundle answering as before. Drives rows through the REAL store (`:20-24`) | REWRITE: the guarantee is contract, the driving is through `upsertMedia`/`aggregateMedia`/`normalizeToStoreMedia` |
| `offline/seed.test.ts` (9) | seed.ts's mirrored enums against `worker/store/types` (`:12`) | KEEP if the enums stay, REWRITE if they move |
| `offline/seed-topn.test.ts` (3) | the top-N season walk scope | KEEP |
| `omdb/extractor.test.ts` (8) | an IMDb media is show level by construction and must not hang every season's episodes | KEEP |
| `paramount/extractor.test.ts` (4) | `paramount:<slug>` names a show, so flattened seasons collide on `episodeNumber` | KEEP |
| `season.test.ts` (23) | `parseSeasonNumber`, `isOnlySeasonLabel`, `mediaSeasonNow` and friends | KEEP: read by the fuzzy pass and the consumer (`similar-consumer.ts:30`) |
| `similar.test.ts` (23) | the evidence rules themselves, pinned against the weld they replace | KEEP: the merge policy for the streaming-season case |
| `simkl/extractor.test.ts` (7) | a show's tmdb id on every run must not weld the five runs | KEEP |
| `supported.test.ts` (8) | publishes-under vs addressable-by, which decides who gets re-asked | KEEP |
| `tmdb/extractor.test.ts` (3) | a bare tmdb id goes out CONTAINER, only `-s<n>` names a run | KEEP |
| `trakt/extractor.test.ts` (6) | `trakt:<slug>` is a show, flattened seasons collide | KEEP |
| `tvdb/extractor.test.ts` (7) | same for `tvdb:<seriesId>` | KEEP |
| `tvmaze/extractor.test.ts` (13) | the bare, search and imdb-handle rows all go out CONTAINER | KEEP |
| `unogs/extractor.test.ts` (23) | a Netflix id with no season must answer NOTHING rather than the show | KEEP: this is the Netflix half of the motivating case |
| `utils.test.ts` (28) | `searchRelevance` normalization, `buildHandlesFromUri`, `mergeHandles` deduping on origin AND relation | KEEP: `mergeHandles` and `buildHandlesFromUri` are what feed the store |
| `watchmode/extractor.test.ts` (12) | provider deep links parsed by shape, not by last path segment | KEEP |

Sources totals: KEEP 42, REWRITE 2 (`offline/seed-source`, `offline/seed-build`), conditional 1
(`offline/seed.test.ts`, depends on whether `worker/store/types` survives).

### 5.4 Grand totals

| bucket | KEEP | REWRITE | DROP | files |
| --- | --- | --- | --- | --- |
| `tests/unit/worker/` | 9 | 15 | 1 | 25 |
| `tests/unit/router/` | 4 | 0 | 0 | 4 |
| `tests/unit/sources/` | 42 | 3 (one conditional) | 0 | 45 |
| **total** | **55** | **18** | **1** | **74** |

### 5.5 Adjacent tests outside the three directories that also pin store output

Named because a redesign will break them and they are easy to miss:

- `tests/unit/urql-keys.test.ts`: the keying config, which is the only thing that forces `Media._id` and
  `Episode._id` to exist and every edge type to key `null` (`src/urql-keys.ts:8-15`).
- `tests/unit/utils/uri.test.ts` and `tests/unit/utils/uri-aggregated.test.ts`: the `ag:(...)` grammar,
  `shouldGrowAddress`, `decodeRouteUri`, `originsOfUri`, all of which the store mints or reads.
- `tests/unit/utils/franchise-layout.test.ts`, `relation-lanes.test.ts`, `relation-labels.test.ts`,
  `listed-media.test.ts`, `theater.test.ts`, `theater-hold.test.ts`, `thumbnails.test.ts`,
  `release-date.test.ts`: the UI side of `relations`, `franchise`, `nextAiringEpisode`, `covers`,
  `thumbnails` and `releaseDate`.

---

## 6. The short list of contracts a replacement must not silently drop

1. `Media._id` is stable across cluster growth and distinct per identity space; it is the urql cache key
   (`src/urql-keys.ts:17`, `tests/unit/worker/store/stable-id.test.ts`).
2. `Media.uri` is `ag:(<sorted routable member uris>)`, is a shareable route, and only grows
   (`aggregate.ts:296-304`, `src/utils/uri.ts:143-149`, `src/party/protocol.ts:28`).
3. `Media.handles` carries BOTH relations, SAME_AS members first, each with `node.url`, plus every
   PART_OF target read by the store rather than by the caller (`aggregate.ts:361-367`).
4. Episodes are read across SAME_AS ONLY, and grouped by `episodeNumber` alone within ONE run
   (`aggregate.ts:96-104`, `db.ts:457-474`, `media/index.ts:181-217`).
5. A read that returns an empty cluster yields NOTHING, so the event must arrive later or the page stays
   blank (`media/index.ts:72`, `:81-87`).
6. A listing read with no known uris must fall back to the WHOLE STORE, filtered, or a filter change on
   a warm store never repaints (`media/index.ts:112-129`).
7. `media:changed` fires only when something was actually new; `episode:changed` and `origin:changed`
   fire unconditionally today (`db.ts:200`, `:414`, `:520`).
8. The fan-out discards source payloads; the store is the only join (`extractor.ts:750-759`, `:833`).
9. Sources can read the store back mid-resolve and block on it (`waitForMedia`, `src/sources/utils.ts`).
10. `exportStore` publishes ASSERTED pairs only, never a fuzzy union, and never a plugin's rows
    (`export.ts:12-30`, `yoga.ts:52-62`).
