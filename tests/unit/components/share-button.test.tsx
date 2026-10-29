// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { expandPath } from '../../../src/utils/share-link'
import { share } from './share'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Check: () => null, Share2: () => null }))

const { default: ShareButton, shareLink } = await import('../../../src/components/share-button')

const PAGE = 'https://anime.fkn.app/media/ag:(anilist:1)?plugins=https:stub.plugins.banou.dev&trace=1'
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const draw = () => {
  const host = mount(withIntl(<ShareButton path="/title/ag:(anilist:1,mal:1)" title="Cowboy Bebop"/>))
  hosts.push(host)
  return host.querySelector('button')!
}

test('a short link opens the path with the sources the page\'s address names, and nothing else of its query', () => {
  const link = shareLink('/title/ag:(anilist:1,mal:1)', PAGE)
  expect(link).toMatch(/^https:\/\/anime\.fkn\.app\/s\/[\w-]+$/)
  expect(expandPath(link.slice('https://anime.fkn.app/s/'.length))).toBe('/title/ag:(anilist:1,mal:1)?plugins=https:stub.plugins.banou.dev')
})

test('a path the codec cannot write, or would not shorten, is handed out as it is', () => {
  expect(shareLink('/settings', PAGE)).toBe('https://anime.fkn.app/settings?plugins=https:stub.plugins.banou.dev')
  expect(shareLink('/title/x:1', 'http://localhost:4560/')).toBe('http://localhost:4560/title/x:1')
})

test('with no share sheet, Share copies the link and says Copied for a second and a half', async () => {
  vi.useFakeTimers()
  const button = draw()
  expect(button.getAttribute('aria-label')).toBe('Share')
  const { link, opens } = await share(button, PAGE)
  expect(link).toBe(shareLink('/title/ag:(anilist:1,mal:1)', PAGE))
  expect(opens).toBe('https://anime.fkn.app/title/ag:(anilist:1,mal:1)?plugins=https:stub.plugins.banou.dev')
  expect([button.getAttribute('aria-label'), button.getAttribute('title')]).toEqual(['Copied', 'Copied'])
  await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
  expect(button.getAttribute('aria-label')).toBe('Share')
})

test('with a share sheet, Share hands it the title and the link, and copies nothing', async () => {
  const shared = vi.fn(async (_: { title?: string, url: string }) => {})
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('location', new URL(PAGE))
  vi.stubGlobal('navigator', { share: shared, clipboard: { writeText } })
  const button = draw()
  await act(async () => { button.click() })
  expect(shared).toHaveBeenCalledWith({ title: 'Cowboy Bebop', url: shareLink('/title/ag:(anilist:1,mal:1)', PAGE) })
  expect(writeText).not.toHaveBeenCalled()
  expect(button.getAttribute('aria-label')).toBe('Share')
})
