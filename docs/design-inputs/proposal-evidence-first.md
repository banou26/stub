# Proposal: evidence first

The graph holds what the sources said, as they said it, and beside it every fact a merge rule has
ever needed to read, each as a row that Cypher can join across sources: a date with its precision, a
title with its script and language, a count with what it counted, an episode with the numbering space
its number lives in, and every source claim as an edge with the origin that made it. Every plugin is
then a candidate scan written as one Cypher query plus a small decision rule, and a new edge case is a
new query rather than new control flow. Nothing is ever unioned: cluster membership is an edge a plugin
mints and can retract, so every merge has an inverse and a reason.

The inputs are cited as `00` (engine facts), `01` (edge cases, refutations R1 to R26, invariants I1 to
I15, open problems), `02` (the current store), `03` (source capabilities), `04` (consumers and tests).
Every threshold below is either taken from that record, with the citation, or marked NEW with the case
that motivates it.

---

## 1. Principles

1. **Evidence is data, never a re-derivation.** A date carries its precision and derivation, a title its
   language and class, a count what it counted, an episode number its space, so a rule joins rows
   instead of re-parsing strings at every comparison (01 cases 14, 22, 23, 33, 35; I5).
2. **Sources assert, plugins infer, and they never write the same table.** A source's result is stored
   as returned; a plugin may only add rows stamped `by` its own identity, and the core proves it with a
   digest that must not move (owner's brief; 01 case 7; I1).
3. **Nothing is unioned, ever.** Identity is a materialized `JOINS` edge and a `MEMBER_OF` edge, both
   minted by one plugin and both retractable, so a wrong merge costs one retraction rather than a reload
   (I1; 02 section 5.2; 00 read costs).
4. **Absent, zero and unknown are three different values**, on every quantity a rule reads, and a gate
   whose premise is absent records `skipped`, never `passed` (01 cases 6, 23, 26).
5. **Sameness only within one scope; across scopes there is only containment**, and a walk that
   reaches a node through `INCLUDES` or `PART_OF` may never treat it as the same work (owner's rule;
   02 section 2.1; I2).
6. **Refuse rather than guess, at the measured exchange rate.** No threshold in this document is new
   unless marked NEW with its case, and no refuted approach (01 part 2) is re-proposed without naming
   the refutation it answers (I2; R1 to R26).
7. **No decision reads arrival order.** Every candidate scan is a set query with a deterministic tiebreak,
   and a cluster's id survives growth by a size rule rather than by which row landed first (01 cases
   30, 48; I15).
8. **A read is a query and nothing else.** A page is one or two queries over materialized membership and
   materialized views; the request path never recurses per row and never writes (00 read costs;
   02 sections 2.6 and 3).

---

## 2. Graph schema

Three bands, and the band a table sits in says who may write it.

| band | who writes | rebuildable from | tables |
| --- | --- | --- | --- |
| RAW | ingest only, from a resolver's return value | nothing, this is the record | `Origin`, `Media`, `Answer`, `Episode`, `EpisodeAnswer`, `Ask`, `ABOUT`, `CLAIMS`, `HAS_EPISODE`, `EPISODE_CLAIMS`, `ANSWERED` |
| EVIDENCE | ingest only, as a rule free projection of `Answer.raw` | `Answer.raw`, at any time | `Title`, `DateClaim`, `CountClaim`, `HAS_TITLE`, `DATED`, `COUNTED` |
| DERIVED | plugins only, every row stamped `by` | the two bands above, by re-running the plugins | everything else |

### 2.1 DDL (LadybugDB dialect, one label per node, rel tables spanning several FROM/TO pairs as measured in 00)

```cypher
-- RAW band
CREATE NODE TABLE Origin(id STRING PRIMARY KEY, name STRING, url STRING, icon STRING, color STRING,
  isApiOnly BOOLEAN, pluginUri STRING, models STRING, raw JSON);
CREATE NODE TABLE Media(uri STRING PRIMARY KEY, origin STRING, id STRING, scope STRING,
  described BOOLEAN, seq INT64, firstSeen TIMESTAMP DEFAULT current_timestamp());
CREATE NODE TABLE Answer(key STRING PRIMARY KEY, about STRING, by STRING, kind STRING, scope STRING,
  score DOUBLE, hash STRING, seq INT64, at TIMESTAMP DEFAULT current_timestamp(), raw JSON);
CREATE NODE TABLE Episode(uri STRING PRIMARY KEY, origin STRING, id STRING, seq INT64);
CREATE NODE TABLE EpisodeAnswer(key STRING PRIMARY KEY, about STRING, by STRING, kind STRING,
  score DOUBLE, number INT64, numberSpace STRING, seasonNumber INT64, absoluteNumber INT64,
  runtime INT64, hash STRING, seq INT64, at TIMESTAMP DEFAULT current_timestamp(), raw JSON);
CREATE NODE TABLE Ask(key STRING PRIMARY KEY, kind STRING, origin STRING, uri STRING, showId STRING,
  clusterId STRING, question JSON, outcome STRING, by STRING, seq INT64,
  at TIMESTAMP DEFAULT current_timestamp());

CREATE REL TABLE ABOUT(FROM Answer TO Media, FROM EpisodeAnswer TO Episode);
CREATE REL TABLE CLAIMS(FROM Media TO Media, by STRING, kind STRING, relation STRING, depth INT64,
  seq INT64);
CREATE REL TABLE HAS_EPISODE(FROM Media TO Episode, by STRING, seq INT64);
CREATE REL TABLE EPISODE_CLAIMS(FROM Episode TO Episode, by STRING, relation STRING, seq INT64);
CREATE REL TABLE ANSWERED(FROM Ask TO Media, role STRING, seq INT64);

-- EVIDENCE band (shared value nodes, so agreement is a join through the node)
CREATE NODE TABLE Title(norm STRING PRIMARY KEY, hasLetter BOOLEAN, script STRING);
CREATE NODE TABLE DateClaim(key STRING PRIMARY KEY, precision STRING, year INT64, month INT64,
  dayNumber INT64, day DATE, instant TIMESTAMP);
CREATE NODE TABLE CountClaim(value INT64 PRIMARY KEY);
CREATE REL TABLE HAS_TITLE(FROM Media TO Title, FROM Episode TO Title, by STRING, kind STRING,
  text STRING, language STRING, class STRING, score DOUBLE, seq INT64);
CREATE REL TABLE DATED(FROM Media TO DateClaim, FROM Episode TO DateClaim, by STRING, kind STRING,
  field STRING, derivation STRING, score DOUBLE, seq INT64);
CREATE REL TABLE COUNTED(FROM Media TO CountClaim, by STRING, kind STRING, countKind STRING,
  score DOUBLE, seq INT64);

-- DERIVED band (plugins only; `by` is the plugin id on every row)
CREATE NODE TABLE Cluster(id STRING PRIMARY KEY, space STRING, canonical STRING, size INT64,
  by STRING, seq INT64);
CREATE NODE TABLE RunLength(clusterId STRING PRIMARY KEY, value INT64, tier DOUBLE,
  witnesses INT64, declared INT64, by STRING, seq INT64);
CREATE NODE TABLE Facet(norm STRING PRIMARY KEY, ordinal INT64, part INT64, onlyLabel BOOLEAN,
  generic BOOLEAN, companion BOOLEAN, by STRING, seq INT64);
CREATE NODE TABLE Variant(norm STRING PRIMARY KEY, by STRING, seq INT64);
CREATE NODE TABLE View(clusterId STRING PRIMARY KEY, space STRING, kind STRING, hidden BOOLEAN,
  media JSON, episodes JSON, fields JSON, by STRING, seq INT64);
CREATE NODE TABLE Refusal(key STRING PRIMARY KEY, rule STRING, fromUri STRING, toUri STRING,
  detail JSON, by STRING, seq INT64);
CREATE NODE TABLE Anomaly(key STRING PRIMARY KEY, rule STRING, clusterId STRING, detail JSON,
  by STRING, seq INT64);

CREATE REL TABLE SAME_AS(FROM Media TO Media, by STRING, strength STRING, rule STRING, score DOUBLE,
  evidence JSON, seq INT64);
CREATE REL TABLE PART_OF(FROM Media TO Media, by STRING, rule STRING, evidence JSON, seq INT64);
CREATE REL TABLE INCLUDES(FROM Media TO Media, by STRING, rule STRING, fromStart INT64, fromEnd INT64,
  toStart INT64, toEnd INT64, support INT64, evidence JSON, seq INT64);
CREATE REL TABLE SAME_EPISODE(FROM Episode TO Episode, by STRING, rule STRING, support INT64,
  evidence JSON, seq INT64);
CREATE REL TABLE VETO(FROM Media TO Media, by STRING, rule STRING, detail JSON, seq INT64);
CREATE REL TABLE JOINS(FROM Media TO Media, by STRING, seq INT64);
CREATE REL TABLE MEMBER_OF(FROM Media TO Cluster, by STRING, seq INT64);
CREATE REL TABLE EXTENDS(FROM Media TO Media, by STRING, seq INT64);
CREATE REL TABLE HAS_FACET(FROM Title TO Facet, by STRING, seq INT64);
CREATE REL TABLE VARIANT_OF(FROM Variant TO Title, by STRING, rule STRING, seq INT64);
```

`seq` is one monotonic counter the core advances per committed ingest batch; every row carries the seq
at which it last changed, which is what lets a plugin scan only what moved since its last run.

### 2.2 The RAW band, property by property

**`Origin`**: the 24 built ins plus every registered plugin source (04 section 4.1), seeded from the
extractor definitions at boot so that `imdb` exists as a row and a PART_OF handle can render against it
(01 case 42, open problem 11). `models` is what an id of that origin names, `RUN`, `SEASON`, `SHOW` or
`NONE`, taken from 03 section 1 and overridable by a source that declares it: RUN for mal, anilist,
anizip, kitsu, simkl (anime), offline; SEASON for cr, nf, jw, appletv, tmdb, tvmaze; SHOW for paramount,
trakt, tvdb, omdb, watchmode, imdb; NONE for the six that never mint a media. `raw` is the origin row as
returned.

**`Media`**: one node per uri, the identity anchor. `origin` and `id` are split off the uri. `described`
is true once any answer about the uri carries a field outside `uri`, `origin`, `id`, `scope`, or carries
a CONTAINER stamp (02 section 2.3, the placeholder rule, kept verbatim). `scope` is the one derived
column the core maintains: the ratchet of 02 section 2.2 (`CONTAINER` once any answer said so, imdb
forced by the `models = 'SHOW'` backstop of 02 section 2.1), kept in the core because every plugin's
scan filters on it and I3 says a wrong RUN is the failure with no inverse; the per answer stamp survives
on `Answer.scope`, so what 02 section 3 calls entangled ("a source that said RUN after someone said
CONTAINER leaves no trace") no longer loses the trace.

**`Answer`**: what one origin said about one uri through one document. `key` is `by|kind|about`.
`by` is the origin whose server resolved the field (the plugin origin for a remote source). `kind` is
the resolved field that produced it: `media`, `mediaPage`, `similarMedia`, `similarMedia:containing`,
or `handle` for a node that arrived nested inside another row's `handles`. `raw` is the row exactly as
the resolver returned it, JSON, never normalized: a search row, a page row and the three field row the
`similarMedia` document selects (04 section 1.2) each keep their own key, which closes the truncation
class of I5 point 3. `hash` is a stable hash of `raw`, the newness test. `score` is the row's own
`score` (03 appendix, the per source constant); `scope` is the row's own stamp, null when the source said
nothing.

**`Episode`, `EpisodeAnswer`**: the same pair for episodes. The typed columns are the four numbers and
the runtime because rules join on them: `number` is what the source published as `episodeNumber`;
`numberSpace` says which space that number lives in, from 03 section 3 and overridable by the source:
`ENTRY` for anizip (the map key, 01 case 14), `POSITION` for unogs (the list index, 03 unogs),
`SEASON` for everything else, where Crunchyroll's season relative number continues across a split cour
(01 case 13). A stored number is never reinterpreted in another space; placement is only ever a
`SAME_EPISODE` edge (01 case 14, R26).

**`Ask`**: a question the trace loop wants answered, minted by plugins and executed by the core's
actuator (section 7). `kind` is `MEDIA` (fetch a uri from the origins that answer for it) or `SIMILAR`
(the `similarMedia` question of 03 section 4). `question` is the evidence sent; `outcome` is written by
the actuator: `answered`, `refused`, `declined:<reason>` with the reasons of `SimilarOutcome`
(`src/sources/similar.ts:51-52`).

**`CLAIMS`**: a source's handle edge, verbatim. `relation` is the string the source sent (`SAME_AS`, `PART_OF`, or the
`INCLUDES` a show row may assert over its own seasons, section 3.1), `kind` is the document it arrived in, and `kind = 'uri'`
marks a handle that `buildHandlesFromUri` rebuilt from the address bar (01 case 8): a pointer, which
section 5 never turns into sameness. `depth` is the nesting depth in the handle tree, capped at 4
(04 section 4.3). `HAS_EPISODE` is `episode.mediaUri` as the source stated it. `EPISODE_CLAIMS` is the
episode handle, kept for symmetry and read by section 5's episode plugin. `ANSWERED` links an ask to the
row that answered it, `role` being `run` or `containing`.

### 2.3 The EVIDENCE band: what the projection computes, and the one rule it may not contain

The projection is deterministic and lossless in the sense that `Answer.raw` can regenerate it. It may
lowercase, strip, floor and map; it may not apply a vocabulary, a threshold or a choice. Anything of that
kind is a plugin (section 5), so that it can be switched, measured and retracted.

| table | one row per | computed how | why a rule needs it as a row |
| --- | --- | --- | --- |
| `Title.norm` | distinct normalized string | `stripTitle` (keep `\p{L}\p{N}\s`, lowercase, collapse whitespace: 01 case 24, R17), `hasLetter` from `\p{L}`, `script` from the first letter's block | exact agreement in any language is a join through one node; a title with no letter carries no identity (`carriesIdentity`, 02 section 2.10) |
| `HAS_TITLE` | title entry of an answer | `text` verbatim, `language` mapped `jp -> ja`, `jp-en -> ja-Latn` (03: kitsu and anizip write `ja`, jikan and anilist `jp`), `class` from the field it came from, `MAIN` today, `SYNONYM` or `ABBREVIATION` the day a source emits one | I12: a synonym lands as non identity evidence instead of poisoning identity (01 case 29) |
| `DateClaim` | distinct (precision, value) | `precision` read off the string shape: `YYYY-01-01` is `YEAR` (the sentinel, 01 case 33), `YYYY-MM-01` is `MONTH` (kitsu and jikan, 01 case 34), `YYYY-MM-DD` is `DAY`, anything with a time is `INSTANT`; `dayNumber` is `floor(ms / 86400000)`, the UTC day of `consensus.ts:85-88` (02 section 2.9); `year` and `month` for bucketing | the 45 day windows compare DAY against DAY only, the year bucket reads YEAR, and the sentinel stops being inferred from a day of month at every comparison |
| `DATED` | date field of an answer | `field` is `startDate`, `endDate`, `releaseDate`, `airingAt`; `derivation` is what the source declared when it declares one (NEW optional fields `startDatePrecision`, `startDateDerivation` on `Media`, motivated by 01 cases 33 and 35), else `shape` | 01 case 35: a schedule derived date and a published one must be tellable apart |
| `CountClaim` | distinct value | the integer | "same count" is a join; absence is the absence of a row, zero is a row with value 0 (01 case 23) |
| `COUNTED` | count field of an answer | `countKind` from 03 section 2, overridable by a source that declares `episodeCountKind`: `DECLARED` for jikan `data.episodes`, anilist `media.episodes`, anizip `episodeCount`, offline `record.ep`, a Crunchyroll search row's `series_metadata.episode_count`, JustWatch `totalEpisodeCount`; `LIST` for every source whose count is a fetched list's length (kitsu after `:216`, cr `:274`, unogs, appletv, tmdb, tvmaze, simkl, trakt, tvdb, omdb single season, paramount); `FILM` for the synthetic 1; `RELEASES` when a plugin declares it | 01 cases 16, 22, 45 and I9: a declared count and a derived length are different kinds of claim |

`dayNumber` is stored as an integer rather than compared as a `DATE` interval because 00 exercised
`DATE` columns and `date($x)` and did not exercise interval arithmetic; integer days keep every window
inside the measured dialect.

Language tags and the `jp/ja` split never gate anything: agreement is on `norm`, the tag is carried for
display and for a future per locale rule.

### 2.4 What is raw, what is typed, and why

The source's result is kept as returned in `Answer.raw` (and `EpisodeAnswer.raw`) as one JSON value,
for three reasons. First, LadybugDB's JSON is native and `json_extract` works on it (00), so nothing is
lost by not typing it. Second, a typed 26 column row would force the ingest to choose a merge rule for
every re-fetch of the same uri, which is exactly `lastWriteLongestArray` (02 section 2.5), the policy
this design removes from the write path. Third, keeping raw makes the evidence band and every plugin
output rebuildable: `reproject()` deletes the evidence band and regenerates it from raw, which is the
re-derivation 02 section 5.2 says is impossible today.

Typed columns exist only where a rule joins on the value: the four episode numbers, the dates, the
counts, the titles. `relations` and `franchise` stay inside raw (they never union, 01 case 50) and the
view plugin copies them out as today.

### 2.5 The DERIVED band, property by property

| table | meaning | minted by |
| --- | --- | --- |
| `SAME_AS` | a proposal that `from` and `to` name the same work in the same scope. `strength` is `ID` (converted from a source claim), `TITLE` or `SIMILAR`; `rule` names the deciding rule; `evidence` lists every gate evaluated as `passed`, `skipped:absent` or `refused` | `claims`, `title-match`, `similar` |
| `PART_OF` | `from` (a RUN or a film) belongs to `to` (a show container or a film collection) with no arithmetic claimed | `claims`, `title-match` |
| `INCLUDES` | the episodes `fromStart..fromEnd` of `from` are the episodes `toStart..toEnd` of `to`; all four null means containment with no correspondence, which is allowed (01 case 9). `from` is the node whose episode set is the superset: a folded season includes a cour, a long run includes a split season (01 case 10) | `containment` (rangeless), `range` (ranged) |
| `SAME_EPISODE` | two episode rows are one broadcast episode. `rule` is `number`, `date`, `claim` | `episode-number`, `range`, `claims` |
| `VETO` | an objection to a `SAME_AS` between the pair, with the rule that objected | `vetoes` |
| `JOINS` | an accepted `SAME_AS`: same scope, no veto, no id contradiction. The identity structure, and the only thing membership walks | `membership` |
| `MEMBER_OF`, `Cluster` | materialized component membership; `Cluster.space` is `RUN` or `CONTAINER` (02 section 2.1's two identity spaces), `canonical` points a retired id at its survivor | `membership` |
| `EXTENDS` | same origin, `from.id` is `to.id` plus a `-` suffix: precision, not contradiction (01 case 5, R18) | `id-shape` |
| `Facet`, `HAS_FACET` | what a title says about itself: a parsed ordinal and part, whether it is only a season label, a generic episode label, a companion marker | `title-facets` |
| `Variant`, `VARIANT_OF` | a derived spelling of a title with the rule that derived it (01 cases 28, 31) | `title-variants` |
| `RunLength` | the cluster's episode count by tiered consensus, with tier, witness count and how many witnesses were `DECLARED` (I11) | `counts` |
| `View` | the aggregated media and its episode list as the app receives them, with per field provenance in `fields` (01 case 20, I5) | `view` |
| `Refusal`, `Anomaly` | a link a plugin declined, with the rule; a cluster contradicting itself (01 case 46) | any plugin; `anomalies` |

### 2.6 Who may write which table, and how the writer is recorded

| writer | tables | how it is recorded |
| --- | --- | --- |
| ingest (the only code holding a write connection) | RAW and EVIDENCE bands | `by` on every edge and answer is the origin whose server resolved the field; `kind` is the document |
| a plugin | only the tables it lists in `produces`, only through the core's applier, which stamps `by = 'plugin:<name>'` and `seq` itself | `by` on every row; a plugin cannot write a row with another writer's `by` because it never sees the connection (section 5.1) |
| the read path | nothing | a resolver holds a query only facade |

The check that this holds is a query, and it is run after every plugin round in dev builds and after
every plugin test:

```cypher
MATCH (a:Answer) RETURN count(a) AS answers, max(a.seq) AS lastRaw, sum(size(a.hash)) AS h;
MATCH ()-[c:CLAIMS]->() RETURN count(c) AS claims;
MATCH ()-[h:HAS_EPISODE]->() RETURN count(h) AS episodes;
MATCH ()-[t:HAS_TITLE]->() RETURN count(t) AS titles;
```

The four numbers before a plugin ran equal the four after it, or the round is rejected and the plugin's
output discarded. Section 5.1 has the structural half of the proof.

---

## 3. The edge model

### 3.1 The closed set

Two vocabularies, and the boundary between them is the boundary between a source and a plugin.

**What a source may say** is `CLAIMS.relation`, `SAME_AS`, `PART_OF`, and (NEW, section 8.4) `INCLUDES` from a show row to the season rows of its OWN
origin. The first two are the schema's `MediaHandleRelation` (`src/worker/resolvers/media/schema.gql:78`);
the third is the one addition to that enum this design asks for, so that a season modelling source can
publish its own season list as evidence (01 case 10). Nothing else is accepted from a source, and a
source never writes any other edge table.

**What a plugin may conclude**, one rel table per kind:

| kind | direction | meaning | minted by | carries |
| --- | --- | --- | --- | --- |
| `SAME_AS` | from the proposing row to the named row; read undirected | the two rows name one work, in one scope | `claims` (strength `ID` or `ANSWER`), `title-match` (`TITLE`), `similar` (`SIMILAR`) | `strength`, `rule`, `score`, `evidence` |
| `PART_OF` | from the part (a run, a film) to the whole (a show, a film collection) | the run belongs to the show; no episode arithmetic is claimed | `claims` (a cross scope claim, 02 section 2.1), `title-match` (a run matching a container by title, 02 section 2.10 scope dispatch), `similar` (an answer of role `containing` that is a SHOW) | `rule`, `evidence` |
| `INCLUDES` | from the node with more episodes to the node with fewer | episodes `fromStart..fromEnd` of `from` are `toStart..toEnd` of `to`; four nulls mean containment established and correspondence unknown | `containment` (rangeless), `range` (ranged) | the range, `support` (number of aligned episodes), `rule`, `evidence` |
| `SAME_EPISODE` | undirected in meaning | two episode rows are one broadcast episode | `claims` (an `EPISODE_CLAIMS` SAME_AS), `episode-number`, `range` | `rule`, `support`, `evidence` |
| `VETO` | undirected in meaning | an objection to any `SAME_AS` between the pair | `vetoes` | `rule`, `detail` |
| `JOINS` | undirected in meaning | an accepted `SAME_AS`: the identity structure | `membership` | nothing but `by` |
| `MEMBER_OF` | row to cluster | materialized component | `membership` | nothing but `by` |
| `EXTENDS` | from the more specific id to the prefix it extends | precision inside one origin, `cr:G24H1N3MP-GS00374452` extends `cr:G24H1N3MP` | `id-shape` | nothing but `by` |

Deliberately absent:

- **No `SPANS`.** A run split across several catalogue seasons (01 case 10) is several `INCLUDES`
  edges with the run as `from`; one kind covers both directions of the size mismatch because the
  direction is decided by which episode set is the superset.
- **No `EPISODE_PART_OF`.** 01 case 51 records it as declared, written and read by nothing; the fold
  is episode containment, and it is expressed by an `INCLUDES` range plus `SAME_EPISODE` edges.
- **No `CONTAINS`.** `INCLUDES` read backwards is the same fact; a second stored direction is a
  second edge to keep consistent.
- **No narrative kinds.** `relations` and `franchise` stay inside `Answer.raw`; nothing there may ever
  join (01 case 50).

### 3.2 The range form, literally

```
(nf:80987039-1)-[:INCLUDES {by:'plugin:containment', rule:'fold', fromStart:null, fromEnd:null,
                            toStart:null, toEnd:null, support:0}]->(anilist:108465)
(cr:G24H1N3MP-G609CX3J4)-[:INCLUDES {by:'plugin:range', rule:'date', fromStart:12, fromEnd:23,
                            toStart:1, toEnd:12, support:12}]->(anilist:127720)
(anilist:182616)<-[:INCLUDES {by:'plugin:range', rule:'date', fromStart:13, fromEnd:20,
                            toStart:1, toEnd:8, support:8}]-(cr:GQWH0M19X-GS00366034)
```

The first says: Netflix season 1 contains the season 1 cour and nothing is known about which of its 24
rows are which of the cour's 11 (01 case 9, the shape that "is allowed to be partial and is allowed not
to exist at all"). The second says Crunchyroll's season 1 rows 12 to 23 are cour 2's 1 to 12, twelve
episodes aligned by air day. The third is 01 case 13: the Crunchyroll row that continues the count is
SHORTER than the run (eight aired), so the run is `from` and the Crunchyroll row is `to`, and its 13 to
20 are the run's 1 to 8. A ranged edge is always accompanied by one `SAME_EPISODE` per aligned pair, so a
mid season insert (01 case 15) costs one episode its link and shifts nothing.

### 3.3 Provenance and confidence on every edge

`by` (writer), `rule` (the deciding rule's name), `strength` on `SAME_AS` (`ID`, `ANSWER`, `TITLE`,
`SIMILAR`: a class, never a number to add, R3), `score` where a scorer produced one, `evidence` as JSON
naming what was read: the titles that matched and at what similarity, the days that aligned, the counts
compared, and every gate as `passed`, `skipped:absent` or `refused` (01 case 6). `seq` says when.
Confidence is therefore a class plus a record, and section 5's membership rule reads the class and the
vetoes, never a sum.

### 3.4 Traversal rules

What an aggregation may walk, and the Cypher that makes the prohibition structural:

```cypher
-- the only identity walk in the design: JOINS, inside one space. INCLUDES and PART_OF are other
-- tables, so this pattern cannot traverse them whatever the data holds
MATCH (m:Media {uri: $uri})-[:JOINS*0..8 (r, n | WHERE n.scope = $space)]-(x:Media)
RETURN DISTINCT x.uri
```

That query is run by exactly one writer, the membership plugin, and only when it recomputes a component
after a retraction. Every read uses the materialized form (00: 1.7 ms against 6.8 ms recursive):

```cypher
MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(x:Media) RETURN c.id, x.uri
```

From a cluster, a reader may take exactly one hop out along `PART_OF` (to list the show containers, 02
`findPartOfMedia`) and one hop along `INCLUDES` in either direction (to list what a season includes, or
which seasons include this run), and through a RANGED `INCLUDES` it may read the container's episodes
that fall inside `fromStart..fromEnd`, renumbered by the range. It may never continue past that hop, and
it may never read a title, date, count or any other field of a node reached through `PART_OF` or
`INCLUDES` into the run's own aggregate: the fold season's fields describe the fold, not the cour
(01 case 20's hybrid row is what reading them produces).

The owner's rule, "never treat as SAME_AS anything reached through INCLUDES", holds three ways:

1. `JOINS` is minted only from a `SAME_AS` whose ends share `scope`, carry no `VETO`, and pass the join
   time contradiction check (section 5.4).
2. The `vetoes` plugin writes `VETO {rule:'includes'}` between an including node (and every member of
   its cluster) and every member of every cluster it includes, so a later `SAME_AS` proposal across that
   boundary, from a stale bookmark or a title match, is objected to before membership sees it.
3. Three invariant queries must return 0 after every round, and the anomaly plugin reports them:

```cypher
MATCH (a:Media)-[:INCLUDES]->(b:Media), (a)-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(b) RETURN count(*);
MATCH (a:Media)-[:PART_OF]->(b:Media), (a)-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(b) RETURN count(*);
MATCH (a:Media)-[:JOINS]-(b:Media) WHERE a.scope <> b.scope RETURN count(*);
```

---

## 4. Ingest

### 4.1 What stays

`useOnResolve`, keyed on the named type of the resolved field, installed once in `makeExtractor` and
therefore shared by every first party and plugin source (04 section 1.2), stays as the single write
trigger. The fan-out that subscribes every source and discards the payloads (04 section 1.5) stays: the
graph is the only join. The three DataLoaders with their 250 row, 50 ms batches (04 section 1.3) stay,
and each flush becomes one multi statement transaction of `UNWIND` batches (00: 2,000 nodes in 107 ms
against 935 ms one execute per row). What changes is what an inserter does with a row.

### 4.2 From a resolver's return value to rows

`splitAnswers(result, by, kind, depth)` replaces `recursivelyUnwrapMediaHandles` and
`normalizeToStoreMedia`. For a `Media` result it yields:

- one `Answer {about: row.uri, by, kind, raw: row, hash, scope: row.scope ?? null, score: row.score ?? null, described}`;
- one `CLAIMS {from: row.uri, to: handle.node.uri, relation: handle.relation, by, kind, depth}` per handle;
- recursively, one `Answer {kind:'handle', depth + 1}` per handle node, stopping at depth 4 (04 section
  4.3) and NOT descending into the handles of a `PART_OF` node, which arrives with its url and its own
  handles unread (02 `aggregate.ts:145-146`, the rule `part-of-subtree.test.ts` pins);
- the evidence rows projected from `raw` by the table in section 2.3, only when `described` is true.

`described` is the placeholder rule of 02 section 2.3: false when every field outside `uri`, `origin`,
`id`, `scope` is null or empty and the row is not stamped CONTAINER. A placeholder is still stored as an
`Answer` (its `raw` is the record of what was rebroadcast) and still creates its `Media` stub and its
`CLAIMS` edges; it contributes no evidence row and does not flip `Media.described`. That is the whole of
`pendingClaims` (02 section 2.4): a claim to an undescribed node is inert because section 5's `claims`
plugin filters on `a.described AND b.described`, it is replayed for free the round the describing answer
lands, it never expires, and it is visible in the graph rather than in a `Map` (01 case 48).

`kind` is the resolved field name (`media`, `mediaPage`, `similarMedia`), or `handle` for a nested node.
One more value exists: a handle from `buildHandlesFromUri` (01 case 8) is written with `kind:'answer'`,
because the ingest can see that the target uri was in the question (the request context carries the
input uri, `src/worker/resolvers/media/index.ts:33`) and the answering source is not the target's origin.
Section 5.2 converts an `answer` claim to `SAME_AS` with `strength:'ANSWER'`, which is subject to every
veto, where an `ID` claim is subject only to the structural ones. Open problem 2 of 01 (a uri derived
handle as pointer or assertion) is therefore decided as: an assertion by the answering source about its
OWN row, guarded like a guess, never a member to member restatement. Section 11 lists the alternative.

For an `Episode` result: one `Episode` stub, one `EpisodeAnswer` with the four numbers and `numberSpace`
from the per origin table (section 2.2), one `HAS_EPISODE {by}` from `episode.mediaUri`, one
`EPISODE_CLAIMS` per handle, and the evidence rows (`HAS_TITLE`, `DATED {field:'releaseDate'}`). The
media named by `mediaUri` is `MERGE`d as an undescribed stub when it does not exist, since Crunchyroll's
containment path re-points episodes at the asking run (01 case 12) and that run may not have landed yet.

For an `Origin` result: one `Origin` row with `models` from the section 2.2 table.

### 4.3 The batch, as written

```cypher
-- 1. identity anchors, with the scope ratchet (02 section 2.2) and the described flag (02 section 2.3)
UNWIND $media AS r
MERGE (m:Media {uri: r.uri})
ON CREATE SET m.origin = r.origin, m.id = r.id, m.scope = r.scope, m.described = r.described, m.seq = $seq
ON MATCH SET m.described = m.described OR r.described,
  m.scope = CASE WHEN m.scope = 'CONTAINER' OR r.scope = 'CONTAINER' THEN 'CONTAINER' ELSE m.scope END,
  m.seq = $seq;

-- 2. answers: replace within a key, keep across keys
UNWIND $answers AS r
MATCH (m:Media {uri: r.about})
MERGE (a:Answer {key: r.key})
ON CREATE SET a.about = r.about, a.by = r.by, a.kind = r.kind, a.scope = r.scope, a.score = r.score,
  a.hash = r.hash, a.raw = r.raw, a.seq = $seq
ON MATCH SET a.scope = r.scope, a.score = r.score, a.hash = r.hash, a.raw = r.raw, a.seq = $seq
MERGE (a)-[:ABOUT]->(m);

-- 3. evidence of a replaced answer goes first, then the new projection
UNWIND $replaced AS k
MATCH (m:Media {uri: k.about})-[t:HAS_TITLE {by: k.by, kind: k.kind}]->() DELETE t;
UNWIND $replaced AS k
MATCH (m:Media {uri: k.about})-[d:DATED {by: k.by, kind: k.kind}]->() DELETE d;
UNWIND $replaced AS k
MATCH (m:Media {uri: k.about})-[c:COUNTED {by: k.by, kind: k.kind}]->() DELETE c;

UNWIND $titles AS t
MATCH (m:Media {uri: t.about})
MERGE (x:Title {norm: t.norm}) ON CREATE SET x.hasLetter = t.hasLetter, x.script = t.script
CREATE (m)-[:HAS_TITLE {by: t.by, kind: t.kind, text: t.text, language: t.language, class: t.class,
  score: t.score, seq: $seq}]->(x);

UNWIND $dates AS d
MATCH (m:Media {uri: d.about})
MERGE (x:DateClaim {key: d.key}) ON CREATE SET x.precision = d.precision, x.year = d.year,
  x.month = d.month, x.dayNumber = d.dayNumber, x.day = date(d.day), x.instant = timestamp(d.instant)
CREATE (m)-[:DATED {by: d.by, kind: d.kind, field: d.field, derivation: d.derivation, score: d.score,
  seq: $seq}]->(x);

UNWIND $counts AS c
MATCH (m:Media {uri: c.about})
MERGE (x:CountClaim {value: c.value})
CREATE (m)-[:COUNTED {by: c.by, kind: c.kind, countKind: c.countKind, score: c.score, seq: $seq}]->(x);

-- 4. claims, created only when new, and the count of created rows is the newness signal
UNWIND $claims AS c
MATCH (a:Media {uri: c.from}), (b:Media {uri: c.to})
WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {by: c.by, relation: c.relation, kind: c.kind}]->(b) }
CREATE (a)-[:CLAIMS {by: c.by, relation: c.relation, kind: c.kind, depth: c.depth, seq: $seq}]->(b)
RETURN count(*) AS created;
```

`date(d.day)` and `timestamp(d.instant)` are written in the query because a string parameter into a
`DATE` column is a binder error and `conn.query` throws on it (00). The `NOT EXISTS` plus `CREATE` form
is used for edges rather than `MERGE` on a relationship pattern because only the former was exercised
(00); if relationship `MERGE ... ON CREATE SET` proves sound on 0.20.4 it is the shorter spelling of the
same statement.

Before statement 2 runs, the inserter reads the stored hashes for the batch's keys in one query
(`MATCH (a:Answer) WHERE list_contains($keys, a.key) RETURN a.key, a.hash`) and drops every answer whose
hash is unchanged. A batch that drops everything and creates no claim does not advance `seq` and emits
nothing, which is the newness contract of `edge-idempotence.test.ts` (02 section 2.7) generalized from
edges to rows.

### 4.4 A re-fetch of the same uri

**Replace within a key, keep across keys.** The key is `by|kind|about`, so:

- the same source answering the same document again replaces its previous answer (a fresh fetch
  supersedes a stale one, and nothing reads history);
- a search row (`mediaPage`) and a page row (`media`) about one uri coexist, so the shorter array is no
  longer discarded (02 section 2.5, `lastWriteLongestArray`'s losing side) and the three field row the
  `similarMedia` document selects (04 section 1.2) no longer truncates the full row (I5 point 3, the
  2026-09-05 crunchyroll titles losing their language and score);
- what anilist said about `mal:39535` (a `handle` answer by anilist) is a different row from what mal
  said about itself, so a partial nested node never overwrites a source's own description.

No version history: no persistence is wanted (00), history has no reader, and the hash is the only
"what was said before" any rule needs.

### 4.5 How episodes arrive

Only through a resolved `episodes` field (04 section 1.2, measured: 10 rows through a document that
selected them, 0 through the `similarMedia` document that did not). That stays true and is used: the
`SIMILAR` actuator's document keeps not selecting episodes (`similar-document.test.ts`, KEEP), and a
`containing` answer therefore lands as a media row with no episodes; section 7's fetch plugin then mints a
`MEDIA` ask for that season uri, the full document runs, and the episodes land through this path with
their dates, which is what the `range` plugin needs.

### 4.6 What the commit emits

One event, `graph:changed {seq, uris}`, after the transaction commits, carrying the uris the batch
touched (the field 04 section 3 says was declared and never populated). It wakes the plugin scheduler
(section 5.1), and nothing else: resolvers subscribe to the scheduler's `views:changed {clusterIds}`
instead of to raw writes, so a page re-reads when one of its clusters changed rather than on every
batch. `episode:changed` and `origin:changed` firing unconditionally (04 section 3) is closed by the
hash test; the seven `waitForMedia` callers (04 section 1.8) are woken by `views:changed` for their uri's
cluster, and section 10 keeps them on the old wake-on-everything behaviour until that is verified.

---

## 5. Plugins

### 5.1 The contract

```ts
type PluginId = `plugin:${string}`

type DerivedTable =
  | 'SAME_AS' | 'PART_OF' | 'INCLUDES' | 'SAME_EPISODE' | 'VETO' | 'JOINS' | 'MEMBER_OF' | 'EXTENDS'
  | 'HAS_FACET' | 'VARIANT_OF'
  | 'Cluster' | 'RunLength' | 'Facet' | 'Variant' | 'View' | 'Refusal' | 'Anomaly' | 'Ask'

type Plugin = {
  id: PluginId
  /** Derived tables it reads. RAW and EVIDENCE need no declaration: every plugin may read them. */
  consumes: readonly DerivedTable[]
  /** The only tables the applier will write for it. A row for any other table is rejected. */
  produces: readonly DerivedTable[]
  /** Explicit ordering when consumes/produces do not imply it (the round order in 5.1.2). */
  after?: readonly PluginId[]
  run(ctx: PluginContext): Promise<PluginOutput>
}

type PluginContext = {
  /** Read only. The facade rejects a statement that is not a read before it reaches the engine. */
  query<Row>(cypher: string, params?: Record<string, unknown>): Promise<Row[]>
  /** seq at which this plugin last completed; 0 on the first run and after a reproject. */
  since: number
  /** seq this round is computed at. */
  seq: number
  /** uris whose RAW or EVIDENCE rows changed since `since`, plus every member of a cluster that changed.
   *  null means everything: first run, reproject, tests. */
  dirty: string[] | null
  /** The shared scorers, so every plugin scores exactly the way the record measured (01 case 32):
   *  frizbee, symmetric, normalized by the shorter side, markers stripped on both sides. */
  titleSimilarity(a: string, b: string): Promise<number>
  maxPossibleSimilarity(a: string, b: string): number
  parseSeasonNumber(rawTitle: string): number | undefined
  isOnlySeasonLabel(rawTitle: string): boolean
  isGenericEpisodeTitle(rawTitle: string): boolean
  franchiseTitle(rawTitle: string): string
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Row = Record<string, Json>

type PluginOutput = {
  /** Rows to write. An edge row carries `from` and `to` uris; a node row carries its primary key.
   *  The applier stamps `by` and `seq` and ignores any `by` the plugin wrote. */
  emit: { table: DerivedTable, rows: Row[] }[]
  /** This plugin's own rows to delete, selected by property equality. `by` is forced to this plugin. */
  retract?: { table: DerivedTable, where: Row }[]
  /** Links the plugin declined, written to Refusal so a refusal never looks like absence (01 case 6). */
  refuse?: { rule: string, from: string, to: string, detail: Json }[]
}
```

**Reading**: Cypher over everything, through a facade bound to a connection the plugin module never
imports. LadybugDB has no read only session, so the facade is a defence rather than the proof; the proof
is below.

**Writing**: only through `emit`, only into `produces`, only with the plugin's own `by`. The applier
runs one transaction per plugin per round: retracts first, then emits. An emitted edge is keyed on
`(from, to, by, rule)` and a node on its primary key; an emit whose row already exists with equal
properties is a no op that does not bump `seq`, so re-emitting last round's output is free and silent.
That is the newness contract of `edge-idempotence.test.ts` (02 section 2.7) applied to every derived row.

**Idempotency and recompute**: a plugin is a function of the graph. Its obligation is: for every dirty
subject, retract the rows it minted about that subject and emit the complete current answer. The
applier turns "retract then emit the same" into nothing. A plugin given `dirty = null` recomputes all of
its output, which is how a plugin is reloaded, how `reproject()` rebuilds the derived band, and how a
plugin is tested in isolation (section 9).

**When it runs**: the scheduler runs one ROUND after `graph:changed`, with a 100 ms trailing debounce
(the listing's own debounce today, 04 section 3), one round in flight at a time, further ingests
coalesced into the next. A round runs every plugin once, in the order of 5.1.2, each receiving
`since`, `seq` and `dirty`; a plugin whose upstream tables did not change and whose `dirty` is empty is
skipped. The round ends with `views:changed {clusterIds}` for every `View` row that moved. The two
plugins that mint `Ask` rows hand them to the actuator (section 7), which runs outside the round.

**How the core proves a plugin never touched a source row**:

1. A plugin has no write path: `PluginOutput` is data, and the applier writes only `produces` tables.
2. Plugins run in stub's worker; the engine runs in its nested worker (00); the only object that can
   reach it is the core's connection, which lives in `src/graph/engine.ts`, and a lint rule forbids
   `src/graph/plugins/**` from importing it.
3. The digest of section 2.6 (answers, claims, episode edges, title edges) is read before and after
   every plugin transaction in dev builds and in every plugin test; a difference rejects the round.
4. The test harness (section 9) runs every default plugin over the fixture corpus and asserts the
   digest, and the `by` column is asserted to equal the running plugin's id on every row it produced.

#### 5.1.2 The round

| order | plugin | consumes | produces |
| --- | --- | --- | --- |
| 1 | `claims` | (RAW) | `SAME_AS`, `PART_OF`, `SAME_EPISODE` |
| 2 | `id-shape` | (RAW) | `EXTENDS` |
| 3 | `title-facets`, `title-variants` | (EVIDENCE) | `Facet`, `HAS_FACET`, `Variant`, `VARIANT_OF` |
| 4 | `title-match` | `MEMBER_OF`, `HAS_FACET`, `VARIANT_OF`, `VETO` | `SAME_AS`, `PART_OF` |
| 5 | `similar` (judge) | `Ask`, `MEMBER_OF`, `RunLength` | `SAME_AS`, `PART_OF`, `INCLUDES` |
| 6 | `vetoes` | `SAME_AS`, `MEMBER_OF`, `INCLUDES`, `RunLength`, `HAS_FACET` | `VETO` |
| 7 | `membership` | `SAME_AS`, `VETO`, `EXTENDS`, `INCLUDES`, `PART_OF` | `JOINS`, `MEMBER_OF`, `Cluster`, `Refusal` |
| 8 | `counts` | `MEMBER_OF` | `RunLength` |
| 9 | `vetoes`, `membership` again, only if `RunLength` changed in 8 | | |
| 10 | `containment` | `MEMBER_OF`, `RunLength`, `PART_OF`, `EXTENDS`, `Ask` | `INCLUDES` |
| 11 | `range` | `INCLUDES`, `MEMBER_OF`, `RunLength` | `INCLUDES`, `SAME_EPISODE` |
| 12 | `episode-number` | `MEMBER_OF`, `SAME_EPISODE` | `SAME_EPISODE` |
| 13 | `view` | everything | `View` |
| 14 | `anomalies` | everything | `Anomaly` |
| 15 | `fetch`, `similar` (ask) | `MEMBER_OF`, `PART_OF`, `INCLUDES`, `Ask` | `Ask` |

Step 9 exists because `vetoes` reads `RunLength` and `RunLength` reads membership. The repeat can only
add vetoes and therefore only retract joins, so it is bounded to one iteration and it always moves
toward fewer merges, which is the direction I2 prefers. `containment` running after membership means a
new `INCLUDES` feeds the `includes` veto one round late; membership closes that window with its own join
time check (5.4), so there is no round in which a run can join something that includes it.

### 5.2 `claims`: direct edge merging

**Evidence**: `CLAIMS` with both ends described, and the two `Media.scope` values (02 section 2.2's
ratchet, 03 section 1's scope stamps). Nothing else.

**Candidate scan**, one query:

```cypher
MATCH (a:Media)-[c:CLAIMS]->(b:Media)
WHERE a.described AND b.described
  AND ($dirty IS NULL OR list_contains($dirty, a.uri) OR list_contains($dirty, b.uri))
RETURN a.uri AS from, a.scope AS fromScope, b.uri AS to, b.scope AS toScope,
       c.relation AS claimed, c.kind AS kind, c.by AS claimedBy
ORDER BY from, to, claimedBy
```

**Decision rule**: the derivation table of 02 section 2.1, verbatim, with one column added for the
claim's kind:

| fromScope | toScope | claimed | emits |
| --- | --- | --- | --- |
| RUN | RUN | SAME_AS | `SAME_AS {strength: kind = 'answer' ? 'ANSWER' : 'ID', rule:'claim'}` |
| RUN | RUN | PART_OF | `PART_OF {rule:'claim'}` |
| RUN | CONTAINER | any | `PART_OF from -> to`, whatever was claimed |
| CONTAINER | RUN | any | `PART_OF to -> from`: the edge always runs from run to container |
| CONTAINER | CONTAINER | SAME_AS | `SAME_AS {strength:'ID'}` in the container space |
| CONTAINER | CONTAINER | PART_OF | `PART_OF {rule:'claim'}` |
| any | any | INCLUDES | `INCLUDES {rule:'claim'}`, rangeless, only when both ends share `origin` and `EXTENDS` holds from `to` to `from` (NEW, 01 cases 10 and 17: containment is asserted only inside one id space); otherwise dropped and recorded as `Refusal {rule:'foreign-includes'}` |

An `EPISODE_CLAIMS` with relation SAME_AS becomes `SAME_EPISODE {rule:'claim'}`; a PART_OF one is
dropped, since 01 case 51 records that shape as never read. `evidence` on every emitted edge is
`{claimedBy, kind, claimed, fromScope, toScope}`.

**What it must not repeat**: a SAME_AS claim between a run and a show becoming a union (02 section 2.1,
the Mushoku weld); a claim applied before its subject's row landed and taking the RUN default (01 case
48). Both are impossible here by the `described` filter and the ratchet.

**Failure mode**: a per run origin that is show level for a minority of entries (01 case 43, `mal` at
0.3%) converts as RUN x RUN and is caught only downstream, by the fold veto or by membership's id
contradiction check. That is the residue 01 case 43 accepts by decision.

### 5.3 `vetoes`: objections, one query per rule

**Evidence**: proposed `SAME_AS` edges of any writer, the pair's counts, dates, facets and formats, the
clusters and `RunLength` as they stood after the previous membership pass, and `INCLUDES`.

The structural rules apply to every strength. The four gate rules apply to `strength <> 'ID'`, because
an id mapping is a source's first party join key and the record prices refusing those at 5 correct per
suspect (R8) while true pairs disagree on dates 5 times in 102 for SPECIAL (01 case 36); an id claim is
instead caught by the structural rules and by membership's contradiction check.

**`fold`** (I6, 01 case 9, `foldVetoed` in `src/sources/similar.ts`, zero tolerance): a season
modelling row holding MORE episodes than the run's length is never the run.

```cypher
MATCH (a:Media)-[s:SAME_AS]-(b:Media)
MATCH (ga:Origin {id: a.origin}), (gb:Origin {id: b.origin})
WHERE ga.models = 'SEASON' AND gb.models = 'RUN'
MATCH (a)-[:COUNTED]->(ca:CountClaim)
OPTIONAL MATCH (b)-[:MEMBER_OF]->(cb:Cluster)
OPTIONAL MATCH (l:RunLength {clusterId: cb.id})
OPTIONAL MATCH (b)-[:COUNTED {countKind:'DECLARED'}]->(cd:CountClaim)
WITH a, b, ca, coalesce(l.value, max(cd.value)) AS ours
WHERE ours IS NOT NULL AND ca.value > ours
RETURN DISTINCT a.uri AS from, b.uri AS to, ca.value AS theirs, ours
```

The `coalesce` is the first round fallback: before the cluster has a consensus length, the pair is judged
on the run's own declared count, and re-judged against `RunLength` in step 9. Absent on either side
means no row, which is `skipped:absent`, never a pass (01 case 23: zero is a row with value 0 and is
compared as 0, not as "no count").

**`split`**, NEW, motivated by 01 case 10 (BAKI: 13 against 26 passes `foldVetoed` and the year rule
welds season 1 of three): a season modelling row holding FEWER episodes than a FINISHED run is a part of
it, never it. The status gate is what keeps the Elusive Samurai row (8 aired of 12, 01 case 13) and every
airing run's `episodes.length` witnesses (I9) out of the veto: while the run is releasing a short list is
expected.

```cypher
MATCH (a:Media)-[s:SAME_AS]-(b:Media)
MATCH (ga:Origin {id: a.origin}), (gb:Origin {id: b.origin})
WHERE ga.models = 'SEASON' AND gb.models = 'RUN'
MATCH (a)-[:COUNTED]->(ca:CountClaim)
MATCH (b)-[:MEMBER_OF]->(cb:Cluster)
MATCH (l:RunLength {clusterId: cb.id})
MATCH (b)-[:MEMBER_OF]->(cb)<-[:MEMBER_OF]-(w:Media)<-[:ABOUT]-(ans:Answer)
WHERE json_extract(ans.raw, 'status') = 'FINISHED' AND ca.value < l.value
RETURN DISTINCT a.uri AS from, b.uri AS to, ca.value AS theirs, l.value AS ours
```

Its cost arm has not been run; section 11 lists it as a decision. Today's rule 5 already admits a shorter
season only on exact count (03 section 4), so the veto only closes the date rule's leak.

**`includes`** (the owner's rule): nothing in an including node's cluster may be the same as anything in
a cluster it includes.

```cypher
MATCH (z:Media)-[:INCLUDES]->(y:Media)
MATCH (z)-[:MEMBER_OF]->(cz:Cluster)<-[:MEMBER_OF]-(w:Media)
MATCH (y)-[:MEMBER_OF]->(cy:Cluster)<-[:MEMBER_OF]-(m:Media)
MATCH (w)-[:SAME_AS]-(m)
RETURN DISTINCT w.uri AS from, m.uri AS to, z.uri AS via, y.uri AS included
```

**`format`** (02 section 2.10 gate 1): both sides name a format and the sets are disjoint.

```cypher
MATCH (a:Media)-[s:SAME_AS]-(b:Media) WHERE s.strength <> 'ID'
MATCH (a)<-[:ABOUT]-(xa:Answer), (b)<-[:ABOUT]-(xb:Answer)
WITH a, b,
  collect(DISTINCT json_extract(xa.raw, 'categories')) AS fa,
  collect(DISTINCT json_extract(xb.raw, 'categories')) AS fb
RETURN a.uri AS from, b.uri AS to, fa, fb
```

with the disjointness decided in JS on the two collected lists exactly as `profileCluster`'s `formats`
does (MOVIE/SERIES from categories plus type, SPECIAL/OVA/ONA format neutral, 02 section 2.10).

**`season`** (02 section 2.10 gate 2; R4 says silence never blocks): both sides carry a parsed ordinal and
the ordinal sets are disjoint.

```cypher
MATCH (a:Media)-[s:SAME_AS]-(b:Media) WHERE s.strength <> 'ID'
MATCH (a)-[:HAS_TITLE {class:'MAIN'}]->(:Title)-[:HAS_FACET]->(fa:Facet)
MATCH (b)-[:HAS_TITLE {class:'MAIN'}]->(:Title)-[:HAS_FACET]->(fb:Facet)
WHERE fa.ordinal IS NOT NULL AND fb.ordinal IS NOT NULL
WITH a, b, collect(DISTINCT fa.ordinal) AS oa, collect(DISTINCT fb.ordinal) AS ob
RETURN a.uri AS from, b.uri AS to, oa, ob
```

Disjointness in JS. The known gap stays known: `86` against `86 Part 2` where one side names nothing
(01 case 26) is not vetoed, at the measured price of the alternative (R4: one weld stopped per 37 merges
destroyed), and `season-separation.test.ts` keeps pinning it as KNOWN GAP.

**`start-date`** (02 section 2.10 gate 3, `START_DATE_WINDOW_DAYS = 45`; 01 case 36: consecutive cours
sit about 91 days apart, so the window has a structural ceiling): both sides carry a DAY precision start
date and no pair is within 45 days.

```cypher
MATCH (a:Media)-[s:SAME_AS]-(b:Media) WHERE s.strength <> 'ID'
MATCH (a)-[:DATED {field:'startDate'}]->(da:DateClaim), (b)-[:DATED {field:'startDate'}]->(db:DateClaim)
WHERE da.precision IN ['DAY','INSTANT'] AND db.precision IN ['DAY','INSTANT']
WITH a, b, min(abs(da.dayNumber - db.dayNumber)) AS gap
WHERE gap > 45
RETURN a.uri AS from, b.uri AS to, gap
```

Precision does the work that dropping the first of the month did (01 cases 33 and 34): a `YEAR` or
`MONTH` claim is not in the query, so the 17,946 streaming attaches the sentinel carries (01 case 33) are
untouched, and a genuine January 1 premiere is still invisible until a source declares `precision`
(01 open problem 13, priced at 0.52%).

**`companion`** (02 section 2.10 gate 4, both signals required, ratio 24.5 measured): work kinds named on
both sides and disjoint, AND a title on one side carrying one of the ten kept `COMPANION_MARKERS`
(`Facet.companion`). The query is the `season` one with `fa.companion` in place of the ordinal and the
work kind read from raw; the decision rule is the same AND.

**Emits**: one `VETO {rule, detail}` per pair and rule. **Retracts**: its own vetoes for dirty pairs
before re-emitting, so a veto whose evidence went away goes away with it.

**Failure mode**: a veto is only as good as the evidence row it reads, so a wrong `countKind` or
`precision` table entry moves an exchange rate silently. Section 9's corpus test pins every rule against
the measured arms (02 section 2.10's numbers) so a table edit that changes an arm fails a test.

### 5.4 `membership`: the one chokepoint

**Evidence**: `SAME_AS` of every strength, `VETO`, `EXTENDS`, `INCLUDES`, `PART_OF`, and the clusters as
they stand.

**Candidate scan**:

```cypher
MATCH (a:Media)-[s:SAME_AS]->(b:Media)
WHERE a.described AND b.described AND a.scope = b.scope
  AND NOT EXISTS { MATCH (a)-[:VETO]-(b) }
  AND NOT EXISTS { MATCH (a)-[:JOINS]-(b) }
  AND ($dirty IS NULL OR list_contains($dirty, a.uri) OR list_contains($dirty, b.uri))
OPTIONAL MATCH (a)-[:MEMBER_OF]->(ca:Cluster)
OPTIONAL MATCH (b)-[:MEMBER_OF]->(cb:Cluster)
RETURN a.uri AS from, b.uri AS to, a.scope AS space, s.strength AS strength, ca.id AS fromCluster,
       cb.id AS toCluster
ORDER BY from, to
```

followed by one query fetching the members of every cluster named:

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE list_contains($clusterIds, c.id)
RETURN c.id AS cluster, c.size AS size, m.uri AS uri, m.origin AS origin, m.id AS id
```

and one fetching every `EXTENDS`, `INCLUDES` and `PART_OF` edge among those members.

**Decision rule**, per pair, in JS over those rows (each cluster is 3 to 8 rows, 00):

1. **The id contradiction check** (01 case 5, R18 one way, and 01 case 11's "at most one run may claim
   this catalogue season, evaluated where both claimants are visible"): for every origin present in
   both clusters, every id pair across the two must satisfy `x = y` or `x` extends `y` or `y` extends
   `x` (an `EXTENDS` edge). One failure refuses the join with `Refusal {rule:'ids', detail:{origin, x, y}}`.
   R7's `nf:81091393-3` with two Demon Slayer runs of eleven episodes each ends here: the second run's
   proposal is refused, the first stands, and the anomaly plugin reports the contest.
2. **The containment check**: any `INCLUDES` or `PART_OF` edge between a member of one cluster and a
   member of the other refuses the join with `Refusal {rule:'includes'}`. This is the join time half of
   the owner's rule, and it does not wait for the `includes` veto of the next round.
3. Otherwise emit `JOINS (a, b)` and merge: the survivor is the larger cluster, tie to the
   lexicographically smaller cluster id (02 section 2.6: "by SIZE and then by the smaller root, never by
   the union-find's own choice of root"); the retired cluster's `canonical` is set to the survivor and
   every tombstone already pointing at the retired id is repointed, so a lookup is always one hop; the
   moved members' `MEMBER_OF` rows are rewritten; `size` updated.
4. Every described media with no cluster gets a singleton `Cluster {space: scope, size: 1}` with a fresh
   uuid, in one `UNWIND` (00: batch writes).

**Retraction**: a `JOINS` edge whose `SAME_AS` was retracted or which now carries a `VETO` is deleted,
and the affected cluster's components are recomputed with the one recursive query of section 3.4, run
only here and only over that cluster's members; the largest fragment keeps the id (I15), the others get
new ids with `canonical` unset. This is the inverse `graph.link` never had (I1), and it is the reason a
wrong merge is a retraction rather than a reload.

**Emits**: `JOINS`, `MEMBER_OF`, `Cluster`, `Refusal`. **Failure mode**: a pair whose contradiction is in a
field the check does not read (two runs of one show from origins with no shared id, no count, no date)
joins; that is the residue the fuzzy gates leave today (02 section 2.10's known gaps) and it is reported,
not hidden, by `anomalies`.

### 5.5 Three small evidence plugins

**`id-shape`** (01 case 5: "specificity is PREFIX EXTENSION, not length"; R18: read one way).

```cypher
MATCH (a:Media) WHERE $dirty IS NULL OR list_contains($dirty, a.uri)
MATCH (b:Media {origin: a.origin})
WHERE a.uri <> b.uri AND starts_with(a.id, concat(b.id, '-'))
RETURN a.uri AS from, b.uri AS to
```

Emits `EXTENDS`. Only existing nodes are joined, so `offline:mal-59193` never extends a nonexistent
`offline:mal`. Failure mode: a slug origin (trakt) whose two real slugs happen to nest would read as
precision; the ids check would then tolerate two trakt ids in a cluster, which the anomaly plugin still
reports because it counts ids per origin without the exemption.

**`title-facets`** (02 section 2.10 `profileCluster`: ordinals are parsed from RAW titles "because
normalizeTitle folds Season 4 and Season 40 closer together"; 01 case 21's generic titles; 02's ten
kept `COMPANION_MARKERS`).

```cypher
MATCH (t:Title)<-[h:HAS_TITLE]-() WHERE h.seq > $since
RETURN t.norm AS norm, collect(DISTINCT h.text) AS texts
```

For each norm, over its raw texts sorted: `ordinal = parseSeasonNumber(text)` and `part` (kept only when
every text agrees, else absent), `onlyLabel = isOnlySeasonLabel`, `generic = GENERIC_EPISODE` from
`src/sources/similar.ts:104`, `companion` from the marker list. Emits `Facet` and `HAS_FACET`. This is
the only place a vocabulary touches a title, which is why it is a plugin and not a projection.

**`title-variants`** (01 case 31: only the JOINING direction is derivable, `Onii-chan` to `oniichan`,
`Re:Zero` to `rezero`, `Kin'iro` to `kiniro`; 01 case 28 and I8: the diacritic fold "deserves its own
measured change").

```cypher
MATCH (t:Title) WHERE t.hasLetter AND ($dirty IS NULL OR EXISTS {
  MATCH (m:Media)-[:HAS_TITLE]->(t) WHERE list_contains($dirty, m.uri) })
RETURN t.norm AS norm
```

Two rules, each emitting `Variant {norm: derived}` and `VARIANT_OF {rule}` when the derived spelling
differs: `punct-join` (on by default) and `diacritic-fold` (NFD, strip combining marks; OFF by default,
section 11). `title-match` reads variants only for rules that are on, so the fold is a candidate spelling
with a switch and a measurement, never an edit to the normaliser everyone shares (R17).

### 5.6 `title-match`: the fuzzy pass as a plugin

**Evidence** (03 section 2 for who supplies what): MAIN titles with a letter (I12, 01 case 24), start
dates with their precision, categories and type from raw, the parsed ordinals, and cluster membership.

**Candidate scan A, exact agreement**, one query, the shared `Title` node doing the join (this is the
"do these two title sets agree in any language" question of the brief):

```cypher
MATCH (a:Media)-[:HAS_TITLE {class:'MAIN'}]->(t:Title)<-[:HAS_TITLE {class:'MAIN'}]-(b:Media)
WHERE t.hasLetter AND a.scope = b.scope AND a.described AND b.described
  AND NOT EXISTS { MATCH (t)-[:HAS_FACET]->(f:Facet) WHERE f.onlyLabel }
MATCH (a)-[:MEMBER_OF]->(ca:Cluster), (b)-[:MEMBER_OF]->(cb:Cluster)
WHERE ca.id < cb.id
MATCH (ca)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(da:DateClaim)
MATCH (cb)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(db:DateClaim)
WHERE da.year = db.year
RETURN DISTINCT ca.id AS fromCluster, cb.id AS toCluster, t.norm AS shared, da.year AS year
```

A second copy of the query joins through `(:Title)<-[:VARIANT_OF]-(v:Variant)-[:VARIANT_OF]->(:Title)`
for the enabled variant rules. The year join is the bucket of 02 section 2.10 step 2 at cluster level
(any member's year), and a `YEAR` precision sentinel contributes its year exactly as `yearOf` does today
while `startDay` drops it (01 case 33); a cluster with no date is in no bucket and is compared with
nothing, the cost 01 case 35 measured and accepted.

**Candidate scan B, fuzzy**: cluster pairs in one year bucket, same space, not joined, not exact matched:

```cypher
MATCH (ca:Cluster)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(d:DateClaim)
MATCH (cb:Cluster)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(d2:DateClaim)
WHERE ca.space = cb.space AND ca.id < cb.id AND d.year = d2.year
  AND ($dirtyClusters IS NULL OR list_contains($dirtyClusters, ca.id) OR list_contains($dirtyClusters, cb.id))
RETURN DISTINCT ca.id AS fromCluster, cb.id AS toCluster, d.year AS year
```

and one profile query per bucket's clusters, which is `profileCluster` (02 section 2.10) as a query:

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE list_contains($clusters, c.id)
MATCH (m)-[h:HAS_TITLE {class:'MAIN'}]->(t:Title) WHERE t.hasLetter
OPTIONAL MATCH (t)-[:HAS_FACET]->(f:Facet)
WITH c, m, t, f, max(h.score) AS score
WHERE f IS NULL OR NOT f.onlyLabel
OPTIONAL MATCH (m)-[:DATED {field:'startDate'}]->(d:DateClaim) WHERE d.precision IN ['DAY','INSTANT']
RETURN c.id AS cluster, m.uri AS uri, m.scope AS scope, t.norm AS title, score, f.ordinal AS ordinal,
       f.companion AS companion, d.dayNumber AS day
ORDER BY cluster, score DESC, title ASC
```

**Decision rule**, in JS per pair, the six gates of 02 section 2.10 in their order and with their
thresholds, each recorded in `evidence`:

| # | gate | rule | outcome recorded when the premise is absent |
| --- | --- | --- | --- |
| 0 | year bucket | the query itself | (not a candidate) |
| 1 | format | both name a format and disjoint: refuse | `skipped:absent` |
| 2 | season | both name an ordinal and disjoint: refuse; silence never blocks (R4) | `skipped:absent` |
| 3 | start date | both carry a DAY precision day and no pair within 45 days: refuse (`START_DATE_WINDOW_DAYS = 45`) | `skipped:absent` |
| 4 | companion | disjoint work kinds AND a companion marker: refuse (both signals, ratio 24.5) | `skipped:absent` |
| 5 | title | exact `norm` equality accepts; `differOnlyByTrailingNumber` skips the pair (01 case 25); `maxPossibleSimilarity < 0.9` skips without a wasm call; `titleSimilarity >= SIMILARITY_THRESHOLD = 0.9` accepts (R6: change nothing) | |

Profiles are capped at `MAX_TITLES_PER_CLUSTER = 6`, score descending then title ascending (01 case
30: the title ascending arm, 69.6 / 99.9 / 70.0 against arrival order's 64.5 / 94.9 / 56.0), which the
`ORDER BY` above produces without any arrival order in the path. Decisions are cached on the pair of
profile cache keys in an LRU rather than wiped wholesale at 50,000 (02 section 5.3 names the wipe as a
cost). Gates 1 to 4 are evaluated here as a cheap pre-filter before the wasm call and again by
`vetoes` on every proposed edge; both use the same predicate functions, so an `ANSWER` or `SIMILAR` edge
from another plugin meets exactly these gates (01 case 2's "the same evaluation path").

**Emits**: same space: `SAME_AS {strength:'TITLE', rule:'exact' | 'fuzzy', score}` from each cluster's
link uri (the lowest uri whose own scope matches the cluster's space, 02 section 2.10 `linkUri`). A RUN
cluster against a CONTAINER cluster: `PART_OF {rule:'title'}` from the run's link uri to the container's,
never sameness (02 section 2.10's scope dispatch: "a title match between a run and a show is a guess at
containment, so it rides an edge").

**What it does not repeat**: R6 (thresholds), R17 (`norm` keeps every script), R4 (silence), R5 (a day
window, not a quarter), I12 (MAIN class only), and the two arrival order dependences of 01 case 30.

**Failure mode**: the gaps 02 section 5.3 records stay: `86` against `86 Part 2` (one side silent), the
12,050 franchise label pairs with no season on either side, and a source dating a show by when it
started carrying it. Membership's contradiction check catches the subset of those where the two clusters
carry disagreeing ids of one origin, which the fuzzy pass could not see (01 case 7).

### 5.7 `similar`: the consumer as a plugin, in two halves

**The ask half** produces `Ask {kind:'SIMILAR'}` rows; the actuator (section 7) executes them. The
evidence sent is what 04 section 1.6 sends today, read from the graph: every MAIN title of the cluster
minus pure labels, the best run start date (the first DAY precision date, else the first at all,
`similar.ts:118-119`), `RunLength.value`, and up to 200 episode titles of the cluster's OWN episodes:

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {space:'RUN'})
MATCH (m)-[:PART_OF]->(show:Media) WHERE list_contains($answerers, show.origin)
OPTIONAL MATCH (prior:Ask {kind:'SIMILAR', clusterId: c.id, origin: show.origin})
WITH c, show, count(prior) AS asked, collect(prior.question) AS questions
WHERE asked < 4
RETURN DISTINCT c.id AS cluster, show.origin AS origin, show.id AS showId, asked, questions
```

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $cluster})
OPTIONAL MATCH (m)-[:HAS_EPISODE]->(e:Episode)-[h:HAS_TITLE]->(t:Title)
RETURN DISTINCT t.norm AS title, h.text AS text LIMIT 200
```

The episode titles come through `HAS_EPISODE` of members only, never through `INCLUDES`, which is R2's
second blocker closed ("the S2 cour-1 cluster carries BOTH cours' titles" because it read the raw walk).
`$answerers` is the five that implement `similarMedia` (03 section 4: crunchyroll, unogs, justwatch,
appletv, tvmaze), read off the definitions as today. The caps are 04 section 1.6's: `MAX_ASKS_PER_PAIR
= 4`, an ask keyed on the hash of its question so an unchanged question is never re-sent, a changed
question re-sent up to the cap.

**The judge half** consumes `ANSWERED {role:'run'}` and emits `SAME_AS {strength:'SIMILAR', rule}` from
the answer row to the cluster's link uri, with `rule` the answerer's own verdict rule (`SimilarRule`:
`date`, `episode-titles`, `ordinal`, `year`, `first`, `src/sources/similar.ts:40`), after the three
refusals 04 section 1.6 makes today: the answer must be a RUN of the asked origin; another run of that
origin already in the cluster refuses; the answer's titles must clear `SHOW_TITLE_THRESHOLD = 0.9`
against the cluster's (03 section 4). The answering sources keep `pickSimilarSeason` and its five rules
with their thresholds (rule 1 within `SEASON_DATE_WINDOW` 45 days on a DAY date; rule 2 with
`MIN_EPISODE_TITLE_MATCHES = 3` and `EPISODE_TITLE_COVERAGE = 0.6`; rules 3 to 5 as written), because
those rules read evidence only the answering side holds (03 section 4's candidate table).

**The schema change this needs** (NEW, 01 case 12 generalized from Crunchyroll's `lendContainingSeason`
to every answerer, 01 case 9's undelivered half): `similarMedia` returns `{ media, containing }`, where
`containing` is the ONE season that holds the asked run without being it: for answerers with a premiere,
the season whose episode span covers the run's start and which is longer; for unogs and justwatch, a
season with at least `MIN_EPISODE_TITLE_MATCHES` exact episode title matches and a count above the run's,
whatever the coverage: below 0.6 it is the fold's signature (03 section 4: "a fold of two equal cours
scores 12/24 = 0.50 and is refused"), above it a season that is the run plus an insert (section 8.3,
Blue Exorcist at 23 of 26). A `containing` row lands as an `Answer {kind:'similarMedia:containing'}` and an
`ANSWERED {role:'containing'}` edge, and claims nothing; `containment` decides what it means.

**Failure mode**: a refusal on partial evidence (01 open problem 14) is bounded by the four asks and
the question hash; an answer that is a wrong run of the right show is caught by the fold and split
vetoes or not at all, which is the exchange rate 01 case 37 measured live.

### 5.8 `containment`: PART_OF, INCLUDES, and the RUN versus CONTAINER exchange

**Evidence**: `RunLength` with its witness count, the season rows' counts and premieres, `EXTENDS` (a
season id extends its show id, 03 section 1's id shapes), `PART_OF` from the run cluster to the show,
`ANSWERED {role:'containing'}`, episode dates of the season when its episodes have landed.

**Rule A, a `containing` answer**:

```cypher
MATCH (ask:Ask {kind:'SIMILAR'})-[:ANSWERED {role:'containing'}]->(season:Media)
MATCH (c:Cluster {id: ask.clusterId}), (l:RunLength {clusterId: c.id})
MATCH (season)-[:COUNTED]->(cs:CountClaim)
RETURN ask.key AS ask, c.id AS cluster, season.uri AS season, cs.value AS seasonCount, l.value AS runLength,
       l.witnesses AS witnesses
```

Decision: `seasonCount > runLength` and `witnesses >= 2` emits `INCLUDES season -> linkUri {rule:
'containing'}` with no range (I9: "a LOAN is refused whole when the length is uncorroborated", the two
witness bar of `runEpisodes`, 02 section 2.9). `seasonCount < runLength` with the run FINISHED emits
`INCLUDES linkUri -> season {rule:'split'}` (NEW, 01 case 10). Equal counts are not this plugin's: that
answer should have been `media`, and it is refused with `Refusal {rule:'containing-equal'}`.

**Rule B, a sibling season under the same show**, which is `lendContainingSeason` (01 case 12,
`crunchyroll/extractor.ts:402`) as one query over the graph instead of one source's private walk:

```cypher
MATCH (run:Media)-[:MEMBER_OF]->(rc:Cluster {space:'RUN'})
MATCH (l:RunLength {clusterId: rc.id}) WHERE l.witnesses >= 2
MATCH (run)-[:PART_OF]->(show:Media)<-[:EXTENDS]-(season:Media)
MATCH (season)-[:COUNTED]->(cs:CountClaim) WHERE cs.value > l.value
MATCH (season)-[:DATED {field:'startDate'}]->(ds:DateClaim) WHERE ds.precision IN ['DAY','INSTANT']
MATCH (rc)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(dr:DateClaim)
WHERE dr.precision IN ['DAY','INSTANT']
  AND NOT EXISTS { MATCH (season)-[:MEMBER_OF]->(rc) }
OPTIONAL MATCH (season)-[:HAS_EPISODE]->(:Episode)-[:DATED {field:'releaseDate'}]->(de:DateClaim)
WITH rc, season, cs, l, ds, dr, min(de.dayNumber) AS firstDay, max(de.dayNumber) AS lastDay
WITH rc, season, cs, l, dr,
     coalesce(firstDay, ds.dayNumber) AS spanStart,
     coalesce(lastDay, ds.dayNumber + 7 * cs.value) AS spanEnd
WHERE dr.dayNumber >= spanStart - 1 AND dr.dayNumber <= spanEnd + 1
RETURN rc.id AS cluster, season.uri AS season, cs.value AS seasonCount, l.value AS runLength,
       spanStart, spanEnd
```

Decision: exactly one season may qualify per cluster (01 case 12: "exactly one may qualify"); two or more
refuse all of them with `Refusal {rule:'ambiguous-container'}`. The span is the season's own episode
dates when they have landed, else the premiere plus seven days per episode, and the evidence says which.
Emits `INCLUDES season -> linkUri {rule:'span'}`, rangeless; `range` fills it.

**What it deliberately does not do**: mint containment on a year alone for a dateless catalogue (nf, jw
seasons): today's outcome for that case, the show as a CONTAINER carrying the offers (01 case 9,
`showAsContainer`), is what this plugin also produces through `claims` (the JustWatch PART_OF to the
show), and the season level link waits for a `containing` answer or for `range`'s exact count sum. That
is I2 applied to 01 open problem 3.

**Failure mode**: a season whose count is inflated by duplicate rows (01 case 16: 14 rows over 10
epids) looks longer than it is and can qualify as a container of a 10 episode run. The `range` plugin
then finds no date correspondence and the edge stays rangeless, which renders as a season level link
and no episode rows: wrong in the direction of showing less, never more.

### 5.9 `range`: season and episode range matching

**Evidence** (03 section 3, "episode facts worth pulling out"): episode release dates exist on exactly
five sources, anizip (`airDateUtc` an instant, `airdate` a day), crunchyroll, appletv and the offline
seed, so the date rule can fire only where one of those sits on each side of an `INCLUDES` or inside a
cluster. Episode titles exist on every episode source but are a different translation on Netflix (R2)
and placeholders 11 times in 25 (01 case 21). Counts exist everywhere.

**Subjects**: every rangeless `INCLUDES` (from `containment`), and every RUN cluster whose member
origins number their episodes in different spaces (01 case 14: anizip's entry key against Crunchyroll's
continuing season number), because the alignment of 02 section 2.9 runs among members too.

**Rule `date`** (01 case 13; `alignmentOffset` at `consensus.ts:113`, with its constants: a day of
slack either side because "ani.zip stamps `2021-01-10T15:00:00Z`, which is the 11th in Tokyo, and
Crunchyroll publishes the Tokyo date"; `MIN_ALIGNED = 2`; refuse when a day names more than one
reference episode). One query fetches both sides:

```cypher
MATCH (z:Media)-[i:INCLUDES]->(y:Media) WHERE i.fromStart IS NULL
  AND ($dirty IS NULL OR list_contains($dirty, z.uri) OR list_contains($dirty, y.uri))
MATCH (y)-[:MEMBER_OF]->(c:Cluster), (l:RunLength {clusterId: c.id})
MATCH (c)<-[:MEMBER_OF]-(ref:Media)-[:COUNTED]->(k:CountClaim) WHERE k.value = l.value
MATCH (ref)-[:HAS_EPISODE]->(re:Episode)<-[:ABOUT]-(ra:EpisodeAnswer {by: ref.origin})
MATCH (re)-[:DATED {field:'releaseDate'}]->(rd:DateClaim) WHERE rd.precision IN ['DAY','INSTANT']
MATCH (z)-[:HAS_EPISODE]->(ze:Episode)<-[:ABOUT]-(za:EpisodeAnswer {by: z.origin})
MATCH (ze)-[:DATED {field:'releaseDate'}]->(zd:DateClaim) WHERE zd.precision IN ['DAY','INSTANT']
WHERE abs(zd.dayNumber - rd.dayNumber) <= 1
RETURN z.uri AS container, y.uri AS run, ref.origin AS refOrigin, re.uri AS refEpisode, ra.number AS refNumber,
       rd.dayNumber AS refDay, ze.uri AS episode, za.number AS number, zd.dayNumber AS day
ORDER BY refOrigin, refNumber, number
```

That is the brief's "does this pair share air days" as one query. The reference set is the members
whose count equals the run length (`alignRunEpisodes`, `consensus.ts:271-273`), grouped by origin.
Decision, in JS over the rows: a reference day naming two different reference numbers is dropped, and
so is a container day naming two container episodes; every surviving row is a pair matched on its own
day, and each becomes `SAME_EPISODE {rule:'date', support}` with `evidence: {refDay, day, refOrigin}`;
the alignment is refused whole when fewer than 2 pairs survive; the offset `number - refNumber` is voted
as today and a tie refuses the whole alignment (02 section 2.9: "NOTHING RATHER THAN A GUESS"). The
per pair edges are what makes a mid season insert cost one episode its link and shift nothing else
(01 case 15): an inserted special has its own day and matches no reference episode, and the pairs after
it still match on their own days. The summarizing `INCLUDES {by:'plugin:range', rule:'date', fromStart,
fromEnd, toStart, toEnd, support}` is the hull of the matched numbers on each side, with
`evidence.piecewise = true` when the matched pairs are not one constant offset.

The same query with `(z)` replaced by a second member `(other)` of the same cluster, origin different
from `ref`, is the alignment among members (the Elusive Samurai shape, section 8.2).

**Rule `count-sum`** (NEW, the owner's "crunchyroll's 1-12 = season 1, 13-24 = season 2", 01 case 9;
guarded by 01 cases 15 and 16 and by R1; OFF by default, section 11): a container whose count equals
the EXACT sum of the run lengths of consecutive run clusters under the same show, ordered by DAY
precision start date, and for which no date rule could run:

```cypher
MATCH (z:Media)-[i:INCLUDES]->(y:Media) WHERE i.fromStart IS NULL
MATCH (z)-[:COUNTED]->(cz:CountClaim)
MATCH (z)-[:INCLUDES]->(r:Media)-[:MEMBER_OF]->(c:Cluster), (l:RunLength {clusterId: c.id})
MATCH (c)<-[:MEMBER_OF]-(:Media)-[:DATED {field:'startDate'}]->(d:DateClaim)
WHERE d.precision IN ['DAY','INSTANT']
WITH z, cz, c, l, min(d.dayNumber) AS start
ORDER BY start
WITH z, cz, collect({cluster: c.id, length: l.value, start: start}) AS runs, sum(l.value) AS total
WHERE total = cz.value
RETURN z.uri AS container, cz.value AS count, runs
```

This is also the brief's "is this count a fold of those two" as one query. Decision: equality exact,
runs consecutive by start date with no other run of the show between them, and the container has no
episode dates at all (else the date rule is the answer); emits `INCLUDES` ranges by cumulative counts and
NO `SAME_EPISODE` edges, so the view places container episodes by position through the range but nothing
downstream can mistake that for a per episode identity. For Mushoku it refuses (24 is not 11 + 12; 25 is
not 12 + 12), which is correct because the extra row is a special. R1 is answered by the exactness: the
refuted design answered on a one vote majority with a special inside the count; this one answers only
when the count arithmetic closes, and any insert opens it. The validation arm is free: Crunchyroll
seasons carry dates, so the ranges `count-sum` would mint for them can be compared with the ranges `date`
did mint, over the corpus, before the rule is ever turned on for Netflix.

**No title rule.** Titles never place an episode (R1, R2, I7). A `SAME_EPISODE {rule:'date'}` pair
whose title norms agree records `evidence.titleAgrees = true`, and that is the only thing a title does
here.

**No number rule across INCLUDES.** I14: a number is safe only inside one cluster.

**Failure mode**: no dates on either side (nf against mal or kitsu), or dates on one side only, yields
nothing: the `INCLUDES` stays rangeless and the run's page shows a season level link and no per episode
Netflix rows, which is 01 open problem 3 stated honestly. A Crunchyroll row whose continuing numbers are
not date placed (a cluster with no anizip) is windowed out by the view, as today (01 case 13's outcome).

### 5.10 `counts`: the run length

**Evidence**: `COUNTED` edges of a RUN cluster's members, with `score` and `countKind`.

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {space:'RUN'})
WHERE $dirtyClusters IS NULL OR list_contains($dirtyClusters, c.id)
MATCH (m)-[k:COUNTED]->(v:CountClaim)
RETURN c.id AS cluster, m.uri AS uri, m.origin AS origin, coalesce(k.score, 0) AS score,
       k.countKind AS kind, v.value AS value
ORDER BY cluster, score DESC, uri
```

**Decision rule**: `tieredConsensus` verbatim (02 section 2.8, I11, R3): the maximum score present is
the tier; among that tier's claims the most supported value wins; nothing below the tier is consulted;
an unscored row is tier 0. Ties inside a tier go to the larger value (02 section 2.8: "over-estimating
costs a refusal and under-estimating hides data"), with one NEW tiebreak in front of it: a `DECLARED`
claim beats a `LIST` claim at equal support, which is the conclusion R3 records ("a declared count
beating a derived length") and I9's airing variant (the announced 14 against the eleven aired so far).
`witnesses` is the number of members whose value equals the winner at any tier, which the two witness
bar reads (02 section 2.9); `declared` is how many of those were `DECLARED`.

**Emits** one `RunLength` per cluster. **Failure mode**: anizip's media row carries no score, so its
exact count sits in tier 0 and never wins (01 case 44, open problem 8); the plugin reads
`Answer.score` and the fix is a source decision listed in section 11.

### 5.11 `episode-number`: identity by number, inside one cluster only

I14 and 01 case 19: two metadata sources over one run draw one list, and the rule is "SAFE ONLY
BECAUSE THE INPUT IS ONE RUN" (`db.ts:465-468`). The query enforces the precondition rather than a
comment:

```cypher
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {space:'RUN'})
WHERE $dirtyClusters IS NULL OR list_contains($dirtyClusters, c.id)
OPTIONAL MATCH (l:RunLength {clusterId: c.id})
MATCH (m)-[:HAS_EPISODE]->(e:Episode)<-[:ABOUT]-(a:EpisodeAnswer {by: m.origin})
WHERE a.number IS NOT NULL AND a.number >= 1 AND a.numberSpace IN ['SEASON','ENTRY']
  AND (l IS NULL OR a.number <= l.value)
  AND NOT EXISTS { MATCH (e)-[:SAME_EPISODE {rule:'date'}]-() }
RETURN c.id AS cluster, a.number AS number, collect(DISTINCT e.uri) AS episodes
ORDER BY cluster, number
```

Emits `SAME_EPISODE {rule:'number'}` as a star from the lowest uri of each group with two or more
episodes. Specials and non positive numbers never collide (they are not in the query); a `POSITION`
space number (unogs) never groups by number, since a positional index is not a claim about which
episode it is (03 unogs, 01 case 18). An episode already placed by a date pair is left to that rule,
which runs first, so Crunchyroll's 13 aligned by day to anizip's 1 is not also grouped with a 13.

### 5.12 `view`: the aggregation

**Subjects**: every dirty cluster. **Reads**, four queries per cluster:

```cypher
-- 1. members and everything every origin said about them
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $cluster})
MATCH (m)<-[:ABOUT]-(a:Answer)
RETURN m.uri AS uri, m.origin AS origin, m.scope AS scope, a.kind AS kind, a.by AS by, a.score AS score, a.raw AS raw
ORDER BY uri, kind;
-- 2. containers, one hop, each expanded to its own cluster (02 findPartOfMedia)
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $cluster})
MATCH (m)-[:PART_OF]->(t:Media)-[:MEMBER_OF]->(tc:Cluster)<-[:MEMBER_OF]-(x:Media)
WHERE tc.id <> c.id
OPTIONAL MATCH (x)<-[:ABOUT]-(xa:Answer {by: x.origin})
RETURN DISTINCT tc.id AS cluster, x.uri AS uri, x.origin AS origin, json_extract(xa.raw, 'url') AS url;
-- 3. what includes this cluster and what it includes, one hop, with ranges
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $cluster})
MATCH (m)-[i:INCLUDES]-(o:Media)-[:MEMBER_OF]->(oc:Cluster)
RETURN o.uri AS other, oc.id AS otherCluster, i.by AS by, i.rule AS rule, i.fromStart AS fromStart,
       i.fromEnd AS fromEnd, i.toStart AS toStart, i.toEnd AS toEnd, i.support AS support,
       (startNode(i) = m) AS weInclude;
-- 4. the run's episodes: members' own, plus a container's inside a ranged INCLUDES
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $cluster})
MATCH (m)-[:HAS_EPISODE]->(e:Episode)<-[:ABOUT]-(a:EpisodeAnswer)
OPTIONAL MATCH (e)-[s:SAME_EPISODE]-(e2:Episode)
RETURN m.uri AS media, m.origin AS origin, e.uri AS episode, a.by AS by, a.score AS score, a.number AS number,
       a.numberSpace AS space, a.raw AS raw, collect(DISTINCT e2.uri) AS same;
```

with a fifth query for the container episodes of every ranged `INCLUDES` from query 3 (`MATCH (z:Media
{uri: $container})-[:HAS_EPISODE]->(e)<-[:ABOUT]-(a:EpisodeAnswer {by: z.origin}) WHERE a.number >=
$fromStart AND a.number <= $fromEnd`). `startNode(i)` is the direction test on an undirected match;
if it proves unavailable on 0.20.4 the query is split into its two directed halves.

**Decision rules for the media**, each POLICY, carried from 02 section 4.1 and 02 section 2.2 with the
citation, and every scalar written into `fields` with the uri, origin and document it came from (01 case
20, I5 point 1):

| field | rule |
| --- | --- |
| member order | `Answer.score` descending, then uri ascending; the second key removes the arrival order 02 section 5.3 records as "non-deterministic between loads" |
| `_id` | `Cluster.id`; a retired id resolves through `canonical` (04 section 6 contract 1) |
| `uri`, `id`, `origin`, `url` | `ag:(sorted routable member uris)`, `'ag'`, the media route (02 section 4.1; `uri-aggregated.test.ts` KEEP) |
| `scope` | CONTAINER only when every member is (02 section 2.2's cluster level inversion) |
| `kind` (NEW, view only) | `RUN`; `CONTAINER`; or `FOLD` when the cluster INCLUDES a run cluster (01 case 49's orphan is a FOLD with a rule for the listing, section 6) |
| scalars (`type`, `status`, `averageScore`, `popularity`, `startDate`, `endDate`, `isAdult`, `nextAiringEpisode`) | first non null in member order, from any answer kind of that member, page answers before search answers |
| `episodeCount` | `RunLength.value`, with `fields.episodeCount = {tier, witnesses, declared}` (02 section 4.1: "a consensus verdict rather than any source's number, with no field saying so"; now a field says so) |
| `season`, `seasonYear` | taken as a PAIR from the highest ranked member naming a season (I13) |
| `categories` | ANIME plus exactly one of MOVIE / SERIES, the first in member order |
| `genres`, `tags` | case insensitive dedupe keeping the best ranked spelling |
| `titles` | concatenated in member order, deduped on exact text; `descriptions`, `covers`, `banners` sorted, `trailers` deduped on uri |
| `relations` | deduped on relation and node uri, edges pointing at any member dropped |
| `franchise` | the first supplier's whole graph, never spliced |
| `handles` | members as SAME_AS in member order with `node.url`; query 2's rows as PART_OF; query 3's including nodes as PART_OF handles carrying the season row's url (the UI already renders PART_OF handles as origin badges with `node.url`, 04 section 2.3), never as SAME_AS |

The singleton cluster runs the same rules as a cluster of ten; the separate singleton contract 02
section 4.1 records ("skips every normalization") is deliberately dropped, and the tests that pinned the
difference are rewritten to the one path (section 9).

**Decision rules for the episode list** (02 section 2.9's four gates, I9, I10, I14):

1. Groups are the connected components over `SAME_EPISODE` among members' episodes plus container
   episodes inside a ranged `INCLUDES` (computed in JS over query 4's `same` lists; a run's episode
   graph is a few dozen nodes).
2. A group's number: a reference member's own number (a member whose count equals `RunLength`); else a
   container number mapped through its range (`number - fromStart + toStart`); else any member number
   inside `1..RunLength`; else the group is a special, kept and listed last, unnumbered (01 case 19).
   The displayed number is the group number: 1 to 12 for a split cour, never 13 to 24 (01 case 14, the
   owner's call).
3. Windowing exactly as `runEpisodes`: no length, keep everything; length backed by fewer than 2
   witnesses, keep only members' own episodes (a loan refused whole); reference origins and origins at
   or above the tier are never trimmed; anything else is kept only inside `1..length` or unnumbered.
   Trimmed rows are counted in `fields.unplaced` for the anomaly plugin rather than silently gone.
4. Each group aggregates as `aggregateEpisode` does (02 section 4.2): `_id` is `<clusterId>:e:<number>`
   or `<clusterId>:s:<lowest uri>`, scalars first non null in score order, titles deduped on text,
   `handles` every member row as SAME_AS with its OWN `mediaUri` (02 section 5.3's note on
   `aggregateEpisode` losing the link back), which is what the watch page reads for playback (04 section
   2.3: SAME_AS only). A container episode placed through a ranged `INCLUDES` is a SAME_AS episode
   handle: the media differ, the broadcast episode does not, and that is the 0 to 12 Crunchyroll sources
   of 01 case 12.

**Emits** one `View` per cluster, `hidden` computed by the listing rule of section 6. **Failure mode**:
a field's winner is still the best scored source rather than the best source for that field (01 case
44); the provenance now names it, the rule is unchanged, and per field confidence is section 11's
decision.

### 5.13 `fetch`: the first half of the trace loop

R15: a source is asked for the ids it PUBLISHES, so the unit of asking is a uri, never a source.

```cypher
MATCH (m:Media)
WHERE list_contains($registered, m.origin)
  AND NOT EXISTS { MATCH (m)<-[:ABOUT]-(a:Answer) WHERE a.by = m.origin AND a.kind IN ['media','mediaPage'] }
  AND NOT EXISTS { MATCH (:Ask {kind:'MEDIA', uri: m.uri}) }
  AND (EXISTS { MATCH (m)-[:CLAIMS]-() } OR EXISTS { MATCH (m)-[:PART_OF]-() }
       OR EXISTS { MATCH (m)-[:INCLUDES]-() } OR EXISTS { MATCH (:Ask)-[:ANSWERED]->(m) })
RETURN m.uri AS uri
```

`$registered` is every origin some extractor answers for, including `supportedUris` (03 anizip answers
for `anidb` and `mal`; `src/sources/supported.ts:27-29`). Emits `Ask {kind:'MEDIA', uri}`, one per uri per
session; the actuator decides when to spend it (section 7).

### 5.14 `anomalies`: a cluster visibly wrong about itself

01 case 46: rules that need no expected answer, evaluated over the whole graph. One query each, run at
the end of every round in dev builds and over the corpus in tests:

| rule | query | source |
| --- | --- | --- |
| `ids` | `MATCH (x:Media)-[:MEMBER_OF]->(c)<-[:MEMBER_OF]-(y:Media) WHERE x.origin = y.origin AND x.uri < y.uri AND NOT EXISTS { MATCH (x)-[:EXTENDS]-(y) } RETURN c.id, x.uri, y.uri` | 01 case 5, `disagreeingIds` |
| `over-length` | `MATCH (v:View), (l:RunLength {clusterId: v.clusterId}) WHERE json_extract(v.fields, 'listed') > l.value RETURN v.clusterId, l.value, l.witnesses` | 01 case 46, `overLength` |
| `constant-id` | `MATCH (m:Media)<-[:CLAIMS {relation:'SAME_AS'}]-(x:Media)-[:MEMBER_OF]->(c:Cluster) WITH m, count(DISTINCT c) AS n WHERE n >= 3 RETURN m.uri, n` (NEW threshold 3, 01 case 40: `hbo:watch` on 25 titles, `anidb:animedb.pl`; an id names one thing, two claimants is a contest and three is never right) | 01 case 40 |
| `duplicate-rows` | `MATCH (m:Media)-[:HAS_EPISODE]->(e:Episode)<-[:ABOUT]-(a:EpisodeAnswer {by: m.origin}) WITH m, json_extract(a.raw, 'id') AS epid, count(e) AS n WHERE n > 1 RETURN m.uri, epid, n` | 01 case 16 |
| `includes-in-cluster`, `part-of-in-cluster`, `cross-scope-join` | the three invariant queries of section 3.4 | owner's rule |
| `contested` | `MATCH (r:Refusal {rule:'ids'}) RETURN r.fromUri, r.toUri, r.detail` | 01 case 11, R7 |

Emits `Anomaly` rows; nothing reads them at runtime except the dev overlay and the export.

---

## 6. The read path

The four subscription fields and the `Media.episodes` resolver keep their signatures (04 section 2.1);
`Query` and `Mutation` stay empty. What changes is that a resolver runs one or two `SELECT` shaped
queries and returns JSON the `view` plugin already computed. No resolver aggregates, walks, aligns or
mints anything.

### 6.1 A page

```cypher
-- with the uris the fan-out collected (04 section 1.5 insertedUris): their clusters' views
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE list_contains($uris, m.uri)
MATCH (v:View {clusterId: c.id}) WHERE NOT v.hidden
RETURN DISTINCT v.clusterId AS id, v.media AS media;

-- with no uris yet: the whole store (04 section 6 contract 6, the load bearing fallback)
MATCH (v:View) WHERE NOT v.hidden RETURN v.clusterId AS id, v.media AS media;
```

Then, in JS and unchanged: `applyMediaFilters` (`filter.test.ts` KEEP; it must run after hiding, and
hiding is now a column), `searchRelevance` at `SEARCH_RELEVANCE_THRESHOLD = 0.7`, the two sorts with
their inverted names left as they are (01 open problem 19). One query, against 00's measured 49 ms for
a 60 cluster page in the join form; a `View` scan returns pre-built JSON and does less work than that.

`hidden` is written by the `view` plugin from three rules, which generalize `hideAttachedContainers`
(02 `db.ts:391`) from "a run in the same list" to "a run in the graph":

| cluster kind | on a listing | opened directly |
| --- | --- | --- |
| RUN | a card | its view |
| CONTAINER with a run PART_OF it | hidden | the earliest attached run, as `preferAttachedRun` does today (02 `db.ts:334`), until the container page is built (01 open problem 10) |
| CONTAINER with no run (a live action catalogue) | a card, today's behaviour (01 case 49) | itself |
| FOLD (it INCLUDES a run cluster) | hidden | itself: its own episodes in its own numbering, never renumbered (01 case 12: the stored node keeps Crunchyroll's numbering), plus the runs it includes as cards |

The one behaviour change: a container whose run exists but is filtered off the current page is hidden
too, where today it would be an orphan card. That is the direction 02 section 4.5 says the ordering
exists to avoid, applied globally.

### 6.2 A detail view

```cypher
-- a member uri
MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)
MATCH (v:View {clusterId: c.id}) RETURN v.media AS media, v.episodes AS episodes;

-- a cluster id, possibly retired (the urql cache's _id, 04 section 6 contract 1)
MATCH (c:Cluster {id: $id})
OPTIONAL MATCH (s:Cluster {id: c.canonical})
WITH coalesce(s.id, c.id) AS id
MATCH (v:View {clusterId: id}) RETURN v.media AS media, v.episodes AS episodes;

-- an aggregated uri: any member's cluster, a RUN preferred (02 findMediaForPage)
MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE list_contains($members, m.uri)
MATCH (v:View {clusterId: c.id})
RETURN v.media AS media, v.episodes AS episodes
ORDER BY CASE v.space WHEN 'RUN' THEN 0 ELSE 1 END, v.clusterId LIMIT 1;

-- a container: its earliest attached run (02 preferAttachedRun: earliest startDate, then key)
MATCH (c:Cluster {id: $container})<-[:MEMBER_OF]-(:Media)<-[:PART_OF]-(r:Media)-[:MEMBER_OF]->(rc:Cluster {space:'RUN'})
MATCH (v:View {clusterId: rc.id})
RETURN v.media AS media, v.episodes AS episodes
ORDER BY json_extract(v.media, 'startDate'), rc.id LIMIT 1;
```

Two queries at most. An empty result yields nothing until `views:changed` names a cluster containing
the uri (04 section 6 contract 5). `Media.episodes` returns `View.episodes` for the parent's `_id`,
one primary key lookup, against 00's 6 ms for the join form; the SAME_AS only rule of 04 section 6
contract 4 holds by construction because the view was built from members and ranged includes.

`ctx.findAggregatedMedia` for a source mid resolve (04 section 1.8) is the first query above;
`ctx.listenForMediaChanges` yields on `views:changed` when the named uri's cluster is in the event.

### 6.3 Membership is materialized, so nothing recurses

Every read above joins `MEMBER_OF` and a primary key, never a variable length path: 00 measured 1.7 ms
by a materialized cluster id against 6.8 ms recursive on a session graph and 1,033 ms on a dense one,
and the recursive form exists in exactly one place, the membership plugin's split recompute (section
5.4). A cluster id is minted when a cluster is created, at write time, by the plugin that owns it; the
read path mints nothing (02 section 2.6's `componentId` writing an alias during a read is gone, and
with it the alias table's rule that it may hold only uuids).

### 6.4 The aggregate, field by field, is POLICY and therefore a plugin

Section 5.12's two tables are the whole contract; the resolver does not know a field rule exists. The
consequence for the app: `Media` gains `fields` (per field provenance) and `kind`; `_id` is a cluster
id; `uri` is `ag:(...)` as before; `handles` carries SAME_AS members, PART_OF containers and, new,
PART_OF handles to the seasons that include the run, each with `node.url`. Every existing consumer in 04
section 2.3 reads one of those and none reads anything that moved.

### 6.5 The RUN versus CONTAINER exchange and the folded season, rendered

Netflix season 1 INCLUDES the season 1 cour and its cour 2 (section 8.1 has the rows). What each page
shows:

- **The cour's page** (`ag:(anilist:108465,anizip:14758,kitsu:42323,mal:39535,...)`): its own fields
  from its own members; origin badges for every SAME_AS member; PART_OF badges for `cr:G24H1N3MP`,
  `jw:222366`, `nf:80987039` (the show containers) and for `nf:80987039-1` and
  `cr:G24H1N3MP-G609CX3J4` (the including seasons) with their urls, so the play button on Netflix
  exists at season level. Its episode list has 11 rows numbered 1 to 11: anizip rows with dates and
  titles, plus Crunchyroll episode handles on each because the `range` plugin aligned Crunchyroll's 1
  to 11 by day; no Netflix episode handles, because no correspondence exists (01 open problem 3, and R2
  says a title join would invent one).
- **The episode list never shows 24** (I10): the view reads members' episodes and ranged container
  episodes only, and a rangeless `INCLUDES` contributes no episode.
- **The Netflix season's own page**, if a search result or a bookmark opens `nf:80987039-1`: a FOLD
  view, its 24 episodes as Netflix lists them, two cards "includes: season 1 cour 1, cour 2".
- **The show container's page** (`cr:G24H1N3MP`): the earliest attached run, exactly today's
  `preferAttachedRun`, until the owner decides the container page.

### 6.6 How the read stays a view

The request path holds a query only facade; `View` is derived, stamped `by:'plugin:view'`, rebuilt by a
round with `dirty = null`, and dropped by `reproject()`. Nothing a read does changes what the next read
sees. The resolvers' subscription loops listen to `views:changed {clusterIds, seq}`; the listing
re-reads when a listed cluster moved or when `MATCH (v:View) WHERE v.seq > $since RETURN count(v)` is
non zero (a new cluster appeared), with the 100 ms debounce of 04 section 3; the detail view re-reads
when its cluster id, or a cluster retired into it, is named.

---

## 7. The trace loop

1. **An edge appears.** anilist's row for `anilist:108465` lands with `handles: [mal:39535 SAME_AS]`
   (03 anilist). Ingest writes `Media {uri:'mal:39535', described:false}` and
   `CLAIMS anilist:108465 -> mal:39535 {by:'anilist', relation:'SAME_AS', kind:'media'}`.
2. **Its origin is fetchable, so it is fetched.** `fetch` mints `Ask {kind:'MEDIA', uri:'mal:39535'}`.
   The actuator checks interest (the claiming row's cluster is on an open `media` subscription, which is
   the scope `askUnasked` has today, 04 section 2.1; a listing never triggers a fetch, `request-context.test.ts`
   KEEP), then re-subscribes every extractor that answers for `mal` (jikan, anizip through
   `supportedUris`, offline, simkl) with the wider uri through the existing `askOrigins` mechanism
   (04 section 1.5), results discarded as today, `outcome` written on the ask.
3. **Answers land, a plugin matches.** jikan's row makes `mal:39535` described; the next round's
   `claims` converts the waiting claim to `SAME_AS {strength:'ID'}`, `vetoes` finds nothing, `membership`
   joins, `counts` recomputes, `view` rebuilds, `views:changed` names the cluster, the page re-renders.
   jikan's row carried `anidb:14758` and `anizip:14758` claims (03 jikan), so step 1 repeats for them;
   anizip answers with twelve dated episodes, which is the evidence `range` needs.
4. **More handles arrive.** kitsu's row carries `PART_OF cr:G24H1N3MP` (03 kitsu). `claims` mints
   `PART_OF`; the `similar` ask half mints `Ask {kind:'SIMILAR', origin:'cr', showId:'G24H1N3MP'}` with
   the cluster's evidence; the actuator calls Crunchyroll's `similarMedia` under the caps of 04 section
   1.6 (`MAX_SIMILAR_MEDIA_PER_CALLER = 8`, `MAX_CONCURRENT_SIMILAR_MEDIA = 32`,
   `SIMILAR_MEDIA_TIMEOUT_MS = 30_000`, `SAFE_SHOW_ID`, in flight dedupe on the normalized question).
   Crunchyroll answers `containing: cr:G24H1N3MP-G609CX3J4` (the 23 plus special season, longer than
   the 11 episode run, spanning its start). `containment` mints a rangeless `INCLUDES`; `fetch` sees a
   media with no own `media` answer and mints a `MEDIA` ask for the season; its episodes land with
   dates; `range` aligns 1 to 11 by day and mints the ranged `INCLUDES` and eleven `SAME_EPISODE` edges;
   `view` puts Crunchyroll handles on eleven rows.
5. **What is NOT followed as sameness.** The Crunchyroll season row's own answer may carry claims
   (`buildHandlesFromUri` rebroadcasts on the search path, 03 crunchyroll). They convert under the
   same rules: same scope, vetoes (`fold`: 24 against 11), membership's containment check (an
   `INCLUDES` between the two clusters refuses the join). The season's cluster is its own, and the
   rule of section 3.4 holds in every round.

**What stops it**:

- **Every ask has a key.** `MEDIA` asks are one per uri per session; `SIMILAR` asks are one per (cluster,
  origin, question hash), a changed question re-asked up to `MAX_ASKS_PER_PAIR = 4` (04 section 1.6).
  A key is consumed whether the answer was a row, a refusal or a timeout, and `outcome` says which.
- **Interest bounds fetches.** A `MEDIA` ask runs only for a uri whose cluster, or whose claiming row's
  cluster, intersects an open `media` subscription; a `mediaPage` triggers nothing beyond its own
  fan-out. This is the scope the current `askUnasked` has ("each source is asked at most twice",
  04 section 2.1), now keyed on uris rather than origins (R15).
- **The actuator's ceilings** are today's constants, unchanged: 8 per caller, 32 in flight, 30 s.
- **Rounds are idempotent.** A round with no new RAW row produces no new derived row (section 5.1's
  no op emits), so no `views:changed`, so no re-render and no re-ask. The DAG is acyclic and each plugin
  runs at most twice per round (step 9 of 5.1.2).
- **The graph is finite.** Each `MEDIA` ask consumes a uri that exists; each `SIMILAR` ask consumes one
  of four slots per (cluster, answerer) pair; the session's bound is `|Media|` plus `4 x 5 x |run
  clusters on open pages|`, and the interest rule keeps the second term to the clusters the user is
  looking at.

The cost controls that exist today are carried with their values; the one new control is the interest
rule being written down and tested rather than implied by which resolver happens to call `askUnasked`.

---

## 8. Walkthroughs

Uris and numbers are the record's (01 group B and cases 1, 9, 10, 13, 15; 03 sections 1 to 5; the
fixtures at `tests/unit/worker/store/mushoku-parts.test.ts:29-42`, `merge-fixtures.ts:341-350` and
`consensus.test.ts:93-101`). Where the record does not carry an id it says so.

### 8.1 Mushoku Tensei: five cours, three seasons, Netflix with no dates

**Rows the sources write** (RAW plus the evidence projection):

| uri | scope | count (kind) | start date (precision) | episodes | claims it makes |
| --- | --- | --- | --- | --- | --- |
| `anilist:108465` | RUN | 11 (DECLARED) | 2021-01-10 (DAY) | none | `mal:39535` SAME_AS |
| `mal:39535` | RUN | 11 (DECLARED) | 2021-01-11 (DAY, `aired.from`) | none | `anidb:14758`, `anizip:14758` SAME_AS |
| `kitsu:42323` | RUN | 11 (LIST) | 2021-01-10 (DAY) | 11, numbered, no dates | `anilist:108465`, `mal:39535` SAME_AS; `cr:G24H1N3MP` PART_OF |
| `anizip:14758` | RUN | 11 (DECLARED), no score | none at media level | 11, ENTRY 1..11, INSTANT dates weekly from 2021-01-10T15:00Z | `mal:39535`, `anilist:108465` SAME_AS |
| `anilist:127720`, `kitsu:43907` (+ their mal and anizip rows, ids not in the record) | RUN | 12 | 2021-10-03 (DAY) | anizip: 12 dated | as above |
| `anilist:146065`, `kitsu:45950`, `anizip:17236` | RUN | 12 | 2023-07-09 (DAY) | anizip: 12 dated | kitsu: `cr:G24H1N3MP` PART_OF |
| `anilist:166873`, `kitsu:47694`, `anizip:18104` | RUN | 12 | 2024-04-07 (DAY) | anizip: ENTRY 1..12 (upstream numbers 13..24, 01 case 14) | kitsu: `cr:G24H1N3MP` PART_OF |
| `anilist:178789`, `mal:59193`, `kitsu:49002`, `offline:mal-59193` | RUN | 14 | 2026-07-03 (DAY) | | kitsu: `cr:G24H1N3MP` PART_OF |
| `cr:G24H1N3MP` | CONTAINER (cr's own `scopeOf`) | none | 2021-01-01 (YEAR sentinel) | none | none |
| `cr:G24H1N3MP-G609CX3J4` | RUN (stamped) | 24 (LIST, 23 plus a special) | 2021-01-11 (DAY) | 24, SEASON 1..24, DAY dates | `answer` claims on the search path |
| `cr:G24H1N3MP-GS00374452` | RUN (stamped) | 14 (LIST) | 2026-07-03 (DAY) | 14 dated | |
| `nf:80987039` | CONTAINER (`titleScope`) | none | 2021-01-01 (YEAR) | none | |
| `nf:80987039-1`, `-2`, `-3` | RUN (stamped) | 24, 25, 12 (LIST) | none | POSITION numbered, titles (season 1 all placeholders, 01 case 21) | |
| `jw:222366` | CONTAINER (`showAsContainer`) | | 2021-01-01 (YEAR) | | offers as PART_OF handles to `nf:80987039`, `cr` refused |
| `jw:222366-230388` and two sibling season rows | RUN | 23, 24, 14 (DECLARED) | YEAR per season | titles, up to 50 | `partOf(jw:222366)` |

**What each plugin mints**:

| plugin | edges |
| --- | --- |
| `claims` | `SAME_AS {ID}` inside each cour's id set (anilist to mal, anizip to both, kitsu to both, offline to all three: 03 section 5 "minted four ways"); `PART_OF {claim}` from `kitsu:45950`, `kitsu:47694`, `kitsu:49002` to `cr:G24H1N3MP`; `PART_OF` from every jw season row to `jw:222366`; `PART_OF` from the cour clusters to `nf:80987039` through JustWatch's offer handles |
| `id-shape` | `EXTENDS` from both cr seasons to `cr:G24H1N3MP`, from `nf:80987039-1..3` to `nf:80987039`, from the jw seasons to `jw:222366` |
| `title-match` | exact share of `mushoku tensei jobless reincarnation` in the 2021 bucket: cour 1 cluster against `cr:G24H1N3MP-G609CX3J4` proposes `SAME_AS {TITLE, exact}`; cour 1 against cour 2 is refused at gate 3 (2021-01-10 against 2021-10-03, 266 days, `START_DATE_WINDOW_DAYS = 45`), the exact case `mushoku-parts.test.ts` pins; RUN clusters against the CONTAINER rows `cr:G24H1N3MP`, `nf:80987039`, `jw:222366` produce `PART_OF {title}`; the three containers share a title and a YEAR bucket in the CONTAINER space and join into one container cluster |
| `vetoes` | `VETO {fold}` between `cr:G24H1N3MP-G609CX3J4` and every member of cour 1 (24 against `RunLength` 11) and of cour 2 (24 against 12); the same for `nf:80987039-1` should any proposal name it; `VETO {includes}` once the `INCLUDES` edges below exist |
| `membership` | five RUN clusters, one CONTAINER cluster; the `SAME_AS {TITLE}` to the cr season is skipped (vetoed) and recorded; ids stable |
| `counts` | `RunLength` 11 (tier 0.9, witnesses 5, declared 4), 12, 12, 12, 14 |
| `similar` (ask) | one `SIMILAR` ask per (cour cluster, `cr`), per (cluster, `nf`), per (cluster, `jw`) |
| the answerers | Crunchyroll: rule 1 finds the season premiering within 45 days but `foldVetoed` (24 > 11), so it answers `containing: cr:G24H1N3MP-G609CX3J4`, whose episode span (January to December 2021, from its own episode dates) covers both cour starts; unogs: season 1 offers no real titles, so nothing for cour 1; for the season 2 cours, the four exact matches R2 measured out of 25 clear `MIN_EPISODE_TITLE_MATCHES = 3` at coverage 0.16 and 25 > 12, so `containing: nf:80987039-2`; JustWatch: `containing: jw:222366-230388` on the same title rule at coverage 11/23 |
| `containment` | rangeless `INCLUDES {containing}` from `cr:G24H1N3MP-G609CX3J4` to `anilist:108465` and to `anilist:127720`; from `nf:80987039-2` to `anilist:146065` and to `anilist:166873`; from the jw season to the cour 1 and cour 2 link uris |
| `fetch` | `MEDIA` asks for the two cr season rows and the nf and jw season rows (no own `media` answer yet); the cr episodes land with dates, the nf ones without |
| `range` | `date`: reference `anizip:14758` (count 11 = length 11), cr rows 1..11 on the same UTC days plus or minus one, offset 0 eleven times: `INCLUDES {date, 1..11 -> 1..11, support 11}` and eleven `SAME_EPISODE`; cour 2: cr rows 12..23 against its anizip, offset 11 twelve times: `INCLUDES {date, 12..23 -> 1..12, support 12}`; the special (row 24) matches no day. `nf:80987039-2`: no dates on either side, stays rangeless; `count-sum` (if on): 24 is not 11 + 12, 25 is not 12 + 12, refused and recorded |
| `episode-number` | kitsu's 1..11 grouped with anizip's 1..11 |
| `view` | five run views, one container view, three FOLD views (`hidden`) |

**The queries the page runs**: the aggregated uri query of 6.2 (one), then `View.episodes` (one).

**What the user sees** on cour 1: title, cover and description from mal and anilist with `fields`
naming them; `episodeCount` 11; badges for anilist, mal, kitsu, anizip, offline (SAME_AS); badges for
Crunchyroll (the show and the season, both with urls), Netflix (`nf:80987039`, the title url) and
JustWatch (PART_OF); eleven episode rows numbered 1 to 11, each with an anizip title, an air date, and a
Crunchyroll play handle; no Netflix per episode handle. On the season 2 part 2 page (`anizip:18104`):
twelve rows numbered 1 to 12, not 13 to 24 (01 case 14), Crunchyroll handles on all twelve through the
ranged include, a Netflix season 2 badge and nothing per episode. Never 24 rows anywhere (I10).

### 8.2 The Elusive Samurai: a source that continues the count

**Rows** (01 case 13, `consensus.test.ts:284-288`): `anizip:18903` (no score, 12 DECLARED, ENTRY 1..12,
dates weekly from 2026-07-17), `mal:60059` (0.9, 12, no episodes), `anilist:182616` (0.8, 12),
`kitsu:49265` (0.3, 12, numbered, no dates), `cr:GQWH0M19X-GS00366034` (0.5, 8 LIST, SEASON 13..20 on
the first eight of the same days).

| plugin | result |
| --- | --- |
| `claims`, `membership` | one RUN cluster of five (the cr row is SAME_AS through AniList's Crunchyroll mapping, 03 anilist, `SIMILAR` strength) |
| `vetoes` | `fold`: 8 is not more than 12; `split`: 8 < 12 but no answer says `FINISHED`, so no veto (the status gate exists for this row) |
| `counts` | `RunLength` 12, tier 0.9, witnesses 4 |
| `range` among members | reference `anizip:18903`; cr's eight dated rows match eight reference days, offset 12 eight times: eight `SAME_EPISODE {date, support 8}`; no `INCLUDES`, since both are members |
| `episode-number` | kitsu 1..12 with anizip 1..12; cr rows skipped, already date placed |
| `view` | twelve rows, numbered 1 to 12; rows 1 to 8 carry Crunchyroll handles; `unplaced` 0 |

Without anizip in the cluster (no reference with dates), cr's 13..20 are unplaced: outside `1..12`,
from a 0.5 origin below the 0.9 tier, so trimmed, `fields.unplaced = 8`, and the page shows twelve rows
with no Crunchyroll, which is 01 case 13's recorded cost, now counted instead of silent.

### 8.3 Blue Exorcist: the special that broke the offset vote

**Rows** (01 case 15, R1): the 2011 run (its catalogue ids are not in the record; `RunLength` 25 from
its catalogues, `FINISHED`), `nf:70304252-1` (26 LIST rows, POSITION 1..26, position 14 is epid
`80005451` "Runaway Kuro", a special aired after the run).

| plugin | result |
| --- | --- |
| the answerer (unogs) | 23 exact title matches out of 26 (12 at offset 0, 11 at offset 1), count 26 > 25: `foldVetoed` refuses `media`, and the season qualifies as `containing` (at least 3 matches, longer than the run) |
| `containment` | rangeless `INCLUDES nf:70304252-1 -> run {containing}` |
| `range` | `date`: Netflix has no dates, nothing; `count-sum`: 26 is not 25, refused and recorded; no title rule exists |
| `view` | 25 rows from the catalogue sources; a Netflix badge at season level with the season url; zero per episode Netflix handles |

R1's outcome was 13 rows carrying the wrong playable url; today's outcome is nothing. This design's
outcome is a correct season level link and no per episode guess, and the `Refusal` row says why.

### 8.4 Fullmetal Alchemist: 64 episodes in five Netflix seasons

**Rows** (01 case 10; `mal:5114` is in the record at case 40): the run cluster (`mal:5114`, its anilist,
kitsu and anizip rows; `RunLength` 64, `FINISHED`, DAY start, anizip episodes dated), `nf:<title>`
(CONTAINER, through JustWatch's offer) and its five season rows, about 13 each, POSITION numbered, no
dates. The seasons reach the graph through one schema addition this case needs: a source may assert
`INCLUDES` from a show row to its own season rows (section 3.1's source vocabulary gains it, section 11
lists it), so unogs's `media` answer for the bare title is the show as CONTAINER with five INCLUDES
handles instead of nothing.

| plugin | result |
| --- | --- |
| `claims` | `INCLUDES {claim}` from `nf:<title>` to each season, accepted because both ends are `nf` and `EXTENDS` holds (a source may assert containment only inside its own id space, NEW, 01 case 17) |
| `vetoes` | `split` between each season and the run: 13 < 64 and the run is `FINISHED`, so any SAME_AS proposal (the year rule that welded BAKI) is objected to |
| `containment` | rule B needs a longer season, none; the split has no date evidence |
| `range`, `count-sum` OFF (default) | nothing; the page shows the Netflix show badge (PART_OF) and 64 rows from anizip with no Netflix handles |
| `range`, `count-sum` ON | 13 + 13 + 13 + 13 + 12 = 64 exact, seasons ordered by Netflix's own ordinal inside its own id space: five `INCLUDES run -> season {count-sum}` with ranges `1..13 -> 1..13`, `14..26 -> 1..13`, and so on; the view places Netflix handles on all 64 rows by position; a duplicate row (01 case 16) breaks the sum and refuses the lot |

### 8.5 Kitsu's Crunchyroll series url: a show level id that must never weld

**Rows** (01 case 1): `kitsu:45950`, `kitsu:47694`, `kitsu:49002` each carrying
`https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation`; `cr:G24H1N3MP`
described by Crunchyroll's own search or show answer with `scope: CONTAINER`.

| step | what happens |
| --- | --- |
| ingest | three `CLAIMS {relation:'PART_OF', by:'kitsu'}` (the shipped allowlist, `kitsu/stream-id.ts`, 03 kitsu); `Media.scope` of `cr:G24H1N3MP` is CONTAINER by cr's own stamp and stays so (the ratchet) |
| `claims` | RUN x CONTAINER: `PART_OF` from each kitsu row to the show, whatever was claimed. Had kitsu claimed SAME_AS (the pre-fix behaviour), the same row of the table applies |
| arrival order | a stale bookmark rebroadcasting `cr:G24H1N3MP` before Crunchyroll's own answer lands is an undescribed placeholder: the claim waits, and when the CONTAINER answer lands it converts as PART_OF (01 case 48) |
| `membership` | the three kitsu ids can never share a cluster: `kitsu:45950`, `kitsu:47694`, `kitsu:49002` are three ids of one origin with no `EXTENDS` between them, so any join that would put two of them together is refused with `Refusal {rule:'ids'}` and reported by `anomalies`, whatever path proposed it |
| invariant | `MATCH (a)-[:JOINS]-(b) WHERE a.scope <> b.scope` returns 0: a container is never in a run's cluster |
| the films | fifteen kitsu films sharing `cr:GQWH0M1GG` (01 case 41) each `PART_OF` the collection; `RunLength` 1 (FILM) on each film cluster; containment rule B can at most mint a rangeless `INCLUDES` from a collection season to a film, which renders as a Crunchyroll badge pointing at the collection page, which is what the link says; no film ever joins another film |

**What the user sees** on `kitsu:45950`'s page: the season 2 cour's own fields, a Crunchyroll badge
for the show with the series url, and, once the `SIMILAR` ask has been answered, a Crunchyroll season
badge and per episode handles through the ranged include. Three pages, three clusters, one shared
container, as the A/B in 01 case 1 measured (14 rows and no bare `cr:` in the cluster).

---

## 9. What is kept, what goes

### 9.1 Kept unchanged

The yoga server per source with its urql client, the app facing yoga, the osra surface, the
`useOnResolve` trigger, the fan-out and its discarded payloads, the three DataLoaders, the four
subscription fields and `Media.episodes` with their signatures, `MediaFragment` and `EpisodeFragment`,
the urql keys, the `ag:(...)` uri grammar, remote plugin registration and both enforcement points
(04 section 4), pickers and players, the `similarMedia` answerers with `pickSimilarSeason` and its five
rules, `catalogue-gate.ts`, every extractor. Schema additions, all backward compatible: `similarMedia`
gains `containing`; `MediaHandleRelation` gains `INCLUDES`; `Media` gains optional
`startDatePrecision`, `startDateDerivation`, `episodeCountKind`; `MediaTitle` gains optional `class`;
the aggregated `Media` gains `fields` and `kind`.

### 9.2 Every store export of 02 section 1, and what replaces it

| export (02 section 1) | replaced by |
| --- | --- |
| `types.ts` enums (`mediaTypeEnum`, `mediaSeasonEnum`, `mediaStatusEnum`, `mediaCategoryEnum`, `mediaScopeEnum`, `mediaRelationEnum`) | kept verbatim in `src/graph/types.ts` (they are the schema's; `offline/seed.test.ts` stays KEEP) |
| `handleRelationEnum` | kept, plus `INCLUDES` |
| `Relation`, `FranchiseNode`, `FranchiseEdge`, `Franchise`, `Title`, `Description`, `Cover`, ... | kept as the GraphQL row shapes; they live inside `Answer.raw` |
| `Media`, `Episode` (the store row types) | gone: the stored row IS the GraphQL row, in `Answer.raw` and `EpisodeAnswer.raw` |
| `Origin` | the `Origin` table |
| `createUnionFind` | gone: `membership` plugin, `JOINS` and `MEMBER_OF` |
| `createGraph` and every method (`set`, `registerLabel`, `setLabel`, `labeled`, `get`, `has`, `alias`, `resolve`, `link`, `connect`, `neighbours`, `root`, `componentId`, `edge`, `targets`, `sources`, `cluster`, `clusters`, `clear`) | gone: LadybugDB through `src/graph/engine.ts`; `componentId` by `Cluster.id` and `canonical`; `clear` by `graph.reset()` in tests |
| `lastWriteLongestArray` | gone as a write policy; its two rules (an incoming empty array never beats a filled one, an incoming null never erases) are restated in the `view` plugin's array and scalar rules and pinned there |
| `HAS_EPISODE_LABEL`, `IDENTITY_LABELS`, `ASSERTED_LABELS` | the `HAS_EPISODE` table, `Cluster.space`, the `CLAIMS` table |
| `graph` (the singleton) | the engine connection, held by ingest, the applier and the read facade only |
| `upsertMedia` | `ingest.mediaBatch` (section 4.3) plus the `claims` plugin |
| `linkSameMediaPairs`, `linkSameContainerPairs`, `linkPartOfPairs` | `title-match` emits and `membership` decides; the scope refusals are the claims table and the join time checks |
| `findAggregatedMedia`, `findMediaForPage`, `preferAttachedRun`, `findRunsOfContainer` | the detail queries of 6.2 |
| `findPartOfMedia` | the `view` plugin's query 2 |
| `findAllAggregatedMedia`, `hideAttachedContainers` | the page query of 6.1 and `View.hidden` |
| `upsertEpisodes` | `ingest.episodeBatch` |
| `findRunEpisodes`, `findAggregatedEpisodesForMedia`, `mergeByEpisodeNumber` | the `view` plugin's episode list, `episode-number` and `range` |
| `resetStore` | `graph.reset()`: drop and recreate the tables, tests only |
| `upsertOrigins`, `findOrigin`, `findOrigins` | the `Origin` table and two queries; the `every` filter behaviour kept as is |
| `removeDuplicatesByField`, `sameAsHandleUris`, `recursivelyUnwrapMediaHandles` | `view` internals; the SAME_AS only guarantee is the view's query 4 plus the section 3.4 invariants; `splitAnswers` |
| `aggregateMedia`, `aggregateEpisode` | the `view` plugin, one path for singletons and clusters |
| `tieredConsensus`, `runLength` | the `counts` plugin, same function over query rows |
| `alignmentOffset`, `alignRunEpisodes` | the `range` plugin, same function producing edges instead of copies |
| `runEpisodes` | the `view` plugin's windowing, same function |
| `clusterAnomalies`, `Anomaly` | the `anomalies` plugin, now a runtime signal |
| `normalizeToStoreMedia` | gone: raw is kept as returned; the projection of section 2.3 replaces the mapping |
| `MediaPageFilters`, `applyMediaFilters` | kept verbatim, moved to `src/graph/read/filter.ts` |
| `exportStore`, `StoreExport`, `ExportedCluster`, `ExportOptions` | same envelope, walked over `CLAIMS` of kinds other than `answer` (01 case 47: the seed can no longer ratify itself through a rebroadcast) |
| `emit`, `listen`, `listenIterator`, `listenMultipleIterator`, `debouncedListenIterator` | kept; the event names become `graph:changed`, `views:changed`, `origin:changed` and the payloads carry ids |
| `profileCluster`, `fuzzyMergeMediaClusters` and every constant in `fuzzy-merge.ts` | the `title-match` plugin: the profile is a query, the constants are carried unchanged |

### 9.3 The 74 tests, by 04's verdicts

**Carried verbatim (55)**: every `tests/unit/sources/` file marked KEEP (42), the four router files,
and in `tests/unit/worker/`: `backoff`, `plugin-sources`, `request-context`, `similar-document`,
`store/consensus` (the pure functions move with their names), `store/filter`, `store/merge-fixtures`
(the 14 real payload cases keep their `together` / `apart` answers; only the harness is rewired to seed
the graph and run a round), `store/mushoku-parts` (a corpus case), `store/season-separation` (its four
mechanisms and the pinned KNOWN GAP), `store/season-weld`. The adjacent tests 04 section 5.5 names
(`urql-keys`, `uri`, `uri-aggregated`, the UI side) are untouched.

**Rewritten (18)**, each to the contract it was pinning:

| test | becomes |
| --- | --- |
| `similar-consumer` | `plugins/similar.test.ts`: the ask half over a seeded graph (one ask per pair, evidence from members only, the cap of 4, the question hash) and the judge half (the three refusals) |
| `store/aggregate-fields` | `plugins/view.test.ts`: season pair quoted, genres and tags carried, tiered `episodeCount` with its `fields` entry, one path for singletons |
| `store/arrival-order` | `graph/ingest.test.ts` plus `plugins/claims.test.ts`: a claim to an undescribed row waits and converts as an edge when the CONTAINER answer lands; a placeholder is an answer with no evidence |
| `store/container-page` | `read/detail.test.ts`: a container resolves to its earliest run; a mixed aggregated uri prefers the run |
| `store/container-scope` | `plugins/claims.test.ts`: the derivation table row by row; `plugins/membership.test.ts`: no join across scopes |
| `store/db` | `plugins/claims.test.ts`: an imdb id is CONTAINER and never a run's join; an ordinary id still joins |
| `store/edge-idempotence` | `graph/ingest.test.ts`: an unchanged hash bumps no seq and emits nothing; `graph/applier.test.ts`: a re-emitted row is a no op |
| `store/episode-merge` (the impure half) | `plugins/episode-number.test.ts`: one list from two sources, specials never collide, only inside one cluster |
| `store/export` | `graph/export.test.ts`: walks `CLAIMS`, never `JOINS`; exclude versus pass through; `answer` kind excluded |
| `store/fuzzy-merge` | `plugins/title-match.test.ts`: the 21 cases are the spec, including order independence |
| `store/graph` | DROPPED, except the `lastWriteLongestArray` rule, pinned in `plugins/view.test.ts` |
| `store/normalize` | `graph/projection.test.ts`: precision from shape, `dayNumber`, `norm`, `hasLetter`, the language map, the count kind and number space tables |
| `store/part-of-subtree` | `graph/ingest.test.ts`: `splitAnswers` stops at a PART_OF node and caps depth at 4 |
| `store/part-of` | `plugins/view.test.ts`: a PART_OF handle carries its url; episodes come from members and ranged includes only |
| `store/stable-id` | `plugins/membership.test.ts`: the id survives growth from either side, a retired id resolves through `canonical`, run and container ids differ, media and episode ids never collide |
| `offline/seed-source` | drives rows through `ingest` and reads `View`: a live row beats a seed row in both arrival orders |
| `offline/seed-build` | KEEP: the export envelope is unchanged |
| `offline/seed` | KEEP: the enums stay |

### 9.4 The new test surface

- **Core** (`tests/unit/graph/`): the DDL loads on the real engine (00: 188 ms init, so the suite runs
  it); every projection rule of section 2.3; replace within key and keep across keys; the hash test;
  the ratchet; `described`; `CLAIMS` newness; the digest.
- **A plugin in isolation** (`tests/unit/graph/plugins/<name>.test.ts`): a `seed({ media, answers,
  claims, episodes, derived })` DSL writes a small graph, including derived rows of the plugin's
  `consumes` tables and nothing else; `run(plugin, { dirty: null })` applies its output; the assertions
  are queries. After every run the harness asserts the digest and that every produced row carries the
  plugin's `by`. Each test carries a mutation arm that removes the rule and must go red.
- **The corpus** (`tests/fixtures/corpus/`): `merge-fixtures.ts`'s 14 real payloads, the 100 cluster
  `dist-seed` snapshot, and the five walkthroughs of section 8 as fixtures with the expected `SAME_AS`,
  `PART_OF`, `INCLUDES`, `SAME_EPISODE` edges and the expected `Refusal` rows. A full round runner
  asserts the three invariant queries return 0 and the anomaly sweep is empty except the pinned known
  gaps.
- **Exchange rates**: the measurement scripts (`scripts/measure-*.probe.ts`) are rewired to seed the
  graph and run the relevant plugin, so the arms of 02 section 2.10 (83 refused for 81 lost at 45
  days; 49 of 84 with 2 lost for the companion pair; the refused silence rule) can be re-run against the
  new code before any threshold moves.

### 9.5 The fifteen invariants

| invariant | fate |
| --- | --- |
| I1 irreversibility | dropped as a constraint: nothing unions, `JOINS` and `MEMBER_OF` are retractable and the split recompute exists; the governing rule generalizes to "everything is an edge" |
| I2 exchange rate | survives: every rule refuses on absent evidence and the measured costs of refusing are carried (R4, R8, 01 case 33 through precision) |
| I3 scope ratchet | survives in `Media.scope`, with the per answer stamp kept beside it |
| I4 reproducible ids | survives: only source minted ids become `Media` nodes; plugins mint cluster uuids, never a uri |
| I5 provenance | closed: `fields`, `by` and `evidence` on every edge, answers kept per document kind, tiers not sums |
| I6 folded cours | survives: the fold veto, rangeless `INCLUDES`, the loan through a ranged include; the inverse direction gains the `split` veto (NEW) and the `count-sum` rule (NEW, off) |
| I7 retranslated titles | survives: no title ever places an episode |
| I8 diacritic gate | survives: the fold is a variant rule, off until measured |
| I9 13 against 12 | survives: the two witness bar on every loan, members never hidden, the tier rule with a `DECLARED` tiebreak (NEW) |
| I10 24 against 2 x 12 | survives: the view reads members' episodes and ranged includes only |
| I11 the tier rule | survives verbatim; trimming needs two witnesses and a strictly lower tier |
| I12 main titles only | survives structurally: `HAS_TITLE.class`, identity queries filter `MAIN` |
| I13 the season pair | survives in the view rule |
| I14 grouping by number inside one cluster | survives by the query's `MEMBER_OF` scope |
| I15 determinism | survives: `ORDER BY` on every scan, size then id survival, no arrival order read anywhere, `collect` results sorted in JS |

---

## 10. Migration

Every step leaves the app running because reads are flag gated and the shadow writes never touch the
old store.

1. **One day.** `src/graph/engine.ts` (`lbug.setWorkerPath`, the DDL of 2.1, `query`), and the ingest of
   section 4 in SHADOW: `useOnResolve` writes RAW and EVIDENCE rows beside the old store, which keeps
   serving every read. `?export=graph` prints the digest. Behind a flag, ON in dev, OFF in production
   (the 22 MB engine and its 188 ms init cost nothing while off). Test: the core suite of 9.4 and a rig
   smoke test that opens the Mushoku page and counts answers.
2. `claims`, `id-shape`, `vetoes`, `membership`, `counts` in shadow, plus a dev overlay that compares
   the old store's clusters with `MEMBER_OF` per uri on the corpus and on the live site; disagreements
   land as `Anomaly` rows. The rewritten tests for those plugins land with them.
3. `view` and the read path of section 6 behind the flag: `mediaPage`, `media` and `Media.episodes`
   read `View` when it is on. A/B on the rig with `scripts/reproduce-season-weld.mjs`'s arms.
4. `title-match`, `similar` (both halves), `fetch`, and the actuator replacing `askUnasked` and
   `resolveSimilarRuns` under the flag. The `containing` field ships to the answerers one at a time,
   Crunchyroll first (it already has the lend).
5. `containment`, `range`, `episode-number`, verified live on the Mushoku pages against 01 case 12's
   measurement (0 to 12 Crunchyroll sources on each part two).
6. Flip the flag in production. Delete `src/worker/store/` except `filter.ts` and the event
   utilities; land the DROP and the remaining REWRITEs; the export walks `CLAIMS`; the seed build reads
   it.
7. The source side changes that unlock evidence, each its own commit and measurable alone: the four
   extractors that fetch and drop episode air dates emit them (03: tvmaze, trakt, simkl, tvdb);
   `INCLUDES` handles from unogs; declared precision and derivation on dates; `episodeCountKind`;
   anizip's media score, if the owner says so.

---

## 11. Risks, and the decisions only the owner can make

**Risks**

1. **Round latency.** About forty statements per round at the 1 to 2 ms per call floor (00) plus the
   100 ms debounce means a first paint waits on a round where today it waits on a re-read. Mitigation:
   the page reads `View` rows that already exist; measured on a synthetic graph only, so step 3 of the
   migration measures it on the rig before the flag flips.
2. **Two dialect assumptions unverified on 0.20.4**: relationship `MERGE ... ON CREATE SET` and
   `startNode()`. Both have the exercised fallback written next to them (`NOT EXISTS` plus `CREATE`; two
   directed halves).
3. **Memory.** Three to five answers per uri with raw JSON, evidence rows per answer, on a 6,000 media
   session; unmeasured, expected in the tens of megabytes, bounded by the hash dedupe.
4. **Two NEW rules without a cost arm**: the `split` veto and `count-sum`. Both default to the safer
   side (the veto on, since it only refuses; the ranges off, since they place rows), and the corpus
   scripts give them an arm before either moves.
5. **`containing` on three exact episode titles** for unogs and JustWatch is a new use of a measured
   constant; the 33 show Netflix set in `scripts/measure-unogs-season-match.mjs` is the arm.
6. **Global `hidden`** hides a container whose run is filtered off the page where today it shows as an
   orphan; a behaviour change, small, listed so it is not discovered.
7. **The one round lag** between a new `INCLUDES` and the `includes` veto is closed by membership's
   join time check, which is exactly the kind of guard that must be proven by its mutation arm.
8. **The seven `waitForMedia` callers** (04 section 1.8) are woken by `views:changed` instead of every
   batch; 04 section 3 warns this must be checked, and step 3 keeps them on the old wake until it is.

**Decisions for the owner**

1. anizip's media row score (01 open problem 8): with none, its exact counts never win a tier.
2. A uri derived handle as an `ANSWER` strength assertion guarded like a guess (this design) or as a
   pure pointer that only makes the target fetchable (01 open problem 2).
3. Turn `count-sum` on, after the Crunchyroll validation arm, so a closed sum places Netflix rows.
4. Keep the `split` veto on by default, or measure first.
5. The `diacritic-fold` variant (I8): on after its arm, or off.
6. The schema additions of 9.1, in particular `similarMedia.containing` and `INCLUDES` in
   `MediaHandleRelation`, which change what a source may say.
7. The container page and the FOLD page (01 open problem 10): this design renders a FOLD as itself
   and a show as its earliest run.
8. Whether ID strength claims should face the four soft gates (this design: structural vetoes only,
   at R8's and 01 case 36's prices).
9. Whether merge plugins are first party only (this design) or a third party surface, in which case the
   facade of 5.1 becomes a hard boundary between the product and third party code and needs its own
   measurement.
10. `Media.scope` as the one derived column the core keeps, or as a plugin verdict, which would also be
    the home of instance level scope for the 0.3% of `mal` ids that are containers (01 case 43).
