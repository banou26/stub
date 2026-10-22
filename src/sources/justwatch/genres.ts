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
