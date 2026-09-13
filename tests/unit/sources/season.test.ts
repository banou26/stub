import { describe, expect, test } from 'vitest'

import { ANIME_SEASONS, MEDIA_SEASONS, animeSeasonOf, isOnlySeasonLabel, lowerSeason, mediaSeasonNow, parseSeasonNumber, pickSeasonByEpisodeCount, seasonScopedId, splitSeasonScopedId, upperSeason } from '../../../src/sources/season'

describe('parseSeasonNumber', () => {
  test('reads the forms a title actually uses', () => {
    expect(parseSeasonNumber('Mushoku Tensei Season 3')).toBe(3)
    expect(parseSeasonNumber('Mushoku Tensei Part 2')).toBe(2)
    expect(parseSeasonNumber('Something Cour 2')).toBe(2)
  })

  test('a title that names no season says so', () => {
    expect(parseSeasonNumber('Cowboy Bebop')).toBeUndefined()
  })
})

describe('pickSeasonByEpisodeCount', () => {
  test('an exact and unique count picks that season', () => {
    const seasons = [{ seasonNumber: 1, episodeCount: 23 }, { seasonNumber: 2, episodeCount: 12 }]
    expect(pickSeasonByEpisodeCount(seasons, 12)).toBe(2)
    expect(pickSeasonByEpisodeCount(seasons, 23)).toBe(1)
  })

  // This asked for 22 against seasons of 23 and 12 and was answered season 1. It is the shape that
  // welded runs, and it is not a near miss to be forgiven: Netflix splits Fullmetal Alchemist's one
  // 64 episode run into five seasons of about 13, so "nearest" answers 13 for a target of 64.
  test('a near miss is a refusal, never the nearest season anyway', () => {
    const seasons = [{ seasonNumber: 1, episodeCount: 23 }, { seasonNumber: 2, episodeCount: 12 }]
    expect(pickSeasonByEpisodeCount(seasons, 22)).toBeUndefined()
    expect(pickSeasonByEpisodeCount(seasons, 64)).toBeUndefined()
  })

  // The defect this function shipped with: `if (diff < best.diff)` kept the FIRST of a tie, so two of
  // our runs of 24 episodes both received season 1 and union-find welded them. 48 of 105 measured runs
  // hit a tie, so this is the common case rather than the corner.
  test('two seasons of the same length are a refusal, not the first of them', () => {
    const seasons = [{ seasonNumber: 1, episodeCount: 24 }, { seasonNumber: 2, episodeCount: 24 }]
    expect(pickSeasonByEpisodeCount(seasons, 24)).toBeUndefined()
  })

  // one season is not a choice, and answering anyway would report a season the caller never asked about
  test('a single season is not chosen between', () => {
    expect(pickSeasonByEpisodeCount([{ seasonNumber: 1, episodeCount: 12 }], 12)).toBeUndefined()
    expect(pickSeasonByEpisodeCount([], 12)).toBeUndefined()
  })
})

describe('seasonScopedId', () => {
  test('every season of one show gets a DISTINCT id, or clustering merges them', () => {
    const ids = [1, 2, 3].map(season => seasonScopedId('94664', season))
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual(['94664-s1', '94664-s2', '94664-s3'])
  })

  test('round-trips, so resolving the uri still asks TMDB for a show it knows', () => {
    expect(splitSeasonScopedId(seasonScopedId('94664', 3))).toEqual({ showId: '94664', seasonNumber: 3 })
  })

  test('a show-level id is passed through whole', () => {
    expect(splitSeasonScopedId('94664')).toEqual({ showId: '94664' })
  })

  // '94664-s3e1' is an EPISODE id and must not be mistaken for a season-scoped media id
  test('an episode id is not season-scoped', () => {
    expect(splitSeasonScopedId('94664-s3e1')).toEqual({ showId: '94664-s3e1' })
  })
})

// Counted over 4159 real AniList and ani.zip titles, the English prefix form is only 176 of the 438
// titles that name a season at all. The rest read as ordinary title words until now.
describe('parseSeasonNumber, non-English forms', () => {
  test('reads the English ordinal form', () => {
    expect(parseSeasonNumber('Sousou no Frieren 2nd Season')).toBe(2)
    expect(parseSeasonNumber('Tensei Shitara Slime Datta Ken 4th Season')).toBe(4)
    expect(parseSeasonNumber('Kanojo Okarishimasu 1st Season')).toBe(1)
    expect(parseSeasonNumber('Osomatsu-san 3rd Season')).toBe(3)
  })

  test('reads the CJK forms, including Chinese numerals', () => {
    expect(parseSeasonNumber('転生したら剣でした 第2期')).toBe(2)
    expect(parseSeasonNumber('幼女战记 第二季')).toBe(2)
    expect(parseSeasonNumber('小书痴的下克上 第四季')).toBe(4)
    expect(parseSeasonNumber('おでかけ子ザメ シーズン2')).toBe(2)
    expect(parseSeasonNumber('전생했더니 슬라임이었던 건에 대하여 4기')).toBe(4)
    expect(parseSeasonNumber('Youjo Senki S2')).toBe(2)
  })

  // Found by comparing this grammar against sacha's over 2271 real titles: the two disagreed on
  // exactly these two, and sacha was right. The prefix pattern read straight through the ordinal
  // and took the subtitle's number, so the 4th season was gated as the 2nd.
  test('an ordinal outranks a number that follows the word', () => {
    expect(parseSeasonNumber('Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season 2-nensei-hen Ichi Gakki')).toBe(4)
    expect(parseSeasonNumber('ようこそ実力至上主義の教室へ 4th Season 2年生編1学期')).toBe(4)
    // and the plain forms are unchanged, because `Season 4` carries no ordinal to find
    expect(parseSeasonNumber('JUJUTSU KAISEN Season 3: The Culling Game Part 1')).toBe(3)
    expect(parseSeasonNumber('Pokémon Concierge: Season 1: Part 2')).toBe(1)
  })

  test('十 multiplies rather than counting as a digit', () => {
    expect(parseSeasonNumber('なにか 第十期')).toBe(10)
    expect(parseSeasonNumber('なにか 第十二期')).toBe(12)
    expect(parseSeasonNumber('なにか 第二十期')).toBe(20)
  })

  // A season number gates a merge, so inventing one silently blocks two records of one show
  // from ever joining.
  test('does not invent a season', () => {
    expect(parseSeasonNumber('Death Note')).toBeUndefined()
    expect(parseSeasonNumber('Cowboy Bebop')).toBeUndefined()
    // 話 and 集 count episodes
    expect(parseSeasonNumber('進撃の巨人 第1話')).toBeUndefined()
    expect(parseSeasonNumber('鬼滅の刃 第25集')).toBeUndefined()
    // a bare trailing number names nothing: 284 of the 4159 real titles end in one and most are
    // not seasons, so `Kidou Keisatsu Patlabor EZY File 1` must stay season-less
    expect(parseSeasonNumber('Yami Shibai 17')).toBeUndefined()
    expect(parseSeasonNumber('Kidou Keisatsu Patlabor EZY File 1')).toBeUndefined()
  })
})

describe('animeSeasonOf', () => {
  // Local-time constructors, not UTC strings: animeSeasonOf reads getMonth(), so a UTC literal would
  // land in the previous month for any runner west of Greenwich and the boundary cases would flip.
  const on = (year: number, month1: number, day: number) => new Date(year, month1 - 1, day)

  // Every seasonal source reads this, so a disagreement here would put two different catalogues on
  // one page. The quarter boundaries are the part worth pinning.
  test('each calendar quarter is its season', () => {
    expect(animeSeasonOf(on(2026, 1, 1)).season).toBe('winter')
    expect(animeSeasonOf(on(2026, 3, 31)).season).toBe('winter')
    expect(animeSeasonOf(on(2026, 4, 1)).season).toBe('spring')
    expect(animeSeasonOf(on(2026, 6, 30)).season).toBe('spring')
    expect(animeSeasonOf(on(2026, 7, 1)).season).toBe('summer')
    expect(animeSeasonOf(on(2026, 9, 30)).season).toBe('summer')
    expect(animeSeasonOf(on(2026, 10, 1)).season).toBe('fall')
    expect(animeSeasonOf(on(2026, 12, 31)).season).toBe('fall')
  })

  test('the year comes from the same date', () => {
    expect(animeSeasonOf(on(2026, 8, 16))).toEqual({ season: 'summer', year: 2026 })
    expect(animeSeasonOf(on(2025, 12, 31))).toEqual({ season: 'fall', year: 2025 })
  })

  // Four names, four quarters. A fifth or a gap would make Math.floor(month / 3) index off the end.
  test('every month maps to one of the four seasons', () => {
    const seasons = new Set(
      Array.from({ length: 12 }, (_, month) => animeSeasonOf(on(2026, month + 1, 15)).season)
    )
    expect(seasons).toEqual(new Set(['winter', 'spring', 'summer', 'fall']))
  })
})

// Two spellings of four seasons, one for the catalogues and one for the schema enum, with these two
// functions as the only bridge. A third spelling, or a bridge that quietly drops one name, files a
// season's whole catalogue under the wrong season or under none.
describe('the lower-case and schema spellings', () => {
  test('every season round-trips in both directions', () => {
    expect(ANIME_SEASONS.map(upperSeason)).toEqual([...MEDIA_SEASONS])
    for (const season of ANIME_SEASONS) expect(lowerSeason(upperSeason(season))).toBe(season)
    for (const season of MEDIA_SEASONS) expect(upperSeason(lowerSeason(season)!)).toBe(season)
  })

  test('lowerSeason reads either case', () => {
    expect(lowerSeason('SUMMER')).toBe('summer')
    expect(lowerSeason('summer')).toBe('summer')
    expect(lowerSeason('Summer')).toBe('summer')
  })

  // It converts what a caller claims is a season, so a string it cannot place has to come back as
  // nothing rather than as a season: the value goes on to pick which catalogue page is fetched.
  test('lowerSeason refuses a string that names no season', () => {
    expect(lowerSeason('AUTUMN')).toBeUndefined()
    expect(lowerSeason('SUMMER 2026')).toBeUndefined()
    expect(lowerSeason('')).toBeUndefined()
  })
})

describe('mediaSeasonNow', () => {
  // Local-time constructors for the same reason animeSeasonOf's tests use them: getMonth() is local.
  const on = (year: number, month1: number, day: number) => new Date(year, month1 - 1, day)

  // The clock reaches the schema through two paths (this, and animeSeasonOf plus upperSeason), and a
  // disagreement between them puts two different catalogues on one page.
  test('names the same season animeSeasonOf does, in each of the four quarters', () => {
    const quarters = [
      [on(2026, 2, 14), 'WINTER'],
      [on(2026, 5, 14), 'SPRING'],
      [on(2026, 8, 14), 'SUMMER'],
      [on(2026, 11, 14), 'FALL'],
    ] as const
    for (const [date, expected] of quarters) {
      expect(mediaSeasonNow(date)).toEqual({ season: expected, year: 2026 })
      expect(mediaSeasonNow(date).season).toBe(upperSeason(animeSeasonOf(date).season))
    }
  })

  test('the year comes from the date it was handed', () => {
    expect(mediaSeasonNow(on(2025, 12, 31))).toEqual({ season: 'FALL', year: 2025 })
  })
})

/**
 * A title that names a POSITION and never a show has to be recognised in the spellings sources
 * actually use, abbreviations included.
 *
 * `Pt.` cost a whole source before it was known here. Measured 2026-09-14 on Re:Zero's 2026 run: a
 * member carried `Season 2, Pt. 2`, which survived this filter because the residue `, Pt. 2` still has
 * letters in it. The run's evidence then carried season ordinals 2 AND 4, and `pickContainingSeason`
 * refuses outright when the titles disagree about which season the run is, so Netflix answered nothing
 * for the page: 0 Netflix episode links in the rendered modal against 52 once the abbreviation was
 * known.
 */
describe('isOnlySeasonLabel', () => {
  test('the abbreviated spellings count, which is what a real catalogue writes', () => {
    expect(isOnlySeasonLabel('Season 2, Pt. 2'), 'the measured one').toBe(true)
    expect(isOnlySeasonLabel('Season 2, Pt 2'), 'and without the point').toBe(true)
    expect(isOnlySeasonLabel('Pt. 2')).toBe(true)
    // the spellings that already worked, so a rewrite of the pattern cannot quietly lose them
    expect(isOnlySeasonLabel('Season 2 Part 2')).toBe(true)
    expect(isOnlySeasonLabel('Season 3')).toBe(true)
    expect(isOnlySeasonLabel('Cour 2')).toBe(true)
    expect(isOnlySeasonLabel('2nd Season')).toBe(true)
  })

  test('THE CONTROL: a real title is never one, however much season it carries', () => {
    expect(isOnlySeasonLabel('Re:Zero kara Hajimeru Isekai Seikatsu 4th Season')).toBe(false)
    expect(isOnlySeasonLabel('Grand Blue Dreaming Season 3')).toBe(false)
    // the trap the abbreviation opens: a show whose NAME ends in something Pt-shaped
    expect(isOnlySeasonLabel('Ptolemy 2')).toBe(false)
    expect(isOnlySeasonLabel('Cowboy Bebop')).toBe(false)
  })
})
