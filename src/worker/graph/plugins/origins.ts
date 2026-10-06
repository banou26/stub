/**
 * The per-origin tables `plugin:profile` reads when a source declares nothing (5.4 P0).
 *
 * ONE FILE for all of them, because each is a CONSTANT STANDING IN FOR A PER-CLAIM PROPERTY: the
 * declared fields of 4.6 (`startDatePrecision`, `episodeCountKind`, `episodeNumberSpace`, and
 * `PluginSourceMeta`'s `countKind`, `folding`, `retranslates`, `showLevel`) are what eventually
 * replace them, one source at a time, and a table that is scattered cannot be retired. The failure
 * mode of a wrong entry is stated in 5.4 P0: it is one line here, and a full pass recomputes every
 * dependent plugin.
 *
 * READ ORDER, and it matters: a field the row itself declares wins, then the table below, then the
 * default. An origin in neither table, which is every remote plugin source today, counts a list
 * (`listLength`): the nyaa plugin counted 120 releases as the episodes of a twelve episode run
 * (2026-09-09), which is what a declared `countKind` exists to stop.
 *
 * Every token here is the origin as the extractor stamps it, not the directory it lives in:
 * crunchyroll is `cr`, justwatch is `jw`, unogs is `nf`, jikan is `mal`.
 */

/**
 * Origins whose every id names a CONTAINER, so the effective scope is CONTAINER before any answer.
 *
 * `imdb` (`db.ts:42`), `trakt` (`trakt/extractor.ts:95`), `tvdb` (`tvdb/extractor.ts:76`) and
 * `paramount` (`paramount/extractor.ts:54`). NOT omdb and NOT watchmode, which both mint a RUN for a
 * film (`omdb/extractor.ts:79`, `watchmode/extractor.ts:170-173`), so adding either here would stamp
 * every film they answer as a container.
 */
export const SHOW_LEVEL_ORIGINS = new Set(['imdb', 'trakt', 'tvdb', 'paramount'])

/**
 * Origins that fold cours into seasons, so one of their season rows can hold two of our runs.
 *
 * `crunchyroll/extractor.ts:379-384`, `unogs/extractor.ts:337-340`, `justwatch/extractor.ts:408-414`.
 * Read by the count guards of 5.2 (7 and 8), which land in step 2b.
 */
export const FOLDING_ORIGINS = new Set(['cr', 'nf', 'jw'])

/**
 * Origins that commission their own episode titles rather than republishing the broadcaster's.
 *
 * Netflix only, and measured: 4 exact matches of 25, with the best WRONG pair at 0.5463 sitting above
 * its true pair at 0.4537 (2026-09-10). JustWatch republishing provider titles is unmeasured and is
 * deliberately not flagged here, because a guess in this table is a guess in every rule that reads it.
 */
export const RETRANSLATING_ORIGINS = new Set(['nf'])

/**
 * Origins whose `episodeCount` is a figure the source PUBLISHES rather than the length of a list it
 * fetched.
 *
 * mal `data.episodes`, anilist `episodes`, anizip `episodeCount`, offline `record.ep`, omdb (a single
 * season or a film), justwatch `totalEpisodeCount`. A Crunchyroll SEARCH row's
 * `series_metadata.episode_count` is also a published figure while Crunchyroll's own list is a length,
 * and that distinction is per answer rather than per origin: `cr` sits in the list-length table below
 * and a declared `episodeCountKind` is what separates the two (4.6).
 */
export const DECLARED_COUNT_ORIGINS = new Set(['mal', 'anilist', 'anizip', 'offline', 'omdb', 'jw'])

/**
 * Origins whose `episodeCount` is the length of the list they fetched.
 *
 * crunchyroll (`fuzzy-merge.ts:274`), unogs (`:296`), appletv, tmdb, tvmaze, kitsu (overwritten by its
 * own list at `kitsu/extractor.ts:216`), simkl, trakt, tvdb, paramount. An empty list is `none` and
 * never 0, which is the rule that kept `foldVetoed` from refusing every candidate season (2026-09-09).
 */
export const LIST_LENGTH_ORIGINS = new Set([
  'cr', 'nf', 'appletv', 'tmdb', 'tvmaze', 'kitsu', 'simkl', 'trakt', 'tvdb', 'paramount',
])

/**
 * The numbering space an origin's episode numbers live in (5.4 P0, `EpisodeProfile.numberSpace`).
 *
 * `entry` is anizip's map key (`anizip/extractor.ts:78-96`) and `position` is unogs's list index
 * (`unogs/extractor.ts:294,500`). Every other origin numbers within a season, which is the default a
 * caller applies when this table is silent, and a declared `episodeNumberSpace` overrides both.
 */
export const NUMBER_SPACE_ORIGINS: Record<string, 'entry' | 'position'> = { anizip: 'entry', nf: 'position' }

/**
 * Origins KNOWN to build a start date out of a bare year or a bare month, kept as the record of who
 * coerces rather than as a gate.
 *
 * The date rule of 5.4 P0 is deliberately origin-independent: a parsed `startDate` whose UTC
 * day-of-month is 1 reads as `month-or-year` for EVERY origin until that origin declares
 * `startDatePrecision`, because AniList emits `toUTCString()` for every branch including its year-only
 * coercion (`aired-date.ts:33,44,50`) and jikan an offset-bearing ISO string, so a shape test admits
 * both coerced dates to the 45 day veto. Seven extractors template a year followed by `-01-01`
 * (`justwatch:387`, `omdb:55`, `tmdb:120`, `tvdb:99`, `unogs:166` and `:181`, `crunchyroll:152`) and
 * two answer `YYYY-MM-01` when only the month is known (`kitsu:135`, `jikan:126`).
 *
 * So nothing reads this table to DECIDE anything. It is the list the profile's own test walks, so the
 * rule is proven to fire for each of them rather than for the one origin a fixture happened to use.
 */
export const COERCING_ORIGINS = new Set(['jw', 'omdb', 'tmdb', 'tvdb', 'nf', 'cr', 'kitsu', 'mal'])

/**
 * What each first-party origin's OWN payload can name, as the origins of the ids it builds handles
 * from. The ingest's provenance fallback reads it (`../ingest.ts`, `provenanceOf`).
 *
 * WHY IT EXISTS. `buildHandlesFromUri` stamps `provenance: 'address'` from 2026-09-12, but every
 * recording made before that carries no stamp, and so does any remote plugin source that never
 * learns to send one. A claimer whose own data cannot carry the target's id space is echoing the
 * address back: Netflix publishes no AniList id anywhere, so `nf` naming `anilist:X` came from the
 * uri it was asked about and nowhere else. That is the fallback, and this table is its premise.
 *
 * WHAT COUNTS AS NATIVE: a handle built from a field of the source's own response, or from a url that
 * response carried. A handle from `buildHandlesFromUri` or added by `mergeHandles` never counts, which
 * is the whole distinction being drawn.
 *
 * AN ORIGIN ABSENT FROM THIS TABLE IS TRUSTED, and that is the safe direction: the fallback can only
 * narrow origins whose extractor was read line by line, so a remote plugin source, a new first-party
 * source, or anything else unread keeps `source` and is decided by the guards as before. Adding a
 * wrong entry costs a real claim, so an origin goes in only with the line that builds the handle.
 *
 * DELIBERATELY ABSENT, each for its own reason rather than by omission:
 * - `offline`: the seed's identity handles are an export of a real cluster and can name ANY origin
 *   (`sources/offline/seed.ts:108`), so it has no bounded id space to test against. Its SAME_AS is
 *   `seed` before the fallback is reached anyway, and `offline/extractor.ts:163-166` is the narrower
 *   of its two paths, not the whole of it.
 * - `imdb`, `anidb`, `amazon`, `disney`, `hbo`, `hulu`, `peacock`, `fubo`, `paramount`: read, and each
 *   builds no handle at all, so no claim of theirs ever reaches the lookup.
 *
 * Every entry was read off the extractor on 2026-09-12; the citation is the line that mints the handle.
 */
export const NATIVE_ID_SPACES: Record<string, Set<string>> = {
  // jikan: the AniDB id off `external`, and anizip keyed on that same anidb id (`jikan:87,98`)
  mal: new Set(['anidb', 'anizip']),
  // `idMal` (`anilist:586`), and the Crunchyroll series its own externalLinks name (`anilist:227-251`)
  anilist: new Set(['mal', 'cr']),
  // `mappings.mal_id` and `mappings.anilist_id` (`anizip:23,28`)
  anizip: new Set(['mal', 'anilist']),
  // the `mappings` relationship (`kitsu:70,71`) and the streaming links of `kitsu/stream-id.ts:22-29`
  kitsu: new Set(['anilist', 'mal', 'cr', 'nf', 'hulu', 'disney', 'amazon', 'hbo']),
  // `ids.imdb`, `ids.mal`, `ids.anilist`, `ids.kitsu` (`simkl:123-126`)
  simkl: new Set(['imdb', 'mal', 'anilist', 'kitsu']),
  // `ids.imdb` only; tmdb is refused at the source because it cannot scope one (`trakt:110-121`)
  trakt: new Set(['imdb']),
  // `remoteIds`, mapped by `HANDLE_ORIGINS` (`tvdb:25,41`)
  tvdb: new Set(['imdb', 'tmdb']),
  // `externals.imdb` (`tvmaze:74`)
  tvmaze: new Set(['imdb']),
  // the row IS an imdb id, minted beside itself (`omdb:53`)
  omdb: new Set(['imdb']),
  // `imdb_id` and `tmdb_id` (`watchmode:155,162`) plus the stream hosts of `watchmode:66-71`
  watchmode: new Set(['imdb', 'tmdb', 'cr', 'nf', 'hulu', 'disney', 'amazon', 'hbo']),
  // the offer deep links through `PACKAGE_ORIGIN_MAP` (`justwatch/id.ts:75-79`, minted at
  // `justwatch:400`), plus its own show container (`justwatch:510`). It FETCHES `externalIds.imdbId`
  // (`justwatch:86,148`) and builds no handle from it, so imdb is not native here
  jw: new Set(['cr', 'nf', 'disney', 'amazon', 'appletv', 'hulu', 'hbo', 'peacock', 'paramount', 'fubo', 'jw']),
  // the four that build no handle from their own payload. Empty rather than absent because each one
  // DOES emit handles, every one of them rebuilt from the asked uri: `cr:527`, `unogs:518,536`,
  // `appletv:380,393`. tmdb mints none by either route and is here as the read control
  cr: new Set(),
  nf: new Set(),
  appletv: new Set(),
  tmdb: new Set(),
}

/**
 * The origins whose extractor REBUILDS handles out of the asked aggregated uri, so an unstamped claim
 * of theirs can be an echo of the address at all.
 *
 * The gate on the ingest's provenance fallback, and it is what makes that inference valid rather than
 * merely usual. "This claimer cannot carry that id space, so it came from the address" only follows
 * for a claimer that reads the address; for anything else the honest conclusion is a mapping path
 * nobody read, and the claim keeps `source`. The table above stays complete so this set can grow the
 * day another extractor starts rebuilding.
 *
 * The four, each at the line that rebuilds: `appletv/extractor.ts:380,393` and
 * `unogs/extractor.ts:518,536` and `crunchyroll/extractor.ts:527` replace the handle list wholesale,
 * `justwatch/extractor.ts:711,738` appends through `mergeHandles`.
 *
 * IT COSTS NOTHING ON REAL DATA, measured over all 8556 rows of the recorded season (2026-09-12):
 * every claim a non-echoing origin makes is already inside its own set, and the echoing four are
 * exactly where the outsiders are.
 *
 *     anilist -> mal 255, cr 37          kitsu -> anilist 214, mal 202, cr 44, nf 4, hulu 2
 *     anizip  -> mal 79, anilist 78      offline -> mal 158, anilist 133, kitsu 107, anidb 1
 *     jw      -> nf 74, disney 46, cr 20, hulu 10, amazon 7, paramount 1, hbo 1, fubo 1, jw 123
 *     jw      -> offline 143, kitsu 130, mal 128, anilist 125, anizip 66   ECHOES
 *     nf      -> mal 144, offline 132, kitsu 131, anilist 118, anizip 57, jw 34, cr 22, paramount 1
 *     cr      -> offline 55, mal 53, anilist 52, kitsu 52, anizip 21, jw 11, nf 9
 *
 * jikan (`mal`) emits no handle at all in that recording, and neither does tmdb, tvmaze, trakt,
 * simkl, tvdb, omdb or watchmode: they answered nothing that carried one.
 */
export const ADDRESS_ECHOING_ORIGINS = new Set(['cr', 'nf', 'appletv', 'jw'])
