# The catalogue of edge cases the new representation must handle

Sources for every claim below, in order of authority:

- `R` = `/home/banou/dev/agent/projects/stub.md`, the dated measured record. Cited as
  `R "<section heading>" (date)`.
- `D` = the docs site under `/home/banou/dev/stub/docs/src/content/docs/`. Cited by page.
- Code citations are `file:line` relative to `/home/banou/dev/stub/`, and where a line number came
  from the record or the docs rather than from a grep run today, it is marked as such.

Anything I could not confirm from those files is marked **(unconfirmed)** rather than stated.

---

## Part 1. The numbered catalogue

Grouped. Group A is the root mismatch, B is what catalogues do to a broadcast, C is episodes, D is
titles, E is dates, F is id spaces, G is source and store mechanics that shape the representation.

---

### Group A. A run is not a show

The single fact the whole design rests on: `R "Two identity spaces: a run and a show are different
kinds of thing" (2026-09-05)` and `D start/run-and-show.md`. Stub's unit is a RUN (one cour, one
film). Almost every catalogue upstream models a SHOW and hands back one id for the whole of it.
`MediaScope` has exactly two values, `RUN` and `CONTAINER` (`src/worker/resolvers/media/schema.gql`,
cited by `D start/run-and-show.md`).

---

#### 1. A show-level streaming link published on every season record

**Sources**: Kitsu (publisher), Crunchyroll (subject), plus AniList/MAL/Kitsu as the run rows.

**Concrete**: Kitsu's `/anime/<id>/streaming-links` returns the identical
`https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation` on `kitsu:45950`
(season 2), `kitsu:47694` (season 2 part 2) AND `kitsu:49002` (season 3). Season 1 escaped only by
luck: its link is an older slug-only url `streamContentId` already declined.
`R "Kitsu welded three Mushoku Tensei seasons with one streaming link" (2026-08-31)`.
Fifteen kitsu film records share `cr:GQWH0M1GG`; four Demon Slayer films share `cr:GY5P48XEY`; six One
Piece films share `cr:G5PHNMWX9` (`R "The subtype could not see the shape" (2026-09-04)`).

**Had / lacked**: Kitsu HAD a per-run record, a subtype, an episode count, titles in many scripts,
mal and anilist mappings via `include=mappings`, and a streaming url. It LACKED any season-scoped
streaming id: "Kitsu links no season-scoped url, so for a series there is no honest id to mint"
(`R`, same section).

**Current code**: `src/sources/kitsu/stream-id.ts` `streamLinkIsIdentifying(subtype)` plus
`mintableAsFilmHandle(pointer)`, an ALLOWLIST of (origin, path segment) pairs measured to carry a
per-title id, today only `nf:title` and `nf:watch`. Everything else is carried as `partOf(...)`
(`src/sources/kitsu/extractor.ts:83-89`, quoted in `D start/run-and-show.md`).

**Outcome**: SHIPPED and works. A/B on one rig, same machine, only the code differing: HEAD gave 24
rows with a bare `cr:` in the cluster; fixed gave 14 rows and no bare `cr:`
(`R "Kitsu welded three Mushoku Tensei seasons..."`).

**Must express**: a link a source holds about a CONTAINER, carried with its url and no identity
claim, separable from a claim of sameness, and deletable later.

---

#### 2. The same handle bypasses every merge veto, because it is an id and not a title

**Sources**: Apple TV (the case), all of `fuzzy-merge.ts` (the vetoes that did not fire).

**Concrete**: Apple TV mints `id: content.id`, the show's id with no season component, while JustWatch
has `jwId(objectId, seasonObjectId)` and Crunchyroll has `crunchyrollId(seriesId, seasonId)`.
"Verified against the real store: two Mushoku Tensei clusters three years apart came back as one
component" (`R "A show-level catalogue id welds every season together, with no veto in the way"
(2026-08-29, e7bad56)`).

**Had / lacked**: Apple TV HAD a season list with a per-season `releaseDate` (better than the
show-level one for 66 of 150 seasons) and an episode list. It LACKED a season-scoped id, and its
`getMedia` flattened episodes across every season.

**Current code**: Apple TV's catalogue gate was REVERTED. `src/sources/appletv/extractor.ts:102`
demotes instead of refusing: `const scope = scoped || content.type === 'Movie' ? 'RUN' : 'CONTAINER'`
(cited in `D sources/season-ids.md`).

**Outcome**: half works. The weld is closed by the scope demotion; the gate that would let Apple TV
contribute is not wired. Two reusable facts from that section: "It is a HANDLE link, so not one of the
merge vetoes is consulted" and "`SHOW_LEVEL_ORIGINS` does not cover it", because `db.ts` tests
`SHOW_LEVEL_ORIGINS.has(originOf(handleUri))`, the handle side only, and Apple TV emits ITSELF as the
mediaUri.

**Must express**: identity claims and similarity guesses must travel the SAME evaluation path, so a
guard written once applies to both; and a guard must be reachable from the direction the claim
actually arrives in.

---

#### 3. A SHOW's date stamped on a SEASON row, which welds through the year bucket

**Sources**: TVmaze, TMDB (the offenders), AniList (the correct rows), Bungou Stray Dogs (the case).

**Concrete**: both minted a SEASON-scoped id while setting `startDate` from the SHOW: tvmaze from
`show.premiered`, tmdb from the one year its HTML scrape sees. Reproduced against the real store:

```
season 3 cluster years        -> 2016, 2019
with the show-level date      -> anilist:301 anilist:302 tvmaze:556-s3   (welded)
with the season-level date    -> anilist:401                             (separate)
```

`R "A source stamping the SHOW's date on a SEASON welds seasons, and no merge rule catches it"
(2026-08-29, 912227f)`.

**Had / lacked**: TVmaze HAD embedded episodes with per-episode `airdate`, so the season's own
premiere is derivable at no extra request. TMDB HAD only one year for the whole series from its HTML
scrape, so a season-scoped tmdb media now asserts NO date.

**Current code**: fixed per source; `profileCluster` still builds its `years` set from EVERY member's
`startDate` and `fuzzyMergeMediaClusters` buckets by year (`src/worker/store/fuzzy-merge.ts`, `yearOf`
at `:138`). Pinned by two tests in `tests/unit/worker/store/season-separation.test.ts`.

**Outcome**: SHIPPED and works, for those two sources. The general rule stated in the record: "a
source that models a SHOW where stub models a SEASON must get BOTH halves right, the id and the date.
Getting the id right and the date wrong still welds, just through a different mechanism."

**Must express**: a date must carry which THING it dates (run or container) and at what precision, not
just a value; and a cluster's derived attributes (its year set) must be attributable to the member
that supplied them.

---

#### 4. A borrowed id makes the borrower's own origin the common case

**Sources**: the `offline` source (borrows `mal-59193`), every catalogue it indexes.

**Concrete**: `offline` issues no id of its own. `getMedia` opened with
`const own = uris.find(candidate => candidate.origin === origin); if (own) return (await seasonalById(own.id)) ?? null`.
Because the aggregated uri is what the address bar carries, "every bookmark, shared link and reload of
a media page arrives already naming this source", took the early return, and any show outside the
season window answered `null` (`R "A BORROWED id makes your own origin the common case, not the edge
case" (2026-08-17, 2548f8f)`).

**Outcome**: SHIPPED and works (falls through and reads the catalogue row back out of the borrowed id
via `catalogRefs`). Recorded as a gotcha at `R "Gotchas"`.

**Must express**: a node's identity must be separable from the origin that asserted it, so a source
can answer about a row it did not name.

---

#### 5. Two ids of one origin in one cluster, and prefix extension is the only exemption

**Sources**: Crunchyroll (`cr:G24H1N3MP` beside `cr:G24H1N3MP-GS00374452`).

**Concrete**: `extractAggregatedUriOrigin` sorted handles by id and took `.find`'s first match; a bare
series id is a strict PREFIX of `<series>-<season>` so it sorted first in every locale, and the
correct season-scoped handle "was in the cluster the whole time and was never reachable"
(`R "Kitsu welded three Mushoku Tensei seasons..." (2026-08-31)`). Fixed by `R "The most specific
handle wins" (2026-09-01, fc36ffc)`: "Specificity is PREFIX EXTENSION, not length."

**Current code**: `mostSpecific` at `src/utils/uri.ts:34`, doc at `:23-28` (cited by
`D sources/season-ids.md`). The contradiction detector is `disagreeingIds` in
`src/worker/store/anomalies.ts:18-25`, with the one-way reading at `:38` so that
`[A, A-1, A-2]` reports rather than cancelling out (`D merge/anomalies.md`).

**Outcome**: SHIPPED and works; the anomaly rule has NO production caller (`clusterAnomalies` is
imported only by `tests/unit/worker/store/merge-fixtures.test.ts:15`, `D merge/anomalies.md`), its
production twin being `findSeedWelds` in `src/sources/offline/seed-gate.ts` (the seed job, removed in HOR-577).

**Must express**: ids that stand in a part-of relation to each other inside one origin, so that
`A` beside `A-1` is precision and `A-1` beside `A-2` is a contradiction, checkable without a human
knowing which one was right.

---

#### 6. A bare container id already sitting in season 1's cluster bridges it to season 3

**Sources**: Crunchyroll search hits, unOGS search hits, AniList/MAL/Kitsu runs.

**Concrete**: `scripts/reproduce-season-weld.mjs`, ARM A, search only:

```
S1  ag:(anilist:108465,cr:G24H1N3MP,kitsu:42323,mal:39535,nf:80987039,tvmaze:52279)
S3  ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)
```

Season 1's cluster already holds the bare `cr:G24H1N3MP` and bare `nf:80987039`. ARM B, opening those
aggregated uris, welds the two (`R "Tracing a live weld found a hole in the refactor that made it"
(2026-09-05)`).

**How it got there**: fuzzy TITLE merge, with four vetoes structurally silent because each requires
BOTH sides to assert something. A crunchyroll search hit is minted with
`startDate: ${series_launch_year}-01-01` (`crunchyroll/extractor.ts:152`, as cited in `R`), `startDay`
drops any first-of-month (`fuzzy-merge.ts:153` per `R`; today `startDay` is at
`src/worker/store/fuzzy-merge.ts:173`), so its `days` set is EMPTY and the 45-day window
short-circuits; its title names no season so the season veto short-circuits; `makeMedia` sets no
`type` so the companion veto short-circuits. "It is judged on the title alone."

**Outcome**: measured zero of five weld runs at `2e7057a` and again at `46c712d`, against five of five
at `09e521b` (`R "What landed, and the second bridge under the first" (2026-09-05)` and
`R "Round two, same day" (2026-09-05)`). **STILL OPEN** per the record: "what bridges season 1 to
season 3 ... the exact chain is not proven and should not be guessed at."

**Must express**: a veto whose premise is ABSENT evidence must be distinguishable from one that
passed, so four silent short-circuits do not read as four passes.

---

#### 7. A second writer into the same union-find with none of the guards

**Sources**: internal. `linkSameMediaPairs` (`src/worker/store/db.ts`), called only by
`fuzzyMergeMediaClusters`.

**Concrete**: "Every refusal the handle refactor added lives inside `upsertMedia`'s loop; this
function ... was a raw `graph.link`: no relation, no demotion, no check. So an origin no source is
permitted to mint as SAME_AS could still be welded to a cour by a TITLE MATCH, and
`SHOW_LEVEL_ORIGINS` protected nothing on that path." Fixed in `7955972`, refusing the pair outright
rather than demoting, "because there is no handle and nothing asserted a containment"
(`R "THE HOLE, and it was mine" (2026-09-05)`).

**Current code**: `src/worker/store/db.ts:219` now refuses when either side is CONTAINER; the
container twin `linkSameContainerPairs` at `:234` refuses when either side is not CONTAINER, and
`linkPartOfPairs` at `:250` requires RUN then CONTAINER.

**Outcome**: SHIPPED. The stated general lesson: "a guard placed in one writer is not a guard."

**Must express**: exactly one chokepoint where a claim becomes a fact, so that the number of writers
into the identity structure is one by construction.

---

#### 8. An aggregated uri is user input, and identity is rebuilt from it

**Sources**: appletv, unogs, justwatch (all call `buildHandlesFromUri`).

**Concrete**: `buildHandlesFromUri` (`src/sources/utils.ts`, per
`R "JustWatch folds cours too..." (2026-09-10)`) "filters only the CALLER's origin, so appletv, unogs
and justwatch all rebroadcast whatever handles the url carries. A stale pre-fix bookmark therefore
re-injects a show-level `cr:` handle and it is linked again" (`R "OPEN: an aggregated uri is user
input and we rebuild IDENTITY from it"`). Mitigated by `fc36ffc` (the most specific handle wins) but
"the link is still made and two old season links in one session can still weld."

Also, `buildHandlesFromUri` stamps NO scope in either direction, deliberately: "A caller has read
nothing about its siblings, and a stamp there was a claim about rows it never saw"
(`R "What landed, and the second bridge under the first" (2026-09-05)`).

**Outcome**: OPEN. "The honest shape is that a uri-derived handle should be a POINTER rather than an
assertion ... It is a design decision, not a patch, and it needs the owner."

**Must express**: a claim's PROVENANCE, including "this came from the address bar of a browser
session", so a replayed uri can be weighed differently from a source's own statement.

---

### Group B. What catalogues do to one broadcast

The exchange rate case in one table, all measured, from `D start/run-and-show.md` "The same broadcast,
five ways". Mushoku Tensei broadcast as five cours of **11, 12, 12, 12, 14**:

| catalogue | what it publishes |
| --- | --- |
| anilist, mal, kitsu, simkl anime | one record per cour (five records) |
| crunchyroll | one season of 23 plus a special |
| netflix (via unogs) | three seasons: 24, 25, 11 (also stated as 24/25/12 in `R (2026-09-10)`) |
| justwatch `ts222366` | seasons of 23, 24, 14 |
| imdb `tt13303712` | one id for all of it |

Note the record states Netflix's third season as **11** in `D start/run-and-show.md` / `R
(2026-09-05)` and as **12** in `R "Why only the last season: Netflix's unit is not a cour"
(2026-09-10)` ("season 1 = 24 episodes, season 2 = 25, season 3 = 12"). Both readings are in the
record; the 12 figure is the later measurement. Anime season 1 has **11** episodes, which is the
number that matters for the weld below.

---

#### 9. One streaming season CONTAINS two catalogue cours (the fold)

**Sources**: Netflix via unOGS, JustWatch, Crunchyroll; against AniList/MAL/Kitsu/anizip.

**Concrete**: measured live, unogs `title/episodes` for netflixid 80987039: season 1 = 24, season 2 =
25, season 3 = 12, against cours of 11/12/12/12/14. "Only season 3 matches a run one-to-one"
(`R "Why only the last season: Netflix's unit is not a cour" (2026-09-10)`). JustWatch does the same:
instrumented live, `seasonList=[[1,23,2021],[2,24,2023],[3,14,2026]]` against evidence
`{count:12, start:2023-07-09}`, `seasonPick=undefined`, `normalizeMedia -> REFUSED`
(`R "JustWatch folds cours too, and refusing the season threw away the offers" (2026-09-10, 60bed77)`).
Crunchyroll models a split cour as one season of 23 plus a special.

**Had / lacked**: unOGS HAD per-season episode lists with epids and per-episode titles (often
placeholders, see case 20), a season ordinal, and an episode count per season. It LACKED per-season
dates in the shape the run needs, and its titles are its OWN translation (case 19). JustWatch HAD a
real per-season `objectId` and a season YEAR only, never a day (`namesADay` refuses a `YYYY-01-01`
date by design, `R "The cost, measured" (2026-09-04)`).

**Current code**: `foldVetoed` in `src/sources/similar.ts`: a candidate season holding MORE
episodes than the run is never the answer, zero tolerance. `pickSimilarSeason` at
`src/sources/similar.ts:173` runs five rules in order and refuses on ambiguity rather than falling
through. `showAsContainer` in `src/sources/justwatch/extractor.ts` returns the show as a CONTAINER
when no season can be established, so the offers (which "hang off the SHOW, not off any season")
survive and carry `nf:<title id>`.

**Outcome**: half works. Delivered: the netflix CONTAINER link on cours that had none. NOT delivered:
per-episode netflix sources on a folded cour. The live A/B for `60bed77` "was CONTAMINATED and is
reported as such"; what is attributable live is `jw:222366 CONTAINER` appearing only with the change.

**Must express**: a containment edge from a run to a season that holds it, carrying the fact that the
container is LONGER, plus a per-episode correspondence that is allowed to be partial and is allowed
not to exist at all.

---

#### 10. One catalogue run is SPLIT across several streaming seasons

**Sources**: Netflix via unOGS.

**Concrete**: "It splits Fullmetal Alchemist's one 64 episode run into five seasons of about 13, folds
Mushoku Tensei's five runs into three, and Seven Deadly Sins has four separate 24 episode runs"
(`R "unOGS welded Netflix seasons on a guessed episode count" (2026-09-01, 2b3013f)`). BAKI (anidb
12569, 26 regular episodes) is netflix 80204451 with three seasons of 13; "`foldVetoed` only fires
when the candidate is LONGER (`similar.ts:149`), so 13 against 26 passes and the year rule picks
season 1. Measured, not reasoned" (`R "THE FOLD FIX WAS DESIGNED AND REFUTED" (2026-09-10)`).

**Current code**: `foldVetoed` is one-directional by construction. Rule 5 in `pickSimilarSeason`
(`src/sources/similar.ts`, the FIRST rule) comments: "with several seasons a shorter first season may
be one half of our run (the Fullmetal Alchemist split), so only exactness counts."

**Outcome**: half works. The split direction is guarded only by exactness in rule 5; BAKI is a
measured live weld through rule 4 (year).

**Must express**: the inverse of containment, a run that SPANS several catalogue seasons, and a veto
that can see both directions of the size mismatch.

---

#### 11. The store has no view of the other clusters, so several runs take one season

**Sources**: unOGS, all catalogue gates.

**Concrete**: "A source matching one cluster at a time cannot see that three other clusters match the
same season. Closing that needs the STORE to refuse a handle another cluster already holds"
(`R "unOGS welded Netflix seasons on a guessed episode count" (2026-09-01)`).
Measured residue: **11 of 105** runs, over 33 real multi-season Netflix series, down from 51 of 105
under the rule it replaced (`src/sources/season.ts:154-161` and `:170-173`, quoted in
`D sources/season-ids.md`). The same residue from the other side:
`src/sources/catalogue-gate.ts:17-23`, "Two of our clusters that both clear the title axis and both
fall within the date window of the SAME catalogue season still receive the identical season-scoped id,
and union-find welds them at upsert ... the gate has one candidate and no view of the other cluster."

**Outcome**: OPEN, priced. `SEASON_DATE_WINDOW = 45 * 24 * 60 * 60 * 1000` at
`src/sources/catalogue-gate.ts:230` (per `D sources/season-ids.md`).

**Must express**: a uniqueness constraint over the whole graph, "at most one run may claim this
catalogue season", evaluated where both claimants are visible, not at the mint site.

---

#### 12. A season that contains a run can lend it episodes without claiming to be it

**Sources**: Crunchyroll, both Mushoku Tensei part-twos.

**Concrete**: "Crunchyroll models a split cour as one season, so neither part matches: part one is
refused by the fold veto for being longer than it, and part two never comes near, because the season
it belongs to premiered with part one nine months earlier. Both parts carried no Crunchyroll at all."
Shape that works, `lendContainingSeason` in `src/sources/crunchyroll/extractor.ts` (called at
`:579`): find the season whose broadcast SPAN covers the run's start and which is longer than the run
(exactly one may qualify); return it with `handles: []`, claiming NO identity; re-point its EPISODES
at the asking run so a `HAS_EPISODE` edge exists; the episodes keep CRUNCHYROLL'S OWN NUMBERING
because that node is shared and `graph.set` is last-write-wins, and the run applies its own view at
READ time. Live result: both part-twos went from 0 to 12 Crunchyroll sources on their own episodes 1
to 12 (`R "A season that CONTAINS a run can lend it episodes without claiming to be it" (2026-09-09)`).

**Four defects only the running app showed**, from the same section: `searchAndLinkMedia` waited for a
TITLE alone and fired before any dated source landed; the resolver took `handleUris[0]` and read an
unlanded row as "no cluster"; the window keyed on cluster membership rather than on what a source
CLAIMS; and the two-witness bar backfired, putting 24 rows on a 12 episode page, because MAL publishes
no count for Mushoku season 2 part 1 and AniList says 13 for a run that aired 12.

**Outcome**: SHIPPED and works, gated on the MAL count: "Part one gets nothing because MAL publishes
no `episodeCount` for it."

**Must express**: an episode belonging to a node other than the media that published it, and a
per-reader numbering applied at read time without rewriting the stored node.

---

#### 13. A source that carries its numbering on from the previous season

**Sources**: Crunchyroll (the offender), anizip/MAL/AniList/kitsu (the reference).

**Concrete**: The Elusive Samurai season 2, in the shipped seed. `anizip:18903` (no score, count 12,
episodes 1 to 12 weekly from 2026-07-17), `mal:60059` (0.9, count 12, no episodes), `anilist:182616`
(0.8, count 12), `kitsu:49265` (0.3, count 12), `cr:GQWH0M19X-GS00366034` (0.5, count 8, episodes
**13 to 20 on the first eight of those same days**). `mergeByEpisodeNumber` keys on the number alone,
so the page drew twenty rows for a twelve episode run
(`D merge/alignment.md`, quoting `src/worker/store/consensus.ts:93-97`;
cluster pinned at `tests/unit/worker/store/consensus.test.ts:284-288`).

Three chances to catch it and only the third can: the fold veto compares counts and 8 is not more than
12; `mergeByEpisodeNumber` (`src/worker/store/db.ts`) compares numbers and 13 shares nothing with
1; only the DATES are identical.

**Current code**: `alignmentOffset` (`src/worker/store/consensus.ts:113`) votes an offset off the days
the two lists share, with a day of slack either side ("ani.zip stamps `2021-01-10T15:00:00Z`, which is
the 11th in Tokyo, and Crunchyroll publishes the Tokyo date"), `MIN_ALIGNED = 2` witnesses, and
refuses when two offsets tie or when a day names more than one reference episode.
`alignRunEpisodes` (`:256`) groups by ORIGIN, never by which row an episode hangs off, and returns a
Map of renumbered COPIES; the stored episode keeps its source's number. `findRunEpisodes`
(`src/worker/store/db.ts:424`) runs alignment first and the window second.

**Outcome**: SHIPPED and works, as a VIEW. Note the cost of a refusal is not zero: unaligned 13 to 20
fails `episodeNumber >= 1 && episodeNumber <= length` at `consensus.ts:240` and all eight rows are
dropped, so Crunchyroll disappears from the page instead (`D merge/alignment.md`).

**Must express**: exactly the requested primitive, an edge stating that episodes `13..20` of one row
correspond to `1..8` of another, carrying its evidence (shared air dates), its support count, and the
fact that it is a view rather than a rewrite.

---

#### 14. Three numbers per episode, in three different spaces

**Sources**: ani.zip (anidb), everyone else.

**Concrete**: measured live on anidb 18104 (Mushoku Tensei season 2 part 2), 2026-09-09:

| entry key | `episodeNumber` | `absoluteEpisodeNumber` |
| --- | --- | --- |
| `1` .. `12` | 13 .. 24 | 38 .. 49 |

"The KEY is the position within this entry, which is one broadcast run. `episodeNumber` counts within
the SEASON, so a second cour continues from where the first stopped. `absoluteEpisodeNumber` counts
the whole series" (`R "ani.zip states three numbers per episode and they are three different things"
(2026-09-09)`).

**Current code**: stub's extractor publishes the KEY (`28b203d`), exactly, "no offset is derived". A
special is keyed `S1`, not a number, so it stays unnumbered. The nyaa plugin publishes the key too
but **matches** release names against the number the release CLAIMS and **searches** under the claim:
`episodeNumbering` keeps its keys and moves only its values, and a second map `releaseNumbers` goes
back the other way. Over 569 real ani.zip entries this changes output for 13 of them (2.3%) and is
byte-identical for 556 (`R "Publish the key, match on the claim, and search under the claim"`).

**Outcome**: SHIPPED and works on both sides of the boundary. The stub-side bridge was measured and
REJECTED: `Media.episodes` REGROUPS from scratch in the resolver, so a rule landed only in
`mergeByEpisodeNumber` "would ship completely inert", and "the extractor discards ani.zip's
season-relative number, so the run knows key 1 and absolute 38 while the release says 13, and nothing
maps between them" (`R "Why the bridge did not go in stub, where it looks like it belongs"`).

**Owner's call on display**: 1 to 12, "because showing 13 to 24 leaves 1 to 12 rendering as empty
rows". This changes displayed numbers for every split-cour part.

**Must express**: several numbering systems per episode, each labelled with its space (run-relative,
season-relative, absolute), and a stored value that is never silently reinterpreted in another space.

---

#### 15. A mid-season insert, which makes the true mapping piecewise

**Sources**: Netflix via unOGS, against the catalogue runs.

**Concrete**: Blue Exorcist, netflixid 70304252: season 1 is 26 rows for a 25 episode run; position 14
is epid 80005451 "Runaway Kuro", a special that aired after the run ended. A title-vote alignment
scores `[[0,12],[1,11]]`: offset 0 wins by ONE vote, no tie, so it ANSWERS, and 13 of 25 rows carry
the wrong Netflix episode, each with a playable `netflix.com/watch/<epid>` url. Mushoku's own season 2
has the same shape: E1 "Fitz the Guardian" is a SPECIAL, so positions 2..13 hold regular 1..12
(`R "THE FOLD FIX WAS DESIGNED AND REFUTED, with live evidence" (2026-09-10)`).

**Outcome**: REFUTED as a design (see Part 2, R1). Nothing ships that places Netflix episodes by
arithmetic.

**Must express**: a per-episode correspondence that can skip an item, so that one insert costs one
episode its link rather than shifting every later one.

---

#### 16. Duplicate rows from one catalogue inflate the season length

**Sources**: unOGS.

**Concrete**: "netflixid 80198505 season 3 returns 14 rows over 10 distinct epids (81244356 at
positions 7 and 8, and so on). `netflixCandidates` sets `episodeCount = season.episodes.length`, so a
10 episode season reports 14 and looks like it CONTAINS a 10 episode run. Index-based numbering
compounds it, and `graph.set` is last-write-wins"
(`R "THE FOLD FIX WAS DESIGNED AND REFUTED" (2026-09-10)`).

**Outcome**: OPEN. Recorded as a trap found during the refuted design.

**Must express**: a count that is derived from a list must carry that fact and the list's identity, so
"14 rows" and "14 episodes" are distinguishable.

---

#### 17. A streaming catalogue and a metadata catalogue disagree about the season NUMBER

**Sources**: JustWatch (its own ordinal) against Netflix (the provider's ordinal), via unOGS.

**Concrete**: measured over 31 shows carrying both season lists, **25 agree, 6 do not**:

```
Kengan Ashura        jw [1,2]         netflix [1,2,3]
Great Pretender      jw [1,2]         netflix [1,2,3]
Hunter x Hunter      jw [1]           netflix [1,2,3,4,5,6]
JoJo's Bizarre Adv.  jw [1,2,3,4,5,6] netflix [1,2,3,4,5]
Komi-san             jw [1,2]         netflix [1]
SAINT SEIYA          jw [1,2,3]       netflix [1,2]
```

Of the 82 handles: 66 SAFE, 3 ORPHAN, 13 RISKY (`R "JustWatch nf: refusing costs 5 correct handles
per suspect one" (2026-09-04)`).

**Current code**: `providerContentId` (`src/sources/justwatch/id.ts:59-60`) is one ternary and "never
appends a season": `mappedOrigin === 'cr' ? undefined : rawContentId`. Until 2026-09-05 a season
suffix wrote JUSTWATCH'S season number into the provider's id space (`nf:80123-2`,
`appletv:<umc>-s2`) where unOGS and the appletv source mint the same shapes with the PROVIDER'S
numbering (`src/sources/justwatch/id.ts:40-47`, quoted in `D sources/season-ids.md`).

**Outcome**: SHIPPED and works. "A provider id scoped by another catalogue's ordinal is a guess
wearing a precise uri" (`R "What landed, and the second bridge under the first" (2026-09-05)`).

**Must express**: which authority a number belongs to, so an ordinal is never portable between id
spaces; and a way to ASK the owning origin instead of guessing (`similarMedia`).

---

#### 18. A source that renumbers every season from 1 and hangs them all on one id

**Sources**: unogs, paramount (both UNKEYED), tvdb, omdb, trakt (keyed), crunchyroll (already guarded).

**Concrete**: "`Media.episodes` unions HAS_EPISODE across every cluster handle and groups by
`episodeNumber` ALONE. `seasonNumber` exists on the type and is read by nothing on that path, so the
row count is the LONGEST season rather than this season"
(`R "Kitsu welded three Mushoku Tensei seasons..." (2026-08-31)`). The survey that found the class:

| source | keyed | what it did |
| --- | --- | --- |
| `tvdb` | yes | `tvdb:<seriesId>` plus `/series/<id>/episodes/default`, every season |
| `omdb` | yes | id is an IMDb id, `fetchEpisodes` loops `1..totalSeasons` and flattens |
| `trakt` | yes | `/shows/<id>/seasons?extended=episodes` flatMapped across every season |
| `paramount` | **NO** | `paramount:<slug>` plus `season/0` at `size/100000` |
| `crunchyroll` | no | already guarded, 2026-08-31 |

`R "Five sources were hanging every season on one media" (2026-09-04, 877e07f + 843528e)`. Also
`unogs` "fans every season AND renumbers each from 1 (no API key needed, the worst of them)"
(`R "Still open, deliberately not taken" (2026-08-31)`).

**Current code**: every one of those attaches its episode list only when the episodes are all one
season, and keeps its media either way "because `mediaPage` mints exactly these ids for SEARCH".

**Outcome**: SHIPPED and works. Checked and left alone: appletv, justwatch, tmdb filter by season
already; kitsu and anizip are per-run by construction; tvmaze scopes with `seasonScopedId`.

**Must express**: an episode list must be attributable to one run, and a container node must be
structurally incapable of carrying a flat episode list into a run's view.

---

### Group C. Episodes

#### 19. The same episode arrives from two sources and both lists render

**Sources**: kitsu and anizip on one page.

**Concrete**: "The same page listed 24 episodes: twelve with no titles, dates or descriptions, then
twelve with all of them. They were the SAME twelve. Rows 1 to 12 were kitsu, rows 13 to 24 were
anizip." Two causes, and fixing either alone changes nothing: the numbering-space disagreement (case
14), and "Episodes only ever merged through an explicit `EPISODE_SAME_AS`, which nothing mints between
two metadata sources" (`R "Two sources describing one run drew two full episode lists" (2026-09-09)`).

**Current code**: `findAggregatedEpisodesForMedia` now also merges groups sharing an episode number
(`mergeByEpisodeNumber`, `src/worker/store/db.ts`). "Safe ONLY because its input is one media
cluster, which is its SAME_AS set by construction and numbers its episodes once; the constraint is
written above the function, because two runs of a show both have an episode 1 and that is the mistake
this codebase pays most for." Keyed on the number alone, not on the season too, and only on a positive
whole number so specials never collide with episode 1.

**Outcome**: SHIPPED and works, under a stated precondition.

**Must express**: episode identity within a run, derivable without a per-pair assertion, but scoped so
it can never reach across two runs.

---

#### 20. A field-by-field merge produces a row that no source ever published

**Sources**: AniZip (score 0.9) and Crunchyroll (0.5) on the Mushoku Tensei season 3 page.

**Concrete**, measured on anime.fkn.app over 24 rows:

- 1 to 10: correct season 3, from AniZip.
- **11: a HYBRID row**, AniZip's season 3 title `Turning Point 4` over Crunchyroll's SEASON 1
  description, "because AniZip has a title for episode 11 but no overview".
- 12 to 24: season 1 outright, because AniZip publishes no English title past episode 11.

"The hybrid row is the tell worth remembering: `aggregateEpisode` fills each FIELD from the highest
scorer independently, so a contaminated group does not look like a wrong row, it looks like a right
row with one wrong field" (`R "What the page actually showed" (2026-08-31)`).

**Outcome**: the CAUSE is fixed (cases 1 and 18); the field-by-field merge is unchanged and is how
aggregation works everywhere (`R "Architecture"`: last-write-wins for scalars, longest-array-wins for
arrays; `D start/run-and-show.md` on `lastWriteLongestArray` at `src/worker/store/db.ts:85` and
`graph.ts:394-396`).

**Must express**: per-field provenance on a merged row, so a rendered value can name the source and
the row it came from, and a contaminated field is visible as such.

---

#### 21. Placeholder episode titles

**Sources**: Netflix via unOGS.

**Concrete**: "11 of that season's 25 rows are `Episode 13`..`Episode 24` placeholders, excluded by
`isGenericEpisodeTitle` (`similar.ts`) as they must be. Season 1 is 24 of 24 positional, so it
offers nothing at all" (`R "The per-episode title join does not work..." (2026-09-10)`).
`GENERIC_EPISODE = /^(?:episode|ep|e|part|chapter|第)?\s*\d+\s*(?:話|集|화)?$/` at
`src/sources/similar.ts:104`.

**Outcome**: SHIPPED and works as a refusal.

**Must express**: a title that carries no identity, marked as such, so an evidence rule can count real
titles rather than rows.

---

#### 22. An episode count that counted something else

**Sources**: the nyaa plugin.

**Concrete**: "`media.episodeCount = episodes.length` where `episodes` is one entry per RELEASE, up to
ten per episode: a twelve episode run reported up to 120 ... it is the run length `similar.ts`
compares a candidate season against, so an inflated one silently retires the veto that stops a longer
season being folded into the run" (`R "An episode count that counted torrents" (2026-09-09)`).

**Outcome**: fixed in the plugin (unconfirmed which commit; the section is under the
2026-09-09 `stub-plugin` work).

**Must express**: a count must declare what it counted (a published figure, a fetched list's length, a
release list's length) so a vote can weigh the classes differently.

---

#### 23. "No count" read as zero, and zero vetoes everything

**Sources**: appletv, unogs, justwatch, tvmaze, tmdb.

**Concrete**: "`aggregateMedia` always emits `episodes: []` (aggregate.ts around lines 182, 228 and
367), so at `appletv:233`, `unogs:351` and `:361`, `justwatch:461` and `:584`, `tvmaze:171` and
`tmdb:161` a cluster with no count reads as `0` rather than as absent. Zero is `!= null`, so
`foldVetoed({ episodeCount: 0 }, candidate)` is `theirs > 0`, which is true of every candidate season.
Those sources therefore refuse to match ANY season for a cluster whose sources published no count,
silently, and the refusal looks exactly like 'this source has nothing'"
(`R "?? media?.episodes?.length turns 'no count' into ZERO, and zero vetoes everything" (2026-09-09)`).

**Outcome**: OPEN. "Verified as present by reading; the behavioural cost is unmeasured."

**Must express**: absent, zero, and unknown as three distinct states on every quantity a rule reads.

---

### Group D. Titles

#### 24. Normalising a title to `[a-z0-9]` deletes a CJK title and leaves the year

**Sources**: ani.zip `ja` titles, AniList native titles, everything with a CJK main title.

**Concrete**: `転生したらスライムだった件 (2026)` became the literal string `"2026"`, and the
unrelated `あはれ！名作くん (2026)` became `"2026"` too; `sameShow` short-circuits on exact title
equality, both bucket to year 2026, and TV and TV_SHORT both profile as SERIES. Replayed over 903 real
2025/2026 AniList media with their real ani.zip titles: **1430 cluster pairs merged on exact title
equality, 1321 of them on a key with no letter in it**, and Slime's component held 68 shows including
Frieren S2, Oshi no Ko S3 and Jigokuraku S2. Busiest keys: `"2"` (599 pairs, from `第2期` and
`第2クール`), `"2026"` (438), `"2025"` (257). After the fix: 1 pair, largest component 2
(`R "Normalizing a title to [a-z0-9] erased it, it did not clean it" (2026-08-11, 7a4b586)`).

Three things made it invisible: the digit residue is preferentially KEPT (the profile sorts by score
and the native-script emitters scored 0.9); `filter(Boolean)` caught only total losses (about a third
of raw titles were being dropped as empty); double normalisation made `titleSimilarity`'s
`if (!normalA || !normalB) return 0` guard unreachable.

The search half: `searchScore` normalises by the QUERY, so a residue saturates. Over the same 903
media, **587 (65%) could not be found by their own native title**, and `Aランクパーティを離脱した俺は…`
normalising to `"a"` matched 841 of 903 (`R "The same strip made search worse than the merge"
(2026-08-11, d15e0a3)`). Mean result set 19.6 to 1.6 after the fix.

**Current code**: shared `stripTitle` in `src/sources/utils.ts` keeping `[^\p{L}\p{N}\s]`, plus a
`HAS_LETTER` filter on the profile (`carriesIdentity` in `src/worker/store/fuzzy-merge.ts`).

**Outcome**: SHIPPED and works. Also fixed: seal-wasm scores per CODE POINT while `String.length`
counts utf-16 units, so `𠮷野家` scored 0.5 against itself; both scorers now divide by
`[...text].length`.

**Must express**: a title with its SCRIPT and language, and a normalisation that is a view rather than
a replacement, so no derived key can become a first-class identity.

---

#### 25. No threshold separates punctuation from a season number

**Sources**: internal, measured over real titles.

**Concrete** (`R "No threshold separates punctuation from a season number" (2026-08-11)`):

```
lowercase     Re:Zero kara Hajimeru / Re Zero kara Hajimeru   0.929  len 21  must merge
lowercase     Yami Shibai 16        / Yami Shibai 17          0.929  len 14  must NOT merge
punct->space  Onii-chan!            / Oniichan                0.833  len  9  must merge
punct->space  Death Note            / Death Note 2            0.833  len 12  must NOT merge
```

"A length correction cannot fix it either, because it would have to point in opposite directions for
the two rows." Dropping separators entirely pushes `Death Note` / `Death Note 2` to exactly 0.900,
which merges them.

**Current code**: `SIMILARITY_THRESHOLD = 0.9` at `src/worker/store/fuzzy-merge.ts:7`. The season
became a GATE rather than a similarity question (`1604d62`), with two mechanisms: a cluster-level
season disagreement veto (only a DISAGREEMENT blocks) and a per-pair trailing-number comparison as a
VALUE (284 of 4159 real titles end in a bare number and most name no season, e.g.
`Kidou Keisatsu Patlabor EZY File 1`). Measured over 903 media: fuzzy merges 11 to 4, and the 7
removed are exactly the same-show-different-season pairs.

**Outcome**: SHIPPED and works. Residual accepted: `Oshiri Tantei 9` still merges with
`Oshiri Tantei 9 Part 2`, because absence is treated as unknown rather than as zero.

**Must express**: a season/part/cour ordinal as a first-class attribute parsed from a title, with
"absent" distinct from "zero", never as a contribution to a string distance.

---

#### 26. Silence on one side, so a disagreement veto never fires

**Sources**: AniList/MAL/Kitsu main titles across sequels.

**Concrete**: "Of 1547 veto-surviving shared-title pairs, 1211 share a short franchise label carried
as a synonym, 81 agree on a season, and **255 are a real veto gap: exactly one side names a season**.
`86` and `86 Part 2` both carry `86 不存在的战区`, and the season veto misses it because only a
DISAGREEMENT blocks and the season-1 side declares nothing"
(`R "The six-title merge cap was hiding wrong merges by luck" (2026-08-29, 04d527b)`).

**Outcome**: OPEN and PRICED. Making silence itself block "refuses 323 wrong welds and costs 12007
correct merges, one stopped per 37 destroyed", 11415 of the loss being streaming-cluster attaches; ten
narrower variants measured, best ratio 0.22 (`R "Closing the season veto gap by LABEL was measured and
refused" (2026-08-29, 1432a9e)`). Pinned in `tests/unit/worker/store/season-separation.test.ts` as
`KNOWN GAP: a year-only silent side still welds to a season-3 cluster`.

**Must express**: the difference between "this source says season 1" and "this source has never been
asked about seasons", so a rule can act on the second without paying the first's exchange rate.

---

#### 27. A franchise title collapses a sequel onto its parent EXACTLY

**Sources**: JustWatch, Apple TV, Crunchyroll (all catalogue gates).

**Concrete**: "with the title axis alone, 5583 of 139507 wrong pairs pass **at threshold 1.00**,
because franchiseTitle collapses a sequel onto its parent exactly, so no number in 0..1 refuses them"
(`R "A show-level catalogue id welds every season together..." (2026-08-29, e7bad56)`). The fix is the
two-axis gate: title list plus `franchiseTitle` at 0.90 AND a season-level year. Measured over the
whole manami database: wrong links 28.793% to 1.062% while recall ROSE 28.085% to 34.702%, a 27x
reduction. "Read the date at SEASON level or do not add it at all": same-show recall 16.543%
show-level against 93.221% season-level.

**Outcome**: SHIPPED for JustWatch and Crunchyroll; Apple TV reverted (case 2).
`CONFIDENT_TITLE_THRESHOLD = 0.9` at `src/sources/crunchyroll/extractor.ts:366-370` per
`D start/run-and-show.md`; also `SHOW_TITLE_THRESHOLD = 0.9` at `src/sources/similar.ts:303`.

**Must express**: two axes on every catalogue link (what show, which run) with the second one
mandatory, because the first is provably insufficient at any threshold.

---

#### 28. The diacritic gate

**Sources**: JustWatch (`Nige jôzu no wakagimi`) against our titles.

**Concrete**: "JustWatch's own title for the former is `Nige jôzu no wakagimi`, and `rankByTitle`
refuses it outright: scoring it against `['The Elusive Samurai', 'Nige Jouzu no Wakagimi',
'逃げ上手の若君']` returns ONE survivor, the exact match, and the romaji candidate is not in it.
`ô` against `ou` is precisely the loss `CONFIDENT_TITLE_THRESHOLD` documents as its known regression
('mostly diacritics and punctuation')" (`R "What is still missing, and why it is NOT this"
(2026-09-09, bc97c6a)`).

**Outcome**: OPEN, deliberately. "Folding combining marks before scoring would turn
`nige jozu no wakagimi` against `nige jouzu no wakagimi` into a one-insertion difference, which clears
0.90 comfortably. Not done here: that gate carries measured exchange rates over 150 seasons and
deserves its own measured change."

**Must express**: a title's romanisation variants as alternates on one node, so a fold is a candidate
spelling rather than an edit to the normaliser everyone shares.

---

#### 29. Synonym fields carry programme names that sit on dozens of unrelated shows

**Sources**: AniList `synonyms`, Kitsu `abbreviatedTitles`.

**Concrete**, measured over 1200 anime, collisions across UNRELATED entries:

| feed | titles | colliding | worst |
| --- | --- | --- | --- |
| anilist main titles | 2924 | **0** | none |
| kitsu main titles | 4591 | **0** | none |
| anilist synonyms | 1718 | 261 | `minna no uta` on 23 anime |
| kitsu abbreviatedTitles | 1256 | 213 | `minna no uta` on 21 anime |

`R "The corpus measurements over-counted welds ~2.6x, and why" (2026-08-29)`. Re-measured with a
faithful pool (main titles only, 893 same-year related pairs): **72 real welds, 8.1%**, against 187
and 20.9% on title+synonyms.

**Outcome**: SHIPPED as an omission: no extractor reads a synonym field, and `offline` is pinned at
`SCORE = 0.2` for the same reason. Listed as a gotcha: "Never feed a catalogue's synonym or
alternative-title field into `titles`."

**Must express**: title CLASS (main, synonym, abbreviation, per-locale) so a store can hold a synonym
without letting it into identity comparisons.

---

#### 30. The six-title cluster profile, and which six

**Sources**: all title-emitting sources.

**Concrete**: `MAX_TITLES_PER_CLUSTER = 6` at `src/worker/store/fuzzy-merge.ts:12`, chosen by score
descending. Score is a per-SOURCE constant so ties are everywhere, and a stable sort left tied titles
in HTTP arrival order: "The same cluster kept a different six run to run, and the six decide whether
it merges at all." Three arms, manami 2026-27:

|                     | A wrong weld | B split recall | C attach recall |
| ---                 | ---          | ---            | ---             |
| arrival order       | 64.5%        | 94.9%          | 56.0%           |
| **title ascending** | **69.6%**    | **99.9%**      | **70.0%**       |
| longest first       | 53.8%        | 100.0%         | 19.9%           |
| shortest first      | 82.7%        | 100.0%         | 98.7%           |

`R "The six-title merge cap was hiding wrong merges by luck" (2026-08-29, 04d527b)`.
"Longest-first is the trap": it collapses C to 19.9% "because it drops short titles, which is exactly
what a streaming catalogue lists a show under."

**Outcome**: SHIPPED (title ascending) and works.

**Must express**: a deterministic, order-independent comparison over a cluster's evidence, with no
arrival-order dependence anywhere in it.

---

#### 31. Intra-word punctuation splits an index term

**Sources**: nyaa (the index), AniList romaji and ani.zip `x-jat` (the spelling).

**Concrete**: "Nyaa indexes on word boundaries, so punctuation INSIDE a word splits the term.
`Onii-chan` is indexed as `onii` + `chan` and can never match a release named `Oniichan` ...
Onii-chan wa Oshimai! returns 39 Erai-raws rows under the hyphen and 34 SubsPlease rows under the
joined form, with zero overlap" (`R "Nyaa splits a name on its punctuation" (2026-08-08, e9bb386)`).
`Re:Zero` to `ReZero` finds 20 across three groups; `Kin'iro` to `Kiniro` finds 72 where the
apostrophe form finds zero. "Only the JOINING direction is derivable."

**Must express**: derived spelling variants of a title as first-class alternates with the rule that
derived them.

---

#### 32. Normalising a match score by the wrong side

**Sources**: nyaa release names against ani.zip aliases.

**Concrete**: "Dividing by the alias alone rejected twelve real releases of the owner's own show:
`[Judas] Mushoku Tensei (Jobless Reincarnation) - S02E13` scores 0.56 against the alias
`Mushoku Tensei: Jobless Reincarnation Season 2 (2024)`, because the alias is longer than the name's
own title candidate. Against `min(self(alias), self(candidate))` it scores 0.92 while the intruders
stay at 0.26 and 0.28" (`R "The title guard, and the normaliser that decides whether it works"
(2026-09-09)`). And the markers must come off BOTH sides: ani.zip writes `Spy x Family (2022)` where
the group writes `Spy x Family Cour 2`, scoring 0.63, "silently rejecting 62 real Spy x Family
releases and 77 real Dr. Stone ones".

**Outcome**: SHIPPED and works, threshold 0.80. Explicitly: "It cannot separate franchise siblings and
is not supposed to: 100% of Mushoku Tensei S1, S2 and S3 rows are accepted by all three alias sets,
and the season marker and airing window are what separate those."

**Must express**: title matching as one axis among several, never as the identity decision, and a
normaliser applied symmetrically to both sides.

---

### Group E. Dates

#### 33. `YYYY-01-01` is a SENTINEL and a real premiere at once

**Sources**: six extractors emit it deliberately (crunchyroll at `crunchyroll/extractor.ts:152` per
`R`), against real January 1 premieres.

**Concrete**: over 29722 AniList entries, 27367 carry a real day, **1344 of them (4.91%) are the 1st**
against a mean of 904 for days 2 to 28; a further 2355 (7.9%) carry NO day.
`startDay` in `src/worker/store/fuzzy-merge.ts` discards ANY first-of-month date before the window
compares two clusters. The sweep (`scripts/measure-start-date-window.probe.ts`, window 45):

```
guard   welds refused   merges lost   ratio
none         91             305        0.30
jan1         86              98        0.88
day1         83              81        1.02      <- shipped

BRIDGE  streaming attaches, guard on:            17946
        the same January 1 believed instead:      4125
```

Removing it "takes 77% of streaming attachments with it: every justwatch, unogs, tmdb, tvdb, omdb and
crunchyroll row that knows only a year would stop attaching to its show, so no play button."
The cost is 0.52% of correct merges, not 4.91%, "because `days` is a per-CLUSTER set, so a cluster only
loses the date axis when EVERY member is first-of-month"
(`R "Why the first-of-month date guard stays" (2026-08-31, measured)`).

"`${year}-01-01` is a SENTINEL, not a bug ... `yearOf` still buckets on it while `startDay` drops it.
Emitting no date instead would remove the cluster from year bucketing entirely and it would never be
compared with anything."

**Outcome**: SHIPPED and works. Residue unclosed on purpose: "A genuine January 1 premiere is still
indistinguishable from the sentinel. Closing it needs an explicit precision field on `Media`, touching
every extractor, and 0.52% does not pay for that yet."

**Must express**: a date's PRECISION (year, month, day, instant) as a stored property, which is exactly
the thing the record says is missing and priced.

---

#### 34. A month-precise date that reads as day-precise

**Sources**: kitsu, jikan.

**Concrete**: "kitsu and jikan emit `YYYY-MM-01` when the day is unknown, which reads as precise and
is up to 30 days off, so at a 30-day window a correct merge is refused: kitsu `2016-10-01` against
anilist `Mon, 31 Oct 2016 15:30:00 GMT` is 30.65 days." Measured: 198 such pairs against a day-precise
AniList date. Switching the guard from January-only to every first-of-month is better at every window
(45 days: 83/81 ratio 1.02, against 86/98 ratio 0.88)
(`R "The start-date axis: measured, built, refused for now" (2026-08-29)` and
`R "Three traps worth keeping" (2026-08-30)`).

**Must express**: same as case 33, precision per date, so the coercion is visible rather than inferred
from the day-of-month.

---

#### 35. A source dating a media by the NEXT airing, or not at all

**Sources**: AniList.

**Concrete**: `startDate` came from `airingSchedule.edges.at(0)`, and AniList's schedule lists what is
still SCHEDULED, "so a mid-season show got the next episode's date (5 May instead of 7 April, 28 days
out) and a FINISHED show got nothing, which was 42% of entries. The second half is the expensive one:
a cluster with no date carries no year, the pass only compares clusters sharing a year, so those shows
were never compared with anything and silently never merged"
(`R "All four merge fixes, and what each is actually worth" (2026-08-30, 251a522)`). Also, AniList
"does not publish its FuzzyDate" on that path, present for only ~58% of entries and absent for all
pre-2010 ones, and `edges.at(0)` is not episode 1 for ~2%, "giving a PRECISE but wrong date off by up
to 1001 days".

**Current code**: `src/sources/aired-date.ts`: complete FuzzyDate wins, else the schedule by EPISODE
NUMBER then earliest time, else the year coerced. Coverage after: 88.8% day-precise overall, **98.2%
of TV**, MOVIE weakest at 70%.

**Outcome**: SHIPPED and works.

**Must express**: a date's DERIVATION (published, inferred from schedule, coerced from a year) beside
its precision.

---

#### 36. Cross-source date agreement is excellent, but only on TV

**Sources**: AniList against Kitsu.

**Concrete**: 531 same-anime pairs with both dates precise: **98.68% within 30 days, 98.87% within
45**, "and flat beyond, because the 6 stragglers are *years* apart." By format at 45 days: TV **0 of
207**, OVA 0/63, ONA 0/76, MOVIE 1/83, SPECIAL 5/102
(`R "The start-date axis: measured, built, refused for now" (2026-08-29)`).

**Also**: "Consecutive cours sit about 91 days apart, which is why three places in this repo
independently settled on a 45 day window" (`R "mediaSeason: a source can ask another which run of a
show started when" (2026-08-31)`). And: "A window sweep's RATIO improves monotonically as the window
widens, and optimising it is wrong ... The ceiling is structural (two cours sit ~91 days apart)."

**Must express**: a date-based correspondence whose tolerance is bounded by the structural cour gap,
and which knows the work's format because the agreement rate depends on it.

---

#### 37. THE DATE IS THE KEY AND AN ORDINAL WOULD NOT BE

**Sources**: kitsu, Crunchyroll.

**Concrete**: "kitsu:45950 and kitsu:47694 are BOTH 'season 2' of Mushoku Tensei, 12 episodes each,
**273 days apart**. No ordinal separates them" (`R "mediaSeason: a source can ask another which run of
a show started when" (2026-08-31)`).

**Current code**: `similarMedia` / `SimilarMediaInput` carries `showId`, `startDate?`, `titles`,
`episodeCount?`, `episodeTitles?`; the answer is a RUN of the asked origin or null, never the show;
the rules live in one module, `src/sources/similar.ts`, and five sources answer (crunchyroll, unogs,
justwatch, appletv, tvmaze) (`R "Round two, same day" (2026-09-05)`).

**Outcome**: SHIPPED and works. First live reading 2026-09-05 on `e25309f`: "the app's ask claims
`cr:GR9P57W96-GS00380130` for a Grand Blue run; Netflix refuses season 1 of Mushoku Tensei, whose 11
episodes match no season now, and the page keeps the Netflix title as a container link."

**Must express**: a question one node can ask another origin, carrying evidence about the run rather
than a name, and an answer that is a specific run or a refusal.

---

#### 38. A date that names a DAY versus a date that names an INSTANT

**Sources**: ani.zip (`airDateUtc ?? airdate`).

**Concrete**: "The first is an instant (`2026-07-07T11:30:00Z`); the second names a day and nothing
else (`2026-08-28`). **Both ship.** `new Date('2026-08-28')` is midnight UTC, so `toLocaleDateString`
renders **August 27** anywhere west of Greenwich. In `dist-seed/snapshots.jsonl`, **50 of 439** dates
are the named-day shape." Measured live over ten anizip ids, 132 episodes: `airdate` present on 132,
`airDateUtc` on 94, neither on 0; "on anidb 16392 the twelve numbered episodes carry both and the
eight specials carry `airdate` alone"
(`R "Episode release dates, and a day boundary this machine cannot see" (2026-09-08)`).

**Outcome**: SHIPPED and works (`src/utils/release-date.ts` formats a named day in UTC and an instant
locally). The browser check reports INCONCLUSIVE rather than passing when it cannot reach the
named-day branch.

**Must express**: the same precision axis again, this time on an episode's release date, and it is the
axis the alignment rule (case 13) reads at UTC-day resolution with a day of slack.

---

### Group F. Id spaces

#### 39. Two catalogues numbering different things in one namespace

**Sources**: TMDB (movies and tv), simkl, watchmode, trakt.

**Concrete**: "TMDB numbers movies and tv shows in SEPARATE sequences that both start at 1. Measured
2026-09-04 by following the redirects: `themoviedb.org/movie/550 -> /movie/550-fight-club`,
`themoviedb.org/tv/550 -> /tv/550-till-death-us-do-part`. Stub's uri is `tmdb:550` for both"
(`R "TMDB numbers films and shows in the same namespace" (2026-09-04, d8b4339 + a4eea19)`). Separately,
simkl "keeps a separate record per anime run, which is what stub wants, and then puts the SHOW's tmdb
id on every one, so all five Mushoku Tensei runs carried `tmdb:94664`."

**Current code**: simkl and watchmode mint no tmdb handle. "`tmdb` deliberately does NOT go into
`SHOW_LEVEL_ORIGINS`" because tmdb CAN be scoped and `tmdb/extractor.ts` mints a real `<id>-s<n>`;
"The refusal belongs at the source that cannot build an honest id"
(`src/sources/simkl/extractor.ts:112-115`, quoted in `D sources/season-ids.md`).
`trakt/extractor.ts:79` mints the same bare tmdb id and was NOT touched.

**Outcome**: half works, trakt open.

**Must express**: an id namespaced by (origin, KIND), so a film id and a series id of one catalogue
cannot collide, and a refusal that lives on the claimant rather than on the origin.

---

#### 40. A positional path read that mints a constant

**Sources**: watchmode (primary), justwatch (earlier), jikan/AniDB, hbo.

**Concrete**: `streamContentId` was
`new URL(webUrl).pathname.split('/').filter(Boolean).at(-1)`:

| url | old id | what it is |
| --- | --- | --- |
| `watch.amazon.com/detail?gti=<id>` | `detail` | **every** Amazon title on one handle |
| `crunchyroll.com/series/<id>/<slug>` | the slug | show level, shared by every run |
| `hulu.com/series/<uuid>` | the uuid | a container, shared by every season |

`R "Watchmode was reading the wrong path segment for every provider" (2026-09-04, a4eea19)`.
The AniDB twin: MyAnimeList publishes `https://anidb.net/perl-bin/animedb.pl?show=anime&aid=23`
(measured live on mal:1, mal:30, mal:5114) and the modern `https://anidb.net/anime/23`; index 2 of
`/perl-bin/animedb.pl` is the literal string **`animedb.pl`**, "so a record on the common shape whose
`aid` was missing did not mint `anidb:undefined` ... it minted `anidb:animedb.pl`, which looks like an
id. Every record that hit it minted the SAME one, and `upsertMedia` welds those"
(`R "The fallback that returned a script name" (2026-09-04)`). And `ID_IN_PATH` was unanchored, so it
also matched inside a QUERY STRING.

The JustWatch platform sweep found the same class across five platforms:
"HBO Max series urls are `/video/watch/<uuid>`, so a fixed path index returns the literal string
`"watch"` and every HBO title lands on `hbo:watch`. Measured: **25 titles in one cluster**, Curb Your
Enthusiasm with Rick and Morty" (`R "JustWatch was dropping five whole platforms" (2026-09-01,
f096e7d)`). Arms: what shipped 0 welds / 179 handles / 119 offers dropped; names-only fix **24 welds**;
now 0 welds / **515 handles** / **0 offers dropped**.

Also `HBO inverts the convention`: `play.hbomax.com/show/<uuid>` was 17 of 17 FILMS with 17 distinct
ids while `/video/watch/<uuid>` was 28 of 28 SHOWS, "so `show` is a container everywhere except the
one provider whose segment is spelled that way"
(`R "What the per-origin fan-out added that the corpus could not" (2026-09-04)`).

**Outcome**: SHIPPED for watchmode, justwatch and jikan. The rate at which a real MAL record carries
an unreadable AniDB link is **UNMEASURED**, blocked upstream by jikan answering 504 to every cold id.

**Must express**: every minted id must record the RULE that produced it (host + path shape) so a
constant-valued id is detectable as a contradiction the moment a second record produces it.

---

#### 41. A container id that is a film collection

**Sources**: Crunchyroll, kitsu, justwatch.

**Concrete**: "Crunchyroll gives a standalone film release its own `/watch/` url, but publishes a film
that belongs to a running series under the SERIES, so every film of a franchise hands back one id."
Fifteen kitsu film records share `cr:GQWH0M1GG` (slug `/dragon-ball-z-movies`); four Demon Slayer
films share `cr:GY5P48XEY`; six One Piece films share `cr:G5PHNMWX9`
(`R "The subtype could not see the shape" (2026-09-04)`).
The measured arms over 3000 kitsu records, 600 of them films:

| arm | handles minted | welded ids |
| --- | --- | --- |
| `was`, the subtype carve-out | 148 | **9** |
| `blanket`, refuse every film link | 0 | 0 |
| `denylist`, refuse the container segments | 84 | 0 |
| `now`, the (origin, segment) allowlist | **82** | **0** |

Cost counted: "141 films carried a readable link and 82 still do, so 59 lose their only one. **38 of
those 59 were welded to another film**."

**Outcome**: SHIPPED and works.

**Must express**: a container that is NOT a run and NOT a season either (a film collection), so a film
can be part-of it without any season arithmetic being attempted.

---

#### 42. Show-level ids with no finer alternative in existence

**Sources**: imdb (five sources mint it: tvmaze, trakt, simkl, omdb, watchmode).

**Concrete**: `SHOW_LEVEL_ORIGINS = new Set(['imdb'])` at `src/worker/store/db.ts:42`, read first by
`scopeOf` at `:91-92`. The doc at `db.ts:17-26` (quoted in `D start/run-and-show.md`): "TMDB and TVmaze
could be scoped because both model seasons; IMDb does not, so there is no honest season id to mint and
scoping would invent one that no source could independently reproduce." simkl stamps CONTAINER on
every non-film imdb id because "all five Mushoku Tensei records carry tt13303712"
(`src/sources/simkl/extractor.ts:89-92`).

Do NOT re-add uNoGS `imdbid` as an explicit dedup handle: "Their dataset maps both the 2006 Death Note
anime and the live-action film to the same imdb id" (`R "Gotchas"`).

**Outcome**: SHIPPED. Payoff NOT delivered: "no source declares `export const origin = 'imdb'`, so
imdb is never registered as an Origin, `originPage` never returns it, and the UI has no row to render
the link in" (`R "What is verified live, and what is not" (2026-09-05)`).

**Must express**: an origin-level declaration that its ids name containers, plus the ability for a
container link to reach the UI without an identity claim and without a registered run-level origin.

---

#### 43. Per-run ids that are show-level for a minority of entries

**Sources**: AniList `idMal`, kitsu `mal`, AniList `cr`.

**Concrete**, from the 59-agent audit (55 claims, **14 survived**, 75% refuted),
`R "Show-level handle audit: 14 confirmed findings" (2026-09-01)`:

- anilist `mal` at `anilist/extractor.ts:341`: "do NOT blanket-block: `idMal` is per-run for ~99.7%,
  and it is the primary cross-catalogue join key".
- kitsu `mal` at `kitsu/extractor.ts:79`: "AoT Final Chapters Part 1 and 2 share `mal:51535`; blocking
  `mal` would cost 3184 correct merges".
- anilist `cr` at `anilist/extractor.ts:169`: "two 2024-04-12 films share one CR series id".

And the recurring shape stated in `R "JustWatch nf: refusing costs 5 correct handles per suspect one"
(2026-09-04)`: `SHOW_LEVEL_ORIGINS` "keys on the ORIGIN of the handle uri and tests only the HANDLE
side. It cannot see a same-origin pair, a source emitting a show-level id as its OWN mediaUri (tvdb,
omdb, unogs), or a per-run origin like `mal` that is show-level for a minority of entries."

**Outcome**: OPEN by decision (the cost of blocking exceeds the benefit).

**Must express**: an id whose scope is a property of the INSTANCE, not of the origin, so 0.3% of
`mal:` ids can be containers while the rest are runs.

---

### Group G. Store and source mechanics the representation inherits

#### 44. Scores are per-source constants, and they decide every scalar

**Concrete**: AniList 0.9, jikan/MAL 0.9, anizip 0.9 on titles/covers/banners/episodes, crunchyroll
0.5, kitsu 0.3, offline 0.2, watchmode/justwatch/netflix/appletv/paramount 0.2 (values from
`R "The count rule" (2026-09-09)`, `R "The hero was gated on a source score" (ac81343)`,
`R "@kawaiioverflow/arm beats manami" (2026-08-17)`).

Two live defects from this:

- "anizip's MEDIA row carries no score ... `normalizeToStoreMedia` writes `media.score ?? null`, so the
  row sorts below Netflix and Apple TV for every scalar field the aggregate resolves by score: url,
  type, status, averageScore, popularity, startDate, endDate, isAdult, nextAiringEpisode, franchise,
  and season/seasonYear. It is the only scoring source in the tree with this gap." Raising it "flips
  who wins each of those fields in every cluster anizip is in"
  (`R "anizip's MEDIA row carries no score, so the most exact counts rank LAST" (2026-09-09)`). OPEN.
- A score was used as a proxy for source identity in the UI (`theater.tsx` selecting on
  `score >= 0.8`), which blanked the hero when AniList and Jikan were both down
  (`R "The hero was gated on a source score" (ac81343)`). "Gate UI on the fields it renders, never on
  a source-identity proxy." FIXED.

**Must express**: a per-field, per-source confidence attached to the claim, not a single per-source
constant doubling as a quality signal, an identity signal and a tiebreak.

---

#### 45. The count rule is LEXICOGRAPHIC TIERS, and a sum is wrong

**Concrete**: `src/worker/store/consensus.ts` `tieredConsensus` at `:36`, `runLength` at `:62`,
`runEpisodes` at `:157`. "the best score present decides which claims are looked at, the value the most
of them claim wins, and **nothing below that tier is consulted at all**. A source cannot be outvoted
by any number of sources beneath it. Owner's call, and it is the right one"
(`R "The count rule: LEXICOGRAPHIC TIERS" (2026-09-09)`).

Trimming an episode LIST needs two more bars: "at least two members must back the length (a count is a
fetched list length at twelve sources, so one row alone can be short), and only a STRICTLY LOWER tier
is trimmed". The weighted sum survives ONLY for trimming, behind "at least TWICE the weight of the
value being trimmed", with the margin taken from the corpus:
`anilist(0.8)=13 anizip(null)=12 kitsu(0.3)=22 mal(0.9)=12` (`R "The weighted sum, for the record"
(2026-09-09)`).

Interaction worth keeping (`D merge/anomalies.md`): `runLength` has NO two-witness bar, `runEpisodes`
does (`consensus.ts:234`), "so a cluster whose length rests on a single witness can list more than that
length and be reported for it, with the windowing that would have acted on it having deliberately
stood down."

**Must express**: claims grouped into provenance CLASSES with an ordering, where the classes are not
summable, plus a declared-versus-derived distinction on every count.

---

#### 46. The contradiction rules: a cluster visibly wrong about itself

**Concrete**: `src/worker/store/anomalies.ts` (72 lines, two rules). `disagreeingIds` at `:18-25` and
`overLength` at `:49-59`. The second: "A run listing more episodes than its sources agree it is long.
The one the membership rules cannot see, because the cluster is right about who it contains ...
Mushoku Tensei season 1 part 1 listed 24 for an 11 episode run this way (2026-09-09)." The fixture
says it in capitals: "THE CLUSTER IS NOT WRONG ABOUT WHO IT CONTAINS, which is why `together` and
`apart` cannot see this: the fold arrives as an episode list, not as a member"
(`tests/unit/worker/store/merge-fixtures.ts:383-384`, quoted in `D merge/anomalies.md`).

The detail line "recounts the witnesses rather than trusting the reader to":
`` `${listed} episodes listed against a length of ${length} that ${cluster.filter(...).length} of its sources agree on` ``.

**Outcome**: SHIPPED, tests only; the production twin is the seed gate (`findSeedWelds` in
`src/sources/offline/seed-gate.ts`, the seed job, removed in HOR-577, `SEED_MAX_WELD_SHARE = 0.02`, measured floor 1 in
359 on the first real walk of 358 runs, 2026-09-05).

**Must express**: rules that need no expected answer, evaluable over the whole graph at once, which
means the graph has to hold the evidence the rule reads (per-origin ids, counts with scores, the
listed set).

---

#### 47. A seed of the store's own output, fed back in

**Sources**: the `offline` source, the daily season-seed walk.

**Concrete**, three findings from the adversarial pass on `fbe97eb`/`ee7300b`/`f96e66b`
(`R "The season seed" (2026-09-05)`):

- **"Seed N+1 ratified seed N."** The exporter excludes the `offline` origin, "but justwatch's
  `mergeHandles` re-states the whole aggregated uri, so a wrong seeded id came back as a first-party
  SAME_AS and was re-exported as one." A walk now carries `?seed=off`.
- **"The seed opened another source's evidence gate and switched the fuzzy pass on."** It restored
  `startDate`, which `offline/normalize.ts` withholds on purpose, and shipped six titles a run,
  putting the whole cold listing into year buckets and evicting live titles from the six-slot profile.
  The seed now ships one title a run and no `status`, `startDate`, `endDate` or `popularity`.
- **"A seeded handle could overwrite a live row and stamp a permanent CONTAINER."** Handle nodes are
  now PLACEHOLDERS, identity only, no url, no scope stamp; the store does not store a placeholder, so
  the claim waits under `pendingClaims` (`src/worker/store/db.ts:124`) until the owning source
  describes that uri.

Owner's rule: "it goes in the OFFLINE source, it must not replace any real source that fetches at
runtime, those are the true sources we trust, offline is only for the initial fast load."

**Must express**: a claim that carries identity only, with a rule that a node contributing no field
cannot take one; and a provenance marker strong enough to keep an export from re-ingesting itself.

---

#### 48. A claim that arrives before the row it is about

**Concrete**: "A claim naming a uri with no row WAITS for the row (`pendingClaims` in `store/db.ts`).
A row rebuilt from an aggregated uri carries only uri, origin and id, and is not stored at all; the
claim is replayed through the same derivation when a source describes that uri. **Arrival order
decided the scope before**, and a bare sibling landing before its owner's CONTAINER row unioned as
RUN" (`R "What landed, and the second bridge under the first" (2026-09-05)`).

**Outcome**: SHIPPED and works (`src/worker/store/db.ts:124-158`).

**Must express**: claims as deferred, replayable facts, evaluated when their subjects exist, so no
outcome depends on HTTP arrival order.

---

#### 49. A container cluster that has no run on the page

**Concrete**: `hideAttachedContainers` (`src/worker/store/db.ts`) "only drops clusters with NO run
member". A listing shows runs; "a container cluster attached by PART_OF to a run cluster on the same
page is hidden, because that run's card already represents the show; a container with no run on the
page still gets a card, which is today's behaviour for live-action catalogues"
(`R "Two identity spaces" (2026-09-05)`). And `findMediaForPage` / `preferAttachedRun` makes a show
page show its earliest attached run, "read backwards along the edges with the new `graph.sources`";
without it "a live-action show page, whose only rows are containers, lost every episode and offer that
the weld used to hand it."

The open orphan: "Storing the containing season creates a new orphan ... `assembleMedia` stamps
`scope: 'RUN'` on a season-scoped netflix media (`unogs/extractor.ts:271`), so a lent season would
survive as its own card on any listing"
(`R "Two more blockers found on the way" (2026-09-10)`).

**Must express**: a container as a first-class node with its own page and its own listing rules, so a
lent or borrowed season is not forced to be either a run or invisible.

---

#### 50. A relation is a different axis from sameness

**Concrete**: `MediaHandleRelation` is `SAME_AS | PART_OF`; narrative relations (PREQUEL, SEQUEL,
ADAPTATION) got their OWN enum on their own field, and "the new enum unions nothing and no relation
can ever weld two rows together" (`R "A handle is an edge now" (2026-09-05)` and
`R "Media relations and the franchise graph" (2026-09-08 to 09)`).

Two measured traps in the narrative axis: following every edge from
`Tensei Shitara Slime Datta Ken` reached "**36 works of which 10 were other franchises**" because
CHARACTER edges cross franchises (one crossover short reached seven unrelated shows); STORY edges only
reached 21 works and nothing foreign. And `relationType` must be asked as `relationType(version: 2)`,
because version 1 "collapses SOURCE into ADAPTATION, so the novel a show was adapted FROM is labelled
as something the show is an adaptation OF. Backwards, on every franchise, with every card still
rendering and nothing erroring."

**Design note recorded**: the alternative to the edge type was a second `links` field, rejected
because "A second field fails SILENTLY. An edge type fails at COMPILE TIME." Measured surface: 49
producer sites, 25 consumer reads across 10 files.

**Must express**: several independent relation axes over the same nodes, where only one of them is
identity, and traversals declare which axis they follow.

---

#### 51. Episode containment is declared, written, and read by nothing

**Concrete**: `EPISODE_SAME_AS` and `EPISODE_PART_OF` at `src/worker/store/db.ts:45-46`;
`EPISODE_PART_OF` "has one writer and no reader", `episodePartOf` in `src/sources/utils.ts` is
called nowhere, and `makeEpisode` coerces a bare handle to `episodeSameAs` (`D reference/divergences.md`
entry 8). Also: the `graph.link(episodeUri, handleUri, EPISODE_SAME_AS)` at `db.ts:410` "runs with
none of `upsertMedia`'s guards, and it accepts a uri that was never `set`, because `find` calls
`ensure`."

**Outcome**: OPEN, recorded "so that a future reader does not assume episode containment is modelled
and build on it."

**Must express**: episode-level containment as a real, readable edge, since the fold case (9, 12, 13,
15) is exactly episode containment.

---

## Part 2. The refutations: measured and rejected, do not retry

Each row is an approach that was BUILT or MODELLED and then refused by its own numbers.

### R1. A single offset aligning a Netflix season onto a cour (title-vote)

**Refuted 2026-09-10**, `R "THE FOLD FIX WAS DESIGNED AND REFUTED, with live evidence. Do not ship it
as offsets."` Three designs from a workflow, and "all three adversarial passes refuted the winner
independently, on real data."

Numbers: Blue Exorcist netflixid 70304252, season 1 is 26 rows for a 25 episode run, position 14 is a
special that aired after the run ended. A title-vote alignment scores `[[0,12],[1,11]]`: **offset 0
wins by ONE vote, no tie, so it ANSWERS, and 13 of 25 rows then carry the wrong Netflix episode**,
each with a playable url. "A wrong alignment is worse than a missing one, and nothing downstream can
tell them apart: `consensus.ts:284` only skips when the offset is null, and the window at `:236-240`
keeps exactly `1..length`, which is precisely the wrong slice of the right size."

Note the contrast with case 13: the DATE-anchored `alignmentOffset` (`consensus.ts:113`) DID ship, and
it refuses on fewer than 2 witnesses, on a tie, and on any day naming more than one reference episode.
The refuted design is the TITLE-vote one over folded Netflix seasons.

### R2. A per-episode title join minting `EPISODE_SAME_AS`

**Refuted 2026-09-10**, measured, NOT shipped.
`R "The per-episode title join does not work, because Netflix retranslates"`. Proposed by the assistant
and approved by the owner as the successor to R1.

netflix 80987039 season 2, live from unogs, against our stored episode titles:

| ours | netflix |
| --- | --- |
| Guardian Fitz | Fitz the Guardian |
| The Brokenhearted Mage | The Depressed Magician |
| The Forest in the Dead of Night | The Midnight Forest |
| Abrupt Approach | Fast Approach |
| Letter of Invitation | Letter of Recommendation |
| I Don`t Want to Die | Unwilling to Die |
| These Feelings | This Feeling |
| I Want to Tell You | I Want to Convey |
| Magic Circle to the Sixth Stratum | The Magic Circle on the Sixth Floor |

**4 exact normalised matches out of 25**, and only where two independent translations coincided.
"**Netflix commissions its own English subtitles**, so its episode titles are a different translation
of the same Japanese, not a different spelling of the same English. A title is therefore not an
identity across this boundary at all."

And no threshold rescues it: with the repo's own `titleSimilarity`, the highest scoring WRONG pair is
`I Don't Want to Die` against `I Want to Convey` at **0.5463**, while its own TRUE partner
`Unwilling to Die` scores **0.4537**. "Any cut admitting the true pair admits the wrong one first."

Two further blockers found on the way, both independent: our own side is not clean at the point the
join would run (`resolveSimilarRuns` builds its episode evidence from the RAW walk,
`findAggregatedEpisodesForMedia`, not from `findRunEpisodes`, so the S2 cour-1 cluster carries BOTH
cours' titles); and storing the containing season creates a listing orphan (case 49).

**What IS true and survives**: "`graph.cluster(ep.uri, EPISODE_SAME_AS)` expands every walked episode
to its whole SAME_AS component (`db.ts:449`), so a SAME_AS edge alone would pull a netflix episode
into a run's group with NO loan, no `HAS_EPISODE` write and no renumbering. The mechanism was never
the problem. The data is."

Note: episode titles ARE decisive in the other direction, between two metadata catalogues.
`pickSimilarSeason` Rule 2 uses them (three or more shared, covering 60% of the season's:
`MIN_EPISODE_TITLE_MATCHES = 3` at `src/sources/similar.ts:69`, `EPISODE_TITLE_COVERAGE = 0.6` at
`:67`) and it is "the only rule that tells two same-year cours of twelve apart".

### R3. A weighted sum of source scores to resolve `episodeCount`

**Refuted and PULLED 2026-09-09**, `R "The count rule: LEXICOGRAPHIC TIERS, after a weighted sum was
tried and refuted"` and `R "The weighted sum, for the record"`. Three independent adversarial passes
broke it, each with a real cluster:

```
Mushoku S1 part 1 once the streaming tier echoes Crunchyroll's packaging:
    24 = cr 0.5 + jw 0.2 + nf 0.2 + appletv 0.2 + paramount 0.2 = 1.3
    11 = mal 0.9 + kitsu 0.3                                    = 1.2
Mushoku S3 while airing: mal and AniList publish the announced 14, six sources publish
    episodes.length = the 11 aired so far, and the sum goes 1.8 to 1.7 for 11.
anizip(null)=12 cr(0.5)=10 kitsu(0.3)=12: anizip's agreeing 12 weighs ZERO, so 10 wins.
```

"Five catalogues restating one packaging is ONE witness counted five times, and a sum cannot tell the
difference." Measured over the 100 cluster snapshot in `dist-seed/snapshots.jsonl`: the vote was
**identical to today's first-non-null-in-score-order in 100 of 100 clusters**, 35 of which disagree
about their own length. "No benefit, and a real failure class. Reverted rather than shipped."

Conclusion carried forward: "a sum over sources is the wrong shape. The vote wants provenance classes,
a declared count beating a derived length, and anizip scored, before it is worth anything."

### R4. Making season SILENCE block a merge

**Refuted 2026-08-29**, `R "Closing the season veto gap by LABEL was measured and refused" (1432a9e)`.
"It refuses 323 wrong welds and costs 12007 correct merges, one stopped per 37 destroyed. 11415 of the
loss is streaming-cluster attaches, the job the pass exists for. Ten narrower variants were measured;
the best reaches ratio 0.22 and none reaches 1."

The suggested better axis, BROADCAST QUARTER, separates "**118 of the 152 one-silent pairs (77.6%)**"
and reaches "**465 of the 896 pairs where NEITHER side names a season**", 583 of 1095 against the label
rule's 323. **NOT implemented and NOT measured for cost.**

### R5. A quarter check as the date comparison in `sameShow`

**Refuted 2026-08-29** for that role: "A quarter check is the wrong shape and is wrong in BOTH
directions, which direction dominating depends on the window width. Use a day window"
(`R "The start-date axis: measured, built, refused for now"`). Note this is a different question from
R4's quarter VETO, which remains unmeasured.

### R6. Tuning or length-adapting `SIMILARITY_THRESHOLD`

**Refuted 2026-08-11** (case 25) and re-confirmed by `npm run calibrate`, `R "Title matching is
calibrated" (2026-08-29, 909eaec)`: 243194 correct-match pairs from synonyms and 139507 wrong-match
pairs from `relatedAnime`, sweeping every gate through the REAL exported scoring functions.
**"The verdict was: change nothing."** Also, from `R "Gotchas"`: "The dedup title threshold must stay
at or above 0.9, and every 0.01 step above it is bad value (it loses ~1400 correct pairs to refuse ~30
wrong ones)."

And `TITLE_MATCH_THRESHOLD` stays 0.44 "NOT for the reason written above it": its stated anchor pair is
unreachable, and "every 0.01 step above it has an exchange ratio of 0.76 to 0.97, losing more correct
matches than wrong links it refuses". The unOGS "Woochi" weld it was credited with refusing scores
0.5200 and passes at 0.44 and 0.5 alike; the category veto is what refuses it.

### R7. unOGS: requiring the ordinal and the count to AGREE

**Refuted 2026-09-04**, `R "unOGS: making the ordinal and the count AGREE costs 6 good handles per
weld"`, over 105 runs:

| arm | welds | season-scoped | refused |
| --- | --- | --- | --- |
| `refuse-properly-lone`, SHIPPED | 11 | 49 | 56 |
| `ordinal-and-count` | **8** | **31** | 74 |
| `ordinal-unless-contradicted` | 11 | 47 | 58 |

"The strict arm removes 3 welds and loses 18 assignments: six correct handles per weld avoided. The
soft arm buys nothing at all and still costs 2." The surviving welds are not the ordinal's fault:
`nf:81091393-3` holds two Demon Slayer runs of ELEVEN EPISODES EACH, "which no count axis can
separate", and `nf:80179798-3` holds Mob Psycho 100 and Mob Psycho 100 III.

### R8. Refusing JustWatch's `nf` handles

**Refuted 2026-09-04**, same section: "Refusing `nf` costs 66 correct to remove 13 suspect, and RISKY
is generous: it flags every handle in a disagreeing show, season 1s included." What changes the answer
is not a threshold: "The day unOGS [implements `similarMedia`], JustWatch can ask which Netflix season
its run is and stop guessing, and the 13 go to zero without costing the 66."

### R9 and R10. kitsu film links: blanket refusal, and a denylist

**Refuted 2026-09-04**, `R "Why it is a filter and not a blanket refusal for films"`. See case 41's
table: blanket mints 0 handles; the denylist mints 84 with 0 welds; the allowlist mints 82 with 0
welds. "An allowlist rather than a denylist on the container segments, which is what was written
first. `!CONTAINER_SCOPES.has(scope)` mints every segment nobody has measured, and minting has no
inverse." The proof: widening `ID_IN_PATH` to `/dp/` under a denylist mints `amazon:B07579MDR5` on
**ten records, all ten Kara no Kyoukai films**.

Also refuted as a CONTROL: "`blanket` is a price tag, not a control. It mints nothing by construction,
so `expect(blanket.handles).toBe(0)` is `expect(0).toBe(0)` and cannot fail for any corpus."

### R11. Dropping the kitsu subtype gate in favour of the url shape

**Refuted 2026-09-04**: "Applying the predicate to cour records ... welds **37 Netflix title ids**
across 2400 records: `nf:80135674` carries all five seasons of Boku no Hero Academia, `nf:80179831`
five runs of JoJo, `nf:80095241` four of Castlevania."

### R12. A lone-season carve-out for the JustWatch Crunchyroll refusal

**Refuted 2026-09-04**, `R "The cost, measured"`: 48 SHOW nodes lose a handle against 17 MOVIE nodes
that keep theirs; sampling 20 of the 48, 11 are multi-season and 9 single. "The 9 single-season shows
lose their handle for no weld to prevent, and that is the honest cost. A lone-season carve-out was
considered and refused ... nothing establishes that the crunchyroll season the episode resolves to is
OUR run either, and keeping a handle because refusing loses an offer is exactly the reasoning that
produced the kitsu movie carve-out that had to be undone the same morning."

### R13. Wiring Apple TV's catalogue gate without season-scoping its ids

**Reverted 2026-08-29**, case 2. "A gate that matches a season cluster to a show entry is only correct
when the source then mints a season-scoped id." Separately, the Apple TV row in `catalogue-gate.ts`
"is a MODEL of a catalogue, not a measurement of Apple's: against the live UTS endpoint, **0 of 150
anime TV titles and 0 of 120 anime films clear 0.90**, while a 'Severance' control is admitted at
1.0000."

### R14. Raising the `offline` or `kitsu` SCORE

**Refused**, `R "Gotchas"` and `R "The hero was gated on a source score"`: "Do not raise the `offline`
source's `SCORE`. It is 0.2 for two separate reasons, and the per-item one is the subtle half"
(titles at 0.9 would tie with anilist and jikan and push a static dump's titles into the six-slot
profile). "Do not raise Kitsu's `SCORE` to fix this class of bug. That constant decides which source's
title, description and cover win a merge."

### R15. Capping each source at one re-ask

**Refuted by peer review**, `R "A source is asked for the ids it PUBLISHES, never for the ids it
UNDERSTANDS" (2026-09-09)`: "a source whose needed id lands in a LATER batch than the one that first
named something it understands is asked too early, refuses, and never gets another chance. anizip
survives that cap only because anilist happens to contribute anidb, kitsu, mal and offline in a single
upsert." The real bound is one question per declared origin plus one; per `D reference/divergences.md`
entry 1 the ceiling is 6 for `offline` and 4 for `anizip`, not the 2 or 3 the comments claim.

### R16. A second `links` field instead of an edge type on `handles`

**Rejected 2026-09-05**, case 50: "A second field fails SILENTLY. An edge type fails at COMPILE TIME."

### R17. Widening only `normalizeTitle`

**Refuted 2026-08-11**: "**Widening only `normalizeTitle` is worse than doing nothing**: once profiles
hold CJK, `sameShow` hands CJK to `titleSimilarity`, which strips it back to the latin fragment, and
two Cardfight!! Vanguard seasons then score a perfect 1 on `divinez`."

### R18. Reading `extendsId` symmetrically

**Refuted**, `D merge/anomalies.md`: read symmetrically, a cluster holding `A`, `A-1` and `A-2` has no
surviving id at all and the rule "reports nothing about a cluster that has welded two seasons of one
series together."

### R19. The three public mapping datasets as a Netflix episode source

**Refuted 2026-09-10 by fetching them**, `R "The three mapping datasets do NOT solve it"`:

- **Anime-Lists/anime-lists**: 16,935 rows, `anidbid tvdbid defaulttvdbseason episodeoffset tmdbtv
  tmdbseason tmdboffset tmdbid imdbid`. **No Netflix** (`grep -ci netflix` = 0 against live controls).
- **Fribb/anime-lists**: same id spaces plus tracker ids. **No Netflix.**
- **notseteve/AnimeAggregations**: carries Netflix on 417 of 16,189 anime (2.6%), 346 distinct ids, at
  **title granularity with no season or episode position**; 51 Netflix ids attach to more than one
  anidb entry; **80987039 (Mushoku) appears nowhere in it.**

### R20. Composing the tvdb `episodeoffset` onto a Netflix season

**Refuted by test**, same section: works for JoJo Stone Ocean (offsets 12 and 24 land exactly,
title-confirmed) and Sakamoto Days (offset 11 -> S1E12 "Overload"); FAILS for Kengan Ashura (tvdb
offset predicts S1E13; Netflix has 12 in season 1 "because Netflix SPLIT what tvdb folded") and for
Mushoku twice over (no join at all, and off by one because of the special at S2E1). "So the offset is
not lookup-able and not safely inferable."

### R21. uNoGS `imdbid` as an explicit dedup handle

**Refused**, `R "Gotchas"`: their dataset maps both the 2006 Death Note anime and the live-action film
to the same imdb id.

### R22. Writing the ani.zip entry KEY into the plugin's release-number map

**Refuted 2026-09-09**, `R "The key is deliberately NOT a number a release may claim"`. The argument
FOR looked strong (groups do not all continue the count: `[Erai-raws] Sakamoto Days Part 2 - 01`,
`[Erai-raws] Dr. Stone - New World Cour 2 - 08`), "**It is void, because those names never reach the
numbering at all**": `parseRelease`'s batch pattern matches the `2 - 01` inside `Part 2 - 01` so the
release is read as a BATCH and dropped earlier. Meanwhile the cross-cour leak is real:
`Mushoku Tensei S2 - 01` is the PREVIOUS cour's episode 1 and passes both the season check and the
airing window.

### R23. sacha as the release PARSER

**Refuted 2026-09-09** over 1497 real names: "sacha's `episodeTerms` yields a usable single episode
number on **0 of 1497** against the plugin's 972 ... Adopting it as the parser would have dropped
roughly 58% of the rows the source keeps." Later, sacha as the MATCHER was also replaced by frizbee:
"Over 10,590 labelled decisions sacha has NO error free threshold at any value; frizbee has a window."

### R24. Dropping nyaa's trusted pass in favour of the wide pool

**Refuted 2026-09-09**, `R "Trust is not a preference order, it is a second slice of the index"`:
"dropping the trusted pass took SPY x FAMILY Part 2 (2022) from 13 episodes to **ZERO** and One Piece
from 76 to 67, since the newest season fills all eight pages before the older one is reached. The
narrow pool is the DEEP one." Both, unioned, is what shipped.

### R25. The per-episode gap query on nyaa

**Refuted 2026-09-09**: "It asked nyaa for each missing episode by number, and returned **0% of the
episodes it asked for** at every term count from 1 to 48 ... The same budget spent re-walking the
broad query ordered by SEEDERS returns 312 episodes against its 127."

### R26. A translation bridge for ani.zip numbering inside stub

**Refuted 2026-09-09**, `R "Why the bridge did not go in stub, where it looks like it belongs"`:
"`Media.episodes` REGROUPS the merged episodes from scratch in the resolver, so a rule landed only in
`mergeByEpisodeNumber` would ship completely inert."

---

## Part 3. The invariants the record says must survive

### I1. Irreversibility

`graph.link` is a union-find union with **no inverse**: "There is no unlink, no split, and no record
inside the union-find of which pair caused the merge. A `SAME_AS` minted for a show id is permanent for
the session, and the only fix is a reload"
(`D start/run-and-show.md`, on `src/worker/store/db.ts:193` and `graph.ts:279-291`).
"`graph.edge` and `graph.connect` write adjacency and can be reasoned about after the fact. `link` is
the one primitive that destroys the information needed to undo it."

Corollary from `R "Kitsu welded three Mushoku Tensei seasons..."`: "one bad row welds permanently and
the merged cluster then goes on to weld a third."

**The governing rule**: "guesses go on edges, which can be deleted; only asserted sameness within one
scope goes on a union, which cannot" (`R "Two identity spaces" (2026-09-05)`).

### I2. The RUN versus SHOW exchange rate

`src/sources/crunchyroll/extractor.ts:361-364`, quoted in `D start/run-and-show.md`:

> Anything missing is a refusal, never a guess ... That is the correct trade. A missing row is a
> nuisance; a wrong row is a lie about what the user is about to watch, and it is not recoverable
> without a reload.

The owner's own phrasing: "we would rather have no relationship than broken relationships"
(`R "Why it is a filter and not a blanket refusal for films" (2026-09-04)`).

Its asymmetric counterweight, which must also survive: refusing is NOT free, and three measured cases
say so. Refusing `nf` costs 66 correct handles to remove 13 suspect (R8). Refusing on season silence
costs 37 correct merges per weld stopped (R4). Removing the first-of-month guard costs 77% of
streaming attachments (case 33). "A link that has to assert a false identity to exist is not worth
having" (`src/sources/unogs/extractor.ts:215-218`) is the rule; the exchange rate is what decides each
case, and every one of them was measured rather than argued.

### I3. Scope is a ratchet toward CONTAINER

`src/worker/store/db.ts:146`:
`const scope: MediaScope = scopeOf(media.uri) === 'CONTAINER' ? 'CONTAINER' : media.scope ?? 'RUN'`,
with `db.ts:142-145`: "Scope is STICKY toward CONTAINER ... The failure with no inverse is a wrong
SAME_AS, and the failure of a wrong CONTAINER is a missing SAME_AS, which a later slice can recover."
Note why the ratchet needed code: `lastWriteLongestArray` (`db.ts:85`, `graph.ts:396`) is
`result[key] = val ?? existing[key]`, so "every scalar a source writes overwrites what was there".

### I4. An id must be reproducible by a second observer

`D start/run-and-show.md`: "That is the test for an honest id: **a second observer can reproduce
it**." `230388` is JustWatch's own number for that season; "`-s2` derived from a position in a list is
not, which is why an ordinal-minted id is *a guess wearing a precise uri*"
(`src/worker/extractor.ts:188`). The four shapes and who may mint them are in
`D sources/season-ids.md` and `D start/run-and-show.md` "Who can mint a run id, and who cannot".

The measured failure of the other direction: `.map(normalizeMedia)` passing the array index as a season
number minted "`tmdb:<id>-s0`: a well-formed, precise, entirely invented id"
(`src/sources/tmdb/extractor.ts:198`).

### I5. Provenance loss, in four measured shapes

1. **Per-field provenance is lost at aggregation.** The hybrid row (case 20): "a contaminated group
   does not look like a wrong row, it looks like a right row with one wrong field."
2. **Provenance is lost inside the union-find.** I1: no record of which pair caused the merge.
3. **A partial selection truncates everyone else's copy.** "Every array in the new selection is
   selected WHOLE ... a row is written back with what was asked for, so a partial selection truncates
   everyone else's copy. `titles { title }` alone cost crunchyroll's rows their language and score on
   2026-09-05" (`R "THE EPISODE-SOURCE BUG" (2026-09-10)`). The same class:
   "a partial handle node written back as a row had replaced crunchyroll's titles with copies lacking
   language and score" (`R "Round three, same day" (2026-09-05)`).
4. **Five catalogues echoing one packaging is one witness.** R3's echo tier.

### I6. Folded cours

- A catalogue season may CONTAIN two or more of our runs (case 9). The one-directional fold veto
  (`foldVetoed`, `src/sources/similar.ts`) is the rule: "A season holding MORE episodes than
  the run holds other runs too (Netflix season 2 = 25 over 13 and 12). Zero tolerance."
- "Exported because a picker that answers on its own axes still needs it: Crunchyroll's search path
  matches on title and premiere, and **a catalogue that folds two cours into one season premieres on
  the SAME DAY as the first of them, so neither axis can see the fold**" (same doc comment).
- A container may lend its episodes without claiming identity (case 12).
- The inverse direction (a run split across seasons) is not covered by the veto (case 10).

### I7. Retranslated titles

R2's measurement is the invariant: a title is not an identity across a catalogue boundary that
commissions its own translation. 4 of 25 exact; the best wrong pair (0.5463) outscores its own true
pair (0.4537). Also `isGenericEpisodeTitle` (case 21) and the 11-of-25 placeholder rate.

### I8. The diacritic gate

`ô` against `ou` is a documented, accepted loss of `CONFIDENT_TITLE_THRESHOLD = 0.9`, currently costing
JustWatch's `Nige jôzu no wakagimi` its only match (case 28). "The fix belongs in the normaliser rather
than in lowering 0.90", and the gate "carries measured exchange rates over 150 seasons and deserves its
own measured change."

### I9. The 13 versus 12 run length

"MAL publishes no count for Mushoku season 2 part 1 and AniList says 13 for a run that aired 12, so the
length rested on one witness, the bar disabled every window, and the lent season put 24 rows on a 12
episode page. A LOAN is refused whole when the length is uncorroborated; a MEMBER's episodes are never
hidden that way, because that is how episodes that aired disappear"
(`R "Four defects only the running app showed" (2026-09-09)`).

The same 13-versus-12 recurs in the trim margin: `anilist(0.8)=13 anizip(null)=12 kitsu(0.3)=22
mal(0.9)=12`, "the consensus is 12 by 0.9 against 0.8, and trimming on 0.1 would hide a thirteenth
episode AniList may be right about, while kitsu's 22 at 0.3 against 0.9 is a show-level count that
should go. Twice the weight is the line between them" (`R "The weighted sum, for the record"`).

And the airing-run variant: "mal and AniList publish the announced 14, six sources publish
`episodes.length` = the 11 aired so far" (R3). A declared count and a derived length are different
kinds of claim.

### I10. The 24 versus 2x12 fold

The single most cited defect in the record. Mushoku Tensei season 3, a 14 episode run, drew **24 rows**
(`R "Kitsu welded three Mushoku Tensei seasons..." (2026-08-31)`); Mushoku Tensei season 1 part 1, an
11 episode run, listed **24** through an episode list rather than a member (`overLength`'s own doc,
`src/worker/store/anomalies.ts:49-59`); the lent season put **24 rows on a 12 episode page** (I9).
Three different mechanisms, one visible number.

The structural cause, stated at `R "Five sources were hanging every season on one media" (2026-09-04)`:
"every media in this store is one run, `episodeNumber` is within-season, and `Media.episodes` groups
the union of every HAS_EPISODE edge in the cluster by `episodeNumber` ALONE. So the row count becomes
the LONGEST season and the rows come from whichever source scored highest per row."

### I11. The tier rule

Cases 45 and R3: "the best score present decides which claims are looked at, the value the most of them
claim wins, and nothing below that tier is consulted at all. A source cannot be outvoted by any number
of sources beneath it." Trimming needs two witnesses AND a strictly lower tier AND twice the weight.

### I12. Main titles only

Case 29: main titles collide ZERO times across unrelated anime in both catalogues measured; synonym
fields carry `minna no uta` on 23 and 21 unrelated shows. "No source needs disabling; one FIELD does,
and it already is. Anyone adding a synonym field to an extractor reintroduces the whole class."

### I13. The season pair is quoted, not merged field by field

"`SUMMER` and `2026` only mean anything together, and the filter matches on both, so merging them field
by field can produce a pair no source asserted and put a media on a season page nothing filed it under.
`seasonOf` in `aggregate.ts` takes both from the highest-scored member naming a season"
(`R "The season pair is quoted from one source, unlike every other scalar" (2026-09-06)`).

### I14. Episode grouping by number is safe only inside one run cluster

Case 19's stated precondition, and case 51's warning that episode containment is not modelled.

### I15. Determinism

Case 30 (arrival order deciding the six titles), case 48 (arrival order deciding scope), and
`D merge/anomalies.md` ("The report is deterministic ... a list that reorders itself between runs is a
flake"). Also `R "Two churn bugs on the home page" (2026-09-06)`: "a listing that re-sorts on every
update and a picker memoized on a COUNT are the same mistake. Once something is on screen, the question
is not 'what is best now' but 'is what I showed still valid', and identity is what answers it. An INDEX
cannot: it names a position, and the position's occupant changes." The cluster `_id` rides the
union-find root (`graph.componentId`), with the retired id aliased to the survivor
(`R "Round two, same day" (2026-09-05)`).

---

## Part 4. Open problems the record names and never closed

1. **What bridges season 1 to season 3.** "ARM B shows the bridge forms when the aggregated uris are
   opened, which points at the `buildHandlesFromUri` re-assertion, but the exact chain is not proven
   and should not be guessed at" (`R (2026-09-05)`). Zero of five weld runs measured at `46c712d` and
   `2e7057a`, but the mechanism was never named.
2. **A uri-derived handle should be a POINTER rather than an assertion** (case 8). "It is a design
   decision, not a patch, and it needs the owner."
3. **Per-episode Netflix sources on a folded cour.** "not reliably achievable from unogs ... Anything
   better needs an episode-level identity nobody publishes: not a title, not an offset, and not the
   anime-lists datasets" (`R (2026-09-10)`).
4. **Watchmode's surviving provider handles are still show level** (`nf:80987039`, hulu, disney,
   amazon, hbo). "By the reasoning applied everywhere else this session they should all be refused ...
   It was NOT done, because it would leave watchmode contributing almost nothing"
   (`R "OPEN: watchmode has no season concept" (2026-09-04)`).
5. **The BROADCAST QUARTER veto is unmeasured** (R4). It reaches 583 of 1095 pairs the label rule
   cannot; its cost arm "is what decides it" and has never been run.
6. **Two clusters inside one 45-day window of one catalogue season still weld**
   (`src/sources/catalogue-gate.ts:17-23`), and the residue `11 of 105` from the other side
   (`src/sources/season.ts:170-173`).
7. **`?? media?.episodes?.length` turning "no count" into ZERO** (case 23). Behavioural cost
   unmeasured.
8. **anizip's media row carries no score** (case 44). "Raising it is not free."
9. **Duplicate unogs rows inflating a season's count** (case 16).
10. **The container page is not built.** Listed as deferred in `R "Two identity spaces" (2026-09-05)`
    and still open after rounds two and three.
11. **imdb has no registered Origin**, so the PART_OF payoff does not reach the UI (case 42).
12. **`EPISODE_PART_OF` is declared, written and read by nothing** (case 51,
    `D reference/divergences.md` entry 8).
13. **A genuine January 1 premiere is indistinguishable from the sentinel.** "Closing it needs an
    explicit precision field on `Media`, touching every extractor, and 0.52% does not pay for that
    yet" (case 33).
14. **A refusal on partial evidence and re-asking.** Round two left it open; round three added re-ask
    on a changed question (four asks per pair per session) but the record still lists as open
    "a wrong container union upstream now becomes a wrong run identity whenever the rules happen to
    fit, bounded by the fuzzy pass's 0.9 threshold and year buckets" (`R (2026-09-05)`).
15. **`similarMedia` is answered by five sources and could be answered by more.**
    "Six sources could serve it and do not yet: appletv and tvmaze are the cheapest ... trakt/simkl/tvdb
    are key-gated, justwatch is year-only" (`R (2026-08-31)`); by `R "Round two" (2026-09-05)`
    crunchyroll, unogs, justwatch, appletv and tvmaze answer, so that list is partly closed
    **(unconfirmed which of the six remain)**.
16. **JustWatch and Apple TV gating on the ORIGINAL title.** Fixed for JustWatch (`e7bad56`); Apple TV
    was reverted, so `appletv/extractor.ts:137` scoring `Solo Leveling Season 2 -Arise from the
    Shadow-` at 0.2513 against `Solo Leveling` **(unconfirmed whether that line still stands today)**.
17. **`trakt/extractor.ts:79` mints a bare tmdb id** and "was NOT touched" (case 39).
18. **`SEED_MIN_MEDIAN_IDENTITY = 4` was guessed, not measured**, against a measured median of 3, and
    the quarterly walk "will walk 100 pages and publish nothing until it is settled"
    (`R "What the seed walk is now for" (2026-09-06)`).
19. **The two popularity sorts are inverted** (`D reference/divergences.md` entry 4): `POPULARITY`
    sorts descending and `POPULARITY_DESC` ascending. Real, and behind an enum member nothing sends.
20. **`MediaPage`'s five cursors and four counts have no producer** (`D reference/divergences.md`
    entry 9).
21. **No error boundary anywhere in the app**, so "any render time throw anywhere in this app becomes
    permanent DOM corruption rather than one failed render"
    (`R "The homepage stacked copies of itself on back and forward" (2026-09-09)`).
22. **A direct navigation to a wide media uri never opens the modal**, "on production and locally,
    before and after this change. The modal matches against the home listing's own narrower uri"
    (`R "Still open, deliberately not taken" (2026-08-31)`).
23. **The rate at which a MAL record carries an unreadable AniDB link is unmeasured**, blocked by
    jikan 504ing every cold id; the probe checkpoints and resumes
    (`R "The rate is UNMEASURED, and the blocker is upstream" (2026-09-04)`).
24. **The measurement that would reopen the 64 refused Crunchyroll film links.** "If Crunchyroll models
    a film collection like `GQWH0M1GG` as ONE SEASON PER FILM, `matchSeasonByDate` on a film's release
    date would return that film's own season and recover most of the 64 refused handles with no weld at
    all. If it models them as episodes of one season, all fifteen collapse one level down and it is the
    same bug." Unverified: the anonymous Crunchyroll token answers a Cloudflare interstitial from this
    machine (`R (2026-09-04)`).
25. **A cheaper lever nobody has priced**: "a show-level media does not need `${launch_year}-01-01` at
    all ... With no date its `years` set is empty, it is added to NO bucket, and the fuzzy pass never
    compares it with anything. The cost is that a crunchyroll search hit would stop enriching any
    cluster" (`R "What is settled and what is not" (2026-09-05)`).
