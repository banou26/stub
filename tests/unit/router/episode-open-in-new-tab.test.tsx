// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import type { DetailsMedia } from '../../../src/router/home/media-details'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Client, Provider, subscriptionExchange } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))
vi.mock('../../../src/utils/fkn-backend', () => ({ detectBackend: async () => 'extension' as FknBackend }))
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})

const { Episodes } = await import('../../../src/router/home/media-details')
const { OPEN_IN_NEW_TAB_KEY, setOpenInNewTab } = await import('../../../src/utils/open-in-new-tab')

const client = () => new Client({
  url: 'http://test/graphql',
  exchanges: [subscriptionExchange({
    forwardSubscription: () => ({
      subscribe: sink => {
        sink.next({
          data: {
            originPage: {
              nodes: [
                { id: 'nf', name: 'Netflix', icon: null, color: null },
                { id: 'hulu', name: 'Hulu', icon: null, color: null },
              ],
            },
          },
          hasNext: true,
        })
        return { unsubscribe: () => {} }
      },
    }),
  })],
})

const media = {
  uri: 'ag:(anilist:1)',
  episodes: [{
    uri: 'ag:(nf:1)',
    episodeNumber: 1,
    releaseDate: '2023-09-29',
    titles: [{ title: 'Episode 1' }],
    handles: [
      { relation: 'SAME_AS', node: { uri: 'nf:1', origin: 'nf', url: 'https://www.netflix.com/watch/1' } },
      { relation: 'SAME_AS', node: { uri: 'hulu:1', origin: 'hulu', url: 'https://www.hulu.com/watch/1' } },
    ],
  }],
} as unknown as DetailsMedia

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const withPlugins = (href: string) => `${href}?plugins=https:stub.plugins.banou.dev`

const open = async () => {
  const location = memoryLocation({ path: '/title/ag:(anilist:1)', record: true })
  const host = mount(withIntl(
    <Provider value={client()}>
      <Router hook={location.hook} hrefs={withPlugins}>
        <Episodes media={media}/>
      </Router>
    </Provider>
  ))
  hosts.push(host)
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  const click = (selector: string) => {
    const event = Object.assign(new Event('click', { bubbles: true, cancelable: true }), { button: 0 })
    act(() => { host.querySelector(selector)!.dispatchEvent(event) })
    return event.defaultPrevented
  }
  return { host, location, click }
}

test('by default, clicking an episode row or its playable source icon navigates in the same tab', async () => {
  const { host, location, click } = await open()
  const rowLink = host.querySelector('a.episode-link')!
  const nfIcon = host.querySelector('a[title="Watch on Netflix"]')!
  const huluIcon = host.querySelector('a[title="Watch on Hulu"]')!

  expect(rowLink.getAttribute('target')).toBeNull()
  expect(rowLink.getAttribute('href')).toBe('/watch/ag:(anilist:1)/ag:(nf:1)?plugins=https:stub.plugins.banou.dev')
  expect(nfIcon.getAttribute('target')).toBeNull()
  expect(huluIcon.getAttribute('target')).toBe('_blank')

  expect(click('a.episode-link')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/ag:(anilist:1)/ag:(nf:1)')

  expect(click('a[title="Watch on Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/ag:(anilist:1)/ag:(nf:1)/nf:1')
})

test('when enabled, clicking an episode row or its playable source icon opens in a new tab with native browser navigation', async () => {
  stored.set(OPEN_IN_NEW_TAB_KEY, 'on')
  const { host, location, click } = await open()
  const rowLink = host.querySelector('a.episode-link')!
  const nfIcon = host.querySelector('a[title="Watch on Netflix"]')!

  expect(rowLink.getAttribute('target')).toBe('_blank')
  expect(rowLink.getAttribute('rel')).toBe('noopener noreferrer')
  expect(rowLink.getAttribute('href')).toBe('/watch/ag:(anilist:1)/ag:(nf:1)?plugins=https:stub.plugins.banou.dev')

  expect(nfIcon.getAttribute('target')).toBe('_blank')
  expect(nfIcon.getAttribute('rel')).toBe('noopener noreferrer')
  expect(nfIcon.getAttribute('href')).toBe('/watch/ag:(anilist:1)/ag:(nf:1)/nf:1?plugins=https:stub.plugins.banou.dev')

  expect(click('a.episode-link'), 'wouter must not intercept left clicks for new-tab links').toBe(false)
  expect(click('a[title="Watch on Netflix"]'), 'compact source icon leaves left click to the browser too').toBe(false)
  expect(location.history).toEqual(['/title/ag:(anilist:1)'])
})

test('updates rendered episode links immediately when the setting toggles', async () => {
  const { host } = await open()
  expect(host.querySelector('a.episode-link')!.getAttribute('target')).toBeNull()

  act(() => setOpenInNewTab(true))
  expect(host.querySelector('a.episode-link')!.getAttribute('target')).toBe('_blank')
  expect(host.querySelector('a[title="Watch on Netflix"]')!.getAttribute('target')).toBe('_blank')

  act(() => setOpenInNewTab(false))
  expect(host.querySelector('a.episode-link')!.getAttribute('target')).toBeNull()
  expect(host.querySelector('a[title="Watch on Netflix"]')!.getAttribute('target')).toBeNull()
})
