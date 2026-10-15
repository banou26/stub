// How stub's `cr:` ids name a Crunchyroll season, and how that season is found again in Crunchyroll's
// list. Import free, so the tracker's page script (./session-page.ts) finds a season as the source does.

/** A season as Crunchyroll lists it, as far as its ids go. */
export type SeasonIds = { id: string, versions?: { audio_locale: string, guid: string, original: boolean }[] }

const stripLocale = (id: string) => id.replace(/JAJP$/, '')

/** The id Crunchyroll's API answers the season's episodes on: its Japanese version's, else its original's. */
export const resolveSeasonId = (season: SeasonIds): string =>
  season.versions?.find(v => v.audio_locale === 'ja-JP')?.guid
  ?? season.versions?.find(v => v.original)?.guid
  ?? stripLocale(season.id)

/**
 * Stub's id for a series, a season of it or an episode of that season. The season drops a trailing
 * `JAJP`, so it is not always an id the API answers on: `findSeason` gets the season back.
 */
export const crunchyrollId = (seriesId: string, seasonId?: string, episodeId?: string) =>
  [seriesId, seasonId && stripLocale(seasonId), episodeId].filter(Boolean).join('-')

/** The season of a series' list that `seasonId`, as a `cr:` id carries it, names. */
export const findSeason = <Season extends SeasonIds>(seasons: Season[], seasonId: string) =>
  seasons.find(s => stripLocale(s.id) === seasonId || resolveSeasonId(s) === seasonId)
