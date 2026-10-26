// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import type { MediaChapter } from '@banou/media-player'
import type { PlaybackLink } from '../../../../src/party/bridge'
import type { PlaybackState } from '../../../../src/party/protocol'
import type { EndingSources } from '../../../../src/router/watch/fallback-ending'

import { readFileSync } from 'node:fs'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// HOR-1014: where a torrent whose file marks no ending takes one from, in order: Crunchyroll's skip events when
// Crunchyroll's length of the episode is the same cut, then aniskip's ending. The lengths, events and answers are the
// ones measured on 2026-10-26 (next-episode-step5-measure.md): Crunchyroll's through the relay, files' from their
// listings, aniskip's as recorded in tests/fixtures/aniskip.

// Crunchyroll's length by watch url, as relay-check.ts reads it when the torrent plays
const crunchyroll = vi.hoisted(() => ({ lengths: {} as Record<string, number | undefined | Error>, asked: [] as string[] }))
vi.mock('../../../../src/sources/crunchyroll/relay-check', () => ({
  crunchyrollLength: async (url: string) => {
    crunchyroll.asked.push(url)
    const length = crunchyroll.lengths[url]
    if (length instanceof Error) throw length
    return length
  },
}))
// the relay, which answers Crunchyroll's skip events, and the viewer's browser, which answers aniskip
const relay = vi.hoisted(() => ({ files: {} as Record<string, unknown>, asked: [] as string[] }))
vi.mock('../../../../src/utils/fetch', () => ({
  fetch: async (input: string) => {
    relay.asked.push(String(input))
    return String(input) in relay.files ? Response.json(relay.files[String(input)]) : new Response('', { status: 403 })
  },
}))
const browser = vi.hoisted(() => ({
  answers: {} as Record<string, unknown>,
  asked: [] as [string, RequestInit | undefined][],
  failing: false,
  held: undefined as Promise<void> | undefined,
}))
vi.mock('../../../../src/worker/browser-fetch', () => ({
  browserFetch: async (input: string, init?: RequestInit) => {
    browser.asked.push([String(input), init])
    await browser.held
    if (browser.failing) throw new TypeError('Failed to fetch')
    const answer = browser.answers[String(input)]
    return answer ? Response.json(answer) : Response.json({ found: false, results: [] }, { status: 404 })
  },
}))

const { fallbackEnding, sameCut, useFallbackEnding } = await import('../../../../src/router/watch/fallback-ending')
const { skipEventsUrl } = await import('../../../../src/sources/crunchyroll/skip-events')
const { aniskipUrl } = await import('../../../../src/sources/aniskip')
const { nextOfferAt } = await import('../../../../src/utils/next-offer')

const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/aniskip/${name}.json`, import.meta.url), 'utf8'))

beforeEach(() => {
  crunchyroll.lengths = {}
  crunchyroll.asked = []
  relay.files = {}
  relay.asked = []
  browser.answers = {}
  browser.asked = []
  browser.failing = false
  browser.held = undefined
})
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
})

const watchUrl = (id: string) => `https://www.crunchyroll.com/watch/${id}`
// an episode on Crunchyroll, its length there and its skip events as Crunchyroll serves them
const onCrunchyroll = (id: string, length: number, events: object) => {
  crunchyroll.lengths[watchUrl(id)] = length
  relay.files[skipEventsUrl(id)] = events
  return watchUrl(id)
}
const ending = (chapters: { title: string }[]) => chapters.find(chapter => chapter.title === 'Ending')

test('a file 1.633 s longer than Crunchyroll\'s takes its credits', async () => {
  // ToonsHub's Crunchyroll rip of Re:Zero S4 e2, from its listing
  const url = onCrunchyroll('GE00345528JAJP', 1420.087, { intro: { start: 140, end: 227 }, credits: { start: 1337, end: 1378 } })
  const chapters = await fallbackEnding(1421.72, { crunchyroll: url })
  expect(ending(chapters)).toEqual({ start: 1337, end: 1378, title: 'Ending' })
  expect(nextOfferAt(chapters, 1421.72), 'a second before what follows it').toBe(1377)
  expect(relay.asked).toEqual([skipEventsUrl('GE00345528JAJP')])
})

test('a file 2.000 s longer does not, and its events are never asked', async () => {
  // ToonsHub's Netflix rip of Firefly Wedding e2, which subtracts to exactly 2 in JavaScript
  expect(1377.084 - 1375.084).toBe(2)
  const url = onCrunchyroll('GE00384156JAJP', 1375.084, { intro: { start: 127, end: 217 }, credits: { start: 1240, end: 1330 } })
  expect(await fallbackEnding(1377.084, { crunchyroll: url })).toEqual([])
  expect(crunchyroll.asked).toEqual([url])
  expect(relay.asked).toEqual([])
})

test('a file of another cut, 90 s off, does not', async () => {
  // Sentenced to Be a Hero e12, which Crunchyroll re-cut after VARYG's rip of it
  const url = onCrunchyroll('GE00356833JAJP', 1860.069, { intro: { start: 0, end: 90 }, credits: { start: 1785, end: 1860 } })
  expect(await fallbackEnding(1770.026, { crunchyroll: url })).toEqual([])
})

test('an episode Crunchyroll gives no length for here takes none of its events', async () => {
  expect(await fallbackEnding(1420, { crunchyroll: watchUrl('GE00384327JAJP') })).toEqual([])
  expect(relay.asked).toEqual([])
})

test('one cut is less than 2 s apart, either way', () => {
  expect(sameCut(1421.72, 1420.087)).toBe(true)
  expect(sameCut(1420.087, 1421.72)).toBe(true)
  expect(sameCut(1377.084, 1375.084)).toBe(false)
  expect(sameCut(1375.084, 1377.084)).toBe(false)
})

const FRIEREN = { id: '59978', episode: 3 }
const SENTENCED = { id: '56009', episode: 3 }

test('with no Crunchyroll handle, aniskip\'s ending recorded on the same cut and late in it is kept', async () => {
  // SubsPlease's Frieren S2 e3, as ripple read it
  browser.answers[aniskipUrl(FRIEREN.id, FRIEREN.episode, 1440.11)] = recorded('frieren-s2-e3')
  const chapters = await fallbackEnding(1440.11, { mal: FRIEREN })
  expect(ending(chapters)).toEqual({ start: 1340, end: 1440, title: 'Ending' })
  expect(nextOfferAt(chapters, 1440.11)).toBe(1339)
  expect(crunchyroll.asked).toEqual([])
})

test('aniskip is asked from the viewer\'s browser without credentials, never through the relay', async () => {
  await fallbackEnding(1440.11, { mal: FRIEREN })
  expect(browser.asked).toEqual([[aniskipUrl(FRIEREN.id, FRIEREN.episode, 1440.11), expect.objectContaining({ credentials: 'omit' })]])
  expect(relay.asked).toEqual([])
})

test('aniskip\'s ending recorded 2 s or more from the player\'s length is refused', async () => {
  // it answers an entry recorded up to 20 s off: asked at 1460 s, Sentenced to Be a Hero e3 answered its 1470.148 s one
  for (const [length, kept] of [[1442.0, true], [1442.107, false], [1438.107, false]] as const) {
    browser.answers[aniskipUrl(FRIEREN.id, FRIEREN.episode, length)] = recorded('frieren-s2-e3')
    expect(ending(await fallbackEnding(length, { mal: FRIEREN })) !== undefined, String(length)).toBe(kept)
  }
})

test('Crunchyroll\'s events with no credits go on to aniskip, whose "ed" at the episode\'s start is refused', async () => {
  // Sentenced to Be a Hero e3: Crunchyroll marks its intro only, and aniskip's "ed" at 84.6 to 174.6 s of 1470 s is its
  // opening; ToonsHub's B-Global rip of it
  const url = onCrunchyroll('GE00356815JAJP', 1470.096, { intro: { start: 86, end: 176 } })
  browser.answers[aniskipUrl(SENTENCED.id, SENTENCED.episode, 1470.143)] = recorded('sentenced-to-be-a-hero-e3')
  expect(await fallbackEnding(1470.143, { crunchyroll: url, mal: SENTENCED })).toEqual([])
  expect(browser.asked.map(([url]) => url), 'aniskip was asked').toEqual([aniskipUrl(SENTENCED.id, SENTENCED.episode, 1470.143)])

  // the control: the same entry starting in the last 40% is kept
  browser.answers[aniskipUrl(SENTENCED.id, SENTENCED.episode, 1470.143)] = { results: [{ skipType: 'ed', interval: { startTime: 882.1, endTime: 972.1 }, episodeLength: 1470.148 }] }
  expect(ending(await fallbackEnding(1470.143, { crunchyroll: url, mal: SENTENCED }))).toEqual({ start: 882.1, end: 972.1, title: 'Ending' })
})

test('Crunchyroll\'s credits win over aniskip\'s, which is then never asked', async () => {
  const url = onCrunchyroll('GD9UEVK8N', 1440.024, { intro: { start: 0, end: 88 }, credits: { start: 1338, end: 1438 } })
  expect(ending(await fallbackEnding(1440.11, { crunchyroll: url, mal: FRIEREN }))).toEqual({ start: 1338, end: 1438, title: 'Ending' })
  expect(browser.asked).toEqual([])
})

test('a failed request gives no ending, and Crunchyroll\'s goes on to aniskip', async () => {
  crunchyroll.lengths[watchUrl('GD9UEVK8N')] = new Error('Crunchyroll episode through cz-prg-001: 503')
  browser.answers[aniskipUrl(FRIEREN.id, FRIEREN.episode, 1440.11)] = recorded('frieren-s2-e3')
  expect(ending(await fallbackEnding(1440.11, { crunchyroll: watchUrl('GD9UEVK8N'), mal: FRIEREN }))).toEqual({ start: 1340, end: 1440, title: 'Ending' })

  browser.failing = true
  expect(await fallbackEnding(1440.11, { crunchyroll: watchUrl('GD9UEVK8N'), mal: FRIEREN })).toEqual([])
})

// the hook as the watch page holds it, on a player `length` s long that reports playing when told
const player = (length: number) => {
  const listeners = new Set<(state: PlaybackState) => void>()
  const link: PlaybackLink = {
    apply: () => {},
    onReport: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    duration: () => length,
    dispose: () => {},
  }
  const plays = () => act(() => { for (const listener of listeners) listener({ paused: false, time: 0, rate: 1, at: 0 }) })
  return { link, plays }
}
let found: MediaChapter[] = []
const Hook = ({ link, sources }: { link: PlaybackLink, sources: EndingSources }) => {
  found = useFallbackEnding(link, sources)
  return null
}
const CREDITS = { start: 1338, end: 1438, title: 'Ending' }
const settle = () => act(async () => { for (let turn = 0; turn < 5; turn++) await new Promise(resolve => setTimeout(resolve, 0)) })

test('an answer for sources since changed is dropped, so a late aniskip 404 leaves Crunchyroll\'s credits', async () => {
  let release = () => {}
  browser.held = new Promise(resolve => { release = resolve })
  const { link, plays } = player(1440.11)
  const host = mount(h(Hook, { link, sources: { mal: FRIEREN } }))
  hosts.push(host)
  await plays()
  expect(browser.asked, 'aniskip is out').toHaveLength(1)
  // a Crunchyroll handle joins the episode before aniskip answers
  const url = onCrunchyroll('GD9UEVK8N', 1440.024, { credits: { start: 1338, end: 1438 } })
  act(() => { render(h(Hook, { link, sources: { crunchyroll: url, mal: FRIEREN } }), host) })
  await plays()
  await settle()
  expect(ending(found)).toEqual(CREDITS)
  release()
  await settle()
  expect(ending(found), 'still Crunchyroll\'s credits').toEqual(CREDITS)
})

test('the next player, with nowhere to ask, carries no ending over from the last', async () => {
  const url = onCrunchyroll('GD9UEVK8N', 1440.024, { credits: { start: 1338, end: 1438 } })
  const first = player(1440.11)
  const host = mount(h(Hook, { link: first.link, sources: { crunchyroll: url } }))
  hosts.push(host)
  await first.plays()
  await settle()
  expect(ending(found)).toEqual(CREDITS)
  // the next episode's, which has no Crunchyroll handle and no MyAnimeList id
  act(() => { render(h(Hook, { link: player(1420).link, sources: {} }), host) })
  expect(found).toEqual([])
})
