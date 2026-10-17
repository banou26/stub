# The current store, as it actually behaves

Scope: every file under `/home/banou/dev/stub/src/worker/store/`. Citations are `file:line` relative to
that directory unless a full path is given. Where a rule's reason is recorded in the code's own
comment, the comment is quoted or cited rather than paraphrased into a new justification.

The store is a **module singleton, entirely in memory, with no persistence layer**: `db.ts:82` creates
one `graph` at module load and `db.ts:83` one `originMap`. Nothing in `src/worker/` writes to
IndexedDB, `localStorage`, or any file (grep over `src/worker/` for `indexedDB|localStorage|persist`
returns only two unrelated GraphQL doc comments). A reload rebuilds the whole graph by re-asking every
source. `resetStore` (`db.ts:509`) exists for tests only and its doc says so: "Not exported through
./index.ts, and never called by the app: a live reset would drop every cluster mid-session with no way
to rebuild them short of re-asking every source."

`index.ts` re-exports only `./types`, `./events`, `./db`, `./aggregate`, `./export` (`index.ts:1-5`).
`graph.ts`, `consensus.ts`, `fuzzy-merge.ts`, `anomalies.ts`, `normalize.ts`, `filter.ts` are imported
by deep path by their callers.

---

## 1. Every exported symbol

Callers listed below are the result of grepping `/home/banou/dev/stub/src`, `/tests` and `/scripts`.
`tests/store.ts` is a hand-rolled chai harness (`tests/store.ts:1-8`, exports `test = async () => ...`),
not a vitest file; it is listed where it calls a symbol.

### `types.ts` (pure type/enum surface, no behaviour)

| symbol | line | what it is |
| --- | --- | --- |
| `mediaTypeEnum` / `MediaType` | `types.ts:3-4` | `TV, TV_SHORT, MOVIE, ANIME, SPECIAL, OVA, ONA, LIVE_ACTION`. Read by `fuzzy-merge.ts:58,74`. |
| `mediaSeasonEnum` / `MediaSeason` | `types.ts:13-14` | UPPER CASE four seasons, deliberately a different spelling from `ANIME_SEASONS` in `sources/season.ts`: "`upperSeason` and `lowerSeason` in that file are the only bridge between the two spellings; do not add a third" (`types.ts:9-11`). |
| `mediaStatusEnum` / `MediaStatus` | `types.ts:16-17` | |
| `mediaCategoryEnum` / `MediaCategory` | `types.ts:19-20` | `ANIME, SERIES, MOVIE`. |
| `handleRelationEnum` / `HandleRelation` | `types.ts:28-29` | `SAME_AS, PART_OF`. "SAME_AS is the only one that unions" (`types.ts:26`). |
| `mediaRelationEnum` / `MediaRelation` | `types.ts:38-42` | 13 narrative relations. "nothing here may ever union a cluster, because a sequel is a different work" (`types.ts:34-35`). |
| `Relation` | `types.ts:52-65` | One narrative edge stored FLAT (uri, origin, id, url, titles, covers, status, episodeCount, startDate, format). Deliberately not a nested `Media`: "Storing the other end as a `Media` would put a second copy of a work into the store's own space, where the clustering would then have to decide what it is" (`types.ts:47-49`). |
| `FranchiseNode`, `FranchiseEdge`, `Franchise` | `types.ts:68-78` | A source's own whole-series graph, when it supplies one. |
| `mediaScopeEnum` / `MediaScope` | `types.ts:87-88` | `RUN, CONTAINER`. "Sameness unions only within one scope; a claim across scopes is derived as PART_OF" (`types.ts:84-85`). |
| `Title`, `Description`, `ShortDescription`, `AiringEpisode`, `Cover`, `Banner`, `Trailer`, `Thumbnail` | `types.ts:90-99` | Each scored variant carries an optional `score`. |
| `Media` | `types.ts:101-132` | The stored media row: 26 fields including `scope`, `relations`, `franchise`. |
| `Episode` | `types.ts:134-151` | Stored episode row, carries `mediaUri`, `seasonNumber`, `episodeNumber`, `absoluteEpisodeNumber`. |
| `Origin` | `types.ts:153-160` | `id, url, name, icon, color, isApiOnly`. |

### `graph.ts`

**`createUnionFind(): UnionFind`** (`graph.ts:56`)
Rank-balanced union-find with path compression plus a materialized `components: Map<root, Set<member>>`
so `component(x)` is O(1) after `find`. `union` returns whether the two roots differed
(`graph.ts:82-105`). No `split`, no `unlink`: **there is no inverse**, a fact cited in four places
(`db.ts:12`, `db.ts:171`, `fuzzy-merge.ts:127`, `anomalies.ts:22`).
Callers: `createGraph` only (`graph.ts:151`). Not imported anywhere outside `store/` (grep found none).

**`createGraph<T>(): Graph<T>`** (`graph.ts:123`)
The whole store engine. Holds `nodes`, `aliases`, per-label `undirected` / `directed` / `reversed`
adjacency, per-label `unionFinds`, `componentIds`, `nodeLabels`, `labelIndex`, `mergers`
(`graph.ts:124-141`).
Callers: `db.ts:82` (the singleton), `tests/store.ts:92,94,117,131,136,149`,
`tests/unit/worker/store/graph.test.ts:6,33,40,54,61`.

Its method contracts, since these are the primitives the replacement has to reproduce:

- `set(key, value, {addLabels, removeLabels})` (`graph.ts:155`): computes the effective label set,
  **throws** if more than one effective label carries a merge function (`graph.ts:166-168`), applies
  `merge(incoming, existing)` when a row already exists, and rewrites the label index.
- `registerLabel(label, {merge})` (`graph.ts:193`). Called twice at module load, `db.ts:85-86`.
- `setLabel(key, ...labels)` (`graph.ts:202`): no-op when the node does not exist. **No production
  caller anywhere**; the only call in the tree is `tests/store.ts:138`.
- `labeled(label)` (`graph.ts:213`): the label index set. Used by `db.ts:261` and `export.ts:34-35`.
- `get` / `has` (`graph.ts:217,221`): **both fall through the alias table**. The comment at
  `graph.ts:133-135` records why the alias table may only ever hold component uuids: "a uri alias
  would make `upsertMedia`'s novelty test and its pendingClaims gate report a row that was never stored."
- `alias(a, key)` / `resolve(key)` (`graph.ts:225,227`).
- `link(a, b, label)` (`graph.ts:279`): `connect` + union, and **carries the component id**. Returns
  whether the undirected pair is NEW (not whether a union happened).
- `connect(a, b, label)` (`graph.ts:265`): adjacency only, no union. "an adjacency records WHO said
  what about which pair, where a union-find records only the component and can never be asked what it
  would hold with one node removed" (`graph.ts:30-32`).
- `neighbours(key, label)` (`graph.ts:275`): used by `export.ts:54,75` and by
  `tests/unit/worker/store/graph.test.ts:35,36,45,56,57,64`. `connect` has one production caller,
  `db.ts:192`. `root(key,label)` has none outside `componentId`; tests read it at
  `tests/unit/worker/store/stable-id.test.ts:80,135,136`.
- `root(key, label)` (`graph.ts:229`).
- `componentId(key, label)` (`graph.ts:234`): see invariant 6 below. **Mints a uuid and writes an
  alias.** Callers: `aggregate.ts:294`.
- `edge(from, to, label)` (`graph.ts:297`): directed, maintains the reverse index, returns whether NEW.
  "Returns whether the edge is NEW, the same contract `link` above has ... so a source re-minting the
  same handle emitted `media:changed` forever and every listener re-read the store for a graph that
  had not moved" (`graph.ts:293-296`).
- `targets` / `sources` (`graph.ts:308,312`).
- `cluster(start, label)` (`graph.ts:316`): the union-find component's stored rows, or `[start]`'s row
  when the label's union-find has never seen `start`. **Iteration order is component insertion order**,
  i.e. surviving root's members then absorbed root's members, i.e. HTTP arrival order
  (`fuzzy-merge.ts:243-245` records exactly this).
- `clusters(label, nodeLabel?, uris?)` (`graph.ts:332`): seeds are `uris.map(resolve)`, else the
  `nodeLabel` index, else every node; deduped on root; empty groups dropped.
- `clear()` (`graph.ts:363`): drops nodes, aliases, all three adjacencies, union-finds, component ids
  and node labels, but **keeps the registered labels**, "because `registerLabel` runs once at module
  load in ./db.ts and a cleared registry would silently drop the merge functions that `set` looks up"
  (`graph.ts:372-374`).

**`lastWriteLongestArray<T>(incoming, existing): T`** (`graph.ts:388`)
"Merge strategy: scalars last-write-wins, arrays longest-wins." Implementation detail that matters:
the result starts as `{...existing}`, so a key present in `existing` and absent from `incoming`
survives; a scalar is `incoming[key] ?? existing[key]`, so an incoming `null` does not erase; an array
is kept from `existing` only when `existing.length > incoming.length` (strictly), so equal lengths take
the incoming array wholesale (`graph.ts:392-395`).
Callers: `db.ts:85`, `db.ts:86` (registered as the merge fn for the `media` and `episode` labels),
`db.ts:518` (used directly for `Origin`), `tests/unit/worker/store/graph.test.ts:6`.

**Types** `LabelOptions` (`graph.ts:1`), `SetOptions` (`graph.ts:5`), `UnionFind` (`graph.ts:10`),
`Graph` (`graph.ts:18`).

### `db.ts`

**`HAS_EPISODE_LABEL`** (`db.ts:50`), value `'has_episode'`. "The media -> episode edge label, for
./export.ts." Caller: `export.ts:3,83`.

**`IDENTITY_LABELS`** (`db.ts:53`) `{ RUN: 'media:same_as', CONTAINER: 'container:same_as', EPISODE:
'episode:same_as' }`. "for the one reader outside this file that needs them: the cluster id in
./aggregate.ts." Callers: `aggregate.ts:5,293-294`,
`tests/unit/worker/store/stable-id.test.ts:10`.

**`ASSERTED_LABELS`** (`db.ts:66`) `{ RUN: 'asserted:media_same_as', CONTAINER:
'asserted:container_same_as', PART_OF: 'asserted:media_part_of' }`. "A second, adjacency-only record of
every pair a SOURCE claimed through a handle, written by `upsertMedia` and by nothing else.
`./export.ts` is its only reader" (`db.ts:56-57`). Callers: `export.ts:3,54,67,75`.

**`graph`** (`db.ts:82`) the singleton `Graph<Media | Episode>`. Callers outside `store/`:
`tests/unit/worker/store/db.test.ts:3`, `tests/unit/worker/store/edge-idempotence.test.ts:11`,
`tests/unit/worker/store/stable-id.test.ts:10`. In-tree readers: `aggregate.ts:5,294`,
`export.ts:3,34,35,52,54,67,73,75,83,87`.

**`upsertMedia(newMedias: Media[], handles: Claim[]): Promise<void>`** (`db.ts:132`)
Stores each non-placeholder row with the scope ratchet applied, collects the claims that were waiting
on every uri that just landed, then derives a relation for each claim from the two scopes and writes it
as a union or as a directed edge. Emits `media:changed` once, only if anything was new.
Callers: `src/worker/extractor.ts:25,127` (the `mediaInserter` DataLoader),
`src/worker/similar-consumer.ts:18,255` (claim-only, no rows),
`tests/store.ts:9,11,25,35,46,61,168,188`,
`tests/unit/worker/store/arrival-order.test.ts:15,35`,
`tests/unit/worker/store/merge-fixtures.test.ts:12,68`,
`tests/unit/sources/offline/seed-source.test.ts:22,138`,
`tests/unit/worker/store/container-page.test.ts:9,26,36,76,88,107`,
`tests/unit/worker/store/stable-id.test.ts:10,29,32,36,43,45,52,53,64,90,96,111`,
`tests/unit/worker/store/part-of.test.ts:12`,
`tests/unit/worker/store/container-scope.test.ts:11`,
`tests/unit/worker/store/export.test.ts:9`,
`tests/unit/worker/store/episode-merge.test.ts:3`,
`tests/unit/worker/store/mushoku-parts.test.ts:12`,
`tests/unit/worker/store/edge-idempotence.test.ts:11`,
`tests/unit/worker/similar-consumer.test.ts:12`,
`tests/unit/worker/store/season-weld.test.ts:13`,
`tests/unit/worker/store/fuzzy-merge.test.ts:3`,
`scripts/measure-companion-marker.probe.ts:41,117,262,270`.

**`linkSameMediaPairs(pairs: [string,string][]): boolean`** (`db.ts:216`)
Unions each pair in the RUN space, **refusing any pair with a CONTAINER on either side**
(`db.ts:219`). Emits `media:changed` and returns whether anything was new. Doc records that this path
"did not [go through the same refusal] until 2026-09-05 ... a show-level origin that could never be
minted as SAME_AS by any source could still be welded here by a title match" (`db.ts:206-211`).
Callers: `fuzzy-merge.ts:5,664`, `tests/unit/worker/store/export.test.ts:9,58`,
`tests/unit/worker/store/part-of.test.ts:12,144,155`,
`tests/unit/worker/store/container-scope.test.ts:11,101,125,136`.

**`linkSameContainerPairs(pairs): boolean`** (`db.ts:231`)
Mirror of the above in the CONTAINER space; refuses a pair with a RUN on either side (`db.ts:234`).
Callers: `fuzzy-merge.ts:5,663`, `tests/unit/worker/store/container-scope.test.ts:11,102`.

**`linkPartOfPairs(pairs: [runUri, containerUri][]): boolean`** (`db.ts:247`)
Writes the directed `media:part_of` edge, **only when the scopes are exactly RUN then CONTAINER in that
order**: "anything else is refused rather than flipped, since a caller that got the order wrong may have
the scopes wrong too" (`db.ts:244-245`). Note it writes only `MEDIA_PART_OF`, never
`ASSERTED_LABELS.PART_OF`, so a fuzzy containment is invisible to `exportStore`.
Callers: `fuzzy-merge.ts:5,661`, `tests/unit/worker/store/container-scope.test.ts:103,108`.

**`findAggregatedMedia(uri: string): Promise<Media[]>`** (`db.ts:257`)
Resolves the alias, refuses anything not in the `media` label index ("the alias table carries EPISODE
cluster ids too", `db.ts:259-260`), then returns `graph.cluster` in the identity space of the resolved
uri's own scope (`db.ts:263`).
Callers: `src/worker/extractor.ts:25,82,86` (through `findAggregatedMediaForContext`, which is handed
to every extractor as `ctx.findAggregatedMedia`, `src/worker/extractor.ts:535`, and reached from
`waitForMedia` in `src/sources/utils.ts`), `src/worker/resolvers/media/index.ts:8,199`,
`src/worker/similar-consumer.ts:18,239`, `fuzzy-merge.ts:5,648-649`, plus twelve test files and
`scripts/measure-*.probe.ts`.

**`findPartOfMedia(cluster: Media[]): Media[]`** (`db.ts:276`)
Every `media:part_of` target of every cluster member, **each expanded to its own whole cluster in its
own space**, deduped by uri, and dropping any target whose cluster intersects the source cluster ("A run
is not part of itself ... the union is the stronger statement", `db.ts:283-286`).
Callers: `aggregate.ts:5,315,366`, `src/worker/similar-consumer.ts:18,282`, and nine test files
(`arrival-order`, `container-page`, `seed-source`, `season-weld`, `fuzzy-merge`, `similar-consumer`,
`container-scope`).

**`findRunsOfContainer(cluster: Media[]): Media[][]`** (`db.ts:303`)
Reverse walk of `media:part_of` from every container member, keeping only sources whose scope is RUN,
one cluster per `keyOf` (lowest uri). "a container pointing at another container is a PART_OF claimed
between two shows, never a run of one" (`db.ts:300-301`).
Callers: `db.ts:336` (`preferAttachedRun`), `tests/unit/worker/store/container-page.test.ts:9,64`.

**`preferAttachedRun(cluster: Media[]): Media[]`** (`db.ts:334`)
If any member is a run, returns the cluster unchanged. Otherwise returns the container's first attached
run, ordered by earliest parseable `startDate` then by `keyOf` (`db.ts:319-323,338`). "a show page with
no episode and no offer is what splitting the spaces cost until this" (`db.ts:329-330`).
Callers: `db.ts:363`, `tests/unit/worker/store/container-page.test.ts:9,72`.

**`findMediaForPage(uri: string): Promise<Media[]>`** (`db.ts:349`)
`findAggregatedMedia(uri)`; if empty and the uri is aggregated, tries each handle uri in order,
**preferring the first that names a RUN** and otherwise keeping the first non-empty result; then applies
`preferAttachedRun`.
Callers: `src/worker/resolvers/media/index.ts:8,71`,
`tests/unit/worker/store/container-page.test.ts:9,48,52,81,82,98,100`.

**`findAllAggregatedMedia(uris?: string[]): Promise<Media[][]>`** (`db.ts:374`)
Run clusters first (run-space components with at least one non-CONTAINER member), then container
clusters cut down to CONTAINER members no run cluster already lists; emptied container clusters are
dropped (`db.ts:376-382`). When `uris` is given the node-label seed is dropped and the uris become the
seeds.
Callers: `src/worker/resolvers/media/index.ts:8,126,128`, `tests/store.ts:9,22,46,76,81`,
`arrival-order.test.ts:15,71,103`, `stable-id.test.ts:10,55`, `season-weld.test.ts:13,49,88`,
`fuzzy-merge.test.ts:3,381`, `container-scope.test.ts:10,72`.

**`hideAttachedContainers(clusters: Media[][]): Media[][]`** (`db.ts:391`)
Drops a container-only cluster when any of its members is a PART_OF target of a run cluster **in the
same list**. "Run clusters always survive" (`db.ts:389`).
Callers: `src/worker/resolvers/media/index.ts:8,130`, `season-weld.test.ts:13,88`.

**`upsertEpisodes(newEpisodes, handles): Promise<void>`** (`db.ts:400`)
Stores every episode, writes `has_episode` from `episode.mediaUri`, then links `episode:same_as` for
SAME_AS handles and writes an `episode:part_of` edge otherwise. **Emits `episode:changed`
unconditionally** (`db.ts:414`), with no `changed` guard, unlike `upsertMedia`.
Callers: `src/worker/extractor.ts:25,145`, `tests/store.ts:168,189`, `seed-source.test.ts:22,140`,
`similar-consumer.test.ts:12,55,61`, `merge-fixtures.test.ts:12,73`, `stable-id.test.ts:10,154,164`,
`episode-merge.test.ts:3,103`, `export.test.ts:9,87`.

**`findRunEpisodes(cluster: Media[]): Promise<Episode[][]>`** (`db.ts:424`)
`findAggregatedEpisodesForMedia(cluster uris)`, then `alignRunEpisodes` over the flattened groups, then
`runEpisodes` per group with the aligned copies substituted, dropping emptied groups. "Takes the cluster
rather than the uris, because the decision is made on what each member says its own length is, and a uri
does not carry that" (`db.ts:421-422`).
Callers: `src/worker/resolvers/media/index.ts:8,203`, `merge-fixtures.test.ts:12,92`.

**`findAggregatedEpisodesForMedia(mediaUris: string[]): Promise<Episode[][]>`** (`db.ts:432`)
Collects every `has_episode` target of every uri (deduped), groups them by `episode:same_as` component,
then runs `mergeByEpisodeNumber`. **No windowing, no alignment.**
Callers: `src/worker/resolvers/media/index.ts:8,204` (the fallback branch),
`src/worker/similar-consumer.ts:18,284`, `tests/store.ts:168,194`, `seed-source.test.ts:160`,
`episode-merge.test.ts:3,111`.

**`mergeByEpisodeNumber(groups: Episode[][]): Episode[][]`** (`db.ts:475`)
Folds two groups together when they carry the same positive integer `episodeNumber`. "SAFE ONLY BECAUSE
THE INPUT IS ONE RUN ... two runs of a show both have an episode 1, which is why nothing may read
episodes across a PART_OF and why this must never be handed a container's uris" (`db.ts:465-468`). Keyed
on the number alone and never on the season, "Sources disagree about which season a run belongs to
(anizip says 2 where kitsu says nothing)" (`db.ts:470-472`). A group with no usable number is passed
through untouched, so specials stay separate.
Callers: `db.ts:454`, `tests/unit/worker/store/episode-merge.test.ts:3,19,25,34,43,49,58,68,76,83`.

**`resetStore(): void`** (`db.ts:509`) clears `graph`, `originMap`, `pendingClaims`. Tests only; the
reason it exists is in the doc block (`db.ts:498-508`): the fixtures carry REAL ids, so without a reset
"the second case inherits the first case's welds and passes or fails for reasons that are not in it."
Callers: 15 test files, all in `beforeEach` or at case boundaries.

**`upsertOrigins(newOrigins: Origin[]): Promise<void>`** (`db.ts:515`)
`lastWriteLongestArray(origin, existing)` into `originMap`, then emits `origin:changed`
unconditionally. Caller: `src/worker/extractor.ts:25,155`.

**`findOrigin(id): Promise<Origin | null>`** (`db.ts:523`). Callers:
`src/worker/resolvers/origin/index.ts:7,28,35,40`.

**`findOrigins(ids, filters?): Promise<Origin[]>`** (`db.ts:527`)
Named ids in argument order, else every origin sorted by `name.localeCompare`; then
`IS_API_ONLY` / `IS_NOT_API_ONLY` filtering with `filters.every(...)` (so the two together always
return empty). Callers: `src/worker/resolvers/origin/index.ts:7,59,65,69`.

### `aggregate.ts`

**`removeDuplicatesByField<T>(field, array): T[]`** (`aggregate.ts:67`) first-wins dedupe on one
property. Callers: `aggregate.ts:392,397,446` only; no caller found outside the file.

**`sameAsHandleUris(handles): string[]`** (`aggregate.ts:103`)
Filters handles to `relation === 'SAME_AS'` and maps to `node.uri`. Exported so it can be pinned:
"that resolver cannot be imported under vitest (it reaches urql, which is CommonJS) and an untestable
filter on the most dangerous read in the tree is not good enough" (`aggregate.ts:94-96`). The danger is
spelled out at `aggregate.ts:97-101`: a PART_OF node is a SHOW, `unogs/extractor.ts` hangs every
season's episodes off it each renumbered 1..n, "the 24-rows-on-a-14-episode-season defect, arriving by a
new road."
Callers: `src/worker/resolvers/media/index.ts:11,183`,
`tests/unit/worker/store/part-of.test.ts:11,124,125,127`.

**`recursivelyUnwrapMediaHandles(media: GQLMedia): GQLMedia[]`** (`aggregate.ts:135`)
Flattens a media and its handle subtree into rows. **The walk stops at a PART_OF node**, replacing it
with `{...node, handles: []}` (`aggregate.ts:145-146`). Memoized in a `WeakMap` (`aggregate.ts:106,136,150`).
A handle with no node is warned about and skipped (`aggregate.ts:141-143`). The reason is the two-season
weld through a shared container id, written out as a worked example at `aggregate.ts:115-133`.
Callers: `src/worker/extractor.ts:26,107`, `arrival-order.test.ts:14,31`, `export.test.ts:8,36`,
`seed-source.test.ts:20,134`, `part-of-subtree.test.ts:10,28,37,53,67,76,92`.

**`aggregateMedia(medias: Media[], locationOrigin: string): GQLMedia`** (`aggregate.ts:306`)
Throws on an empty cluster. See section 4 for the field-by-field contract.
Callers: `src/worker/extractor.ts:26,91`, `src/worker/resolvers/media/index.ts:11,73,131`,
`seed-source.test.ts:20,322,349,369`, `stable-id.test.ts:8,27,60,138,139`, `part-of.test.ts:11,28`,
`normalize.test.ts:5,63-78`, `aggregate-fields.test.ts:8,37-161`.

**`aggregateEpisode(episodes: Episode[], locationOrigin: string): GQLEpisode`** (`aggregate.ts:401`)
Same shape for episodes. Callers: `src/worker/resolvers/media/index.ts:11,216`,
`seed-source.test.ts:20,167`, `stable-id.test.ts:8,155,165`.

Non-exported helpers whose behaviour is observable through `aggregateMedia`:
`reconcileCategories` (`aggregate.ts:9`), `byScore` (`aggregate.ts:18`), `seasonOf` (`aggregate.ts:47`),
`dedupeLabels` (`aggregate.ts:55`), `sameAsHandle`/`partOfHandle`/`sameAsEpisodeHandle`
(`aggregate.ts:86-88`), `mediaToGQL` (`aggregate.ts:154`), `relationToGQL` (`aggregate.ts:197`),
`mergeRelations` (`aggregate.ts:249`), `scopeOfCluster` (`aggregate.ts:264`), `episodeToGQL`
(`aggregate.ts:267`), `clusterId` (`aggregate.ts:293`), `buildAggregatedIdentity` (`aggregate.ts:296`).

### `consensus.ts`

**`tieredConsensus<T>(claims): { value: T, tier: number } | undefined`** (`consensus.ts:36`)
Drops null claims, takes the **maximum** score as the tier, counts support among claims at exactly that
tier, and returns the most-supported value. Ties inside a tier go to the LARGER value
(`consensus.ts:53-56`). An unscored row is `score ?? 0`, "its own tier at the bottom" (`consensus.ts:42-43`).
Callers: `consensus.ts:63,158`, `tests/unit/worker/store/consensus.test.ts:4,25,27,69,70`.

**`runLength(cluster): number | undefined`** (`consensus.ts:62`) `tieredConsensus` over
`(episodeCount, score)`. Callers: `aggregate.ts:2,386`, `anomalies.ts:3,61`, `consensus.ts:261`,
`src/worker/similar-consumer.ts:19,174`, `consensus.test.ts:4,76,77,120,141,152,164,383`.

**`alignmentOffset(reference, other): number | undefined`** (`consensus.ts:113`)
See invariant 9. Callers: `consensus.ts:281`, `consensus.test.ts:4,222-279`.

**`runEpisodes<T extends Episode>(cluster, episodes): T[]`** (`consensus.ts:157`)
See invariant 9. Callers: `db.ts:4,428`, `consensus.test.ts:4,89-389`.

**`alignRunEpisodes<T extends Episode>(cluster, episodes): Map<string, T>`** (`consensus.ts:256`)
See invariant 9. Callers: `db.ts:4,426`, `consensus.test.ts:4,283-355`.

### `anomalies.ts`

**`Anomaly`** (`anomalies.ts:16`) `{ rule: string, detail: string }`.

**`clusterAnomalies(cluster, listed?): Anomaly[]`** (`anomalies.ts:71`)
`disagreeingIds` (`anomalies.ts:26`) plus `overLength` (`anomalies.ts:60`). "Every rule here is a
CONTRADICTION rather than a preference" (`anomalies.ts:13-14`).
Caller: `tests/unit/worker/store/merge-fixtures.test.ts:15,167` **only**. Nothing in `src/` reads
anomalies: they are a test-time sweep, not a runtime signal.

### `normalize.ts`

**`normalizeToStoreMedia(media: GQLMedia): StoreMedia`** (`normalize.ts:13`)
"Every nullable field lands as `null` rather than `undefined`, and `scope` defaults to RUN: a source
that says nothing about scope is naming a run, which is what every source did before scope existed.
Pure, and outside ../extractor.ts on purpose: that module reaches urql and cannot load under vitest, so
a field dropped here would go unpinned" (`normalize.ts:5-12`). Flattens `relations` from handle-shaped edges, dropping any edge
with no `node.uri` (`normalize.ts:42-58`), and copies `franchise` shallowly (`normalize.ts:59-77`).
Callers: `src/worker/extractor.ts:27,127`, `arrival-order.test.ts:16,35`, `export.test.ts:11,40`,
`seed-source.test.ts:24,138`, `normalize.test.ts:7,27,31-86`.
(The episode counterpart, `normalizeToStoreEpisode`, lives in `src/worker/extractor.ts:~50-70`, not in
the store.)

### `filter.ts`

**`MediaPageFilters`** (`filter.ts:17`) `categories, formats, status, season, seasonYear, genres, tags`.
`search` is deliberately absent: "it is scored with a wasm-backed similarity pass and is therefore
async, and folding it in would make every caller await a predicate that is otherwise pure"
(`filter.ts:12-13`).

**`applyMediaFilters<T>(medias, filters): T[]`** (`filter.ts:54`)
See section 4. Callers: `src/worker/resolvers/media/index.ts:9,137`,
`tests/unit/worker/store/filter.test.ts:7,16-143`.

### `export.ts`

**`ExportedCluster`** (`export.ts:5`) `{ members: Media[], partOf: Media[], episodes: Episode[] }`.
**`StoreExport`** (`export.ts:6`) `{ exportedAt: string, excludedOrigins: string[], clusters: ExportedCluster[] }`.
**`ExportOptions`** (`export.ts:7`) `{ excludeOrigins: string[], passThroughOrigins?: string[], uris?: string[] }`.
**`exportStore(options): Promise<StoreExport>`** (`export.ts:31`) See section 4.
Callers: `src/worker/yoga.ts:11,54-55` (`osraResolvers.exportStore`, which appends every plugin origin
to `excludeOrigins` itself: "the plugin origins are derived HERE rather than taken from the caller, so a
caller cannot decline to exclude them", `src/worker/yoga.ts:52-53`), reaching the page through
`src/worker.ts:32,48` and `src/store-export.ts:8,17` (`window.__stubExportStore`, only present when
`readExportFlag` passes); `tests/unit/worker/store/export.test.ts:10,45,78,89,91,100,144,145,163`.

### `events.ts`

**`emit<K>(type, detail): void`** (`events.ts:9`) dispatches a `CustomEvent` on a module-level
`EventTarget` (`events.ts:7`). Callers: `db.ts:3,200,222,237,253,414,520`. No caller outside `store/`.

**`listen<K>(type, callback): () => void`** (`events.ts:19`) "Exported so a test can COUNT emissions:
`media:changed` re-runs the fuzzy merge and every subscribed page, so an upsert that reports a change it
did not make is not free" (`events.ts:16-18`). Callers: `events.ts:79,116,134`,
`tests/unit/worker/store/edge-idempotence.test.ts:36`.

**`listenIterator<K>(type, options?)`** (`events.ts:72`) buffers details.
Callers: `src/worker/resolvers/origin/index.ts:8,31,61`.

**`listenMultipleIterator(types, options?)`** (`events.ts:110`) fires once per event across several
types, value `void`, coalescing to a single pending flag (`events.ts:38-45`).
Callers: `src/worker/extractor.ts:28,100`, `src/worker/resolvers/media/index.ts:12,40`.

**`debouncedListenIterator(types, debounceMs, options?)`** (`events.ts:124`)
Caller: `src/worker/resolvers/media/index.ts:12,108` with `100` ms.

`StoreEventMap` (`events.ts:1-5`) declares `{ uris?: string[] }` / `{ ids?: string[] }` details, but
**every emit site passes `{}`** (`db.ts:200,222,237,253,414,520`), so no listener ever learns which
rows moved. That is the reason `mediaPage` re-reads the whole store on every event.

### `fuzzy-merge.ts`

**`profileCluster(cluster: Media[]): ClusterProfile`** (`fuzzy-merge.ts:282`)
"Everything the pass reads off a cluster. Nothing here may depend on the order of `cluster`"
(`fuzzy-merge.ts:281`). Produces `{cluster, key, scope, linkUri, titles, years, days, formats, types,
seasons, cacheKey}`.
Callers: `fuzzy-merge.ts:595,651,652`, `scripts/measure-start-date-window.probe.ts:40,142`,
`scripts/measure-companion-marker.probe.ts:42,142,144`,
`tests/unit/worker/store/fuzzy-merge.test.ts:4`.

**`fuzzyMergeMediaClusters(clusters: Media[][]): Promise<boolean>`** (`fuzzy-merge.ts:594`)
See invariant 10. Returns whether any link was applied.
Callers: `src/worker/resolvers/media/index.ts:10,127` (the only production caller, inside
`mediaPage`), `tests/store.ts:47,79,88`, `merge-fixtures.test.ts:14,79`, `mushoku-parts.test.ts:13,54`,
`season-weld.test.ts:15,49`, `season-separation.test.ts:34,58-266`, `fuzzy-merge.test.ts:4,26-413`,
`scripts/measure-start-date-window.probe.ts:40,112`, `scripts/measure-companion-marker.probe.ts:42,253,263,271`.

---

## 2. The invariants

### 2.1 The three identity spaces

`MEDIA_SAME_AS = 'media:same_as'` and `CONTAINER_SAME_AS = 'container:same_as'` (`db.ts:14-15`),
`EPISODE_SAME_AS = 'episode:same_as'` (`db.ts:45`). Each label owns its own union-find (`graph.ts:149-153`).

The recorded reason, verbatim (`db.ts:7-13`):

> Two identity spaces, one per scope. A run's SAME_AS unions in the first, a container's in the second,
> and nothing ever unions across them: a show-level id entering a run's cluster is what welded Mushoku
> Tensei season 1 to season 3 on the live site (the bare crunchyroll series id and the bare tvmaze show
> id were fuzzy merged into season 1's cluster on the search path, and season 3's media path then
> asserted sameness through one of them; `graph.link` is a union-find with no inverse).

`sameAsLabelFor(scope)` (`db.ts:94`) is the single mapping. Every read picks the space from the resolved
uri's scope: `findAggregatedMedia` (`db.ts:263`), `findPartOfMedia` (`db.ts:282`).

Cross-scope sameness is **derived, never stored as sameness**. The derivation table is in the code
(`db.ts:166-169`):

```
RUN x RUN              claimed SAME_AS unions in the run space, PART_OF is an edge
RUN x CONTAINER        an edge media -> handle, whatever was claimed
CONTAINER x RUN        an edge handle -> media: the edge always runs from run to container
CONTAINER x CONTAINER  claimed SAME_AS unions in the container space, PART_OF is an edge
```

"Guesses go on edges, which are deletable; only asserted sameness within one scope goes on a union"
(`db.ts:171`). `MEDIA_PART_OF = 'media:part_of'` is a directed `graph.edge`, never a label of its own
union-find, because "a PART_OF cluster is a thing nobody wants: it would merge every run of a show with
every other run that pointed at the same container" (`db.ts:73-78`).

`SHOW_LEVEL_ORIGINS = new Set(['imdb'])` (`db.ts:42`) is a backstop that forces a uri of that origin to
read as CONTAINER whatever row it arrived in (`db.ts:91-92`). The comment records the whole history:
an IMDb `tt` id is the series, five sources emit it (tvmaze, trakt, simkl, omdb, watchmode), it used to
be demoted to PART_OF and is now scoped instead, and it is kept "as a backstop rather than being deleted
with the producers migrated: it is one Set lookup, and it means a source that starts emitting a bare imdb
id again is corrected here instead of welding every season of a show" (`db.ts:17-41`).

### 2.2 The scope ratchet

`db.ts:146`:

```ts
const scope: MediaScope = scopeOf(media.uri) === 'CONTAINER' ? 'CONTAINER' : media.scope ?? 'RUN'
```

Comment (`db.ts:142-145`): "Scope is STICKY toward CONTAINER: once any row for this uri said CONTAINER,
a later row that says RUN or says nothing does not flip it back. The failure with no inverse is a wrong
SAME_AS, and the failure of a wrong CONTAINER is a missing SAME_AS, which a later slice can recover. The
merge function alone would let an incoming RUN overwrite it (scalars are last-write-wins)."

`scopeOf` (`db.ts:91-92`) reads the backstop first, then the stored row, then defaults to RUN. The
default only ever applies to a stored row that said nothing, because a uri with no row never reaches a
union or an edge (`db.ts:88-90`).

At cluster level the ratchet inverts: `scopeOfCluster` (`aggregate.ts:264-265`) and
`profileCluster`'s scope (`fuzzy-merge.ts:285`) both say **a cluster is a CONTAINER only when every
member is** ("a legacy mixed cluster still names a run").

### 2.3 The placeholder rule

`IDENTITY_FIELDS = new Set(['uri', 'origin', 'id', 'scope'])` (`db.ts:104`); `isPlaceholder`
(`db.ts:105-108`) is true when the row is not CONTAINER and every other field is null or an empty array.
`upsertMedia` skips such a row outright (`db.ts:140`).

Reason (`db.ts:99-103`): "The fields that NAME a row rather than describe it. A row carrying nothing else
is a placeholder rebuilt from a uri (`buildHandlesFromUri` in sources/utils.ts mints one per sibling of
an aggregated uri), and a uri says nothing about what it names: the row would contribute no field to a
merge and its scope is `makeMedia`'s default. So it is not stored, and a claim naming it waits for a row
that is. A CONTAINER stamp counts as a description, since it is a source's own reading of the id."

### 2.4 Pending claims

`pendingClaims: Map<uri, Map<claimKey, Claim>>` (`db.ts:124`), `claimKey = mediaUri\0handleUri\0relation`
(`db.ts:111`), `defer` (`db.ts:126-130`).

A claim naming any uri with no stored row is deferred **for every such uri** (`db.ts:179-182`) and
replayed when a row for it lands new (`db.ts:154-160`). Only genuinely new, non-placeholder rows enter
`landed` (`db.ts:140,148-151`), so a placeholder arriving for a deferred uri does not release its claims.

Reason (`db.ts:113-123`), verbatim in part: "The relation is derived from BOTH scopes, and a uri with no
row has none. It used to read as RUN, which let a run union with a show whose own row was still in
flight ... A RUN row for `cr:G24H1N3MP` minted by justwatch milliseconds before crunchyroll said
CONTAINER was a RUN x RUN union, the CONTAINER that followed flipped the scope and not the union, and the
same graph then answered differently depending on which member it was entered through. A claim now waits
for the row and is applied when it lands."

`similar-consumer.ts` depends on this explicitly: its claim goes "through `upsertMedia` with no rows: the
answer's own row lands through the answering extractor's insertion, the claim waits for it under
`pendingClaims`" (`src/worker/similar-consumer.ts:273-276`).

There is **no expiry**: entries are removed only when the uri lands (`db.ts:158`) or by `resetStore`
(`db.ts:512`). A claim naming a uri no source ever describes is retained for the session.

### 2.5 `lastWriteLongestArray`

`graph.ts:388-399`, registered for `media` and `episode` (`db.ts:85-86`) and applied on every `graph.set`
where a row already exists (`graph.ts:170-175`). Scalars: incoming wins unless nullish. Arrays: the
**strictly longer** one wins, wholesale; there is no element-level union. Keys absent from the incoming
row survive from the existing one.

The consequence, not stated in the code but forced by it: when one source answers about one uri twice
with different subsets (a search row then a media-page row), the shorter array is discarded entirely
rather than merged, and no record of it remains.

`graph.set` throws when a node ends up with two merge-carrying labels (`graph.ts:166-168`), which is why
nothing may ever carry both `media` and `episode`.

### 2.6 `componentId` minting on read

`graph.ts:234-244`:

```ts
function componentId(key: string, label: string): string {
  const componentRoot = root(key, label)
  const slot = componentKey(label, componentRoot)
  let id = componentIds.get(slot)
  if (!id) { id = crypto.randomUUID(); componentIds.set(slot, id); aliases.set(id, componentRoot) }
  return id
}
```

**This is a write executed from the read path.** `aggregateMedia` calls it through `clusterId`
(`aggregate.ts:293-294,310,321,407,414`), so rendering a page mints a uuid and inserts an alias.

Doc (`graph.ts:39-44`): "A stable id for the component `key` belongs to under `label`: minted once per
component, carried across unions (the survivor keeps its id; when both sides had one the larger
component's wins, ties to the lexicographically smaller root, and the other id becomes an alias of the
survivor), and dropped by `clear`. Every id is aliased to its component so `resolve(id)` finds the
cluster."

`carryComponentId` (`graph.ts:249-263`) runs inside `link` (`graph.ts:288`). Which id survives is decided
"by SIZE and then by the smaller root, never by the union-find's own choice of root: that one follows
rank and argument order, so an id that followed it would change with the order two sources happen to land
in" (`graph.ts:246-248`). Both old ids are re-aliased to the survivor root (`graph.ts:260-262`), so an
`_id` handed out earlier keeps resolving.

The keying rule for `clusterId` (`aggregate.ts:290-292`): "Keyed on the union-find ROOT of the cluster's
identity space, never on a member: the smallest uri moved whenever a member sorting before it landed, and
the container cut in `findAllAggregatedMedia` handed the same cluster a second id."

The alias table may hold **only** these uuids, never a uri (`graph.ts:133-135`), because `has` and `get`
fall through aliases and a uri alias would make `upsertMedia`'s novelty test and the `pendingClaims` gate
report a row that was never stored.

### 2.7 The emit and re-read loop

`upsertMedia` emits `media:changed` once, and only when `changed` (`db.ts:200`). `changed` is set by a
new row (`db.ts:148-150`), a new `MEDIA_PART_OF` edge (`db.ts:190,196`) or a new union (`db.ts:193`).
The `ASSERTED_LABELS` writes' return values are **discarded on purpose** (`db.ts:173-176`): "Feeding it
an asserted write would put every listener back in the re-read loop
tests/unit/worker/store/edge-idempotence.test.ts exists to stop, since the two records can go new at
different times."

`link` and `edge` both return "is this pair NEW" (`graph.ts:290,305`), which is what makes a re-asserted
handle free. The failure it fixed is recorded at `graph.ts:293-296`.

`upsertEpisodes` (`db.ts:414`) and `upsertOrigins` (`db.ts:520`) emit **unconditionally**, so every
episode batch wakes every subscriber whether or not anything moved.

Listeners and what they re-read:
- `Subscription.media` (`src/worker/resolvers/media/index.ts:40,84-87`): `listenMultipleIterator(['media:changed','episode:changed'])`, then `findMediaForPage` + `aggregateMedia` on every tick.
- `Subscription.mediaPage` (`src/worker/resolvers/media/index.ts:108,167-169`): `debouncedListenIterator(['media:changed'], 100)`, then the whole `getPage`, which itself calls `fuzzyMergeMediaClusters`, which can emit again through `linkSame*Pairs` (`db.ts:222,237,253`). It terminates because a union that already exists returns false.
- `listenForMediaChangesForContext` (`src/worker/extractor.ts:94-104`), handed to every extractor as `ctx.listenForMediaChanges` (`src/worker/extractor.ts:536`) and consumed by `waitForMedia` (`src/sources/utils.ts`).
- `Subscription.origin` / `origins` (`src/worker/resolvers/origin/index.ts:31,61`).

The `mediaPage` re-read has a load-bearing fallback (`src/worker/resolvers/media/index.ts:112-125`): with
no `insertedUris`, it reads the whole store, because "`graph.set` is idempotent
(tests/unit/worker/store/edge-idempotence.test.ts). So no event ever fires and the page stays empty.
Measured 2026-09-06 on the search page: picking a format on a loaded season sat at 0 cards for 60
seconds, where the same url opened cold answered 24."

The `Subscription.media` generator also re-asks newly addressable origins (`src/worker/resolvers/media/index.ts:58-65`),
and its termination argument is the union-find's monotonicity: "an origin enters the set once and never
leaves, and the cluster only ever gains members (union-find unions, it never splits), so each source is
asked at most twice" (`src/worker/resolvers/media/index.ts:55-56`).

### 2.8 Tiered consensus

`consensus.ts:36-59`. The rule, from the doc block (`consensus.ts:12-14`): "SO THE TIERS ARE
LEXICOGRAPHIC, NEVER ADDITIVE. The best score present decides which claims are looked at; among those,
the value the most of them claim wins; nothing below that tier is consulted at all. A source cannot be
outvoted by any number of sources beneath it."

The measurements that rejected a sum (`consensus.ts:16-30`), quoted:

```
Mushoku Tensei S1 part 1, once the streaming tier echoes Crunchyroll's packaging:
  24 scores cr 0.5 + jw 0.2 + nf 0.2 + appletv 0.2 + paramount 0.2 = 1.3
  11 scores mal 0.9 + kitsu 0.3                                    = 1.2
Mushoku Tensei season 3 while airing: mal and AniList publish the announced 14, and six sources
publish `episodes.length`, the eleven aired so far. The sum goes 1.8 to 1.7 for 11.
Over the 100 cluster snapshot in dist-seed the sum was identical to today's rule in 100 of 100.
```

Also refused: multiplying by the claim, "that makes the larger number win for being larger, so a lone
folded season beats a lone catalogue every time. The claim is what is being voted ON" (`consensus.ts:32-34`).

Tie inside one tier goes to the larger value, "everything downstream of this only ever refuses something
for being too long, so over-estimating costs a refusal and under-estimating hides data" (`consensus.ts:53-54`).

### 2.9 `alignRunEpisodes`, `alignmentOffset`, `runEpisodes`

**`alignmentOffset`** (`consensus.ts:113-155`). Builds `runByDay: Map<day, Set<episodeNumber>>` from the
reference episodes, "DISTINCT numbers per day, not rows per day ... what disqualifies a day is the run
using it for two DIFFERENT episodes" (`consensus.ts:118-119`). For each other-source episode it looks at
day-1, day, day+1 and skips unless exactly one number is reachable (`consensus.ts:142-143`). The
plus-or-minus-one-day window: "ani.zip stamps `2021-01-10T15:00:00Z`, which is the 11th in Tokyo, and
Crunchyroll publishes the Tokyo date ... Episodes are a week apart, so a day of slack cannot reach the
neighbour" (`consensus.ts:136-140`). `dayOf` floors to 86,400,000 ms (`consensus.ts:85-88`).

Refusals (`consensus.ts:105-110, 148-154`): fewer than `MIN_ALIGNED = 2` votes (`consensus.ts:111`); a
runner-up offset with equal support; any date matching more than one reference episode. "NOTHING RATHER
THAN A GUESS, in every ambiguous case."

Worked case (`consensus.ts:93-97`): "The Elusive Samurai season 2, in the shipped seed: anizip, kitsu,
MAL and AniList all publish episodes 1 to 12, and Crunchyroll publishes the same broadcast as 13 to 20,
with the SAME AIR DATES to the day. `mergeByEpisodeNumber` keys on the number alone, so the page drew
twenty rows for a twelve episode run."

Dates are never compared to a start date: "the highest-scored start date in this store is three days off
Crunchyroll's own episode 1 for at least one show in the seed" (`consensus.ts:99-104`).

**`alignRunEpisodes`** (`consensus.ts:256-291`). Returns a `Map<uri, T>` of **renumbered copies**, never
writing to the store. "READ TIME, AND A COPY. The stored node keeps Crunchyroll's own number, because it
is keyed by Crunchyroll's guid and is reachable through the whole season from other paths: `graph.set`
is last-write-wins, so rewriting it here would change what those other readers see"
(`consensus.ts:247-251`). Reference set is the members whose `episodeCount === runLength(cluster)`
(`consensus.ts:271-273`), grouped **by origin, never by which row an episode hangs off**
(`consensus.ts:265-269`). Returns empty when there is no length, no reference origin or no anchor
episode (`consensus.ts:262,274,276`). `offset == null` is checked with `== null` and not falsiness
because 0 is a real answer (`consensus.ts:282-284`).

**`runEpisodes`** (`consensus.ts:157-241`). Four gates, each with its own doc block:

1. No agreed length -> return everything unchanged (`consensus.ts:158-159`). "a cluster whose sources
   publish no count at all is left exactly as it was, because there is nothing to be wrong about. That
   last case is the reason this cannot be written as 'drop what exceeds the count': most of the store has
   no count" (`consensus.ts:80-82`).
2. `backing = cluster.filter(m => m.episodeCount === length)`; **fewer than two witnesses refuses the
   loan outright**, returning only episodes whose origin is a cluster member (`consensus.ts:171,234`).
   "twelve sources set `episodeCount = episodes.length`, so a catalogue that could only reach part of a
   run publishes a SHORT count as confidently as one that knows the whole run" (`consensus.ts:164-168`).
   Measured case (`consensus.ts:222-224`): "Mushoku Tensei season 2 part 1, where MAL publishes no count
   and AniList says 13: the length rests on one witness, the bar disabled every window, and a lent season
   put 24 rows on a 12 episode page."
3. Spared sets: `reference` (origins that agree on the length) and `equals` (origins whose score is
   `>= tier`) (`consensus.ts:210-211`). "AND ONLY A STRICTLY LOWER TIER IS TRIMMED ... An equal cannot be
   overruled: two 0.9 catalogues disagreeing is a disagreement, and the answer to one of those is to show
   what the tier's majority says, never to delete the dissenter's episodes" (`consensus.ts:186-189`).
4. Everything else is kept only when `episodeNumber == null` or `1 <= episodeNumber <= length`
   (`consensus.ts:236-240`). "A WINDOW OF 1 TO length, not a ceiling ... aligned onto the run's
   numbering, the previous part lands at zero and below and the next part above the length"
   (`consensus.ts:185-191`). A source with no row in the cluster is windowed too, deliberately
   (`consensus.ts:192-196, 204-208`): "Keying this on cluster membership made it depend on whether that
   lend happened to be linked, which varies between loads."

The originating defect (`consensus.ts:68-72`): "Crunchyroll models Mushoku Tensei season 1 as one season
of 23 and a special where AniList and MAL split the same broadcast into 11 and 12, so an 11 episode run
listed 24 rows: 11 correct, then part 2's twelve, then the special (measured on the live site 2026-09-09)."

### 2.10 The fuzzy merge, its gates and thresholds

Entry point `fuzzyMergeMediaClusters` (`fuzzy-merge.ts:594-670`). Sequence:

1. Profile every non-empty cluster (`fuzzy-merge.ts:595`).
2. **Year bucketing**: a profile with no titles is skipped entirely; otherwise it is filed under every
   year in its `years` set (`fuzzy-merge.ts:597-605`). Only clusters sharing a year are ever compared.
   This is relied on by four extractors, which stamp a season with its own date so the bucketing
   separates it (`src/sources/appletv/extractor.ts:94-95`, `src/sources/tmdb/extractor.ts:117`,
   `src/sources/tvmaze/extractor.ts:92-93`, `src/sources/unogs/extractor.ts:276-277`).
3. Wipe the decision cache when it exceeds `MAX_CACHED_DECISIONS = 50_000` (`fuzzy-merge.ts:13,607`).
   The wipe is total, not an LRU eviction.
4. Pairwise `decide` inside each bucket, collecting `[linkUri, linkUri]` in fixed lexical order
   (`fuzzy-merge.ts:611-629`).
5. Sort the links so "the SEQUENCE of unions decides root survival just as much as their direction does"
   (`fuzzy-merge.ts:631-633`).
6. **Re-read and re-check each pair before applying it** (`fuzzy-merge.ts:636-666`), then dispatch on the
   two scopes to `linkPartOfPairs`, `linkSameContainerPairs` or `linkSameMediaPairs`.

The re-check reason (`fuzzy-merge.ts:637-647`): "Every verdict above was computed against a SNAPSHOT
taken before the first await, and the pass awaits the wasm matcher hundreds of times: extractor.ts
flushes its DataLoader batch on a 50ms timer throughout, and each flush can weld more medias into a
component that has already been judged ... This can only ever REFUSE a link the snapshot allowed - it is
an AND with the original verdict, never a replacement."

The scope dispatch (`fuzzy-merge.ts:656-666`): "The verdict is the same whatever the scopes are; what it
is allowed to DO is not ... A title match between a run and a show is a guess at containment, so it rides
an edge, never a union: the edge can be deleted, a union cannot."

**`profileCluster` fields** (`fuzzy-merge.ts:282-362`):

- `key`: lowest uri in the whole cluster.
- `scope`: CONTAINER only when every member is.
- `linkUri`: the lowest uri whose own scope matches the profile's scope. The comment records why `key`
  is not enough (`fuzzy-merge.ts:102-108`): a mixed cluster's `key` can be the container member, "the
  store answers a container uri in the container space, so re-reading such a cluster by its key found a
  singleton show instead of the run cluster, and `linkSameMediaPairs` refuses a container on either side."
- `titles`: `selectTitles` (`fuzzy-merge.ts:256-279`). Per normalized title keep the best score, bucket
  by score, sort descending by score, **order within a tier by the title string**, take
  `MAX_TITLES_PER_CLUSTER = 6` (`fuzzy-merge.ts:12`).
- `years`: `yearOf(startDate)` over every member (`fuzzy-merge.ts:138-142`).
- `days`: `startDay(startDate)` over every member, dropping **the first of any month**
  (`fuzzy-merge.ts:173-179`).
- `formats`: `MOVIE`/`SERIES` from categories plus type, with `SPECIAL`/`OVA`/`ONA` contributing nothing
  ("one-off specials straddle the movie/series boundary - keep them format-neutral",
  `fuzzy-merge.ts:309`).
- `types`: `mergeType(media.type)` restricted to `WORK_KINDS = {TV, MOVIE, SPECIAL, OVA, ONA}`
  (`fuzzy-merge.ts:58`). `mergeType` folds `TV_SHORT` to `TV` (`fuzzy-merge.ts:74`).
- `seasons`: `parseSeasonNumber` over **raw** titles, "because normalizeTitle folds `Season 4` and
  `Season 40` closer together and drops the delimiters `第 4 期` is allowed to carry"
  (`fuzzy-merge.ts:324-325`).
- `cacheKey`: `key # titles # formats # seasons # days # types`, each sorted (`fuzzy-merge.ts:360`).
  "Joining with ',' is safe only because normalizeTitle keeps nothing but letters, numbers and single
  spaces" (`fuzzy-merge.ts:350-352`).

**`sameShow` gates, in order** (`fuzzy-merge.ts:396-575`), all thresholds explicit:

| # | gate | line | rule |
| --- | --- | --- | --- |
| 0 | year bucket | `fuzzy-merge.ts:600` | only same-year clusters are ever compared |
| 1 | format veto | `fuzzy-merge.ts:397` | both sides name a format and they are disjoint -> refuse |
| 2 | season veto | `fuzzy-merge.ts:431` | both sides name a season number and they are disjoint -> refuse. Silence never blocks |
| 3 | start-date veto | `fuzzy-merge.ts:494-497` | both sides have a day and **no** pair is within `START_DATE_WINDOW_DAYS = 45` (`fuzzy-merge.ts:46`) -> refuse |
| 4 | companion veto | `fuzzy-merge.ts:562-565` | both sides name a work kind AND they are disjoint AND `namesCompanionContent` -> refuse. Requires **both** signals |
| 5 | title match | `fuzzy-merge.ts:566-573` | exact normalized equality -> accept; `differOnlyByTrailingNumber` -> skip the pair; `maxPossibleSimilarity < SIMILARITY_THRESHOLD (0.9)` -> skip; else `titleSimilarity >= 0.9` -> accept |

`SIMILARITY_THRESHOLD = 0.9` (`fuzzy-merge.ts:7`). `titleSimilarity` is the frizbee wasm aligner,
normalized by the longer string in both directions (`src/sources/utils.ts`).
`maxPossibleSimilarity` (`fuzzy-merge.ts:365-377`) is an exact multiset upper bound that skips the wasm
call. `differOnlyByTrailingNumber` (`fuzzy-merge.ts:389-393`) compares a trailing number as a value:
"'yami shibai 16' and 'yami shibai 17' are two different shows and score 0.8849, while 'onii-chan!' and
'oniichan' are one show and score 1.0000, so no threshold tells them apart" (`fuzzy-merge.ts:384-388`).

`COMPANION_MARKERS` (`fuzzy-merge.ts:92-95`), ten kept out of twenty-five swept, with the sweep counts
recorded (`fuzzy-merge.ts:80-82`): `specials 19, special 8, ova 7, ona 4, episode 0 3, bonus 2, mini anime 2,
picture drama 1, recap 1, trailer 1`.

Measured trade-offs the file records, which the replacement must not silently discard:

- Start-date window, at 45 days: "83 welds refused for 81 merges lost, ratio 1.02" (`fuzzy-merge.ts:163-164`),
  and the census arm "83 of the 118 that still weld are refused ... 81 of 15549 correct merges lost
  (0.52%) ... 0 of 17946 streaming attaches lost" (`fuzzy-merge.ts:455-470`). Why not a wider window:
  "this rule exists to separate two seasons inside ONE calendar year ... Two consecutive cours sit about
  91 days apart, so the window has a hard ceiling well below that regardless of what the ratio says"
  (`fuzzy-merge.ts:35-41`).
- January 1 dropped as a date: "keeping January 1 as a date destroys 14992 of 17946 such attaches ...
  Dropping it destroys none of them" (`fuzzy-merge.ts:150-156`).
- Companion check, both signals: "the marker alone 52 of 84 refused, 77 correct merges destroyed ...
  the disagreement alone 63 of 84 refused, 547 correct merges destroyed ... both together 49 of 84
  refused, 2 correct merges destroyed, 0 attaches, ratio 24.5" (`fuzzy-merge.ts:507-514`).
- Season-silence rule REFUSED: "323 refused against 12007 lost, one wrong weld stopped per 37 correct
  merges destroyed" (`fuzzy-merge.ts:405-411`).
- Title ordering within a tier, measured on manami (41537 records): arrival order 64.5% / 94.9% / 56.0%
  against title-ascending 69.6% / 99.9% / 70.0% on arms A (weld), B (split), C (attach)
  (`fuzzy-merge.ts:215-219`).
- `MAX_TITLES_PER_CLUSTER = 6` is a cost bound: "a pair costs up to 36 alignments today ... Eight titles
  would take one pair to 64, +78% on the single loop the whole pass spends its time in"
  (`fuzzy-merge.ts:8-11`).

`normalizeTitle` (`fuzzy-merge.ts:121-125`) is `stripTitle` plus stripping `the|a|an`. "Widen only this
one and the similarity path strips a title back down to its latin fragment, so two Vanguard seasons both
reduce to 'divinez' and score a perfect 1" (`fuzzy-merge.ts:119-120`). `carriesIdentity`
(`fuzzy-merge.ts:132`) refuses a title with no letter and a title that is only a season label.

### 2.11 The anomalies

`anomalies.ts`, exported as `clusterAnomalies` (`anomalies.ts:71`), called **only from
`tests/unit/worker/store/merge-fixtures.test.ts:167`**.

- `disagreeingIds` (`anomalies.ts:26-47`): two ids of one origin in one cluster that are not one id at
  different precision. Precision is `extendsId` (`src/sources/offline/seed-gate.ts:63`,
  `a.startsWith(b + '-') || b.startsWith(a + '-')`), applied **one way** on purpose: "dropping both sides
  lets a shared parent hide the disagreement it sits between, so `[A, A-1, A-2]` would report nothing at
  all" (`anomalies.ts:36-37`). Reason: "One source names one thing once. Two of its ids in a cluster means
  a union happened that the source itself would refuse, and `graph.link` has no inverse, so it is
  permanent for the session" (`anomalies.ts:21-23`).
- `overLength` (`anomalies.ts:60-68`): `listed > runLength(cluster)`. `listed` is passed in "because
  counting it means walking the episode graph and these rules are pure" (`anomalies.ts:57-58`).

Why rules rather than fixtures (`anomalies.ts:8-11`): "The merge fixtures decide each case by hand: these
uris together, those two never. That is the right way to pin a known answer and the wrong way to find an
unknown one, because it only ever looks where somebody already looked."

### 2.12 Normalization

`normalizeToStoreMedia` (`normalize.ts:13`) is the single boundary between a GraphQL row and a stored
row. Two invariants: every nullable field becomes `null`, never `undefined`; and `scope` defaults to
`'RUN'` (`normalize.ts:39`). It flattens `relations` (dropping any edge with no `node.uri`) and copies
`franchise` node-by-node.

`stripTitle` / `normalizeTitle` are the other normalization, used only by the fuzzy pass
(`src/sources/utils.ts`, `fuzzy-merge.ts:121`). `dedupeLabels` (`aggregate.ts:55-65`) normalizes
genre and tag case at read time, keeping the highest-scored source's spelling.

---

## 3. STORAGE / POLICY / VIEW

**STORAGE** (the graph must keep it; a replacement that loses it loses data):

| behaviour | citation |
| --- | --- |
| the per-uri media row, merged by `lastWriteLongestArray` | `db.ts:85,147`, `graph.ts:388` |
| the per-uri episode row | `db.ts:86,405` |
| the `originMap` | `db.ts:83,515-521` |
| the RUN identity union-find | `db.ts:14,193` |
| the CONTAINER identity union-find | `db.ts:15,193` |
| the EPISODE identity union-find | `db.ts:45,410` |
| directed `media:part_of` edges | `db.ts:80,190,196,251` |
| directed `has_episode` edges | `db.ts:47,406` |
| directed `episode:part_of` edges | `db.ts:46,411` |
| the three `ASSERTED_LABELS` adjacencies (source claims, unioning nothing) | `db.ts:66-70,189,192,195` |
| the stored `scope` per row, after the ratchet | `db.ts:146-147` |
| `componentIds` and their aliases | `graph.ts:136,234-263` |
| `pendingClaims` | `db.ts:124` |
| the label index (`media`, `episode`) | `graph.ts:140,185`, `export.ts:34-35` |

**POLICY** (a merging decision; each becomes a plugin in the new design):

| decision | citation |
| --- | --- |
| placeholder refusal | `db.ts:105-108,140` |
| scope ratchet toward CONTAINER | `db.ts:146` |
| `SHOW_LEVEL_ORIGINS` backstop | `db.ts:42,91-92` |
| relation derivation from the two scopes | `db.ts:162-197` |
| PART_OF is an edge and never a union | `db.ts:72-80` |
| fuzzy title merge and all six of its gates | `fuzzy-merge.ts:396-575` |
| year bucketing | `fuzzy-merge.ts:597-605` |
| the re-check before applying a link | `fuzzy-merge.ts:636-655` |
| scope dispatch of a fuzzy verdict | `fuzzy-merge.ts:656-666` |
| link ordering and link direction | `fuzzy-merge.ts:619-633` |
| `linkSame*Pairs` scope refusals | `db.ts:219,234,250` |
| `mergeByEpisodeNumber` | `db.ts:475-494` |
| tiered consensus for `episodeCount` | `consensus.ts:36-63` |
| `runEpisodes` windowing, witness bar and spared sets | `consensus.ts:157-241` |
| `alignRunEpisodes` / `alignmentOffset` | `consensus.ts:113-291` |
| the anomaly rules | `anomalies.ts:26-71` |
| the field merge rules in `aggregateMedia` | `aggregate.ts:319-398` |
| PART_OF subtree cut in `recursivelyUnwrapMediaHandles` | `aggregate.ts:145-146` |
| SAME_AS-only episode walk | `aggregate.ts:103-104`, `src/worker/resolvers/media/index.ts:183` |

**VIEW** (computed on read, nothing stored):

| view | citation |
| --- | --- |
| `findAggregatedMedia`, `findAllAggregatedMedia` | `db.ts:257,374` |
| `findPartOfMedia`, `findRunsOfContainer` | `db.ts:276,303` |
| `preferAttachedRun`, `findMediaForPage`, `hideAttachedContainers` | `db.ts:334,349,391` |
| `findAggregatedEpisodesForMedia`, `findRunEpisodes` | `db.ts:432,424` |
| `aggregateMedia`, `aggregateEpisode` | `aggregate.ts:306,401` |
| `applyMediaFilters` | `filter.ts:54` |
| `exportStore` | `export.ts:31` |
| the episode renumbering (a `Map` of copies) | `consensus.ts:256-291` |

### Where policy is entangled with storage today

1. **The placeholder rule decides whether a row exists at all.** `upsertMedia` skips the row
   (`db.ts:140`), so a policy change retroactively changes what is stored, and the discarded row is gone.
2. **The scope ratchet is written into the stored row.** `db.ts:146-147` writes `{...media, scope}`, so
   the source's own `scope` value for that write is overwritten and unrecoverable. A source that said RUN
   after someone said CONTAINER leaves no trace of having said RUN.
3. **`SHOW_LEVEL_ORIGINS` overrides the stored scope at every read of `scopeOf`** (`db.ts:91-92`), so the
   stored row and the effective scope can disagree, and every derived relation follows the override.
4. **The relation derivation chooses which storage primitive is used.** A SAME_AS claim between two RUNs
   becomes an irreversible union; the same claim across scopes becomes a deletable edge (`db.ts:187-197`).
   The claim itself survives only in the `ASSERTED_LABELS` adjacency, which is why that adjacency had to
   be added: "`graph.link` carries the same label whether the pair came from a handle or from
   `linkSameMediaPairs`, so a cluster cannot say which of its unions a source actually asserted; and a
   union-find cannot answer 'what would this component be with that node removed'" (`db.ts:59-63`).
5. **The fuzzy merge writes into the same union-find as asserted sameness** (`db.ts:220`), with nothing in
   the union-find distinguishing the two. Only the parallel adjacency can, and `linkPartOfPairs` writes
   **no** asserted record at all (`db.ts:251`), so a fuzzy containment is invisible to the export.
6. **`lastWriteLongestArray` is a merge policy executed inside `graph.set`** (`graph.ts:170-175`). The
   loser of an array comparison is discarded at write time; there is no second copy anywhere.
7. **`componentId` mints and writes during a read** (`graph.ts:234-244`, called from `aggregate.ts:294`),
   so the read path mutates the alias table, and `resetStore` is the only thing that can undo it.
8. **`mergeByEpisodeNumber` runs inside `findAggregatedEpisodesForMedia`** (`db.ts:454`), so every caller
   of that read gets the policy whether it wants it or not, including `similar-consumer.ts:284`.
9. **`aggregateMedia` calls `findPartOfMedia`, which reads the graph** (`aggregate.ts:315,366`), so the
   "pure" aggregation function is not pure and cannot be run on a detached cluster.
10. **`aggregateMedia` calls `runLength`** (`aggregate.ts:386`), so the published `episodeCount` is a
    consensus verdict rather than any source's number, with no field saying so.

---

## 4. Read path output contracts

### 4.1 `aggregateMedia(medias: Media[], locationOrigin: string): GQLMedia`

Throws `Error('Cannot aggregate empty cluster')` on an empty array (`aggregate.ts:307`).

**The singleton path is a different contract** (`aggregate.ts:308-317`). It returns
`mediaToGQL(m)` with only `_id`, `scope` and `handles` replaced. So for a one-member cluster:

- `uri`, `id`, `origin`, `url` are the **member's own**, not `ag:(...)` / `'ag'` / a route url.
- `titles` / `descriptions` / `covers` / `banners` / `trailers` are **not** sorted by score or deduped.
- `categories` are **not** reconciled, `genres` / `tags` **not** deduped, `relations` **not** deduped and
  self-edges **not** dropped, `season`/`seasonYear` not run through `seasonOf`, `episodeCount` not run
  through `runLength`.
- `handles` is `[sameAsHandle(self), ...findPartOfMedia(medias).map(partOfHandle)]`.

**The multi-member path** (`aggregate.ts:319-398`). `sorted` is `medias` sorted by `score` descending
with `?? 0` (`aggregate.ts:319`), and every rule below reads that order.

Seed of the reduce (`aggregate.ts:353-369`), pinned and never overwritten:

| field | rule |
| --- | --- |
| `_id` | `graph.componentId(medias[0].uri, IDENTITY_LABELS[scopeOfCluster(medias)])`. Stable across unions and across the container cut. `aggregate.ts:293-294,321` |
| `uri` | `ag:(` + sorted routable uris joined by `,` + `)`. Non-routable uris are dropped unless that leaves nothing, in which case all uris are used. `aggregate.ts:296-304` |
| `id` | the same parenthesized list without the `ag:` prefix |
| `origin` | the literal `'ag'` |
| `url` | `${locationOrigin}/` + the MEDIA route path for the aggregated uri |
| `score` | `Math.max(...medias.map(m => m.score ?? 0))` |
| `scope` | `scopeOfCluster(medias)`: CONTAINER only when every member is |
| `handles` | every member as a `SAME_AS` handle in score order, then every `findPartOfMedia` row as a `PART_OF` handle. Read here "so that no caller can forget them: a missing link renders as a dead grey icon, which looks like ordinary absence" (`aggregate.ts:361-363`) |
| `episodes` | `[]`; filled by the `Media.episodes` field resolver |

Reduce body (`aggregate.ts:323-352`), `{...gql, ...acc, <explicit>}`:

| field | merge rule |
| --- | --- |
| `url`, `type`, `status`, `averageScore`, `popularity`, `startDate`, `endDate`, `isAdult`, `episodeCount`, `nextAiringEpisode` | **first non-null in score-descending order** (`acc.x ?? gql.x`) |
| `categories`, `genres`, `tags`, `titles`, `descriptions`, `shortDescriptions`, `covers`, `banners`, `trailers`, `relations` | **concatenated in score order**, highest first |
| `franchise` | first non-null in score order, never spliced: "A graph is one source's whole account of a series and two of them spliced together would carry edges between nodes only one of them has" (`aggregate.ts:348-350`) |
| `season`, `seasonYear` | not named in the reduce, so `...acc` pins the highest-scored member's value from iteration 2 onward; **overwritten unconditionally by `seasonOf` in the return** |

Final overrides (`aggregate.ts:371-398`):

| field | rule | citation |
| --- | --- | --- |
| `episodeCount` | `runLength(medias) ?? merged.episodeCount ?? null`. "Measured over the 100 cluster snapshot in dist-seed on 2026-09-09: identical in 100 of 100, because `mal` is the only member of the 0.9 tier until anizip's media row carries a score" | `aggregate.ts:373-386` |
| `relations` | deduped on `relation\0node.uri`, and any edge pointing at a member of this cluster is dropped: "rendering it would show a media as its own alternative, with a card that navigates back to the page it is on" | `aggregate.ts:243-247,249-261,387` |
| `categories` | ANIME if present, plus **exactly one** of MOVIE/SERIES, the first in score order: "so a merged media never lands in both the Movies and the Series listing" | `aggregate.ts:8-15,388` |
| `season`, `seasonYear` | **taken together from ONE member**: the highest-scored member that names a season supplies both. A cluster with no season still gets the highest-scored non-null `seasonYear`. "Merged separately, a cluster whose members disagree can end up carrying a season no source ever claimed, and `store/filter.ts` matches on both, so the media would answer a season page that nothing put it in" | `aggregate.ts:34-53,389` |
| `genres`, `tags` | case-insensitive dedupe keeping the first (highest-scored) spelling | `aggregate.ts:55-65,390-391` |
| `titles` | `removeDuplicatesByField('title', byScore(...))`: score descending (nulls last, `score ?? -1`), then first-wins on the **exact** title string | `aggregate.ts:18-20,67-77,392` |
| `descriptions`, `shortDescriptions`, `covers`, `banners` | sorted by score descending, **not deduped** | `aggregate.ts:393-396` |
| `trailers` | deduped on `uri`, **not re-sorted** (the concatenation is already in score order) | `aggregate.ts:397` |

`relationToGQL` (`aggregate.ts:197-234`) inflates a stored `Relation` into a thin `Media` with `_id` set
to its uri rather than a cluster id, `scope: 'RUN'` hard-coded, and every other field nulled: "Nothing
downstream may treat it as a row this store holds" (`aggregate.ts:194-195`).

**What callers do with it.**
- `src/worker/resolvers/media/index.ts:73`: the whole `Subscription.media` payload; `media.uri` also
  drives `askUnasked` (`:74`), and the cluster (not the aggregate) drives `resolveSimilarRuns` (`:76`).
- `src/worker/resolvers/media/index.ts:131`: one per cluster for `mediaPage`, then filtered by
  `applyMediaFilters` (`:137`), then optionally scored by `searchRelevance` against
  `media.titles[].title` with `SEARCH_RELEVANCE_THRESHOLD = 0.7` and tie-broken by `popularity`
  (`:139-152`), then sorted by `popularity` when asked (`:154-161`).
- `src/worker/extractor.ts:91`: `findAggregatedMediaForContext`, handed to every extractor as
  `ctx.findAggregatedMedia` (`src/worker/extractor.ts:535`) and polled by `waitForMedia`
  (`src/sources/utils.ts`). Extractors read handles off it to find their own id.
- `Media.episodes` reads `parent.handles` (`src/worker/resolvers/media/index.ts:183`), so the handle list
  the aggregate publishes is what decides which episodes are walked.

### 4.2 `aggregateEpisode(episodes: Episode[], locationOrigin: string): GQLEpisode`

Throws on empty (`aggregate.ts:402`). Singleton path returns `episodeToGQL(e)` with `_id` from the
EPISODE space and `handles: [self]` (`aggregate.ts:403-410`).

Multi-member (`aggregate.ts:412-450`): seed is `_id` (EPISODE space), the `ag:(...)` uri and id,
`origin: 'ag'`, `url` = the **MEDIA** route path for the aggregated **episode** uri,
`mediaUri: uri` (the aggregated episode uri, **not** any member's `mediaUri`), `score` = max,
`handles` = every member in score order. Reduce: `url`, `embedUrl`, `releaseDate`, `seasonNumber`,
`episodeNumber`, `absoluteEpisodeNumber`, `runtime` are first-non-null in score order; `titles`,
`descriptions`, `shortDescriptions`, `thumbnails` concatenate. Final: titles deduped by exact title after
score sort; descriptions, shortDescriptions and thumbnails sorted by score
(`aggregate.ts:444-450`).

Caller: `src/worker/resolvers/media/index.ts:216`, one per `episodeNumber` group.

### 4.3 `findAggregatedEpisodesForMedia(mediaUris): Promise<Episode[][]>`

Returns groups of stored episode rows. Steps: every `has_episode` target of every uri, deduped by uri
and skipping uris with no row (`db.ts:435-443`); grouped by `episode:same_as` component
(`db.ts:445-452`); folded by `mergeByEpisodeNumber` (`db.ts:454`). **No windowing, no alignment, no
sorting.** Group order is the order episodes were first reached, which is the `has_episode` adjacency
insertion order.

Callers:
- `src/worker/resolvers/media/index.ts:204`, only when no handle uri resolved to a cluster. The comment
  records why that fallback is dangerous: taking an unresolved uri as "no cluster" "dropped the page onto
  the unwindowed walk, where a lent season's whole 24 episodes are drawn"
  (`src/worker/resolvers/media/index.ts:194-196`).
- `src/worker/similar-consumer.ts:284`, flattened into episode titles for `runEvidence`
  (`src/worker/similar-consumer.ts:285`, `:167-177`).

### 4.4 `findRunEpisodes(cluster): Promise<Episode[][]>`

`db.ts:424-430`. Output is groups of **possibly renumbered copies**: `aligned.get(uri) ?? episode`
(`db.ts:428`). Emptied groups are dropped (`db.ts:429`).

Caller `src/worker/resolvers/media/index.ts:203`, which then flattens, **drops every episode with a null
`episodeNumber`** (`:207-208`), regroups by `episodeNumber` (`:209-213`), aggregates each group and sorts
ascending by `episodeNumber` (`:215-217`). Note that this is a **second** grouping by number, on top of
`mergeByEpisodeNumber`, and it is the one that runs after alignment.

### 4.5 `findAllAggregatedMedia(uris?): Promise<Media[][]>`

`db.ts:374-383`. Runs first, then containers. A run cluster is a `media:same_as` component with at least
one member whose scope is not CONTAINER. A container cluster is a `container:same_as` component reduced
to its CONTAINER members that no run cluster already lists; an emptied one is dropped. Every row appears
in at most one returned cluster. With `uris`, the node-label filter is dropped and the uris are the seeds
(`db.ts:375`), so a uri with no row contributes nothing.

Caller `src/worker/resolvers/media/index.ts:126-131`: called, then `fuzzyMergeMediaClusters` is run over
the result and, if it reports a change, the whole read is repeated (`:127-129`); then
`hideAttachedContainers` (`:130`); then `aggregateMedia` per cluster. The ordering is load-bearing:
"dropping a run cluster before that leaves its container behind as an orphan card, because a container is
only hidden when a run cluster in the same list points at it" (`src/worker/resolvers/media/index.ts:133-136`).

### 4.6 `findPartOfMedia(cluster): Media[]`

`db.ts:276-296`. Direct `media:part_of` targets of every member, each **expanded to its whole cluster in
its own identity space** (`db.ts:282`), deduped by uri, and skipping a target whose cluster overlaps the
input cluster (`db.ts:287`). Order is member order then target-adjacency order then cluster-component
order. Rows with no stored node are simply absent, since `graph.cluster` only pushes existing nodes.

The expansion is deliberate (`db.ts:270-273`): "the fuzzy pass writes ONE edge, to the cluster key, and
the other catalogues of an already unioned show were only ever reachable while they were welded in."

Callers:
- `aggregate.ts:315,366`: every result becomes a `PART_OF` handle on the aggregated media. The UI reads
  those as the show's other catalogue links.
- `src/worker/similar-consumer.ts:282`: `planSimilarAsks(cluster, findPartOfMedia(cluster), implemented)`,
  which asks each container origin that implements `similarMedia` for the run matching this show
  (`src/worker/similar-consumer.ts:150-157`).

### 4.7 `applyMediaFilters(medias, filters): T[]`

`filter.ts:54-79`. **Returns the same object references**, never copies (pinned by
`tests/unit/worker/store/filter.test.ts:20`).

| filter | rule | line |
| --- | --- | --- |
| `categories` | ANY-match against `media.categories` | `filter.ts:65` |
| `formats` | ANY-match against `media.type`; a media with no `type` **fails** | `filter.ts:66` |
| `status` | exact equality | `filter.ts:67` |
| `season` | exact equality | `filter.ts:68` |
| `seasonYear` | exact equality | `filter.ts:69` |
| `genres` | ALL-match, case-insensitive | `filter.ts:70-73` |
| `tags` | ALL-match, case-insensitive | `filter.ts:74-77` |

Strictness is the whole point (`filter.ts:33-36`): "a filter names values, and a row that cannot show it
carries one of them does not match ... The alternative, letting an absent field pass, means a 'Movies'
filter lists every row no source typed, which is the failure a user reads as broken."

Genres and tags are ALL-match because "adding a second genre narrows, which is what every browse UI does";
formats and categories are ANY-match "because they are alternatives rather than refinements"
(`filter.ts:38-40`).

`status` carries a recorded cost (`filter.ts:48-52`): "the bundled offline catalogue publishes no status
at all, on purpose, because its dump's own value decays within weeks (192 of 219 SUMMER 2026 rows read
UPCOMING in a dump cut six weeks before they aired). So a status filter drops every row only that
catalogue describes."

Caller: `src/worker/resolvers/media/index.ts:137`, after `hideAttachedContainers`, before search and sort.

### 4.8 `exportStore({excludeOrigins, passThroughOrigins, uris})`

`export.ts:31-108`. Promises, from its own doc (`export.ts:12-29`): "it reads, and never writes. It walks
only pairs a source claimed through a handle (`ASSERTED_LABELS` in ./db.ts), never a union the fuzzy pass
made. It emits nothing whose published members are all CONTAINER: a show with no run is not a run. Output
is sorted throughout, so two calls against one store are byte-identical."

Algorithm:
1. Seeds are every `media`-labeled uri, sorted (`export.ts:44`), skipping excluded origins.
2. BFS over `ASSERTED_LABELS.RUN` adjacency only (`export.ts:54`), never entering an excluded origin.
3. `walked` is every reached member; `members` is `walked` minus pass-through origins (`export.ts:60-61`).
4. The cluster is dropped when no published member has scope other than CONTAINER (`export.ts:62`).
5. `partOf`: for each member's `ASSERTED_LABELS.PART_OF` targets, BFS out along
   `ASSERTED_LABELS.CONTAINER` adjacency, keeping rows that are media-labeled, not excluded, and
   published (`export.ts:64-78`).
6. `episodes`: direct `has_episode` targets of every walked member, skipping non-episode rows, excluded
   origins and non-published origins (`export.ts:80-90`).
7. `uris` filters on `walked`, not on `members`, "so asking by a pass-through uri still answers"
   (`export.ts:40-41,105`).
8. `members`, `partOf`, `episodes` each sorted by uri; clusters sorted by `members[0].uri`
   (`export.ts:94-96,106`).

The two refusals are different on purpose (`export.ts:20-27`): `excludeOrigins` "is not walked THROUGH,
so a bridge only it supplied splits rather than surviving"; `passThroughOrigins` "is walked through and
then left out of the output ... that row is the hub carrying the handles that bridge mal, anilist and
kitsu, which do not assert one another; cutting it left singletons, and asking for a run by its
`offline:` uri answered nothing at all."

Callers: `src/worker/yoga.ts:54-62`, which unconditionally appends every plugin extractor's origin to
`excludeOrigins`; then `src/worker.ts:32,48` re-exports it over osra; then `src/store-export.ts:16-17`
installs `window.__stubExportStore` only when the export flag is on. The header of that file records why
it is not a schema field (`src/store-export.ts:1-6`): "the schema has no field that answers 'every cluster
in the store' (`Subscription.mediaPage` fuzzy merges, hides attached containers, filters and sorts before
a caller sees anything) ... its ABSENCE is what tells the exporter the flag never reached the app, which
otherwise looks exactly like a store holding nothing."

---

## 5. What is lost today

### 5.1 Provenance: which source said which field

**Per-uri rows keep their origin, merged rows do not.** A stored `Media` carries `origin` (`types.ts:103`),
so as long as a value survives on its own row it is attributable. Everything above the row loses that:

- `aggregateMedia`'s scalar picks are first-non-null in score order (`aggregate.ts:328-337`). The output
  has one `status`, one `startDate`, one `averageScore`, and **no field anywhere says which member
  supplied it**. The member rows are still reachable through `handles` (`aggregate.ts:364-367`), so a
  consumer can re-derive it by replaying the same rule, but the aggregate itself does not record it.
- `episodeCount` is worse: it is a consensus verdict (`aggregate.ts:386`), so it may equal **no single
  member's** stored value when a tier's majority differs from the top-sorted row, and the result records
  neither the tier nor the witnesses.
- `season` / `seasonYear` come from one member but the aggregate does not say which (`aggregate.ts:47-53`).
- `categories` keeps one of MOVIE/SERIES and silently drops the other (`aggregate.ts:9-15`).
- `genres` / `tags` keep one spelling and drop the rest (`aggregate.ts:55-65`).
- **Scored arrays are the exception**: `titles`, `descriptions`, `covers`, `banners`, `trailers`,
  `thumbnails` keep a `score` per entry, and that score is a per-source module constant
  (`fuzzy-merge.ts:240-241`: "0.9 jikan and ani.zip, 0.8 anilist, 0.5 crunchyroll, 0.3 the english
  metadata block, 0.25 watchmode, 0.2 the streaming catalogues"), so the score is a coarse proxy for the
  source and not an identity.
- **Within one uri, `lastWriteLongestArray` destroys the loser** (`graph.ts:392-395`): a shorter array
  from the same source's earlier answer is gone, not archived.
- **Unions carry no provenance in the union-find itself.** This is stated in the code
  (`db.ts:59-61`): "`graph.link` carries the same label whether the pair came from a handle or from
  `linkSameMediaPairs`, so a cluster cannot say which of its unions a source actually asserted." The
  `ASSERTED_LABELS` adjacency was added to recover it (`db.ts:56-64`), but it records only **that** a
  source claimed a pair, never **which** source object or when, and `linkPartOfPairs` writes no asserted
  record at all (`db.ts:251`), so a fuzzy containment has no record.
- **A fuzzy union carries no reason.** Nothing stores which titles matched, at what similarity, in which
  year bucket. `pairDecisions` (`fuzzy-merge.ts:580`) is a boolean cache, wiped wholesale at 50,000
  entries (`fuzzy-merge.ts:607`).

### 5.2 Reversibility

- **Union-find has no inverse.** Stated four times: `db.ts:12` ("`graph.link` is a union-find with no
  inverse"), `db.ts:171` ("Guesses go on edges, which are deletable; only asserted sameness within one
  scope goes on a union"), `fuzzy-merge.ts:127` ("a bad link is permanent: graph.link has no inverse"),
  `anomalies.ts:22-23` ("`graph.link` has no inverse, so it is permanent for the session"). `UnionFind`
  exposes only `has`, `find`, `union`, `component`, `allComponents` (`graph.ts:10-16`).
- **Edges are deletable in principle but there is no delete method.** `Graph` has no `unlink`, `unedge`
  or `remove` (`graph.ts:18-54`); the only removal is `clear()` (`graph.ts:363`). So the "deletable" in
  the PART_OF comment is a property of the data shape, not an implemented operation.
- **The scope ratchet is one-way by design** (`db.ts:142-145`), and the pre-ratchet value is overwritten.
- **`resetStore` is all or nothing** (`db.ts:509-513`) and is not exported through `index.ts`
  (`db.ts:506-507`), and never called by the app.
- **No re-derivation from source answers.** Nothing keeps the raw GraphQL rows: `recursivelyUnwrapMediaHandles`
  flattens into `normalizeToStoreMedia` and straight into `graph.set` (`src/worker/extractor.ts:107-127`).
  A policy change therefore cannot be replayed; it takes a page reload and a full re-fan-out.
- **`exportStore` deliberately walks the asserted adjacency instead** (`export.ts:13-16`), which is the
  only place in the tree that can answer "what would this component be with that node removed"
  (`db.ts:61-63`), and it answers it only for the RUN space and only for whole origins.

### 5.3 Limitations the code itself records

| limitation | citation |
| --- | --- |
| "`86` and `86 Part 2`, both 2021, both carrying the synonym `86 -不存在的战区-`, one naming a season and one not, weld on the exact-title shortcut below ... Pinned by the KNOWN GAP test in season-separation.test.ts, so closing it fails there loudly." | `fuzzy-merge.ts:425-430` |
| "12050 have NEITHER side naming a season and are franchise-label collisions ('minna no uta' is carried by 1039 records), which no season rule reaches." | `fuzzy-merge.ts:427-429` |
| "THE FALSE NEGATIVE IT KNOWINGLY ACCEPTS: a source that dates a show by when IT started carrying it rather than when the show aired. appletv is the one that can do this today ... It is NOT measured ... the arm cannot be measured from that endpoint at all and is recorded here rather than estimated." | `fuzzy-merge.ts:487-493` |
| "Fifteen of the twenty-five markers in the list refuse nothing at all on this corpus ... this is not a claim that they never occur, only that this corpus cannot say they earn their place." | `fuzzy-merge.ts:84-87`, `:516-520` |
| "A is not really the slice's job. Relying on a random six to drop a third of the wrong welds is relying on luck for correctness, and it is what made the same two shows merge on one load and not the next." | `fuzzy-merge.ts:228-230` |
| Cluster iteration order is HTTP arrival order, so an aggregate's reduce over a disagreeing tier is "not merely arbitrary, it is non-deterministic between loads." | `aggregate.ts:379-381`, `fuzzy-merge.ts:243-245` |
| A stored episode keeps its own source's numbering forever; the run's numbering exists only as a read-time copy. | `consensus.ts:247-251` |
| `mergeByEpisodeNumber` "is emphatically not a rule about episodes in general ... this must never be handed a container's uris." | `db.ts:465-468` |
| `sameAsHandleUris` guards "the most dangerous read in the tree"; passing a PART_OF uri "puts every run's episodes into this run's list and the row count becomes the longest season." | `aggregate.ts:97-101` |
| Splitting the identity spaces cost show pages their episodes and offers until `preferAttachedRun`; "A show with no run attached is shown as itself, which is today's card for a live-action catalogue." | `db.ts:328-332` |
| `runEpisodes` refuses a loan outright rather than slicing on an uncorroborated length: "Declining leaves the page exactly as it was", so a lent season's extra rows stay on the page in that case. | `consensus.ts:226-234` |
| The store singleton forces `resetStore` on tests, because "the second case inherits the first case's welds and passes or fails for reasons that are not in it." | `db.ts:498-505` |
| `upsertEpisodes` and `upsertOrigins` emit unconditionally, unlike `upsertMedia`, so an idempotent episode batch still wakes every subscriber. | `db.ts:414,520` against `db.ts:200` |
| Every emit passes `{}`, so `StoreEventMap`'s `uris` / `ids` fields are declared and never populated, and `mediaPage` must re-read the whole store. | `events.ts:1-5` against `db.ts:200,222,237,253,414,520` |
| `pendingClaims` has no expiry: entries are dropped only when the uri lands or on `resetStore`. | `db.ts:158,512` |
| `pairDecisions` is wiped wholesale at `MAX_CACHED_DECISIONS`, discarding entries still worth keeping (the cache-key comment names this cost). | `fuzzy-merge.ts:607`, `:346-349` |
| `findOrigins` applies its filters with `every`, so passing both `IS_API_ONLY` and `IS_NOT_API_ONLY` always returns empty. | `db.ts:539-543` |
| `aggregateEpisode` sets the aggregate's `mediaUri` to the aggregated **episode** uri, so the link back to the media is not recoverable from a multi-member episode aggregate. | `aggregate.ts:439` |
| The singleton branch of `aggregateMedia` skips every normalization the multi-member branch applies (dedupe, score sort, category reconciliation, `seasonOf`, `runLength`, self-relation filtering). | `aggregate.ts:308-317` against `:371-398` |
| `clusterAnomalies` is never called from `src/`; the contradiction sweep exists only in the fixture test. | `anomalies.ts:71`, `tests/unit/worker/store/merge-fixtures.test.ts:167` |
| The store has no persistence, so every cluster, union, component id and pending claim is lost on reload. | `db.ts:82-83` plus the absence of any storage call in `src/worker/` |
