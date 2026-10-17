# Proposal: the minimal core

The core is four things and nothing else: **identity anchors**, **payloads kept as returned**,
**claims with provenance**, and a **plugin runner**. Every decision the current store makes (02
section 3, POLICY) leaves the core and becomes a plugin, including aggregation. The core never
merges, never unions, never decides. It appends what sources say, records who said it, runs the
plugins in a fixed order, and proves after every plugin that no source row moved.

Citations are to the five inputs: `00` (engine facts), `01 case N` / `01 RN` / `01 IN` (cases,
refutations, invariants), `02 section N` (current store), `03 <source>` (capabilities), `04 section
N` (consumers and tests).

---

## 1. Principles

| # | rule | tied to |
| --- | --- | --- |
| P1 | **A source row is appended, never merged, never edited, never deleted.** A re-fetch that differs is a second row; one that is byte-identical is a no-op that emits nothing. | 01 I5 (the hybrid row, the union-find with no record, the partial selection truncating everyone's copy), 04 section 3 (an event that fires when nothing changed is not free) |
| P2 | **A claim is a fact about who said what, never an instruction to the store.** Every handle a source returns lands as an edge from the payload that carried it, with the relation the source chose, the scope it stamped and the provenance it declared; whether that claim makes two rows one thing is decided later, by a plugin, over the whole graph, and can be decided differently tomorrow. | 01 case 7 (one chokepoint), 01 case 8 (an address-bar handle is a pointer), 01 case 48 (a claim before its row), 01 I1 |
| P3 | **Nothing in the core is irreversible.** Cluster membership is recomputed from claims on every pass, so a wrong union is a wrong verdict that the next pass no longer makes, not a session-long weld. | 01 I1, 01 case 1 ("one bad row welds permanently and the merged cluster then goes on to weld a third") |
| P4 | **Plugins write only nodes and edges stamped with their own id, and the core checks the source tables after every plugin.** A plugin's whole output can be retracted by its stamp, which is what makes it testable in isolation and idempotent. | owner's brief; 02 section 3 "where policy is entangled with storage" (all ten items are this rule broken) |
| P5 | **A refusal is written down.** A plugin that declines a claim records the verdict and the reason as its own edge, so four silent short-circuits never read as four passes. | 01 case 6, 01 case 23 (absent, zero, unknown are three states) |
| P6 | **The read path is a lookup of plugin output, never a computation.** A page is one query over materialized aggregates, a detail view is two; no read recurses, no read mints, no read writes. | 00 read costs (recursive component 6.8 ms against materialized 1.7 ms; 1,033 ms on a dense graph), 02 section 2.6 (`componentId` writing from a read) |
| P7 | **Every threshold in a plugin is the record's number or is marked NEW with the case that needs it.** No refuted approach (01 part 2) is retried without naming the refutation and what changed. | 01 R1 to R26, 01 I2 (the exchange rate was measured every time, never argued) |
| P8 | **A container is a first-class node with a page of its own, and nothing reached through a container is ever treated as the run.** Episodes, titles and every scalar cross a `PART_OF` or `INCLUDES` edge only through a range a plugin proved. | 01 case 18, 01 case 49, 01 I10 (24 rows on a 14 episode page, three mechanisms, one number), owner's SAME_AS-through-INCLUDES prohibition |

---

## 2. Graph schema

One label per node (00: no multi label). Rel tables span several FROM/TO pairs where noted (00).
Two families of tables: **source tables**, written by the core's ingest and by nothing else, and
**plugin tables**, written through the plugin API and by nothing else. The core itself never writes a
plugin table and never writes a source table outside ingest.

### 2.1 Source tables (append-only)

```cypher
-- Identity anchors: one per uri ever NAMED, by a row or by a handle. Carry no fields a source
-- could disagree about, so nothing here is ever overwritten.
CREATE NODE TABLE Media(uri STRING PRIMARY KEY, origin STRING, id STRING, seq INT64);
CREATE NODE TABLE Episode(uri STRING PRIMARY KEY, origin STRING, id STRING, seq INT64);
CREATE NODE TABLE Origin(id STRING PRIMARY KEY, raw JSON, seq INT64);

-- One resolver return value about one row, verbatim. Keyed by its content hash, so a byte-identical
-- re-fetch is the same node.
CREATE NODE TABLE Payload(
  key STRING PRIMARY KEY,          -- sha-256 over (origin, kind, uri, canonical JSON of the whole return value)
  kind STRING,                     -- 'MEDIA' | 'EPISODE'
  origin STRING,                   -- the answering source's origin, from the yoga server it came from
  uri STRING,                      -- the row's own uri as returned
  operation STRING,                -- 'MEDIA' | 'MEDIA_PAGE' | 'SIMILAR_MEDIA' | 'EPISODES' (the resolver field it came out of)
  scope STRING,                    -- the row's own `scope` as returned; NULL when the row said nothing
  score DOUBLE,                    -- the row's own `score` as returned; NULL when absent (anizip, 03 anizip)
  raw JSON,                        -- the return value, with exactly two fields lifted out (see 4.2): handles[].node and episodes[]
  seq INT64,                       -- the core's monotone write counter; every plugin's `since` is measured against it
  at TIMESTAMP DEFAULT current_timestamp()
);

CREATE REL TABLE DESCRIBES(FROM Payload TO Media, FROM Payload TO Episode, seq INT64);

-- A handle, as an edge from the payload that carried it to the anchor it names.
CREATE REL TABLE CLAIMS(
  FROM Payload TO Media, FROM Payload TO Episode,
  key STRING,                      -- sha-256 over (payload key, target uri, relation, depth)
  relation STRING,                 -- 'SAME_AS' | 'PART_OF', the source's own word (schema MediaHandleRelation)
  targetScope STRING,              -- the handle node's `scope` as returned: the CLAIMANT's reading of the id, NULL when unstamped
  provenance STRING,               -- 'SOURCE' | 'URI' | 'SEED' | 'ASK' (see 3.3)
  node JSON,                       -- the handle's node verbatim (url, titles, covers...), never merged into the target's rows
  depth INT64,                     -- 1 for a direct handle, 2 for a handle of a handle (04 section 4.3: depth cap 4)
  seq INT64
);

-- The media a source hung an episode on: the episode payload's `mediaUri`, as returned.
CREATE REL TABLE HAS_EPISODE(FROM Media TO Episode, payload STRING, seq INT64);
```

What is raw and why JSON: the owner's brief says "keep them as originally returned", and 01 I5.3
measured what a normalized copy costs (a partial handle node written back as a row replaced
crunchyroll's titles with copies lacking language and score). The row's 26 media fields
(`src/worker/store/types.ts`, 02 section 1) stay inside `raw` untouched. Only three values are
promoted to typed columns, and each is a **copy of a returned value, never a derivation**: `scope`
(every plugin filters on it), `score` (the aggregation sorts on it) and `uri`/`origin` (every scan
filters on origin, 00's candidate scan). `json_extract(p.raw, 'episodeCount')` is exercised (00) and
is what plugins use for everything else. A derived value such as date precision (01 case 33) is
**not** a column here, because the core cannot know whether `2021-01-01` is a sentinel or a premiere;
that reading belongs to a plugin (5.7, the `days` rule).

Every anchor for a uri is created the first time the uri is **named**, by a row or by a handle. So a
claim arriving before the row it is about (01 case 48) lands immediately as an edge to an anchor that
has no `DESCRIBES` yet; the identity plugin treats "anchor with no payload" as **not evaluable**,
which is `pendingClaims` (02 section 2.4) with no machinery: the claim waits by sitting there.

### 2.2 Plugin tables

```cypher
-- Membership, materialized (00: the read path never recurses).
CREATE NODE TABLE Cluster(
  id STRING PRIMARY KEY,           -- minted once, carried across recomputes (5.5 identity plugin, "id survival")
  scope STRING,                    -- 'RUN' | 'CONTAINER'
  aliases STRING[],                -- ids this cluster absorbed, so an old `_id` still resolves (04 section 6 contract 1)
  by STRING, seq INT64
);
CREATE REL TABLE MEMBER_OF(FROM Media TO Cluster, via STRING, by STRING, seq INT64);   -- via: the claim key that admitted the member, or 'SELF' for a singleton

-- A plugin's verdict on one source claim. One per claim per pass in which it was evaluable.
CREATE REL TABLE VERDICT(FROM Payload TO Media, FROM Payload TO Episode,
  claim STRING, accepted BOOLEAN, reason STRING, by STRING, seq INT64);

-- Every derived relationship between two rows. One table, one closed `kind` set (section 3).
CREATE REL TABLE LINKS(FROM Media TO Media,
  key STRING,                      -- kind + from + to + fromEpisode, the natural key the reconciler diffs on
  kind STRING,                     -- 'SAME_AS' | 'PART_OF' | 'INCLUDES' | 'ALIGNS'
  precision STRING,                -- 'ID' | 'DATE' | 'TITLE' | 'COUNT' (what the evidence was)
  score DOUBLE,                    -- the evidence's own number (a similarity, a witness count), never a source score
  evidence JSON,                   -- exactly what was compared: titles and the similarity, the shared days, the counts
  fromEpisode INT64, toEpisode INT64, mapsFrom INT64, mapsTo INT64,   -- the range form (3.2); NULL on SAME_AS and PART_OF
  by STRING, seq INT64
);

-- The view, materialized per cluster by the aggregation plugin (section 6).
CREATE NODE TABLE Aggregate(
  clusterId STRING PRIMARY KEY,
  uri STRING,                      -- ag:(sorted routable member uris)
  scope STRING,
  fields JSON,                     -- every GQL Media field the view carries, computed field by field
  provenance JSON,                 -- per field: {payload, origin} that supplied it (01 case 20)
  handles JSON,                    -- [{relation:'SAME_AS', uri, url, origin}] members, then PART_OF and INCLUDES targets
  preferredRun STRING,             -- for a CONTAINER cluster: the cluster id of its earliest attached run (02 section 1 preferAttachedRun)
  attached BOOLEAN,                -- hidden from listings: a run points at it or it INCLUDES a run, and it has no per-run metadata member (5.9)
  searchKey STRING[],              -- stripped titles for the listing's relevance pass (04 section 2.1)
  by STRING, seq INT64
);
CREATE NODE TABLE EpisodeSlot(
  key STRING PRIMARY KEY,          -- clusterId + '#' + number
  clusterId STRING, number INT64,
  fields JSON, provenance JSON,    -- the GQL Episode fields and who supplied each
  members JSON,                    -- [{uri, origin, ownNumber, via}] the episode rows in this slot and how each got here ('MEMBER' | 'ALIGNS:<key>' | 'INCLUDES:<key>')
  by STRING, seq INT64
);
```

### 2.3 Who writes what, and how the writer is recorded

| table | writer | writer recorded as |
| --- | --- | --- |
| `Media`, `Episode`, `Origin`, `Payload`, `DESCRIBES`, `CLAIMS`, `HAS_EPISODE` | the core's ingest, from a yoga resolver's return value | `Payload.origin` is the answering source; `Payload.operation` the field; every edge carries the payload key it came from; `seq` orders everything |
| `Cluster`, `MEMBER_OF`, `VERDICT`, `LINKS`, `Aggregate`, `EpisodeSlot` | one plugin each, through `ctx.emit` (5.1) | `by` = the plugin id, stamped by the API and refused in input; `seq` = the pass that wrote it |

The core proves a plugin never touched a source row (5.1, "the check"): the source tables have no
update path in the core at all, and after every plugin run the runner reads `count(*)` and
`max(seq)` of `Payload`, `CLAIMS` and `Media`; a change fails the pass and names the plugin. In test
mode it additionally re-hashes every `Payload.raw` against its key.

---

## 3. The edge model

### 3.1 The closed set of kinds

| kind | direction | meaning | asserted by a source (`CLAIMS.relation`) | minted by a plugin (`LINKS.kind`) |
| --- | --- | --- | --- | --- |
| `SAME_AS` | claimant to target; read undirected | the two rows name one thing in one scope | yes: every id handle (03 section 1), every `similarMedia` answer (04 section 1.6), `ASK` provenance | yes: the title plugin (5.7), between the two clusters' link uris |
| `PART_OF` | run or film to the container that holds it | the target is a bigger thing: a show, a season that folds, a film collection (01 case 41) | yes: kitsu's series url (01 case 1), justwatch offers on a show (03 justwatch), watchmode's imdb (03 watchmode), every `partOf()` | yes: the identity plugin derives it from a cross-scope SAME_AS (02 section 2.1's table), the title plugin from a run x container match (02 section 2.10 scope dispatch), the containment plugin from an imprecise answer (5.6) |
| `INCLUDES` | container row to the run it holds | the container's episodes `fromEpisode..toEpisode` are the run's `mapsFrom..mapsTo` | **never**: no source can see the fold (01 I6: "a catalogue that folds two cours into one season premieres on the SAME DAY as the first of them") | yes: the range plugin (5.8), one edge per contiguous segment |
| `ALIGNS` | a cluster member to the cluster's reference member | same run, different numbering: the member's `fromEpisode..toEpisode` are the reference's `mapsFrom..mapsTo` | never | yes: the range plugin, from shared air dates (01 case 13) |

Nothing else. Narrative relations (01 case 50) and the franchise graph stay inside `Payload.raw`
and are forwarded by the aggregation (6.3); they are not edges because no case among the 51 needs
to traverse them, and 01 case 50 measured what traversing them does (36 works, 10 foreign).
`EPISODE_PART_OF` (01 case 51) is dropped: episode containment **is** `INCLUDES` with a range.
`EPISODE_SAME_AS` survives only as a source claim (`CLAIMS` FROM Payload TO Episode, the seed's
episode handles, 03 offline), never as a derived kind: episodes of one cluster meet in an
`EpisodeSlot` by number (01 case 19, 01 I14), and episodes across a fold meet through a range.

### 3.2 The range form, as literal properties

```
(cr:G24H1N3MP-GS00374452)-[:LINKS {
  kind: 'INCLUDES', precision: 'DATE',
  fromEpisode: 12, toEpisode: 23,     -- the container's own numbering
  mapsFrom: 1,  mapsTo: 12,           -- the target run's numbering
  score: 12,                          -- witnesses: episodes whose air day matched
  evidence: {"days": ["2021-07-04", ...], "slack": 1, "runnerUp": null},
  by: 'plugin:range', seq: 1834
}]->(mal:<cour 2>)
```

Invariant on every ranged edge: `toEpisode - fromEpisode = mapsTo - mapsFrom`, both ranges
non-empty, `precision` names the axis that proved it. A piecewise correspondence (01 case 15: a
special at position 14 shifts everything after it) is **several edges between the same pair**, one
per contiguous segment, each with its own witnesses. A segment is never extended past what its
witnesses cover: the arithmetic that placed 13 of 25 Blue Exorcist rows wrongly (01 R1) had no
witnesses past the insert and would have minted nothing past it here.

### 3.3 Provenance and confidence on every edge

| property | on `CLAIMS` (source) | on `LINKS` (plugin) |
| --- | --- | --- |
| who | `Payload.origin` through the FROM endpoint | `by` |
| from what | the payload key (FROM endpoint), `depth` | `evidence` JSON |
| what it declared about the target | `targetScope` (RUN / CONTAINER / NULL) | `precision` |
| how it arrived | `provenance`: `SOURCE` (the source's own statement), `URI` (rebuilt from the address bar by `buildHandlesFromUri`, 01 case 8), `SEED` (the offline seed, 01 case 47), `ASK` (a `similarMedia` answer claimed by the consumer, 04 section 1.6) | n/a |
| how sure | none: a source states, it does not score its claims | `score`: the evidence's own number |

`provenance` is the one addition to what sources emit today: `MediaHandle` gains an optional
`provenance` field, `buildHandlesFromUri` stamps `URI`, the seed stamps `SEED`, the similar consumer
stamps `ASK`, everything else defaults to `SOURCE`. That is what lets the identity plugin treat a
replayed bookmark as a pointer (5.5, rule I4) and closes 01 part 4 problem 2 as a plugin rule rather
than a store special case.

### 3.4 Traversal rules

What an aggregation may walk, and the filter that enforces it:

| the view needs | walks | never walks |
| --- | --- | --- |
| a cluster's members (`handles` SAME_AS, every scalar and array field) | `(m:Media)-[:MEMBER_OF]->(c:Cluster)` | any `LINKS` at all: membership is the identity plugin's output and the only identity there is |
| a run's containers (`handles` PART_OF, the offer links) | `(m)-[:LINKS {kind:'PART_OF'}]->(k)` one hop, plus `(m)<-[:LINKS {kind:'INCLUDES'}]-(k)` one hop | a second hop; a container's own `PART_OF` (a show pointing at a franchise is not this run's container) |
| a run's episodes | own: `(m)-[:HAS_EPISODE]->(e)` for members, renumbered through `ALIGNS`; lent: `(k)-[i:LINKS {kind:'INCLUDES'}]->(m)`, `(k)-[:HAS_EPISODE]->(e)` with `e.number` inside `i.fromEpisode..i.toEpisode` | any episode of a `PART_OF` target (01 case 18: a container's list is every run's at once); any episode of an `INCLUDES` source outside the range |
| a container page's runs | `(r)-[:LINKS {kind:'PART_OF'}]->(k)` reversed, `(k)-[:LINKS {kind:'INCLUDES'}]->(r)` | membership: a container never lists a run's members as its own |

The owner's rule, never treat as `SAME_AS` anything reached through `INCLUDES` or `PART_OF`,
written as the path filter the identity plugin and the read path both use:

```cypher
-- Membership is the transitive closure of ACCEPTED SAME_AS only. A variable length path over LINKS
-- that stays on kind SAME_AS can never step onto an INCLUDES or PART_OF edge, whatever it carries.
MATCH (a:Media)-[e:LINKS*1..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.by = 'plugin:identity')]-(b:Media)
```

That filtered path is the one recursion in the design and it runs **inside the identity plugin**
(over accepted claims, at write time, 5.5), never in a read. Every read of membership is the
materialized `MEMBER_OF` hop (00: 1.7 ms against 6.8 ms recursive on the session graph, 1,033 ms
on a dense one). The same shape refuses the case the owner named: a run reached through
`(run)-[:PART_OF]->(show)<-[:PART_OF]-(other run)` shares a container with the first run and shares
nothing else; it is never a member and never contributes a field.

---

## 4. Ingest

`useOnResolve` stays exactly where it is (`src/worker/extractor.ts:471-497`, 04 section 1.2),
keyed on the named type of the resolved field, installed by `makeExtractor` on every source server
including plugin ones. The fan-out stays and keeps discarding payloads (04 section 1.5): the graph
is still the only join. What changes is what the three DataLoaders hand to the store.

### 4.1 From a return value to rows

`mediaInserter` (04 section 1.3) no longer unwraps handles into rows. For each `Media` return value
it builds one **ingest record**:

```ts
type IngestMedia = {
  origin: string                    // the answering server's origin (the extractor entry), not the row's
  operation: 'MEDIA' | 'MEDIA_PAGE' | 'SIMILAR_MEDIA'
  row: GQLMedia                     // as returned
}
```

The core (`src/worker/graph/ingest.ts`) decomposes it, without normalizing:

1. **Anchors.** `MERGE (m:Media {uri})` for the row's uri and for every `handles[i].node.uri` at any
   depth (cap 4, the existing `readPluginHandles` cap, 04 section 4.3). A `MERGE` on the primary key is
   idempotent (00); the anchor carries nothing a later row could contradict.
2. **Payload.** Canonical JSON of the whole return value (sorted keys, no whitespace), hashed with
   `origin`, `kind` and `uri`. `raw` is the return value with `handles[i].node` replaced by its uri and
   `episodes` replaced by their uris: the two lifted fields land whole on `CLAIMS.node` and in
   `Episode` payloads, so the decomposition is lossless and the round-trip is a core test (9.3).
3. **Claims.** One `CLAIMS` edge per handle at any depth, `relation` and `targetScope` copied from the
   handle, `node` the nested node verbatim, `depth` the nesting level, `provenance` as declared
   (3.3). The key is the hash of (payload key, target uri, relation, depth), so a re-asserted handle
   inside a new payload is a new edge and the identity plugin sees the same claim twice from two
   payloads, which is exactly the count it needs (01 I5.4: five catalogues echoing one packaging is
   one witness, and now the plugin can see that the five payloads restate one nested node).
4. **Nested episodes.** Each `episodes[i]` becomes an `Episode` anchor, an `EPISODE` payload and a
   `HAS_EPISODE` edge from the anchor named by the episode's own `mediaUri` (as returned: the source's
   statement of what it hung the episode on). A row that carries a hundred episodes (anizip, 03
   section 3) costs a hundred episode payloads, once, deduplicated by hash thereafter.
5. **Deferred `similarMedia`.** An answer returned through `similarMedia` lands as a payload with
   `operation: 'SIMILAR_MEDIA'` like any row. The consumer's claim about it (04 section 1.6) is a
   separate ingest of a claim-only record (`row` absent, `claims: [{mediaUri, handleUri, relation}]`,
   provenance `ASK`), which lands as a `CLAIMS` edge from a synthetic payload of kind `MEDIA` whose
   `raw` is the question that was asked (the `SimilarMediaInput`), so the ask itself is on the record.

The writes are three `UNWIND $rows` statements per batch (anchors, payloads plus `DESCRIBES`,
claims plus `HAS_EPISODE`), in one multi-statement `query` (00: 2,000 nodes in 107 ms batched
against 935 ms one at a time). The DataLoader's 50 ms flush and 250 row cap stay (04 section 1.3).

`episodeInserter` does step 4 for episodes resolved through `Media.episodes`, with
`operation: 'EPISODES'`. `originInserter` writes `Origin(id, raw)` with `MERGE ... ON MATCH SET`
replace-whole: an origin is a source's static self-description (03 section 1) and nothing merges
across origins, so versioning it buys nothing.

### 4.2 What is NOT written

- A row is never normalized. `normalizeToStoreMedia` (02 section 2.12) goes; the GraphQL boundary
  keeps its own nullability (the schema reads an absent `scope` as RUN, 03 section 1, and the view
  spells absence as `null`, 6.3).
- A nested handle node never becomes a row (01 I5.3). It is evidence on the claim edge. The
  aggregation may render a `PART_OF` target's `url` and `titles` from `CLAIMS.node` when the target
  has no payload of its own (01 case 42: an imdb link with no source behind it still reaches the UI).
- The placeholder rule (02 section 2.3) is gone as a store rule: a placeholder is a payload like any
  other, and whether it contributes a field is the aggregation's decision (it contributes none,
  because it has none). Whether its `scope` stamp counts is the identity plugin's decision (5.5 rule
  I2: a `URI` or `SEED` claim's `targetScope` never stamps, which is 01 case 47's fix as a rule
  instead of a special case).

### 4.3 A re-fetch of the same uri: keep both

| shape | what happens | why |
| --- | --- | --- |
| byte-identical return | `MERGE (p:Payload {key})` matches; nothing new; no `seq` moves; no event | 04 section 3: the DataLoader flushes every 50 ms and the media page re-asks every origin; `edge-idempotence.test.ts` exists because an event that fires for nothing re-runs every subscribed page |
| a different return for the same uri from the same source (a search row then a media-page row: jikan's season scrape carries `en` and `jp-en` only where its media path carries three titles, 03 jikan) | a second payload; both `DESCRIBES` the anchor | P1. The aggregation reads both and picks per field (6.3): the later payload wins a scalar it carries, a scalar it lacks falls through to the earlier one, and an array is the longest across the origin's payloads. That reproduces `lastWriteLongestArray`'s two promises (an incoming empty array never beats a filled one, an incoming null keeps the existing value: 04 section 5.1 `graph.test.ts` note) with the loser retained instead of destroyed (02 section 2.5) |
| a different return from a different source | a payload under its own origin | the ordinary case |

Not replace: replace-whole would let jikan's thin listing row erase the media row's `jp` title,
which is 01 I5.3 in another costume. Not version-as-current-pointer: two mechanisms where one
suffices. Memory is the cost, at session scale (00: 5,796 media inserted in 2.6 s) it is a few
thousand JSON strings, and no persistence is needed (owner).

### 4.4 How episodes arrive, and the two source changes ingest needs

Episodes arrive inside a media row (anizip, crunchyroll's season-scoped rows, the seed) or through
`Media.episodes` (03 section 3), and both paths land the same three things: anchor, payload,
`HAS_EPISODE` from the `mediaUri` the source stated. Two source-side behaviours must change because
they encode a store decision into a row:

1. **Crunchyroll's `lendContainingSeason` (01 case 12) stops re-pointing episodes.** It returns the
   containing season as an ordinary season-scoped row with its episodes hung on the season, through
   `similarMedia`, and the answer carries `relation: 'PART_OF'` (4.5): "this season of mine holds your
   run". No new handle relation is added to the schema for this. The range plugin then lends the
   season's episodes by air date (5.8). The stored episode keeps Crunchyroll's numbering, which is what
   the record already insists on (02 section 2.9 "READ TIME, AND A COPY").
2. **`similarMedia` answers declare their precision.** The answer type gains
   `relation: MediaHandleRelation` (default `SAME_AS`): a source whose unit is a season that may fold
   answers `PART_OF` when it returns the season that CONTAINS the run rather than IS it (crunchyroll's
   lend path; unogs and justwatch when the fold veto fires but a containing season is identifiable).
   The consumer claims exactly what was answered. This is the owner's "if the source declares itself as
   non precise, instead of SAME_AS we treat them as PART_OF/INCLUDES", expressed where the source can
   say it.

### 4.5 The schema additions, all additive

| field | on | values | who sets it |
| --- | --- | --- | --- |
| `provenance` | `MediaHandle`, `EpisodeHandle` | `SOURCE` (default), `URI`, `SEED`, `ASK` | `buildHandlesFromUri` (`URI`), the seed (`SEED`), the similar consumer (`ASK`) |
| `relation` | the `similarMedia` answer (as a wrapper `{ media, relation }` or a field on the answered `Media`; the wrapper is cleaner) | `SAME_AS`, `PART_OF` | the answering source |
| `startDatePrecision`, `releaseDatePrecision` | `Media`, `Episode` | `DAY`, `MONTH`, `YEAR`, `INSTANT` | optional; a source that knows sets it (anizip's `airDateUtc` against `airdate`, 01 case 38; kitsu and jikan's `YYYY-MM-01`, 01 case 34). Absent means unknown, and the plugins keep the first-of-month reading (5.7) |

The third row is the field 01 case 33 priced as "touching every extractor" and declined at 0.52%.
Here it is optional, so it costs nothing until a source opts in, and the plugin rule that reads it
treats absence exactly as today.

---

## 5. Plugins

### 5.1 The contract

```ts
// src/worker/graph/plugin.ts

export type PluginId = `plugin:${string}`

/** What a plugin reads. Declared so the runner can order plugins and so a test can seed exactly this. */
export type Consumed =
  | 'Payload' | 'CLAIMS' | 'HAS_EPISODE'                                   // source tables
  | 'Cluster' | 'MEMBER_OF' | 'VERDICT'                                     // identity output
  | 'LINKS:SAME_AS' | 'LINKS:PART_OF' | 'LINKS:INCLUDES' | 'LINKS:ALIGNS'   // derived edges, by kind
  | 'Aggregate' | 'EpisodeSlot'                                             // the view

/** What a plugin writes. Every row it writes lands in one of these and carries `by: plugin.id`. */
export type Produced =
  | 'Cluster' | 'MEMBER_OF' | 'VERDICT'
  | 'LINKS:SAME_AS' | 'LINKS:PART_OF' | 'LINKS:INCLUDES' | 'LINKS:ALIGNS'
  | 'Aggregate' | 'EpisodeSlot'

export type Plugin = {
  id: PluginId
  consumes: readonly Consumed[]
  produces: readonly Produced[]
  /**
   * Recompute this plugin's output over the graph as it stands. Must be idempotent: a second run on
   * an unchanged graph reconciles to zero adds and zero removes. `ctx.since` is the seq this plugin
   * last consumed through; a plugin may use it to narrow its scan and must not use it for correctness.
   */
  run(ctx: PluginContext): Promise<PluginReport>
}

export type PluginContext = {
  since: number                                   // 0 on the plugin's first run
  now: number                                     // the seq every row written in this run is stamped with
  /** Any Cypher, over every table. Read only: a write here is caught by the check (5.4) and fails the pass. */
  query<Row>(cypher: string, params?: Record<string, unknown>): Promise<Row[]>
  /**
   * The only write. Diffs `desired` against the rows this plugin already holds in `table` inside
   * `scope`, by the table's natural key (Cluster.id, MEMBER_OF from+to, VERDICT claim, LINKS.key,
   * Aggregate.clusterId, EpisodeSlot.key): inserts what is new, deletes what is no longer desired,
   * leaves identical rows untouched so their `seq` stays old. `by` and `seq` are stamped by the API
   * and refused in the input. `scope` narrows the diff to a subset the plugin recomputed (a cluster,
   * a pair) so a partial recompute never deletes output it did not revisit.
   */
  reconcile(table: Produced, desired: readonly PluginRow[], scope?: { where: string, params?: Record<string, unknown> }): Promise<PluginReport>
  log(event: string, detail: Record<string, unknown>): void
}

export type PluginReport = { added: number, removed: number }
export type PluginRow = Record<string, unknown>   // typed per table in plugin-rows.ts
```

**Read.** `query` runs any Cypher over every table. There is no other read.

**Write.** `reconcile` is the whole write surface, and it is how a plugin retracts and recomputes: it
never appends, it states the rows it currently believes and the core deletes the rest inside the
scope. `DELETE e` on edges selected by `by` is exercised (00). A plugin that wants to retract
everything reconciles `[]` with no scope.

**Ordering.** The runner sorts plugins so that every `consumes` entry is produced by an earlier
plugin or by ingest; a cycle is a startup error. Ties break by id. The default order that falls out:
`plugin:identity`, `plugin:containment`, `plugin:range`, `plugin:title`, `plugin:aggregate`.
`plugin:title` consumes `Cluster` and produces `LINKS:SAME_AS`, which `plugin:identity` consumes:
that cycle is the one the runner allows, by passes (5.2), because it is the loop `mediaPage` already
runs today (`fuzzyMergeMediaClusters` then re-read, 04 section 1.7).

### 5.2 When plugins run

The runner is one async loop in the worker:

| trigger | what runs |
| --- | --- |
| an ingest batch wrote anything new (a DataLoader flush every 50 ms while sources answer, 04 section 1.3) | one **pass**: every plugin once, in order |
| any plugin in the pass reported `added + removed > 0` | another pass, up to **3 passes per trigger** (NEW, the bound the fuzzy pass never had; 04 section 2.1 relies on the union-find's monotonicity to terminate, and there is no union-find now) |
| a pass ends | `graph:changed { clusters: string[] }` with the cluster ids whose `Aggregate` or `EpisodeSlot` rows carry `seq = now`, coalesced by the same `pending` flag the iterators use today (04 section 3) |
| an ingest lands while a pass runs | the pass finishes, then one more starts; no plugin is ever run concurrently with another |

The event payload finally carries uris (04 section 3: "declared and never populated"), which is what
lets `mediaPage` re-read only the clusters that moved instead of the whole store. The whole-store
fallback stays for a page with no known uris (04 section 6 contract 6).

### 5.3 Idempotency

A plugin is a function from the graph to its own rows. Three things make that hold by construction:

1. `reconcile` diffs by natural key, so recomputing the same output writes nothing and moves no `seq`.
2. A plugin's scan reads the graph as it stands, never its own previous output as truth. The one
   exception is id survival in `plugin:identity` (5.5), which reads its previous `Cluster` rows to keep
   `_id` stable, and that is a read of a key, not of a verdict.
3. The runner's test harness (9.3) runs every plugin twice on every fixture and fails if the second
   run reports anything.

### 5.4 The check: a plugin never touches a source row

Before and after every plugin's `run`, the runner reads one statement:

```cypher
MATCH (p:Payload) WITH count(p) AS payloads, max(p.seq) AS pseq
MATCH ()-[c:CLAIMS]->() WITH payloads, pseq, count(c) AS claims, max(c.seq) AS cseq
MATCH (m:Media) WITH payloads, pseq, claims, cseq, count(m) AS medias
MATCH (e:Episode) WITH payloads, pseq, claims, cseq, medias, count(e) AS episodes
MATCH ()-[h:HAS_EPISODE]->() RETURN payloads, pseq, claims, cseq, medias, episodes, count(h) AS hasEpisode
```

A difference fails the pass, deletes every row `WHERE by = $plugin AND seq = $now`, disables the
plugin for the session and reports it. The core itself has no code path that updates or deletes a
source row after ingest, so the only way a source table changes between those two reads is a plugin's
`query` carrying a write, and that is what the check exists to catch. In test mode the check also
re-hashes every `Payload.raw` against its key, which catches a `SET` that changes no count. The
residual: a production `SET` on a payload's `raw` passes the cheap check. Every plugin's own tests run
under the full check (9.3), so it fails there first.

### 5.5 `plugin:identity` (direct edge merging)

**Consumes**: `CLAIMS`, `Payload` (scope, score, `episodeCount`), `LINKS:SAME_AS` and
`LINKS:PART_OF` written by other plugins. **Produces**: `Cluster`, `MEMBER_OF`, `VERDICT`,
`LINKS:PART_OF` (precision `ID`).

**Evidence** (03 section 1): every source's handles with their relation and stamped scope; the
scope each row states about itself; the declared or derived `episodeCount` of each row (03 section 2,
per source).

**Candidate scan**, every claim with both endpoints' evidence in one query:

```cypher
MATCH (p:Payload)-[:DESCRIBES]->(s:Media), (p)-[c:CLAIMS]->(t:Media)
WHERE c.relation IN ['SAME_AS', 'PART_OF']
OPTIONAL MATCH (t)<-[:DESCRIBES]-(tp:Payload)
WITH s, t, c, p, collect(DISTINCT tp.scope) AS targetScopes, count(tp) AS targetPayloads,
     collect(DISTINCT {score: tp.score, count: json_extract(tp.raw, 'episodeCount')}) AS targetCounts
RETURN c.key AS claim, c.relation AS relation, c.provenance AS provenance, c.targetScope AS stamped,
       s.uri AS fromUri, p.origin AS origin, p.scope AS fromScope, p.score AS fromScore,
       json_extract(p.raw, 'episodeCount') AS fromCount,
       t.uri AS toUri, t.origin AS toOrigin, targetScopes, targetPayloads, targetCounts
UNION ALL
MATCH (a:Media)-[l:LINKS]->(b:Media)
WHERE l.kind IN ['SAME_AS', 'PART_OF'] AND l.by <> 'plugin:identity'
RETURN l.key AS claim, l.kind AS relation, l.by AS provenance, NULL AS stamped,
       a.uri AS fromUri, l.by AS origin, NULL AS fromScope, NULL AS fromScore, NULL AS fromCount,
       b.uri AS toUri, b.origin AS toOrigin, [] AS targetScopes, -1 AS targetPayloads, [] AS targetCounts
```

(00: the comparable `NOT EXISTS` scan over 5,796 media took 35 ms; this one is a join on a primary
key hop and returns about one row per claim, 7,896 on the session graph.)

**Decision rules**, applied per claim in a fixed order, each producing a `VERDICT`:

| rule | reads | decides | from |
| --- | --- | --- | --- |
| I1 effective scope | for each anchor: `imdb` origin, then the anchor's own payload scopes, then `targetScope` stamps from `SOURCE` and `ASK` claims, then RUN if any own payload exists, else UNKNOWN | `CONTAINER` if any of the first three says so (the ratchet, 01 I3, now a computed value that a retracted stamp un-ratchets); a `URI` or `SEED` stamp never counts (01 case 47, 01 case 8) | 02 section 2.1 (`SHOW_LEVEL_ORIGINS`, `scopeOf`), 02 section 2.2 |
| I2 evaluability | either endpoint UNKNOWN | verdict `DEFERRED`, reason `no row yet`; re-evaluated next pass. This is `pendingClaims` (02 section 2.4) with no expiry problem because nothing is queued | 01 case 48 |
| I3 pointer | `provenance = 'URI'` | never admits on its own: accepted only when another accepted claim connects the same pair; reason `pointer` (NEW, the design decision 01 part 4 problem 2 says needs the owner: 11.2) | 01 case 8 |
| I4 derivation | the two effective scopes | RUN x RUN SAME_AS: membership candidate. RUN x RUN PART_OF: `LINKS PART_OF` (precision ID). RUN x CONTAINER, either relation, either direction: `LINKS PART_OF` from the run to the container. CONTAINER x CONTAINER SAME_AS: membership candidate in the container space. Never a membership across scopes | 02 section 2.1's four-row table, verbatim |
| I5 fold veto | a RUN x RUN SAME_AS where one side is a catalogue row of a folding origin (`cr`, `nf`, `jw`: 03 section 1 "folds cours into seasons" = yes) with a count C, and the other side's component so far has an agreed length L backed by two declared counts (`runLength`, 02 section 2.8, over DECLARED counts only: 5.9 count classes) | `C > L`: refused as SAME_AS, derived as `LINKS PART_OF` run to season, reason `fold: C > L`, precision `COUNT` (01 I6 zero tolerance). `C < L`: refused, derived as `LINKS PART_OF` season to run, reason `shorter: C < L`, precision `COUNT`: a declared shorter count is the split (01 case 10), a fetched shorter list is a season that is not the run yet (01 case 22: a list length is not a count), and the edge flips to SAME_AS on the pass after the counts agree (11.3). `C == L`: accepted. No agreed length on the run side, or no count on the catalogue side: accepted as claimed (01 case 23: absent is not zero) | 01 case 9, 01 case 10, 01 case 12 (AniList's own `cr` SAME_AS for a 23 episode season against an 11 episode run is exactly this row) |
| I6 disagreeing ids | the candidate's two components, per per-run origin (`mal`, `anilist`, `kitsu`, `anizip`, `anidb`, `offline`, `simkl` anime rows, and the season-scoped shapes of `cr`, `nf`, `jw`, `appletv`, `tmdb`, `tvmaze`: 03 section 1) | two ids of one such origin in the would-be component, neither extending the other by `-` prefix (`extendsId` one way, 01 case 5, 01 R18): refused, reason `disagreeing ids: mal:39535 mal:59193`. First accepted claim in order I7 wins; the loser's verdict names the winner | 02 section 2.11 (`disagreeingIds`, today test-only), 01 case 11 (the store must refuse a handle another cluster already holds), 01 R7 (`nf:81091393-3` holding two Demon Slayer runs of eleven episodes: two mal ids, so the second claim is refused here) |
| I7 order | class then key | class 0: `SOURCE` SAME_AS between two per-run origins; 1: `SOURCE` SAME_AS naming a season-scoped catalogue id; 2: `ASK`; 3: `SEED`; 4: `LINKS SAME_AS` by `plugin:title`; within a class by claim key. Union-find in JS over the accepted candidates in that order, rebuilt from scratch every pass (so it has an inverse: the next pass) | 01 I15, 02 section 2.10 step 5 (link order decides survival) |
| I8 id survival | previous `Cluster` rows | each new component takes the id of the previous cluster it overlaps most, ties to the smaller id, absorbed ids into `aliases`; a split keeps the id on the larger part; no overlap mints a uuid | 02 section 2.6 (`carryComponentId`), 04 section 6 contract 1 |

**Emits**: `Cluster {id, scope, aliases}`, `MEMBER_OF {via: claim key or 'SELF'}` for every
anchor that has at least one payload (a singleton is a cluster of one, as today), `VERDICT` per
evaluable claim, `LINKS PART_OF {precision: 'ID' | 'COUNT'}` for every cross-scope or vetoed claim.
Reconciled without scope: the plugin recomputes the whole membership every pass (union-find over
8,000 accepted edges in JS is under 10 ms; the scan is the cost).

**Failure mode**: a wrong SAME_AS between two per-run ids that nothing contradicts still welds
(01 case 43: `mal:51535` on both AoT Final Chapters parts; blocking `mal` was priced at 3,184 correct
merges). The difference from today is that the weld is a `VERDICT` a page can show, it is undone
the pass after a contradicting id arrives (I6), and it cannot spread through a container (I4).
Refutation not repeated: 01 R4 (silence blocking) has no rule here; silence is `UNKNOWN` and
`UNKNOWN` never vetoes.

### 5.6 `plugin:containment` (PART_OF at cluster level, and the RUN versus CONTAINER exchange)

**Consumes**: `Cluster`, `MEMBER_OF`, `LINKS:PART_OF` (media level, by identity and title),
`Payload` (counts, start dates). **Produces**: `LINKS:PART_OF` and `LINKS:INCLUDES` **between
`Cluster` nodes** (the rel table gains `FROM Cluster TO Cluster`, 00: several pairs per table).

**Evidence** (03 section 5): a run's containers arrive as `PART_OF` claims (kitsu's series url,
justwatch's show container `jw:222366`, watchmode's imdb, `showAsContainer`), as demoted SAME_AS
(identity I4, I5), and as title matches across scopes (5.7). Counts per season come from the folding
catalogues' rows (`nf:80987039-1` = 24, 03 unogs; jw seasons 23/24/14, 03 justwatch).

**Candidate scan**, one query:

```cypher
MATCH (r:Media)-[:MEMBER_OF]->(rc:Cluster {scope: 'RUN'}),
      (r)-[l:LINKS {kind: 'PART_OF'}]->(k:Media)-[:MEMBER_OF]->(kc:Cluster)
WHERE l.by IN ['plugin:identity', 'plugin:title']
RETURN rc.id AS run, kc.id AS container, kc.scope AS containerScope,
       collect(DISTINCT {from: r.uri, to: k.uri, precision: l.precision, by: l.by}) AS edges
```

**Decision rules**:

| rule | decides | from |
| --- | --- | --- |
| C1 lift | one cluster-level `PART_OF` per (run cluster, container cluster) pair, `evidence` listing every media-level edge behind it. The container is the WHOLE container cluster (02 section 4.6: "the other catalogues of an already unioned show were only ever reachable while they were welded in") | 02 section 1 `findPartOfMedia` |
| C2 self | a target inside the run's own cluster is dropped: "a run is not part of itself" | 02 section 1 `findPartOfMedia` (`db.ts`) |
| C3 the exchange | a container never gains a member, a title, a scalar or an episode from a run through this edge, and a run never gains any of those from a container. The edge carries the container's `url` for the badge and the offer, and nothing else crosses it | 01 I2 ("a link that has to assert a false identity to exist is not worth having"), 01 case 42 (a link with no identity claim still reaches the UI), schema `PART_OF` doc |
| C4 count-exact fold (NEW, 01 case 9) | a container cluster member that is a RUN-scoped season row of a folding origin, with a count C (distinct episode ids, not rows: 01 case 16), and k >= 2 run clusters that are `PART_OF` the same show container, ordered by their agreed start day, whose agreed lengths sum exactly to C over a contiguous window, with exactly one such window: `LINKS INCLUDES` season cluster to each run cluster, `precision: 'COUNT'`, ranges by cumulative offset. Link only: the read path never lends episodes on `COUNT` (5.8, 6.4). JustWatch's 23 = 11 + 12 and 24 = 12 + 12 qualify; Netflix's 24, 25, 12 against 11/12/12/12/14 never do, which is right, because Netflix inserts specials (01 case 15) | 01 case 9, 01 case 10 (only exactness counts, rule 5), 01 R7 is not repeated: nothing here refuses a handle, it adds a link |

**Emits**: cluster-level `LINKS PART_OF {precision: 'ID' | 'TITLE' | 'COUNT'}` and `LINKS INCLUDES
{precision: 'COUNT'}`. Reconciled per run cluster touched since `since`.

**Failure mode**: a wrong `PART_OF` (a title match between a run and the wrong show) puts a wrong
badge and a wrong offer on the page, which is the accepted cost of the title axis at 0.9 (01 case
27: 1.062% wrong links after the two-axis gate). It never puts a wrong episode there (C3).

### 5.7 `plugin:title` (title matching)

**Consumes**: `Cluster`, `MEMBER_OF`, `Payload` (titles, start dates, categories, types).
**Produces**: `LINKS:SAME_AS` and `LINKS:PART_OF` between the two clusters' link uris
(`precision: 'TITLE'`). Identity consumes them next pass (5.1).

**Evidence** (03 section 2): main titles only, per source: jikan `en`/`jp-en`/`jp`, anilist the same
three, kitsu `en`/`ja`, anizip `en`/`ja`, one `en` from every catalogue. Synonyms and abbreviated
titles are not on the wire and stay off it (01 case 29, 01 I12: `minna no uta` on 23 unrelated
shows). Start dates: day-precise from mal/anilist/kitsu/appletv/tvmaze, `YYYY-01-01` sentinels from
six catalogues (01 case 33), `YYYY-MM-01` from kitsu and jikan (01 case 34).

**Profile per cluster**, one query, then bucketed in JS:

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(n:Media)<-[:DESCRIBES]-(p:Payload)
WHERE c.seq > $since OR p.seq > $since          -- narrow to clusters that moved; correctness does not depend on it
WITH c, collect(DISTINCT {uri: n.uri, scope: p.scope, score: p.score,
       titles: json_extract(p.raw, 'titles'), startDate: json_extract(p.raw, 'startDate'),
       precision: json_extract(p.raw, 'startDatePrecision'),
       categories: json_extract(p.raw, 'categories'), type: json_extract(p.raw, 'type')}) AS rows
RETURN c.id AS cluster, c.scope AS scope, rows
```

The profile is `profileCluster` (02 section 2.10) computed over payloads instead of rows:

| field | rule | from |
| --- | --- | --- |
| `titles` | per `normalizeTitle(title)` keep the best score; bucket by score; **title ascending within a tier**; take `MAX_TITLES_PER_CLUSTER = 6`; drop titles with no letter (`carriesIdentity`) and pure season labels | 01 case 30 (arrival order 64.5 / 94.9 / 56.0 against title ascending 69.6 / 99.9 / 70.0), 01 case 24 (`HAS_LETTER`), 02 section 2.10 |
| `years` | `yearOf(startDate)` over every payload, sentinels included | 01 case 33 ("`yearOf` still buckets on it") |
| `days` | `startDay(startDate)` dropping any first of a month, **unless the payload carries `startDatePrecision: 'DAY'`** (additive, 4.5) | 01 case 33 (day1 guard: 83 refused / 81 lost, ratio 1.02; removing it costs 77% of streaming attaches), 01 case 34 |
| `formats`, `types`, `seasons` | as today: MOVIE/SERIES from categories and type; `WORK_KINDS` with `TV_SHORT` folded to `TV`; `parseSeasonNumber` over RAW titles | 02 section 2.10 |
| `linkUri` | the lowest uri whose own scope matches the profile's scope | 02 section 2.10 (`fuzzy-merge.ts:102-108`) |
| normaliser | `stripTitle` keeping `[\p{L}\p{N}\s]`, applied to BOTH sides of every comparison, and the scorer divides by `[...text].length` | 01 case 24, 01 R17 (widening only one half is worse than nothing), 01 case 32 |

**Gates**, in order, per pair inside one year bucket, thresholds verbatim from 02 section 2.10:

| # | gate | rule |
| --- | --- | --- |
| 0 | year bucket | only clusters sharing a year are compared |
| 1 | format veto | both name a format and they are disjoint: refuse |
| 2 | season veto | both name a season number and they are disjoint: refuse. Silence never blocks (01 R4: 323 refused for 12,007 lost). Trailing number compared as a VALUE, not a character (01 case 25: `Yami Shibai 16` / `17` at 0.929) |
| 3 | start-date veto | both have a day and no pair within `START_DATE_WINDOW_DAYS = 45`: refuse (01 case 36: consecutive cours sit ~91 days apart, so the window has a structural ceiling) |
| 4 | companion veto | both name a work kind, disjoint, AND `namesCompanionContent` (ten markers): refuse (02 section 2.10: both signals 49 of 84 refused, 2 correct merges destroyed, ratio 24.5) |
| 5 | title | exact normalized equality accepts; `differOnlyByTrailingNumber` skips; `maxPossibleSimilarity < 0.9` skips; `titleSimilarity >= SIMILARITY_THRESHOLD = 0.9` accepts (01 R6: change nothing; every 0.01 above loses ~1,400 correct pairs for ~30 wrong) |

**Emits**: for an accepted pair, `LINKS {kind, precision: 'TITLE', score: similarity, evidence:
{a: [titles], b: [titles], matched: [ta, tb], year, days}}` between the two link uris; `kind` is
`SAME_AS` for RUN x RUN and CONTAINER x CONTAINER, `PART_OF` for RUN x CONTAINER (02 section 2.10
scope dispatch: "a title match between a run and a show is a guess at containment, so it rides an
edge"). Reconciled per bucket recomputed. The re-check before applying (02 section 2.10 step 6) is
unnecessary: identity re-evaluates the link against the graph as it stands, with its own vetoes
(I5, I6), so a link the snapshot allowed is still refused if the components moved.

**Failure mode, accepted and pinned**: `86` and `86 Part 2` (01 case 26, `KNOWN GAP` in
`season-separation.test.ts`) still weld on exact title equality. The diacritic fold (01 case 28,
01 I8: `Nige jôzu no wakagimi` against `Nige Jouzu no Wakagimi`) is a plugin option
`foldDiacritics: false` by default; turning it on is a measured change over the 150 seasons the gate
carries (11.4). The broadcast-quarter veto (01 R4's suggested axis, 01 part 4 problem 5) is not
here: unmeasured for cost.

### 5.8 `plugin:range` (season and episode range matching)

**Consumes**: `Cluster`, `MEMBER_OF`, `HAS_EPISODE`, `Payload` (episode numbers, release dates,
titles; media counts), `LINKS:PART_OF` and `LINKS:INCLUDES` (cluster level, by containment).
**Produces**: `LINKS:ALIGNS` (member to reference member) and `LINKS:INCLUDES` (container row to
run) with the range form (3.2), `precision: 'DATE' | 'TITLE'`.

**Evidence** (03 section 3): episode release dates exist on the wire from **anizip, crunchyroll,
appletv and the seed only**; four sources fetch one and drop it (tvmaze, trakt, simkl, tvdb).
Episode titles: anizip `en` and `ja`; one `en` from cr, nf, jw, tvmaze, kitsu, appletv and the rest.
Numbers: anizip publishes the entry KEY (01 case 14), crunchyroll continues numbering across cours
(01 case 13), unogs numbers positionally (03 unogs), duplicates possible (01 case 16).

**Candidate scan**: every (run cluster, candidate row) pair where the candidate is a member with a
count or numbering that differs, or a container row reachable by one cluster-level `PART_OF` or
`INCLUDES` edge:

```cypher
MATCH (rc:Cluster {scope: 'RUN'})<-[:MEMBER_OF]-(m:Media)-[:HAS_EPISODE]->(e:Episode)<-[:DESCRIBES]-(ep:Payload)
WITH rc, m, collect({uri: e.uri, number: json_extract(ep.raw, 'episodeNumber'),
                     date: json_extract(ep.raw, 'releaseDate'), title: json_extract(ep.raw, 'titles')}) AS own
WITH rc, collect({member: m.uri, origin: m.origin, episodes: own}) AS members
OPTIONAL MATCH (rc)<-[l:LINKS]-(kc:Cluster)<-[:MEMBER_OF]-(k:Media)-[:HAS_EPISODE]->(f:Episode)<-[:DESCRIBES]-(fp:Payload)
WHERE l.kind IN ['PART_OF', 'INCLUDES'] AND l.by = 'plugin:containment'
WITH rc, members, k, collect({uri: f.uri, number: json_extract(fp.raw, 'episodeNumber'),
                              date: json_extract(fp.raw, 'releaseDate'), title: json_extract(fp.raw, 'titles')}) AS lent
RETURN rc.id AS cluster, members, collect({container: k.uri, origin: k.origin, episodes: lent}) AS containers
```

(00: the 12 episodes of one run, ordered, 6 ms; this scan is per dirty cluster.)

**Decision rules**, in order of evidence, each segment independently:

| axis | rule | thresholds | from | never |
| --- | --- | --- | --- | --- |
| DATE | for each candidate episode, the reference episodes whose UTC day is within one day; a day naming two reference numbers disqualifies that day; votes per offset; a contiguous run of matched pairs with the same offset is one segment | `MIN_ALIGNED = 2` per segment; a runner-up offset with equal support inside the same span refuses the span; `slack = 1 day` (ani.zip stamps `2021-01-10T15:00:00Z`, the 11th in Tokyo, and Crunchyroll publishes the Tokyo date) | 02 section 2.9 `alignmentOffset` verbatim, 01 case 13, 01 case 38 (a named day is read at UTC) | compare to a media start date (02 section 2.9: three days off Crunchyroll's own episode 1) |
| TITLE | exact equality after `stripTitle` on both sides; generic titles excluded (`GENERIC_EPISODE`) | `MIN_EPISODE_TITLE_MATCHES = 3` real titles on both sides, `EPISODE_TITLE_COVERAGE = 0.6` of the candidate's real titles | 01 case 21, 03 section 4 rule 2, 01 R2's surviving half ("decisive in the other direction, between two metadata catalogues") | across a boundary that retranslates: `nf` is excluded outright (01 R2: 4 of 25 exact, the best wrong pair at 0.5463 outscores its true pair at 0.4537; 01 I7). No similarity threshold on episode titles, ever (01 R2) |
| COUNT | none here. A count-exact fold is a containment link (5.6 C4), never a range that lends | | 01 R1 (arithmetic placement: 13 of 25 rows wrong), 01 R20 (offsets are not lookup-able) | |

The reference numbering of a cluster: the members whose declared count equals the cluster's agreed
length (`runLength`), grouped by origin (02 section 2.9 `alignRunEpisodes`: "grouped by ORIGIN,
never by which row an episode hangs off"). A member whose numbers already equal the reference's
gets no `ALIGNS` (identity offset is the absence of an edge).

**The loan rule** (01 I9, 02 section 2.9 `runEpisodes`): an `INCLUDES` range is minted only when
the run's length is backed by **two declared-count witnesses**; with one witness the container lends
nothing ("a LOAN is refused whole when the length is uncorroborated; a MEMBER's episodes are never
hidden that way"). The range never exceeds `1..length` on the run side. Specials (a null or
non-positive number, anizip's `S1` key) are never inside a range.

**Emits**: per segment one `LINKS {kind: 'ALIGNS' | 'INCLUDES', precision, fromEpisode, toEpisode,
mapsFrom, mapsTo, score: witnesses, evidence: {days | titles, runnerUp}}`. Reconciled per run
cluster.

**Failure mode**: a container with no dates and retranslated titles (Netflix) gets no range, so a
folded cour shows no Netflix episode rows. That is 01 part 4 problem 3 left exactly where the
record left it ("anything better needs an episode-level identity nobody publishes"), and it is the
correct side of 01 I2. What the design adds is the place to put a better answer if one appears
(a source that publishes Netflix episode dates would light up the DATE axis with no plugin change).

### 5.9 `plugin:aggregate` (the view)

**Consumes**: everything. **Produces**: `Aggregate` per cluster, `EpisodeSlot` per (cluster,
number). Reconciled per cluster touched since `since` (a cluster is touched when a member's
payload, a `MEMBER_OF`, a cluster-level `LINKS` or a range edge into it carries `seq > since`).

**The cluster read**, one query per dirty cluster (00: a 60 cluster page with containers and
episode counts in one query, 49 ms; this is the per-cluster slice of that):

```cypher
MATCH (c:Cluster {id: $id})<-[:MEMBER_OF]-(m:Media)<-[:DESCRIBES]-(p:Payload)
WITH c, collect({uri: m.uri, origin: m.origin, payload: p.key, seq: p.seq, score: p.score, scope: p.scope, raw: p.raw}) AS rows
OPTIONAL MATCH (c)-[l:LINKS]->(k:Cluster)
WHERE l.kind IN ['PART_OF'] AND l.by = 'plugin:containment'
WITH c, rows, collect({cluster: k.id, precision: l.precision, evidence: l.evidence}) AS containers
OPTIONAL MATCH (c)<-[i:LINKS]-(s:Cluster) WHERE i.kind = 'INCLUDES'
RETURN c, rows, containers, collect({cluster: s.id, precision: i.precision, range: [i.fromEpisode, i.toEpisode, i.mapsFrom, i.mapsTo]}) AS includedBy
```

**Field rules**, each recorded in `provenance` as `{payload, origin}` (01 case 20: a rendered value
names the row it came from):

| field | rule | from |
| --- | --- | --- |
| `_id` | `Cluster.id` | 04 section 6 contract 1 |
| `uri`, `id`, `origin`, `url` | `ag:(sorted routable member uris)`, `'ag'`, the app's route | 02 section 4.1 |
| `scope` | `Cluster.scope` | |
| within one origin, several payloads | a scalar: the latest payload that carries it; an array: the longest across that origin's payloads, ties to the latest (4.3) | 02 section 2.5, 04 section 5.1 `graph.test.ts` |
| scalars across origins (`url`, `type`, `status`, `averageScore`, `popularity`, `startDate`, `endDate`, `isAdult`, `nextAiringEpisode`) | first non-null in score order, ties by origin name then payload key (deterministic, 01 I15) | 02 section 4.1 |
| unscored rows | a plugin constant `DEFAULT_ROW_SCORE = {anizip: 0.9}` applied when `Payload.score` is NULL, **off by default** (11.5) | 01 case 44 (anizip's row sorts below Netflix for every scalar), 01 R14 (do not raise offline or kitsu) |
| `episodeCount` | `tieredConsensus` over DECLARED counts first (mal, anilist, anizip, offline, jw `totalEpisodeCount`: 03 section 2), then over derived lengths only if no declared count exists; the tier is lexicographic, never a sum | 01 I11, 01 R3 (the sum was identical in 100 of 100 and wrong in three real clusters), 01 case 22, 01 case 45 |
| `season`, `seasonYear` | as a PAIR from the highest-scored payload naming a season | 01 I13 |
| `categories` | ANIME if present plus exactly one of MOVIE/SERIES, first in score order | 02 section 4.1 |
| `genres`, `tags` | case-insensitive dedupe keeping the best-scored spelling | 02 section 4.1 |
| `titles` | main titles only, score sorted, deduped on the exact string | 01 I12 |
| `descriptions`, `shortDescriptions`, `covers`, `banners`, `trailers` | score sorted; trailers deduped on uri | 02 section 4.1 |
| `relations`, `franchise` | relations deduped on `relation \0 node.uri` with self edges dropped; franchise from the first supplier whole, never spliced | 02 section 4.1, 01 case 50 |
| `handles` | every member as `SAME_AS` in score order with its `url`; then every container cluster's members as `PART_OF` with their `url` (from the target's own payload, else from the claim's `node`, 01 case 42); then every `INCLUDES` source as `PART_OF` (the season that holds this run) | 04 section 6 contract 3, 02 section 4.1 (read by the store so no caller can forget them) |
| `preferredRun` (CONTAINER only) | the run cluster `PART_OF` this container with the earliest agreed start day, ties by cluster id | 02 section 1 `preferAttachedRun` |
| `attached` | true when a run cluster is `PART_OF` this cluster or this cluster `INCLUDES` a run cluster, AND no member of this cluster is from a per-run metadata origin (mal, anilist, kitsu, anizip, offline, simkl anime rows: 03 section 1). A show, a folded season and a split season hide behind the runs they hold; a run is never hidden; a season row nothing points at keeps its card (today's behaviour for a live-action catalogue) | 02 section 1 `hideAttachedContainers`, 01 case 49 (the listing orphan a stored season creates) |
| `searchKey` | `stripTitle` of every title | 04 section 2.1 (`searchRelevance` at 0.7) |

The singleton path (02 section 4.1: a one-member cluster skipped every normalization) is gone: one
rule for every cluster size.

**Episode slots**, per run cluster, one query (the range scan's shape, 5.8), then in JS:

1. Own episodes: every `HAS_EPISODE` target of every member, each payload's `episodeNumber` mapped
   through the member's `ALIGNS` edge if it has one (`n - fromEpisode + mapsFrom` inside the range;
   outside it, dropped, which is what unaligned 13..20 does today, 01 case 13).
2. Lent episodes: for every `INCLUDES` edge into this cluster with `precision` `DATE` or `TITLE`,
   the source row's episodes inside `fromEpisode..toEpisode`, mapped the same way. `COUNT` edges lend
   nothing (5.6 C4).
3. Window `1..length` when a length exists with two witnesses; no length, no window (02 section
   2.9 gate 1: "there is nothing to be wrong about"). Non-positive and null numbers keep their own
   slot keyed by uri, so a special never collides with episode 1 (01 case 19).
4. Group by mapped number: one `EpisodeSlot` per number, `members` listing every episode row with
   its own number and `via`. Fields per slot: `url`, `embedUrl`, `releaseDate`, `seasonNumber`,
   `absoluteEpisodeNumber`, `runtime` first non-null in score order; titles, descriptions, thumbnails
   score sorted (02 section 4.2), each with provenance. The displayed `episodeNumber` is the slot's
   number: 1..12 for a split cour, the owner's call (01 case 14).

Grouping by number is safe because the input is one cluster and its proven ranges, never a
container's list (01 I14, 01 I10).

---

## 6. The read path

Every read is a lookup of `plugin:aggregate`'s output. No read computes a field, walks a
component, or writes. The five app reads (04 section 2.1) map as follows.

### 6.1 A page: `Subscription.mediaPage`

One query, then the pure functions the app already has:

```cypher
-- Every run aggregate, plus every container aggregate no run on this page points at.
MATCH (a:Aggregate)
WHERE ($uris IS NULL OR a.uri IN $uris OR EXISTS {
        MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: a.clusterId}) WHERE m.uri IN $uris })
  AND NOT a.attached
RETURN a.clusterId AS _id, a.uri AS uri, a.scope AS scope, a.fields AS fields, a.handles AS handles, a.searchKey AS searchKey
```

Then `applyMediaFilters` (KEEP, 04 section 5.1) over `fields`, `searchRelevance` at
`SEARCH_RELEVANCE_THRESHOLD = 0.7` over `searchKey`, the popularity sort (04 section 2.1). The
whole-store fallback with no `uris` stays (04 section 6 contract 6). `hideAttachedContainers` is the
`NOT a.attached` clause; `fuzzyMergeMediaClusters` no longer runs from a read (it is `plugin:title`,
run by the runner), so the read has no write inside it (02 section 3 "policy entangled with
storage" items 7 and 8 are closed by construction). Budget: 00's 60 cluster page in one query was
49 ms with the joins; this is a scan of pre-joined rows.

### 6.2 A detail view: `Subscription.media`

Two queries. First resolve the requested uri to a cluster, preferring a run:

```cypher
-- $uris: the decoded route uri, or every member uri of an aggregated uri, in order.
UNWIND $uris AS u
MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster)
OPTIONAL MATCH (a:Aggregate {clusterId: c.id})
RETURN c.id AS id, c.scope AS scope, a.preferredRun AS preferredRun, a
ORDER BY CASE WHEN c.scope = 'RUN' THEN 0 ELSE 1 END
LIMIT 1
```

An old `_id` resolves through `Cluster.aliases` (`MATCH (c:Cluster) WHERE $id IN c.aliases`), so an
address the modal grew keeps working (04 section 2.3 `shouldGrowAddress`). A container cluster with
a `preferredRun` answers with that run's aggregate (02 section 1 `preferAttachedRun`: "a show page
with no episode and no offer is what splitting the spaces cost until this"); a container with none
answers as itself, which is the container page (01 part 4 problem 10, built for free: 6.4).

Then the episodes, when the selection asks for them:

```cypher
MATCH (s:EpisodeSlot {clusterId: $id})
RETURN s.number AS episodeNumber, s.fields AS fields, s.provenance AS provenance, s.members AS members
ORDER BY s.number
```

A read that finds no aggregate yields nothing, and the `graph:changed` event with this cluster's id
wakes it (04 section 6 contract 5). The `askUnasked` loop and the similar consumer keep reading the
aggregate's `handles` (7.1). `waitForMedia`'s blocking read from inside a source resolver (04 section
1.8) is the same first query, awaited.

### 6.3 Field by field, and why the read stays a view

The aggregated `Media` is `Aggregate.fields` plus `_id`, `uri`, `handles`, and `episodes` from the
slots. Every field was computed by 5.9's table, which is POLICY and therefore lives in
`plugin:aggregate`, retractable by its stamp and re-derivable from the payloads it cites. The read is
a VIEW in the sense that matters: nothing it returns is a source row, nothing it returns is stored
anywhere a source could overwrite, and deleting every `Aggregate` and `EpisodeSlot` row loses nothing
(the next pass rebuilds them from payloads and edges). What changed from today is only WHEN the view
is computed: at write time by a plugin, once per dirty cluster, instead of at read time on every
event for every subscriber (04 section 3: "an event that fires when nothing changed is not free").

Per-field provenance is on the wire as an optional `provenance` selection on `Media` and `Episode`
(`[{field, origin, uri}]`), so a debug view can show that a description came from Crunchyroll's
season 1 row on a season 3 page (01 case 20's hybrid row is now visible as a hybrid).

### 6.4 Rendering the RUN/CONTAINER exchange and the fold

**A run's page** (a cour): its own members' fields; `handles` SAME_AS for the members, `PART_OF`
for its show containers (`cr:G24H1N3MP` with the Crunchyroll series url, `jw:222366`, `imdb:tt13303712`)
and for every season that `INCLUDES` it (`jw:222366-<season 1>` with its url, `cr:G24H1N3MP-GS...`).
The badge row renders SAME_AS first then the rest, reading `node.url` (04 section 2.3). Playback
reads SAME_AS only, on media and on episode (04 section 2.3), and that is where lending shows: a
lent Crunchyroll episode is a SAME_AS handle **on the episode slot** (the episode is the same
episode; only the media containment is imprecise), so the watch page builds a release for it.

**The episode list of a run held by a longer season**: the slots, numbered 1..length, each carrying
its own members plus the lent episodes inside the proven range. Mushoku Tensei season 1 cour 1 shows
11 rows, each with an anizip title and date and a Crunchyroll link, and never the twelve of cour 2
(the range stops at 11) nor the special (never inside a range).

**A season's own page** (a Netflix season or a JustWatch season opened as itself): a RUN-scoped
container row is its own cluster of one (identity I4 never merges it into a cour), so it has an
aggregate: its own 24 raw rows as slots, its show container, and, when a range exists, the runs it
`INCLUDES` rendered as run cards ("holds: season 1 part 1, 1..11; season 1 part 2, 12..23"). With no
range (Netflix) it says only "part of Mushoku Tensei". This is the listing orphan of 01 case 49 turned
into a page: `attached` hides it from listings only while a run on the same page points at it.

**A show's page** (`cr:G24H1N3MP`, `imdb:tt13303712`): a CONTAINER cluster; `preferredRun` sends the
detail view to the earliest attached run; the container page itself lists its runs from the reversed
`PART_OF` edges, earliest first, and its own raw fields (the series description, the poster).

---

## 7. The trace loop

### 7.1 The loop

1. A payload lands (4.1). Its claims name uris; anchors exist for all of them.
2. A pass runs. `plugin:identity` accepts what it can; a newly admitted member's origin is now
   addressable. `plugin:aggregate` rewrites the cluster's `handles`; `graph:changed {clusters}`.
3. `Subscription.media`'s `askUnasked` (04 section 2.1) reads the new `handles`, finds an origin it
   has not asked with a uri naming it, and re-subscribes that source with the wider uri. The set of
   asked (cluster id, origin, uri) triples only grows.
4. The similar consumer (04 section 1.6) reads `handles` PART_OF for containers whose origin
   implements `similarMedia`, and asks once per (cluster, container) with evidence from the run's OWN
   members only: `MATCH (c:Cluster {id})<-[:MEMBER_OF]-(m)-[:HAS_EPISODE]->(e)`, never a lent episode,
   never a container's (01 R2's blocker: the S2 cour-1 evidence carried both cours' titles because it
   was built from the raw walk).
5. The answer lands as a payload; the consumer's claim lands as a `CLAIMS` edge with `ASK`
   provenance and the relation the source declared (4.4). Back to 2.

### 7.2 What stops it

| stop | mechanism | from |
| --- | --- | --- |
| a re-fetch that returns the same bytes | the payload hash matches; no `seq` moves; no pass; no event | 4.3, 04 section 3 |
| the same origin asked twice for one cluster with one uri | `askUnasked`'s grow-only set, keyed on cluster id (stable, 5.5 I8) | 04 section 2.1 |
| a container asked again and again | `MAX_ASKS_PER_PAIR = 4` per (cluster, container), one driver per record, re-ask only on a changed question | 04 section 1.6 (`similar-consumer.ts:41`), 01 R15 (the bound is one question per declared origin plus one) |
| a burst of answers | `MAX_CONCURRENT_SIMILAR_MEDIA = 32`, `MAX_SIMILAR_MEDIA_PER_CALLER = 8`, `SIMILAR_MEDIA_TIMEOUT_MS = 30_000`, `SAFE_SHOW_ID` | 04 section 1.6 (`extractor.ts:198-244`) |
| a pass that keeps writing | 3 passes per trigger (5.2), each plugin idempotent | NEW, 5.2 |
| a claim that would fetch through a container | only `handles` SAME_AS uris are re-asked as the run's own ids; a `PART_OF` uri is only ever the subject of a `similarMedia` question, whose answer is a claim evaluated like any other (5.5) and never a membership by itself | owner's prohibition, 3.4 |
| a fetch that answers with a container | its row lands, its claims are cross-scope, identity derives `PART_OF`, no new SAME_AS member appears, so `askUnasked` has nothing new to ask | 5.5 I4 |

### 7.3 The prohibition, in the loop

An edge `(run)-[:PART_OF]->(show)` makes `show`'s origin askable through `similarMedia` and nothing
else. An edge `(season)-[:INCLUDES]->(run)` makes the season's episodes lendable inside the range and
nothing else. Neither ever makes `show` or `season` a member, so neither ever adds their uri to the
set of ids the run is asked about as itself, and neither ever lets a field of theirs into the run's
aggregate. A source that answers a `similarMedia` question with a SAME_AS claim about a season that
holds more episodes than the run is demoted by identity I5 on arrival, so even a source that gets
the relation wrong cannot open the door. The one recursion in the design is the filtered SAME_AS path
inside identity (3.4), and it cannot step onto an `INCLUDES` or `PART_OF` edge.

---

## 8. Walkthroughs

Uris and numbers are the record's (01 group B, 01 cases 1, 5, 6, 12, 13, 14; 03 section 5). Where
the record does not carry an id it is written `<...>` rather than invented.

### 8.1 Mushoku Tensei: five runs, three streaming seasons, Netflix with no dates

**Rows** (anchors with at least one payload):

| thing | uris | counts and dates on the wire |
| --- | --- | --- |
| S1 cour 1 | `mal:39535`, `anilist:108465`, `kitsu:42323`, `offline:mal-39535`, `anizip:<S1>` | 11 declared by mal and anilist; day-precise start 2021-01; anizip episodes 1..11 dated |
| S1 cour 2 | `mal:<c2>`, `anilist:<c2>`, `kitsu:<c2>`, `anizip:<c2>` | 12; anizip episodes 1..12 dated |
| S2 part 1 | `kitsu:45950`, `anilist:<p1>`, `mal:<p1>`, `anizip:<p1>` | MAL publishes no count, AniList says 13 for a run that aired 12 (01 case 12), anizip 12 |
| S2 part 2 | `kitsu:47694`, `anizip:18104`, `mal:<p2>`, `anilist:<p2>` | 12; anizip keys 1..12 carrying `episodeNumber` 13..24 and absolute 38..49 (01 case 14) |
| S3 | `mal:59193`, `anilist:178789`, `kitsu:49002`, `offline:mal-59193` | 14 announced |
| Crunchyroll | `cr:G24H1N3MP` (show, CONTAINER); `cr:G24H1N3MP-GS00374452` and the other season ids (RUN) | S1 as one season of 23 plus a special; per-episode `episode_air_date` (03 crunchyroll) |
| Netflix via unogs | `nf:80987039` (show); `nf:80987039-1` 24, `-2` 25, `-3` 12 (RUN rows) | no date at any level (03 unogs) |
| JustWatch | `jw:222366` (show); `jw:222366-<s1>` 23, `-<s2>` 24, `-<s3>` 14 (`230388` is one of them, 01 I4) | a year per season, never a day |
| others | `tvmaze:52279` (bare, CONTAINER), `imdb:tt13303712` (five sources), `tmdb:94664` (trakt, bare) | |

**Claims** (`CLAIMS` edges): mal, anilist, kitsu, anizip, offline mint each other SAME_AS per cour
(03 section 5 "a union by id"). Kitsu mints `PART_OF cr:G24H1N3MP` on 45950, 47694, 49002, stamped
CONTAINER (01 case 1). AniList's `cr` mapping asks Crunchyroll and claims whatever it answers (03
anilist); for cour 1 (11 episodes, start 2021-01-11) Crunchyroll's season of 23 premiered the same
day, so its picker's fold veto refuses SAME_AS and the lend path answers the containing season with
`relation: PART_OF` (4.4). JustWatch's offers on the show mint `nf:80987039` PART_OF and the show
container `jw:222366` PART_OF (03 justwatch). tvmaze mints `imdb:tt13303712` SAME_AS stamped
CONTAINER. A bookmark of `ag:(anilist:108465,cr:G24H1N3MP,...)` rebroadcasts `cr:G24H1N3MP` SAME_AS
with provenance `URI` (01 case 6's bridge).

**`plugin:identity`** mints:

| verdict | claims | why |
| --- | --- | --- |
| five run clusters, `MEMBER_OF` each | class 0 SAME_AS among per-run origins | I4 RUN x RUN |
| `LINKS PART_OF` from each of kitsu:45950, 47694, 49002 to `cr:G24H1N3MP`, precision ID | kitsu's PART_OF | I4 RUN x CONTAINER (target stamped CONTAINER by a SOURCE claim and by Crunchyroll's own search row) |
| `LINKS PART_OF` cour 1 to `cr:G24H1N3MP-GS<S1>` | AniList's ASK claim answered `PART_OF`; had Crunchyroll answered SAME_AS, I5 demotes it: `fold: 23 > 11` | I4, I5 |
| refused, reason `pointer` | the bookmark's `URI` SAME_AS naming `cr:G24H1N3MP` | I3; and it is cross-scope anyway, so it could only ever be PART_OF |
| one container cluster `{cr:G24H1N3MP, jw:222366, tvmaze:52279, imdb:tt13303712}` | tvmaze's imdb SAME_AS (CONTAINER x CONTAINER); `plugin:title` SAME_AS between `cr:G24H1N3MP` and `jw:222366` on the show title, next pass | I4, 5.7 |
| `jw:222366-<s3>` becomes a MEMBER of S3 | JustWatch's picker rule 4 answers the 2026 season of 14 for a 14 episode run; C == L | I5 exactness |
| `nf:80987039-1` never claims anything | unogs's picker refuses: 24 > 11 (03 section 5) | nothing to evaluate |

**`plugin:containment`** mints cluster-level `PART_OF` from every cour to the show cluster (C1),
and the count-exact fold (C4): `jw:222366-<s1>` (23) INCLUDES cour 1 `{1..11 -> 1..11}` and cour 2
`{12..23 -> 1..12}`, `jw:222366-<s2>` (24) INCLUDES S2 part 1 `{1..12 -> 1..12}` and part 2
`{13..24 -> 1..12}`, all `precision: 'COUNT'`, link only. Netflix's 24, 25 and 12 partition nothing
(11 + 12 = 23, 12 + 12 = 24, 14): no edge, correctly, because Netflix's season 2 opens with the
special "Fitz the Guardian" (01 case 15).

**`plugin:range`** mints, by dates (anizip against Crunchyroll):

```
(cr:G24H1N3MP-GS<S1>)-[:LINKS {kind:'INCLUDES', precision:'DATE', fromEpisode:1,  toEpisode:11, mapsFrom:1, mapsTo:11, score:11}]->(mal:39535)
(cr:G24H1N3MP-GS<S1>)-[:LINKS {kind:'INCLUDES', precision:'DATE', fromEpisode:12, toEpisode:23, mapsFrom:1, mapsTo:12, score:12}]->(mal:<c2>)
(cr:G24H1N3MP-GS<S2>)-[:LINKS {kind:'INCLUDES', precision:'DATE', fromEpisode:13, toEpisode:24, mapsFrom:1, mapsTo:12, score:12}]->(kitsu:47694)
```

The special after episode 23 matches no anizip day and sits outside every segment. **S2 part 1 gets
no range**: its length is AniList's 13 on one witness against anizip's 12 in a lower tier, so the
loan rule refuses (01 I9, exactly today's "Part one gets nothing because MAL publishes no
`episodeCount` for it"). For Netflix no range exists: no dates, and titles are excluded for `nf`
(01 R2).

**`plugin:aggregate`** writes five run aggregates, one show aggregate (`attached: true`,
`preferredRun`: cour 1), and one aggregate per Netflix and JustWatch season row (`attached: true`:
they are `INCLUDES` sources or `PART_OF` targets of a run and carry no per-run metadata origin).
Cour 1's `handles`: `anilist:108465`, `mal:39535`, `kitsu:42323`, `offline:mal-39535`, `anizip:<S1>`
as SAME_AS; then `cr:G24H1N3MP` (series url), `jw:222366`, `imdb:tt13303712`, `nf:80987039` (netflix
title url), `jw:222366-<s1>`, `cr:G24H1N3MP-GS<S1>` as PART_OF. Eleven `EpisodeSlot`s, each with the
anizip row (title, date, thumbnail) and the Crunchyroll row lent through the DATE range, the
Crunchyroll episode as a SAME_AS handle on the slot with its `/watch/` url.

**Queries the page runs**: 6.2's two. **What the user sees**: on the listing, five cards and no
show card, no Netflix season card. On cour 1's page: 11 rows, each playable on Crunchyroll, none
from cour 2, no special; badges for the five catalogues, then Crunchyroll, JustWatch, IMDb and
Netflix as container links. On S2 part 2's page: 12 rows numbered 1..12 (the owner's call, 01 case
14), each with the Crunchyroll episode Crunchyroll numbers 13..24. On the Netflix season 1 page
(opened by its own uri): its 24 raw rows, "part of Mushoku Tensei: Jobless Reincarnation", and no
run cards, because nothing proved which rows are which cour. On the show page: five run cards,
earliest first.

### 8.2 The Elusive Samurai: Crunchyroll numbers 13..20 for episodes 1..8

**Rows**: `anizip:18903` (no row score, count 12, episodes 1..12 weekly from 2026-07-17),
`mal:60059` (0.9, count 12), `anilist:182616` (0.8, count 12), `kitsu:49265` (0.3, count 12),
`cr:GQWH0M19X-GS00366034` (0.5, count 8, episodes numbered 13..20 on the first eight of those same
days). JustWatch's own title for it is `Nige jôzu no wakagimi` (01 case 28).

**`plugin:identity`**: SAME_AS class 0 among the four per-run rows: one cluster, agreed length 12 by
mal and anilist (two declared witnesses). Crunchyroll's row arrives SAME_AS through AniList's `cr`
ask (class 2): C = 8 against L = 12, and 8 is a fetched list length. Under I5 as written (exactness
at the chokepoint) the claim is derived `LINKS PART_OF` season to run, reason `shorter: 8 < 12`,
precision COUNT, and flips to SAME_AS on the pass after Crunchyroll's list reaches 12. (This is the
one place the design is stricter than the shipped code, which keeps the row a member; 11.3.)

**`plugin:range`**: the reference numbering is anizip's (count 12 = length). Crunchyroll's eight
episodes share eight UTC days with anizip's 1..8 within one day of slack, offset -12, no runner-up:

```
(cr:GQWH0M19X-GS00366034)-[:LINKS {kind:'INCLUDES', precision:'DATE', fromEpisode:13, toEpisode:20, mapsFrom:1, mapsTo:8, score:8,
  evidence:{days:['2026-07-17','2026-07-24',...,'2026-09-04'], slack:1, runnerUp:null}}]->(anizip:18903)
```

(When the row is a member instead, the same plugin mints the same range as `ALIGNS`.)

**`plugin:aggregate`**: twelve slots. Slots 1..8 hold the anizip episode and the Crunchyroll episode
(`ownNumber` 13..20, `via: 'INCLUDES:<key>'`), slots 9..12 the anizip episode alone. The
`episodeCount` is 12 (tier 0.9, mal; anilist agrees at 0.8).

**What the user sees**: twelve rows, not twenty (01 case 13's defect); rows 1..8 play on
Crunchyroll; the Crunchyroll badge on the media reads as a container link until the season finishes.
JustWatch contributes nothing: `rankByTitle` at 0.9 refuses `Nige jôzu no wakagimi` against
`Nige Jouzu no Wakagimi` (01 case 28, the documented loss; `foldDiacritics` is off, 11.4).

### 8.3 Blue Exorcist: the special at position 14 that broke the offset vote

**Rows**: the 25 episode run (its per-run ids are not in the record; anizip supplies 25 dated
episodes 1..25), and Netflix `nf:70304252-1`: 26 rows, position 14 is epid `80005451` "Runaway
Kuro", a special that aired after the run ended (01 case 15).

**Claims**: the similar consumer asks unogs about `nf:70304252` (PART_OF via JustWatch or watchmode)
with count 25 and anizip's titles. unogs's picker: 26 > 25 is fold-vetoed, so no SAME_AS; if unogs
answers the containing season with `relation: PART_OF`, a PART_OF claim lands; otherwise nothing.

**`plugin:identity`**: `LINKS PART_OF` run to `nf:70304252-1` at most (precision ID or COUNT).
**`plugin:containment`**: lifts it; C4 finds no partition (26 is not a sum of runs).
**`plugin:range`**: DATE axis has no Netflix dates; TITLE axis excludes `nf` (01 R2); COUNT never
lends. **No range is minted.**

**What the user sees**: 25 rows from anizip, none carrying a Netflix link, a Netflix badge on the
media as a container link with the title url. Position 14 never lands on any row. Under 01 R1's
title vote, offset 0 won by one vote and 13 of 25 rows carried the wrong playable url; here the
absence of evidence is an absence of rows, which is 01 I2's side of the exchange.

### 8.4 Fullmetal Alchemist: 64 episodes split into five Netflix seasons

**Rows**: the 64 episode run (01 case 10; ids not in the record, written `<fma>`), Netflix
`nf:<fma>-1` .. `-5` of about 13 each, each a RUN-scoped row with positionally numbered episodes and
no dates.

**Claims**: unogs's picker rule 5 comments exactly this case ("a shorter first season may be one
half of our run, so only exactness counts") and refuses every season: no SAME_AS claim. JustWatch and
watchmode mint `nf:<fma>` PART_OF on the show.

**`plugin:identity`**: `LINKS PART_OF` run to the `nf:<fma>` show. Had any source claimed a season
SAME_AS (BAKI's year-rule weld, 01 case 10: 13 against 26 through rule 4), I5 derives
`LINKS PART_OF` season to run, reason `shorter: 13 < 64`, precision COUNT, never a membership.
**`plugin:containment`**: C4's inverse is not implemented (a run partitioned INTO seasons); the five
seasons stay `PART_OF` the show only. **`plugin:range`**: nothing (no dates, `nf` excluded from
titles).

**What the user sees**: 64 rows from the metadata catalogues, a Netflix badge linking the title,
no per-episode Netflix links. Never five seasons' worth of episode 1 (01 case 18: the container's
list is every run's at once, and no container's list crosses a `PART_OF`).

### 8.5 A show-level id that must never weld: Kitsu's Crunchyroll series url

**Rows**: `kitsu:45950` (season 2), `kitsu:47694` (season 2 part 2), `kitsu:49002` (season 3), each
carrying `https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation` (01
case 1). Crunchyroll's search row for `cr:G24H1N3MP` is CONTAINER (03 crunchyroll).

**Claims**: three `CLAIMS {relation: 'PART_OF', targetScope: 'CONTAINER', provenance: 'SOURCE'}`
from the three kitsu payloads to the one anchor `cr:G24H1N3MP` (03 kitsu: PART_OF for everything
outside the `nf:title` / `nf:watch` allowlist).

**`plugin:identity`**: effective scope of `cr:G24H1N3MP` is CONTAINER (its own row, and three
SOURCE stamps). Three verdicts accepted as I4 RUN x CONTAINER: three `LINKS PART_OF`, precision ID.
No membership changes. Suppose the pre-fix code ran and kitsu claimed SAME_AS instead: I4 still
derives PART_OF, because the scopes cross. Suppose a bookmark rebroadcasts `cr:G24H1N3MP` SAME_AS
from `buildHandlesFromUri`: `URI` provenance never admits (I3), and it would be cross-scope anyway.
Suppose Apple TV's show id arrives as its own mediaUri (01 case 2: "a guard must be reachable from
the direction the claim actually arrives in"): the claim is from Apple's payload to a per-run anchor,
Apple's row is CONTAINER by its own `scope`, so the same I4 row fires; there is one evaluation path
and it reads both endpoints. `cr:G24H1N3MP-GS00374452` beside the bare id (01 case 5) is precision,
not contradiction: one is RUN and a member, the other CONTAINER and a container, and `mostSpecific`
is not needed because membership only ever holds RUN-scoped ids.

**`plugin:containment`**: one show cluster; three cluster-level `PART_OF`; the show aggregate's
`preferredRun` is season 2 (earliest start day).

**What the user sees**: three separate run pages, each with a Crunchyroll badge linking the series
url (the link 01 case 1 wanted kept), no weld. The A/B that shipped this (24 rows with a bare `cr:`
in the cluster against 14 without) is now a fixture: the identity plugin over these three payloads
must produce three clusters and three PART_OF edges, and a mutation that changes I4's cross-scope
row to a membership fails it (9.3).

---

## 9. What is kept, what goes

### 9.1 The contract that stays

The yoga server per source, the urql client per source, `useOnResolve` on every source server,
the fan-out that discards payloads, `similarMedia` and its five answerers, the request context and
its policy, remote plugin registration and its two enforcement points (04 sections 1, 4): all
unchanged. The three DataLoaders change what they call, not when. Four additive schema fields (4.5)
and two source behaviours (4.4) are the whole source-side cost.

### 9.2 Every current store export, and what replaces it

| export (02 section 1) | replaced by |
| --- | --- |
| `types.ts` enums (`mediaTypeEnum`, `mediaSeasonEnum`, `mediaStatusEnum`, `mediaCategoryEnum`, `handleRelationEnum`, `mediaRelationEnum`, `mediaScopeEnum`) and the row types `Media`, `Episode`, `Origin`, `Relation`, `Franchise*`, `Title`... | kept as `src/worker/graph/types.ts`, the shape of `Payload.raw` and of `Aggregate.fields`; `HandleRelation` gains nothing (the closed set is on `LINKS.kind`, 3.1) |
| `createUnionFind`, `UnionFind` | gone. A throwaway union-find inside `plugin:identity`'s pass, rebuilt every pass |
| `createGraph`, `Graph`, `LabelOptions`, `SetOptions` | gone: LadybugDB is the graph |
| `lastWriteLongestArray` | the within-origin rule in `plugin:aggregate` (5.9 row 4), with the loser retained |
| `HAS_EPISODE_LABEL` | the `HAS_EPISODE` rel table |
| `IDENTITY_LABELS` | `Cluster.scope` |
| `ASSERTED_LABELS` | the `CLAIMS` rel table, which is every asserted pair with its payload, not a second adjacency |
| `graph` (the singleton) | `src/worker/graph/db.ts`: the connection, `query`, `ingest`, `reset` (tests only) |
| `upsertMedia` | `ingest.media(records)` (4.1); the scope ratchet, the placeholder rule, the derivation table and `pendingClaims` are `plugin:identity` I1 to I4 |
| `linkSameMediaPairs`, `linkSameContainerPairs`, `linkPartOfPairs` | `plugin:title` emitting `LINKS SAME_AS` / `PART_OF`; the scope refusals are identity I4 |
| `findAggregatedMedia` | the first query of 6.2 |
| `findPartOfMedia`, `findRunsOfContainer` | `plugin:containment` C1, C2; `Aggregate.handles` PART_OF; the container page's reversed walk (6.4) |
| `preferAttachedRun`, `findMediaForPage` | `Aggregate.preferredRun`; 6.2 |
| `findAllAggregatedMedia`, `hideAttachedContainers` | 6.1's query; `Aggregate.attached` |
| `upsertEpisodes` | `ingest.episodes(records)` |
| `findRunEpisodes`, `findAggregatedEpisodesForMedia`, `mergeByEpisodeNumber` | `EpisodeSlot` rows written by `plugin:aggregate` (5.9); the number grouping is slot keying |
| `resetStore` | `db.reset()`, tests only, drops every table |
| `upsertOrigins`, `findOrigin`, `findOrigins` | `ingest.origins`, `readOrigins` over the `Origin` table; the `every`-filter bug (02 section 5.3) is fixed in passing |
| `removeDuplicatesByField`, `sameAsHandleUris` | `plugin:aggregate` internals; the SAME_AS-only episode walk is the slot computation's input by construction (3.4) |
| `recursivelyUnwrapMediaHandles` | ingest step 3 (4.1): handles become `CLAIMS`, never rows; the PART_OF subtree cut is unnecessary because a claim is not a row |
| `aggregateMedia`, `aggregateEpisode` | `plugin:aggregate` (5.9) |
| `tieredConsensus`, `runLength`, `alignmentOffset`, `runEpisodes`, `alignRunEpisodes` | kept as pure functions, moved: `runLength` and `tieredConsensus` into `plugin:aggregate` and identity I5; `alignmentOffset` generalized to segments in `plugin:range`; `runEpisodes`'s gates are the loan rule and the window (5.8, 5.9) |
| `clusterAnomalies`, `Anomaly` | `disagreeingIds` is identity I6 (a veto now, with a production caller); `overLength` is an assertion in the slot computation's tests and a `log` event when a cluster lists more slots than its length |
| `normalizeToStoreMedia` | gone (4.2); the null-spelling rule lives at the GraphQL boundary |
| `MediaPageFilters`, `applyMediaFilters` | kept verbatim, applied over `Aggregate.fields` (6.1) |
| `ExportedCluster`, `StoreExport`, `ExportOptions`, `exportStore` | `exportGraph`: walks `CLAIMS` with `provenance = 'SOURCE'` and `relation = 'SAME_AS'` between per-run anchors (never a `LINKS` row, never a plugin origin), same envelope, same sort, same two refusals (`excludeOrigins` not walked through, `passThroughOrigins` walked and dropped) |
| `emit`, `listen`, `listenIterator`, `listenMultipleIterator`, `debouncedListenIterator`, `StoreEventMap` | kept; the runner emits `graph:changed {clusters}` and `origin:changed`; `media:changed` and `episode:changed` become aliases of `graph:changed` until every listener moves |
| `profileCluster`, `fuzzyMergeMediaClusters` | `plugin:title` (5.7) |

### 9.3 Tests

**Carried verbatim (55)**: every KEEP in 04 section 5. The nine worker files
(`backoff`, `plugin-sources`, `request-context`, `similar-document`, `store/consensus`,
`store/filter`, `store/merge-fixtures` harness, `store/mushoku-parts`, `store/season-separation`,
`store/season-weld`), the four router files, and the 42 source files. `store/consensus.test.ts`
imports move with the functions.

**Rewritten (18)**, each against the seeded-graph harness below:

| file | becomes |
| --- | --- |
| `similar-consumer.test.ts` | the same 22 contracts, driving `ingest` and reading `Aggregate.handles` instead of `upsertMedia` / `findAggregatedMedia` |
| `store/aggregate-fields.test.ts` | `plugin:aggregate` field tests over seeded payloads |
| `store/arrival-order.test.ts` | identity I2 (a claim before its row is DEFERRED, then accepted) and the `URI` / `SEED` stamp rule |
| `store/container-page.test.ts` | `preferredRun` and 6.2's resolution |
| `store/container-scope.test.ts` | identity I1 and I4: the four-row table, imdb forced CONTAINER, the ratchet as a computed value |
| `store/db.test.ts` | identity: a show-level imdb handle derives PART_OF; an ordinary handle admits |
| `store/edge-idempotence.test.ts` | the hash no-op: a re-asserted handle writes no row and moves no `seq`; `reconcile` reports zero on a second run |
| `store/episode-merge.test.ts` (the read half) | slot keying: two metadata sources over one run become one slot list |
| `store/export.test.ts` | `exportGraph` over `CLAIMS` |
| `store/fuzzy-merge.test.ts` | `plugin:title`'s 21 cases as emitted `LINKS` rows |
| `store/normalize.test.ts` | the null-spelling rule at the boundary; the scope reporting on `Aggregate` |
| `store/part-of-subtree.test.ts` | ingest: a handle's node lands on `CLAIMS.node`, never as a payload; two runs naming one show contribute no membership through it |
| `store/part-of.test.ts` | a PART_OF target's url reaches `handles` from `CLAIMS.node` when it has no payload (01 case 42) |
| `store/stable-id.test.ts` | identity I8: `_id` survives growth from either side, an alias resolves, run and container ids differ |
| `store/merge-fixtures.test.ts` harness, `store/mushoku-parts.test.ts` harness, `store/season-weld.test.ts` harness | KEEP the cases; the three harnesses call `ingest` then `runPasses()` and read `Cluster` membership |
| `sources/offline/seed-source.test.ts`, `sources/offline/seed-build.test.ts` | drive the seed through `ingest`; the export envelope is unchanged so the builder tests stay |
| `sources/offline/seed.test.ts` | KEEP: the enums stay in `types.ts` |

**Dropped (1)**: `store/graph.test.ts`, except its `lastWriteLongestArray` rule, restated as two
`plugin:aggregate` tests (an incoming empty array never beats a filled one; an incoming null keeps
the existing value) because it is the seed's whole safety argument (04 section 5.1).

**New surface.** The harness, `tests/graph/harness.ts`:

```ts
const g = await seedGraph({ payloads, claims, rows })   // a fresh in-memory engine per test, tables created, rows stamped as if by the named plugin
const report = await runPlugin(g, plugin)                // runs under the FULL check (5.4, re-hashing every payload)
expect(await g.rows('LINKS', { by: 'plugin:range' })).toEqual([...])   // exact rows by natural key
expect(await runPlugin(g, plugin)).toEqual({ added: 0, removed: 0 })   // idempotency, every test, automatically
```

| suite | what it pins |
| --- | --- |
| core: ingest | the decomposition round-trips byte for byte (`raw` plus `CLAIMS.node` plus episode payloads rebuild the return value); the same return value twice writes nothing; a claim naming an unseen uri creates the anchor and lands; episodes hang on the `mediaUri` the source stated; `operation` and `provenance` are recorded |
| core: runner | topological order, cycle detection, the 3 pass bound, the coalesced event with cluster ids, a plugin that writes through `query` is caught by the check and disabled (the control that must fail) |
| corpus | the 14 merge fixtures (real 2026-08-31 payloads), `dist-seed/snapshots.jsonl` (100 clusters), the 15 season-separation statements, mushoku-parts and season-weld, replayed as payloads through `ingest` and every pass; the answers are the hand-decided ones, not the implementation's (04 section 5.1) |
| `plugin:identity` | one test per rule I1 to I8 with a seeded graph and a mutation that must fail (delete the rule, watch it go red); the five walkthroughs' claim sets |
| `plugin:containment` | C1 to C4, the JustWatch 23 = 11 + 12 fold, Netflix's non-partition |
| `plugin:title` | the 21 fuzzy cases, the six gates each with a control pair, order independence (shuffle the payloads, same rows), the diacritic option off and on |
| `plugin:range` | Elusive Samurai (13..20 to 1..8), the Mushoku cour split (1..11, 12..23), Blue Exorcist minting nothing, the loan rule refusing on one witness, a tie refusing, a day naming two episodes refusing, `nf` excluded from titles |
| `plugin:aggregate` | every field rule with provenance, the season pair, the tier rule (the three clusters of 01 R3), slots for the fold, `attached` and `preferredRun` |
| the fifteen invariants | one test each, named `I1`..`I15`, in `tests/graph/invariants.test.ts` (9.4) |

### 9.4 The fifteen invariants

| invariant (01 part 3) | fate |
| --- | --- |
| I1 irreversibility | survives by construction and is the reason for P3: no union-find survives a pass; a wrong SAME_AS is a `VERDICT` the next pass can reverse |
| I2 the exchange rate | survives as every plugin's refusal rule; its counterweight (refusing is not free) is why every threshold is the record's, not raised |
| I3 the scope ratchet | survives as identity I1, computed rather than stored, so it un-ratchets when the stamping claim is retracted |
| I4 a reproducible id | survives: the core mints no id; `Cluster.id` is internal and never a uri (04 section 6 contract 2 keeps `ag:(...)` from members) |
| I5 provenance loss, four shapes | closed by construction: payloads kept (1, 3), `CLAIMS` from payloads and `VERDICT` per claim (2), the identity scan counts payloads restating one nested node (4) |
| I6 folded cours | survives: identity I5 one-directional fold veto, `plugin:range` lending by proven range, the lend without identity |
| I7 retranslated titles | survives: `nf` excluded from the TITLE axis, no similarity threshold on episode titles |
| I8 the diacritic gate | survives: `foldDiacritics` off until measured |
| I9 the 13 versus 12 length | survives: the loan rule's two declared witnesses; a member's episodes are never hidden |
| I10 the 24 versus 2x12 fold | survives by construction: a slot list is built from members and proven ranges only |
| I11 the tier rule | survives in `plugin:aggregate` and identity I5 |
| I12 main titles only | survives: synonyms are not on the wire and `plugin:title` reads `titles` only |
| I13 the season pair | survives in `plugin:aggregate` |
| I14 grouping by number inside one cluster | survives: slot keys are (cluster, number) |
| I15 determinism | survives: identity I7 ordering, I8 id survival, title tier ordering, aggregate tie-breaks by origin then payload key; `seq` is used only for "latest within one origin" |

None is dropped.

---

## 10. Migration

Each step leaves the app running on the old store until step 6.

| step | work | ships when |
| --- | --- | --- |
| 1 (one day) | add `@ladybugdb/wasm-core` 0.20.4 to the worker, `setWorkerPath` before any call, create the source tables (2.1), write `ingest.ts` (4.1) and call it from the three DataLoaders **beside** the old `upsert*` calls; an osra `dumpGraph()` for the export page. No reader. The engine initializes lazily after the first paint (00: 188 ms init, 22.1 MB engine from `public/`) | the dual write lands with the round-trip test and the hash no-op test green |
| 2 | the runner, `plugin:identity`, `plugin:aggregate` (media fields only); a `?graph=1` flag makes `Subscription.media` read 6.2; a differential script replays `dist-seed/snapshots.jsonl` through both stores and diffs the aggregates field by field | the diff is empty except for documented changes (the singleton path, provenance) |
| 3 | `Subscription.mediaPage` from 6.1 behind the flag; `applyMediaFilters` unchanged; the event payload carries cluster ids | the listing renders identically under the flag |
| 4 | `EpisodeSlot`, `plugin:range`; `Media.episodes` from slots behind the flag; the two source changes (4.4) and the `provenance` field (4.5) | the Elusive Samurai and Mushoku fixtures pass through the real ingest |
| 5 | `plugin:title` from `fuzzy-merge.ts`, `plugin:containment`; the similar consumer reads `Aggregate.handles`; `exportGraph` | the corpus suite passes; the 18 rewritten tests are green |
| 6 | flip the flag default, delete `src/worker/store/` except `filter.ts`, `types.ts` and the moved pure functions; delete `pendingClaims`, the union-find, `componentId` | a session on the live site with the store export diffed against a pre-flip export |
| 7 | the container page in the router (01 part 4 problem 10, now a query), register `imdb` as an origin so its badge renders (problem 11) | UI work, after the store is stable |

---

## 11. Risks, and the decisions only the owner can make

### 11.1 Risks

| risk | measured or not | mitigation |
| --- | --- | --- |
| the engine is a 22.1 MB worker script and a 54 KB client chunk; init 188 ms, first query 273 ms (00) | measured | lazy init after first paint; the offline bundle keeps answering the cold listing from JS until the engine is up (step 1's dual write means the old store still serves in steps 1 to 5) |
| every call is a 1 to 2 ms round trip (00); a plugin issuing one query per cluster is slow | measured floor, unmeasured total | every scan in section 5 is one query over the dirty set; `UNWIND` batches for writes (18x, 00); the reconcile diffs in JS |
| `json_extract` inside a scan over 6,000 payloads is unmeasured | not measured | if it costs, promote one more column per field the scans read (`episodeCount`, `startDate`), still copies of returned values; measure in step 2 |
| the `MEMBER_OF` hop against 00's `clusterId` property (1.7 ms) is unmeasured | not measured | it is a PK lookup plus one adjacency; if it costs, `Cluster.members STRING[]` as a second plugin-owned copy |
| versioned payloads grow memory over a long session | not measured; 5,796 media in 2.6 s at 00's scale | no persistence, so a reload clears; a cap on payloads per (origin, uri) with the oldest dropped is a one-line ingest rule if needed |
| the 3 pass bound can leave a title link unapplied until the next ingest | by construction | an idle pass when no ingest arrives for 500 ms (NEW) |
| the cheap check misses a `SET` on `Payload.raw` in production (5.4) | by construction | every plugin's tests run under the full check; remote plugins never get `query` at all (04 section 4.4: one function and never the real ctx) |
| `conn.query` throws on a binder error and params are strictly typed (00) | measured | dates travel as strings and are compared as UTC days in JS (5.8), never as DATE params; a query test per plugin scan |
| a plugin slow on one large cluster blocks the single runner loop | not measured | per-plugin time budget logged; a plugin over budget is skipped for the pass and retried next trigger |
| `waitForMedia` inside a source blocks on a read that now waits for a pass | by construction | 6.2's first query answers from the last completed pass; the 15 or 30 s deadlines (04 section 1.8) are unchanged |

### 11.2 Address-bar handles as pointers (identity I3)

01 part 4 problem 2, in the record's words "a design decision, not a patch, and it needs the
owner". The rule as written never admits a `URI` claim on its own, which means a stale bookmark
carrying a show-level `cr:` can no longer bridge two seasons, and also means a bookmark can no
longer re-establish a link that the sources have since stopped asserting. Alternative: admit `URI`
claims between per-run origins only. Either is one line in I3.

### 11.3 Exactness at the chokepoint for a shorter catalogue season (identity I5)

A catalogue season whose count is below the run's agreed length is derived `PART_OF` rather than
admitted as a member, until the counts agree. It closes BAKI's year-rule weld (01 case 10) and it
changes The Elusive Samurai's Crunchyroll badge from member to container while its list is 8 of 12
(8.2), with the episode rows unchanged. The alternative is today's rule (a shorter fetched list is
admitted), which keeps the badge and keeps the BAKI weld.

### 11.4 The diacritic fold (`plugin:title`, 01 I8)

Off by default. Turning it on recovers JustWatch's `Nige jôzu no wakagimi` and is a change to the
normaliser both scorer and profile share (01 R17), so it needs the calibration run over the gate's
150 seasons before it ships (01 case 28: "deserves its own measured change").

### 11.5 A default row score for anizip (`plugin:aggregate`)

`DEFAULT_ROW_SCORE = {anizip: 0.9}` is off. On, anizip's row outranks Netflix and Apple TV for
`url`, `type`, `status`, `startDate` and every other scalar in every cluster it is in (01 case 44),
which the record calls "not free" (01 part 4 problem 8). It also changes the tier for
`episodeCount` in S2 part 1 (8.1) from AniList's 13 to anizip's 12, still on one witness.

### 11.6 Position lending on a `COUNT` range

The count-exact fold (5.6 C4) mints link-only ranges. Lending Netflix episodes by position on
JustWatch's 23 = 11 + 12 would put Netflix rows on Mushoku's cours today, and 01 case 15 shows what
position lending does when a special is inserted (13 of 25 Blue Exorcist rows wrong, each with a
playable url). The record's verdict is "nothing ships that places Netflix episodes by arithmetic";
this design keeps that. If the owner wants the rows anyway, it is a per-origin allowlist in 5.9 step
2 with the measured failure attached.

### 11.7 Smaller calls

- Whether the seed keeps emitting episode SAME_AS handles (03 offline) now that slots merge by
  number; dropping them removes the last `CLAIMS` edge into `Episode`.
- Whether `VERDICT` reasons surface in the UI (a "why is this not linked" panel) or stay a debug
  read.
- Which sources opt into `startDatePrecision` first (kitsu and jikan, whose `YYYY-MM-01` is the
  measured 30 day error, 01 case 34).
- The idle pass interval and the 3 pass bound.
- Whether `SHOW_LEVEL_ORIGINS` stays as identity I1's first check (this design keeps it: one Set
  lookup, and it is what corrects a source that starts emitting a bare imdb id again).
