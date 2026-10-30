// The offline history as the offline source reads it: two shards per number, the dump's and stub's merge's, and one
// media at the offline source's score built from them.
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
  expect(shardName('stub', 7)).toBe('stub-007')
})

// Mutations: read the stub shard of another number than the dump's; read a third set.
test('a record takes its own entries from both sets of its shard, two chunks', async () => {
  const { load, asked } = shards({
    dump: { 21: { 'mal-21': ['One Piece', '1244/138851.jpg'] } },
    stub: { 21: { 'mal-21': { t: 'ONE PIECE', d: 'Gol D. Roger was known as the Pirate King.' } } },
  })
  expect(await historyEntry('mal-21', load)).toEqual({
    key: 'mal-21', title: 'One Piece', picture: '1244/138851.jpg', pick: { t: 'ONE PIECE', d: 'Gol D. Roger was known as the Pirate King.' },
  })
  expect(asked).toEqual(['dump-021', 'stub-021'])
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

// Mutation: put the dump's title before the pick's.
test('the media heads with the merge\'s title, else the dump\'s', () => {
  const entry = { key: 'mal-1', title: 'Cowboy Bebop', picture: '' }
  const title = (over: object) => historyMedia({ ...entry, ...over }, []).titles.map(item => item.title)
  expect(title({ pick: { t: 'カウボーイビバップ' } })).toEqual(['カウボーイビバップ'])
  expect(title({})).toEqual(['Cowboy Bebop'])
})

// Mutations: take the dump's picture before the pick's; drop the MyAnimeList prefix restore; prefix an absolute image.
test('the cover is the merge\'s where it chose one, Kitsu\'s prefix restored, else the dump\'s picture as the bundle restores it', () => {
  const kitsu = historyMedia({ key: 'kitsu-5', title: 'A', picture: 'https://cdn.anime-planet.com/a.jpg', pick: { p: '5/poster_image/x.jpg' } }, [])
  expect(kitsu.covers.map(cover => cover.url)).toEqual(['https://media.kitsu.app/anime/5/poster_image/x.jpg'])
  const anilist = historyMedia({ key: 'mal-5', title: 'A', picture: '4/19644.jpg', pick: { p: 'https://img.anili.st/media/5' } }, [])
  expect(anilist.covers.map(cover => cover.url)).toEqual(['https://img.anili.st/media/5'])
  const dump = historyMedia({ key: 'mal-1', title: 'A', picture: '4/19644.jpg' }, [])
  expect(dump.covers.map(cover => cover.url)).toEqual(['https://cdn.myanimelist.net/images/anime/4/19644l.webp'])
  expect(historyMedia({ key: 'mal-2', title: 'A', picture: '' }, []).covers).toEqual([])
})

// Mutations: leave out the banner or the description; score the description above the offline source's 0.2.
test('the banner and the description are the merge\'s, at the offline source\'s score', () => {
  const media = historyMedia({ key: 'mal-1', title: 'A', picture: '', pick: { b: 'cover_images/1/original.jpg', d: 'Space bounty hunters.' } }, [])
  expect(media.banners).toEqual([{ url: 'https://media.kitsu.app/anime/cover_images/1/original.jpg', score: 0.2 }])
  expect(media.descriptions?.map(item => [item.description, item.score])).toEqual([['Space bounty hunters.', 0.2]])
  expect(media.score).toBe(0.2)
  expect(media.titles[0]?.score).toBe(0.2)
})

// Mutations: stamp a season or a type from the record; claim SERIES; leave out ANIME.
test('a history media claims no season, type, status or date, and ANIME as its one category', () => {
  const media = historyMedia({ key: 'mal-1', title: 'A', picture: '' }, [])
  expect([media.season, media.seasonYear, media.type, media.status, media.startDate, media.endDate, media.categories]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, ['ANIME']])
})

test('a Kitsu image keeps only what follows Kitsu\'s own prefix', () => {
  expect(kitsuPath('https://media.kitsu.app/anime/5/poster_image/x.jpg')).toBe('5/poster_image/x.jpg')
  expect(kitsuPath('https://example.org/x.jpg')).toBe('https://example.org/x.jpg')
})
