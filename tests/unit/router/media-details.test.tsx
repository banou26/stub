// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsMedia } from '../../../src/router/home/media-details'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { Client, Provider, subscriptionExchange } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))

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

test('every row Show all reveals gets its source icons, once the first rows have theirs', async () => {
  const { hook } = memoryLocation({ path: '/' })
  const urql = client()
  const page = (limit?: number) => <Provider value={urql}><Router hook={hook}><Episodes media={media} limit={limit}/></Router></Provider>
  const host = mount(page(12))
  hosts.push(host)
  const withIcons = () => [...host.querySelectorAll('.episode')].filter(row => row.querySelector('.src')).length
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  expect(withIcons(), 'the control: the first rows are answered').toBe(12)
  act(() => { render(page(), host) })
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  expect(host.querySelectorAll('.episode')).toHaveLength(26)
  expect(withIcons()).toBe(26)
})
