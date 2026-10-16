// FIRST: ../components/dom installs the document preact renders into.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

const { useCoverUrl } = await import('../../../src/utils/use-cover-url')

// Natural sizes measured live on anime.fkn.app/search?season=FALL&year=2026, 2026-10-16 and 2026-10-17,
// and of JustWatch's s718 posters, 2026-10-17
const SIZES: Record<string, [number, number]> = {
  'mal-old.webp': [424, 600],
  'mal-new.webp': [425, 600],
  'mal-landscape.webp': [600, 337],
  'anisearch-600.webp': [600, 800],
  'anilist-medium.jpg': [230, 307],
  'anilist-large.jpg': [460, 678],
  'kitsu-small.jpeg': [284, 402],
  'kitsu-original.jpg': [1371, 2160],
  'mal-moved.webp': [425, 600],
  'livechart-moved.jpg': [350, 500],
  'mal-first.webp': [425, 600],
  'livechart-first.jpg': [350, 500],
  'jw-show.jpg': [718, 1024],
  'jw-season.jpg': [718, 1024],
}

// linkedom has no Image; this one loads every url at its measured size
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onload?: () => void
    naturalWidth = 0
    naturalHeight = 0
    set src (url: string) {
      ;[this.naturalWidth, this.naturalHeight] = SIZES[url] ?? [0, 0]
      setTimeout(() => this.onload?.())
    }
  })
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

type Owner = { _id: string, covers: { url: string }[], handles: { relation: string, node: { uri: string } }[] }
const owner = (_id: string, covers: string[], handles: string[]): Owner => ({
  _id,
  covers: covers.map(url => ({ url })),
  handles: handles.map(handle => ({ relation: handle.split(' ')[0]!, node: { uri: handle.split(' ')[1]! } })),
})
const show = (covers: string[], mal = 61987) => owner(`cl:mal:${mal}`, covers, [`SAME_AS mal:${mal}`])

// as a listing card draws its cover: the grid's 250 x 350 CSS px
const Cover = ({ media, standIn }: { media: Owner, standIn: boolean }) =>
  <i data-cover={useCoverUrl(media.covers, media, { standIn, box: { width: 250, height: 350 } })}/>

const card = async (first: Owner, standIn = false) => {
  const host = mount(<Cover media={first} standIn={standIn}/>)
  hosts.push(host)
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  await settle()
  return {
    cover: () => host.querySelector('i')!.getAttribute('data-cover'),
    update: async (next: Owner) => {
      act(() => { render(<Cover media={next} standIn={standIn}/>, host) })
      await settle()
    },
  }
}

test('a card keeps a cover sharp enough for it when a higher ranked source answers another', async () => {
  const { cover, update } = await card(show(['mal-old.webp']))
  await update(show(['mal-new.webp', 'mal-old.webp']))
  expect(cover()).toBe('mal-old.webp')
})

test('a card keeps a cover sharp enough for it also over a markedly sharper one', async () => {
  const { cover, update } = await card(show(['kitsu-small.jpeg']))
  await update(show(['kitsu-original.jpg', 'kitsu-small.jpeg']))
  expect(cover()).toBe('kitsu-small.jpeg')
})

test('on a 2x screen a cover too soft for the card stays when the new one is not markedly sharper', async () => {
  vi.stubGlobal('devicePixelRatio', 2)
  const { cover, update } = await card(show(['mal-old.webp']))
  await update(show(['mal-new.webp', 'mal-old.webp']))
  expect(cover()).toBe('mal-old.webp')
})

test('a card never moves to a less sharp cover, also when its own is too soft for the screen', async () => {
  vi.stubGlobal('devicePixelRatio', 3)
  const { cover, update } = await card(show(['anisearch-600.webp']))
  await update(show(['anilist-medium.jpg', 'anisearch-600.webp']))
  expect(cover()).toBe('anisearch-600.webp')
})

// each record names a source of the one before it, not of the first
test('a card keeps a cover sharp enough for it through each record of one show', async () => {
  const { cover, update } = await card(owner('cl:kitsu:49746', ['mal-old.webp'], ['SAME_AS kitsu:49746']))
  await update(owner('cl:mal:61987', ['mal-new.webp', 'mal-old.webp'], ['SAME_AS kitsu:49746', 'SAME_AS mal:61987']))
  await update(owner('cl:anilist:178680', ['anilist-large.jpg'], ['SAME_AS anilist:178680', 'SAME_AS mal:61987']))
  expect(cover()).toBe('mal-old.webp')
})

// as the home rows draw a season in the place of its show
test('a season drawn in its show\'s place draws its own poster once it loads, however sharp the show\'s', async () => {
  const { cover, update } = await card(owner('cl:jw:131317', ['jw-show.jpg'], ['SAME_AS jw:131317']), true)
  await update(owner('cl:jw:131317-1', ['jw-season.jpg'], ['SAME_AS jw:131317-1', 'PART_OF jw:131317']))
  expect(cover()).toBe('jw-season.jpg')
})

test('the control: a cover too soft for the card gives way to a markedly sharper one', async () => {
  const { cover, update } = await card(show(['mal-landscape.webp']))
  await update(show(['mal-new.webp', 'mal-landscape.webp']))
  expect(cover()).toBe('mal-new.webp')
})

test('the control: on a 2x screen a small poster gives way to a large one', async () => {
  vi.stubGlobal('devicePixelRatio', 2)
  const { cover, update } = await card(show(['kitsu-small.jpeg']))
  await update(show(['anilist-large.jpg', 'kitsu-small.jpeg']))
  expect(cover()).toBe('anilist-large.jpg')
})

test('the control: another show at the same place takes its own cover', async () => {
  const { cover, update } = await card(show(['anisearch-600.webp']))
  await update(show(['anilist-medium.jpg'], 58516))
  expect(cover()).toBe('anilist-medium.jpg')
})

// as the season page moves a show to another place: its LiveChart cover had loaded at the place it
// left, and MyAnimeList's, ranked first, loads after it arrives
test('a card that gets another show keeps the cover it drew for it while that one is sharp enough', async () => {
  await card(show(['livechart-moved.jpg'], 58516))
  const { cover, update } = await card(show(['anisearch-600.webp']))
  await update(show(['mal-moved.webp', 'livechart-moved.jpg'], 58516))
  expect(cover()).toBe('livechart-moved.jpg')
})

test('a card keeps the cover it first drew, one already loaded, when a less sharp one ranked first loads after', async () => {
  await card(show(['mal-first.webp'], 58517))
  const { cover } = await card(show(['livechart-first.jpg', 'mal-first.webp'], 58517))
  expect(cover()).toBe('mal-first.webp')
})
