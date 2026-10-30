// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { memoryStorage } from '../party/fake-room'
import { fakeAnilist } from './recommended-fakes'

// HOR-1087 (home's Recommended for you, from the viewer's list): the row over the joined lists, with urql faked as
// the lists and the browser's fetch as AniList.

const fake = vi.hoisted(() => ({ lists: undefined as unknown, fetch: undefined as unknown as typeof fetch, emit: (_: unknown) => {} }))
vi.mock('urql', async () => {
  const { useState } = await import('preact/hooks')
  return {
    useSubscription: () => {
      const [lists, setLists] = useState(fake.lists)
      fake.emit = setLists
      return [{ data: lists }]
    },
  }
})
vi.mock('../../../src/worker/browser-fetch', () => ({ browserFetch: (input: RequestInfo | URL, init?: RequestInit) => fake.fetch(input, init) }))
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { default: Recommended } = await import('../../../src/router/home/recommended-row')
const { RECOMMENDED_KEY, SHOWN } = await import('../../../src/router/home/recommended')
const { DISABLED_SOURCES_KEY, readDisabledSources } = await import('../../../src/sources/disabled-sources')

const row = (uri: string, status: string, title: string) => ({
  _id: `row:${uri}`, uri, summary: { _id: `summary:${uri}`, status, score: null, updatedAt: '2026-10-30T00:00:00Z', title },
})
const FRIEREN = row('anilist:154587', 'COMPLETED', 'Frieren')
const VIOLET = row('anilist:21827', 'COMPLETED', 'Violet Evergarden')
const MUSHOKU = row('anilist:108465', 'WATCHING', 'Mushoku Tensei')

let anilist: ReturnType<typeof fakeAnilist>
let storage: ReturnType<typeof memoryStorage>
const hosts: HTMLElement[] = []
beforeEach(() => {
  anilist = fakeAnilist()
  fake.fetch = anilist.fetch as unknown as typeof fetch
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  // a cover that never loads: linkedom has no Image
  vi.stubGlobal('Image', class { set src (_: string) {} })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const listsOf = (rows: unknown[], state: string) =>
  ({ viewerLists: { _id: 'viewerLists', lists: [{ _id: 'list:stub', state, tracker: { id: 'stub', name: 'Stub' } }], rows } })

const show = async (rows: unknown[], state = 'LISTED') => {
  fake.lists = listsOf(rows, state)
  const location = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><Recommended/></Router>))
  hosts.push(host)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return host
}

const cards = (host: HTMLElement) => [...host.querySelectorAll('a.relation-card')].map(card => [card.getAttribute('href'), card.querySelector('.title')?.textContent])

test('draws nothing, and asks nothing, for a viewer whose lists name no show, or while they are read', async () => {
  expect((await show([])).innerHTML).toBe('')
  expect((await show([row('anilist:1', 'PLANNING', 'Planned')])).innerHTML).toBe('')
  expect((await show([FRIEREN], 'LOADING')).innerHTML).toBe('')
  expect(anilist.asked).toEqual([])
})

test("draws AniList's picks for the shows on the lists under its heading, each opening every id AniList gives it", async () => {
  const host = await show([FRIEREN, VIOLET, MUSHOKU])
  expect(anilist.asked.map(({ ids }) => ids)).toEqual([[21827, 108465, 154587]])
  expect(host.querySelector('[data-recommendations] h2')?.textContent).toBe('Recommended for you')
  expect(host.querySelectorAll('a.relation-card')).toHaveLength(3)
  expect(cards(host)).toEqual([
    ['/media/ag:(anilist:20954,mal:28851)', 'A Silent Voice'],
    ['/media/ag:(anilist:153518,mal:52701)', 'Delicious in Dungeon'],
    ['/media/ag:(anilist:128546,mal:46095)', 'Vivy -Fluorite Eye\'s Song-'],
  ])
  const kept = JSON.parse(storage.store.get(RECOMMENDED_KEY)!)
  expect(kept.seeds).toEqual([21827, 108465, 154587])
  expect(kept.picks.length).toBeGreaterThan(SHOWN)
})

test('serves the kept answer for the same shows, and asks again for others', async () => {
  await show([FRIEREN, VIOLET])
  expect(cards(await show([FRIEREN, VIOLET]))[0]).toEqual(['/media/ag:(anilist:20954,mal:28851)', 'A Silent Voice'])
  expect(anilist.asked, 'one request for both').toHaveLength(1)
  await show([FRIEREN, VIOLET, MUSHOKU])
  expect(anilist.asked).toHaveLength(2)
})

test('asks nothing and draws nothing while AniList is turned off in Settings', async () => {
  await show([FRIEREN, VIOLET])
  expect(anilist.asked, 'the control: the same lists are asked about with it on').toHaveLength(1)
  storage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(['anilist']))
  expect(readDisabledSources(), 'the control: the setting reads as Settings wrote it').toEqual(['anilist'])
  expect((await show([FRIEREN, VIOLET])).innerHTML, 'with an answer kept').toBe('')
  expect((await show([FRIEREN, MUSHOKU])).innerHTML, 'with none kept for these').toBe('')
  expect(anilist.asked, 'nothing asked').toHaveLength(1)
})

test('removes the kept answer once every list is read and none names a seed, and never before', async () => {
  await show([FRIEREN])
  expect(storage.store.has(RECOMMENDED_KEY), 'the control: it was kept').toBe(true)
  await show([], 'LOADING')
  expect(storage.store.has(RECOMMENDED_KEY), 'while a list is read').toBe(true)
  await show([row('anilist:1', 'PLANNING', 'Planned')])
  expect(storage.store.has(RECOMMENDED_KEY)).toBe(false)
})

test('removes the kept answer when the lists it waited for name no seed', async () => {
  await show([FRIEREN])
  await show([], 'LOADING')
  expect(storage.store.has(RECOMMENDED_KEY), 'the control: not while they are read').toBe(true)
  await act(async () => { fake.emit(listsOf([], 'LISTED')) })
  expect(storage.store.has(RECOMMENDED_KEY)).toBe(false)
})

test('removes the kept answer once AniList is turned off', async () => {
  await show([FRIEREN])
  expect(storage.store.has(RECOMMENDED_KEY), 'the control: it was kept').toBe(true)
  storage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(['anilist']))
  await show([FRIEREN])
  expect(storage.store.has(RECOMMENDED_KEY)).toBe(false)
})

test('keeps nothing of a 200 holding no seed, so the next load asks again', async () => {
  fake.fetch = (async () => Response.json({ data: { Page: null }, errors: [{ message: 'Internal Server Error', status: 500 }] })) as typeof fetch
  expect((await show([FRIEREN])).innerHTML).toBe('')
  expect(storage.store.has(RECOMMENDED_KEY)).toBe(false)
  fake.fetch = anilist.fetch as unknown as typeof fetch
  expect(cards(await show([FRIEREN]))).toHaveLength(3)
})

test('draws nothing when AniList refuses', async () => {
  anilist = fakeAnilist({ status: 429 })
  fake.fetch = anilist.fetch as unknown as typeof fetch
  expect((await show([FRIEREN])).innerHTML).toBe('')
  expect(storage.store.has(RECOMMENDED_KEY)).toBe(false)
})
