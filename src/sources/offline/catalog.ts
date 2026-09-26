import { readIndex, type CatalogIndex, type IndexBundle } from './index-lookup'

let index: Promise<CatalogIndex> | undefined

/**
 * The bundled cross-catalogue id table, loaded once through a dynamic import and shared by the offline
 * source and the stub tracker.
 *
 * The import has to sit somewhere genuinely reachable: a loader nothing calls gets its chunk
 * tree-shaken away by rolldown, silently, leaving a caller that always reads an empty table. Both
 * callers reach this from a resolver path.
 *
 * A failure resolves to an empty table rather than rejecting, so a caller that cannot widen an id
 * carries on with the ids it has.
 */
export const loadCatalog = (): Promise<CatalogIndex> =>
  (index ??= import('../../generated/anime-index')
    .then(module => readIndex(module.default as IndexBundle))
    .catch(error => {
      console.error('offline: the bundled id index could not be loaded', error)
      return readIndex({ mal: [], anilist: [], kitsu: [], anidb: [] })
    }))
