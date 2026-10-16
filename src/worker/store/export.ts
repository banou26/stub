import type { Episode, Media } from './types'

import { ASSERTED_LABELS, graph, HAS_EPISODE_LABEL } from './db'

export type ExportedCluster = { members: Media[], partOf: Media[], episodes: Episode[] }
export type StoreExport = { exportedAt: string, excludedOrigins: string[], clusters: ExportedCluster[] }
export type ExportOptions = { excludeOrigins: string[] }

const originOf = (uri: string) => uri.slice(0, uri.indexOf(':'))
const byUri = (a: { uri: string }, b: { uri: string }) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0

/**
 * Every run-space cluster the store holds, built from ASSERTED sameness only.
 *
 * Promises: it reads, and never writes. It walks only pairs a source claimed through a handle
 * (`ASSERTED_LABELS` in ./db.ts), never a union the fuzzy pass made. It refuses to walk THROUGH an
 * excluded origin, so a bridge only an excluded source supplied splits rather than surviving. It
 * emits nothing whose members are all CONTAINER: a show with no run is not a run. Output is sorted
 * throughout, so two calls against one store are byte-identical.
 *
 * Refuses nothing else: a component of one is a cluster, and a caller that excludes no origin gets
 * the plugin rows too. Excluding them is `osraResolvers.exportStore`'s job, not this one's.
 */
export const exportStore = async ({ excludeOrigins }: ExportOptions): Promise<StoreExport> => {
  const excluded = new Set(excludeOrigins)
  const medias = graph.labeled('media')
  const episodeRows = graph.labeled('episode')
  const usableMedia = (uri: string) => medias.has(uri) && !excluded.has(originOf(uri))

  const seen = new Set<string>()
  const clusters: ExportedCluster[] = []

  for (const seed of [...medias].sort()) {
    if (seen.has(seed) || !usableMedia(seed)) continue
    seen.add(seed)

    const members: Media[] = []
    const queue = [seed]
    while (queue.length) {
      const uri = queue.shift()!
      const row = graph.get(uri) as Media | undefined
      if (row) members.push(row)
      for (const next of graph.neighbours(uri, ASSERTED_LABELS.RUN)) {
        if (seen.has(next) || !usableMedia(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    if (!members.some(member => member.scope !== 'CONTAINER')) continue

    const partOf: Media[] = []
    const partSeen = new Set<string>()
    for (const member of members) {
      for (const target of graph.targets(member.uri, ASSERTED_LABELS.PART_OF)) {
        const containerQueue = [target]
        while (containerQueue.length) {
          const uri = containerQueue.shift()!
          if (partSeen.has(uri) || !usableMedia(uri)) continue
          partSeen.add(uri)
          const row = graph.get(uri) as Media | undefined
          if (row) partOf.push(row)
          for (const next of graph.neighbours(uri, ASSERTED_LABELS.CONTAINER)) containerQueue.push(next)
        }
      }
    }

    const episodes: Episode[] = []
    const episodeSeen = new Set<string>()
    for (const member of members) {
      for (const episodeUri of graph.targets(member.uri, HAS_EPISODE_LABEL)) {
        if (episodeSeen.has(episodeUri) || !episodeRows.has(episodeUri) || excluded.has(originOf(episodeUri))) continue
        episodeSeen.add(episodeUri)
        const row = graph.get(episodeUri) as Episode | undefined
        if (row) episodes.push(row)
      }
    }

    clusters.push({
      members: members.sort(byUri),
      partOf: partOf.sort(byUri),
      episodes: episodes.sort(byUri),
    })
  }

  return {
    exportedAt: new Date().toISOString(),
    excludedOrigins: [...excluded].sort(),
    clusters: clusters.sort((a, b) => byUri(a.members[0]!, b.members[0]!)),
  }
}
