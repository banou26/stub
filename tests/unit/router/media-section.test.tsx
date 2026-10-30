// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

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
  vi.useRealTimers()
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
  const tree = (next: object[]) => withIntl(<Router hook={hook}><MediaSection title="Popular shows" mediaNodes={next as Nodes}/></Router>)
  const host = mount(tree(nodes))
  hosts.push(host)
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  await settle()
  return {
    title: () => host.querySelector('.title:not(.hidden)')?.textContent,
    held: () => host.querySelectorAll('.list-container > .pending > [aria-hidden]').length,
    posters: () => [...host.querySelectorAll<HTMLElement>('.category-item')]
      .map(card => [card.textContent, card.getAttribute('style')?.match(/url\(([^)]*)\)/)?.[1]]),
    tags: () => [...host.querySelectorAll<HTMLElement>('.category-item')]
      .map(card => [card.querySelector('.title')?.textContent, card.querySelector('.kind-tag')?.textContent]),
    update: async (next: object[]) => {
      act(() => { render(tree(next), host) })
      await settle()
    },
  }
}

test('an empty row holds cards\' places until its first cards land in them, under its title', async () => {
  const { title, held, posters, update } = await row([])
  expect(held()).toBe(8)
  expect(title()).toBe('Popular shows')
  expect(posters()).toEqual([])

  await update([show('cl:jw:224087', 'Ted Lasso')])
  expect(held()).toBe(0)
  expect(posters().map(([title]) => title)).toEqual(['Ted Lasso'])
})

// series.fkn.app with JustWatch turned off, 2026-10-16: Popular shows shimmered at 5 s and still at 40 s
test('a row no card lands in stops holding their places as the search page stops searching, at 5 s', async () => {
  // advancing with the clock too, for the waits `row` makes on real time
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { held } = await row([])
  act(() => { vi.advanceTimersByTime(4_800) })
  expect(held(), 'the control: held until then').toBe(8)

  act(() => { vi.advanceTimersByTime(200) })
  expect(held()).toBe(0)
})

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

// HOR-1083. Crunchyroll files every work it lists under series, a film too, so a card answered by it alone waits for a
// format rather than reading Series and then Movie.
test('a row card tags a movie, a series and an anime series, and waits for a format no source has named', async () => {
  const typed = (_id: string, title: string, type: string | null, categories: string[]) => ({ ...show(_id, title), type, categories })
  const cards = (film: object) => [
    typed('cl:jw:1', 'Dune', 'MOVIE', ['MOVIE']),
    typed('cl:jw:224087', 'Ted Lasso', null, ['SERIES']),
    typed('cl:anilist:154587', 'Frieren', 'TV', ['ANIME', 'SERIES']),
    { ...show('cl:anilist:21519', 'Your Name'), ...film },
  ]
  const { tags, update } = await row(cards({ type: null, categories: ['ANIME', 'SERIES'] }))
  expect(tags()).toEqual([['Dune', 'Movie'], ['Ted Lasso', 'Series'], ['Frieren', 'Series'], ['Your Name', undefined]])

  await update(cards({ type: 'MOVIE', categories: ['ANIME', 'MOVIE'] }))
  expect(tags().at(-1)).toEqual(['Your Name', 'Movie'])
})
