// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// urql is faked as one stream: `publish` answers the subscription the page is running
const stream = vi.hoisted(() => ({ data: undefined as unknown, listeners: new Set<() => void>() }))
vi.mock('urql', async () => {
  const { useEffect, useState } = await import('preact/hooks')
  return {
    useSubscription: () => {
      const [, setRenders] = useState(0)
      useEffect(() => {
        const render = () => setRenders(count => count + 1)
        stream.listeners.add(render)
        return () => { stream.listeners.delete(render) }
      }, [])
      return [{ data: stream.data }]
    },
  }
})
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(['Frown', 'ImageIcon', 'LucidePlay', 'Meh', 'Search', 'Smile', 'X'].map(name => [name, () => null])))
vi.mock('../../../src/worker', () => ({ searchScene: async () => ({ matches: [] }) }))
vi.mock('../../../src/components/display-mode-toggle', () => ({ default: () => null }))
vi.mock('../../../src/components/filter-select', () => ({
  default: () => null,
  FilterField: ({ children }: { children: unknown }) => children,
}))

const { default: Search } = await import('../../../src/router/search')

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
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
  stream.data = undefined
})

const poster = (name: string) => `https://cdn.myanimelist.net/images/anime/${name}.jpg`
const media = (_id: string, title: string, { covers = [poster(_id.slice(3))], handles = [`SAME_AS ${_id.slice(3)}`] } = {}) => ({
  _id,
  uri: `ag:(${_id.slice(3)})`,
  titles: [{ language: 'en', title, score: 0.2 }],
  covers: covers.map(url => ({ language: 'en', url })),
  handles: handles.map(handle => ({ relation: handle.split(' ')[0], node: { uri: handle.split(' ')[1] } })),
})

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))

const open = async (mode: string, nodes: object[]) => {
  vi.stubGlobal('localStorage', { getItem: () => mode, setItem: () => {} })
  const location = memoryLocation({ path: '/search?season=SPRING&year=2026' })
  const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><Search/></Router>)
  hosts.push(host)
  const cards = () => [...host.querySelectorAll<HTMLElement>('.grid > *, .cards > *, .rows > *')]
  const answer = (next: object[]) => {
    stream.data = { mediaPage: { nodes: next } }
    for (const listener of stream.listeners) listener()
  }
  const publish = async (next: object[]) => {
    act(() => answer(next))
    await settle()
  }
  await publish(nodes)
  return {
    cards,
    posters: () => cards().map(card => [
      card.querySelector('.title')?.textContent,
      (card.querySelector('.cover') ?? card).getAttribute('style')?.match(/url\(([^)]*)\)/)?.[1],
    ]),
    publish,
    // outside act, so the cards are painted before their effects run, as a browser paints them
    paint: async (next: object[]) => {
      answer(next)
      await Promise.resolve()
    },
  }
}

const breakTime = media('cl:mal:63830', 'Re:ZERO Starting Break Time From Zero Season 4')

describe.each(['grid', 'card', 'list'])('search results drawn as %s', mode => {
  test('a merge that gives a result a new id keeps its card, and the poster it drew', async () => {
    const page = await open(mode, [media('cl:mal:61316', 'Re:ZERO Season 4'), breakTime])
    const [card] = page.cards()
    expect(page.posters()[0]).toEqual(['Re:ZERO Season 4', poster('mal:61316')])

    await page.publish([
      media('cl:kitsu:49746', 'Re:ZERO Season 4', { covers: [], handles: ['SAME_AS kitsu:49746', 'SAME_AS mal:61316'] }),
      breakTime,
    ])
    expect(page.posters()[0]).toEqual(['Re:ZERO Season 4', poster('mal:61316')])
    expect(page.cards()[0]).toBe(card)
  })

  test('a reordered list draws each title\'s own poster, and none on a title that has none', async () => {
    const page = await open(mode, [media('cl:mal:61316', 'Re:ZERO Season 4'), breakTime])
    const own = [
      ['Re:ZERO Starting Break Time From Zero Season 4', poster('mal:63830')],
      ['Witch Hat Atelier', undefined],
    ]
    await page.paint([breakTime, media('cl:mal:62001', 'Witch Hat Atelier', { covers: [] })])
    expect(page.posters(), 'as first painted').toEqual(own)
    await settle()
    expect(page.posters()).toEqual(own)
  })

  // Measured live on /search?season=FALL&year=2026, 2026-10-16: a merge with Kitsu moved the title 27
  // places and put Kitsu's expired signed url first, and the card it landed on painted that, blank, for
  // up to 0.8 s
  test('a title a merge moves keeps the poster it drew while a broken new first cover is probed', async () => {
    const expired = 'https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/50208/poster_image/expired.jpg'
    broken.add(expired)
    const hotel = (covers: string[], handles: string[]) => media('cl:mal:62590', 'Hotel Inhumans 2nd Season', { covers, handles })
    const page = await open(mode, [hotel([poster('mal:62590')], ['SAME_AS mal:62590']), breakTime])
    await page.paint([breakTime, hotel([expired, poster('mal:62590')], ['SAME_AS mal:62590', 'SAME_AS kitsu:50208'])])
    expect(page.posters()[1], 'as first painted').toEqual(['Hotel Inhumans 2nd Season', poster('mal:62590')])
    await settle()
    expect(page.posters()[1]).toEqual(['Hotel Inhumans 2nd Season', poster('mal:62590')])
  })

  test('a season that lands in its show\'s place draws no poster of the show\'s', async () => {
    const page = await open(mode, [media('cl:mal:31240', 'Re:ZERO -Starting Life in Another World-'), breakTime])
    await page.publish([
      media('cl:mal:61316', 'Re:ZERO Season 4', { covers: [], handles: ['SAME_AS mal:61316', 'PART_OF mal:31240'] }),
      breakTime,
    ])
    expect(page.posters()[0]).toEqual(['Re:ZERO Season 4', undefined])
  })
})
