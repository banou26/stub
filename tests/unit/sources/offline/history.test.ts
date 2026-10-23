// The offline history as the offline source reads it: three shards per number, one per source, and one media at
// the offline source's score built from them.
import { expect, test } from 'vite-plus/test'

import { historyEntry, historyMedia, kitsuPath, shardName, shardOf, type HistorySet, type HistoryShard } from '../../../../src/sources/offline/history'

const shards = (sets: Partial<Record<HistorySet, Record<number, Record<string, unknown>>>>) => {
  const asked: string[] = []
  const load = async (set: HistorySet, shard: number): Promise<HistoryShard | undefined> => {
    asked.push(shardName(set, shard))
    const records = sets[set]?.[shard]
    return records && { records }
  }
  return { asked, load }
}

// Mutation: a modulo of 64.
test('a record is in the shard of its key\'s number modulo 128, under a name the build writes and the loader reads', () => {
  expect(shardOf('mal-21')).toBe(21)
  expect(shardOf('anilist-200')).toBe(72)
  expect(shardOf('kitsu-256')).toBe(0)
  expect(shardName('kitsu', 7)).toBe('kitsu-007')
})

// Mutation: read the anidb and kitsu shards of another number than the dump's.
test('a record takes its own entries from all three sets of its shard', async () => {
  const { load } = shards({
    dump: { 21: { 'mal-21': ['One Piece', '1244/138851.jpg'] } },
    anidb: { 21: { 'mal-21': 'ONE PIECE' } },
    kitsu: { 21: { 'mal-21': { d: 'Gol D. Roger was known as the Pirate King.' } } },
  })
  expect(await historyEntry('mal-21', load)).toEqual({
    key: 'mal-21', title: 'One Piece', picture: '1244/138851.jpg', anidb: 'ONE PIECE', kitsu: { d: 'Gol D. Roger was known as the Pirate King.' },
  })
  expect(await historyEntry('mal-22', load)).toBeUndefined()
})

// Mutations: drop the pointer branch; follow pointers without the one-step limit.
test('a Kitsu id the index cannot reach finds its record through its pointer, one step only', async () => {
  const { load, asked } = shards({
    dump: { 7: { 'kitsu-7': 'anilist-300', 'kitsu-135': 'kitsu-7' }, 44: { 'anilist-300': ['Daicon III', ''] } },
  })
  expect((await historyEntry('kitsu-7', load))?.key).toBe('anilist-300')
  expect(asked).toContain('dump-044')
  expect(await historyEntry('kitsu-135', load)).toBeUndefined()
})

// Mutations: put Kitsu's title before AniDB's; put the dump's before Kitsu's.
test('the media heads with AniDB\'s title, else Kitsu\'s, else the dump\'s', () => {
  const entry = { key: 'mal-1', title: 'Cowboy Bebop', picture: '' }
  const title = (over: object) => historyMedia({ ...entry, ...over }, []).titles.map(item => item.title)
  expect(title({ anidb: 'カウボーイビバップ', kitsu: { t: 'Cowboy Bebop (TV)' } })).toEqual(['カウボーイビバップ'])
  expect(title({ kitsu: { t: 'Cowboy Bebop (TV)' } })).toEqual(['Cowboy Bebop (TV)'])
  expect(title({})).toEqual(['Cowboy Bebop'])
})

// Mutations: take the dump's picture before Kitsu's poster; drop the MyAnimeList prefix restore.
test('the cover is Kitsu\'s poster where stub\'s rules took it, else the dump\'s picture as the bundle restores it', () => {
  const kitsu = historyMedia({ key: 'kitsu-5', title: 'A', picture: 'https://cdn.anime-planet.com/a.jpg', kitsu: { p: '5/poster_image/x.jpg' } }, [])
  expect(kitsu.covers.map(cover => cover.url)).toEqual(['https://media.kitsu.app/anime/5/poster_image/x.jpg'])
  const dump = historyMedia({ key: 'mal-1', title: 'A', picture: '4/19644.jpg' }, [])
  expect(dump.covers.map(cover => cover.url)).toEqual(['https://cdn.myanimelist.net/images/anime/4/19644l.webp'])
  expect(historyMedia({ key: 'mal-2', title: 'A', picture: '' }, []).covers).toEqual([])
})

// Mutation: leave out the banner or the description.
test('the banner and the description are Kitsu\'s, at the offline source\'s score', () => {
  const media = historyMedia({ key: 'mal-1', title: 'A', picture: '', kitsu: { b: 'cover_images/1/original.jpg', d: 'Space bounty hunters.' } }, [])
  expect(media.banners).toEqual([{ url: 'https://media.kitsu.app/anime/cover_images/1/original.jpg', score: 0.2 }])
  expect(media.descriptions?.map(item => item.description)).toEqual(['Space bounty hunters.'])
  expect(media.score).toBe(0.2)
  expect(media.titles[0]?.score).toBe(0.2)
})

// Mutation: stamp a season or a type from the record.
test('a history media claims no season, type, status or date', () => {
  const media = historyMedia({ key: 'mal-1', title: 'A', picture: '' }, [])
  expect([media.season, media.seasonYear, media.type, media.status, media.startDate, media.endDate, media.categories]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, []])
})

test('a Kitsu image keeps only what follows Kitsu\'s own prefix', () => {
  expect(kitsuPath('https://media.kitsu.app/anime/5/poster_image/x.jpg')).toBe('5/poster_image/x.jpg')
  expect(kitsuPath('https://example.org/x.jpg')).toBe('https://example.org/x.jpg')
})
