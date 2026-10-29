// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import type { DetailsMedia } from '../../../src/router/home/media-details'
import type { Tracked } from '../../../src/router/title/facts'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'
import { Client, Provider, subscriptionExchange } from 'urql'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { releaseDateLabel } from '../../../src/utils/release-date'
import { savePosition, WATCH_POSITIONS_KEY } from '../../../src/utils/watch-positions'
import { viewerIn } from '../sources/justwatch/viewer'

const fkn = vi.hoisted(() => ({ backend: 'cloud' as FknBackend }))
vi.mock('../../../src/worker', () => ({}))
vi.mock('../../../src/utils/fkn-backend', () => ({ detectBackend: async () => fkn.backend }))
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { Episodes, SourceLinks, useTrackingSummary } = await import('../../../src/router/home/media-details')
const { setIconShown } = await import('../../../src/sources/hidden-icons')
const { startLanguage } = await import('../../../src/i18n')

// a real urql client whose origins subscription answers once and stays open, as the worker's does
const client = (origins: { id: string, name: string, icon?: string }[] = [{ id: 'nf', name: 'Netflix' }]) => new Client({
  url: 'http://test/graphql',
  exchanges: [subscriptionExchange({
    forwardSubscription: () => ({
      subscribe: sink => {
        sink.next({ data: { originPage: { nodes: origins.map(origin => ({ icon: null, color: null, ...origin })) } }, hasNext: true })
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
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={media}/></Router></Provider>))
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

test('the list opens on the page holding the episode after the viewer\'s progress', () => {
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={media} tracked={{ status: 'WATCHING', progress: 12 }}/></Router></Provider>))
  hosts.push(host)
  expect(host.querySelector('.episode .number')!.textContent).toBe('13')
  expect(host.querySelector('button[aria-current="page"]')!.textContent).toBe('2')
})

describe('the bar on an episode\'s thumbnail', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const render = (shown: DetailsMedia, tracked?: Tracked) => {
    const { hook } = memoryLocation({ path: '/' })
    const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={shown} tracked={tracked}/></Router></Provider>))
    hosts.push(host)
    return host
  }
  // each row's bar, by its width, null for a row with none
  const bars = (host: HTMLElement) => [...host.querySelectorAll('.episode')].map(row => row.querySelector<HTMLElement>('.thumbnail > .bar')?.style.width ?? null)
  const full = (count: number) => Array.from({ length: count }, () => '100%')
  const none = (count: number) => Array.from({ length: count }, () => null)

  test('is full on each episode the tracking says is watched, and on no other', () => {
    expect(bars(render(media)), 'the control: no tracking').toEqual(none(12))
    expect(bars(render(media, { status: 'WATCHING', progress: 2 }))).toEqual([...full(2), ...none(10)])
    expect(bars(render(media, { status: 'COMPLETED', progress: 5 }))).toEqual(full(12))
  })

  test('is labelled Watched and says how far, with no text shown', () => {
    const host = render(media, { status: 'WATCHING', progress: 1 })
    const bar = host.querySelector('.episode .thumbnail > .bar')!
    expect([bar.getAttribute('role'), bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow')]).toEqual(['progressbar', 'Watched', '100'])
    expect(bar.textContent).toBe('')
  })

  test('is on no row when the tracking counts the media in other episodes than the page', () => {
    const counted = { ...media, episodeCount: 12 } as DetailsMedia
    expect(bars(render(counted, { status: 'WATCHING', progress: 2, episodeCount: 12 })), 'the control: the same count').toEqual([...full(2), ...none(10)])
    expect(bars(render(counted, { status: 'WATCHING', progress: 2, episodeCount: 24 }))).toEqual(none(12))
  })

  test('is on no unreleased row, Completed or not', () => {
    const airing = {
      uri: 'ag:(anilist:1)',
      status: 'RELEASING',
      episodes: media.episodes.slice(0, 3).map(episode => ({ ...episode, releaseDate: episode.episodeNumber! < 3 ? '2023-09-29' : '2099-01-01' })),
    } as unknown as DetailsMedia
    const host = render(airing, { status: 'COMPLETED', progress: 3 })
    expect(host.querySelectorAll('.episode.unreleased'), 'the control: the third is not out').toHaveLength(1)
    expect(bars(host)).toEqual([...full(2), null])
  })

  test('is as far as the newest point kept for any of the row\'s sources, and wins over the full one', () => {
    const shared = {
      ...media,
      episodes: media.episodes.map(episode => ({
        ...episode,
        handles: [...episode.handles!, { relation: 'SAME_AS', node: { uri: `cr:${episode.episodeNumber}`, origin: 'cr', url: `https://www.crunchyroll.com/watch/${episode.episodeNumber}` } }],
      })),
    } as DetailsMedia
    stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:3', 700, 1400], ['cr:4', 300, 1200], ['nf:4', 600, 1200], ['cr:1', 350, 1400], ['nf:9', 0, 0]]))
    const host = render(shared, { status: 'WATCHING', progress: 2 })
    expect(bars(host)).toEqual(['25%', '100%', '50%', '50%', null, null, null, null, null, null, null, null])
    expect(host.querySelectorAll('.episode .thumbnail > .bar')[2]!.getAttribute('aria-valuenow')).toBe('50')
  })

  test('follows a point saved while the list is open, here, in another tab or by the account', async () => {
    const host = render(media)
    expect(bars(host), 'the control: nothing kept').toEqual(none(12))
    act(() => savePosition('nf:3', { time: 700, duration: 1400 }))
    expect(bars(host)).toEqual([null, null, '50%', ...none(9)])
  })

  test('reads the sources that play the episode, not a release it is only part of', () => {
    const withRelease = (relation: string) => ({
      ...media,
      episodes: media.episodes.map(episode => ({
        ...episode,
        handles: [...episode.handles!, { relation, node: { uri: 'nyaa:season', origin: 'nyaa', url: 'magnet:?xt=urn:btih:season' } }],
      })),
    }) as DetailsMedia
    stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nyaa:season', 700, 1400]]))
    expect(bars(render(withRelease('SAME_AS'))), 'the control: a source of every row').toEqual(Array.from({ length: 12 }, () => '50%'))
    expect(bars(render(withRelease('PART_OF')))).toEqual(none(12))
  })
})

test('a later page keeps its own rows\' release: unreleased ones dimmed and not linked, released ones named by their number', () => {
  // an airing show, 1 to 19 out and 20 to 26 not, and no titles, so each row falls back to its number
  const airing = {
    uri: 'ag:(anilist:1)',
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: 20, airingAt: new Date(Date.UTC(2099, 0, 1)).toUTCString() },
    episodes: media.episodes.map(episode => ({ ...episode, titles: [], releaseDate: episode.episodeNumber! < 20 ? '2023-09-29' : '2099-01-01' })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={airing}/></Router></Provider>))
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

test('the next episode reads how long until it airs while dimmed and turns on once it has aired, and a row already out reads its date', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  // "yesterday" is the viewer's calendar, so the zone is pinned: at UTC+14 or UTC-11 the source's day is today
  const TZ = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
  try {
    vi.setSystemTime(Date.parse('2026-10-16T09:30:00Z'))
    // weekly at 14:00 UTC from October 2, or from the day before
    const third = (early = 0) => {
      const airing = {
        uri: 'ag:(anilist:195516)',
        status: 'RELEASING',
        nextAiringEpisode: { episodeNumber: 3, airingAt: 'Fri, 16 Oct 2026 14:00:00 GMT' },
        episodes: media.episodes.slice(0, 4).map(episode => ({ ...episode, releaseDate: new Date(Date.UTC(2026, 9, 2 - early + 7 * (episode.episodeNumber! - 1), 14)).toISOString() })),
      } as unknown as DetailsMedia
      const { hook } = memoryLocation({ path: '/' })
      const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={airing}/></Router></Provider>))
      hosts.push(host)
      return () => {
        const row = host.querySelectorAll('.episode')[2]!
        return { unreleased: row.classList.contains('unreleased'), date: row.querySelector('time')?.textContent }
      }
    }
    expect(third(1)(), 'a source dating it a day early does not put it out before AniList\'s time').toEqual({ unreleased: true, date: 'in 4 hours, 30 mins' })
    const onTime = third()
    expect(onTime()).toEqual({ unreleased: true, date: 'in 4 hours, 30 mins' })
    await act(() => { vi.setSystemTime(Date.parse('2026-10-16T14:00:10Z')); vi.advanceTimersByTime(30_000) })
    expect(onTime()).toEqual({ unreleased: false, date: 'today' })
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

const ZONES = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']

// episode 3 of a weekly show, AniList scheduling it at `airingAt` and the sources dating 1 to 3 by `dates`
const thirdOf = (airingAt: string, dates: string[]) => {
  const weekly = {
    uri: 'ag:(anilist:195516)',
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: 3, airingAt },
    episodes: media.episodes.slice(0, 3).map((episode, index) => ({ ...episode, releaseDate: dates[index] })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={weekly}/></Router></Provider>))
  hosts.push(host)
  return () => {
    const row = host.querySelectorAll('.episode')[2]!
    return { unreleased: row.classList.contains('unreleased'), date: row.querySelector('time')?.textContent }
  }
}

// TheTVDB, through AniZip, times So What's Wrong with Getting Reborn as a Goblin? a week after AniList (2026-10-18)
test('the next episode counts down to AniList\'s time and turns on then, though a source dates it a week later', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const TZ = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
  try {
    vi.setSystemTime(Date.parse('2026-10-16T09:30:00Z'))
    const third = thirdOf('Fri, 16 Oct 2026 14:00:00 GMT', ['2026-10-02T14:00:00Z', '2026-10-09T14:00:00Z', '2026-10-23T14:00:00Z'])
    expect(third()).toEqual({ unreleased: true, date: 'in 4 hours, 30 mins' })
    await act(() => { vi.setSystemTime(Date.parse('2026-10-16T14:00:10Z')); vi.advanceTimersByTime(30_000) })
    expect(third()).toEqual({ unreleased: false, date: 'today' })
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

// Chicago Fire 15x3 airs 21:00 ET on Oct 21 by TVmaze, which TMDB names as Oct 21 (2026-10-18)
test('a series\' first dimmed episode counts down to its best source\'s time, and a later one or a day reads its date', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const TZ = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
  try {
    vi.setSystemTime(Date.parse('2026-10-21T20:00:00Z'))
    const rowsOf = (dates: [origin: string, releaseDate: string][][]) => {
      const series = {
        uri: 'ag:(tvmaze:1)',
        status: 'RELEASING',
        episodes: dates.map((handles, index) => ({
          ...media.episodes[index],
          releaseDate: handles[0]![1],
          handles: handles.map(([origin, releaseDate]) => ({ relation: 'SAME_AS', node: { uri: `${origin}:${index + 1}`, origin, releaseDate } })),
        })),
      } as unknown as DetailsMedia
      const { hook } = memoryLocation({ path: '/' })
      const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={series}/></Router></Provider>))
      hosts.push(host)
      return () => [...host.querySelectorAll('.episode')].map(row => ({ unreleased: row.classList.contains('unreleased'), date: row.querySelector('time')?.textContent }))
    }
    const fire = rowsOf([
      [['tvmaze', '2026-10-15T01:00:00.000Z']],
      [['tmdb', '2026-10-21'], ['tvmaze', '2026-10-22T01:00:00.000Z']],
      [['tvmaze', '2026-10-29T01:00:00.000Z']],
    ])
    expect(fire()).toEqual([
      { unreleased: false, date: '7 days ago' },
      { unreleased: true, date: 'in 5 hours' },
      { unreleased: true, date: 'in 7 days' },
    ])
    await act(() => { vi.setSystemTime(Date.parse('2026-10-22T01:00:10Z')); vi.advanceTimersByTime(30_000) })
    expect(fire().slice(1)).toEqual([{ unreleased: false, date: 'today' }, { unreleased: true, date: 'in 6 days, 23 hours' }])
    const stamp = '2026-10-23T00:00:00.000Z'
    expect(rowsOf([[['appletv', stamp]]])(), 'Apple TV\'s midnight UTC names Oct 23, two days after the viewer\'s Oct 21').toEqual([{ unreleased: true, date: 'in 2 days' }])
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

// a Sunday 09:00 JST broadcast, 00:00 UTC, that Apple TV stamps as the Saturday's midnight UTC
test('the next episode reads today once AniList\'s time has come, though a source stamps the day before, in every zone', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const TZ = process.env.TZ
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone
      vi.setSystemTime(Date.parse('2026-10-18T00:00:10Z'))
      const third = thirdOf('Sun, 18 Oct 2026 00:00:00 GMT', ['2026-10-03T00:00:00.000Z', '2026-10-10T00:00:00.000Z', '2026-10-17T00:00:00.000Z'])
      expect(third(), zone).toEqual({ unreleased: false, date: 'today' })
    }
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

// a weekly anime at 23:00 JST from Friday 2026-10-02, AniList scheduling `scheduled` and AniZip dating rows by `anizip`
const weeklyAt = (episode: number) => new Date(Date.UTC(2026, 9, 2 + 7 * (episode - 1), 14)).toUTCString()
const scheduledShow = (
  { next, scheduled, anizip, count }:
  { next: number, scheduled: number[], anizip: (episode: number) => string | undefined, count: number }
) => {
  const show = {
    uri: 'ag:(anilist:195516)',
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: next, airingAt: weeklyAt(next) },
    airingSchedule: scheduled.map(episode => ({ episodeNumber: episode, airingAt: weeklyAt(episode) })),
    episodes: media.episodes.slice(0, count).map(episode => ({
      ...episode,
      titles: [],
      releaseDate: anizip(episode.episodeNumber!) ?? null,
      handles: [
        ...episode.handles,
        { relation: 'SAME_AS', node: { uri: `anizip:${episode.episodeNumber}`, origin: 'anizip', releaseDate: anizip(episode.episodeNumber!) ?? null } },
      ],
    })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={show}/></Router></Provider>))
  hosts.push(host)
  return host
}
const sides = (host: HTMLElement) => [...host.querySelectorAll('.episode')].map(row => row.querySelector('.side')!.textContent)
const dimmed = (host: HTMLElement) => [...host.querySelectorAll('.episode')].map(row => row.classList.contains('unreleased'))

// The Apothecary Diaries season 3 in Tokyo, 2026-10-19 02:10 JST: out to 3, AniList schedules 4 to 12, AniZip dates
// 4 to 8 and nothing dates 9 to 12 (measured). Added: AniZip a week late on 5, and two undated rows past the schedule.
test('an unreleased row AniList schedules reads when it airs, worded like a released one, by AniList\'s time', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const TZ = process.env.TZ
  process.env.TZ = 'Asia/Tokyo'
  try {
    vi.setSystemTime(Date.parse('2026-10-18T17:10:00Z'))
    const host = scheduledShow({
      next: 4,
      scheduled: [4, 5, 6, 7, 8, 9, 10, 11, 12],
      anizip: episode => episode <= 8 ? new Date(weeklyAt(episode === 5 ? 6 : episode)).toISOString() : undefined,
      count: 14,
    })
    expect(sides(host)).toEqual([
      '17 days ago', '10 days ago', '3 days ago', 'in 4 days, 20 hours',
      'in 11 days', 'in 18 days', 'in 25 days', 'Nov 20, 2026', 'Nov 27, 2026', 'Dec 4, 2026', 'Dec 11, 2026', 'Dec 18, 2026',
    ])
    expect(dimmed(host)).toEqual([false, false, false, ...Array(9).fill(true)])
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Page 2"]')!.click() })
    expect(sides(host), 'the control: a row nobody dates reads nothing').toEqual(['', ''])
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

test('once AniList\'s next episode airs, the one after counts down to AniList\'s time, though a source times it later', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    vi.setSystemTime(Date.parse('2026-10-23T13:00:00Z'))
    const host = scheduledShow({
      next: 4,
      scheduled: [4, 5, 6],
      anizip: episode => new Date(Date.parse(weeklyAt(episode)) + (episode === 5 ? 7_200_000 : 0)).toISOString(),
      count: 6,
    })
    expect(sides(host).slice(3, 5), 'the control: before it airs').toEqual(['in 1 hour', 'in 7 days'])
    await act(() => { vi.setSystemTime(Date.parse('2026-10-23T14:00:10Z')); vi.advanceTimersByTime(30_000) })
    expect(dimmed(host).slice(3, 5)).toEqual([false, true])
    expect(sides(host).slice(4, 5)).toEqual(['in 6 days, 23 hours'])
  } finally {
    vi.useRealTimers()
  }
})

// a page left open two weeks: AniList's next and the one after aired, and only the next is out until a refetch
test('a dimmed row whose scheduled time has passed reads nothing, not how long ago', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    vi.setSystemTime(Date.parse('2026-10-23T13:00:00Z'))
    const host = scheduledShow({
      next: 4,
      scheduled: [4, 5, 6],
      anizip: episode => episode < 4 ? new Date(weeklyAt(episode)).toISOString() : undefined,
      count: 6,
    })
    expect(sides(host).slice(3), 'the control: before they air').toEqual(['in 1 hour', 'in 7 days', 'in 14 days'])
    await act(() => { vi.setSystemTime(Date.parse('2026-11-06T15:00:00Z')); vi.advanceTimersByTime(30_000) })
    expect(dimmed(host).slice(3)).toEqual([false, true, true])
    expect(sides(host).slice(4)).toEqual(['', ''])
  } finally {
    vi.useRealTimers()
  }
})

// a weekly broadcast a platform put out all at once: AniList still schedules 5 and 6, a source has every episode out
test('AniList\'s schedule never dims or redates a row a source has out', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const TZ = process.env.TZ
  process.env.TZ = 'Asia/Tokyo'
  try {
    vi.setSystemTime(Date.parse('2026-10-18T17:10:00Z'))
    const host = scheduledShow({ next: 5, scheduled: [5, 6], anizip: () => '2026-10-01', count: 6 })
    expect(dimmed(host), 'AniList\'s next stays dim, as its own time rules').toEqual([false, false, false, false, true, false])
    expect(sides(host)[5], 'and a row out reads its own date').toBe('18 days ago')
  } finally {
    vi.useRealTimers()
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
})

// Reincarnated as a Sword season 2's 4 as AniZip once timed it: out by AniList's next, dated a week late
test('a row that is out never reads as ahead, though its source dates it later', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    vi.setSystemTime(Date.parse('2026-10-24T17:10:00Z'))
    const late = new Date(weeklyAt(5)).toISOString()
    const host = scheduledShow({ next: 5, scheduled: [5], anizip: episode => episode === 4 ? late : new Date(weeklyAt(episode)).toISOString(), count: 5 })
    expect(dimmed(host)).toEqual([false, false, false, false, true])
    expect(sides(host)[3]).toBe(releaseDateLabel(late))
  } finally {
    vi.useRealTimers()
  }
})

test('a released row with no title is named by its number and keeps its synopsis and source icons', async () => {
  const untitled = {
    uri: 'ag:(anilist:1)',
    episodes: media.episodes.slice(0, 2).map((episode, index) => ({
      ...episode,
      titles: index ? [] : episode.titles,
      shortDescriptions: [{ shortDescription: `Synopsis ${index + 1}.` }],
    })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={untitled}/></Router></Provider>))
  hosts.push(host)
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  expect([...host.querySelectorAll('.episode')].map(row => ({
    title: row.querySelector('.title')!.textContent,
    description: row.querySelector('.description')?.textContent,
    icons: row.querySelectorAll('.src').length,
  }))).toEqual([
    { title: 'Episode 1', description: 'Synopsis 1.', icons: 1 },
    { title: 'Episode 2', description: 'Synopsis 2.', icons: 1 },
  ])
})

// an anime episode airing at 09:00 in Tokyo is 00:00 UTC: an instant, unlike a film's release day
test('an episode airing at midnight UTC shows the day it aired where the viewer is', () => {
  const TZ = process.env.TZ
  const dawn = { uri: 'ag:(anilist:1)', episodes: [{ ...media.episodes[0], releaseDate: '2024-01-07T00:00:00Z' }] } as unknown as DetailsMedia
  try {
    for (const [zone, day] of [['America/Los_Angeles', '2024-01-06'], ['Asia/Tokyo', '2024-01-07']] as const) {
      process.env.TZ = zone
      const { hook } = memoryLocation({ path: '/' })
      const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={dawn}/></Router></Provider>))
      hosts.push(host)
      expect(host.querySelector('.episode time')?.textContent, zone).toBe(releaseDateLabel(day))
    }
  } finally {
    if (TZ === undefined) delete process.env.TZ
    else process.env.TZ = TZ
  }
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
    const host = mount(withIntl(<Provider value={client([{ id: 'amazon', name: 'Prime Video' }])}><Router hook={hook}><Episodes media={prime}/></Router></Provider>))
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
    return host.querySelector('.episode .src')?.getAttribute('href')
  }
  expect(await hrefOn('extension')).toBe('/watch/ag:(anilist:1)/ag:(amazon:amzn1.dv.gti.1)/amazon:amzn1.dv.gti.1')
  expect(await hrefOn('cloud')).toBe(url)
})

// a browser opens no magnet, so a torrent plugin's lone release plays on the watch page, as a film's does
test('an episode row\'s lone release a browser cannot open goes to the watch page, and one on the web links out', async () => {
  const torrents = {
    uri: 'ag:(anilist:1)',
    episodes: [['a', 'magnet:?xt=urn:btih:a'], ['b', 'https://nyaa.si/view/b']].map(([id, url], index) => ({
      uri: `ag:(nyaa:${id})`, episodeNumber: index + 1, releaseDate: '2023-09-29', titles: [{ title: `Episode ${index + 1}` }],
      handles: [{ relation: 'SAME_AS', node: { uri: `nyaa:${id}`, origin: 'nyaa', url } }],
    })),
  } as unknown as DetailsMedia
  const { hook } = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Provider value={client([{ id: 'nyaa', name: 'Nyaa' }])}><Router hook={hook}><Episodes media={torrents}/></Router></Provider>))
  hosts.push(host)
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  expect([...host.querySelectorAll('.episode .src')].map(link => ({ href: link.getAttribute('href'), target: link.getAttribute('target') }))).toEqual([
    { href: '/watch/ag:(anilist:1)/ag:(nyaa:a)/nyaa:a', target: null },
    { href: 'https://nyaa.si/view/b', target: '_blank' },
  ])
})

describe('a media with no episode rows', () => {
  const empty = (fields: Record<string, unknown>) => ({ uri: 'ag:(anilist:1)', episodes: [], ...fields }) as unknown as DetailsMedia
  const render = (shown: DetailsMedia) => {
    const { hook } = memoryLocation({ path: '/' })
    const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={shown}/></Router></Provider>))
    hosts.push(host)
    return host
  }

  test('says No episodes found once every source has answered with none', () => {
    const host = render(empty({ settled: true, episodeCount: 1 }))
    expect(host.querySelector('.episodes')!.textContent).toBe('No episodes found')
    expect(host.querySelectorAll('.episode')).toHaveLength(0)
  })

  test('draws placeholder rows, as many as the episode count says, while a source is still out', () => {
    const host = render(empty({ settled: false, episodeCount: 5 }))
    expect(host.textContent).not.toContain('No episodes found')
    expect(host.querySelectorAll('.episode.placeholder')).toHaveLength(5)
  })

  test('the control: rows are drawn and the message never is, settled or not', () => {
    const host = render({ ...media, settled: true } as DetailsMedia)
    expect(host.querySelectorAll('.episode:not(.placeholder)')).toHaveLength(12)
    expect(host.textContent).not.toContain('No episodes found')
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Episodes pages')
  })
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

describe('a hidden source icon', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('leaves the source links', async () => {
    const origins = [
      { id: 'anilist', name: 'AniList', icon: 'https://anilist.co/i.png' },
      { id: 'tvdb', name: 'TheTVDB', icon: 'https://thetvdb.com/i.png' },
    ]
    const handles = [
      { relation: 'SAME_AS', node: { origin: 'anilist', url: 'https://anilist.co/anime/1' } },
      { relation: 'SAME_AS', node: { origin: 'tvdb', url: 'https://thetvdb.com/series/1' } },
    ]
    const draw = async () => {
      const host = mount(<Provider value={client(origins)}><SourceLinks uri="ag:(anilist:1,tvdb:1)" handles={handles}/></Provider>)
      hosts.push(host)
      await act(() => new Promise(resolve => setTimeout(resolve, 10)))
      return [...host.querySelectorAll('.origin')].map(origin => origin.getAttribute('title'))
    }
    expect(await draw(), 'the control: both drawn while shown').toEqual(['AniList', 'TheTVDB'])
    setIconShown('tvdb', false)
    expect(await draw()).toEqual(['AniList'])
  })

  // the five are counted after the hidden ones leave, so a hidden icon never takes one of them
  test('leaves an episode row its five icons', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const six = {
      uri: 'ag:(anilist:1)',
      episodes: [{ ...media.episodes[0], handles: ids.map(id => ({ relation: 'SAME_AS', node: { uri: `${id}:1`, origin: id, url: `https://${id}.example/1` } })) }],
    } as unknown as DetailsMedia
    const draw = async () => {
      const { hook } = memoryLocation({ path: '/' })
      const host = mount(withIntl(<Provider value={client(ids.map(id => ({ id, name: id.toUpperCase() })))}><Router hook={hook}><Episodes media={six}/></Router></Provider>))
      hosts.push(host)
      await act(() => new Promise(resolve => setTimeout(resolve, 10)))
      return [...host.querySelectorAll('.episode .src')].map(src => src.getAttribute('title'))
    }
    expect(await draw(), 'five of the six while all are shown').toEqual(['Watch on A', 'Watch on B', 'Watch on C', 'Watch on D', 'Watch on E'])
    setIconShown('b', false)
    expect(await draw()).toEqual(['Watch on A', 'Watch on C', 'Watch on D', 'Watch on E', 'Watch on F'])
  })
})

describe('the streaming links after the source icons', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const ORIGINS = [
    { id: 'anilist', name: 'AniList', icon: 'https://anilist.co/i.png', url: 'https://anilist.co' },
    { id: 'nf', name: 'Netflix', icon: 'https://www.netflix.com/i.png', url: 'https://www.netflix.com' },
    { id: 'kitsu', name: 'Kitsu', icon: 'https://kitsu.io/i.png', url: 'https://kitsu.io', isApiOnly: true },
  ]
  const idsOf = (request: { variables?: unknown }) => (request.variables as { input: { ids: string[] } }).input.ids
  // the worker's answer for the ids asked, and only those
  const answer = (ids: readonly string[]) =>
    ({ data: { originPage: { nodes: ORIGINS.filter(origin => ids.includes(origin.id)).map(origin => ({ color: null, isApiOnly: false, ...origin })) } }, hasNext: true })
  const answering = () => new Client({
    url: 'http://test/graphql',
    exchanges: [subscriptionExchange({
      forwardSubscription: request => ({
        subscribe: sink => {
          sink.next(answer(idsOf(request)))
          return { unsubscribe: () => {} }
        },
      }),
    })],
  })
  const drawnIn = async (host: HTMLElement) => {
    await act(() => new Promise(resolve => setTimeout(resolve, 10)))
    return [...host.querySelectorAll<HTMLAnchorElement>('.origin')].map(origin => `${origin.title} ${origin.href}`)
  }
  const draw = (handles: { relation: string, node: { origin: string, url: string } }[], links: { site: string, url: string, icon?: string, country?: string }[]) => {
    const host = mount(<Provider value={answering()}><SourceLinks uri="ag:(anilist:191656)" handles={handles} links={links}/></Provider>)
    hosts.push(host)
    return drawnIn(host)
  }
  const ANILIST = { relation: 'SAME_AS', node: { origin: 'anilist', url: 'https://anilist.co/anime/191656' } }
  const NETFLIX = { relation: 'SAME_AS', node: { origin: 'nf', url: 'https://www.netflix.com/title/82616221' } }

  // as JustWatch, AniList and MyAnimeList name Even the Student Council Has Its Holes! for a viewer in Japan, with a
  // Netflix link and a Netflix icon beside
  test('are the viewer\'s country\'s and those naming none, one per site, and none on a source icon\'s site', async () => {
    viewerIn('Asia/Tokyo')
    expect(await draw([ANILIST, NETFLIX], [
      { site: 'Hulu', url: 'https://www.hulu.jp/watch/100276501', icon: 'https://images.justwatch.com/icon/116305230/s100/hulu.webp', country: 'JP' },
      { site: 'OceanVeil', url: 'https://oceanveil.net/anime_titles/542' },
      { site: 'Netflix', url: 'https://www.netflix.com/title/1' },
      { site: 'Hulu', url: 'https://www.hulu.jp/watch/100276501', country: 'JP' },
      { site: 'OceanVeil', url: 'https://oceanveil.net/ad?agn=2&src=8&pattern=MAL&url=/lp' },
      { site: 'Watcha', url: 'https://watcha.com/contents/tRzLxAV', country: 'KR' },
      { site: 'Bahamut Anime Crazy', url: 'https://ani.gamer.com.tw/' },
    ])).toEqual([
      'AniList https://anilist.co/anime/191656',
      'Netflix https://www.netflix.com/title/82616221',
      'Hulu https://www.hulu.jp/watch/100276501',
      'OceanVeil https://oceanveil.net/anime_titles/542',
      'Bahamut Anime Crazy https://ani.gamer.com.tw/',
    ])
  })

  // Until the worker answers for a source just named, the answer shown is the one before it: the modal drew its links
  // beside no icon that way (tests/title-page.spec.ts, 2026-10-29)
  test('wait for the answer naming every source asked, so none stands for a site whose icon is on its way', async () => {
    const held: (() => void)[] = []
    const holding = new Client({
      url: 'http://test/graphql',
      exchanges: [subscriptionExchange({
        forwardSubscription: request => ({
          subscribe: sink => {
            const ids = idsOf(request)
            if (ids.includes('nf')) held.push(() => sink.next(answer(ids)))
            else sink.next(answer(ids))
            return { unsubscribe: () => {} }
          },
        }),
      })],
    })
    let name: (handles: { relation: string, node: { origin: string, url: string } }[]) => void = () => {}
    const Named = () => {
      const [handles, setHandles] = useState([ANILIST])
      name = setHandles
      return <SourceLinks uri="ag:(anilist:191656)" handles={handles} links={[{ site: 'Netflix', url: 'https://www.netflix.com/title/1' }]}/>
    }
    const host = mount(<Provider value={holding}><Named/></Provider>)
    hosts.push(host)
    expect(await drawnIn(host), 'the control: no Netflix icon, so the link').toEqual(['AniList https://anilist.co/anime/191656', 'Netflix https://www.netflix.com/title/1'])
    act(() => name([ANILIST, NETFLIX]))
    expect(await drawnIn(host), 'while Netflix is asked about').toEqual(['AniList https://anilist.co/anime/191656'])
    act(() => { for (const answer of held) answer() })
    expect(await drawnIn(host)).toEqual(['AniList https://anilist.co/anime/191656', 'Netflix https://www.netflix.com/title/82616221'])
  })

  // A worker just started answers before its sources have said who they are, then again once they have, on their 50 ms
  // batch (src/worker/store/db.ts findOrigins, src/worker/extractor.ts originInserter); the title page drew its links
  // before its icons that way (tests/title-page.spec.ts, 2026-10-30)
  test('wait for every source\'s row, so none is drawn before the icons or on a source\'s own site', async () => {
    const later: (() => void)[] = []
    const cold = new Client({
      url: 'http://test/graphql',
      exchanges: [subscriptionExchange({
        forwardSubscription: request => ({
          subscribe: sink => {
            sink.next(answer([]))
            later.push(() => sink.next(answer(idsOf(request))))
            return { unsubscribe: () => {} }
          },
        }),
      })],
    })
    const links = [{ site: 'Netflix', url: 'https://www.netflix.com/title/1' }, { site: 'iQ', url: 'https://www.iq.com/album/1' }]
    const host = mount(<Provider value={cold}><SourceLinks uri="ag:(anilist:191656)" handles={[ANILIST, NETFLIX]} links={links}/></Provider>)
    hosts.push(host)
    expect(await drawnIn(host), 'before the sources have answered').toEqual([])
    act(() => { for (const answer of later) answer() })
    expect(await drawnIn(host)).toEqual(['AniList https://anilist.co/anime/191656', 'Netflix https://www.netflix.com/title/82616221', 'iQ https://www.iq.com/album/1'])
  })

  test('none is on the site of a source whose icon the viewer hid', async () => {
    const links = [{ site: 'Netflix', url: 'https://www.netflix.com/title/1' }, { site: 'iQ', url: 'https://www.iq.com/album/28ki6pjn6a1' }]
    expect(await draw([ANILIST], links), 'the control: shown while no Netflix icon stands for it').toEqual([
      'AniList https://anilist.co/anime/191656', 'Netflix https://www.netflix.com/title/1', 'iQ https://www.iq.com/album/28ki6pjn6a1',
    ])
    setIconShown('nf', false)
    expect(await draw([ANILIST], links)).toEqual(['AniList https://anilist.co/anime/191656', 'iQ https://www.iq.com/album/28ki6pjn6a1'])
  })

  // the rows are asked unfiltered, so the links can wait for every one
  test('an API-only source has no icon', async () => {
    const kitsu = { relation: 'SAME_AS', node: { origin: 'kitsu', url: 'https://kitsu.io/anime/1' } }
    expect(await draw([ANILIST, kitsu], [{ site: 'iQ', url: 'https://www.iq.com/album/1' }])).toEqual([
      'AniList https://anilist.co/anime/191656', 'iQ https://www.iq.com/album/1',
    ])
  })
})

describe('in German', () => {
  beforeEach(() => startLanguage({ language: 'de', languages: ['de-DE'] }))
  afterEach(() => startLanguage({ language: 'en', languages: ['en-US'] }))
  const render = (shown: DetailsMedia, tracked?: Tracked) => {
    const { hook } = memoryLocation({ path: '/' })
    const host = mount(withIntl(<Provider value={client()}><Router hook={hook}><Episodes media={shown} tracked={tracked}/></Router></Provider>))
    hosts.push(host)
    return host
  }

  test('a row\'s fallback title, its bar, its countdown and its day read German', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-16T09:30:00Z'), toFake: ['Date'] })
    try {
      const airing = {
        uri: 'ag:(anilist:195516)',
        status: 'RELEASING',
        nextAiringEpisode: { episodeNumber: 3, airingAt: 'Fri, 16 Oct 2026 14:00:00 GMT' },
        episodes: media.episodes.slice(0, 4).map((episode, index) => ({ ...episode, titles: [], releaseDate: ['2026-10-02T14:00:00Z', '2026-10-16T08:00:00Z', '2026-10-16T14:00:00Z', '2026-10-23T14:00:00Z'][index] })),
      } as unknown as DetailsMedia
      const host = render(airing, { status: 'WATCHING', progress: 1 })
      const rows = [...host.querySelectorAll('.episode')]
      expect(rows.map(row => row.querySelector('.title')!.textContent)).toEqual(['Folge 1', 'Folge 2', 'Unveröffentlichte Folge', 'Unveröffentlichte Folge'])
      expect(rows.slice(1).map(row => row.querySelector('time')?.textContent)).toEqual(['heute', 'noch 4 Stunden, 30 Min.', 'in 7 Tagen'])
      expect(host.querySelector('.thumbnail > .bar')?.getAttribute('aria-label')).toBe('Gesehen')
    } finally {
      vi.useRealTimers()
    }
  })

  test('the list\'s pages and an empty list read German', () => {
    expect(render(media).querySelector('nav')?.getAttribute('aria-label')).toMatch(/^Folgen /)
    expect(render({ uri: 'ag:(anilist:1)', episodes: [], settled: true } as unknown as DetailsMedia).querySelector('.episodes')!.textContent).toBe('Keine Folgen gefunden')
  })
})
