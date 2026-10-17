# Refutation of `proposal-evidence-first.md` through the edge case lens

Every row below was decided against the proposal's own text (its DDL, its queries, its walkthroughs) and
against the record in `00` to `03`. Where the proposal's query contradicts its walkthrough, the query is
taken as the design and the walkthrough as the claim. Five code facts were re-read to settle a dispute and
are quoted with `file:line`.

Verdicts: **HOLDS** (the stated rule and the real rows produce the right edge), **FIXABLE** (wrong or
missing, repairable inside the design), **FATAL** (a case or contract the design cannot satisfy without
changing one of its own principles).

---

## Part 1. The 51 cases

| # | case | verdict | how, concretely, or why not | what would fix it |
| --- | --- | --- | --- | --- |
| 1 | Kitsu's show level CR link on three season rows | HOLDS | kitsu's shipped allowlist (`03 kitsu`, `kitsu/stream-id.ts`) still emits PART_OF, so ingest writes `CLAIMS {relation:'PART_OF'}`; `claims` row "RUN x CONTAINER: PART_OF whatever was claimed" (5.2) makes the same edge even if kitsu regressed to SAME_AS, because `cr:G24H1N3MP` is CONTAINER by cr's own `scopeOf` and the ratchet. Walk 8.5 is correct. | nothing |
| 2 | A handle bypasses every merge veto because it is an id | HOLDS, with a priced exemption | `SAME_AS` of strength TITLE, SIMILAR and ANSWER all meet the same predicate functions in `title-match` and again in `vetoes` (5.3, 5.6), which is case 2's "same evaluation path". ID strength is deliberately exempt from format/season/start-date/companion but NOT from `fold`, `split`, `includes` or membership's id check. | nothing; it is decision 8, priced by R8 and 01 case 36 |
| 3 | A SHOW's date stamped on a SEASON row | FIXABLE | The weld mechanism is untouched: `title-match` scan A and B bucket on `da.year` from any member's `DateClaim` of any precision, exactly as `yearOf` does today, and the fix still lives in the extractor. `DATED` carries `field` and `derivation` but nothing saying **which thing** the date dates, which is case 3's stated must-express ("a date must carry which THING it dates, run or container"). | add `DATED.subject` from the answering `Answer.scope`, so a plugin can refuse a container-scoped date as a run's evidence |
| 4 | A borrowed id makes the borrower's origin the common case | HOLDS | `Answer.by` (who resolved it) is split from `Answer.about` (what it is about), so `offline` answering about `mal-59193` and anilist answering about `mal:39535` are ordinary rows. The early-return defect is source side and unchanged. | nothing |
| 5 | Two ids of one origin, prefix extension the only exemption | HOLDS | `id-shape` emits `EXTENDS` on `starts_with(a.id, concat(b.id,'-'))` over existing nodes only, read one way (R18); membership's id check and the `ids` anomaly both consult it. `[A, A-1, A-2]` still reports, because `A-1` and `A-2` carry no `EXTENDS` between them. | nothing |
| 6 | A bare container id in season 1's cluster bridges to season 3 | HOLDS, and structurally | `cr:G24H1N3MP` and `nf:80987039` are CONTAINER (cr's `scopeOf`, unogs `titleScope`), `JOINS` is minted only when `a.scope = b.scope` (5.4), and the invariant `MATCH (a)-[:JOINS]-(b) WHERE a.scope <> b.scope RETURN 0` is asserted every round (3.4). The four silent short circuits are recorded as `skipped:absent` in `evidence` (3.3), which is the case's other must-express. | nothing |
| 7 | A second writer into the same union-find | HOLDS | `JOINS` and `MEMBER_OF` appear in exactly one plugin's `produces` (5.1.2 row 7) and the applier writes only declared tables, so "the number of writers into the identity structure is one by construction" is enforced by the contract rather than by review. | nothing |
| 8 | An aggregated uri is user input and identity is rebuilt from it | FIXABLE, two ways | (a) The proposal contradicts itself: 2.2 says the rebuilt handle is `kind:'uri'`, "a pointer, which section 5 never turns into sameness"; 4.2 says it is `kind:'answer'` and 5.2 converts it to `SAME_AS {strength:'ANSWER'}`. Two opposite answers to 01 open problem 2, which the record says needs the owner. (b) The discriminator in 4.2 ("the target uri was in the question and the answering source is not the target's origin") does not separate a rebuilt sibling from a first party mapping: `buildHandlesFromUri` mints a bare `makeMedia({origin,id})` (`src/sources/utils.ts`, verified), and so does anizip for `mal`/`anilist` and anilist for `mal:<idMal>`. On a media page the aggregated uri names those siblings, so anilist's `idMal`, which 01 case 43 calls "the primary cross-catalogue join key" at 99.7% per-run, is classified ANSWER and demoted to a gated guess. | tag at the mint site: `buildHandlesFromUri` marks its handles, ingest reads the mark, and the owner picks pointer or ANSWER once |
| 9 | One streaming season contains two catalogue cours (the fold) | HOLDS on the primitive, FIXABLE on the new evidence rule | Rangeless `INCLUDES` with four null bounds is exactly "containment that is allowed to be partial and allowed not to exist" and the view contributes no episode from a rangeless edge, so the 24 rows cannot return (I10). But the new `containing` answer for unogs and justwatch is "at least `MIN_EPISODE_TITLE_MATCHES` exact episode title matches and a count above the run's, **whatever the coverage**" (5.7), which deletes the one bar `pickSimilarSeason` rule 2 uses to see a fold (`EPISODE_TITLE_COVERAGE = 0.6`, 03 section 4) and runs on the boundary R2 measured at 4 exact matches in 25. A wrong `containing` is not inert: it mints `VETO {includes}`, hides the season as a FOLD, and puts a Netflix season play link on the run's page. | keep a coverage floor on the low side (the fold's signature is low coverage, so bound it below as well as above), require non generic titles explicitly, and run risk 5's arm (`scripts/measure-unogs-season-match.mjs`, 33 shows) before shipping |
| 10 | One catalogue run split across several streaming seasons | FIXABLE | The `split` veto is the right new object and closes BAKI (13 against 26 with the run FINISHED). The placement half does not work as written: `count-sum` (5.9) only expresses the fold direction, `MATCH (z)-[:INCLUDES]->(r:Media)-[:MEMBER_OF]->(c)` summing run lengths under a container, and it orders by `d.dayNumber` with `precision IN ['DAY','INSTANT']` required on every run cluster. 8.4 then claims five `INCLUDES run -> season` ranges ordered by "Netflix's own ordinal", which the query neither selects nor orders by, and Netflix season rows carry no date of any kind (`03 unogs`: the season rewrite deletes `startDate`). 8.4's decomposition 13+13+13+13+12 is also not in the record, which says only "about 13" (01 case 10). | write the split direction as its own query, ordering inside the asserting origin's id space (legitimate, since the ordinal is that origin's own, 01 case 17), and require the season set to be complete before summing |
| 11 | The store has no view of the other clusters | HOLDS, newly | Membership's id contradiction check is the "evaluated where both claimants are visible" the case asks for: `nf:81091393-3` joins cluster A, and run 2's proposal is then a join between two clusters whose `mal` ids disagree with no `EXTENDS`, refused with `Refusal {rule:'ids'}`. Two caveats: the winner is whichever join was proposed first, so which run keeps the Netflix handle varies between sessions (I15), and the exchange rate is unmeasured because `clusterAnomalies` has never run in production (02 section 2.11). | score the contest on data (count, date) rather than arrival, and run the corpus arm before defaulting the check on |
| 12 | A season that contains a run lends it episodes | FIXABLE, and it breaks the shipped case | `containment` rule B, sold as `lendContainingSeason` generalized, requires `MATCH (season)-[:DATED {field:'startDate'}]->(ds) WHERE ds.precision IN ['DAY','INSTANT']`. A Crunchyroll season row asserts no start date at all: verified at `src/sources/crunchyroll/extractor.ts:189`, `startDate: id === series.id && ... ? \`${year}-01-01\` : undefined`. So rule B returns zero rows for the only source that ships this behaviour today, and the 0 to 12 Crunchyroll sources on both Mushoku part twos regress to 0 unless rule A (a `containing` answer, which needs the new schema field and an answerer change) lands first. 8.1's table also states a DAY start date for `cr:G24H1N3MP-G609CX3J4`, which is wrong for the same reason. | make the season's `startDate` OPTIONAL and take the span from the season's own episode `releaseDate` rows, which Crunchyroll does supply (`episode_air_date`, `03 crunchyroll`) |
| 13 | A source that carries its numbering on from the previous season | HOLDS | `range`'s `date` rule is `alignmentOffset` with its constants (one day of slack, `MIN_ALIGNED = 2`, a day naming two reference episodes disqualified), emitting one `SAME_EPISODE {rule:'date'}` per pair plus the summarizing `INCLUDES` hull. 8.2 walks Elusive Samurai correctly, and the unaligned cost is now counted in `fields.unplaced` instead of being silent. | nothing, but see case 19 for the interaction it breaks |
| 14 | Three numbers per episode in three spaces | HOLDS | `EpisodeAnswer.number` plus `numberSpace` (`ENTRY` anizip, `POSITION` unogs, `SEASON` everyone else) with "a stored number is never reinterpreted in another space"; the display number is the group's, 1 to 12, the owner's call. R26 is answered because the view is the only grouping site, so a rule there cannot ship inert. | nothing |
| 15 | A mid season insert makes the mapping piecewise | HOLDS | Per pair `SAME_EPISODE` on dates means an insert costs one episode its link; `evidence.piecewise` records a non constant offset. For the actual case (Netflix) there are no dates at all, so nothing is minted, which is the honest outcome 8.3 states. | nothing |
| 16 | Duplicate rows inflate the season length | FIXABLE, and the detector cannot fire | unogs keys an episode by `id: String(episode.epid)` (`src/sources/unogs/extractor.ts:187`, verified), so positions 7 and 8 of netflixid 80198505 season 3 are ONE `Episode` node after `MERGE`. The `duplicate-rows` anomaly `WITH m, json_extract(a.raw,'id') AS epid, count(e) AS n WHERE n > 1` can therefore never return a row, while the inflated `CountClaim` of 14 (the extractor's `episodes.length`) sits in the graph unchallenged and can qualify the season as a container of a 10 episode run. | compare the `COUNTED {countKind:'LIST'}` value against `count(DISTINCT` HAS_EPISODE targets`)`, which is the contradiction that actually exists in the graph |
| 17 | Two catalogues disagree about the season NUMBER | HOLDS | `providerContentId` is unchanged, and the one new source vocabulary item is fenced: `INCLUDES` is accepted only when both ends share `origin` and `EXTENDS` holds, else `Refusal {rule:'foreign-includes'}` (5.2). An ordinal never crosses an id space. | nothing |
| 18 | A source that renumbers every season and hangs them on one id | HOLDS | A CONTAINER row is never a member of a RUN cluster, and view query 4 reads members' episodes plus container episodes only inside a ranged `INCLUDES` bounded by `fromStart..fromEnd`. A flat cross season list cannot reach a run's view. | nothing |
| 19 | The same episode from two sources draws two lists | FIXABLE, and it regresses in the common configuration | `episode-number`'s scan excludes any episode already in a date pair: `NOT EXISTS { MATCH (e)-[:SAME_EPISODE {rule:'date'}]-() }`. In a cluster holding anizip (dated), kitsu (numbered, no dates, `03 kitsu`) and crunchyroll (dated), `range` pairs anizip's episodes with Crunchyroll's first, so every anizip episode is excluded from the number rule and kitsu's 1..12 is left alone in its group, which needs two members to emit anything. The view then holds two components both numbering themselves 1, which is case 19's two-lists defect arriving by a new road. 8.2's row "kitsu 1..12 with anizip 1..12" is not what the query produces. | run the number rule over `SAME_EPISODE` components rather than raw episodes, or exclude only the partner of an existing pair |
| 20 | A field by field merge produces a row no source published | HOLDS on provenance, rule unchanged | `fields` names the uri, origin and document behind every scalar, which is the must-express. The hybrid row can still be built (5.12's own failure mode says so), but episode groups are now `SAME_EPISODE` components rather than number buckets over a contaminated set, so the contaminating input is much harder to produce. | nothing required; per field confidence is decision 1 and 11 |
| 21 | Placeholder episode titles | HOLDS, incompletely | `Facet.generic` carries `GENERIC_EPISODE` from `similar.ts:104`. The answerers keep `pickSimilarSeason`, which excludes generics, but 5.7's NEW `containing` rule never says its three title matches must be non generic. Netflix season 1 is 24 of 24 positional, so in practice it offers nothing either way. | state the generic filter in the `containing` rule |
| 22 | An episode count that counted something else | HOLDS | `COUNTED.countKind` with `RELEASES` available to a plugin that declares it, and `counts` prefers `DECLARED` over `LIST` at equal support. | nothing; the declaration is unenforced, which is parity |
| 23 | "No count" read as zero | HOLDS, and it is the single cleanest win | Absence is the absence of a `COUNTED` row, zero is a `CountClaim {value: 0}`, and the fold veto's `ours IS NOT NULL` plus `skipped:absent` make "this source has nothing" and "this source says zero" different outcomes. | nothing |
| 24 | Normalising to `[a-z0-9]` deletes a CJK title | HOLDS | `Title.norm` is `stripTitle` keeping `\p{L}\p{N}\s`, `hasLetter` is a column, and every identity query filters `t.hasLetter`. Agreement in any script is a join through one node. | nothing |
| 25 | No threshold separates punctuation from a season number | HOLDS, with one new risk | `differOnlyByTrailingNumber` is carried into gate 5 verbatim. But `title-variants`' `punct-join` rule is ON by default and 01 case 25 measured that dropping separators pushes `Death Note` against `Death Note 2` to exactly 0.900. The variant is used only by the EXACT scan, where `deathnote` and `deathnote2` still differ, so the measured failure does not reproduce; it is a default-on identity rule with no arm, motivated by a case (31) about nyaa's index rather than about stub's merging. | ship `punct-join` off, with the same arm the `diacritic-fold` rule is given |
| 26 | Silence on one side, so the veto never fires | HOLDS as a declared gap | `season` veto needs an ordinal on both sides; R4's price (one weld stopped per 37 merges destroyed) is cited and `season-separation.test.ts` keeps pinning the KNOWN GAP. | nothing |
| 27 | A franchise title collapses a sequel exactly | HOLDS, with one unmeasured widening | The source side two axis gates are kept whole. In the plugin, exact `norm` equality still runs after gates 1 to 4, as `sameShow` does. But scan A matches through ANY shared MAIN title, where today's exact shortcut reads the capped six (`MAX_TITLES_PER_CLUSTER = 6`); the cap is applied only to the fuzzy profile. That is a fourth arm of 01 case 30 that was never measured. | apply the six title cap to scan A too, or measure the uncapped arm |
| 28 | The diacritic gate | HOLDS | `diacritic-fold` is a `Variant` rule, OFF by default, decision 5, which is exactly I8's "deserves its own measured change". | nothing |
| 29 | Synonym fields carry programme names | HOLDS | `HAS_TITLE.class`, identity queries filter `class:'MAIN'`, and no extractor emits a synonym today. I12 becomes structural rather than a convention. | nothing |
| 30 | The six title cluster profile, and which six | HOLDS | The profile query's `ORDER BY cluster, score DESC, title ASC` is the measured title-ascending arm (69.6 / 99.9 / 70.0) with no arrival order anywhere in the path. | nothing |
| 31 | Intra-word punctuation splits an index term | HOLDS | `Variant` with the rule that derived it, joining direction only. | see case 25 on the default |
| 32 | Normalising a match score by the wrong side | FIXABLE, minor but load bearing | `PluginContext.titleSimilarity` is documented as "frizbee, symmetric, **normalized by the shorter side**". The repo's `titleSimilarity` normalizes by the longer string in both directions and takes the weaker direction (`02 section 2.10`, `03 appendix`); `min(self(alias), self(candidate))` is the nyaa plugin's matcher, a different function. Taken literally the contract raises every score and invalidates R6's calibration. | quote `titleSimilarity` in `src/sources/utils.ts` in the contract |
| 33 | `YYYY-01-01` is a sentinel and a real premiere at once | FIXABLE, and as written it deletes a measured guard | The projection reads precision off the **string shape**: "`YYYY-01-01` is YEAR, `YYYY-MM-01` is MONTH, anything with a time is INSTANT" (2.3). AniList emits `new Date(...).toUTCString()` for every branch including the year-only coercion (verified, `src/sources/aired-date.ts:33,44,50`), so `Fri, 01 Jan 2021 00:00:00 GMT` reads as INSTANT; jikan passes through an offset bearing ISO string (`fuzzy-merge.ts:169-170` says so in as many words). Today's `startDay` is value based (`parsed.getUTCDate() === 1`, `fuzzy-merge.ts:173-179`). So the two highest scoring sources in the tree would have coerced dates admitted to the 45 day veto, which is the guard the record prices at "keeping January 1 destroys 14992 of 17946 streaming attaches". | derive precision from the parsed value (UTC day-of-month 1 is not DAY) exactly as `startDay` does, and keep the shape test only as a hint |
| 34 | A month precise date that reads as day precise | FIXABLE | Same defect: kitsu answers a bare `YYYY-MM-01` and is caught by the shape rule, jikan answers the same day with a time and is not. The two sources the case names split across the classifier. | as case 33 |
| 35 | A source dating a media by the NEXT airing | HOLDS | `DATED.derivation` carries published against schedule derived against coerced, and `aired-date.ts` already fixed the source. | nothing |
| 36 | Cross source date agreement is excellent, but only on TV | HOLDS at parity | The 45 day window is carried with its structural ceiling argument (cours sit about 91 days apart). The veto does not read format, so the SPECIAL band (5 of 102 beyond 45 days) is still refused; that is today's behaviour too. | optional: gate the window on the work kind, with an arm |
| 37 | The date is the key and an ordinal would not be | HOLDS | `similarMedia` and its five rules are kept whole in the answerers, where the evidence lives. | nothing |
| 38 | A day versus an instant | HOLDS | `DateClaim.precision` and `dayNumber` for comparison, `Answer.raw` keeps the original string so `src/utils/release-date.ts` renders as today. | nothing |
| 39 | Two catalogues numbering different things in one namespace | **FATAL for the schema** | `Media.uri` is the primary key, so `tmdb:550` the film and `tmdb:550` the series are one node; the scope ratchet then forces it CONTAINER for good and the film can never be a RUN member. The case's must-express, "an id namespaced by (origin, KIND)", cannot be written in this schema. The practical damage equals today's, because the refusal stays on the claimants (simkl and watchmode refuse to mint tmdb; `trakt/extractor.ts:79` still does, 01 open problem 17), but a design whose premise is that a new edge case is a new query cannot express this one at all. | make the node key `(origin, kind, id)` where an origin declares a kind, or state explicitly that this case stays a source side refusal for ever |
| 40 | A positional path read that mints a constant | FIXABLE | The `constant-id` anomaly counts `DISTINCT` clusters among a shared id's claimants and fires at 3. If the constant actually welded its claimants, they are all in ONE cluster and `n = 1`, so the rule is silent precisely in the failure state it is named for; it detects refusals, not welds. The real protection is elsewhere (the id check refuses a join between clusters with disagreeing ids of a shared origin), which is genuine but only fires when the two clusters share an origin. | count distinct claimants, not distinct clusters, and report before membership rather than after |
| 41 | A container id that is a film collection | HOLDS | The measured allowlist stays in kitsu; `PART_OF` to the collection; `RunLength` 1 (FILM) per film; a rangeless `INCLUDES` at worst, which renders as a badge pointing at the collection page, which is what the link actually says. | nothing |
| 42 | Show level ids with no finer alternative | HOLDS, with one overreach | `Origin` is seeded for all 24 including imdb, so a PART_OF handle finally has a row to render against: 01 open problem 11 closed. But `models = 'SHOW'` is assigned to paramount, trakt, tvdb, omdb, watchmode and imdb, and 2.2 says the scope ratchet is forced by that column. omdb and watchmode mint RUN for films (`omdb/extractor.ts:47`, `watchmode:181-184`), so forcing every SHOW-models uri to CONTAINER would take every omdb and watchmode film out of its film cluster. | force the scope only for the origins `SHOW_LEVEL_ORIGINS` names today (imdb), and keep `models` as veto evidence only |
| 43 | Per run ids that are show level for a minority | HOLDS as declared residue | `Media.scope` is per node, so instance level scope is expressible; nothing sets it, and decision 10 says so. The residue is caught downstream by the fold veto or the id check, which is more than today. | nothing |
| 44 | Scores are per source constants | HOLDS as declared | `HAS_TITLE.score`, `DATED.score`, `COUNTED.score` are per claim, which is the must-express, but `view`'s member order and `counts`' tier still read the per source `Answer.score`, so anizip's unscored row still loses every scalar and every tier. Named as a failure mode and decision 1. | nothing in this design; it is the owner's call |
| 45 | The count rule is lexicographic tiers | HOLDS | `tieredConsensus` verbatim, `witnesses` and `declared` published, and the one NEW tiebreak (DECLARED beats LIST at equal support inside the tier) is exactly what R3's conclusion asks for and cannot reorder anything below the tier. | nothing |
| 46 | Contradiction rules, a cluster visibly wrong about itself | HOLDS in shape | `anomalies` runs every round rather than only in a fixture test, and the three invariant queries of 3.4 must return 0. Two of the five rules cannot fire in their failure state (cases 16 and 40). | fix those two queries |
| 47 | A seed of the store's own output | HOLDS | The export walks `CLAIMS` and excludes the rebroadcast kind, so seed N+1 cannot ratify seed N through justwatch's `mergeHandles`; seed handles are identity-only, therefore undescribed, therefore inert until the owning source describes the uri. | fix the `answer` against `uri` naming so the export's filter and the ingest agree |
| 48 | A claim that arrives before the row it is about | HOLDS, elegantly | `described` on the node plus `claims`' `a.described AND b.described` filter replaces `pendingClaims` with no expiry, no map, and full visibility; the claim converts the round the describing answer lands, and the scope it converts under is the ratcheted one, never the RUN default. | nothing |
| 49 | A container cluster with no run on the page | HOLDS | `View.kind` gains FOLD and `hidden` is a column, so a lent or borrowed season is neither a run nor invisible: it is hidden from listings and openable as itself. The orphan 01 case 49 names as the new one is closed by that. | nothing; the global hiding change is listed as risk 6 |
| 50 | A relation is a different axis from sameness | HOLDS | `relations` and `franchise` stay inside `Answer.raw` and no rel table can reach them, so no narrative edge can ever join. The new `INCLUDES` in the source vocabulary is an edge type, not a second field (R16). | nothing |
| 51 | Episode containment declared, written and read by nothing | HOLDS | `EPISODE_PART_OF` is dropped; the fold is a ranged `INCLUDES` plus `SAME_EPISODE`, both read by the view. | nothing |

---

## Part 2. The 26 refutations: is any of them re-committed

| R | verdict | why |
| --- | --- | --- |
| R1 offset vote onto a Netflix season | HOLDS, with one leak | No title vote anywhere. `count-sum` is arithmetic and off by default, and the exactness argument is stated as "any insert opens it". It does not hold in general: a season of 25 containing two cours whose lengths are 12 and 13 sums exactly, and 13 for a 12 episode run is the record's own case (I9, AniList says 13 for Mushoku S2 part 1). `count-sum` reads `RunLength.value` with no witness bar, so a one witness length can close the sum and every row after the special carries the wrong `netflix.com/watch/` url, which is R1's exact damage. |
| R2 per episode title join | PARTIALLY re-committed | "No title rule. Titles never place an episode" is honoured at episode level. But 5.7 uses the same evidence at season level to establish containment, with the coverage floor removed, and 8.1 cites R2's own 4-of-25 as the reason it will fire. R2's finding was that a title is not an identity across that boundary at all; using it at a lower bar for a weaker edge may be right, and is unmeasured. |
| R3 weighted sum | HOLDS | Tiers verbatim; `strength` is a class, never a number to add (3.3). |
| R4 season silence blocks | HOLDS | Silence never blocks; the price is quoted. |
| R5 quarter as the date comparison | HOLDS | A day window throughout. |
| R6 tuning `SIMILARITY_THRESHOLD` | HOLDS | 0.9 carried, "change nothing" cited; see case 25 and 32 for the two places a default drifts from it. |
| R7 ordinal and count must agree | HOLDS | Not proposed; the surviving welds are handled by the id check instead. |
| R8 refusing JustWatch `nf` | HOLDS | The ID exemption from the four soft gates is justified by this number. |
| R9, R10 kitsu film blanket and denylist | HOLDS | Source side, untouched, allowlist kept. |
| R11 dropping the kitsu subtype gate | HOLDS | Untouched. |
| R12 a lone season carve-out | HOLDS | Not proposed. |
| R13 Apple TV's gate without season scoping | HOLDS | Untouched; appletv still demotes. |
| R14 raising `offline` or `kitsu` SCORE | HOLDS | Not proposed; only anizip's missing score is raised, as a decision for the owner. |
| R15 capping each source at one re-ask | RE-COMMITTED in a new place | The unit is now a uri, which is the right fix. But `fetch` mints `Ask {kind:'MEDIA', uri}` "one per uri per session" with `NOT EXISTS { MATCH (:Ask {kind:'MEDIA', uri: m.uri}) }`, and the actuator asks whatever origins answer for it at that moment with whatever uri the cluster then has. A source whose needed id lands in a later batch is asked once, refuses, and has no second chance, which is R15's sentence verbatim. |
| R16 a second `links` field | HOLDS | Edge tables per kind. |
| R17 widening only `normalizeTitle` | HOLDS | One `norm` keeping every script, variants as separate nodes. |
| R18 reading `extendsId` symmetrically | HOLDS | One way, and `[A, A-1, A-2]` still reports. |
| R19 the three mapping datasets | HOLDS | Not used. |
| R20 composing a tvdb offset onto a Netflix season | HOLDS | Not used. 8.4's ordering by Netflix's own ordinal is inside nf's own id space, which is legitimate, but is not what the `count-sum` query does. |
| R21 unOGS `imdbid` as a dedup handle | HOLDS | Not re-added. |
| R22 to R25 (nyaa plugin) | n/a | Outside this store; nothing here touches them. |
| R26 a translation bridge landing inert | HOLDS | The view is the only grouping site, so a rule landed once is not bypassed by a second regrouping in the resolver. |

---

## Part 3. The 15 invariants

| I | verdict | note |
| --- | --- | --- |
| I1 irreversibility | HOLDS, by replacing the constraint | Nothing unions; `JOINS` and `MEMBER_OF` are retractable and the split recompute is specified. One unhandled consequence: on a split the losing fragment gets a fresh id with `canonical` unset, so a client holding the old `_id` (04 contract 1) silently resolves to the surviving cluster, which no longer contains the media it was looking at. |
| I2 the exchange rate | AT RISK | The refusals it adds are right in direction, but three carry no arm: the id contradiction check (cost never measured, because `clusterAnomalies` never ran in production), the `split` veto (admitted, risk 4), and `containing` on three episode titles (admitted, risk 5). Against that, case 33's precision defect silently REMOVES a guard whose removal the record prices at 77% of streaming attaches. |
| I3 scope ratchet | HOLDS | In `Media.scope`, with the per answer stamp preserved on `Answer.scope`, which closes 02 section 3's "leaves no trace". Overreach on `models='SHOW'` noted at case 42. |
| I4 an id must be reproducible | HOLDS | Only source minted ids become nodes; cluster ids are uuids and never a uri. |
| I5 provenance | CLOSED, three of four shapes | Per field (`fields`), per union (`by`, `rule`, `evidence`), per document (the `by|kind|about` key ends the truncation class). The echo tier stays a class, not a sum. |
| I6 folded cours | HOLDS on the veto and the primitive | The one directional fold veto is carried with zero tolerance and the inverse gains `split`. The loan is broken for Crunchyroll as written (case 12). |
| I7 retranslated titles | HOLDS at episode level | See R2 for the season level use. |
| I8 the diacritic gate | HOLDS | Variant, off, with an arm. |
| I9 13 against 12 | HOLDS in the loan, LEAKS in `count-sum` | `witnesses >= 2` gates rule A and rule B; `count-sum` reads `RunLength.value` with no such bar. |
| I10 24 against 2 x 12 | HOLDS | A rangeless `INCLUDES` contributes no episode; a ranged one contributes only `fromStart..fromEnd`; a container is never a member. This is the design's strongest single result. |
| I11 the tier rule | HOLDS | Verbatim, plus a tiebreak that cannot cross a tier. |
| I12 main titles only | HOLDS | Structural through `HAS_TITLE.class`. |
| I13 the season pair | HOLDS | Quoted as a pair from one member. |
| I14 grouping by number inside one cluster | HOLDS as a query precondition | `MEMBER_OF` scope in the `episode-number` query replaces a comment, which is the right move; the query itself is broken for another reason (case 19). |
| I15 determinism | PARTIALLY | `ORDER BY` on every scan and no arrival order in any comparison. Three residues: the survivor tiebreak is "the lexicographically smaller cluster id" on a random uuid where today it is the smaller uri, so the same input in a new session can retire the other id; the contested season goes to whichever join was proposed first (case 11); and an episode `_id` is `<clusterId>:e:<number>`, an identity derived from a position, which is exactly what I15 records as the 2026-09-06 churn bug ("an INDEX cannot: it names a position, and the position's occupant changes"), and the number changes when an alignment lands. |

---

## Part 4. Cross cutting findings

**A. The EVIDENCE band violates its own principle.** 2.3 says the projection "may not apply a vocabulary,
a threshold or a choice", then puts three per origin vocabularies in it: `countKind` (DECLARED against
LIST, per source), `numberSpace` (ENTRY, POSITION, SEASON, per source) and `class` on titles, plus the
precision classifier. Those tables decide the fold veto, the split veto, the number rule and every date
window, and they sit in the one band a plugin cannot swap or retract. 5.3's own failure mode admits it
("a wrong `countKind` or `precision` table entry moves an exchange rate silently"). `reproject()` makes
this repairable rather than fatal, but the band boundary as drawn is not where the document says it is.

**B. Two of the checkers cannot express their failure.** The `duplicate-rows` and `constant-id` anomalies
are silent exactly in the state they name (cases 16 and 40). The digest of 2.6 has the same shape: its
fourth term is `sum(size(a.hash))`, the sum of hash string lengths, which for fixed width hashes is the
row count again, so the digest is four counts and detects nothing a count would not.

**C. `title-match` cannot produce the cross scope PART_OF its own walkthrough depends on.** Scan A filters
`a.scope = b.scope`, scan B filters `ca.space = cb.space`, so a RUN cluster and a CONTAINER cluster are
never candidates. Yet the emit section specifies "A RUN cluster against a CONTAINER cluster: `PART_OF
{rule:'title'}`" and 8.1 lists exactly that for `cr:G24H1N3MP`, `nf:80987039` and `jw:222366`. Today that
edge is real (02 section 2.10's scope dispatch, `linkPartOfPairs`), and it feeds the UI's container badges
and the `similar` ask half's `(m)-[:PART_OF]->(show)` pattern. As written, a run reaches a container only
through a source claim, and every fuzzy attach is lost.

**D. The `similar` ask cap miscounts.** `MATCH (m)-[:MEMBER_OF]->(c)` then `OPTIONAL MATCH (prior:Ask ...)`
then `count(prior) AS asked` counts one row per (member, prior) pair, so a five member cluster reports
`asked = 5` after a single ask and never clears `asked < 4`. The cap of 04 section 1.6 becomes a cap of one.

**E. `lendContainingSeason` is not retired.** 9.1 keeps "every extractor" unchanged, so Crunchyroll still
re-points a containing season's episodes at the asking run through `HAS_EPISODE`, while `containment` plus
`range` also bring the same episodes in through a ranged `INCLUDES`. The same rows then arrive twice under
two numberings, joined only if `SAME_EPISODE` happens to pair them. Either the lend goes or the design has
to say what happens when both fire.

---

## Summary

### Fatal

1. **Case 39 cannot be expressed.** `Media.uri` as the primary key plus a single ratcheted `scope` column
   means a catalogue that numbers films and series in one sequence has one node for two works, and the
   must-express ("an id namespaced by (origin, KIND)") needs a different node key. Parity with today, but
   the design claims a new edge case is a new query, and this one is not.

### Serious (wrong or missing, fixable inside the design)

1. **Date precision is read off the string shape** (2.3), so AniList's `toUTCString()` output and jikan's
   offset bearing ISO, including both of their year only coercions, classify as INSTANT and enter the 45
   day veto. Today's guard is value based (`fuzzy-merge.ts:173-179`). The record prices this guard at
   14992 of 17946 streaming attaches. Fix: classify from the parsed value.
2. **`containment` rule B is dead for Crunchyroll**, because it requires a DAY precision `startDate` on the
   season and a Crunchyroll season row has none (`crunchyroll/extractor.ts:189`). The one shipped instance
   of case 12 regresses to nothing unless rule A carries it. Fix: optional date, span from the season's own
   episode dates.
3. **`episode-number` excludes date paired episodes**, so in any cluster where `range` aligned Crunchyroll
   against anizip, kitsu's list never joins anizip's and case 19's two lists return. Fix: group over
   `SAME_EPISODE` components.
4. **`title-match` never mints a cross scope `PART_OF`** although its emit rule and 8.1 both depend on it
   (finding C). Fix: widen the candidate scans and dispatch by scope as 02 section 2.10 does.
5. **Case 8 is answered twice, oppositely** (`kind:'uri'`, never sameness, against `kind:'answer'`,
   sameness under gates), and the stated discriminator would demote anilist's `idMal`. Fix: tag at the
   mint site and let the owner decide once.
6. **`count-sum` can close on a wrong sum** when one run's length rests on a single witness (I9's 13
   against 12), reproducing R1's damage by arithmetic. Fix: require `witnesses >= 2` on every run in the
   sum, and keep it off until the Crunchyroll validation arm runs.
7. **`containing` from three exact episode titles with no coverage floor** (5.7) runs on R2's retranslation
   boundary and controls hiding, vetoes and a play link. Fix: bound coverage below as well as above, exclude
   generic titles, run risk 5's arm first.
8. **Two anomalies and the digest cannot fail** (finding B).
9. **The id contradiction check ships with no measured arm** while turning a never-run anomaly into a hard
   refusal at every join.
10. **R15 is re-committed** by one MEDIA ask per uri per session (Part 2, R15).

### Minor

1. `models='SHOW'` forcing CONTAINER would take omdb and watchmode films out of their clusters (case 42).
2. The fold and split vetoes gate on `Origin.models` of the link uri, which is an arbitrary member, while
   taking the count from the cluster's `RunLength`.
3. Scan A applies no six title cap where today's exact shortcut reads the capped six (case 27).
4. `punct-join` is on by default with no arm (case 25).
5. `PluginContext.titleSimilarity` is documented with the wrong normalisation (case 32).
6. The `similar` ask cap miscounts (finding D).
7. Episode `_id` derived from a number, and the survivor tiebreak on a random uuid (I15).
8. A split fragment's old cluster id has no `canonical`, so a client's `_id` silently resolves elsewhere.
9. 8.4's Fullmetal Alchemist decomposition (13+13+13+13+12) and 8.1's Crunchyroll season date are asserted
   and not in the record; 8.1 also assumes R2's four exact matches split usefully across both cours.
10. `Answer.key` does not include `depth`, so two nested handle answers at different depths collide.
11. `lendContainingSeason` is kept while its replacement is added (finding E).
12. The no-uris listing query scans every `View` row, each carrying full media JSON; unmeasured.

### What clearly holds, so the judge need not re-derive it

- **The fold can no longer put 24 rows on an 11 episode page** (I10): a rangeless `INCLUDES` contributes no
  episode, a ranged one contributes only `fromStart..fromEnd`, and a container is never a cluster member.
- **The season 1 to season 3 bridge is structurally impossible** (case 6): bare `cr:` and `nf:` ids are
  CONTAINER, `JOINS` requires equal scope, and the invariant query asserts it every round.
- **One writer into the identity structure** (case 7), enforced by the `produces` contract rather than by
  review.
- **Absent, zero and unknown are three values** (case 23), which retires the `?? 0` class outright.
- **`pendingClaims` becomes the `described` flag** (case 48): no map, no expiry, replayed for free, and the
  scope it converts under is always the ratcheted one.
- **Case 11 gets the global uniqueness check the record asked for** (membership's id contradiction check),
  and R7's `nf:81091393-3` ends in a `Refusal` rather than a weld.
- **Tiers, not sums** (R3, I11), with `witnesses` and `declared` published rather than recomputed.
- **imdb finally has a row to render against** (case 42, open problem 11).
- **Narrative relations can never join** (case 50): they stay inside `Answer.raw`, unreachable by any rel
  table.
- **A wrong merge is a retraction** (I1): `JOINS` and `MEMBER_OF` are deletable and the split recompute is
  specified, which is the one thing the current store cannot do at all.
