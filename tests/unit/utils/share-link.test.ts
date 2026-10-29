import { describe, expect, test } from 'vite-plus/test'

import { expandPath, shortenPath, SHORT_PATH } from '../../../src/utils/share-link'

// HOR-1065's own example, then 25 real links from stub's tests and notes (research, 2026-10-29)
const ISSUE = '/watch/ag:(anilist:212888,anizip:20077,cr:GT00384004-GS00384033,jw:531364-569977,kitsu:50743,mal:64340,nf:82948047-1,nyaa:20077,offline:mal-64340,simkl:3140896)/ag:(amazon:amzn1.dv.gti.8e2d12cc-fec9-458d-975d-2c39a2337794,anizip:20077-1,cr:GT00384004-GS00384033-GE00384228JAJP,disney:e4fcfbfe-1b00-465e-ad8e-0c0c9f44a9db,jw:10465255,kitsu:403761,nf:82948050,nyaa:2166871,nyaa:2166873,nyaa:2166874,nyaa:2166875,nyaa:2166876,nyaa:2166877,nyaa:2166878,nyaa:2166879,nyaa:2166884,nyaa:2166885,nyaa:2166886,nyaa:2166939,nyaa:2166999,nyaa:2167013,nyaa:2167587,nyaa:2167956,nyaa:2168865,nyaa:2169794,nyaa:2169816,simkl:3140896-s1e1)/nyaa:2166874?plugins=https:stub.plugins.banou.dev'
const CORPUS = [
  ISSUE,
  '/watch/ag:(anilist:207141,anizip:19873,jw:518630-563252,kitsu:50551,mal:63403,nf:82760630-1,nyaa:19873,offline:mal-63403,tvmaze:92274-s1)/ag:(anizip:19873-5,jw:10560899,kitsu:394560,nf:82760636,nyaa:2139402,nyaa:2139482,tvmaze:3668029)/nyaa:2139402?plugins=https:stub.plugins.banou.dev',
  '/watch/ag:(anilist:101249,anizip:13853,hoopla:12418002,jw:403680,kitsu:41007,mal:37407,nf:81037598,offline:mal-37407,plex:5d77708f594b2b001e74d1ea,simkl:774239,tubi:590793)/ag:(anizip:13853-1,jw:403680-1,kitsu:237993,nf:81037598-1,simkl:774239-1)/nf:81037598-1',
  '/watch/ag:(anilist:195604,anizip:19433,cr:GRE50KV36-GS00385471,kitsu:50024,livechart:13232,mal:61967,offline:mal-61967)/ag:(anizip:19433-1,kitsu:384944)',
  '/watch/ag:(anilist:154587,animethemes:4136,anizip:17617,mal:52991,offline:mal-52991)/ag:(anizip:17617-1,anizip:17617-S1)',
  '/media/ag:(anilist:101249,anizip:13853,hoopla:12418002,jw:403680,kitsu:41007,mal:37407,nf:81037598,offline:mal-37407,omdb:tt8076344,plex:5d77708f594b2b001e74d1ea,simkl:774239,tubi:590793,watchmode:01298472)?plugins=https:stub.plugins.banou.dev',
  '/media/ag:(anilist:1535,anizip:4563,cr:G6QWD3EE6-GR2PCVDMD,jw:11313-11130,kitsu:1376,mal:1535,nf:70204970-1,nyaa:4563,offline:mal-1535,simkl:40190,tvmaze:40-s1)?plugins=https:stub.plugins.banou.dev',
  '/media/ag:(anilist:101249,anizip:13853,hoopla:12418002,jw:403680,kitsu:41007,mal:37407,nf:81037598,offline:mal-37407,plex:5d77708f594b2b001e74d1ea,tubi:590793)',
  '/media/ag:(amazon:amzn1.dv.gti.abe7decc-b74b-485e-ade9-f77453866278,anilist:101343,jw:416291,kitsu:41080,mal:37514,offline:mal-37514)',
  '/media/ag:(anilist:154587,anizip:17617,cr:GG5H5XQX4-GYE5CQMQ5,jw:364792-373583,kitsu:46474,mal:52991,nf:81726714-1,offline:mal-52991)',
  '/media/ag:(anilist:195516,anizip:19444,jw:395707-511393,kitsu:50021,livechart:13226,mal:61987,nf:81712068-3,offline:mal-61987)',
  '/media/ag:(anilist:207141,anizip:19873,jw:518630-563252,kitsu:50551,mal:63403,nf:82760630-1,nyaa:19873,offline:mal-63403)',
  '/title/ag:(amazon:amzn1.dv.gti.d6110d18-3cbc-43e8-8a82-940ef38262c2,anilist:32,animethemes:2051,anizip:202,ann:419,disney:6d840ac8-0f88-4ac0-bca2-1f3004ad3b55,jw:190835,kitsu:23,mal:32,nf:60024788,offline:mal-32)',
  '/title/ag:(amazon:amzn1.dv.gti.6a0fe13d-747e-4979-9a89-fbf78cb87e7f,anilist:5133,anizip:2991,ann:3291,jw:19883,kitsu:3943,mal:5133,offline:mal-5133)',
  '/title/ag:(anilist:182255,animethemes:4771,anizip:18886,ann:33628,cr:GG5H5XQX4-G6X0C4JDV,jw:364792-486285,kitsu:49240,mal:59978,offline:mal-59978)',
  '/title/ag:(anilist:154965,animethemes:4023,anizip:17637,ann:26380,jw:362796-372312,kitsu:46529,mal:53126,nf:81685150-1,offline:mal-53126)',
  '/title/ag:(anilist:16498,animethemes:2611,anizip:9541,ann:14950,jw:20682-21870,kitsu:7442,mal:16498,nf:70299043-1,offline:mal-16498)',
  '/title/ag:(anilist:195604,animethemes:4963,anizip:19433,ann:36880,cr:GRE50KV36-GS00385471,kitsu:50024,mal:61967,offline:mal-61967)',
  '/title/ag:(anilist:3670,anizip:1370,ann:449,cr:G24H1NW50-G6X0C45NM,jw:41360-67541,kitsu:3182,mal:3670,offline:mal-3670)',
  '/title/ag:(anilist:1,animethemes:521,anizip:23,ann:13,jw:34435-51923,kitsu:1,mal:1,nf:80001305-1,offline:mal-1)',
  '/title/ag:(anilist:4481,anizip:2199,ann:631,fubo:MV000143100000,jw:55566,kitsu:3635,mal:4481,offline:mal-4481)',
  '/title/ag:(anilist:283,animethemes:78,anizip:1061,ann:421,jw:19682-18767,kitsu:258,mal:283,offline:mal-283)',
  '/title/ag:(anilist:5267,animethemes:846,anizip:5411,ann:1434,kitsu:4023,mal:5267,offline:mal-5267)',
  '/title/ag:(imdb:tt10919420,omdb:tt10919420,simkl:1360242,tmdb:93405,trakt:squid-game,tvdb:383275,tvmaze:43687,watchmode:03164600)',
  '/title/ag:(anilist:21363,animethemes:1965,anizip:11599,ann:18446,kitsu:11584,mal:31631,offline:mal-31631)',
  '/title/ag:(anilist:12359,anizip:7337,ann:1844,jw:63034-598355,kitsu:6712,mal:12359,offline:mal-12359)',
]
const SITE = 'https://anime.fkn.app'

const short = (address: string) => `${SITE}${SHORT_PATH}${shortenPath(address)}`
const code = (bytes: number[]) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const varint = (value: number) => {
  const out: number[] = []
  do {
    const low = value % 128
    value = Math.floor(value / 128)
    out.push(value ? low + 128 : low)
  } while (value)
  return out
}
const text = (value: string) => [...varint(value.length), ...new TextEncoder().encode(value)]

describe('a short link', () => {
  test.each(CORPUS)('reads back as exactly the address it packs, and is shorter: %s', address => {
    const packed = shortenPath(address)
    expect(packed).toMatch(/^[\w-]+$/)
    expect(expandPath(packed!)).toBe(address)
    expect(short(address).length).toBeLessThan(`${SITE}${address}`.length)
  })

  test('makes the issue\'s 695 character link 278, and a typical one 44% shorter', () => {
    expect(`${SITE}${ISSUE}`.length).toBe(695)
    expect(short(ISSUE).length).toBe(278)
    const savings = CORPUS.map(address => 1 - short(address).length / `${SITE}${address}`.length).sort((a, b) => a - b)
    expect(savings[Math.floor(savings.length / 2)]).toBeGreaterThan(0.43)
    expect(savings[0]).toBeGreaterThan(0.25)
  })

  // a format change reads every link already shared as another address
  test('of the issue\'s link is these exact characters', () => {
    expect(shortenPath(ISSUE)).toBe('CxUB4PwzArTzBAMDBARHVBGEuBcGLUdTEaG4FwQDAw2ktyACLQ355CIF3LEMBtDaDwcDAhHP38YnBC0xCLTzBAktAAqA6f4FEwsKji0SzP7JRY2XXSw5ojN3lAIJAQQtMQMRAwYtR0UR5LkXCEpBSlAMAuT8-_4bAEZerY4MDJ9EqdsEnP_6EwXEyWIHyP6angHIEdeghAECAQEBAQEBBQEBNTwOvgTxAo0HoQcWCkkBCi1zMWUxAgjogpEEAQ')
  })

  test.each([
    '/media/ag:(anilist:21034)/ag:(anilist:21034-3)',
    '/watch/ag:(anilist:21034)/ep:1',
    '/watch/ag:(anilist:1)-3/ag:(anizip:23-1)/nyaa:1',
    '/title/ag:(newsource:abc,anilist:0,mal:0123,x:)',
    '/title/ag:(anilist:1,trakt:%E3%81%82)?plugins=https:other.plugins.test&plugins=npm:@scope/plugin',
    '/title/ag:(cr:GG5H5XQX4-GYE5CQMQ5,amazon:amzn2.other.8e2d12cc-fec9-458d-975d-2c39a2337794,plex:5D77708F594B2B001E74D1EA)',
    '/title/ag:(anilist:1234567890123456789012)',
    '/title/mal:1',
  ])('packs what stub\'s grammar has no row for as text, and still reads back exactly: %s', address => {
    expect(expandPath(shortenPath(address)!)).toBe(address)
  })

  test.each([
    ['another route', '/settings?plugins=https:stub.plugins.banou.dev'],
    ['a parameter but plugins', '/watch/ag:(anilist:21034)/ep:1?t=272'],
    ['an empty query', '/title/ag:(anilist:1)?'],
    ['a fragment', '/title/ag:(anilist:1)#top'],
    ['a trailing slash', '/title/ag:(anilist:1)/'],
    ['too many segments', '/title/ag:(anilist:1)/ag:(anilist:1-1)'],
    ['too few', '/watch/ag:(anilist:1)'],
    ['a handle with no origin', '/title/ag:(anilist:1,1234)'],
    ['what does not read back as itself', '/title/ag:(anilist:\uD800)'],
    ['an address past 8 KiB', `/title/ag:(${Array.from({ length: 1_000 }, (_, index) => `anilist:${index}`).join(',')})`],
  ])('is not made for %s, so Share hands out the address as it is', (_, address) => {
    expect(shortenPath(address)).toBeUndefined()
  })
})

describe('a code', () => {
  test('that is not one opens nothing, without throwing', () => {
    for (const garbled of ['', '!', 'abc$', 'A', 'AAAAA', 'DAAA', '_w', 'x'.repeat(20_000)]) expect(expandPath(garbled)).toBeUndefined()
  })

  test('cut anywhere opens nothing or a shorter address, without throwing', () => {
    const bytes = Uint8Array.from(atob(shortenPath(ISSUE)!.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
    for (let end = 0; end < bytes.length; end++) {
      const opened = expandPath(code([...bytes.subarray(0, end)]))
      if (opened !== undefined) expect(ISSUE.startsWith(opened.split('?')[0]!)).toBe(true)
    }
  })

  test.each([
    ['a route stub has no row for', [12, 3, 1, 4]],
    ['a title with two segments', [2, 3, 1, 4, 3, 1, 4]],
    ['an origin past the table', [1, 3, 63, 4]],
    ['a plugin past the table', [1, 3, 1, 4, 9]],
    ['a pointer to an id not read yet', [1, 3, 1, 5, 0]],
    ['a uuid prefix past the table', [1, 3, 11, 18, ...Array<number>(16).fill(0)]],
    ['a bare segment with several ids', [1, 2, 65, 0, 4, 8]],
    ['ascending ids flagged on one id', [1, 3, 129, 4]],
    ['more ids than bytes left', [1, 3, 65, 100, 4]],
    ['a number past 2^53', [1, 3, 1, 255, 255, 255, 255, 255, 255, 255, 127]],
    ['a varint longer than eight bytes', [1, 3, 1, 128, 128, 128, 128, 128, 128, 128, 128, 0]],
    ['text that is not UTF-8', [1, 3, 1, 3, 1, 2, 0xff]],
    ['a run of 16 digits', [1, 3, 1, 3, 1, 16 * 2 + 1, 5]],
  ])('naming %s opens nothing', (_, bytes) => {
    expect(expandPath(code(bytes))).toBeUndefined()
  })

  // the research prototype, with no limit, turned these 11 bytes into 134,217,748 characters in 26 ms
  test('claiming a run of 2^27 digits opens nothing', () => {
    const crafted = code([1, 3, 1, 3, 1, ...varint(2 ** 27 * 2 + 1), 0])
    expect(crafted).toHaveLength(15)
    expect(expandPath(crafted)).toBeUndefined()
  })

  // each id an earlier one plus 100 characters: half a million characters from 14 KiB, without the 8 KiB cap
  test('whose ids each extend the last stops at 8 KiB of address', () => {
    const ids = 100
    const suffix = [1, ...varint(200), ...Array<number>(100).fill(98)]
    const bytes = [1, 3, 65, ...varint(ids - 2), 3, ...suffix]
    for (let at = 1; at < ids; at++) bytes.push(...varint((2 * (at - 1)) * 4 + 1), ...suffix)
    const crafted = code(bytes)
    expect(crafted.length).toBeLessThan(16_384)
    expect(expandPath(crafted)).toBeUndefined()
    // the same shape, short enough, opens
    expect(expandPath(code([1, 3, 65, 0, 3, ...suffix, 1, ...suffix]))).toBe(`/title/ag:(anilist:${'b'.repeat(100)},anilist:${'b'.repeat(200)})`)
  })

  // a copy of the tables as links were first shared: a row moved or removed opens those links as another address
  test('names each row of stub\'s tables as it always has', () => {
    const origins = [
      'anilist', 'anizip', 'cr', 'jw', 'kitsu', 'mal', 'nf', 'nyaa', 'offline', 'simkl', 'amazon', 'disney', 'tvmaze',
      'animethemes', 'ann', 'livechart', 'hoopla', 'plex', 'tubi', 'omdb', 'watchmode', 'imdb', 'tmdb', 'tvdb', 'trakt',
      'fubo', 'anidb', 'appletv', 'hbo', 'hulu', 'hidive', 'paramount', 'peacock', 'philo', 'pluto', 'roku', 'starz',
      'amcplus', 'unogs', 'yt', 'jikan', 'stub',
    ]
    expect(origins.map((_, row) => expandPath(code([1, 3, row + 1, 4])))).toEqual(origins.map(origin => `/title/ag:(${origin}:1)`))
    expect(expandPath(code([1, 3, 1, 4]))).toBe('/title/ag:(anilist:1)')
    expect(expandPath(code([5, 3, 1, 4]))).toBe('/media/ag:(anilist:1)')
    expect(expandPath(code([10, 3, 1, 4, 3, 1, 4]))).toBe('/watch/ag:(anilist:1)/ag:(anilist:1)')
    expect(expandPath(code([1, 3, 1, 4, 1]))).toBe('/title/ag:(anilist:1)?plugins=https:stub.plugins.banou.dev')
    const uuid = Array<number>(16).fill(0xab)
    expect(expandPath(code([1, 3, 12, 2, ...uuid]))).toBe('/title/ag:(disney:abababab-abab-abab-abab-abababababab)')
    expect(expandPath(code([1, 3, 11, 10, ...uuid]))).toBe('/title/ag:(amazon:amzn1.dv.gti.abababab-abab-abab-abab-abababababab)')
  })

  test('with an origin given as text opens it', () => {
    expect(expandPath(code([1, 3, 0, ...text('newsource'), 12]))).toBe('/title/ag:(newsource:3)')
  })
})
