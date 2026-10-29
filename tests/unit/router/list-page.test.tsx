// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// HOR-1064 (a My list page), drawn from the lists the worker joins, with urql faked as one answer and a record of
// every save the page sends.

const urql = vi.hoisted(() => ({
  data: undefined as unknown,
  saves: [] as { trackers: string[], entry: Record<string, unknown> }[],
  answer: { outcome: 'SAVED' } as { outcome: string },
  reply: undefined as undefined | ((trackers: string[]) => unknown[]),
  rerender: new Set<() => void>(),
}))
vi.mock('urql', async () => {
  const { useEffect, useState } = await import('preact/hooks')
  return {
    useSubscription: () => {
      const [, setRenders] = useState(0)
      useEffect(() => {
        const render = () => setRenders(count => count + 1)
        urql.rerender.add(render)
        return () => { urql.rerender.delete(render) }
      }, [])
      return [{ data: urql.data }]
    },
    useMutation: () => [{}, async ({ input }: { input: { trackers: string[], entry: Record<string, unknown> } }) => {
      urql.saves.push({ trackers: input.trackers, entry: input.entry })
      return { data: { saveListEntry: urql.reply?.(input.trackers) ?? input.trackers.map(tracker => ({ tracker, ...urql.answer })) } }
    }],
  }
})
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'Grid2x2', 'Grid3x2', 'LayoutList', 'Plus', 'Search', 'Star'].map(name => [name, () => null]),
))

const { default: List } = await import('../../../src/router/list')

const tracker = (id: string, name: string) => ({ id, name, icon: null, color: null, canWrite: true, statuses: null, scoreScale: 'POINT_100', canClearScore: null })
const answer = (id: string, name: string, entry: Record<string, unknown>) =>
  ({ _id: `answer:${id}`, state: 'LISTED', candidates: [], episodeCount: 12, tracker: tracker(id, name), entry: { _id: `${id}:1`, status: 'WATCHING', score: null, episodeCount: 12, updatedAt: null, ...entry } })
const row = (uri: string, title: string, status: string, progress: number, answers: unknown[], disagreements: string[] = []) => ({
  _id: `row:${uri}`,
  uri,
  episodeCount: 12,
  mediaStatus: 'FINISHED',
  type: 'TV',
  nextAiringEpisode: null,
  disagreements,
  summary: { _id: `summary:${uri}`, status, progress, score: 85, episodeCount: 12, updatedAt: '2026-10-01T00:00:00.000Z', title, cover: null },
  answers,
})

const FRIEREN = row('anilist:154587', 'Frieren', 'WATCHING', 5, [
  answer('anilist', 'AniList', { progress: 5 }),
  answer('mal', 'MyAnimeList', { progress: 4 }),
], ['PROGRESS'])
const BEBOP = row('anilist:1', 'Cowboy Bebop', 'COMPLETED', 12, [answer('mal', 'MyAnimeList', { status: 'COMPLETED', progress: 12 })])

const show = (lists: { state: string, name: string }[] = [{ state: 'LISTED', name: 'AniList' }], rows: unknown[] = [FRIEREN, BEBOP]) => {
  urql.data = { viewerLists: { _id: 'viewerLists', lists: lists.map(({ state, name }) => ({ _id: `list:${name}`, state, tracker: { id: name, name } })), rows } }
  const location = memoryLocation({ path: '/list' })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><List/></Router>))
  hosts.push(host)
  return host
}

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  urql.saves.length = 0
  urql.answer = { outcome: 'SAVED' }
  urql.reply = undefined
})

const titles = (host: HTMLElement) => [...host.querySelectorAll('.item .title')].map(title => title.textContent)
const tabs = (host: HTMLElement) => [...host.querySelectorAll('.tab')].map(tab => tab.textContent)
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click() })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

test('opens on Watching, every tab saying how many it holds, and All shows the whole list', () => {
  const host = show()
  expect(host.querySelector('.heading')?.textContent).toBe('My list')
  expect(tabs(host)).toEqual(['Watching1', 'Plan to watch0', 'Completed1', 'Paused0', 'Dropped0', 'All2'])
  expect(titles(host)).toEqual(['Frieren'])
  click([...host.querySelectorAll('.tab')].at(-1))
  expect(titles(host), 'updated alike, so by title').toEqual(['Cowboy Bebop', 'Frieren'])
})

test('an item shows how far, its score and format, and a mark naming each tracker where they differ', () => {
  const host = show()
  const item = host.querySelector('.item')!
  expect(item.querySelector('.progress')?.textContent).toBe('5/ 12')
  expect(item.querySelector('.score')?.textContent).toBe('8.5')
  expect(item.querySelector('.title')?.getAttribute('href')).toBe('/media/anilist:154587')
  expect(item.querySelector('.differs')?.getAttribute('title')).toBe('AniList Episode 5, MyAnimeList Episode 4')
})

test('the mark says none of a tracker that holds no value of a field the others differ on, a line per field', () => {
  const host = show(undefined, [row('anilist:154587', 'Frieren', 'WATCHING', 5, [
    answer('anilist', 'AniList', { progress: 5, score: 80 }),
    answer('mal', 'MyAnimeList', { progress: 4, score: 60 }),
    answer('stub', 'Stub', { progress: null }),
  ], ['PROGRESS', 'SCORE'])])
  expect(host.querySelector('.differs')?.getAttribute('title')).toBe('AniList Episode 5, MyAnimeList Episode 4, Stub none\nAniList 8 / 10, MyAnimeList 6 / 10, Stub none')
})

test('the + sends one more episode to every tracker holding it at once, and shows it before they answer', async () => {
  const host = show()
  const more = host.querySelector<HTMLButtonElement>('.item .more')!
  expect(more.getAttribute('aria-label')).toBe('One episode more')
  click(more)
  expect(host.querySelector('.item .progress')?.textContent).toBe('6/ 12')
  expect(more.disabled, 'one save at a time').toBe(true)
  await settle()
  expect(urql.saves).toEqual([{ trackers: ['anilist', 'mal'], entry: { progress: 6 } }])
})

test('a tracker that did not take the + says so, and the item goes back to what the lists hold', async () => {
  urql.answer = { outcome: 'FAILED' }
  const host = show()
  click(host.querySelector('.item .more'))
  await settle()
  expect([...host.querySelectorAll('.missed')].map(line => line.textContent)).toEqual(['AniList did not save: failed', 'MyAnimeList did not save: failed'])
  expect(host.querySelector('.item .progress')?.textContent).toBe('5/ 12')
})

test("a tracker's own words for why it did not take the + are what the item says", async () => {
  urql.reply = () => [
    { tracker: 'anilist', outcome: 'FAILED', error: 'AniList asked stub to wait until 14:05' },
    { tracker: 'mal', outcome: 'SAVED', error: null },
  ]
  const host = show()
  click(host.querySelector('.item .more'))
  await settle()
  expect([...host.querySelectorAll('.missed')].map(line => line.textContent)).toEqual(['AniList did not save: AniList asked stub to wait until 14:05'])
})

test('a + that reached no tracker says so of every tracker it went to', async () => {
  urql.reply = () => [{ tracker: '', outcome: 'FAILED', error: 'The write did not reach the trackers' }]
  const host = show()
  click(host.querySelector('.item .more'))
  await settle()
  expect([...host.querySelectorAll('.missed')].map(line => line.textContent)).toEqual([
    'AniList did not save: The write did not reach the trackers',
    'MyAnimeList did not save: The write did not reach the trackers',
  ])
})

test('a list that could not be read says so in one line', () => {
  const host = show([{ state: 'LISTED', name: 'AniList' }, { state: 'ERROR', name: 'MyAnimeList' }, { state: 'SIGNED_OUT', name: 'Stub' }])
  expect([...host.querySelectorAll('.unread')].map(line => line.textContent)).toEqual(['Could not read the list on MyAnimeList'])
})
