import { shardName, type HistorySet, type HistoryShard } from './history'

// one chunk per shard, so a page opening a title loads three small files rather than all of history
const shards = import.meta.glob<HistoryShard>('../../generated/history/*.ts', { import: 'default' })
const loaded: Record<string, Promise<HistoryShard | undefined>> = {}

/**
 * One shard of the offline history, imported once and kept. Nothing when this build holds no such shard, and
 * nothing when it fails to load: this is the fallback source, so a failure here must leave the page as it was.
 */
export const loadShard = (set: HistorySet, shard: number): Promise<HistoryShard | undefined> => {
  const path = `../../generated/history/${shardName(set, shard)}.ts`
  return loaded[path] ??= (shards[path]?.() ?? Promise.resolve(undefined)).catch(error => {
    console.error(`offline: the history shard ${shardName(set, shard)} could not be loaded`, error)
    return undefined
  })
}
