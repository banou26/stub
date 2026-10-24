// Frieren and Cowboy Bebop: The Movie as api.ani.zip answered stub's own mappings request on 2026-10-12,
// BanG Dream! It's MyGO!!!!! on 2026-10-13, Nine: Original-ban, Happy-Go-Lucky Days, Full Dive and Monster on 2026-10-24.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/anizip/extractor'
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'
import { descriptionText } from '../../../../src/worker/resolvers/utils'
import FRIEREN from '../../../fixtures/anizip/frieren.json'
import COWBOY_BEBOP_MOVIE from '../../../fixtures/anizip/cowboy-bebop-the-movie.json'
import MYGO from '../../../fixtures/anizip/bang-dream-its-mygo.json'
import NINE from '../../../fixtures/anizip/nine-original-ban.json'
import HAPPY_GO_LUCKY_DAYS from '../../../fixtures/anizip/happy-go-lucky-days.json'
import FULL_DIVE from '../../../fixtures/anizip/full-dive.json'
import MONSTER from '../../../fixtures/anizip/monster.json'

const normalized = async (answer: { mappings: { mal_id: number } }) => {
  const context = { fetch: async () => ({ json: async () => answer }) }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `ag:(mal:${answer.mappings.mal_id})` } }, context).next()
  return value.media
}

const links = async (answer: { mappings: { mal_id: number } }) =>
  ((await normalized(answer)).handles as { relation: string, node: { uri: string, url: string, scope: string } }[])
    .map(({ relation, node }) => `${relation} ${node.scope} ${node.uri} ${node.url}`)

type Texts = { titles: { title: string }[], descriptions: { description: string }[], shortDescriptions: { shortDescription: string }[] }

const shown = (episode: Texts) => descriptionText(episode.shortDescriptions[0]!.shortDescription).trim()

// an enricher's ids are links that never weld two titles: PART_OF, which unions nothing
test('a series\' TMDB, TheTVDB and IMDb ids are links to the show', async () => {
  expect(await links(FRIEREN)).toEqual([
    'SAME_AS RUN mal:52991 https://myanimelist.net/anime/52991',
    'SAME_AS RUN anilist:154587 https://anilist.co/anime/154587',
    'PART_OF CONTAINER tmdb:209867 https://www.themoviedb.org/tv/209867',
    'PART_OF CONTAINER tvdb:424536 https://thetvdb.com/dereferrer/series/424536',
    'PART_OF CONTAINER imdb:tt22248376 https://www.imdb.com/title/tt22248376',
  ])
})

// its `themoviedb_id` 30991 is the series': /movie/30991 is a 1964 horror film, /tv/30991 Cowboy Bebop
test('a film gets no TMDB link, since AniZip often gives its series\' id', async () => {
  expect(await links(COWBOY_BEBOP_MOVIE)).toEqual([
    'SAME_AS RUN mal:5 https://myanimelist.net/anime/5',
    'SAME_AS RUN anilist:5 https://anilist.co/anime/5',
    'PART_OF CONTAINER tvdb:76885 https://thetvdb.com/dereferrer/series/76885',
    'PART_OF CONTAINER imdb:tt0275277 https://www.imdb.com/title/tt0275277',
  ])
})

// a film filed as a series sends JustWatch to the unrelated show its id also names (Penguin Highway, 2026-10-19)
test('a film is filed as a film and a series as a series', async () => {
  expect((await normalized(COWBOY_BEBOP_MOVIE)).categories).toEqual(['ANIME', 'MOVIE'])
  expect((await normalized(FRIEREN)).categories, 'the control').toEqual(['ANIME', 'SERIES'])
})

test('an id AniZip does not have is no link', async () => {
  const mappings = { ...FRIEREN.mappings, themoviedb_id: null, thetvdb_id: null, imdb_id: null }
  expect(await links({ ...FRIEREN, mappings })).toEqual([
    'SAME_AS RUN mal:52991 https://myanimelist.net/anime/52991',
    'SAME_AS RUN anilist:154587 https://anilist.co/anime/154587',
  ])
})

test('every id AniZip links is one it publishes, not an echo of the address', async () => {
  const origins = (await links(FRIEREN)).map(line => line.split(' ')[2]!.split(':')[0]!)
  expect(origins.filter(origin => !NATIVE_ID_SPACES.anizip!.has(origin))).toEqual([])
})

// 27 of Frieren's episode summaries end "\nSource: Crunchyroll" or "\nSource: crunchyroll"
test('an episode\'s summary arrives without the credit ending it', async () => {
  const texts = ((await normalized(FRIEREN)).episodes as Texts[])
    .flatMap(episode => [...episode.descriptions.map(({ description }) => description), ...episode.shortDescriptions.map(({ shortDescription }) => shortDescription)])

  expect(texts.length).toBeGreaterThan(0)
  expect(texts.filter(text => /Source:/i.test(text))).toEqual([])
})

test('a title or synopsis shows an apostrophe where AniDB writes a backtick', async () => {
  const [frieren, mygo] = await Promise.all([normalized(FRIEREN), normalized(MYGO)])
  const texts = [frieren, mygo]
    .flatMap(media => [media, ...media.episodes] as Texts[])
    .flatMap(({ titles, shortDescriptions }) => [...titles.map(({ title }) => title), ...shortDescriptions.map(({ shortDescription }) => shortDescription)])

  expect(frieren.titles[0].title).toBe('Frieren: Beyond Journey\'s End')
  expect(mygo.titles.map(({ title }: { title: string }) => title)).toContain('BanG Dream! It\'s MyGO!!!!!')
  expect(texts).toContain('It Didn\'t Have to Be Magic...')
  expect(texts.filter(text => text.includes('`'))).toEqual([])
})

test('a title or episode title shows the < and > AniDB writes as &lt; and &gt;', async () => {
  const [nine, days] = await Promise.all([normalized(NINE), normalized(HAPPY_GO_LUCKY_DAYS)])
  const titles = [nine, days]
    .flatMap(media => [media, ...media.episodes] as Texts[])
    .flatMap(({ titles }) => titles.map(({ title }) => title))

  expect(nine.titles.map(({ title }: { title: string }) => title)).toEqual(['ナイン <オリジナル版>'])
  expect(titles).toContain('スペシャルキャスト対談「どうにかなる日々, わたしたちの日々」完全版 <Episode 1> 花澤香菜 × 小松未可子 編')
  expect(titles.filter(title => /&\w+;/.test(title))).toEqual([])
})

// anidb 18675's English title as api.ani.zip answered on 2026-10-24
test('an English title shows the < and > AniDB writes as &lt; and &gt;', async () => {
  const en = 'Bogus Skill &lt;&lt;Fruitmaster&gt;&gt;: About That Time I Became Able to Eat Unlimited Numbers of Skill Fruits (That Kill You)'
  const answer = { ...NINE, titles: { en } }
  const media = await normalized(answer)

  expect(media.titles[0].title).toBe('Bogus Skill <<Fruitmaster>>: About That Time I Became Able to Eat Unlimited Numbers of Skill Fruits (That Kill You)')
})

// none of 735 summaries in 161 answers carried one on 2026-10-24, so this one is made up. A summary is shown through
// Markdown, which reads its &lt; and &gt;, so a summary decoded first would lose `<Original-ban>` as a tag
test('an episode summary shows the < and > AniDB writes as &lt; and &gt;', async () => {
  const episode = { ...NINE.episodes['1'], summary: 'Nine &lt;Original-ban&gt; isn`t cut' }
  const answer = { ...NINE, episodes: { 1: episode } }
  const media = await normalized(answer)

  expect(shown(media.episodes[0])).toBe('Nine <Original-ban> isn\'t cut')
})

// Full Dive's (anidb 15905) episodes 2 and 6, two of the five anime.fkn.app showed raw
test('an episode summary shows the text of a link AniDB writes as `URL [text]`', async () => {
  const older = { ...FULL_DIVE.episodes['2'], summary: 'http://anidb.net/perl-bin/animedb.pl?show=character&charid=115820 [Hiro] logs in.' }
  const answer = { ...FULL_DIVE, episodes: { 2: older } }
  const [fullDive, olderLink] = await Promise.all([normalized(FULL_DIVE), normalized(answer)])

  expect(fullDive.episodes.map(shown)).toEqual([
    'Given the difficulty of Hiro\'s unique situation in the game, Reona and Hiro decide to seek the help of one of the few remaining players in Kiwame Quest.',
    'Mizarisa and Alicia clash over Hiro. After the battle, Hiro starts to understand Kamui\'s advice.',
  ])
  expect(shown(olderLink.episodes[0])).toBe('Hiro logs in.')
})

// Monster's (anidb 1539) episodes 1 and 64: every one of its 66 summaries ends in this credit, 64's typed `[I[`
test('an episode summary shows no `[I]` tag of AniDB\'s, nor the credit it wraps', async () => {
  expect((await normalized(MONSTER)).episodes.map(shown)).toEqual([
    'Doctor Tenma is a brilliant Japanese neurosurgeon who works at Eisler Memorial Hospital in Germany. He is doing well professionally and is even engaged to the director\'s daughter, Eva. One day, a boy with a gunshot wound to the head is brought to him.',
    'The Baby is killed by a prostitute, and his death sends shockwaves through Petr Capek\'s organization. Capek becomes paranoid as to who is loyal or not and accidentally kills one of his guards. He makes it to his cottage where Johan is waiting for him.',
  ])
})

// made up: of 6099 summaries in 719 titles on 2026-10-24, none had another bracket and 3 a bare address
test('a summary with no link AniDB\'s way arrives as written', async () => {
  const summary = 'Hiro logs in [again] to http://anidb.net/ch115822, where [Reona] waits.'
  const answer = { ...FULL_DIVE, episodes: { 2: { ...FULL_DIVE.episodes['2'], summary } } }
  const media = await normalized(answer)

  expect(media.episodes[0].shortDescriptions[0].shortDescription).toBe(summary)
})

// One Piece 1181 to 1184 as api.ani.zip answered on 2026-10-15: no `airDateUtc`, `airDate: null`, `airdate: ''`
test('an episode AniZip has not dated yet has no date', async () => {
  const undated = { ...FRIEREN.episodes['28'], airDateUtc: undefined, airDate: null, airdate: '' }
  const answer = { ...FRIEREN, episodes: { ...FRIEREN.episodes, 28: undated } }
  const media = await normalized(answer)
  const dates = Object.fromEntries((media.episodes as { episodeNumber: number, releaseDate?: string }[])
    .map(({ episodeNumber, releaseDate }) => [episodeNumber, releaseDate]))

  expect(dates[27]).toBe('2024-03-15T14:00:00Z')
  expect(dates[28]).toBeUndefined()
})

// So What's Wrong with Getting Reborn as a Goblin? 3 aired Oct 12 13:30 UTC by Syoboi Calendar, and api.ani.zip
// answered as `goblin` on 2026-10-18
test('an episode TheTVDB times 2 or more days from AniDB\'s day goes by that day', async () => {
  const goblin = { ...FRIEREN.episodes['28'], airDateUtc: '2026-10-19T13:00:00Z', airDate: '2026-10-19', airdate: '2026-10-12' }
  const near = { ...FRIEREN.episodes['27'], airDateUtc: '2026-10-13T12:00:00Z', airDate: '2026-10-13', airdate: '2026-10-12' }
  const answer = { ...FRIEREN, episodes: { ...FRIEREN.episodes, 27: near, 28: goblin } }
  const media = await normalized(answer)
  const dates = Object.fromEntries((media.episodes as { episodeNumber: number, releaseDate?: string }[])
    .map(({ episodeNumber, releaseDate }) => [episodeNumber, releaseDate]))

  expect(dates[27], 'a day and a half apart').toBe('2026-10-13T12:00:00Z')
  expect(dates[28]).toBe('2026-10-12')
})

test('a work\'s banner is its 16:9 TheTVDB fanart, never the thin TheTVDB banner strip', async () => {
  expect((await normalized(FRIEREN)).banners).toEqual([
    { url: 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64e6cbe29d9c0.jpg', score: 0.9 },
  ])
})
