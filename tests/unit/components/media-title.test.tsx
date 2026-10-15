// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

const { default: MediaTitle } = await import('../../../src/components/media-title')

// linkedom has no Image, which the cover probe (utils/use-cover-url.ts) loads each cover with
const broken = new Set<string>()
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onload?: () => void
    onerror?: () => void
    set src (url: string) { setTimeout(() => broken.has(url) ? this.onerror?.() : this.onload?.()) }
  })
})

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const poster = (name: string) => `https://images.justwatch.com/poster/${name}/s718/${name}.jpg`
const media = (covers: string[], { _id = 'cl:jw:1', title = 'Star Wars', handles = [`SAME_AS ${_id.slice(3)}`] } = {}) => ({
  _id,
  handles: handles.map(handle => ({ relation: handle.split(' ')[0], node: { uri: handle.split(' ')[1] } })),
  titles: [{ language: 'en', title, score: 0.2 }],
  covers: covers.map(url => ({ url })),
})

const card = (first: object) => {
  const { hook } = memoryLocation()
  const tree = (next: object) => <Router hook={hook}><MediaTitle media={next as never} to="/title/jw:1" standIn/></Router>
  const host = mount(tree(first))
  hosts.push(host)
  // the probe answers on a timer, then the card renders what it settled on
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  const swap = (next: object) => act(() => { render(tree(next), host) })
  return {
    style: () => host.querySelector<HTMLElement>('.category-item')!.getAttribute('style') ?? '',
    settle,
    swap,
    // outside act, so the card is painted before its effects run, as a browser paints it
    paint: (next: object) => render(tree(next), host),
    update: async (next: object) => {
      swap(next)
      await settle()
    },
  }
}

const show = (covers: string[]) => media(covers, { _id: 'cl:jw:131317', title: 'Slow Horses' })
const season = (n: number, covers: string[]) => media(covers, {
  _id: `cl:jw:131317-${n}`,
  title: `Slow Horses Season ${n}`,
  handles: [`SAME_AS jw:131317-${n}`, 'PART_OF jw:131317'],
})

// a style of url(undefined) is a request for /undefined on the site's own origin
test('a card with no poster sets no background image', () => {
  expect(card(media([])).style()).not.toContain('url(')
})

test('a card with a poster draws it', () => {
  expect(card(media([poster('a-new-hope')])).style()).toContain(`url(${poster('a-new-hope')})`)
})

test('a card keeps its poster when a later answer for the same title carries none', async () => {
  const { style, settle, update } = card(media([poster('kept')]))
  await settle()
  await update(media([]))
  expect(style()).toContain(`url(${poster('kept')})`)
})

test('a card keeps its poster until another one for the same title has loaded', async () => {
  broken.add(poster('broken'))
  const { style, settle, update } = card(media([poster('first')]))
  await settle()
  await update(media([poster('broken')]))
  expect(style()).toContain(`url(${poster('first')})`)
  await update(media([poster('second')]))
  expect(style()).toContain(`url(${poster('second')})`)
})

// Measured live on series.fkn.app, 2026-10-13: JustWatch's show was hidden 6.8 s in by its Apple TV
// season, which took its place in the row with no covers
test('a card keeps its show\'s poster when one of the show\'s runs takes its place with none', async () => {
  const { style, settle, update } = card(media([poster('widows-bay')], { _id: 'cl:jw:446463', title: 'Widow\'s Bay' }))
  await settle()
  await update(media([], {
    _id: 'cl:appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1',
    title: 'Widow’s Bay',
    handles: ['SAME_AS appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1', 'PART_OF jw:446463'],
  }))
  expect(style()).toContain(`url(${poster('widows-bay')})`)
})

test('a card keeps its poster when a merge hands it the same title under another id', async () => {
  const { style, settle, update } = card(media([poster('kept')]))
  await settle()
  await update(media([], { _id: 'cl:appletv:1', handles: ['SAME_AS appletv:1', 'SAME_AS jw:1'] }))
  expect(style()).toContain(`url(${poster('kept')})`)
})

test('a card handed another title never keeps the old title\'s poster', async () => {
  const { style, settle, update } = card(media([poster('star-wars')]))
  await settle()
  await update(media([], { _id: 'cl:jw:2', title: 'Andor' }))
  expect(style()).not.toContain('url(')
  await update(media([poster('rogue-one')], { _id: 'cl:jw:3', title: 'Rogue One' }))
  expect(style()).toContain(`url(${poster('rogue-one')})`)
})

test('a card handed another title never paints the old title\'s poster, even before its effects run', async () => {
  const { style, settle, paint } = card(media([poster('star-wars')]))
  await settle()
  paint(media([], { _id: 'cl:jw:2', title: 'Andor' }))
  expect(style()).not.toContain('url(')
})

test('a card handed a sibling season never keeps the other season\'s poster', async () => {
  const { style, settle, update } = card(season(1, [poster('season-1')]))
  await settle()
  await update(season(2, []))
  expect(style()).not.toContain('url(')
})

test('a season that drew its own poster hands it to no sibling season', async () => {
  const { style, settle, update } = card(show([poster('slow-horses')]))
  await settle()
  await update(season(1, [poster('season-1')]))
  expect(style()).toContain(`url(${poster('season-1')})`)
  await update(season(2, []))
  expect(style()).not.toContain('url(')
})

test('a card forgets a poster once another title has been drawn in between', async () => {
  const { style, settle, update } = card(show([poster('slow-horses')]))
  await settle()
  await update(season(1, []))
  expect(style()).toContain(`url(${poster('slow-horses')})`)
  await update(media([], { _id: 'cl:jw:2', title: 'Andor' }))
  expect(style()).not.toContain('url(')
  await update(season(2, []))
  expect(style()).not.toContain('url(')
})

test('a card with no poster draws the first one its title gains, before it has loaded', async () => {
  const { style, swap } = card(media([]))
  swap(media([poster('late')]))
  expect(style()).toContain(`url(${poster('late')})`)
})
