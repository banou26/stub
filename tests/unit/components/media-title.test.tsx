// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

const { default: MediaTitle } = await import('../../../src/components/media-title')

// linkedom has no Image, which the cover probe (utils/use-cover-url.ts) loads each cover with
beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const card = (covers: { url: string }[]) => {
  const host = mount(
    <Router hook={memoryLocation().hook}>
      <MediaTitle media={{ titles: [{ language: 'en', title: 'Star Wars', score: 0.2 }], covers } as never} to="/title/jw:1"/>
    </Router>
  )
  hosts.push(host)
  return host.querySelector<HTMLElement>('.category-item')!
}

// a style of url(undefined) is a request for /undefined on the site's own origin
test('a card with no poster sets no background image', () => {
  expect(card([]).getAttribute('style') ?? '').not.toContain('url(')
})

test('a card with a poster draws it', () => {
  expect(card([{ url: 'https://images.justwatch.com/poster/45534539/s718/star-wars-episode-iv-a-new-hope.jpg' }]).getAttribute('style'))
    .toContain('url(https://images.justwatch.com/poster/45534539/s718/star-wars-episode-iv-a-new-hope.jpg)')
})
