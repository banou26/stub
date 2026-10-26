// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Frown: () => null, Meh: () => null, Smile: () => null }))

const { default: MediaCard } = await import('../../../src/components/media-card')
const { default: MediaRow } = await import('../../../src/components/media-row')
const { MediaPreview } = await import('../../../src/components/media-preview')

const NOW = Date.parse('2026-10-26T12:00:00Z')
const HOUR = 3_600_000

// One Piece's 1180th episode two days and three hours out, as the search page's card and list modes read it
const AIRING = {
  _id: 'cl:anilist:21', uri: 'anilist:21', titles: [{ title: 'One Piece' }], covers: [], genres: ['Action', 'Adventure', 'Comedy'],
  shortDescriptions: [{ shortDescription: 'A pirate.' }], averageScore: 82, popularity: 115797, episodeCount: 1180,
  type: 'TV', status: 'RELEASING', season: 'FALL', seasonYear: 1999,
  nextAiringEpisode: { episodeNumber: 1180, airingAt: new Date(NOW + 51 * HOUR).toUTCString() },
}
const FINISHED = { ...AIRING, status: 'FINISHED', nextAiringEpisode: null, episodeCount: 1, popularity: 1 }

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
})

const draw = (vnode: preact.JSX.Element) => {
  const host = mount(<Router hook={memoryLocation().hook}>{vnode}</Router>)
  hosts.push(host)
  const text = (selector: string) => [...host.querySelectorAll(selector)].map(element => element.textContent)
  return { host, text, label: (selector: string) => host.querySelector(selector)?.getAttribute('aria-label') }
}

test('a card names the next airing, the score, the format and the episodes in English', () => {
  const card = draw(<MediaCard media={AIRING as never} to="/media/anilist:21"/>)
  expect([card.text('.airing-label'), card.text('.airing-value'), card.text('.meta'), card.text('.chip')])
    .toEqual([['Ep 1180 airing in'], ['2 days, 3 hours'], ['TV Show • 1180 episodes'], ['action', 'adventure']])
  expect([card.label('.detail-top > span'), card.text('.detail-top .value')]).toEqual(['Rated 82 percent', ['82%']])
  const finished = draw(<MediaCard media={FINISHED as never} to="/media/anilist:21"/>)
  expect([finished.text('.airing-value'), finished.text('.meta')]).toEqual([['Finished'], ['TV Show • 1 episode']])
  const unknown = draw(<MediaCard media={{ ...FINISHED, status: null, type: null, episodeCount: null } as never} to="/media/anilist:21"/>)
  expect([unknown.text('.airing-value'), unknown.text('.meta')]).toEqual([['Unknown status'], []])
})

test('a row names the score\'s users grouped, the episodes and the next airing to one unit, in English', () => {
  const row = draw(<MediaRow media={AIRING as never} to="/media/anilist:21"/>)
  expect([row.text('.score .secondary'), row.text('.format > span'), row.text('.airing'), row.text('.chip')])
    .toEqual([['115,797 users'], ['TV Show', '1180 episodes'], ['Ep 1180 airing in 2 days'], ['action', 'adventure', 'comedy']])
  expect(draw(<MediaRow media={FINISHED as never} to="/media/anilist:21"/>).text('.score .secondary, .format > span, .airing'))
    .toEqual(['1 users', 'TV Show', '1 episode'])
})

test('a row\'s preview names its episodes, and a count no source gave as a question mark', () => {
  const preview = (episodeCount: number | null) =>
    draw(<MediaPreview ref={{ current: null }} media={{ ...AIRING, trailers: [], episodeCount } as never}/>).text('.episodes')
  expect([preview(1180), preview(1), preview(null)]).toEqual([['1180 Episodes'], ['1 Episodes'], ['? Episodes']])
})
