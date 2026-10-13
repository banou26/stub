// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsMedia } from '../../../src/router/home/media-details'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Client, Provider, subscriptionExchange } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { Episodes } = await import('../../../src/router/home/media-details')

// a real urql client whose origins subscription answers once and stays open, as the worker's does
const client = () => new Client({
  url: 'http://test/graphql',
  exchanges: [subscriptionExchange({
    forwardSubscription: () => ({
      subscribe: sink => {
        sink.next({ data: { originPage: { nodes: [{ id: 'nf', name: 'Netflix', icon: null, color: null }] } }, hasNext: true })
        return { unsubscribe: () => {} }
      },
    }),
  })],
})

const media = {
  uri: 'ag:(anilist:1)',
  episodes: Array.from({ length: 26 }, (_, index) => ({
    uri: `ag:(nf:${index + 1})`,
    episodeNumber: index + 1,
    releaseDate: '2023-09-29',
    titles: [{ title: `Episode ${index + 1}` }],
    handles: [{ relation: 'SAME_AS', node: { uri: `nf:${index + 1}`, origin: 'nf', url: `https://www.netflix.com/watch/${index + 1}` } }],
  })),
} as unknown as DetailsMedia

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('every page of episodes gets its rows\' source icons, once the first page has its own', async () => {
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(<Provider value={client()}><Router hook={hook}><Episodes media={media}/></Router></Provider>)
  hosts.push(host)
  const rows = () => [...host.querySelectorAll('.episode')]
  const withIcons = () => rows().filter(row => row.querySelector('.src')).length
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  expect(rows().map(row => row.querySelector('.number')!.textContent), 'the control: the first page is answered').toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1}`))
  expect(withIcons()).toBe(12)
  for (const [page, count] of [['Page 2', 12], ['Page 3', 2]] as const) {
    act(() => { host.querySelector<HTMLButtonElement>(`button[aria-label="${page}"]`)!.click() })
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
    expect(rows(), page).toHaveLength(count)
    expect(withIcons(), page).toBe(count)
  }
  expect(rows().map(row => row.querySelector('.number')!.textContent)).toEqual(['25', '26'])
})

test('the list opens on the page holding episode start', () => {
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(<Provider value={client()}><Router hook={hook}><Episodes media={media} start={13}/></Router></Provider>)
  hosts.push(host)
  expect(host.querySelector('.episode .number')!.textContent).toBe('13')
  expect(host.querySelector('button[aria-current="page"]')!.textContent).toBe('2')
})

test('a later page keeps its own rows\' release: unreleased ones dimmed and not linked, released ones named by their number', () => {
  // an airing show, 1 to 19 out and 20 to 26 not, and no titles, so each row falls back to its number
  const airing = {
    uri: 'ag:(anilist:1)',
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: 20, airingAt: Math.floor(Date.UTC(2099, 0, 1) / 1000) },
    episodes: media.episodes.map(episode => ({ ...episode, titles: [], releaseDate: episode.episodeNumber! < 20 ? '2023-09-29' : '2099-01-01' })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(<Provider value={client()}><Router hook={hook}><Episodes media={airing}/></Router></Provider>)
  hosts.push(host)
  const rows = () => [...host.querySelectorAll('.episode')].map(row => ({
    number: Number(row.querySelector('.number')!.textContent),
    title: row.querySelector('.title')!.textContent,
    unreleased: row.classList.contains('unreleased'),
    linked: Boolean(row.querySelector('a.episode-link')),
  }))
  const expected = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => {
    const number = from + index
    return { number, title: number < 20 ? `Episode ${number}` : 'Unreleased episode', unreleased: number >= 20, linked: number < 20 }
  })
  expect(rows(), 'the control: the first page').toEqual(expected(1, 12))
  act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Page 2"]')!.click() })
  expect(rows()).toEqual(expected(13, 24))
  act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Page 3"]')!.click() })
  expect(rows()).toEqual(expected(25, 26))
})
