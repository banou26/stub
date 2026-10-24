import type { FetchInit } from '../src/worker/backoff'

import { cloud } from '@fkn/lib'

import { parseSeasonKey } from '../src/sources/offline/normalize'
import { mediaSeasonNow } from '../src/sources/season'

import BEBOP from './fixtures/credits/anilist-bebop.json'
import BREAKING_BAD from './fixtures/credits/imdb-breaking-bad.json'
import BEBOP_MAL_CREDITS from './fixtures/credits/mal-bebop.html?raw'
import FRIEREN_THEMES from './fixtures/themes/animethemes-frieren.json'
import POPULAR_MOVIES from './fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from './fixtures/justwatch/popular-shows.json'
import PRIME_COUNTRIES from './fixtures/justwatch/prime-countries.json'
import FRIEREN_SEASONS from './fixtures/tmdb/seasons-frieren.html?raw'
import SQUID_GAME_SEASONS from './fixtures/tmdb/seasons-squid-game.html?raw'
import FRIEREN_SHOW from './fixtures/tmdb/show-frieren.html?raw'
import SQUID_GAME_SHOW from './fixtures/tmdb/show-squid-game.html?raw'
import BEBOP_MAL from './unit/sources/jikan/__fixtures__/mal-anime-1.html?raw'
import WATCHMODE_BREAKING_BAD from './unit/sources/watchmode/__fixtures__/quick-search-breaking-bad.json'

const FRIEREN_IDS = { themoviedb_id: '209867', thetvdb_id: 424536, imdb_id: 'tt22248376' }

const many = <T>(count: number, make: (number: number) => T) => Array.from({ length: count }, (_, index) => make(index + 1))

const SEQUEL = { id: 900001, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Sequel' }, description: 'The journey goes on. '.repeat(100) }
// with the description and facts only AniList gives
const LATE = {
  id: 900010, idMal: 900010, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Late', native: 'スペック・レイト' },
  description: 'It comes late. '.repeat(60), duration: 24, source: 'MANGA', genres: ['Drama', 'Mystery', 'Psychological'], tags: many(30, number => ({ name: `Spec Tag ${number}` })),
}
const THIRD = { id: 900002, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Third' }, description: 'And on again. '.repeat(80) }

const SEQUEL_CREDITS = {
  characters: { edges: many(14, number => ({ role: 'SUPPORTING', node: { id: 900100 + number, name: { full: `Sequel Character ${number}` } }, voiceActors: [] })) },
  staff: { edges: many(14, number => ({ role: 'Key Animation', node: { id: 900200 + number, name: { full: `Sequel Animator ${number}` } } })) },
  studios: { nodes: [] },
}
const SEQUEL_RELATIONS = [
  { relationType: 'SEQUEL', node: THIRD },
  ...many(3, number => ({ relationType: 'SIDE_STORY', node: { id: 900002 + number, type: 'ANIME', format: 'OVA', status: 'FINISHED', title: { english: `Spec Side Story ${number}` } } })),
]
// The Apothecary Diaries season 3's relations as AniList names them, 2026-10-17: a prequel, a sequel and three more that
// play, and the novel and manga it adapts, which do not; and One Piece's 61 related works that play
const APOTHECARY = { id: 900020, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'The Apothecary Diaries Season 3' } }
const APOTHECARY_RELATIONS = ([
  ['ADAPTATION', 'NOVEL', 'The Apothecary Diaries'],
  ['PREQUEL', 'TV', 'The Apothecary Diaries Season 2'],
  ['SEQUEL', 'TV', 'Kusuriya no Hitorigoto 3rd Season Part 2'],
  ['SIDE_STORY', 'MOVIE', 'The Apothecary Diaries: The Late Lady’s Treasure'],
  ['ALTERNATIVE', 'MANGA', 'The Apothecary Diaries'],
  ['OTHER', 'MUSIC', 'AIYOU'],
  ['OTHER', 'MUSIC', 'Beyond the Clouds, Only Me Downwind'],
] as const).map(([relationType, format, english], index) => ({ relationType, node: { id: 900021 + index, type: 'ANIME', format, status: 'FINISHED', title: { english } } }))
const ONE_PIECE = { id: 900030, type: 'ANIME', format: 'TV', status: 'RELEASING', title: { english: 'One Piece' } }
// a weekly show AniList schedules from its 4th episode, a day after it is asked, and AniZip lists undated from there
const AIRING = { id: 900080, idMal: 900080, type: 'ANIME', format: 'TV', status: 'RELEASING', title: { english: 'Spec Airing' } }
const airsAt = (episode: number) => Math.floor(Date.now() / 1000) + ((episode - 4) * 7 + 1) * 86_400
// a film AniList and MyAnimeList date by its year alone, as they do ONE PIECE FILM: GOD VALLEY (2026-10-17)
const YEAR_FILM = { id: 900100, idMal: 900100, type: 'ANIME', format: 'MOVIE', status: 'NOT_YET_RELEASED', title: { english: 'Spec Year Film' }, startDate: { year: 2099, month: null, day: null } }
const YEAR_FILM_MAL = `<h1 class="title-name h1_bold_none"><strong>Spec Year Film</strong></h1>
<p itemprop="description">A film MyAnimeList describes.</p>
<div><span class="dark_text">Type:</span> Movie</div>
<div><span class="dark_text">Status:</span> Not yet aired</div>
<div><span class="dark_text">Aired:</span> 2099</div>`
// a description carrying a script, an image's onerror, a handler, a javascript: link, a style attribute, a style
// sheet and a form among AniList's formatting and a remote image
const UNSAFE = {
  id: 900110, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Unsafe' },
  description: '<p>A <i style="color:red">quiet</i> <b>town</b>.<br>Its <a href="https://anilist.co/anime/1">sequel</a>, <a href="javascript:window.ran=\'link\'">a link</a> and <span onmouseover="window.ran=\'handler\'">a span</span>.</p>'
    + '<img src="https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg" alt=""><img src="x" onerror="window.ran=\'onerror\'"><script>window.ran=\'script\'</script>'
    + '<style>.description{color:red}</style><form action="https://e.example/collect"></form>',
}
const ONE_PIECE_RELATIONS = many(61, number => ({ relationType: number % 4 ? 'SIDE_STORY' : 'SUMMARY', node: { id: 900030 + number, type: 'ANIME', format: 'SPECIAL', status: 'FINISHED', title: { english: `One Piece Special ${number}` } } }))
// a page of relations and more, each title two lines on a card, as most are
const LATE_RELATIONS = many(4, number => ({ relationType: 'SIDE_STORY', node: { id: 900010 + number, type: 'ANIME', format: 'OVA', status: 'FINISHED', title: { english: `Spec Late Side Story ${number}: The Long Way Round` } } }))
const RATED = { id: 900040, idMal: 900040, type: 'ANIME', format: 'TV', status: 'FINISHED', episodes: 26, startDate: { year: 2023, month: 9, day: 29 }, averageScore: 82, title: { english: 'Spec Rated' } }
// JustWatch's show of it, with the four ratings it gives: its first season, and a second one listed with no episodes yet
const RATED_NODE = {
  id: 'ts900040', objectId: 900040, objectType: 'SHOW', offers: [],
  content: { title: 'Spec Rated', fullPath: '/us/tv-show/spec-rated', posterUrl: null, shortDescription: null, scoring: { imdbScore: 8, tmdbScore: 8.727, tomatoMeter: 92, jwRating: 0.95 } },
  seasons: [
    { objectId: 900041, totalEpisodeCount: 26, content: { seasonNumber: 1, isReleased: true, originalReleaseYear: 2023 }, episodes: [] },
    { objectId: 900042, totalEpisodeCount: 0, content: { seasonNumber: 2, isReleased: false }, episodes: [] },
  ],
}
// a film, and JustWatch's node of it with its TMDB id and seven services that link out, so its chips run past a phone's
// width
const FILM = {
  id: 900050, type: 'ANIME', format: 'MOVIE', status: 'FINISHED', title: { english: 'Spec Film' },
  description: 'A summer, a forest and a sea that should not be there. '.repeat(8), startDate: { year: 2018, month: 8, day: 17 },
}
const FILM_OFFERS = {
  tbv: 'https://tubitv.com/movies/900051',
  plx: 'https://watch.plex.tv/movie/spec-film?utm_content=5d77708f594b2b001e74d1ea',
  hop: 'https://www.hoopladigital.com/title/900052',
  rkc: 'https://therokuchannel.roku.com/details/900053',
  ptv: 'https://pluto.tv/on-demand/movies/5d77708f594b2b001e74d1eb',
  hdv: 'https://www.hidive.com/interstitial/900054',
  phl: 'https://www.philo.com/player/show/900055',
}
const FILM_NODE = {
  id: 'tm900050', objectId: 900050, objectType: 'MOVIE',
  content: { title: 'Spec Film', fullPath: '/us/movie/spec-film', originalReleaseYear: 2018, posterUrl: null, shortDescription: null, externalIds: { tmdbId: '900050' } },
  offers: Object.entries(FILM_OFFERS).map(([shortName, standardWebURL]) => ({ monetizationType: 'FREE', standardWebURL, package: { shortName } })),
}
// a film JustWatch finds on Prime Video's Japanese site, which stub plays for a viewer in Japan, and on Tubi
const PRIME_FILM = { ...FILM, id: 900070, title: { english: 'Spec Prime Film' } }
const PRIME = 'https://watch.amazon.co.jp/detail?gti=amzn1.dv.gti.900070'
const PRIME_FILM_NODE = {
  ...FILM_NODE, id: 'tm900070', objectId: 900070, content: { ...FILM_NODE.content, externalIds: null, title: PRIME_FILM.title.english, fullPath: '/us/movie/spec-prime-film' },
  offers: [
    { monetizationType: 'FLATRATE', standardWebURL: PRIME, deeplinkURL: PRIME, package: { shortName: 'amp' } },
    { monetizationType: 'FREE', standardWebURL: 'https://tubitv.com/movies/900071', package: { shortName: 'tbv' } },
  ],
}
// a film only JustWatch knows a place to watch, answered after every other source's 30 s bound
const LATE_FILM = { ...FILM, id: 900060, title: { english: 'Spec Late Film' } }
const LATE_FILM_NODE = {
  ...FILM_NODE, id: 'tm900060', objectId: 900060, content: { ...FILM_NODE.content, externalIds: null, title: LATE_FILM.title.english, fullPath: '/us/movie/spec-late-film' },
  offers: [{ monetizationType: 'FREE', standardWebURL: 'https://tubitv.com/movies/900061', package: { shortName: 'tbv' } }],
}
const JUSTWATCH = [[RATED, RATED_NODE], [FILM, FILM_NODE], [PRIME_FILM, PRIME_FILM_NODE], [LATE_FILM, LATE_FILM_NODE]] as const
const SEQUEL_THEMES = {
  data: {
    findAnimeByExternalSite: [{
      id: SEQUEL.id,
      slug: 'spec_sequel',
      animethemes: many(14, number => ({
        type: 'OP',
        sequence: number,
        song: { title: { romaji: `Sequel Song ${number}`, native: null }, performances: [{ artist: { name: { main: 'Spec Band' } } }] },
        animethemeentries: [{ videos: { nodes: [{ link: `https://v.animethemes.moe/SpecSequel-OP${number}.webm` }] } }],
      })),
    }],
  },
}

const THEMES = structuredClone(FRIEREN_THEMES)
THEMES.data.findAnimeByExternalSite[0]!.animethemes[2]!.animethemeentries = []

const TMDB: Record<string, string> = {
  '/tv/93405': SQUID_GAME_SHOW,
  '/tv/93405/seasons': SQUID_GAME_SEASONS,
  '/tv/93405/season/1': '<div class="card" data-episode-number="1"><h3><a href="#">Red Light, Green Light</a></h3><span class="date">September 17, 2021</span></div>',
  '/tv/93405/season/2': '<div class="card" data-episode-number="1"><h3><a href="#">Bread and Lottery</a></h3><span class="date">December 26, 2024</span></div>',
  '/tv/209867': FRIEREN_SHOW,
  '/tv/209867/seasons': FRIEREN_SEASONS,
}

// What tests/title-page.spec.ts builds the app with in place of src/utils/fetch.ts: AniList's public
// API answers every work with Cowboy Bebop's credits and one sequel, Spec Sequel (anilist:900001), whose
// own characters, staff, relations and songs each run past a page, AniZip with 26 dated episodes (1,100
// for mal:21) and Frieren's TMDB, TheTVDB and IMDb ids, AnimeThemes with Frieren's themes, bliss without
// its video, so no title, cover or date changes under the page, IMDb with Breaking Bad for tt0903747
// alone, and TMDB with Squid Game's three seasons and Frieren's one, each season's own page empty but
// Squid Game's first two, which list one episode each, JustWatch with its four most popular films or shows
// when asked for either, those carrying a genre asked when asked any, and with The Boys as it answered the
// countries asked (prime-countries.json), MyAnimeList with Cowboy Bebop's title and credits pages for mal:1,
// and Watchmode with its quick search for "breaking bad" as recorded 2026-10-13; every other request goes where
// it always went. AniList gives a bundled work the format and season of its record in the current season, or
// else of its first record, so a film stays a film and a work stays in the season the home page lists, and
// answers Spec Late (anilist:900010, mal:900010) five seconds late, with its description, facts and four relations,
// so its page draws AniZip's title and episodes first; AniZip names Spec Late's AniList id, as api.ani.zip names a
// work's, so its MAL address reaches AniList too.
// AniList names The Apothecary Diaries season 3's relations for anilist:900020, and One Piece's for anilist:900030,
// and AniList and MyAnimeList date Spec Year Film (anilist:900100, mal:900100) by its year alone.
// AniList describes Spec Unsafe (anilist:900110) with a script, an onerror, a handler, a javascript: link, a style
// attribute, a style sheet and a form, and a remote image.
// AniList schedules Spec Airing (anilist:900080, mal:900080) from its 4th episode a day out, weekly, when asked for
// its schedule, and AniZip dates its first 3 episodes and lists 4 to 6 undated.
// AniList answers Spec Rated (anilist:900040, mal:900040) with its score, and JustWatch finds its show by that title and
// answers it five seconds later, with four ratings. AniList answers Spec Film (anilist:900050), a film with a description
// and one relation, and JustWatch finds its film by that title and answers it five seconds later, with its TMDB id and
// seven offers;
// Spec Prime Film (anilist:900070) the same, with Prime Video on amazon.co.jp and Tubi, and Spec Late Film
// (anilist:900060) with Tubi alone, forty seconds later.
export const fetch = async (input: RequestInfo | URL, init?: FetchInit) => {
  const malId = typeof input === 'string' ? input.match(/^https:\/\/api\.ani\.zip\/mappings\?mal_id=(\d+)/)?.[1] : undefined
  if (malId) {
    // api.ani.zip's answer for an id it does not know, as for a film not out yet
    if (malId === String(YEAR_FILM.idMal)) return Response.json('Not Found')
    const airing = malId === String(AIRING.idMal)
    const count = malId === '21' ? 1100 : airing ? 6 : 26
    const episodes = Object.fromEntries(Array.from({ length: count }, (_, index) => [index + 1, { title: { en: `Session ${index + 1}: Misunderstandings` }, airdate: airing && index >= 3 ? '' : '2023-09-29' }]))
    const late = malId === String(LATE.idMal)
    return Response.json({ titles: late ? { en: LATE.title.english } : {}, episodes, episodeCount: count, mappings: { anidb_id: Number(malId), mal_id: Number(malId), ...late ? { anilist_id: LATE.id } : {}, type: 'TV', ...FRIEREN_IDS } })
  }
  if (input === 'https://graphql.animethemes.moe/') return Response.json(typeof init?.body === 'string' && JSON.parse(init.body).variables?.id === SEQUEL.id ? SEQUEL_THEMES : THEMES)
  if (input === 'https://myanimelist.net/anime/1') return new Response(BEBOP_MAL)
  if (input === 'https://myanimelist.net/anime/1/_/characters') return new Response(BEBOP_MAL_CREDITS)
  if (input === `https://myanimelist.net/anime/${YEAR_FILM.idMal}`) return new Response(YEAR_FILM_MAL)
  if (input === 'https://apis.justwatch.com/graphql' && typeof init?.body === 'string') {
    const { variables } = JSON.parse(init.body)
    const [objectType] = variables?.searchTitlesFilter?.objectTypes ?? []
    const genres: string[] = variables?.searchTitlesFilter?.genres ?? []
    const popular = objectType === 'MOVIE' ? POPULAR_MOVIES : objectType === 'SHOW' ? POPULAR_SHOWS : undefined
    if (popular) {
      const edges = popular.data.popularTitles.edges.filter(({ node }) => !genres.length || node.content.genres.some(genre => genres.includes(genre.shortName)))
      return Response.json({ data: { popularTitles: { edges } } })
    }
    const theBoys = PRIME_COUNTRIES['the-boys'] as Record<string, unknown>
    if (variables?.nodeId === 'ts78125') return Response.json(theBoys[`${variables.offerCountry},${variables.extraCountry}`] ?? { data: { node: null } })
    const searched = JUSTWATCH.find(([media]) => media.title.english === variables?.searchTitlesFilter?.searchQuery)
    if (searched) return Response.json({ data: { popularTitles: { edges: [{ node: searched[1] }] } } })
    const node = JUSTWATCH.map(([, node]) => node).find(({ id }) => id === variables?.nodeId)
    if (node) {
      await new Promise(resolve => setTimeout(resolve, node === LATE_FILM_NODE ? 40_000 : 5_000))
      return Response.json({ data: { node } })
    }
  }
  if (typeof input === 'string' && input.startsWith('https://gateway.watchmode.com/trpc/gateway.quickSearch?')
    && JSON.parse(new URL(input).searchParams.get('input') ?? '{}')[0]?.json?.q === 'breaking bad') {
    return Response.json([WATCHMODE_BREAKING_BAD])
  }
  if (typeof input === 'string' && input.startsWith('https://www.themoviedb.org/')) return new Response(TMDB[new URL(input).pathname] ?? '')
  if (input === 'https://caching.graphql.imdb.com/' && typeof init?.body === 'string' && JSON.parse(init.body).variables?.id === 'tt0903747') {
    return Response.json(BREAKING_BAD)
  }
  if (input !== 'https://graphql.anilist.co/' || typeof init?.body !== 'string') return cloud.fetch(input, init)
  const { query, variables } = JSON.parse(init.body) as { query: string, variables: { id?: number, idMal?: number } }
  if (query.includes('Page(')) return Response.json({ data: { Page: { pageInfo: { lastPage: 1 }, media: [] } } })
  const { characters, staff, studios } = BEBOP
  const credits = query.includes('characters(') ? { characters, staff, studios } : {}
  if (variables.id === SEQUEL.id) return Response.json({ data: { Media: { ...SEQUEL, ...query.includes('characters(') ? SEQUEL_CREDITS : {}, relations: { edges: SEQUEL_RELATIONS } } } })
  if (variables.id === THIRD.id) return Response.json({ data: { Media: { ...THIRD, ...credits } } })
  if (variables.id === UNSAFE.id) return Response.json({ data: { Media: { ...UNSAFE, ...credits } } })
  if (variables.id === YEAR_FILM.id || variables.idMal === YEAR_FILM.idMal) return Response.json({ data: { Media: { ...YEAR_FILM, ...credits } } })
  for (const [media, edges] of [[APOTHECARY, APOTHECARY_RELATIONS], [ONE_PIECE, ONE_PIECE_RELATIONS]] as const) {
    if (variables.id === media.id) return Response.json({ data: { Media: { ...media, ...credits, relations: { edges } } } })
  }
  const relations = { edges: [{ relationType: 'SEQUEL', node: SEQUEL }] }
  if (variables.id === RATED.id) return Response.json({ data: { Media: { ...RATED, ...credits, relations } } })
  if (variables.id === AIRING.id) {
    const upcoming = query.includes('notYetAired') ? { upcoming: { nodes: [4, 5, 6].map(episode => ({ episode, airingAt: airsAt(episode) })) } } : {}
    return Response.json({ data: { Media: { ...AIRING, ...credits, ...upcoming, nextAiringEpisode: { episode: 4, airingAt: airsAt(4) }, relations } } })
  }
  const film = [FILM, PRIME_FILM, LATE_FILM].find(({ id }) => id === variables.id)
  if (film) return Response.json({ data: { Media: { ...film, ...credits, relations } } })
  if (variables.id === LATE.id) {
    await new Promise(resolve => setTimeout(resolve, 5_000))
    return Response.json({ data: { Media: { ...LATE, ...credits, relations: { edges: LATE_RELATIONS } } } })
  }
  const now = mediaSeasonNow()
  const { seasons } = (await import('../src/generated/anime-seasons')).default
  const listed = Object.entries(seasons).flatMap(([key, records]) =>
    records.filter(record => record.al === variables.id).map(record => ({ format: record.ty, ...parseSeasonKey(key) })))
  const bundled = listed.find(({ season, year }) => season === now.season && year === now.year) ?? listed[0]
  return Response.json({ data: { Media: { id: variables.id, format: bundled?.format, season: bundled?.season, seasonYear: bundled?.year, relations, ...credits } } })
}
