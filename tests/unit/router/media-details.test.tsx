// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsMedia } from '../../../src/router/home/media-details'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'
import { Client, Provider, subscriptionExchange } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { viewerIn } from '../sources/justwatch/viewer'

const fkn = vi.hoisted(() => ({ backend: 'cloud' as FknBackend }))
vi.mock('../../../src/worker', () => ({}))
vi.mock('../../../src/utils/fkn-backend', () => ({ detectBackend: async () => fkn.backend }))
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { Episodes, useTrackingSummary } = await import('../../../src/router/home/media-details')

// a real urql client whose origins subscription answers once and stays open, as the worker's does
const client = (origin = { id: 'nf', name: 'Netflix' }) => new Client({
  url: 'http://test/graphql',
  exchanges: [subscriptionExchange({
    forwardSubscription: () => ({
      subscribe: sink => {
        sink.next({ data: { originPage: { nodes: [{ ...origin, icon: null, color: null }] } }, hasNext: true })
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

test('a Prime Video row outside Japan plays in stub with the extension, and links out to Prime Video on the cloud', async () => {
  viewerIn('America/Toronto')
  const url = 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.1'
  const prime = {
    uri: 'ag:(anilist:1)',
    episodes: [{
      uri: 'ag:(amazon:amzn1.dv.gti.1)', episodeNumber: 1, releaseDate: '2023-09-29', titles: [{ title: 'Episode 1' }],
      handles: [{ relation: 'SAME_AS', node: { uri: 'amazon:amzn1.dv.gti.1', origin: 'amazon', url } }],
    }],
  } as unknown as DetailsMedia
  const hrefOn = async (backend: FknBackend) => {
    fkn.backend = backend
    const { hook } = memoryLocation({ path: '/' })
    const host = mount(<Provider value={client({ id: 'amazon', name: 'Prime Video' })}><Router hook={hook}><Episodes media={prime}/></Router></Provider>)
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
    return host.querySelector('.episode .src')?.getAttribute('href')
  }
  expect(await hrefOn('extension')).toBe('/watch/ag:(anilist:1)/ag:(amazon:amzn1.dv.gti.1)/amazon:amzn1.dv.gti.1')
  expect(await hrefOn('cloud')).toBe(url)
})

describe('the tracking summary a page reads', () => {
  const A = 'ag:(anilist:1)'
  const A_GROWN = 'ag:(anilist:1,mal:1)'
  const B = 'ag:(anilist:2)'
  // a real urql client whose tracking subscription answers only for A, as a worker slow to answer B
  const trackingClient = () => new Client({
    url: 'http://test/graphql',
    exchanges: [subscriptionExchange({
      forwardSubscription: request => ({
        subscribe: sink => {
          if ((request.variables as { input: { uri: string } }).input.uri === A) {
            sink.next({ data: { tracking: { _id: `tracking:${A}`, summary: { _id: `summary:${A}`, status: 'COMPLETED', progress: 12, score: null, episodeCount: 12 }, disagreements: [], answers: [] } }, hasNext: true })
          }
          return { unsubscribe: () => {} }
        },
      }),
    })],
  })

  test("is never another work's, kept by urql while the new one has not answered", async () => {
    let show: (uri: string) => void = () => {}
    const Summary = () => {
      const [uri, setUri] = useState(A)
      show = setUri
      return <span>{useTrackingSummary(uri)?.status ?? 'none'}</span>
    }
    const host = mount(<Provider value={trackingClient()}><Summary/></Provider>)
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
    expect(host.textContent).toBe('COMPLETED')

    await act(async () => { show(A_GROWN) })
    expect(host.textContent, 'the control: the same work at a grown uri keeps it').toBe('COMPLETED')

    await act(async () => { show(B) })
    expect(host.textContent).toBe('none')
  })
})
