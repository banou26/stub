// The offline history (HOR-915): every show the offline database lists, as the data build picked it with stub's own
// rules (scripts/offline-pick.ts), in shards the offline source loads one at a time. Pure, so it can be tested
// without the generated shards, which only exist after `npm run data:build`.

import type { Media as GQLMedia } from '../../generated/schema/types.generated'

import { desc, makeMedia } from '../utils'
import { coverUrl, origin, SCORE } from './normalize'

/** Shards per set. A record's shard is its key's number modulo this: `mal-21` is in shard 21. */
export const SHARDS = 128

/**
 * Two files in each shard, so nothing else is in the ODbL data: `dump` holds the offline database's own title and
 * picture for every record, `stub` what stub's merge chose over them.
 */
export type HistorySet = 'dump' | 'stub'

/** The dump's `[title, picture]`, or for a `kitsu-K` key the key of the record with that Kitsu id. */
export type DumpEntry = [title: string, picture: string] | string
/** What stub's merge chose over the dump's entry: a title, a cover, a banner, a description. */
export type PickEntry = { t?: string, p?: string, b?: string, d?: string }
export type HistoryShard = { records: Record<string, unknown> }
export type ShardLoader = (set: HistorySet, shard: number) => Promise<HistoryShard | undefined>

export type HistoryEntry = { key: string, title: string, picture: string, pick?: PickEntry }

export const shardOf = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1)) % SHARDS

/** The file a shard is generated as under src/generated/history, the one name the build and the loader share. */
export const shardName = (set: HistorySet, shard: number) => `${set}-${String(shard).padStart(3, '0')}`

const KITSU_PREFIX = 'https://media.kitsu.app/anime/'

/** An image as a shard keeps it: Kitsu's own prefix dropped, any other host left absolute. */
export const kitsuPath = (url: string) => (url.startsWith(KITSU_PREFIX) ? url.slice(KITSU_PREFIX.length) : url)

const imageUrl = (path: string) => (path.startsWith('http') ? path : `${KITSU_PREFIX}${path}`)

/** The history's record for a key, through the record a `kitsu-K` key points at, or nothing. */
export const historyEntry = async (key: string, load: ShardLoader, follow = true): Promise<HistoryEntry | undefined> => {
  const shard = shardOf(key)
  const dump = (await load('dump', shard))?.records[key] as DumpEntry | undefined
  if (typeof dump === 'string') return follow ? historyEntry(dump, load, false) : undefined
  if (!dump) return undefined
  const picks = await load('stub', shard)
  return { key, title: dump[0], picture: dump[1], pick: picks?.records[key] as PickEntry | undefined }
}

/**
 * A history record as one media at the offline source's score: stub's merge's title, cover, banner and description,
 * else the dump's title and picture. Every live source outranks the title and the cover. Not the banner, which
 * outranks AniList's at 0.05 and JustWatch's at 0.1, and not the description: a page shows the longest one whatever
 * its score, so a synopsis as the merge last read it competes with its source's live one, and a closed season's is
 * never read again.
 * No season, type, status or date: a record outside the bundled seasons claims nothing it was not picked for. ANIME
 * is the one category it claims, and the only one every record holds: without it anime.fkn.app drops a title only
 * this source has answered (`siteAllows`), and SERIES or MOVIE is the format no record carries.
 */
export const historyMedia = (entry: HistoryEntry, handles: Parameters<typeof makeMedia>[0]['handles']): GQLMedia => {
  const pick = entry.pick ?? {}
  const cover = pick.p ? imageUrl(pick.p) : entry.picture && coverUrl(entry.picture)
  return makeMedia({
    origin,
    id: entry.key,
    handles,
    score: SCORE,
    categories: ['ANIME'],
    titles: [{ language: 'en', title: pick.t ?? entry.title, score: SCORE }],
    covers: cover ? [{ url: cover, score: SCORE }] : [],
    banners: pick.b ? [{ url: imageUrl(pick.b), score: SCORE }] : [],
    ...desc(pick.d, SCORE),
  })
}
