// The owner's target, with two screenshots on 2026-09-05: a cold "Current season" must lead with
// Mushoku Tensei, Saga of Tanya the Evil II, Smoking Behind the Supermarket and Bleach. That order is
// MyAnimeList's member count, which the live jikan source publishes at score 0.9 and which therefore
// wins the aggregate. manami ships no popularity at all, so the bundle could only sort by its 1 to 10
// rating: 37 of 219 records carry one and its top is three shows tied at a perfect 10 from a handful
// of votes. The build attaches the real counts, measured 2026-09-06:
//   254638 Mushoku Tensei III | 233645 Youjo Senki II | 161220 Super no Ura de Yani Suu Futari
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { orderSeasonBucket } from '../../../../scripts/season-order.mjs'
import { SEASON_PAGE, errorText, malSeason } from '../../../../scripts/season-popularity.mjs'

const record = (t: string, over: { sc?: number, pop?: number } = {}) => ({ t, ty: 'TV', p: '', ...over })

test('member counts decide the order, so the season leads with what MyAnimeList says is popular', () => {
  const bucket = [
    record('Clevatess II', { sc: 10 }),
    record('Mushoku Tensei III', { sc: 8.96, pop: 254_638 }),
    record('Youjo Senki II', { sc: 8.44, pop: 233_645 }),
  ]

  expect(orderSeasonBucket(bucket).map(entry => entry.t))
    .toEqual(['Mushoku Tensei III', 'Youjo Senki II', 'Clevatess II'])
})

test('a record with no member count falls behind every record that has one, however it is rated', () => {
  const bucket = [record('Rated Ten', { sc: 10 }), record('Modest But Watched', { pop: 500 })]

  expect(orderSeasonBucket(bucket).map(entry => entry.t), 'a 10 from three votes is not popularity')
    .toEqual(['Modest But Watched', 'Rated Ten'])
})

test('with no member counts at all the rating still orders, so a failed popularity fetch degrades', () => {
  const bucket = [record('Unrated'), record('Well Rated', { sc: 9 }), record('Fairly Rated', { sc: 7 })]

  expect(orderSeasonBucket(bucket).map(entry => entry.t))
    .toEqual(['Well Rated', 'Fairly Rated', 'Unrated'])
})

// Real bytes of myanimelist.net/anime/season: two cards under "TV (New)", One Piece and Meitantei Conan
// under "TV (Continuing)".
const page = readFileSync(new URL('../../sources/jikan/__fixtures__/mal-season-sections.html', import.meta.url), 'utf8')
const answering = (...answers: (Response | Error)[]) => {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('asked too often')
    return answer
  }
  return { get, asked }
}

// Jikan's public API, which the build read until then, shut down on 2026-10-01 and every build since
// shipped the season with no count at all.
test('the build reads member counts and synopses off MyAnimeList\'s season page, keyed by mal id', async () => {
  const { get, asked } = answering(new Response(page))

  const counts = await malSeason(get, 0)

  expect(asked).toEqual([SEASON_PAGE])
  expect(counts.get(59193)?.members).toBe(299_468)
  expect(counts.get(49233)?.members).toBe(254_259)
  expect(counts.get(59193)?.synopsis).toMatch(/\S/)
})

// The live `mal` source drops the same block, so the bundle never counts a show it does not list.
test('shows MyAnimeList carries over from earlier seasons get no count', async () => {
  const counts = await malSeason(answering(new Response(page)).get, 0)

  expect([...counts.keys()].sort((a, b) => a - b)).toEqual([49233, 59193])
})

test('a failed read is retried, so one transient refusal does not cost a deploy its order', async () => {
  const { get, asked } = answering(new TypeError('fetch failed'), new Response('', { status: 503 }), new Response(page))

  expect((await malSeason(get, 0)).size).toBe(2)
  expect(asked).toHaveLength(3)
})

test('when every read fails the error says what the last one was', async () => {
  await expect(malSeason(answering(new Response('', { status: 403 }), new Response('', { status: 403 }), new Response('', { status: 403 })).get, 0))
    .rejects.toThrow(`${SEASON_PAGE} answered HTTP 403`)
  await expect(malSeason(answering(new Response('<html></html>'), new Response('<html></html>'), new Response('<html></html>')).get, 0))
    .rejects.toThrow('parsed to no entries from 13 bytes')
})

// The exact shape node threw for api.jikan.moe on 2026-10-13, which the build logged as `(page 1 ())`.
test('a connect failure with no message of its own still says what failed', () => {
  const refused = Object.assign(new AggregateError([
    new Error('connect ETIMEDOUT 135.181.39.91:443'),
    new Error('connect ENETUNREACH 2a01:4f9:c010:b863::1:443 - Local (:::0)'),
  ], ''), { code: 'ETIMEDOUT' })

  expect(errorText(refused))
    .toBe('ETIMEDOUT (connect ETIMEDOUT 135.181.39.91:443; connect ENETUNREACH 2a01:4f9:c010:b863::1:443 - Local (:::0))')
  expect(errorText(new TypeError('fetch failed', { cause: refused }))).toContain('fetch failed (ETIMEDOUT (connect ETIMEDOUT')
})

// vitest resolves an extensionless specifier and node does not, so only plain node can show the build
// would die importing the parser.
test('plain node loads the build\'s popularity module', () => {
  const module = fileURLToPath(new URL('../../../../scripts/season-popularity.mjs', import.meta.url))

  expect(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(module)}).then(m => console.log(typeof m.malSeason))`], { encoding: 'utf8' }).trim())
    .toBe('function')
})

test('the season data marks MyAnimeList R18+ cards, so the build leaves them out of the season', async () => {
  const html = readFileSync(fileURLToPath(new URL('../jikan/__fixtures__/mal-season-fall-2026.html', import.meta.url)), 'utf-8')
  const counts = await malSeason(async () => new Response(html), 0)

  expect(counts.get(64131)?.adult, 'Kanojo no Tomodachi, marked R18+').toBe(true)
  expect(counts.get(54344)?.adult, 'Mahou Shoujo Ikusei Keikaku: Restart').toBe(false)
})
