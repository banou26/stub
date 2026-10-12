import type { Frame } from '@fkn/lib'

import { describe, expect, test } from 'vite-plus/test'

import { waitForUnavailablePage } from '../../../../src/sources/crunchyroll/unavailable-page'
import { crunchyrollPage, frameOn } from './saved-page'

// resolved once the page answers, or false when the wait outlives this window
const shows = (frame: Frame) => {
  let stopped = false
  setTimeout(() => { stopped = true }, 1_000)
  return waitForUnavailablePage(frame, () => stopped)
}

describe('a page saying no video is coming', () => {
  test('the region page Crunchyroll redirects every url to where it is not served, and not that page before it renders', async () => {
    expect(await shows(frameOn(crunchyrollPage('region-restricted.html')))).toBe(true)
    expect(await shows(frameOn(crunchyrollPage('region-restricted-server.html')))).toBe(false)
  })

  test('the blocked stream of an episode the catalogue marks unavailable, and not the empty one behind the terms dialog', async () => {
    expect(await shows(frameOn(crunchyrollPage('blocked-stream.html')))).toBe(true)
    expect(await shows(frameOn(crunchyrollPage('blocked-stream-consent.html')))).toBe(false)
  })

  test('the 404 of an episode the catalogue does not list', async () => {
    expect(await shows(frameOn(crunchyrollPage('not-found.html')))).toBe(true)
  })

  test('not the unavailable icon outside a blocked stream, where Crunchyroll also puts it on episode cards', async () => {
    expect(await shows(frameOn('<div class="erc-episode-card"><svg data-t="unavailable-svg"></svg></div>'))).toBe(false)
  })
})

describe('the wait', () => {
  test('takes a read that fails as not yet', async () => {
    let reads = 0
    const frame = { locator: () => ({ exists: async () => { if (++reads < 3) throw new Error('The page went away'); return true } }) } as unknown as Frame
    expect(await shows(frame)).toBe(true)
    expect(reads).toBe(3)
  })

  test('stops, answering false, once cancelled', async () => {
    let reads = 0
    let cancelled = false
    const frame = { locator: () => ({ exists: async () => { cancelled = ++reads === 2; return false } }) } as unknown as Frame
    expect(await waitForUnavailablePage(frame, () => cancelled)).toBe(false)
    expect(reads).toBe(2)
  })
})
