// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

const { default: MediaSeasons } = await import('../../../src/components/media-seasons')

const SEASONS = [1, 2, 3].map(number => ({ number, uri: `tmdb:93405-s${number}` }))

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const render = (seasons: typeof SEASONS | null, currentUris = ['tmdb:93405-s2', 'tvmaze:43687-s2']) => {
  const { hook, history } = memoryLocation({ path: '/title/tmdb:93405', record: true })
  const host = mount(withIntl(
    <Router hook={hook}>
      <MediaSeasons seasons={seasons} currentUris={currentUris} href={uri => `/title/${uri}`}/>
    </Router>
  ))
  hosts.push(host)
  return { host, history }
}

// a bare `tmdb:93405-s1` is answered by TMDB alone: the sources that find a work by its title (JustWatch, uNoGS, Apple TV)
// search only for an aggregated address
test('each season links its own run as a cluster, and the one on screen is marked', () => {
  const { host, history } = render(SEASONS)
  const links = [...host.querySelectorAll('[data-seasons] a')]
  expect(links.map(link => link.textContent)).toEqual(['Season 1', 'Season 2', 'Season 3'])
  expect(links.map(link => link.getAttribute('href'))).toEqual(['/title/ag:(tmdb:93405-s1)', '/title/ag:(tmdb:93405-s2)', '/title/ag:(tmdb:93405-s3)'])
  expect(links.map(link => link.getAttribute('aria-current'))).toEqual([null, 'page', null])
  expect(history).toEqual(['/title/tmdb:93405'])
})

test('the show\'s own page, with no season on screen, is replaced by its first season as a cluster', () => {
  expect(render(SEASONS, ['tmdb:93405', 'tvmaze:43687']).history).toEqual(['/title/ag:(tmdb:93405-s1)'])
})

test('a show with one season draws no Seasons row', () => {
  expect(render(SEASONS.slice(0, 1)).host.querySelector('[data-seasons]')).toBeNull()
  expect(render(null).host.querySelector('[data-seasons]')).toBeNull()
})

// HOR-1058: the watch page lists another season without leaving the episode playing
test('picked in place, each season is a button handing over its uri, the one shown pressed, and the address never moves', () => {
  const picked: string[] = []
  const { hook, history } = memoryLocation({ path: '/watch/ag:(tmdb:93405-s2)/ag:(tmdb:93405-s2e1)', record: true })
  const host = mount(withIntl(
    <Router hook={hook}>
      <MediaSeasons seasons={SEASONS} currentUris={['tmdb:93405']} onPick={uri => picked.push(uri)}/>
    </Router>
  ))
  hosts.push(host)
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-seasons] button')]
  expect(buttons.map(season => [season.textContent, season.getAttribute('aria-pressed')])).toEqual([['Season 1', 'false'], ['Season 2', 'false'], ['Season 3', 'false']])
  act(() => { buttons[2]!.click() })
  expect(picked).toEqual(['tmdb:93405-s3'])
  expect(history, 'no season on screen, and still no redirect').toEqual(['/watch/ag:(tmdb:93405-s2)/ag:(tmdb:93405-s2e1)'])
  expect(host.querySelector('[data-seasons] a')).toBeNull()
})
