// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { WatchSource } from '../../../src/components/source-selector'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(
  ['ArrowLeft', 'Check', 'ChevronDown', 'ChevronRight', 'Copy', 'Download', 'ExternalLink', 'Info', 'LayoutGrid', 'List', 'Play', 'Search', 'SlidersHorizontal', 'Sparkles', 'X'].map(name => [name, () => null]),
))
vi.mock('../../../src/components/source-popup', () => ({ default: () => null }))

const { default: QuickSourceSwitcher } = await import('../../../src/components/quick-source-switcher')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const release = (uri: string, active = false) => ({
  uri,
  label: uri,
  href: `/watch/m/e/${uri}`,
  external: false,
  active,
})

const sources: WatchSource[] = [
  { id: 'cr', name: 'Crunchyroll', href: '/watch/m/e/cr:1', external: false, active: false, videoQualities: ['1080p'] },
  {
    id: 'provider-b',
    name: 'Provider B',
    href: '/watch/m/e/provider-b:a',
    external: false,
    active: true,
    picker: { pluginUri: 'https://stub.plugins.banou.dev' },
    releases: [release('provider-b:a', true), release('provider-b:b', false)],
  },
  { id: 'hulu', name: 'Hulu', href: 'https://www.hulu.com/watch/1', external: true, active: false },
]

describe('QuickSourceSwitcher', () => {
  test('opens in unified list view, picks items, opens legacy picker, switches Cards/List view, and dismisses', () => {
    const onSelectHref = vi.fn()
    const onOpenPicker = vi.fn()
    const onClose = vi.fn()

    const host = mount(withIntl(
      <QuickSourceSwitcher
        sources={sources}
        onSelectHref={onSelectHref}
        onOpenPicker={onOpenPicker}
        onClose={onClose}
      />,
    ))
    hosts.push(host)

    const click = (target: Element) => act(() => { target.dispatchEvent(new Event('click')) })

    // Unified list view shows every item upfront without extra expand clicks
    expect(host.querySelector('button[title="provider-b:b"]')).toBeTruthy()
    expect(host.querySelector('button[title="Crunchyroll"] .tag')?.textContent).toBe('1080p')
    expect(host.querySelector('a[title="Hulu"]')?.getAttribute('target')).toBe('_blank')

    click(host.querySelector('button[title="provider-b:b"]')!)
    expect(onSelectHref).toHaveBeenCalledExactlyOnceWith('/watch/m/e/provider-b:b')

    click(host.querySelector('.picker-btn')!)
    expect(onOpenPicker).toHaveBeenCalledExactlyOnceWith(sources[1])

    // Can switch dialog between List and Cards
    const cardsBtn = [...host.querySelectorAll<HTMLButtonElement>('.view-btn')].find(btn => btn.textContent?.includes('Cards'))!
    click(cardsBtn)
    expect(host.querySelector('button[title="2 releases on Provider B"]')).toBeTruthy()

    const listBtn = [...host.querySelectorAll<HTMLButtonElement>('.view-btn')].find(btn => btn.textContent?.includes('List'))!
    click(listBtn)
    expect(host.querySelector('button[title="provider-b:b"]')).toBeTruthy()

    // Clicking inside the panel must not dismiss the overlay
    click(host.querySelector('.panel')!)
    expect(onClose).not.toHaveBeenCalled()

    act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)

    click(host.firstElementChild!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
