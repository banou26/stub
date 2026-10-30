// The offline history's titles, covers, banners and descriptions, chosen by stub's own rules (HOR-915): each
// gathered input becomes the media stub's own source answers for it (offline, kitsu, anizip), or is one, kept from a
// link preview, and stub's own `aggregateFields` merges them as it merges a page's members. The Offline history job
// merges every answer the private source store keeps too, every source's, and publishes what it chose as the picks.
// Loaded through vite's module runner (scripts/history-files.mjs's `loadMerge`), by the job and by
// ./build-anime-data.mjs, which merges the public inputs alone when it has no picks of this merge to ship.

import type { Media as GQLMedia } from '../src/generated/schema/types.generated'

import { aggregateFields, type ClusterFacts } from '../src/worker/graph/plugins/fields'
import { normalizeMedia as anizipMedia } from '../src/sources/anizip/extractor'
import { normalizeMedia as kitsuMedia } from '../src/sources/kitsu/extractor'
import { coverUrl, recordId, seasonMedia, type ManamiRecord } from '../src/sources/offline/normalize'
import { SHARDS, kitsuPath, shardName, shardOf, type DumpEntry, type HistorySet, type PickEntry } from '../src/sources/offline/history'
import { makeMedia } from '../src/sources/utils'
import { fromAggregatedUri, type AggregatedUri } from '../src/utils/uri'
import { newer } from './history-files.mjs'

export { SHARDS, shardName, type PickEntry }

/** One AniDB title as the history keeps it, in its file's order. */
export type AnidbTitle = [type: string, language: string, title: string]
/** A Kitsu row as the history keeps it: the resource kitsu's `normalizeMedia` reads, and when Kitsu answered it. */
export type KitsuRow = Parameters<typeof kitsuMedia>[0] & { fetchedAt?: string }
/** A link preview's answer of anizip or Kitsu as the history keeps it (scripts/history-files.mjs's `foldPreviews`). */
export type PreviewAnswer = { source: string, id: string, class: 'full' | 'list', fetchedAt: string, media: Partial<GQLMedia> }
/** A record's kept answers, by source. */
export type Kept = { anizip?: PreviewAnswer, kitsu?: PreviewAnswer }
/** An answer the private source store keeps (scripts/source-store.mjs's `readAnswers`), with its run's address. */
export type StoredAnswer = PreviewAnswer & { run: string, role: 'member' | 'related' | null }
/** A dump record as the data build extracts it, with its AniDB id. */
export type HistoryRecord = ManamiRecord & { ad?: number }

const MAL_CDN = 'https://cdn.myanimelist.net/'

/**
 * api.ani.zip's `titles` for one AniDB entry, as far as its answers show the rule: per language the official
 * title, else the first of that language in AniDB's file. Where a language has several unofficial titles,
 * api.ani.zip took another than the first on 8 of 14 answers read 2026-10-24, by an order the file does not carry.
 */
export const anizipTitles = (titles: readonly AnidbTitle[]) => {
  const out: { en?: string, ja?: string } = {}
  for (const language of ['en', 'ja'] as const) {
    const ofLanguage = titles.filter(([, lang]) => lang === language)
    const title = ofLanguage.find(([type]) => type === 'official') ?? ofLanguage[0]
    if (title) out[language] = title[2]
  }
  return out
}

const keptMedia = ({ source, id, media }: PreviewAnswer) => makeMedia({ ...media, origin: source, id })

// the catalogues a history record is reached by, most specific first, as the offline source tries them
const CATALOGUES = [['mal', 'ml'], ['anilist', 'al'], ['kitsu', 'ku']] as const

/**
 * Each record's stored answers, by key: per uri its newest full answer, else its newest list hit. An answer is about
 * the record of its own catalogue id, whatever run it came from. It also belongs to the records its run's address
 * names when it was a member of that run, the only join for a source no record has an id of: an answer only related
 * to the run, or a hit the run passed over, says nothing about those records, and neither does a run with no card,
 * whose address is whatever the link said. Two records the engine welded are one show on a page, so each takes the
 * run. An id two records share goes to the first, as a key does.
 */
export const storedAnswers = (records: readonly HistoryRecord[], answers: readonly StoredAnswer[]) => {
  const keys = new Map<string, string>()
  const claim = (uri: string, key: string) => {
    if (!keys.has(uri)) keys.set(uri, key)
  }
  for (const record of records) {
    const key = recordId(record)
    if (!key || !record.t) continue
    for (const [origin, field] of CATALOGUES) if (record[field]) claim(`${origin}:${record[field]}`, key)
    claim(`offline:${key}`, key)
  }
  // by the most specific catalogue naming any, so a Kitsu id another record shares lends a MyAnimeList address nothing
  const named = (uris: readonly string[]) => {
    for (const origin of [...CATALOGUES.map(([catalogue]) => catalogue), 'offline']) {
      const shows = uris.filter(uri => uri.startsWith(`${origin}:`)).flatMap(uri => keys.get(uri) ?? [])
      if (shows.length) return shows
    }
    return []
  }
  const shows = new Map<string, Map<string, StoredAnswer>>()
  for (const answer of answers) {
    const uri = `${answer.source}:${answer.id}`
    const address = fromAggregatedUri(answer.run as AggregatedUri)?.handleUris ?? [answer.run]
    for (const key of new Set([...named([uri]), ...answer.role === 'member' ? named(address) : []])) {
      const own = shows.get(key) ?? shows.set(key, new Map()).get(key)!
      if (newer(answer, own.get(uri))) own.set(uri, answer)
    }
  }
  return new Map([...shows].map(([key, own]) => [key, [...own.values()]]))
}

/**
 * The media stub's sources would answer for a record from the gathered inputs. A kept anizip answer stands for the
 * titles AniDB's file gives, since it is api.ani.zip's own choice of them, and a kept Kitsu answer for Kitsu's row
 * when Kitsu answered it later. `stored` adds what the private store keeps of every other answer about the record.
 */
export const members = (record: HistoryRecord, anidb?: readonly AnidbTitle[], kitsu?: KitsuRow, kept: Kept = {}, stored: readonly StoredAnswer[] = []): GQLMedia[] => {
  const offline = seasonMedia(record)
  if (!offline) return []
  const media = [offline]
  // A dump picture on MyAnimeList's CDN is MyAnimeList's own cover, so it ranks where the mal source ranks its
  // cover, as the season build ranks a MyAnimeList card's cover first. Without it Kitsu's poster (0.3) outranks
  // it, and the cover was the page's on 47 of 185 walked shows instead of 178.
  const cover = offline.covers[0]
  if (record.ml && cover?.url.startsWith(MAL_CDN)) {
    media.push(makeMedia({ origin: 'mal', id: String(record.ml), score: 0.9, covers: [{ ...cover, score: 0.9 }] }))
  }
  if (kept.kitsu && !(kitsu?.fetchedAt && kitsu.fetchedAt >= kept.kitsu.fetchedAt)) media.push(keptMedia(kept.kitsu))
  else if (kitsu) media.push(kitsuMedia(kitsu))
  if (kept.anizip) media.push(keptMedia(kept.anizip))
  // the live anizip source answers only an address carrying a mal id
  else if (record.ml && record.ad && anidb?.length) {
    media.push(anizipMedia({
      mappings: { anidb_id: record.ad, mal_id: record.ml, anilist_id: record.al, type: record.ty },
      titles: anizipTitles(anidb),
      images: [],
      episodes: {},
    } as unknown as Parameters<typeof anizipMedia>[0]))
  }
  // Kept answers and the rows above decide their own source. MyAnimeList's member is only the dump's picture, so its
  // stored answer joins it, ahead of it: at the same score and uri, the first one's cover goes first.
  const decided = new Set(media.filter(member => member.origin !== 'mal').map(member => member.uri))
  return [...stored.map(keptMedia).filter(member => !decided.has(member.uri)), ...media]
}

const CLUSTER: ClusterFacts = { id: 'history', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] }

// the field of each list's items that carries its value
const VALUE = { titles: 'title', covers: 'url', banners: 'url', descriptions: 'description' } as const

/**
 * What stub's page heads a record with from these inputs, each with the source that gave it: the first title, cover and
 * banner, and the longest description, the one a page and a link preview show whatever its score.
 */
export const pick = (record: HistoryRecord, anidb?: readonly AnidbTitle[], kitsu?: KitsuRow, kept?: Kept, stored?: readonly StoredAnswer[]) => {
  const media = members(record, anidb, kitsu, kept, stored)
  const row = aggregateFields({
    cluster: CLUSTER,
    members: media.map(member => ({ uri: member.uri, origin: member.origin, id: member.id, owned: true, score: member.score ?? null, raw: member as unknown as Record<string, unknown>, fieldSeq: {} })),
    related: [],
    relations: [],
    locationOrigin: '',
  })
  // the merge keeps each member's own item, so the item says which member gave it
  const chosen = (field: keyof typeof VALUE, item?: Record<string, string>): { value: string, origin: string } | undefined => {
    const from = item && media.find(member => (member[field] as unknown[]).includes(item))
    return from ? { value: item[VALUE[field]]!, origin: from.origin } : undefined
  }
  const first = (field: keyof typeof VALUE) => chosen(field, (row[field] as Record<string, string>[])[0])
  const longest = (row.descriptions as Record<string, string>[]).reduce<Record<string, string> | undefined>((best, item) =>
    (best && best.description!.length >= item.description!.length ? best : item), undefined)
  return { title: first('titles'), cover: first('covers'), banner: first('banners'), description: chosen('descriptions', longest) }
}

/**
 * Stub's merge of every record: `picks`, what it chose over the dump's title and picture, by key, leaving out a record
 * it chose nothing else for, and how many entries each source gave. A key two records share keeps the first. `previews`
 * holds the kept answers by uri, joined to a record by its AniDB and Kitsu ids, and `stored` each record's answers from
 * the private store, as `storedAnswers` answers them, which only the job has.
 */
export const historyPicks = (
  records: readonly HistoryRecord[],
  anidb: ReadonlyMap<number, readonly AnidbTitle[]>,
  kitsu: ReadonlyMap<number, KitsuRow>,
  previews: ReadonlyMap<string, PreviewAnswer> = new Map(),
  stored: ReadonlyMap<string, readonly StoredAnswer[]> = new Map(),
) => {
  const picks = new Map<string, PickEntry>()
  const counts = { records: 0, anidbTitles: 0, kitsuTitles: 0, kitsuCovers: 0, banners: 0, descriptions: 0, previewed: 0, stored: 0 }
  const seen = new Set<string>()
  for (const record of records) {
    const key = recordId(record)
    if (!key || !record.t || seen.has(key)) continue
    seen.add(key)
    counts.records++

    const kept = { anizip: record.ad ? previews.get(`anizip:${record.ad}`) : undefined, kitsu: record.ku ? previews.get(`kitsu:${record.ku}`) : undefined }
    counts.previewed += Number(Boolean(kept.anizip || kept.kitsu))
    counts.stored += Number(stored.has(key))
    const { title, cover, banner, description } = pick(record, record.ad ? anidb.get(record.ad) : undefined, record.ku ? kitsu.get(record.ku) : undefined, kept, stored.get(key))
    const entry: PickEntry = {}
    // a value that reads as the dump's is the dump's entry already
    if (title && title.value !== record.t) entry.t = title.value
    if (cover && cover.value !== (record.p && coverUrl(record.p))) entry.p = kitsuPath(cover.value)
    if (banner) entry.b = kitsuPath(banner.value)
    if (description) entry.d = description.value
    if (Object.keys(entry).length) picks.set(key, entry)
    counts.anidbTitles += Number(Boolean(entry.t) && title?.origin === 'anizip')
    counts.kitsuTitles += Number(Boolean(entry.t) && title?.origin === 'kitsu')
    counts.kitsuCovers += Number(Boolean(entry.p) && cover?.origin === 'kitsu')
    counts.banners += Number(Boolean(entry.b))
    counts.descriptions += Number(Boolean(entry.d))
  }
  return { picks, counts }
}

/**
 * The history's shards: for each set, `SHARDS` objects of key to entry (see src/sources/offline/history.ts), the dump's
 * from `records` and stub's from `picks`, as `historyPicks` answers them. A key two records share keeps the first. A
 * record with no MyAnimeList id that names a Kitsu id is also reached from `kitsu-K`, which the id index cannot do,
 * since it holds no row without a MyAnimeList id.
 */
export const historyShards = (records: readonly HistoryRecord[], picks: ReadonlyMap<string, PickEntry>) => {
  const sets: Record<HistorySet, Record<string, unknown>[]> = {
    dump: Array.from({ length: SHARDS }, () => ({})),
    stub: Array.from({ length: SHARDS }, () => ({})),
  }
  const pointers = new Map<string, string>()
  for (const record of records) {
    const key = recordId(record)
    if (!key || !record.t) continue
    const shard = shardOf(key)
    if (sets.dump[shard]![key]) continue
    const dump: DumpEntry = [record.t, record.p]
    sets.dump[shard]![key] = dump
    const entry = picks.get(key)
    if (entry) sets.stub[shard]![key] = entry
    if (!record.ml && record.ku && key !== `kitsu-${record.ku}` && !pointers.has(`kitsu-${record.ku}`)) pointers.set(`kitsu-${record.ku}`, key)
  }
  for (const [pointer, key] of pointers) {
    const shard = sets.dump[shardOf(pointer)]!
    if (!shard[pointer]) shard[pointer] = key
  }
  return sets
}
