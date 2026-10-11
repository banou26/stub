import { describe, expect, test } from 'vite-plus/test'

import { PACKAGE_ORIGIN_MAP, extractContentId, jwId, providerContentId, showRequiresSeason, splitJwId } from '../../../../src/sources/justwatch/id'
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'

// ts222366 is Mushoku Tensei: one JustWatch node carrying three seasons, whose own objectIds are
// 230388, 378206 and 490814. Every season handing back `jw:222366` is what merged them into one media.
const MUSHOKU = 222366
const SEASONS = [230388, 378206, 490814]

describe('jwId', () => {
  test('every season of one show gets a DISTINCT id, or clustering merges them', () => {
    const ids = SEASONS.map(season => jwId(MUSHOKU, season))
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual(['222366-230388', '222366-378206', '222366-490814'])
  })

  // an ordinal moves when a season is renumbered, split into cours, or has a recap inserted ahead of
  // it; the season's own id does not, so an existing uri keeps pointing at the same episodes
  test("the suffix is the season's own id, not its position", () => {
    expect(jwId(MUSHOKU, 490814)).toBe('222366-490814')
    expect(jwId(MUSHOKU, 490814)).not.toBe('222366-3')
  })
})

describe('splitJwId', () => {
  // resolving `jw:222366-490814` has to end up asking JustWatch for node ts222366 and then keeping
  // the season whose objectId is 490814 - the id is the only place that season survives
  test('a season-scoped id resolves back to the node AND the season', () => {
    expect(splitJwId(jwId(MUSHOKU, 490814))).toEqual({ objectId: '222366', seasonObjectId: 490814 })
    expect(splitJwId('222366-230388')).toEqual({ objectId: '222366', seasonObjectId: 230388 })
  })

  test('a movie id has no season and is passed through whole', () => {
    expect(splitJwId('222366')).toEqual({ objectId: '222366' })
  })

  test('anything not <digits>-<digits> is left alone rather than half-parsed', () => {
    expect(splitJwId('222366-3-4')).toEqual({ objectId: '222366-3-4' })
    expect(splitJwId('tm12345')).toEqual({ objectId: 'tm12345' })
  })
})

describe('showRequiresSeason', () => {
  test('a series has no identity without a season, so it is not emitted without one', () => {
    expect(showRequiresSeason('SHOW')).toBe(true)
    // the search query does not fetch seasons, so its series results have no season to give
    expect(showRequiresSeason(undefined)).toBe(true)
  })

  test('a movie has no seasons to be confused between, so its bare node id is exact', () => {
    expect(showRequiresSeason('MOVIE')).toBe(false)
  })
})

describe('providerContentId', () => {
  // The id used to take a season suffix here, `95e491fa-cdad-2` and `80987039-3` and `<umc>-s2`, which
  // wrote JUSTWATCH'S season number into the provider's id space. unogs and the appletv source mint the
  // same shapes with the provider's own numbering, and Netflix folds two anime cours into one season, so
  // its season 2 and JustWatch's season 2 named different runs under one uri. The season is the
  // answering source's to name, through `similarMedia`; what this reads off a show-level url is the
  // provider's TITLE, and the extractor hangs the run under it as PART_OF.
  test('a provider series id is the bare title whatever the season, because the season is the answering source\'s to name', () => {
    // hulu.com/series/<uuid> is the same uuid for season 2 and season 3, and so is the id now
    expect(providerContentId('hulu', '95e491fa-cdad')).toBe('95e491fa-cdad')
    expect(providerContentId('nf', '80987039')).toBe('80987039')
    expect(providerContentId('nf', '80987039'), 'no numbering of anyone\'s survives in the id').not.toMatch(/-s?\d+$/)
  })

  // This used to spell JustWatch's ordinal the way the appletv source spells Apple's (`<umc>-s2`), so
  // the two numberings met in one id space. The umc id alone is the show, which is what the appletv
  // source itself mints for one, and the season is that source's to name.
  test('appletv is the bare umc id, the show the appletv source itself mints', () => {
    expect(providerContentId('appletv', 'umc.cmc.2vru12c9n7324q0tdk324i0f')).toBe('umc.cmc.2vru12c9n7324q0tdk324i0f')
  })

  test('a film id is bare, and exact', () => {
    expect(providerContentId('hulu', '95e491fa-cdad')).toBe('95e491fa-cdad')
    expect(providerContentId('nf', '81744420')).toBe('81744420')
  })

  // This used to end `expect(providerContentId('cr', 'G24H1N3MP')).toBe('G24H1N3MP')`, pinning the
  // seasonless case as correct. It was not: `extractContentId` reads a crunchyroll id from `/series/`
  // urls and nothing else, so every id arriving here names a SERIES, and a series page holds every run
  // of the show plus, on Crunchyroll, the show's films. The refusal sat below the seasonless early
  // return, so the one case that reaches here without a season, a MOVIE, walked straight past it and
  // took the container id. Measured on kitsu 2026-09-04, the same id from the same urls: four Demon
  // Slayer films share cr:GY5P48XEY and fifteen Dragon Ball Z films share cr:GQWH0M1GG.
  test('crunchyroll gets NO handle', () => {
    // the crunchyroll source mints '<seriesId>-<seasonId>' (G24H1N3MP-GRDQCGX5E), so a bare series id
    // would cluster with nothing, and it is not a fallback either: it is the container
    expect(providerContentId('cr', 'G24H1N3MP')).toBeUndefined()
    expect(providerContentId('cr', 'GY5P48XEY')).toBeUndefined()
  })
})

// Every url below is a REAL offer url, captured from the JustWatch api on 2026-09-01 by
// scripts/measure-justwatch-offer-ids.mjs. They are here rather than invented because the whole class
// of bug this pins is "the provider restyled its site and the id we read moved", which an invented
// url cannot express: it would be written to match whatever the function already does.
describe('extractContentId, against real offer urls', () => {
  test('netflix names the title in the path, and both tiers link the same way', () => {
    expect(extractContentId('https://www.netflix.com/title/81744420')).toBe('81744420')
    expect(extractContentId('https://www.netflix.com/title/70105699')).toBe('70105699')
  })

  test('prime video moved to watch.amazon.com with the id in a query param', () => {
    // the old host test was `startsWith('amazon.')`, which watch.amazon.com fails, and the old path
    // read would have returned the literal "detail" for every prime video title
    expect(extractContentId('https://watch.amazon.com/detail?gti=amzn1.dv.gti.14b575f2-7d6d-6bce-4709-2cb8bb8874f4'))
      .toBe('amzn1.dv.gti.14b575f2-7d6d-6bce-4709-2cb8bb8874f4')
  })

  test('apple tv gives the umc id, never the slug, and an episode names its show', () => {
    expect(extractContentId('https://tv.apple.com/us/movie/spirited/umc.cmc.3lp7wqowerzdbej98tveildi3?at=1000l3V2'))
      .toBe('umc.cmc.3lp7wqowerzdbej98tveildi3')
    // an episode url: the slug is the EPISODE's, and episode slugs repeat across shows, so the showId
    // query param is the only part of it worth minting a handle from
    expect(extractContentId('https://tv.apple.com/us/episode/the-starting-gate/umc.cmc.1qefhfibeor9m74fp1mo0dnf6?playableId=tvs.sbd.4000:A0121901001&showId=umc.cmc.2vru12c9n7324q0tdk324i0f'))
      .toBe('umc.cmc.2vru12c9n7324q0tdk324i0f')
  })

  test('disney+ moved to /browse/entity-<id>, which the old path read missed entirely', () => {
    expect(extractContentId('https://www.disneyplus.com/browse/entity-36ae14b1-c6f1-4271-a4cf-c9107f52957b'))
      .toBe('36ae14b1-c6f1-4271-a4cf-c9107f52957b')
    expect(extractContentId('https://www.disneyplus.com/play/f63874ef-939f-4a16-8fc0-043f3169f664'))
      .toBe('f63874ef-939f-4a16-8fc0-043f3169f664')
  })

  test('peacock names the SHOW mid-path on a series url and the movie last on a movie one', () => {
    expect(extractContentId('https://www.peacocktv.com/watch/asset/tv/parks-and-recreation/5883799404534408112/seasons/1/episodes/pilot-episode-1/04569a08-33e0-3835-9a21-76af2e31fa69'))
      .toBe('5883799404534408112')
    expect(extractContentId('https://www.peacocktv.com/watch/asset/movies/five-nights-at-freddys/d34768be-b99a-3b00-80b8-1e9253f7675e'))
      .toBe('d34768be-b99a-3b00-80b8-1e9253f7675e')
  })

  test('paramount+ names the show slug, which is what the paramount source itself mints', () => {
    expect(extractContentId('https://www.paramountplus.com/shows/avatar-the-last-airbender/video/L4FnbPcKqvTy_2nulIOWpsG1RWbgvibX/avatar-the-southern-air-temple'))
      .toBe('avatar-the-last-airbender')
  })

  test('fubo names the series id after /welcome/series', () => {
    expect(extractContentId('https://www.fubo.tv/welcome/series/113772324/hunter/?irmp=1206980&season=1')).toBe('113772324')
    expect(extractContentId('https://www.fubo.tv/welcome/program/MV001000000000?irmp=1206980')).toBe('MV001000000000')
  })

  // The regression this file exists for. Reading a fixed index out of an HBO series url returns the
  // literal 'watch', so every HBO title lands on `hbo:watch` and union-find merges all of them. It was
  // 25 titles in one 526-title corpus, and graph.link has no inverse.
  test('an hbo series url does NOT yield the literal "watch"', () => {
    expect(extractContentId('https://play.hbomax.com/video/watch/dae9e532-3714-4f2e-b758-fb9a13def902?utm_source=universal_search'))
      .toBe('dae9e532-3714-4f2e-b758-fb9a13def902')
    expect(extractContentId('https://play.hbomax.com/show/00ad6746-f3f0-4f6b-b8ea-0997f5880aa5?utm_source=universal_search'))
      .toBe('00ad6746-f3f0-4f6b-b8ea-0997f5880aa5')

    const series = ['dae9e532-3714-4f2e-b758-fb9a13def902', 'ef7d1c40-2ecc-471a-81a5-7fe06400240a', '8277da02-5ffc-478b-b5ba-a97c63ac3f45']
      .map(id => extractContentId(`https://play.hbomax.com/video/watch/${id}`))
    expect(new Set(series).size, 'three different HBO titles must not share one id').toBe(3)
    expect(series).not.toContain('watch')
  })

  test('an unmapped host yields nothing rather than a stray path segment', () => {
    expect(extractContentId('https://www.kanopy.com/product/justwatch-12235910')).toBeUndefined()
    expect(extractContentId('not a url')).toBeUndefined()
  })
})

// Captured from the JustWatch api on 2026-10-12, over 1,266 popular US titles.
describe('extractContentId, the link-only platforms', () => {
  test('hidive names a video after /interstitial, and a playlist id is another space', () => {
    expect(extractContentId('https://www.hidive.com/interstitial/715215')).toBe('715215')
    expect(extractContentId('https://www.hidive.com/playlist/19919')).toBeUndefined()
  })

  test('tubi keeps a series apart from a film that could share its number', () => {
    expect(extractContentId('https://tubitv.com/movies/465330')).toBe('465330')
    expect(extractContentId('https://tubitv.com/series/300000737/taboo')).toBe('0300000737')
    expect(extractContentId('https://tubitv.com/series/')).toBeUndefined()
    expect(extractContentId('https://tubitv.com/series/naruto')).toBeUndefined()
    expect(extractContentId('https://tubitv.com/live/400000081')).toBeUndefined()
  })

  test('the roku channel names its title after /details', () => {
    expect(extractContentId('https://therokuchannel.roku.com/details/49b3bfb619ab57f7bd19a194f3a0d7e9/the-one-i-love?source=bing'))
      .toBe('49b3bfb619ab57f7bd19a194f3a0d7e9')
    expect(extractContentId('https://therokuchannel.roku.com/browse/movies')).toBeUndefined()
  })

  test('pluto tv gives a title\'s hex id, and nothing for a slug or a channel', () => {
    expect(extractContentId('https://pluto.tv/us/movies/5e972482868ca8001a04ad03/#open')).toBe('5e972482868ca8001a04ad03')
    expect(extractContentId('https://pluto.tv/us/on-demand/series/582bfe2e857920bd1d030c50/season/1')).toBe('582bfe2e857920bd1d030c50')
    expect(extractContentId('https://pluto.tv/us/search/details/movies/5c6c865dbb225fd2ebadbfc3')).toBe('5c6c865dbb225fd2ebadbfc3')
    expect(extractContentId('https://pluto.tv/on-demand/movies/coherence-2014-1-1?utm_medium=deeplink&utm_source=justwatch')).toBeUndefined()
    expect(extractContentId('https://pluto.tv/us/shows/the-twilight-zone/')).toBeUndefined()
    expect(extractContentId('https://pluto.tv/en/live-tv/545943f1c9f133a519bbac92/details/545943f1c9f133a519bbac92')).toBeUndefined()
  })

  test('plex carries its id in utm_content, never in the slug', () => {
    expect(extractContentId('https://watch.plex.tv/movie/the-one-i-love-2014?autoplay=1&utm_content=5d9f3963b0262f001f6ef055&utm_medium=deeplink'))
      .toBe('5d9f3963b0262f001f6ef055')
    expect(extractContentId('https://watch.plex.tv/show/broadchurch/season/1/episode/1?autoplay=1&utm_content=5d9c127b4eefaa001f64475b'))
      .toBe('5d9c127b4eefaa001f64475b')
    expect(extractContentId('https://watch.plex.tv/show/newsradio')).toBeUndefined()
    expect(extractContentId('https://watch.plex.tv/movie/x?utm_content=summer-promo')).toBeUndefined()
  })

  test('hoopla ends on its title id', () => {
    expect(extractContentId('https://www.hoopladigital.com/title/14973116?utm_source=justwatch')).toBe('14973116')
    expect(extractContentId('https://www.hoopladigital.com/television/the-civil-war-ken-burns/10085764')).toBe('10085764')
    expect(extractContentId('https://www.hoopladigital.com/browse/featured')).toBeUndefined()
  })

  test('starz ends on a film\'s id or on its first season\'s', () => {
    expect(extractContentId('https://www.starz.com/us/en/movies/51102')).toBe('51102')
    expect(extractContentId('https://www.starz.com/us/en/series/outlander/season-1/21894')).toBe('21894')
    expect(extractContentId('https://www.starz.com/us/en/series/outlander')).toBeUndefined()
  })

  test('amc+ ends its last segment on the id', () => {
    expect(extractContentId('https://www.amcplus.com/movies/the-one-i-love--1073975')).toBe('1073975')
    expect(extractContentId('https://www.amcplus.com/shows/mad-men/episodes/season-1-smoke-gets-in-your-eyes--1003132')).toBe('1003132')
    expect(extractContentId('https://www.amcplus.com/shows/mad-men/episodes/season-1-episode-2')).toBeUndefined()
  })

  test('philo names films and shows alike after /player/show', () => {
    expect(extractContentId('https://www.philo.com/player/show/U2hvdzo2MDg1NDg4OTk2NDg1MTAxMjk')).toBe('U2hvdzo2MDg1NDg4OTk2NDg1MTAxMjk')
    expect(extractContentId('https://www.philo.com/player/show/U2hvdzo2MDg1NDg4OTk2NDg0Mzg3NTA?episode=RXBpc29kZTo2MDg1NDg4OTk2NDg0NDAyNzA'))
      .toBe('U2hvdzo2MDg1NDg4OTk2NDg0Mzg3NTA')
    expect(extractContentId('https://www.philo.com/player/channel/abc')).toBeUndefined()
  })
})

describe('PACKAGE_ORIGIN_MAP', () => {
  // `provenanceOf` reads a JustWatch claim outside this set as an echo of the asked address
  test('every origin an offer can name is one JustWatch publishes', () => {
    expect(Object.values(PACKAGE_ORIGIN_MAP).filter(origin => !NATIVE_ID_SPACES.jw!.has(origin))).toEqual([])
  })

  test('one service can hold several tiers, and they all name the same origin', () => {
    expect(PACKAGE_ORIGIN_MAP.nfx).toBe('nf')
    expect(PACKAGE_ORIGIN_MAP.nfa).toBe('nf')
    expect(PACKAGE_ORIGIN_MAP.ppp).toBe('paramount')
    expect(PACKAGE_ORIGIN_MAP.ppe).toBe('paramount')
    expect(PACKAGE_ORIGIN_MAP.pcp).toBe('peacock')
    expect(PACKAGE_ORIGIN_MAP.pct).toBe('peacock')
  })

  test('the renamed services are mapped under the names JustWatch actually returns', () => {
    // hbm and pmp returned ZERO offers in 25 anime searches: HBO Max is mxx and Paramount+ split in two
    expect(PACKAGE_ORIGIN_MAP.hbm).toBeUndefined()
    expect(PACKAGE_ORIGIN_MAP.pmp).toBeUndefined()
    expect(PACKAGE_ORIGIN_MAP.mxx).toBe('hbo')
  })

  test('a resale channel is not its underlying service', () => {
    // "Crunchyroll Amazon Channel" outnumbers Crunchyroll itself, but plays on watch.amazon.com, so a
    // cr handle minted from it would assert an identity no crunchyroll call can reproduce
    expect(PACKAGE_ORIGIN_MAP.cra).toBeUndefined()
    expect(PACKAGE_ORIGIN_MAP.app).toBeUndefined()
    expect(PACKAGE_ORIGIN_MAP.aho).toBeUndefined()
  })
})
