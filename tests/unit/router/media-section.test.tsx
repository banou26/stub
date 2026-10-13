// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))
// listens on the window, which node's globalThis is not
vi.mock('../../../src/components/draggable', () => ({ default: ({ children }: { children: unknown }) => children }))
// every column drawn, each cell keyed `${rowIndex}-${columnIndex}` as react-window 2.0.1 keys it, so a
// column's cell outlives the media in it
vi.mock('react-window', async () => {
  const { h } = await import('preact')
  return {
    useGridRef: () => ({ current: null }),
    Grid: ({ cellComponent, cellProps, columnCount }: { cellComponent: (props: object) => null, cellProps: object, columnCount: number }) =>
      h('div', null, Array.from({ length: columnCount }, (_, columnIndex) =>
        h(cellComponent, { ...cellProps, key: `0-${columnIndex}`, columnIndex, rowIndex: 0, style: {} }))),
  }
})

const { MediaSection } = await import('../../../src/router/home/media-section')

type Nodes = Parameters<typeof MediaSection>[0]['mediaNodes']

// linkedom has no Image, which the cover probe (utils/use-cover-url.ts) loads each cover with
beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const show = (_id: string, title: string, { covers = [`https://images.justwatch.com/poster/${_id}.jpg`], handles = [`SAME_AS ${_id.slice(3)}`] } = {}) => ({
  _id,
  uri: `ag:(${_id.slice(3)})`,
  titles: [{ language: 'en', title, score: 0.2 }],
  covers: covers.map(url => ({ language: 'en', url })),
  handles: handles.map(handle => ({ relation: handle.split(' ')[0], node: { uri: handle.split(' ')[1] } })),
})

const row = async (nodes: object[]) => {
  const { hook } = memoryLocation({ path: '/' })
  const tree = (next: object[]) => <Router hook={hook}><MediaSection title="Popular shows" mediaNodes={next as Nodes}/></Router>
  const host = mount(tree(nodes))
  hosts.push(host)
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  await settle()
  return {
    posters: () => [...host.querySelectorAll<HTMLElement>('.category-item')]
      .map(card => [card.textContent, card.getAttribute('style')?.match(/url\(([^)]*)\)/)?.[1]]),
    update: async (next: object[]) => {
      act(() => { render(tree(next), host) })
      await settle()
    },
  }
}

// Measured live on series.fkn.app, 2026-10-13: JustWatch's show was hidden 6.8 s in by its Apple TV
// season, which took its place in the row with no covers
test('a row card keeps its show\'s poster when one of the show\'s runs takes its place with none', async () => {
  const { posters, update } = await row([show('cl:jw:224087', 'Ted Lasso'), show('cl:jw:446463', 'Widow\'s Bay')])
  expect(posters()).toEqual([
    ['Ted Lasso', 'https://images.justwatch.com/poster/cl:jw:224087.jpg'],
    ['Widow\'s Bay', 'https://images.justwatch.com/poster/cl:jw:446463.jpg'],
  ])

  await update([
    show('cl:jw:224087', 'Ted Lasso'),
    show('cl:appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1', 'Widow’s Bay', {
      covers: [],
      handles: ['SAME_AS appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1', 'PART_OF jw:446463'],
    }),
  ])
  expect(posters()).toEqual([
    ['Ted Lasso', 'https://images.justwatch.com/poster/cl:jw:224087.jpg'],
    ['Widow’s Bay', 'https://images.justwatch.com/poster/cl:jw:446463.jpg'],
  ])
})

test('a row reordered draws each card\'s own poster, and none on a card that has none', async () => {
  const { posters, update } = await row([show('cl:jw:224087', 'Ted Lasso'), show('cl:jw:131317', 'Slow Horses')])
  await update([show('cl:jw:131317', 'Slow Horses'), show('cl:jw:259735', 'Lioness', { covers: [] })])
  expect(posters()).toEqual([
    ['Slow Horses', 'https://images.justwatch.com/poster/cl:jw:131317.jpg'],
    ['Lioness', undefined],
  ])
})
