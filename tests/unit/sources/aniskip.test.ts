import type { FetchLike } from '../../../src/worker/backoff'

import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { aniskipEndingOf, aniskipUrl, fetchAniskipEnding } from '../../../src/sources/aniskip'

// aniskip's own answers to the watch page's request, 2026-10-26: Sentenced to Be a Hero e3 (MyAnimeList 56009) asked at
// 1470.148 s, whose "ed" is its opening, Frieren S2 e3 (59978) at 1440.11 s, and Sentenced to Be a Hero e12 at 1771 s,
// which it has no ending for
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/aniskip/${name}.json`, import.meta.url), 'utf8'))

const answering = (response: Response) => {
  const asked: [string, RequestInit | undefined][] = []
  const fetch: FetchLike = async (input, init) => {
    asked.push([input instanceof Request ? input.url : input.toString(), init])
    return response
  }
  return { asked, fetch }
}

test('asks for the ending alone, at the player\'s length', () => {
  expect(aniskipUrl('59978', 3, 1440.11)).toBe('https://api.aniskip.com/v2/skip-times/59978/3?types=ed&episodeLength=1440.11')
})

test('reads the ending and the length it was recorded on', () => {
  expect(aniskipEndingOf(recorded('frieren-s2-e3'))).toEqual({ start: 1340, end: 1440, length: 1440.107 })
  expect(aniskipEndingOf(recorded('sentenced-to-be-a-hero-e3'))).toEqual({ start: 84.61, end: 174.61, length: 1470.148 })
})

test('an answer with no ending of the right shape has none', () => {
  const ed = { skipType: 'ed', interval: { startTime: 1340, endTime: 1440 }, episodeLength: 1440.107 }
  expect(aniskipEndingOf({ results: [ed] }), 'the control').toBeDefined()
  for (const answer of [
    recorded('not-found'),
    undefined,
    null,
    { results: {} },
    { results: [null] },
    { results: [{ ...ed, skipType: 'mixed-ed' }] },
    { results: [{ ...ed, interval: { startTime: 1340 } }] },
    { results: [{ ...ed, interval: { startTime: 1440, endTime: 1340 } }] },
    { results: [{ ...ed, episodeLength: '1440' }] },
  ]) expect(aniskipEndingOf(answer), JSON.stringify(answer)).toBeUndefined()
})

test('is asked without credentials; a 404 is no ending, and any other failure rejects', async () => {
  const found = answering(Response.json(recorded('frieren-s2-e3')))
  expect(await fetchAniskipEnding('59978', 3, 1440.11, found.fetch)).toEqual({ start: 1340, end: 1440, length: 1440.107 })
  expect(found.asked).toEqual([['https://api.aniskip.com/v2/skip-times/59978/3?types=ed&episodeLength=1440.11', { credentials: 'omit' }]])

  expect(await fetchAniskipEnding('56009', 12, 1771, answering(Response.json(recorded('not-found'), { status: 404 })).fetch)).toBeUndefined()
  await expect(fetchAniskipEnding('56009', 12, 1771, answering(new Response('', { status: 503 })).fetch)).rejects.toThrow('503')
})
