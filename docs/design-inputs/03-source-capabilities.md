# The Source Capability Matrix

What each of the 24 built-in sources can actually supply. A merge plugin may only read evidence that
exists, so this document is written as "what is on the wire", not "what the upstream has". Where an
upstream field is fetched and then dropped by the extractor, that is called out explicitly, because a
future plugin cannot use it until the extractor emits it.

Every claim carries a `file:line`. Paths are relative to `/home/banou/dev/stub`. Anything not
established from the code is marked `(unconfirmed)`.

The registry is pinned at 24 by `tests/unit/sources/index.test.ts:19-25`
(`expect(names).toHaveLength(24)`), and the live list is `Object.values(extractorDefinitions)` off
`src/sources/index.ts:1-33`.

**Module name is not origin.** Four modules publish under a different prefix: `jikan` -> `mal:`
(`src/sources/jikan/extractor.ts:13`), `crunchyroll` -> `cr:` (`src/sources/crunchyroll/extractor.ts:18`),
`unogs` -> `nf:` (`src/sources/unogs/extractor.ts:14`), `justwatch` -> `jw:`
(`src/sources/justwatch/extractor.ts:18`).

---

## 1. Identity: origin, id shape, scope, season scoping, cour folding

`scope` is `MediaScope` from `src/worker/resolvers/media/schema.gql:106-111`: `RUN` is one broadcast
run (a cour, a film), `CONTAINER` is a show or a series page. `makeMedia` defaults `scope: 'RUN'`
(`src/sources/utils.ts`), and the schema reads an absent value as RUN
(`src/worker/resolvers/media/schema.gql:266`). `partOf()` restamps the node it wraps as `CONTAINER`
whatever it said (`src/sources/utils.ts`).

`seasonScopedId(id, n)` is `` `${id}-s${n}` `` (`src/sources/season.ts:189`). JustWatch and unOGS use
different shapes, listed per row.

| module | origin | id shape (example) | scope it mints, and when | season scoped or show scoped | folds cours into seasons |
| --- | --- | --- | --- | --- | --- |
| jikan | `mal` | MAL numeric id, `mal:52991` (`jikan/extractor.ts:132,142`) | no `scope` key set at all (object literal `jikan/extractor.ts:130-191`), so RUN by schema default | SEASON scoped: MAL issues one entry per broadcast run | no |
| anilist | `anilist` | AniList numeric id, `anilist:108465` (`anilist/extractor.ts:597-599`) | no `scope` passed to `makeMedia` (`normalizeMedia`, `anilist/extractor.ts`), so RUN by default | SEASON scoped: one entry per run | no |
| anizip | `anizip` | the **AniDB** id, `anizip:18104` (`anizip/extractor.ts:18-19,80-86`) | no `scope`, RUN by default | SEASON scoped: "AniDB models one entry per RUN for anime" (`jikan/extractor.ts:144-145`) | no. It numbers within its own entry, `anizip/extractor.ts:78-96` |
| crunchyroll | `cr` | `crunchyrollId(seriesId, seasonId)` -> `` `${seriesId}-${seasonId}` `` (`crunchyroll/extractor.ts:151-152`); bare series id `cr:G24H1N3MP` is the show (`crunchyroll/extractor.ts:171-174`) | BOTH: `scopeOf` returns CONTAINER when `id === series.id`, RUN otherwise (`crunchyroll/extractor.ts:174`). Search mints the bare series id (`:587`) | SEASON scoped when a season segment is present, otherwise SHOW | **yes**. "Crunchyroll models a split cour as one season" (`crunchyroll/extractor.ts:379-384`) |
| unogs | `nf` | bare Netflix title id `nf:80987039`, or season-scoped `` `${id}-${seasonNumber}` `` -> `nf:80987039-3` (`unogs/extractor.ts:154,268-270,332`). Note: **no `-s` prefix**, unlike `seasonScopedId` | BOTH: `titleScope` gives RUN for `vtype === 'movie'`, CONTAINER otherwise (`unogs/extractor.ts:136`); a season rewrite forces RUN (`:270`) | SEASON scoped only when a season is established; otherwise the bare id is every season at once (`unogs/extractor.ts:134-136`) | **yes**. Netflix "folds Mushoku Tensei's five runs into three" and "splits Fullmetal Alchemist's single 64 episode run into five seasons" (`unogs/extractor.ts:337-340`) |
| justwatch | `jw` | `jwId(objectId, seasonObjectId)` -> `jw:222366-230388`, the season's OWN objectId not its ordinal (`justwatch/id.ts:13-20`); bare `jw:222366` for a movie or a container | BOTH: `showAsContainer` stamps CONTAINER (`justwatch/extractor.ts:452`); a season row is RUN by default; a movie's bare node id is RUN (`justwatch/id.ts:35`) | SEASON scoped by season objectId; a series with no season resolved is refused outright (`justwatch/extractor.ts:470`) | **yes**. Measured 2026-09-10 on Mushoku Tensei: "JustWatch publishes seasons of 23, 24 and 14 against our cours of 11/12/12/12/14" (`justwatch/extractor.ts:408-414`) |
| appletv | `appletv` | `seasonScopedId(content.id, n)` -> `appletv:umc.cmc.1srk2goyh2q2zdxcx605w8vtx-s2` (`appletv/extractor.ts:105`, id from `catalogue-gate.ts:219`); bare `umc.cmc...` for a movie or a show container | BOTH: `scoped || content.type === 'Movie' ? 'RUN' : 'CONTAINER'` (`appletv/extractor.ts:102`) | SEASON scoped, added specifically to stop the show id welding seasons (`catalogue-gate.ts:4-13`) | (unconfirmed) for anime. Measured 2026-08-30: 0 of 150 anime TV titles and 0 of 120 anime films produced any candidate clearing the gate (`catalogue-gate.ts:54-63`) |
| paramount | `paramount` | the show SLUG, `paramount:<slug>` (`paramount/extractor.ts:54`) | CONTAINER always (`paramount/extractor.ts:54`) | SHOW scoped | n/a, it models no season identity |
| disney | `disney` | never mints a media (`disney/extractor.ts:18`) | n/a | n/a | n/a |
| amazon | `amazon` | never mints a media (`amazon/extractor.ts:18`) | n/a | n/a | n/a |
| hulu | `hulu` | never mints a media (`hulu/extractor.ts:18`) | n/a | n/a | n/a |
| peacock | `peacock` | never mints a media (`peacock/extractor.ts:18`) | n/a | n/a | n/a |
| hbo | `hbo` | never mints a media (`hbo/extractor.ts:18`) | n/a | n/a | n/a |
| fubo | `fubo` | never mints a media (`fubo/extractor.ts:18`) | n/a | n/a | n/a |
| tmdb | `tmdb` | `seasonScopedId(m.id, n)` -> `tmdb:94664-s3` (`tmdb/extractor.ts:105`, example `:94-99`); bare `tmdb:94664` for search and for a show page | BOTH: `seasonNumber == null ? 'CONTAINER' : 'RUN'` (`tmdb/extractor.ts:106`) | SEASON scoped when a season can be picked; a multi-season show whose season cannot be determined yields **nothing** (`tmdb/extractor.ts:188`) | (unconfirmed) for anime. TMDB's own season split is upstream and unmeasured here |
| tvmaze | `tvmaze` | `seasonScopedId(show.id, n)` -> `tvmaze:52279-s3` (`tvmaze/extractor.ts:80`, example `:70-71`); bare `tvmaze:52279` for search | BOTH: `seasonNumber == null ? 'CONTAINER' : 'RUN'` (`tvmaze/extractor.ts:81`) | SEASON scoped; a multi-season show with no season resolved yields nothing (`tvmaze/extractor.ts:175`) | (unconfirmed). Its seasons come from its own episode list's `season` field (`tvmaze/extractor.ts:134-147`) |
| kitsu | `kitsu` | Kitsu numeric id, `kitsu:45950` (`kitsu/extractor.ts:134`, examples `:87-89`) | no `scope` passed (`kitsu/extractor.ts:132-171`), so RUN by default | SEASON scoped: kitsu:45950, 47694, 49002 are three different runs of Mushoku Tensei (`kitsu/extractor.ts:87-89`) | no |
| omdb | `omdb` | the **IMDb** id, `omdb:tt13303712` (`omdb/extractor.ts:43,51`) | BOTH: `result.Type === 'movie' ? 'RUN' : 'CONTAINER'` (`omdb/extractor.ts:47`) | SHOW scoped for a series ("the row is keyed by an IMDb id and IMDb models no seasons", `omdb/extractor.ts:40-41`) | n/a |
| trakt | `trakt` | trakt slug, else the numeric trakt id (`trakt/extractor.ts:74`), `trakt:mushoku-tensei-jobless-reincarnation` | CONTAINER always (`trakt/extractor.ts:95`, reason at `:76-79`) | SHOW scoped | n/a |
| simkl | `simkl` | simkl numeric id, `simkl:<id>` (`simkl/extractor.ts:143,148`) | BOTH: `scopeForType` gives CONTAINER for a `tv` record, RUN for `anime` and `movies` (`simkl/extractor.ts`) | **anime records are SEASON scoped**: "Mushoku Tensei is five records here, each with its own mal, anilist and kitsu id" (`simkl/extractor.ts:85-86`). `tv` records are show scoped | no, for `anime` records |
| tvdb | `tvdb` | TheTVDB series id, `tvdb:<id>` (`tvdb/extractor.ts:92,108-110`) | CONTAINER always (`tvdb/extractor.ts:96,113`, reason at `:32-34`) | SHOW scoped | n/a |
| offline | `offline` | borrowed catalogue id: `` `mal-${ml}` `` else `` `anilist-${al}` `` else `` `kitsu-${ku}` `` (`offline/normalize.ts:107-111`), e.g. `offline:mal-52991`. The seed half uses `run.key` (`offline/seed-source.ts`, the seed job, removed in HOR-577) | no `scope` passed (`seasonMedia`, `offline/normalize.ts`; `offline/seed-source.ts`), so RUN by default | SEASON scoped: manami is per-run and identity is borrowed from per-run catalogue ids | no |
| watchmode | `watchmode` | watchmode numeric id, `watchmode:<id>` (`watchmode/extractor.ts:189,205`) | BOTH: `scopeForType` gives RUN for a film, CONTAINER otherwise (`watchmode/extractor.ts:181-184`) | SHOW scoped. "Watchmode has no season concept anywhere in this file" (`watchmode/extractor.ts:90-92`) | n/a |
| imdb | `imdb` | never mints a media; the origin exists so an `imdb:tt...` handle has something to render against (`imdb/extractor.ts:3-18`) | n/a | SHOW scoped by definition; `SHOW_LEVEL_ORIGINS = new Set(['imdb'])` forces every imdb uri to CONTAINER in the store (`src/worker/store/db.ts:42,92`) | n/a |

### Scope facts a plugin must not re-derive

- A `partOf(node)` handle **always** arrives with the node restamped CONTAINER, whatever the producer
  set (`src/sources/utils.ts`).
- The store makes scope sticky toward CONTAINER and forces imdb there
  (`src/worker/store/db.ts:92`), so a `sameAs` imdb handle from tvmaze, tvdb, trakt, omdb or simkl
  unions in the CONTAINER space, not the run space (`src/worker/store/db.ts:94`).
- A row carrying only `uri`, `origin`, `id`, `scope` is a **placeholder** and is not stored at all
  (`IDENTITY_FIELDS`, `src/worker/store/db.ts:104-108`). Every node minted by
  `buildHandlesFromUri` (`src/sources/utils.ts`) and every seed handle
  (`offline/seed-source.ts`, the seed job, removed in HOR-577) is exactly that.

---

## 2. What each source supplies for a MEDIA

Legend: a dash means the extractor never sets the field. `desc(x, s)` fills `descriptions` and
`shortDescriptions` with the same `en` string (`src/sources/utils.ts`), so wherever
"description" appears both fields carry it.

### jikan (`mal`), SCORE 0.9 (`jikan/extractor.ts:26`)

- **titles**: `en` (`title_english`), `jp-en` (`title`, romaji), `jp` (`title_japanese`) (`:160-164`). The
  season scrape path carries `en` and `jp-en` only (`:287-290`).
- **descriptions**: `en` synopsis, score 0.9 (`:152-159`).
- **dates**: `startDate = data.aired.from`, `endDate = data.aired.to` (`:186-187`), an upstream ISO
  string. `season` from `lowerSeason(data.season)` upper-cased (`:128,184`), `seasonYear = data.year`
  (`:185`). A season MAL spells unknown becomes null rather than reaching the store (`:182-184`).
- **episodeCount**: `data.episodes` (`:172`).
- **status**: mapped from `Not yet aired` / `Currently Airing` / `Finished Airing` (`:177-181`). No
  CANCELLED or HIATUS.
- **covers**: one, language `en`, `malLargeImage(images.webp.large_image_url)` (`:165-169`).
  **banners: `[]`** (`:170`).
- **scores**: `averageScore = percentScore(data.score, 10)` (`:151`), i.e. a 0-10 rating scaled to
  0-100 (`average-score.ts`).
- **popularity**: `data.members` (`:173`), the MAL member count.
- **genres**: `genres + themes + demographics` concatenated, deduplicated case-insensitively
  (`:63-73,174`). `explicit_genres` deliberately excluded (`:62`). **tags: `[]`** (`:175-176`).
- **relations / franchise**: none. `relations: []` (`:189-190`); the upstream `relations` field exists
  in the type (`:551`) and is never read.
- **trailers**: YouTube, from `trailer.youtube_id` or an embed url (`:104-126,188`).
- **offers / playable urls**: none. `url` is the myanimelist.net page (`:143`).
- **handles it hands over**: `anidb:<aid>` SAME_AS and `anizip:<aid>` SAME_AS, both gated on the id
  being numeric and both minted only when `anidbIdFromUrl` reads a real id (`:48-58,82-102,146-149`).
  Both are RUN-scoped claims: "AniDB models one entry per RUN for anime, and anizip is keyed on the
  anidb id, so neither names a container" (`:144-145`). **It mints no imdb handle**, contrary to the
  comment at `imdb/extractor.ts:5-6`.

### anilist (`anilist`), SCORE 0.8 (`anilist/extractor.ts:217`)

- **titles**: `en` (english), `jp-en` (romaji), `jp` (native) (`:631-635`). `synonyms` is fetched
  (`:52`) and never emitted.
- **descriptions**: `en`, score 0.8 (`:623-630`).
- **dates**: `startDate` and `endDate` through `airedDate` (`:592-593,650-651`), which prefers a
  complete `FuzzyDate`, falls back to the airing schedule's episode 1 timestamp, and only then coerces
  a bare year to January 1 (`aired-date.ts`). `season` (`:604`, guarded against an unknown
  spelling at `:411-414`), `seasonYear` (`:605`).
- **episodeCount**: `media.episodes` (`:641`).
- **status**: the full five-member map including CANCELLED and HIATUS (`:643-649`).
- **covers**: one, language `jp`, `coverImage.extraLarge` with `color` (`:636-640`).
  **banners: none.** `bannerImage` is fetched (`:60`) and never emitted.
- **scores**: `averageScore = percentScore(media.averageScore, 100)` (`:621`).
- **popularity**: `media.popularity` (`:642`).
- **genres**: `media.genres` (`:602`). **tags**: AniList's own vocabulary, spoiler-flagged tags dropped
  (`:406-409,603`). AniList is the only source of `tags` (`src/worker/resolvers/media/schema.gql`).
- **relations (narrative)**: the only source that supplies them. AniList's `relationType(version: 2)`
  vocabulary, unknown values carried as `OTHER` (`:416-472,618`). Non-anime relations are kept and
  carry their kind on the edge's `format` string (`:436-439`).
- **franchise**: the only source that supplies one. A two-hop breadth-first walk following only
  `FRANCHISE_EDGES` (SEQUEL, PREQUEL, SIDE_STORY, SPIN_OFF, ALTERNATIVE, PARENT, SOURCE, ADAPTATION,
  SUMMARY, COMPILATION, CONTAINS), with CHARACTER and OTHER reported but never traversed
  (`:474-544`). Returns `undefined` for a graph of one node (`:541-542`).
- **nextAiringEpisode**: from the airing schedule, by earliest future timestamp (`:622`,
  `next-airing.ts`, since removed).
- **trailers**: YouTube only (`:652-662`).
- **offers**: none.
- **handles it hands over**:
  - `mal:<idMal>` SAME_AS, unconditional when `idMal` is present (`:581-590,614-617`).
  - `cr:<...>` through `siteMappings` siteId 5: it reads a `crunchyroll.com/series/(\w+)` url off
    AniList's own `externalLinks` and then **asks `similarMedia('cr', ...)`** with its own start date,
    titles and episode count, minting a SAME_AS handle for whatever RUN Crunchyroll answers with
    (`:227-253,354-367`). The show is settled by AniList's first-party mapping, the season by
    Crunchyroll. This is the only cross-source ask made from inside an extractor's media path.

### anizip (`anizip`), SCORE 0.9 per field, **no `score` on the row** (`anizip/extractor.ts:15,34-102`)

- **titles**: `en` and **`ja`** (`:40-43`). Note the language code: `ja`, where anilist and jikan use
  `jp`.
- **descriptions**: none at media level.
- **dates**: none at media level. No startDate, endDate, season or seasonYear.
- **episodeCount**: `media.episodeCount` (`:52`).
- **status / genres / tags / popularity / averageScore / type**: none.
- **covers**: every image with `coverType === 'Poster'` (`:44-47`). **banners**: every
  `coverType === 'Banner'` (`:48-51`).
- **relations / franchise / offers**: none.
- **handles it hands over**: `mal:<mal_id>` and `anilist:<anilist_id>`, both SAME_AS via the
  `makeMedia` default (`:21-32,34-39`, `utils.ts`). The mappings payload also carries kitsu, anidb,
  thetvdb, imdb and themoviedb ids (`:174-187`) and **none of those is minted**.
- **addressability**: `supportedUris = ['anidb', 'mal']` (`:13`) but the resolver reads only the `mal`
  id out of the aggregated uri (`:120-127`). A cluster holding an anidb id and no mal id gets a
  refusal that is indistinguishable from "knows nothing".

### crunchyroll (`cr`), SCORE 0.5 (`crunchyroll/extractor.ts:12`)

- **titles**: one, `en`, the season's title when it names more than a position, else the series title
  (`:244-248,184`). `isOnlySeasonLabel` is what keeps the literal string "Season 3" out of the store
  (`season.ts:113-129`).
- **descriptions**: `en`, the season's description falling back to the series' (`:185,253`).
- **dates**: `startDate` **only on the SHOW-level media**, and only as
  `` `${series_launch_year}-01-01` `` (`:188-191`). A season-scoped Crunchyroll media asserts **no
  start date at all**. `namesADay` refuses that January 1 shape (`season.ts:223-228`).
- **episodeCount**: the length of the fetched episode list (`:274`), or `series_metadata.episode_count`
  on a search row (`:587`).
- **status / genres / tags / season / seasonYear / averageScore / popularity / endDate / type**: none.
- **covers**: `images.poster_tall`, rewritten onto the CDN host (`:154-168,186`). **banners**:
  `images.poster_wide` (`:187`).
- **relations / franchise**: none.
- **offers / playable urls**: yes. The media url is `/series/<id>/<slug>` (`:181`), every episode url
  is `https://www.crunchyroll.com/watch/<episodeId>` (`:200`), and `cr` is one of the two origins with
  a registered player (`src/sources/players.ts:11-14`).
- **handles it hands over**: none of its own. On the search path it rebuilds SAME_AS handles for every
  origin already in the aggregated uri (`buildHandlesFromUri`, `:527`, `utils.ts`) - those are
  placeholders that the store does not persist. The container-lending path deliberately returns
  `handles: []` (`:434-439`).

### unogs (`nf`, Netflix), SCORE 0.2 (`unogs/extractor.ts:8`)

- **titles**: one, `en`, HTML-entity decoded (`:125-130,159`).
- **descriptions**: `en` synopsis, decoded (`:160`).
- **dates**: `` `${title.year}-01-01` `` at TITLE level only (`:162`), and **deleted outright when the
  row is season-scoped** (`:271-287`): "unOGS gives no season premiere to use: `UnogsEpisode` carries
  epid, seasnum, synopsis, title and img, and no air date at all." So a Netflix RUN row has **no date
  of any kind**.
- **episodeCount**: the length of the filtered episode list (`:296`), 1 for a film (`:299`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **covers / banners**: `title.img` plus the `bgimages` payload's `bo166x236`, `bo665x375`,
  `bo342x192` and `bg` (`:138-151`).
- **scores**: `averageScore = percentScore(title.imdbrating, 10)` (`:163`), IMDb's rating restated.
- **relations / franchise**: none.
- **offers / playable urls**: yes. `https://www.netflix.com/title/<id>` on the media (`:155`),
  `https://www.netflix.com/watch/<epid>` on each episode (`:189`), and a film's synthetic episode is
  given a `/watch/` url (`:199-201`). `nf` is the second origin with a registered player
  (`players.ts:11-14`).
- **handles it hands over**: none of its own; `buildHandlesFromUri` rebuilds the cluster's on the
  aggregated paths (`:439,457`).

### justwatch (`jw`), SCORE 0.2 (`justwatch/extractor.ts:12`)

**The season row carries almost no metadata.** `normalizeMedia`'s `makeMedia` call
(`:520-536`) sets `origin, id, categories, url, score, handles, episodes, episodeCount, startDate`
and **no titles, no covers and no descriptions**. The comment at `:538` ("JustWatch keeps title and
description on the per provider offer handles") no longer describes the code: `buildOffersAsHandles`
receives `meta.title`, `meta.posterUrl` and `meta.shortDescription` (`:320-322`) and reads only
`meta.seasonNumber` and `meta.showContainer` (`:372,385`), minting bare
`makeMedia({ origin, id, url })` nodes (`:399`).

- **titles**: only on the CONTAINER row from `showAsContainer` (`:456`), on the PART_OF show-container
  handle node (`:515`) and on a film's synthetic episode (`:542`).
- **descriptions**: same three places (`:457,543`).
- **dates**: `startDate = ${seasonYear}-01-01` where `seasonYear` is the SEASON's
  `originalReleaseYear` falling back to the show's (`:476,535`). Year granularity only, coerced to
  January 1, so `namesADay` refuses it (`season.ts:203-228`).
- **episodeCount**: the released episode count, else the sum of `totalEpisodeCount` over the filtered
  seasons, else undefined (`:530`). A `totalEpisodeCount` of 0 is offered as **no count** rather than
  as a short season (`:307-309,313`).
- **status / genres / tags / season / seasonYear / averageScore / popularity / endDate / type**: none.
  `genres { shortName }` is fetched (`:86-88,149-151`) and never emitted.
- **covers**: container row only (`:458`).
- **relations / franchise**: none.
- **offers**: this is the source's whole purpose. `offers` in US plus `extraOffers` in JP
  (`OFFER_COUNTRIES`, `:29-40`), filtered to `FLATRATE | FLATRATE_AND_BUY | FREE | ADS` (`:329`),
  mapped through `PACKAGE_ORIGIN_MAP`'s 13 package shortNames onto 9 origins (`justwatch/id.ts:75-79`),
  deduplicated by ORIGIN not by package (`:342-343`).
- **handles it hands over**, with the relation and the condition:
  - `cr`, `nf`, `disney`, `amazon`, `appletv`, `hulu`, `hbo`, `peacock`, `paramount`, `fubo`: the
    provider's own id read out of the deep link by `extractContentId`, which is host-shape tested per
    provider (`justwatch/id.ts:95-144`).
  - **SAME_AS** only for a film's own id, or for the Crunchyroll season a film's `/watch/` episode url
    resolves to (`:348-351,372-377,400`).
  - **PART_OF** whenever the offer was read on a SHOW: `if (meta.seasonNumber != null) relation = 'PART_OF'`
    (`:385`), and unconditionally for Crunchyroll, which `providerContentId` refuses outright
    (`:386-392`, `justwatch/id.ts:59-60`).
  - A season row also mints `partOf(jw:<objectId>)`, the show container, which is what makes JustWatch
    askable through `similarMedia` and what lets the container space union `jw:<objectId>` with
    `cr:<series>` and `tvmaze:<show>` (`:504-518`).
  - The Crunchyroll episode-to-series resolution costs a Crunchyroll token plus a CMS request and is
    gated on `policy.crossSource`, so it never runs on a listing (`:362-377`).

### appletv (`appletv`), SCORE 0.2 (`appletv/extractor.ts:10`)

- **titles**: one, `en` (`:110`).
- **descriptions**: `en` (`:111`).
- **dates**: `startDate` is the SEASON's `releaseDate` when scoped, else the show's or the film's
  (`:98,115`). **Epoch milliseconds**, established from real values rather than assumed
  (`catalogue-gate.ts:216-228`): Severance season 1 is `1645142400000` = 2022-02-18. Measured over 150
  seasons of 83 shows, 0 seasons were missing `seasonNumber` and 0 were missing `releaseDate`, and a
  season's `releaseDate` equalled the earliest release date among its own episodes on 150 of 150
  (`catalogue-gate.ts:224-228`). This is **day precision at season level**, the finest any streaming
  catalogue here offers.
- **episodeCount**: the length of the fetched episode list (`:258`), 1 for a film (`:252`).
- **status / genres / tags / season / seasonYear / averageScore / popularity / endDate / type**: none.
- **covers**: `contentImageTall` at 600x900 (`:102`). **banners**: `contentImage` at 1920x1080 (`:103`).
- **relations / franchise**: none.
- **offers**: the media `url` is `content.url` on tv.apple.com (`:108`) and each episode carries
  `episode.url` (`:124`). No player is registered for `appletv` (`players.ts`).
- **handles it hands over**: none of its own; `buildHandlesFromUri` on the aggregated paths
  (`:380,393`).

### paramount (`paramount`), SCORE 0.2 (`paramount/extractor.ts:9`)

- Supplies **no titles, no descriptions, no covers, no dates, no counts, no scores**. The media is
  `makeMedia({ origin, id: slug, url, score, scope: 'CONTAINER', categories: ['SERIES'] })` and
  nothing else (`:54`).
- **episodes only**, and only when every episode is in one season (`:66-72`).
- **handles**: none.
- **offers**: `https://www.paramountplus.com/shows/<slug>` (`:54`) and per-episode urls (`:43`).

### disney, amazon, hulu, peacock, hbo, fubo

All six yield `{ media: null }` on every call, for ever
(`disney/extractor.ts:18`, `amazon/extractor.ts:18`, `hulu/extractor.ts:18`, `peacock/extractor.ts:18`,
`hbo/extractor.ts:18`, `fubo/extractor.ts:18`). They exist so JustWatch has an origin to mint a handle
into and so a row can render with a name and an icon. They supply **nothing** a merge plugin can read.

### tmdb (`tmdb`), SCORE 0.3 (`tmdb/extractor.ts:11`)

Reads TMDB's server-rendered HTML, not the API (`:9`).

- **titles**: one, `en`, from `og:title` (`:68,110`).
- **descriptions**: `en`, from `og:description` (`:69,111`).
- **dates**: `startDate` **only on the show-level row**, as `` `${m.year}-01-01` `` (`:122`). A
  season-scoped TMDB media asserts **no date at all**: "unlike tvmaze there is no season air date to
  substitute: this scrapes HTML and only ever sees the one year" (`:115-121`).
- **episodeCount**: the length of the parsed episode list (`:192`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **covers**: `og:image` (`:70,112`). **banners**: the `w1920` backdrop (`:61,113`).
- **scores**: `averageScore = percentScore(user_score_chart data-percent / 10, 10)` (`:62,73,114`).
- **relations / franchise / offers**: none.
- **handles it hands over**: **none**. `normalizeMedia` (`:102-123`) passes no `handles`.

### tvmaze (`tvmaze`), SCORE 0.3 (`tvmaze/extractor.ts:9`)

- **titles**: one, `en`, `show.name` (`:86`).
- **descriptions**: `en`, HTML-stripped `summary` (`:23-33,87`).
- **dates**: `startDate` is `show.premiered` on the container, and **the season's own premiere** on a
  season row, computed as the earliest `airdate` among that season's episodes, taken by date and not
  by episode number (`:98-101,119-128,102`). That is a real day-precise season date, off the embedded
  episode list with no extra request.
- **episodeCount**: the length of the filtered episode list (`:154`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **covers**: `image.original` falling back to `medium` (`:88`). **banners**: none.
- **scores**: `averageScore = show.rating.average` (`:103`), passed through **unconverted**. TVmaze
  rates 0 to 10 while `Media.averageScore` is documented as a 0 to 100 percentage
  (`percentScore`, `average-score.ts`), so this source emits a value on the wrong scale.
- **relations / franchise / offers**: none.
- **handles it hands over**: `imdb:<externals.imdb>`, stamped `scope: 'CONTAINER'`, relation
  **SAME_AS** by the `makeMedia` default (`:60-64,75,151`). The store demotes it into the CONTAINER
  identity space anyway (`src/worker/store/db.ts:42,92,94`). `externals.thetvdb` is in the type
  (`:46`) and is never minted.

### kitsu (`kitsu`), SCORE 0.3 (`kitsu/extractor.ts:12`)

- **titles**: `en` (`titles.en`), `en` again (`canonicalTitle`, deduplicated), `ja` (`titles.ja_jp`)
  (`:116-125,146`).
- **descriptions**: `en` synopsis (`:147`).
- **dates**: `startDate` and `endDate` straight from the upstream attributes (`:150-151`). kitsu
  answers `YYYY-MM-01` whenever only the month is known, which reads as exact and is up to 30 days out
  (`season.ts:203-207`), so `namesADay` refuses a first-of-month kitsu date.
- **episodeCount**: overwritten by the length of the fetched episode list (`:216`), after being set
  from `attr.episodeCount` (`:152`).
- **status**: `current` / `upcoming` / `finished` mapped to RELEASING / NOT_YET_RELEASED / FINISHED
  (`:155-159`). No CANCELLED or HIATUS.
- **covers**: `posterImage` (`:148`). **banners**: `coverImage` (`:149`).
- **scores**: `averageScore = percentScore(attr.averageRating, 100)` (`:170`).
- **popularity**: `attr.userCount` (`:153`).
- **genres**: **deliberately none** (`:127-129`): they are a separate JSON:API relationship and would
  grow every request to buy a field AniList and jikan already answer.
- **season / seasonYear**: only on the SEASON LISTING path, stamped from the request's own filter and
  nowhere else (`:234-240`).
- **type**: TV / movie / special / OVA / ONA (`:139-145`).
- **trailers**: YouTube from `youtubeVideoId` (`:160-169`).
- **relations / franchise**: none.
- **handles it hands over**:
  - `anilist:<id>` and `mal:<id>` SAME_AS, from the JSON:API `mappings` include (`:65-74`).
  - Streaming links, through `streamPointers` (`kitsu/stream-id.ts:38-52`), which reads `cr`, `nf`,
    `hulu`, `disney`, `amazon`, `hbo` off the HOSTNAME and an id out of a
    `/(series|title|watch|shows?)/` path segment.
  - **SAME_AS only under an AND**: the record's `subtype` must be `movie` **and** the (origin, segment)
    pair must be in the measured allowlist `ONE_TITLE_IDS = {'nf:title', 'nf:watch'}`
    (`kitsu/extractor.ts:94-108`, `kitsu/stream-id.ts:82,114`).
  - **PART_OF for everything else** (`kitsu/extractor.ts:96,107`), because "Kitsu publishes the same
    `crunchyroll.com/series/G24H1N3MP/...` on kitsu:45950, kitsu:47694 and kitsu:49002, three
    different runs of Mushoku Tensei" (`:82-92`).

### omdb (`omdb`), SCORE 0.3, needs an API key (`omdb/extractor.ts:8,24-27`)

- **titles**: one, `en` (`:56`).
- **descriptions**: `en`, `Plot` with `plot=full` (`:57,86`).
- **dates**: `` `${year}-01-01` `` parsed out of the `Year` string (`:45,60`). Year granularity,
  coerced.
- **episodeCount**: only for a single-season series or a film (`:102-110`); **explicitly cleared to
  `undefined` for a multi-season show** (`:105-106`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **covers**: `Poster` (`:58`). **banners**: none.
- **scores**: `averageScore = percentScore(imdbRating, 10)` (`:59`).
- **relations / franchise / offers**: none.
- **handles it hands over**: `imdb:<imdbID>` with the row's own scope (RUN for a film, CONTAINER for a
  series), relation **SAME_AS** (`:47,53`). Since the row's own id IS the imdb id, this is a restatement
  rather than new information.

### trakt (`trakt`), SCORE 0.3, needs a Client ID (`trakt/extractor.ts:7,59-72`)

- **titles**: one, `en` (`:99`).
- **descriptions**: `en` overview (`:100`).
- **dates**: `startDate = new Date(show.first_aired).toISOString()` (`:101`), a real day-precise date,
  but it is the SHOW's first airing, and the row is always CONTAINER.
- **episodeCount**: only when every episode is in one season (`:143-148`).
- **covers / banners**: **none**. `normalizeMedia` (`:87-104`) sets neither.
- **scores**: `averageScore = Math.round(rating * 10)` (`:102`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **relations / franchise / offers**: none.
- **handles it hands over**: `imdb:<ids.imdb>` and `tmdb:<ids.tmdb>`, both stamped
  `scope: 'CONTAINER'`, both relation **SAME_AS** (`:80-85`). The comment names the tmdb one as the
  dangerous half, since `tmdb/extractor.ts` mints real `<id>-s<n>` runs a bare id must never union
  with (`:76-79`), and unlike imdb, `tmdb` is not in `SHOW_LEVEL_ORIGINS` (`src/worker/store/db.ts:42`)
  - the CONTAINER stamp on the node is what holds it.

### simkl (`simkl`), SCORE 0.3, needs a Client ID (`simkl/extractor.ts:8,69-73`)

- **titles**: up to two, both language `en`: `title` and `en_title` (`:133-140,170`). No native title.
- **descriptions**: `en` overview (`:171`).
- **dates**: `startDate = detail.first_aired` (`:174`). Search rows carry no date. No endDate, no
  season, no seasonYear.
- **episodeCount**: the length of the fetched episode list (`:215`), 1 for a film (`:211`).
- **status / genres / tags / popularity / type**: none.
- **covers**: `simkl.in/posters/<path>_m.jpg` (`:75,172`). **banners**: `fanart` (`:76,173`).
- **scores**: `averageScore = percentScore(ratings.simkl ?? ratings.imdb ?? ratings.mal, 10)`
  (`:130-131,175`).
- **relations / franchise / offers**: none.
- **handles it hands over**: `imdb` (RUN for a film, CONTAINER otherwise, `:92,123`), `mal`, `anilist`,
  `kitsu` (`:124-126`), all relation **SAME_AS**. The three anime ids are RUN-scoped and per-run, which
  is the reason this source is worth reading. **`tmdb` is refused in both directions** (`:94-119`): on
  a tv or anime record it is the show's one id repeated on all five Mushoku Tensei runs; on a movie
  record TMDB numbers movies and tv in separate sequences that both start at 1, so `tmdb:550` is Fight
  Club as a movie and Till Death Us Do Part as a series.

### tvdb (`tvdb`), SCORE 0.3, needs an API key, optionally `apikey:pin` (`tvdb/extractor.ts:7,55-67`)

- **titles**: one, `en` (`:100,118`).
- **descriptions**: `en` overview (`:101,119`).
- **dates**: `startDate = series.firstAired` on the detail path (`:121`), a real date;
  `` `${result.year}-01-01` `` on the search path (`:103`).
- **episodeCount**: only when every episode is in one season (`:169-174`).
- **covers**: `image` / `image_url` resolved against the artworks host (`:22-23,102,120`).
  **banners**: none.
- **scores**: **deliberately none** (`:122-125`): TheTVDB's `score` is a popularity ranking in the
  thousands, not a rating.
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **relations / franchise / offers**: none.
- **handles it hands over**: `imdb` and `tmdb` off `remoteIds`, both stamped `scope: 'CONTAINER'`,
  both relation **SAME_AS** (`:25-44`).

### offline (`offline`), SCORE 0.2 (`offline/normalize.ts:31`)

Two halves. The BUNDLED half is compiled in; the SEEDED half is a release asset fetched at runtime
(`offline/extractor.ts:53-79`).

Bundled season rows (`seasonMedia`, `offline/normalize.ts`):

- **titles**: one, `en` (`:169`).
- **descriptions**: `en`, only for the current season, from MyAnimeList's synopsis fetched at build
  time (`:173-181`).
- **dates**: **none, deliberately**. "`status`, `startDate` and `endDate` are deliberately absent"
  because manami's status is a snapshot from the dump's cut date (`:129-133`).
- **season / seasonYear**: from the BUCKET KEY, the only place the bundle states them (`:141-144,165-166`).
- **episodeCount**: `record.ep` (`:171`).
- **covers**: one, from `record.p`, prefixed only when it is not already absolute (`:33-48,170`).
  **banners**: none.
- **scores**: `averageScore = Math.round(record.sc * 10)` (`:193`).
- **popularity**: MyAnimeList's member count, fetched per season at build time (`:172,134-139`).
- **genres / tags**: **deliberately none**, on a payload-size argument, measured: adding tags takes the
  bundle from 29,628 to 48,538 brotli bytes (`:146-152`).
- **type**: TV / MOVIE / OVA / ONA / SPECIAL (`:90-96,164`).
- **trailers**: YouTube, current season only (`:182-191`).
- **handles it hands over**: `mal`, `anilist`, `kitsu`, all SAME_AS (`:113-119`). The index half adds
  `anidb` and requires at least TWO handles before returning anything, since "a single handle links
  nothing to anything" (`offline/extractor.ts:158-173`).

Seeded rows (`offline/seed-source.ts`, the seed job, removed in HOR-577) additionally carry multi-language `titles`, `covers`
and `banners` with their own language codes (`:210-212`), `type`, `categories`, `episodeCount`,
`averageScore`, `popularity`, `isAdult` and `season` (`:213-219`), plus:

- **handles**: `run.identity` as SAME_AS and `run.containers` as **PART_OF, deliberately unstamped**
  (`:147-159`): `partOf` from utils would copy the node scoped CONTAINER and the store keeps CONTAINER
  for good, so the seed uses a raw `{ node, relation: 'PART_OF' }` and lets the owning source say what
  the id is.
- Every seed handle node is identity-only, so it is a placeholder the store does not persist
  (`:136-148`, `src/worker/store/db.ts:104-108`).

### watchmode (`watchmode`), SCORE 0.25, needs an API key (`watchmode/extractor.ts:11,58-63`)

- **titles**: one, `en` (`:198,219`).
- **descriptions**: `en` `plot_overview` (`:220`).
- **dates**: **none**. `WatchmodeDetail.year` exists (`:41`) and `normalizeDetail` (`:202-224`) never
  emits a `startDate`.
- **episodeCount**: 1 for a film only (`:233-236`). No episode list for a series at all (`:271`).
- **covers**: `detail.poster` (`:221`). **banners**: none.
- **scores**: `averageScore = Math.round(user_rating * 10)` (`:222`).
- **status / genres / tags / season / seasonYear / popularity / endDate / type**: none.
- **relations / franchise**: none.
- **offers**: the `/title/<id>/sources/` payload, mapped by hostname onto `cr`, `nf`, `hulu`,
  `disney`, `amazon`, `hbo` (`:65-76`), with the id read by JustWatch's own shape-tested
  `extractContentId` (`:105-108`).
- **handles it hands over**:
  - `imdb:<tt...>` **PART_OF, unconditionally** (`:155`).
  - `tmdb:<id>` **PART_OF**, and only when `tmdb_type !== 'movie'` (`:160-163`).
  - provider ids: **SAME_AS** only when the record is a film AND the pointer clears
    `mintableAsFilmHandle` (i.e. `nf:title` or `nf:watch`), **PART_OF** otherwise (`:118-135`).
  - Watchmode was unplugged for three commits on 2026-09-04 and returned on 2026-09-05 unchanged in
    what it knows and changed in what it claims (`src/sources/index.ts:26-33`).

### imdb (`imdb`)

Answers `{ media: null }` always (`imdb/extractor.ts:33`), asserted by
`tests/unit/sources/index.test.ts:60-74`. It supplies **nothing**. It is a registered origin so that
an `imdb:tt...` handle minted by omdb, simkl, trakt, watchmode, tvmaze or tvdb has a name and an icon
to render against (`imdb/extractor.ts:5-9`).

---

## 3. What each source supplies for EPISODES

Columns: **numbers** (`episodeNumber` is season relative in this schema;
`absoluteEpisodeNumber` is the series-wide count, `src/worker/resolvers/episode/schema.gql:28-30`),
**titles**, **release date**, **thumbnails**, **runtime**, and **where the episodes arrive**: inside
the media row, or through the `Media.episodes` field resolver.

| source | episodeNumber | absolute | seasonNumber | titles | release date | thumbnails | runtime | arrives |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jikan | none | none | none | none | none | none | none | `episodes: []` (`jikan/extractor.ts:171`). **Supplies no episodes at all.** |
| anilist | none | none | none | none | none | none | none | **No episodes.** No `episodes` key in `normalizeMedia` (`anilist/extractor.ts`), no `Media.episodes` resolver (`:730-754`) |
| anizip | **the KEY of the episodes map**, not `episode.episodeNumber` (`anizip/extractor.ts:78-96`) | `absoluteEpisodeNumber` (`:97`) | yes (`:77`) | `en` and `ja` (`:64-67`) | **yes**: `airDateUtc ?? airdate` (`:99`). `airDateUtc` is an instant with seconds precision, `airdate` names a day; measured over 132 episodes, `airdate` on 132 and `airDateUtc` on 94 (`:145-157`) | yes (`:76`) | `runtime ?? length` (`:98`) | **inside the media row** (`:53-101`) |
| crunchyroll | `ep.episode_number` (`crunchyroll/extractor.ts:206`) | `ep.sequence_number` (`:207`) | yes (`:205`) | one, `en` (`:202`) | **yes**: `episode_air_date` as ISO (`:208`) | yes (`:204`) | none | both: inside the media row for a season-scoped id (`:272-275`), and through `Media.episodes` (`:591-597`) |
| unogs | **positional index `i + 1`**, not an upstream number (`unogs/extractor.ts:294,500`) | none | `episode.seasnum` (`:194`) | one, `en`, decoded (`:191`) | **NONE.** `UnogsEpisode` is `epid, seasnum, synopsis, title, img` (`:98-104`) and no air date exists at any level (`:281-284`) | yes (`:193`) | none | both (`:293-296`, `:492-503`) |
| justwatch | `ep.content.episodeNumber` (`justwatch/extractor.ts:560`) | none | yes (`:559`) | one, `en` (`:557`) | **none** (`:551-562`) | none | **yes**, `ep.content.runtime` (`:561`) | both. `NODE_QUERY` asks `episodes(limit: 50)` per season (`:195`) and filters on `isReleased` (`:489`) |
| appletv | `episode.episodeNumber` (`appletv/extractor.ts:130`) | none | yes (`:129`) | one, `en` (`:126`) | **yes**, epoch ms converted to ISO (`:131-134`) | yes, the episode's own `contentImage` at 1280x720 (`:141`) | none | both (`:257`, `:426-435`). **Caveat: 27.280% of the episodes Apple answers for a season belong to another season** (`:137-155`), so the list is filtered and deduped by id (`:175-183`) |
| paramount | `episode_num` (`paramount/extractor.ts:48`) | none | `season_num` (`:47`) | one, `en` (`:45`) | none | yes (`:46`) | none | both, but the media row only keeps them when every episode is one season (`:66-72`) |
| tmdb | `episode.number` (`tmdb/extractor.ts:135`) | none | yes (`:134`) | one, `en` (`:131`) | **none** (`:125-136`) | yes, the still (`:133`) | none | both (`:191`, `:222-232`) |
| tvmaze | `episode.number` (`tvmaze/extractor.ts:116`) | none | `episode.season` (`:115`) | one, `en` (`:112`) | **none emitted**, although `TvmazeEpisode.airdate` is fetched (`:54`) and used to compute the season premiere (`:119-128`) | yes (`:114`) | none | both (`:153`, `:222-231`) |
| kitsu | `attr.number` (`kitsu/extractor.ts:185`) | none | `attr.seasonNumber` (`:184`) | one, `en`, `canonicalTitle` (`:181`) | **none.** `KitsuEpisodeAttr` carries no date field at all (`:42-48`) | yes (`:183`) | none | both (`:214`, `:318-323`). Paged 20 at a time up to 2,000 (`:189-198`) |
| omdb | `Number(episode.Episode)` (`omdb/extractor.ts:72`) | none | yes (`:71`) | one, `en` (`:70`) | none | none | none | both, one request per season, and only for a single-season show on the media row (`:75-83,102-106`) |
| trakt | `episode.number` (`trakt/extractor.ts:116`) | none | yes (`:115`) | one, `en` (`:113`) | **none emitted**, although `TraktEpisode.first_aired` is in the type (`:49`) | none | none | both (`:143-148`, `:176-182`) |
| simkl | `episode.episode` (`simkl/extractor.ts:191`) | none | `episode.season` (`:190`) | one, `en` (`:187`) | **none emitted**, although `SimklEpisode.date` is in the type (`:66`) | yes (`:189`) | none | both (`:214`, `:259-266`) |
| tvdb | `episode.number` (`tvdb/extractor.ts`, which no longer lists episodes) | none | `episode.seasonNumber` (`:137`) | one, `en` (`:134`) | **none emitted**, although `EpisodeRecord.aired` is in the type (`:50`) | yes (`:136`) | none | both, paged up to 50 pages (`:141-152`), and only kept on the media row when one season (`:169-174`) |
| offline (seed) | `episode.number` (`offline/seed-source.ts`, the seed job, removed in HOR-577) | `absoluteEpisodeNumber` (`:180`) | `seasonNumber` (`:179`) | **multi-language**, each carrying its own `language` (`:176`) | **yes** (`:178`) | yes, with language (`:177`) | **yes** (`:181`) | inside the seeded media row (`:219`), only after the episodes asset has been read (`loadSeedEpisodes`, removed with it) |
| offline (bundled) | none | none | none | none | none | none | none | the bundled half supplies no episodes (`seasonMedia`, `offline/normalize.ts`) |
| watchmode | 1 (a film's synthetic episode only) | none | none | inherited from the media (`makeMovieEpisode`, `utils.ts`) | none | inherited from the media's covers (`makeMovieEpisode`, `utils.ts`) | none | a series gets `[]` (`watchmode/extractor.ts:249`) |
| disney, amazon, hulu, peacock, hbo, fubo, imdb | none | none | none | none | none | none | none | never |

### Episode facts worth pulling out

- **Four sources fetch an episode air date and then drop it**: tvmaze (`airdate`, `:54`), trakt
  (`first_aired`, `:49`), simkl (`date`, `:66`), tvdb (`aired`, `:50`). None of those four calls
  `releaseDate` in its `normalizeEpisode`. A plugin that wants episode-level dates from them needs the
  extractor changed first.
- **Only five sources emit `Episode.releaseDate` today**: anizip, crunchyroll, appletv, offline's
  seeded half, and nothing else. That is the whole population an episode-date alignment can draw on.
- **Only anizip emits episode titles in two languages** (`en` and `ja`, `:64-67`). Every other source
  emits one `en` title.
- **Only anizip, crunchyroll and the offline seed emit `absoluteEpisodeNumber`.**
- **Only anizip, justwatch and the offline seed emit `runtime`.**
- A movie is modelled as a one-episode series through `makeMovieEpisode`, which copies the media's
  titles, descriptions and covers and pins `episodeNumber: 1`, because the media episodes resolver
  drops every episode with a null `episodeNumber` (`src/sources/utils.ts`).
- `anizip`'s `episodeNumber` is deliberately the map KEY, not the upstream `episodeNumber`: anidb 18104
  (Mushoku Tensei season 2 part 2) has twelve episodes keyed 1 to 12 carrying `episodeNumber` 13 to 24,
  and every other source numbers that run 1 to 12 (`anizip/extractor.ts:78-96`, measured 2026-09-09).

---

## 4. Search, the gate, and `similarMedia`

`Subscription.mediaPage` with a `search` string is the search entry point.

| source | searchable by title | the gate a hit passes before it may be LINKED | implements `similarMedia` |
| --- | --- | --- | --- |
| jikan | yes, `/v4/anime?q=` (`jikan/extractor.ts:194-207`) | none: search results are listing rows, not links | no |
| anilist | yes, `BROWSE_QUERY` with `search` and `sort: SEARCH_MATCH` (`anilist/extractor.ts:712-727`), 1 page for a search (`:373-381`) | none | no |
| anizip | **no** `mediaPage` resolver at all (`anizip/extractor.ts:116-129`); it takes the merged default | n/a | no |
| crunchyroll | yes (`:581-589`) | **its own, strictest gate**: `CONFIDENT_TITLE_THRESHOLD = 0.9` on `bestTitleScore` over EVERY title the cluster knows with season markers stripped by sacha, capped at `MAX_SERIES_CANDIDATES = 3` over `MAX_SEARCH_QUERIES = 4` rungs (`:366-370,470-484`); then the SEASON is decided by `pickSimilarSeason` (`:487-522`); then a containment fallback that lends a longer season's episodes without claiming identity (`:378-440`) | **yes** (`:563-570`) |
| unogs | yes, but **films only** (`:240-243`): "`vtype` is OPTIONAL on the search payload where the detail payload requires it, so anything that is not exactly 'movie' is read as a series and refused" (`:236-239`) | `pickTitleMatch` at `TITLE_MATCH_THRESHOLD = 0.44` with a category veto (`:424-434`, `utils.ts`). The 0.44 was re-measured 2026-08-29 against the whole manami database, 243194 correct-match pairs against 139507 wrong-match pairs (`utils.ts`, above `TITLE_MATCH_THRESHOLD`) | **yes** (`:471-477`) |
| justwatch | yes (`:761-774`), but the search query does not fetch seasons so `normalizeMedia` declines every series result and only movies come through (`:768`) | the **shared** `catalogue-gate.ts`: `rankByTitle` at `CONFIDENT_TITLE_THRESHOLD = 0.9` (`catalogue-gate.ts:98,141-156`) plus `datedLikeThisMedia`, which is `yearAppearsInShow` read at SEASON level (`:611-615`, `catalogue-gate.ts:194-201`); then `pickSimilarSeason`; a refusal falls back to `showAsContainer` (`:694-719`) | **yes** (`:748-754`) |
| appletv | yes (`:417-424`) | the **shared** gate, plus the finer DATE axis: `pickGatedCandidate` = `rankByTitle` at 0.9 then `closestSeasonByAirDate` inside `SEASON_DATE_WINDOW = 45 days` (`catalogue-gate.ts:230,243-295`; `appletv/extractor.ts:363-382`). Measured 2026-08-30 against the real UTS endpoint: 0 of 150 anime TV titles and 0 of 120 anime films produced any candidate clearing 0.90, while a positive control ("Severance") is admitted at 1.0000 (`catalogue-gate.ts:54-63`) | **yes** (`:403-409`) |
| paramount | **no**, `mediaPage` always yields `{ nodes: [] }` (`:86`) | n/a | no |
| disney, amazon, hulu, peacock, hbo, fubo, imdb | **no**, always `{ nodes: [] }` | n/a | no |
| tmdb | yes, scraped from `/search/tv` (`:196-200,214-220`) | none on the search path. On the MEDIA path the season is picked by title ordinal first, then by `pickSeasonByEpisodeCount`, which requires an **exact and unique** count match (`:151-167`, `season.ts:175-182`) | no |
| tvmaze | yes, `/search/shows?q=` (`:189-192,214-220`) | none on the search path; the season is `pickSimilarSeason` on the media path (`:168-172`) | **yes** (`:196-203`) |
| kitsu | yes, `filter[text]`, limit 10 (`:219-224,313-314`) | none | no |
| omdb | yes, `s=` (`:114-119,130-136`) | none | no |
| trakt | yes, `/search/show?query=` (`:152-157,168-174`) | none | no |
| simkl | yes, three parallel searches (tv, anime, movie), limit 10 each, deduplicated by id (`:223-240,251-257`) | none | no |
| tvdb | yes, `/search?query=&type=series` (`:178-183,194-200`) | none | no |
| offline | **no, deliberately** (`offline/extractor.ts:224-230`): "a partial catalogue is worse than none in a ranked result set". Season listings only (`Subscription.mediaPage`) | n/a | no |
| watchmode | yes, `/search/?search_field=name` (`:240-248,259-265`) | none | no |

### The five `similarMedia` answerers and what each can read

`implementsSimilarMedia` is read off the definition's resolvers, never the merged schema
(`src/worker/extractor.ts:288-295`). The five are **crunchyroll, unogs, justwatch, appletv, tvmaze**.

The caller is `src/worker/similar-consumer.ts`, once per (run cluster, container) pair, on a run's
page only, capped at `MAX_ASKS_PER_PAIR = 4` (`:40`). The evidence it sends is assembled from the
WHOLE cluster (`:167-176`): every title minus pure season labels, `bestRunStartDate` (the first date
naming a DAY, else the first non-empty one, `similar.ts:118-119`), `runLength(cluster)`, and up to 200
deduplicated episode titles pulled from every aggregated episode of the cluster (`:284-285`).

`pickSimilarSeason` (`src/sources/similar.ts:173-269`) runs five rules in order, and what each source
can offer as a `SeasonCandidate` decides which rules can ever fire for it:

| answerer | `seasonNumber` | `episodeCount` | `premiere` (a day) | `year` | `episodeTitles` | reachable rules |
| --- | --- | --- | --- | --- | --- | --- |
| crunchyroll | `data[0].season_number` (`crunchyroll/extractor.ts:300`) | distinct numbered episodes (`:301`) | **yes**, `data[0].episode_air_date` (`:302`) | derived from the premiere (`similar.ts:131-132`) | **yes** (`:303`) | all five |
| unogs | `season.season` (`unogs/extractor.ts:316`) | `season.episodes.length` (`:317`) | **never** | **first season only**, the title's year (`:319`) | **yes** (`:318`) | 2 (episode titles), 3 (ordinal), 4 (year, first season only), 5 (first) |
| justwatch | `content.seasonNumber` (`justwatch/extractor.ts:313`) | `totalEpisodeCount \|\| undefined` (`:314`) | **never** | `content.originalReleaseYear` per season (`:315`) | **yes**, up to 50 per season (`:316`) | 2, 3, 4, 5 |
| appletv | `season.seasonNumber` (`appletv/extractor.ts:212`) | **never** (deliberately, `:202-208`) | **yes**, `season.releaseDate` (`:212`) | derived from the premiere | **never** (deliberately) | 1 only. "a caller with a year-only date, or with titles and a count alone, is refused here however good its evidence would be elsewhere: only a day places a run" (`:265-266`) |
| tvmaze | the season number (`tvmaze/extractor.ts:141-142`) | a count per season (`:143`) | **yes**, earliest airdate of that season's episodes (`:144`) | derived | **yes** (`:145`) | all five |

The five rules (`similar.ts:181-266`), in order:

1. **DATE**: a premiere within `SEASON_DATE_WINDOW` (45 days) of a **day-precise** start
   (`namesADay`). Zero or two matches inside the window is a refusal, never a guess (`:184-192`).
2. **EPISODE TITLES**: needs `MIN_EPISODE_TITLE_MATCHES = 3` real titles on both sides and
   `EPISODE_TITLE_COVERAGE = 0.6` coverage **against the candidate**, so a fold of two equal cours
   scores 12/24 = 0.50 and is refused while a season with a four-episode bonus block scores 12/16 =
   0.75 and is admitted (`:59-69,194-211`).
3. **ORDINAL WITH COUNT**: one ordinal all titles agree on, no part marker, and a count
   (`:213-226`).
4. **YEAR**: the one season dated our year holding no more episodes than our run (`:239-246`).
5. **FIRST**: only ever the lowest-numbered season (`:248-266`).

Two vetoes apply throughout: **fold** (a candidate holding more episodes than the run, zero tolerance,
`:147-150`) on every rule, and **year** on every rule but the date (`:154-158,171`).

The answer is then checked by the consumer against `SHOW_TITLE_THRESHOLD = 0.9` on titles
(`similar.ts:303-320`) and refused if it is not a RUN of the asked origin (`isRunAnswerFrom`,
`:125-129`).

---

## 5. The pairs the edge cases turn on

The driving case: MyAnimeList and AniList list Mushoku Tensei as S1, S1 Cour 2, S2, S2 Part 2, S3
while Netflix and Crunchyroll list S1, S2, S3, so one streaming season includes two catalogue runs.
What follows is, for each pair, **which evidence exists on both sides**, because that is what bounds
what any plugin can ever do.

### mal (jikan) against anilist

**No matching is needed and none is done.** The link is a first-party id, minted four ways:

- anilist mints `mal:<idMal>` SAME_AS, unconditionally (`anilist/extractor.ts:581-590`).
- anizip mints `mal` and `anilist` together off the anidb mapping (`anizip/extractor.ts:21-32`).
- offline's index and season rows mint both (`offline/normalize.ts:113-119`,
  `offline/extractor.ts:163-166`).
- simkl's anime records mint both (`simkl/extractor.ts:124-125`).

Both sides carry a day-precise start date, en/jp-en/jp titles, an episode count, `season`+`seasonYear`,
a status and genres, so every axis is dense on both sides and redundant. Neither supplies a single
episode. This pair is a **union by id**, and any plugin reasoning about it is reasoning about
disagreement in field values (which wins), not about identity.

### mal/anilist against cr (Crunchyroll)

| axis | mal/anilist side | cr side | usable |
| --- | --- | --- | --- |
| a day-precise start date | **yes**, `aired.from` / `airedDate` (`jikan:186`, `anilist:592`) | **yes**, per-season, `data[0].episode_air_date` (`crunchyroll:302`) | **yes**, and this is Rule 1 |
| a show-level date | n/a | only `` `${series_launch_year}-01-01` `` on the SHOW row (`crunchyroll:188-191`), refused by `namesADay` | no |
| titles in a shared language | en, jp-en, jp | **en only**, and often the SERIES title because a bare "Season 3" is replaced (`crunchyroll:244-248`) | partly: the franchise, not the season |
| episode count | yes | yes, distinct numbered episodes per season (`crunchyroll:301`) | **yes** (the fold veto) |
| episode titles | **only through anizip** (`anizip:64-67`) | **yes**, en (`crunchyroll:303`) | **yes** (Rule 2), but only once anizip has answered |
| episode dates | **only through anizip** (`anizip:99`) | **yes** (`crunchyroll:208`) | **yes** |
| a direct id | **yes**: AniList's `externalLinks` siteId 5 carries `crunchyroll.com/series/<id>` (`anilist:236`) | the series id is the show, every season under it | the SHOW is settled by AniList first-party; only the SEASON is open |

This is the **richest pair**: the show comes free off AniList's own mapping, and the season is decided
by a day-precise premiere on both sides. It is the only pair where Rule 1 (date) is reachable.

The fold is still not closed by any of that: a catalogue that folds two cours into one season
premieres on the **same day** as the first of them, so neither the date axis nor the title axis can see
the fold (`similar.ts:143-146`). What sees it is the count veto, and it only sees it in one direction.
Crunchyroll's answer to the other direction is `lendContainingSeason`
(`crunchyroll/extractor.ts:378-440`): when no season IS the run, the season that CONTAINS it lends its
episodes, re-pointed at the asking run, **carrying no handles**, with Crunchyroll's own numbering kept
and realigned at read time by `store/consensus.ts`.

### mal/anilist against nf (unogs, Netflix)

| axis | mal/anilist side | nf side | usable |
| --- | --- | --- | --- |
| any date at all | day-precise | **NONE.** No air date at any level; a season-scoped row's `startDate` is deleted (`unogs:271-287`); `UnogsEpisode` has no date field (`unogs:98-104`) | **no** |
| the title's year | n/a | only the whole title's year, which is the FIRST season's, and it is offered as a candidate `year` **on the first season only** (`unogs:313-320`) | only as a veto on season 1 |
| titles in a shared language | en | en (`unogs:159`) | franchise only |
| episode count | yes | `season.episodes.length` (`unogs:317`) | **yes** |
| episode titles | **only through anizip** (en, `anizip:65`) | **yes**, en, Netflix's own translation (`unogs:318`) | **yes**, and this is the only decisive axis |

**This is why Netflix is matched by episode titles.** Rule 1 cannot fire: there is no premiere on the
Netflix side, ever. Rule 4 (year) can fire only against season 1. Rules 3 and 5 are ordinal and
first-season guesses that the measurements refused: over 33 multi-season Netflix series and 105 anime
runs, "nearest at any distance, first on tie" produced 51 welds of 105 assignments, and "exact and
unique" cut that to 11 of 49 (`season.ts:154-168`). So Rule 2 carries the pair, and it depends
entirely on anizip having answered first, because **neither MAL nor AniList supplies a single episode
title** (`jikan:171`, `anilist:595-663`). The two translations must also agree after `stripTitle`
(`similar.ts:196-205`), and "the recall cost of title drift between translations is unmeasured"
(`similar.ts:65-66`).

### mal/anilist against jw (JustWatch)

| axis | mal/anilist side | jw side | usable |
| --- | --- | --- | --- |
| a day-precise date | yes | **no.** A year and nothing finer, at two levels (`justwatch:276-286,611-615`) | no, Rule 1 cannot fire |
| a year at season level | yes (`seasonYear`) | **yes**, `season.content.originalReleaseYear` (`justwatch:315`), which `NODE_QUERY` has always asked for | **yes**, Rule 4 and the year veto |
| titles in a shared language | en | en, on the container and on the handle node; **not on the season row** (`justwatch:520-536`) | for the gate only (`rankByTitle` reads the search payload's `content.title`) |
| episode count | yes | `totalEpisodeCount`, with 0 offered as **no count** (`justwatch:313-314`) | yes |
| episode titles | via anizip | **yes**, up to 50 per released season (`justwatch:195,316`) | **yes**, Rule 2 |
| a direct id | no | no | the pair is reached by the search gate, or by the container space |

Reading the year at SHOW level instead of season level is the single most damaging way to build this,
and it is also the obvious one: a show-level year refuses 83% of the season-to-parent links the gate
exists to recover (`justwatch:601-609`). Season-level year membership admits 93.221% of the
related-same-show pairs against 16.543% for a show-level same-year test
(`catalogue-gate.ts:165-201`).

JustWatch folds exactly as Netflix does: 23, 24 and 14 against cours of 11/12/12/12/14
(`justwatch:408-414`). When the picker refuses, the show comes back as a CONTAINER carrying the
offers, deliberately **not** `mergeHandles`d (`justwatch:406-461`).

### mal/anilist against kitsu

**A union by id, like mal/anilist.** kitsu mints `anilist` and `mal` SAME_AS off its JSON:API
`mappings` include (`kitsu:65-74`), and simkl and offline mint `kitsu` back (`simkl:126`,
`offline/normalize.ts:117`). No title or date matching is involved.

Shared evidence if a plugin wants to cross-check: a start date on both sides (kitsu's may be
`YYYY-MM-01`, `season.ts:203-207`), an end date on both, an episode count on both, `en` and `ja`
titles on kitsu against `en`/`jp-en`/`jp` on the other two (note the language-code split: kitsu and
anizip write `ja`, jikan and anilist write `jp`), a status on both, and **no genres from kitsu**
(`kitsu:127-129`). kitsu supplies episodes with numbers and en titles but **no episode dates**
(`kitsu:174-187`), so it cannot contribute to an episode-date alignment.

### mal/anilist against tmdb

| axis | mal/anilist side | tmdb side | usable |
| --- | --- | --- | --- |
| a date on a season row | day-precise | **NONE.** `startDate` is set only when `seasonNumber == null` (`tmdb:122`), and the comment says why: "unlike tvmaze there is no season air date to substitute: this scrapes HTML and only ever sees the one year" (`tmdb:115-121`) | **no** |
| a show-level year | n/a | `` `${year}-01-01` `` on the container row (`tmdb:122`) | no, coerced |
| titles | en, jp-en, jp | one en, from `og:title` (`tmdb:110`) | franchise only |
| episode count | yes | per season, from the parsed episode list (`tmdb:138-142`) | **yes**, and this is the axis tmdb actually uses |
| episode titles | via anizip | yes, en (`tmdb:131`) | **not used**: tmdb does not implement `similarMedia` and does not call `pickSimilarSeason` |
| episode dates | via anizip | **none** (`tmdb:125-136`) | no |
| a direct id | no | trakt mints `tmdb` CONTAINER SAME_AS (`trakt:83`); tvdb mints `tmdb` CONTAINER SAME_AS (`tvdb:25,41`); simkl and watchmode **refuse** to mint tmdb (`simkl:94-119`, `watchmode:139-163`) | container only |

tmdb is the one season-scoping source that runs on a **different picker**: `resolveSeasonNumber` tries
`parseSeasonNumber` on the first title and then `pickSeasonByEpisodeCount`, which requires an exact
and unique count match and returns nothing when there is only one season (`tmdb:151-167`,
`season.ts:175-182`). A multi-season show whose season cannot be determined yields **no media at all**
(`tmdb:188`).

### mal/anilist against imdb

There is **no imdb side**. The source answers null always (`imdb:33`) and every imdb uri is forced to
CONTAINER by `SHOW_LEVEL_ORIGINS` (`src/worker/store/db.ts:42,92`). What exists is the id itself,
minted by six sources: omdb (`:53`, SAME_AS, scope follows the row), simkl (`:123`, SAME_AS, scope
follows the type), trakt (`:82`, SAME_AS, CONTAINER), tvmaze (`:63`, SAME_AS, CONTAINER), tvdb
(`:25,41`, SAME_AS, CONTAINER) and watchmode (`:155`, **PART_OF**). The claim in
`imdb/extractor.ts:5-6` that jikan mints one is wrong: jikan mints `anidb` and `anizip` only
(`jikan:146-149`).

So an `imdb:tt...` is a **containment pointer and a render target**, never an alignment axis. Note
that unOGS restates IMDb's rating as its own `averageScore` (`unogs:163`), which is the only IMDb
datum that reaches a media field.

### mal/anilist against anizip

**The keystone pair, and it is a union by id.** anizip is keyed on the AniDB id and mints `mal` and
`anilist` SAME_AS (`anizip:21-32`); jikan mints `anidb` and `anizip` SAME_AS off MyAnimeList's own
external link (`jikan:48-58,146-149`). anizip is addressable by `anidb` and `mal`
(`anizip:13`) but reads **only** the mal id out of the aggregated uri (`anizip:120-127`), so a cluster
with an anidb id and no mal id gets nothing.

What anizip adds that nothing else in the metadata band has:

- **episode titles in `en` and `ja`** (`anizip:64-67`): the evidence Rule 2 needs against Netflix and
  JustWatch.
- **episode release dates** (`anizip:99`), in two shapes that must survive to the UI: `airDateUtc` is
  an instant with seconds precision and `airdate` names a day (`anizip:145-157`).
- **`absoluteEpisodeNumber`** and **`runtime`** (`anizip:97-98`).
- `episodeNumber` re-keyed to the position within THIS entry, so a split cour numbers 1..12 like every
  other source rather than 13..24 (`anizip:78-96`).

It supplies **no date, no status, no season and no genres at media level**, so it can never anchor a
media-level date comparison. It is an episode-level source with a media row attached.

### mal/anilist against offline

**A union by id.** The bundled index exists for exactly this: a record knowing only a MAL id and one
knowing only an AniList id land in the same union-find component through the index row rather than by
comparing titles (`offline/extractor.ts:142-157`), and a row carrying fewer than two handles is not
returned at all (`:170`). It supplies **no dates and no status**, deliberately, because manami's
status is a cut-date snapshot that decays within weeks (`offline/normalize.ts:129-133`), so it cannot
contribute to any date axis. It does supply `season` and `seasonYear`, but only from the bucket key
(`offline/normalize.ts:141-144`).

### The asymmetry a plugin must carry

Reading the five tables above together:

- **Dates exist on both sides only for cr, appletv and tvmaze.** nf has none at all, jw has years,
  tmdb has none at season level.
- **Episode titles exist on both sides only once anizip has answered**, and on the catalogue side only
  for cr, nf, jw and tvmaze. appletv deliberately offers none.
- **Counts exist on both sides for every pair**, and are the only universally present axis, which is
  precisely why the fold defeats them: a folded season's count is larger than any single cour's, and
  `foldVetoed` can only refuse, never align (`similar.ts:143-150`).
- **appletv is the inverse of nf**: a day on the catalogue side and nothing else, so only Rule 1 can
  fire for it, while for nf Rule 1 can never fire.

---

## Appendix: cross-cutting mechanics a plugin will meet

- **Field precedence is a single `score` per source**, sorted descending, top source takes the field
  outright, with `??` fallthrough (`registry.md` "The 24: identity"; the constants are module-private).
  jikan 0.9, anizip 0.9 per field but **no score on the row** (`anizip:15,34`), anilist 0.8,
  crunchyroll 0.5, tmdb/tvmaze/kitsu/omdb/trakt/simkl/tvdb 0.3, watchmode 0.25,
  unogs/justwatch/appletv/paramount/offline 0.2.
- **Five sources need a user-supplied key**: omdb, trakt, simkl, tvdb, watchmode
  (`src/sources/key-configs.ts`, removed with the API keys). Each returns `undefined` from its `api` helper when the key is
  absent, so those five contribute nothing by default.
- **Title comparison is `frizbee` with `maxTypos: Infinity`**, which turns it from a filter into a
  scorer, taking the weaker direction of a symmetric 0..1 similarity (`titleSimilarity`, `utils.ts`). Season
  markers come off through sacha's `franchiseTitle` (`utils.ts`). `stripTitle` keeps letters
  of every script, because stripping to `[a-z0-9]` reduced a Japanese title to its ASCII digits
  (`utils.ts`).
- **`namesADay` is the coerced-date guard** (`season.ts:197-228`): seven extractors build a date out of
  a bare year and template it as January 1 (justwatch, omdb, tmdb, tvdb, unogs twice, crunchyroll's
  show-level media), and kitsu and jikan answer `YYYY-MM-01` for a month-only date.
- **`graph.link` is a union-find union with no inverse** (`src/worker/store/db.ts:12`), which is why
  every gate in this tree prefers a missing row to a wrong one.
