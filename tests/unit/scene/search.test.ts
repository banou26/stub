import { describe, expect, test, vi } from 'vite-plus/test'

import type { TraceMoeResult } from '../../../src/scene/search'

import { isSceneCode, momentTime, sceneSearchUrl, scenesOf, searchScene } from '../../../src/scene/search'
import { asksViewerDirectly } from '../../../src/worker/direct-fetch'

// the example code trace.moe's own docs search by (docs.md, "Search by color layout vector", 2026-10-24)
const DOCS_CODE = 'gwebWzth7oPe2UIubOJmozi1NDFp'

// The docs' example frame of "Is the Order a Rabbit??" as trace.moe answered it, 2026-10-24: its Blu-ray copy and
// three TV copies of episode 1 above 0.9, the TV copies about 10 s later, and episode 7 under the bar.
const RABBIT: TraceMoeResult[] = [
  { anilist: 21034, episode_start: 1, from: 272.1886, similarity: 0.9922267343483719 },
  { anilist: 21034, episode_start: 1, from: 282.282, similarity: 0.9922267343483719 },
  { anilist: 21034, episode_start: 1, from: 282.3237, similarity: 0.9922267343483719 },
  { anilist: 21034, episode_start: 1, from: 282.1986, similarity: 0.984393497541839 },
  { anilist: 21034, episode_start: 7, from: 1252.0007, similarity: 0.5676066679113051 },
]

describe('the ask', () => {
  test('is a GET of the code alone, to an origin asked from the browser', () => {
    expect(sceneSearchUrl(DOCS_CODE)).toBe(`https://api.trace.moe/search?vector=${DOCS_CODE}`)
    expect(asksViewerDirectly(sceneSearchUrl(DOCS_CODE))).toBe(true)
  })

  test('a code is trace.moe\'s 28 url-safe characters', () => {
    expect(isSceneCode(DOCS_CODE)).toBe(true)
    expect(isSceneCode('gwebWzth7oPe2UIubOJmozi1NDF')).toBe(false)
    expect(isSceneCode('gwebWzth7oPe2UIubOJmozi1NDFp&url=x')).toBe(false)
    expect(isSceneCode(null)).toBe(false)
  })

  test('sends no body, no content type and no cookies, and answers the matches', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: '', result: RABBIT }))
    expect(await searchScene(DOCS_CODE, fetch)).toEqual({ matches: [{ anilist: 21034, moments: [{ episode: 1, from: 272.1886 }] }] })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://api.trace.moe/search?vector=${DOCS_CODE}`, { credentials: 'omit' })
  })

  test('asks nothing for an address that holds no code', async () => {
    const fetch = vi.fn(async () => Response.json({ result: RABBIT }))
    expect(await searchScene('not a code', fetch)).toEqual({ error: 'failed' })
    expect(fetch).not.toHaveBeenCalled()
  })

  // trace.moe refuses a free caller's second search while the first is out (402), so a second picture waits
  test('a second search starts only once the first has answered', async () => {
    const answers: ((response: Response) => void)[] = []
    const fetch = vi.fn(() => new Promise<Response>(resolve => answers.push(resolve)))
    const first = searchScene(DOCS_CODE, fetch)
    const second = searchScene('eOOEIPhB0IQhB8IQg-TPYQg-D0IQ', fetch)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetch, 'still one out').toHaveBeenCalledTimes(1)
    answers[0]!(Response.json({ result: [] }))
    await first
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    answers[1]!(Response.json({ result: [] }))
    expect(await second).toEqual({ matches: [] })
  })

  test('each refusal is one kind, which the page writes', async () => {
    const answer = (status: number, body: unknown) => searchScene(DOCS_CODE, async () => Response.json(body, { status }))
    expect(await answer(402, { quota: 100, quotaUsed: 100, error: 'Search quota depleted (quota per 24 hours: 100, used: 100)' })).toEqual({ error: 'limit' })
    expect(await answer(402, { error: 'Concurrency limit exceeded' })).toEqual({ error: 'busy' })
    expect(await answer(503, { error: 'Search queue is full' })).toEqual({ error: 'busy' })
    expect(await answer(400, { error: 'Failed to process image' })).toEqual({ error: 'failed' })
    expect(await searchScene(DOCS_CODE, async () => { throw new TypeError('Failed to fetch') })).toEqual({ error: 'busy' })
  })
})

describe('scenesOf', () => {
  test('keeps 0.9 and above, which trace.moe calls the line under which results are most likely wrong', () => {
    expect(scenesOf([
      { anilist: 1, episode_start: 1, from: 10, similarity: 0.9 },
      { anilist: 2, episode_start: 1, from: 10, similarity: 0.8999 },
    ]).map(match => match.anilist)).toEqual([1])
  })

  test('one match per show in trace.moe\'s order, each episode once, at the earliest copy\'s start', () => {
    expect(scenesOf([
      { anilist: 5, episode_start: 2, from: 300, similarity: 0.99 },
      { anilist: 7, episode_start: 1, from: 40, similarity: 0.97 },
      { anilist: 5, episode_start: 2, from: 290.5, similarity: 0.96 },
      { anilist: 5, episode_start: 9, from: 12, similarity: 0.95 },
    ])).toEqual([
      { anilist: 5, moments: [{ episode: 2, from: 290.5 }, { episode: 9, from: 12 }] },
      { anilist: 7, moments: [{ episode: 1, from: 40 }] },
    ])
  })

  test('a special has no episode, and an AniList record in place of the id still names the show', () => {
    expect(scenesOf([
      { anilist: { id: 99939 }, episode_start: null, from: 97.72, similarity: 0.944 },
      { anilist: 3, from: 5, similarity: 0.93 },
    ])).toEqual([
      { anilist: 99939, moments: [{ episode: null, from: 97.72 }] },
      { anilist: 3, moments: [{ episode: null, from: 5 }] },
    ])
  })

  // trace.moe's docs: a file of several episodes (EP07-12) is listed from episode_start to episode_end, its `from`
  // counted from the start of the file
  test('a file of several episodes names none of them, and one of a single episode names it', () => {
    expect(scenesOf([
      { anilist: 1, episode_start: 7, episode_end: 12, from: 3000, similarity: 0.97 },
      { anilist: 2, episode_start: 4, episode_end: 4, from: 30, similarity: 0.96 },
    ])).toEqual([
      { anilist: 1, moments: [{ episode: null, from: 3000 }] },
      { anilist: 2, moments: [{ episode: 4, from: 30 }] },
    ])
  })
})

// the episode before it is the page's message (tests/unit/router/search-page.test.tsx)
test('a moment\'s time reads in minutes, and in hours past one', () => {
  expect(momentTime(272.19)).toBe('4:32')
  expect(momentTime(5)).toBe('0:05')
  expect(momentTime(3723.9)).toBe('1:02:03')
})
