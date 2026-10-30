/**
 * JustWatch's genres by the English name its answers carry, to the short name its filter takes (its `genres` query,
 * read 2026-10-23). Made in Europe (`eur`) is left out, as a region rather than a genre. No imports, so the search
 * page can offer the names without reaching the extractor.
 */
export const JUSTWATCH_GENRES: Record<string, string> = {
  'Action & Adventure': 'act',
  Animation: 'ani',
  Comedy: 'cmy',
  Crime: 'crm',
  Documentary: 'doc',
  Drama: 'drm',
  Fantasy: 'fnt',
  History: 'hst',
  Horror: 'hrr',
  'Kids & Family': 'fml',
  'Music & Musical': 'msc',
  'Mystery & Thriller': 'trl',
  'Reality TV': 'rly',
  Romance: 'rma',
  'Science-Fiction': 'scf',
  Sport: 'spt',
  'War & Military': 'war',
  Western: 'wsn',
}

// JustWatch's names for two of AniList's genres
const ANILIST_NAMES = new Map([['sport', 'sports'], ['science-fiction', 'sci-fi']])

/**
 * A genre's name as one key whichever source wrote it: lowercased, with JustWatch's Sport and Science-Fiction read as
 * AniList's Sports and Sci-Fi. Two names with the same key are one genre to the picker, the store's filter and JustWatch's.
 */
export const genreKey = (name: string): string => {
  const key = name.toLowerCase()
  return ANILIST_NAMES.get(key) ?? key
}
