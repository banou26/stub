// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Frown: () => null, Meh: () => null, Smile: () => null }))

const { default: MediaTitle } = await import('../../../src/components/media-title')
const { default: MediaCard } = await import('../../../src/components/media-card')
const { default: MediaRow } = await import('../../../src/components/media-row')

// linkedom has no Image; this one loads every cover at MyAnimeList's large size, 425 x 600, sharp
// enough for every listing card on a 1x screen
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onload?: () => void
    naturalWidth = 425
    naturalHeight = 600
    set src (_: string) { setTimeout(() => this.onload?.()) }
  })
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const show = (covers: string[]) => ({
  _id: 'cl:mal:61987',
  uri: 'mal:61987',
  handles: [{ relation: 'SAME_AS', node: { uri: 'mal:61987' } }],
  titles: [{ language: 'en', title: 'The Apothecary Diaries Season 3', score: 0.9 }],
  covers: covers.map(url => ({ url })),
})

const layouts = { grid: MediaTitle, cards: MediaCard, list: MediaRow } as Record<string, (props: { media: never, to: '/title/mal:61987' }) => preact.JSX.Element>

test.each(Object.keys(layouts))('the %s layout keeps a cover sharp enough for it when a higher ranked source answers another', async layout => {
  const Listed = layouts[layout]!
  const { hook } = memoryLocation()
  const tree = (media: object) => <Router hook={hook}><Listed media={media as never} to="/title/mal:61987"/></Router>
  const host = mount(tree(show(['mal-old.webp'])))
  hosts.push(host)
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  await settle()

  act(() => { render(tree(show(['mal-new.webp', 'mal-old.webp'])), host) })
  await settle()

  expect(host.innerHTML).toContain('url(mal-old.webp)')
})
