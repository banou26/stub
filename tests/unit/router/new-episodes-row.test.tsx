// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// HOR-1074 (new episodes of shows being watched): home's row over the joined lists, with urql faked as the lists
// and stub's merged data for each work it asks about. HOR-1114 (the row's heading and its own page): the page.

const urql = vi.hoisted(() => ({
  lists: undefined as unknown,
  media: {} as Record<string, unknown>,
  asked: [] as string[],
}))
vi.mock('urql', () => ({
  useSubscription: ({ query, variables }: { query: { definitions: { name?: { value: string } }[] }, variables?: { input: { uri: string } } }) => {
    if (query.definitions[0]?.name?.value === 'ViewerLists') return [{ data: urql.lists }]
    const uri = variables!.input.uri
    if (!urql.asked.includes(uri)) urql.asked.push(uri)
    return [{ data: urql.media[uri] ? { media: urql.media[uri] } : undefined }]
  },
}))

const { default: NewEpisodes } = await import('../../../src/router/home/new-episodes-row')
const { default: NewEpisodesPage } = await import('../../../src/router/new')
const { MOST } = await import('../../../src/router/home/new-episodes')

const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const row = (uri: string, title: string, mediaStatus: string, progress: number, updatedAt: string, episodeCount: number | null = 12) => ({
  _id: `row:${uri}`,
  uri,
  episodeCount,
  mediaStatus,
  type: 'TV',
  nextAiringEpisode: null,
  disagreements: [],
  answers: [],
  summary: { _id: `summary:${uri}`, status: 'WATCHING', progress, score: null, episodeCount, updatedAt, title, cover: null },
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  urql.media = {}
  urql.asked.length = 0
})

const show = (rows: unknown[] | undefined, page = false) => {
  urql.lists = rows && { viewerLists: { _id: 'viewerLists', lists: [], rows } }
  const location = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}>{page ? <NewEpisodesPage/> : <NewEpisodes/>}</Router>))
  hosts.push(host)
  return host
}

const cards = (host: HTMLElement) => [...host.querySelectorAll('.card')].map(card => [card.getAttribute('href'), card.querySelector('.title')?.textContent, card.querySelector('.facts')?.textContent])

test('is not drawn while nothing is new', () => {
  const host = show([row('mal:1', 'Cowboy Bebop', 'FINISHED', 12, ago(DAY))])
  expect(host.innerHTML).toBe('')
})

test("asks stub's merged data only about the show airing with no schedule, and draws each new episode as a card", () => {
  urql.media['mal:21'] = { _id: 'm', uri: 'mal:21', status: 'RELEASING', episodeCount: null, nextAiringEpisode: null, episodes: [
    { _id: 'e1', episodeNumber: 1100, releaseDate: ago(8 * DAY), handles: [] },
    { _id: 'e2', episodeNumber: 1101, releaseDate: ago(DAY), handles: [] },
  ] }
  const host = show([
    row('mal:21', 'One Piece', 'RELEASING', 1099, ago(200 * DAY), null),
    row('mal:48', '.hack//Sign', 'FINISHED', 20, ago(2 * DAY), 26),
  ])
  act(() => {})

  expect(urql.asked).toEqual(['mal:21'])
  const heading = host.querySelector('section > .title')
  expect([heading?.textContent, heading?.getAttribute('href')], 'its heading opens its own page, as the season row\'s opens its search').toEqual(['New episodes', '/new'])
  expect(cards(host)).toEqual([
    ['/media/mal:21', 'One Piece', 'Episode 11002 new'],
    ['/media/mal:48', '.hack//Sign', 'Episode 216 new'],
  ])
})

// 25 shows that ended, each changed a minute after the next and watched to episode 3 of 12
const many = Array.from({ length: 25 }, (_, n) => row(`mal:${n}`, `Show ${n}`, 'FINISHED', 3, ago(n * 60_000)))

test(`the row holds the newest ${MOST}, and its page every one, in the same order and the same cards`, () => {
  const onRow = cards(show(many))
  const onPage = cards(show(many, true))
  expect(onRow).toHaveLength(MOST)
  expect(onPage).toHaveLength(25)
  expect(onPage.slice(0, MOST)).toEqual(onRow)
  expect(onPage[24]).toEqual(['/media/mal:24', 'Show 24', 'Episode 49 new'])
})

test('the page says there is none once the lists answer with nothing new, and nothing while they are read', () => {
  expect(show(undefined, true).querySelector('.status'), 'the lists not answered yet').toBeNull()
  for (const rows of [[], [row('mal:1', 'Cowboy Bebop', 'FINISHED', 12, ago(DAY))]]) {
    const host = show(rows, true)
    expect(host.querySelector('.heading')?.textContent).toBe('New episodes')
    expect(host.querySelector('.status')?.textContent).toBe('No new episodes')
    expect(cards(host)).toEqual([])
  }
})
