---
title: Every number, and every trap
description: "The lookup tier: every constant that decides something with its file and line, every refusal with its condition and its cost, and the facts that make a naive check report success."
---

Every number below is the last check before `graph.link`, the one write with no inverse
(`src/worker/store/graph.ts:82-105`, and [what that costs](/)). Almost none of them say anything
when they fire: 77 `console` calls in `src/` (42 `warn`, 35 `error`, zero `log`/`info`/`debug`), and
the page's own read path announces exactly one refusal
(`src/worker/resolvers/media/index.ts:36`).

## Every number that decides something

Values, sites and consequences only. The derivations, sweeps and rejected variants sit on the page
that argues each rule, and in full in [Constants](/reference/constants/).

### The search gate: is this catalogue hit our show

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `CONFIDENT_TITLE_THRESHOLD` | `0.9` | `src/sources/catalogue-gate.ts:98` | whether a JustWatch or Apple TV hit names our franchise, before a detail request is spent |
| `CONFIDENT_TITLE_THRESHOLD` | `0.9` | `src/sources/crunchyroll/extractor.ts:366` | the same question on Crunchyroll's search path. A second declaration on purpose |
| `TITLE_MATCH_THRESHOLD` | `0.44` | `src/sources/utils.ts:324` | `pickTitleMatch`, unOGS's own search path. Same scale as the 0.9s, different question |
| `SEARCH_RELEVANCE_THRESHOLD` | `0.7` | `src/worker/resolvers/media/index.ts:21` | whether a search hit stays on the page. A different scale: `searchScore` normalises by the QUERY length (`sources/utils.ts:262-266`) |
| `SEASON_DATE_WINDOW` | `45 * 24 * 60 * 60 * 1000` | `src/sources/catalogue-gate.ts:230` | widest gap between our start and a catalogue season's premiere. Applied at `catalogue-gate.ts:291` and `similar.ts:188` |
| `MAX_CATALOGUE_CANDIDATES` / `MAX_SERIES_CANDIDATES` | `3` / `3` | `catalogue-gate.ts:109`, `crunchyroll/extractor.ts:369` | survivors worth a detail request each. Mirrored deliberately |
| `MAX_SEARCH_QUERIES` | `4` | `catalogue-gate.ts:110`, `crunchyroll/extractor.ts:370` | query rungs, built from the PRIMARY title only, counting the title itself |
| `MATCH_CONFIG` | `{ maxTypos: Infinity, casing: 'ignore', unicode: 'always' }` | `src/sources/utils.ts:211` | `maxTypos: Infinity` turns the wasm matcher from a FILTER into a SCORER. At its default of 0 every non-containment pair collapses to zero |
| `SEASON_CANDIDATES_TTL_MS` | `10 * 60 * 1000` | `crunchyroll/extractor.ts:319` | how long one series' season walk is reused |
| `waitForMedia` timeout | `15_000` default, `30_000` at every search gate | `sources/utils.ts:493`; `crunchyroll:461`, `unogs:463`, `appletv:342`, `justwatch:645` | how long a source waits for another to describe the cluster. Crunchyroll, Apple TV and JustWatch wait on a title AND a start date; unogs on a title alone |
| `SEASON_PATTERNS` | over 4159 titles: `Season N` 176, `Nth Season` 81, `第N季` 62, `第N期` 43, `Part N` 31, `S<N>` 27, `シーズンN` 11, `Cour N` 6, `N기` 1 | `src/sources/season.ts:77-80`, patterns at `:88-95` | the pattern list and its order, ordinal form first. `SEASON_MARKER` (`:108-111`) is narrower and leaves `\bS\d\b` out |

### The write path

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `SHOW_LEVEL_ORIGINS` | `new Set(['imdb'])` | `src/worker/store/db.ts:42` | an `imdb:` uri reads CONTAINER before any stored row is consulted, on both ends of a claim and on the row's own uri |
| `IDENTITY_FIELDS` | `new Set(['uri', 'origin', 'id', 'scope'])` | `db.ts:104` | a row carrying only these is a placeholder and is not stored (`:140`), unless it stamps CONTAINER |
| the scope ratchet | `scopeOf(media.uri) === 'CONTAINER' ? 'CONTAINER' : media.scope ?? 'RUN'` | `db.ts:146` | applied BEFORE `graph.set`, because scalars there are last-write-wins (`graph.ts:396`) and an incoming RUN would overwrite a stored CONTAINER |
| media / episode / origin `maxBatchSize` | `250` / `250` / `50`, on a 50 ms `batchScheduleFn` | `src/worker/extractor.ts:132`, `:150`, `:160` | one `upsertMedia` per 250 rows, which is also the blast radius of a `throw` (`graph.ts:167`) |
| `PLUGIN_ORIGIN_TOKEN` | `/^[a-z0-9][a-z0-9-]{0,31}$/` | `src/worker/plugin-sources.ts:4` | a rejected plugin origin is reported and skipped, never fatal to its siblings |
| plugin name cap | `source.name.slice(0, 64)` | `plugin-sources.ts:73` | falls back to the origin |
| plugin handle depth | media `4`, episode `1` | `plugin-sources.ts:123`, `:126` | bounds a self-referencing payload; an episode handle's node carries no handles of its own |

### The fuzzy merge

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `SIMILARITY_THRESHOLD` | `0.9` | `src/worker/store/fuzzy-merge.ts:7` | whether two clusters already in the store are one show. Read twice: prefilter at `:570`, accept at `:571` |
| `START_DATE_WINDOW_DAYS` | `45` | `fuzzy-merge.ts:46` | the same width as a disagreement test, in epoch DAY integers. 45 rather than 30 because kitsu and jikan answer `YYYY-MM-01` when only the month is known |
| `MS_PER_DAY` | `86_400_000` | `fuzzy-merge.ts:47` | day precision for the date axis; `dayOf` inlines the same literal at `consensus.ts:85-88` |
| `MAX_TITLES_PER_CLUSTER` | `6` | `fuzzy-merge.ts:12` | 6 x 6 = 36 wasm alignments per pair. Eight titles would be 64, +78% on the single loop the pass spends its time in |
| `MAX_CACHED_DECISIONS` | `50_000` | `fuzzy-merge.ts:13` | pair verdicts held before a full `clear()` at `:607` |
| `COMPANION_MARKERS` | ten strings, each kept only because it refused a weld: specials 19, special 8, ova 7, ona 4, episode 0 3, bonus 2, mini anime 2, picture drama 1, recap 1, trailer 1 | counts at `fuzzy-merge.ts:81-82`, list at `:92-95` | a work against its own companion entry. Fifteen more were swept and dropped for refusing none |
| `WORK_KINDS` | `new Set(['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA'])` | `fuzzy-merge.ts:58` | which type disagreements can veto. ANIME and LIVE_ACTION are absent; TV_SHORT folds to TV at `:74` |
| the exchange-rate bar | `1.0` wrong welds refused per correct merge lost | `catalogue-gate.ts:83-84` | whether a proposed threshold, window or veto ships at all ([why 1.0](/invariants/nothing-rather-than-a-guess/)) |
| a third format for SPECIAL/OVA/ONA | `0.003`: 31 of 75 welds, 8808 of 17946 attaches destroyed | `fuzzy-merge.ts:552-557` | refused, worse than any rule the file has refused |
| title-ordering arms (weld / split / attach) | arrival 64.5 / 94.9 / 56.0; title ascending 69.6 / 99.9 / 70.0; longest first 53.8 / 100.0 / 19.9; shortest first 82.7 / 100.0 / 98.7 | `fuzzy-merge.ts:201-233` | title ascending shipped: five points off the weld arm, five and fourteen onto the recall arms, and independence from arrival order |
| per-source title scores | 0.9 jikan and ani.zip, 0.8 anilist, 0.5 crunchyroll, 0.3 the english block, 0.25 watchmode, 0.2 the streaming catalogues | `fuzzy-merge.ts:240-250` | which six titles a cluster is compared on. A comparator on score returns 0 inside a tier, so `orderWithinTier` (`:234`) breaks it |

### Consensus and windowing

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `MIN_ALIGNED` | `2` | `src/worker/store/consensus.ts:111` | dates two numberings must share before an offset is believed. A second offset with equal support also refuses (`:153`) |
| the two-witness bar | `backing.length < 2` | `consensus.ts:234` | the loan is declined WHOLE. AniList alone said 13 for a run that aired 12 |
| the alignment window | `day - 1`, `day`, `day + 1` | `consensus.ts:142`, written inline again at `crunchyroll/extractor.ts:419` | one broadcast is two dates: ani.zip stamps `2021-01-10T15:00:00Z`, the 11th in Tokyo |
| the episode window | `1` to `length`, inclusive both ends | `consensus.ts:240` | a window, not a ceiling: after alignment the previous cour lands at 0 and below and is dropped too |

### similarMedia

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `SHOW_TITLE_THRESHOLD` | `0.9` | `src/sources/similar.ts:303` | whether an answer names the show we asked about. Correct pairs measured 1.000, nearest wrong pair 0.8135, a spin-off |
| `EPISODE_TITLE_COVERAGE` | `0.6` | `similar.ts:67` | the share of a candidate season's real episode titles our run must carry |
| `MIN_EPISODE_TITLE_MATCHES` | `3` | `similar.ts:69` | shared titles before rule 2 speaks. One shared recap name is a coincidence |
| `SIMILAR_MEDIA_TIMEOUT_MS` | `30_000` | `src/worker/extractor.ts:198` | a backstop against a source that never yields, not a latency budget. Prints as `declined (timeout 30000ms)` |
| `MAX_SIMILAR_MEDIA_PER_CALLER` / `MAX_CONCURRENT_SIMILAR_MEDIA` | `8` / `32` | `worker/extractor.ts:227`, `:216` | the ceiling decline. The per-caller share stops a plugin that never yields spending a first-party ask's budget |
| `MAX_ASKS_PER_PAIR` | `4` | `src/worker/similar-consumer.ts:41` | asks one (run, container) pair gets before it settles. Prints as `settled (cap 4 reached)` |
| episode titles per ask | `dedupe(episodeTitles).slice(0, 200)` | `similar-consumer.ts:175` | the evidence sent with one ask |
| `SAFE_SHOW_ID` | `/^[A-Za-z0-9._~-]{1,128}$/` | `worker/extractor.ts:244`, tested at `:326` | refuses an id carrying `..`, `?` or `#`. Checked once here because a show id is the first value chosen by the CALLER |
| `printableToken` | 128 chars, non-printables to `_` | `similar.ts:297` | a caller-supplied string as ONE log token, so a newline cannot break the line `scripts/check-similar-media.mjs` parses |

### Transport, timing, registry

| constant | value | file:line | what it decides |
| --- | --- | --- | --- |
| `MAX_RETRIES` | `3` | `src/worker/backoff.ts:17` | four attempts. The third retry took the homepage season list from 88% to 94% against Jikan |
| `backoffDelay` | `1_000 * 2 ** attempt` | `backoff.ts:37-38` | 1s, 2s, 4s: 7 seconds of silent added latency on a dead upstream |
| `MAX_RETRY_DELAY_MS` | `15_000` | `backoff.ts:18` | caps both the exponential delay and an upstream's own `retry-after`. Unreachable by the delay alone, which tops out at 4s |
| `RETRYABLE_STATUSES` | `new Set([408, 429, 502, 503, 504, 522, 524])` | `backoff.ts:13` | which statuses mean ask again. **500 is deliberately absent** (`:11-12`), as often a deterministic upstream bug as a blip; leaving 504 out once emptied the homepage |
| mediaPage debounce | `100` ms | `src/worker/resolvers/media/index.ts:108` | a listing coalesces a burst of writes into one page rebuild, so the whole merge pass runs at most ten times a second |
| `useResponseCache` ttl | `15 * 60 * 1000` | `worker/extractor.ts:470` | **nothing.** It hooks `onExecute` and every operation on this path is a subscription |
| `CONNECT_TIMEOUT_MS` | `45_000` | `src/plugins.ts:56` | the deadline on both halves of a plugin handshake, the connect and the registration |
| `RECONNECT_DELAY_MS` / `RECONNECT_MAX_MS` | `3_000` / `30_000` | `plugins.ts:9`, `:66` | `Math.min(RECONNECT_DELAY_MS * attempt, RECONNECT_MAX_MS)`, computed at `:72` |
| `SEED_INDEX_TIMEOUT_MS` / `SEED_EPISODES_TIMEOUT_MS` | `10_000` / `15_000` | `src/sources/offline/seed-source.ts:26`, `:27` | both outlived by a 503 with a generous `retry-after`. A race, never an `AbortSignal` |
| `SEED_MAX_WELD_SHARE` | `0.02` | `src/sources/offline/seed-gate.ts:35` | the welded-run share above which `gateSeed` refuses the publish outright |
| built-in sources | `25` | `src/sources/index.ts`, pinned by `expect(names).toHaveLength(25)` at `tests/unit/sources/index.test.ts:24` | the live list is `Object.values(extractorDefinitions)` (`worker/extractor.ts:551`), so the barrel IS what runs and a source is disabled by deleting one line |
| playback origins | `2` | `src/sources/players.ts:12-13` | `cr` and `nf`. Playback is a lookup keyed by origin, not a flag on the module |
| `OFFER_COUNTRIES` | `{ primary: COUNTRY, extra: 'JP' }`, `COUNTRY = 'US'` | `src/sources/justwatch/extractor.ts:40`, `:26` | which catalogues are read. Mushoku Tensei has no US Netflix offer, so US alone is blind to Netflix for most of this catalogue |

## Every way the system says no

Ids are the stable ones from [the refusal index](/reference/refusal-index/), which carries all of
them with the condition verbatim. Bold in the last column means the caller or the store pays.

| id | site | condition | what the caller sees, and what it costs |
| --- | --- | --- | --- |
| E2 | `resolvers/media/index.ts:34` | `!requestedUri \|\| !(isUri(requestedUri) \|\| isAggregatedUri(requestedUri))` | **204, and the page sits empty forever.** The generator ends without yielding, and warns first (`:36`) |
| E15 | `worker/extractor.ts:457`, `:458`, `:463` | the merged defaults `yield { media: null }`, `yield { mediaPage: { nodes: [] } }`, `yield { similarMedia: null }` | one request, answered on the first payload. Written to YIELD rather than end precisely so it is not a 204 (`:459-462`) |
| E22 / E23 | `backoff.ts:75`, `:71` | `!RETRYABLE_STATUSES.has(response.status) \|\| attempt >= MAX_RETRIES`; `attempt >= MAX_RETRIES` | asymmetric: a non-retryable or exhausted STATUS ends at `return response` with the body intact, a rejected fetch on the fourth attempt ends at `throw` |
| K4 | `worker/extractor.ts:358` | `byCaller >= MAX_SIMILAR_MEDIA_PER_CALLER \|\| similarAsksInFlight.size >= MAX_CONCURRENT_SIMILAR_MEDIA` | `declined / ceiling`, retryable. Prints `(ceiling n/8 by caller, m/32 global)` |
| K7 | `worker/extractor.ts:382` | `delivered.kind === 'timeout'` | **`declined / timeout` after 30 s**, holding one of 8 per-caller and one of 32 global slots the whole time |
| K19 | `similar-consumer.ts:207-210` | `record.asks >= MAX_ASKS_PER_PAIR` | `settled (cap 4 reached)`: that pair is done for the session |
| K22 vs K21 | `similar-consumer.ts:231-234`, `:227` | `result.outcome === 'refused'` against `'declined'` | **recorded differently, not merely logged differently.** `refused` adds the fingerprint so `isAsked` is true for that evidence; `declined` touches nothing and retries |
| S21 | `sources/utils.ts:508` | falls out of the `for await` | `waitForMedia` returns `undefined` after 15 s, 30 s at the search gates. The probe must be SYNCHRONOUS |
| S22 | `catalogue-gate.ts:286` | `if (!known.startDate) return undefined` | no date axis, no link. Refusing the whole gate rather than running it on one axis |
| S41 | `crunchyroll/extractor.ts:111` | `if (!Array.isArray(data)) throw new Error(...)` | **one batch, up to 250 medias.** A 429 body carries no `data`; read as an empty list it is an ANSWER about the show |
| P1 / P3 | `similar.ts:190`, `:208` | `within.length !== 1 \|\| foldVetoed(...)`; `foldVetoed(...) \|\| yearVetoed(...)` | **the pick is refused, never replaced.** A fall-through is how season 1 reached Netflix season 3 once season 1 was excluded |
| P10 | `similar.ts:149` | `theirs != null && evidence.episodeCount != null && theirs > evidence.episodeCount` | the FOLD veto, zero tolerance: a season holding more episodes than the run holds other runs too |
| W2 | `store/aggregate.ts:145` | `handle.relation === 'PART_OF' ? [{ ...handle.node, handles: [] }] : recursivelyUnwrapMediaHandles(handle.node)` | **the subtree cut.** Without it two runs hanging PART_OF off one show contribute SAME_AS pairs rooted at that show and union-find welds the seasons |
| W4 | `db.ts:140` | `if (isPlaceholder(media)) continue` | one row, not stored. A bare CONTAINER stamp is a description, not a placeholder |
| W6 | `db.ts:180-183` | `undescribed.length`, then `defer(uri, claim)` | the claim waits under EACH missing end. A uri with no row has no scope, and the relation is derived from both |
| W7 / W8 | `db.ts:187`, `:191` | `mediaScope !== handleScope`; `else if (claimed === 'SAME_AS')` | a cross-scope claim is silently demoted to a deletable edge whatever was claimed. **Only same-scope asserted sameness reaches `graph.link` at `:193`** |
| W12 | `db.ts:400-415` | **no condition at all** | **`upsertEpisodes` has none of the above**: no placeholder gate, no ratchet, no `pendingClaims`, no cross-scope demotion, and an unconditional `emit('episode:changed', {})` at `:414` |
| W14 | `graph.ts:166-167` | `if (mergeFns.length > 1) throw new Error(...)` | **the whole `graph.set` throws, failing one batch of up to 250 medias** |
| W15 | `graph.ts:85` | `if (rootA === rootB) return false` | already one component, so `changed` stays false and no listener re-reads |
| F3 to F6 | `fuzzy-merge.ts:397`, `:431`, `:494-497`, `:562-565` | each opens `a.X.size && b.X.size && ![...a.X].some(...)`; format and season test membership, the date one a `START_DATE_WINDOW_DAYS` gap, the companion one adds `namesCompanionContent` | one pair refused. **Only a DISAGREEMENT blocks**, never silence |
| F14 / F15 / F16 | `db.ts:219`, `:234`, `:250` | `scopeOf(uriA) === 'CONTAINER' \|\| scopeOf(uriB) === 'CONTAINER'`, and the two mirrors | a fuzzy union never touches a container, and a wrong RUN/CONTAINER order is refused rather than flipped |
| C5 / C6 | `consensus.ts:150`, `:153` | `support < MIN_ALIGNED`; `ranked[1][1] === support` | `alignmentOffset` answers `undefined` in every ambiguous case. Nothing is renumbered |
| C8 | `consensus.ts:234` | `if (backing.length < 2) return episodes.filter(...)` | the loan is declined whole rather than sliced on a single witness |
| R8 | `store/aggregate.ts:104` | `(handles ?? []).filter(handle => handle.relation === 'SAME_AS')` | **`sameAsHandleUris`, the filter that has to be applied anywhere sameness is assumed.** A PART_OF node is a SHOW |
| E1 | `src/worker.ts:17` | `refusesSeedAsset(location.href, input)` | `404`, never 503. A 503 there would be retried three times inside the backoff loop |

## What will surprise you

Ranked by how much time getting it wrong costs. More at [known divergences](/reference/divergences/).

| the trap | citation | what it costs |
| --- | --- | --- |
| The 45 day sweep's ratio improves MONOTONICALLY as the window widens, so optimising it picks 180 days, which ALLOWS the entire population the rule was built for (season 1 in months 1 to 4 against season 2 in months 7 to 10) | `fuzzy-merge.ts:28-40` | picking on the ratio disables the check while making it look better |
| An undecoded route parameter is not an error anywhere: both validators refuse `ag%3A(...)`, so the media subscription returns before asking a single source and the shell renders over nothing | `src/utils/uri.ts:152-160` | a session of measurement against pages that were never subscribed. A link built with `encodeURIComponent` is enough |
| An error body read as an empty list WAS an answer about the show. An empty `data` is a real answer; a missing one is not | `crunchyroll/extractor.ts:104-111` | 2026-09-05: three bodies described three seasons of zero episodes, the walk refused, the cache served it for ten minutes |
| `waitForMedia`'s probe must be SYNCHRONOUS, since a promise is always truthy | `sources/utils.ts:489-509` | an async probe never refuses and the wait always looks satisfied. Three sources carry the warning verbatim above their own probes |
| `worker/extractor.ts:351` looks like a refusal in a diff and is not: a repeat of a question already in flight JOINS it and shares its promise | `worker/extractor.ts:345-351` | refusing it cost a real record its Crunchyroll handle, since the answer was seconds away |
| `countOf` maps ZERO to `undefined` with `\|\|`, not `??`, on purpose: JustWatch lists a season as `0` until it airs and Apple offers no counts | `similar.ts:137` | read as a real length it defeats the FOLD veto, which is zero tolerance |
| `null <= 11` is `true` in JavaScript, so a null-numbered episode survives the window whether or not the guard exists | `tests/unit/worker/store/consensus.test.ts:182`, the test at `:185` | a green test that passes identically with the fix deleted |
| A phantom union-find member is exactly as permanent as a union, only invisible: `uf.find` calls `ensure`, which creates a singleton for any string, and no member is ever removed | `graph.ts:61-66`, skipped at `:321-323` and `:349-351` | reads look empty because `cluster` and `clusters` skip a member with no stored row. Only `link` creates one |
| `maskedErrors.maskError` does not mask: it logs the original and returns a fresh `GraphQLError` carrying the same message, with `message` and `isDev` accepted and unused | `worker/extractor.ts:499-503`; the app yoga says `maskedErrors: false` at `yoga.ts:28` | reads as a gap in a diff and is a logging hook wearing a masking name |
| `COMPANION_MARKERS` and `RETRYABLE_STATUSES` are membership tests, not regexes, and the companion test is a trailing suffix with a leading space | `fuzzy-merge.ts:92-95` with `namesCompanionContent` at `:189-199`; `backoff.ts:13` | a marker written mid-title silently never fires |
| `metadataOnly` gates nothing, for anybody, and it is in the PUBLIC plugin API; `official` and the module-level `categories` have no reader in `src` either | `src/plugin-api.ts:17` | a third-party author declares a field that decides nothing. What keeps `imdb` out of playback is `players.ts:12-13` |
| The module name is not the origin: jikan publishes `mal:`, crunchyroll `cr:`, unogs `nf:`, justwatch `jw:`, and JustWatch's package codes map to those origins too | `jikan/extractor.ts:13`, `crunchyroll:18`, `unogs:14`, `justwatch:18`; `justwatch/id.ts:75-79` | grepping for a `netflix:` uri finds nothing |
| Three stale counts disagree with the test. `worker/extractor.ts:230` says 23 sources, `docs/astro.config.mjs:17` says ~36, `vitest.config.ts:8` says 23 | pinned at `tests/unit/sources/index.test.ts:24` | the registry is 25 |
| Ten modules under `src/sources/` carry a header saying they exist because an extractor cannot be imported under vitest. Not true today: all of `src/sources/*/extractor.ts` load and their exports are callable | `vitest.config.ts:5-13`; stale headers at `catalogue-gate.ts:26-29`, `season.ts:9-10` | the claim nearly cost the regression test in `tests/unit/sources/crunchyroll/extractor.test.ts` |
| The four `0.9`s are four independent questions over different inputs, so moving one moves nothing else | `catalogue-gate.ts:98`, `crunchyroll/extractor.ts:366`, `fuzzy-merge.ts:7`, `similar.ts:303` | the shared value reads as coupling and is not. The two catalogue declarations are duplicated on purpose |

That is the whole system in eight pages. Everything under it is the same material at full width:
[the whole flow](/start/whole-flow/) opens the long version, and every page above links down into the
section it compresses.
