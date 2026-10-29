import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vite-plus/test'

import { airedDates, parseMalAnime } from '../../../../src/sources/jikan/anime-page'

// Real bytes from myanimelist.net title pages, 2026-10-13, cut from the title to the end of the
// synopsis (mal:61578 on 2026-10-29, to the end of its Streaming Platforms list). Jikan, which read these same pages for this source until it shut down on 2026-10-01,
// answered mal:1 with the values asserted below (its record archived on 2024-04-11), apart from
// figures that moved since.
const page = (id: number) =>
  parseMalAnime(readFileSync(new URL(`./__fixtures__/mal-anime-${id}.html`, import.meta.url), 'utf8'))

describe('parseMalAnime', () => {
  test('reads every field Jikan answered for a finished TV show', () => {
    expect(page(1)).toMatchObject({
      title: 'Cowboy Bebop',
      englishTitle: 'Cowboy Bebop',
      japaneseTitle: 'カウボーイビバップ',
      type: 'TV',
      episodes: 26,
      status: 'Finished Airing',
      startDate: '1998-04-03',
      endDate: '1999-04-24',
      season: 'spring',
      year: 1998,
      score: 8.75,
      members: 2091002,
      trailer: 'gY5nDXOtv_o',
      cover: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp',
    })
  })

  // genres, then themes, then demographics, which is the order Jikan's three lists were joined in
  test('genres are the Genres, Themes and Demographic rows in page order', () => {
    expect(page(1)!.genres).toEqual(['Action', 'Award Winning', 'Sci-Fi', 'Adult Cast', 'Space'])
    expect(page(63816)!.genres).toEqual(['Adventure', 'Drama', 'Fantasy', 'Shounen'])
  })

  // The page writes `&amp;` inside the href, and `aid` is only a parameter once that is read.
  test('the AniDB link is read off the resources, entities and all', () => {
    expect(page(1)!.anidb).toBe('https://anidb.net/perl-bin/animedb.pl?show=anime&aid=23')
  })

  // The page breaks paragraphs with `<br />` and a CRLF; Jikan answered blank lines between them.
  test('the synopsis keeps its paragraphs as blank lines, with no tag and no carriage return', () => {
    const { synopsis } = page(1)!
    expect(synopsis).toMatch(/^Crime is timeless\. By the year 2071/)
    expect(synopsis).toMatch(/old wounds\.\n\n\[Written by MAL Rewrite\]$/)
    expect(synopsis).toContain('Welsh corgi.\n\nWhile developing bonds')
    expect(synopsis).not.toMatch(/[\r<>]/)
  })

  // The title page names accented letters, where the season page writes the characters themselves.
  test('named entities in the synopsis are read', () => {
    expect(page(199)!.synopsis).toContain('naïve, 10-year-old Chihiro Ogino')
    expect(page(199)!.synopsis).not.toMatch(/&\w+;/)
  })

  test('a film has no premiere season, one aired day and no end', () => {
    expect(page(199)).toMatchObject({ type: 'Movie', episodes: 1, startDate: '2001-07-20', endDate: undefined })
    expect(page(199)!.season).toBeUndefined()
    expect(page(199)!.year).toBeUndefined()
  })

  // `Aired: Oct 2027 to ?`, `Episodes: Unknown`, `Score: N/A`, and no promotional video
  test('a show not yet aired keeps what it knows and drops what it does not', () => {
    expect(page(63816)).toMatchObject({
      title: 'Sousou no Frieren: Ougonkyou-hen',
      englishTitle: 'Frieren: Beyond Journey\'s End - Golden Land Arc',
      status: 'Not yet aired',
      startDate: '2027-10',
      endDate: undefined,
      season: 'fall',
      year: 2027,
      episodes: undefined,
      score: undefined,
      trailer: undefined,
    })
    expect(page(63816)!.synopsis).toBe('Third season of Sousou no Frieren.')
  })

  // "No synopsis information has been added to this title. Help improve our database by adding a
  // synopsis here." is the page's own placeholder, and as a description it would win at 0.9.
  test('the no-synopsis placeholder is no synopsis', () => {
    expect(page(64028)!.title).toBe('Tanuki to Kitsune (TV)')
    expect(page(64028)!.synopsis).toBeUndefined()
  })

  // mal:61578 as MyAnimeList answered from Japan on 2026-10-29: a JustWatch entry links through click.justwatch.com
  // with the country it was found in, and MyAnimeList's own (OceanVeil, Bahamut) link the platform with none
  test('the Streaming Platforms list, a JustWatch entry as the platform\'s own address and its country', () => {
    expect(page(61578)!.streamingLinks).toEqual([
      { site: 'Hulu', url: 'https://www.hulu.jp/watch/100276501', icon: 'https://images.justwatch.com/icon/116305230/s100', country: 'JP' },
      { site: 'OceanVeil', url: 'https://oceanveil.net/ad?agn=2&src=8&pattern=MAL&url=/lp', icon: 'https://cdn.myanimelist.net/resources/streaming_platforms/oceanveil/100x100-07345239.png' },
      { site: 'Watcha', url: 'https://watcha.com/contents/tRzLxAV', icon: 'https://images.justwatch.com/icon/2538290/s100', country: 'KR' },
      {
        site: 'Animation Digital Network',
        url: 'https://animationdigitalnetwork.com/de/video/1428-even-the-student-council-has-its-holes/32946-folge-1',
        icon: 'https://cdn.myanimelist.net/resources/streaming_platforms/anime-digital-network/100x100-21a8e2d0.png',
        country: 'DE',
      },
      { site: 'Bahamut Anime Crazy', url: 'https://ani.gamer.com.tw/', icon: 'https://cdn.myanimelist.net/resources/streaming_platforms/bahamut-anime-crazy/100x100-4363938d.png' },
    ])
  })

  // Spirited Away's 31, every one marked unavailable where the page was read, Netflix found in Andorra
  test('a film lists its platforms the same way, each in a country of its own', () => {
    const links = page(199)!.streamingLinks
    expect(links).toHaveLength(31)
    expect(links[0]).toEqual({ site: 'Netflix', url: 'https://www.netflix.com/title/60023642', icon: 'https://images.justwatch.com/icon/207360008/s100', country: 'AD' })
    expect(links.filter(link => !link.country)).toEqual([])
    expect(page(1)!.streamingLinks.map(link => `${link.site} ${link.country ?? '-'}`)).toEqual([
      'Netflix JP', 'Amazon Prime Video JP', 'FOD JP', 'U-NEXT JP', 'Google Play Movies JP', 'Crunchyroll AG', 'Apple TV Store AU',
      'Watcha KR', 'Fandango At Home US', 'Tubi TV -', 'Neon TV NZ',
    ])
  })

  test('a page that names no show is nothing, not an empty record', () => {
    expect(parseMalAnime('')).toBeUndefined()
    expect(parseMalAnime('<html><body><h1>404 Not Found</h1></body></html>')).toBeUndefined()
  })
})

describe('airedDates', () => {
  test('reads both ends of a run, and a single day', () => {
    expect(airedDates('Apr 3, 1998 to Apr 24, 1999')).toEqual({ startDate: '1998-04-03', endDate: '1999-04-24' })
    expect(airedDates('Jul 20, 2001')).toEqual({ startDate: '2001-07-20', endDate: undefined })
  })

  // the title page writes `Oct 2027`, the search answer `Oct ??, 2027`; ONE PIECE FILM: GOD VALLEY (mal:64858)
  // reads `2027`, and MAL outranks AniList's own year (2026-10-17)
  test('a month or a year alone keeps its precision, and an open end is no date', () => {
    expect(airedDates('Oct 2027 to ?')).toEqual({ startDate: '2027-10', endDate: undefined })
    expect(airedDates('Oct ??, 2027 to ?')).toEqual({ startDate: '2027-10', endDate: undefined })
    expect(airedDates('2027')).toEqual({ startDate: '2027', endDate: undefined })
    expect(new Date(airedDates('Oct 2027').startDate!).toISOString(), 'still the first of it to whatever parses it').toBe('2027-10-01T00:00:00.000Z')
  })

  test('anything else is no date', () => {
    expect(airedDates('Not available')).toEqual({ startDate: undefined, endDate: undefined })
    expect(airedDates('Foo 3, 1998')).toEqual({ startDate: undefined, endDate: undefined })
    expect(airedDates(undefined)).toEqual({ startDate: undefined, endDate: undefined })
  })
})
