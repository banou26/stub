// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { WatchSource } from '../../../src/components/source-selector'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(
  ['ChevronDown', 'ChevronRight', 'ExternalLink', 'Play', 'SlidersHorizontal', 'X'].map(name => [name, () => null]),
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
    id: 'nyaa',
    name: 'Nyaa',
    href: '/watch/m/e/nyaa:a',
    external: false,
    active: true,
    picker: { pluginUri: 'https://stub.plugins.banou.dev' },
    releases: [release('nyaa:a', true), release('nyaa:b', false)],
  },
  { id: 'hulu', name: 'Hulu', href: 'https://www.hulu.com/watch/1', external: true, active: false },
]

describe('QuickSourceSwitcher', () => {
  test('renders sources, auto-expands active multi-release source, picks subsource, opens plugin picker, and dismisses', () => {
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

    // Active multi-release Nyaa group is auto-expanded so subsources are 1 click away
    expect(host.querySelector('button[title="nyaa:b"]')).toBeTruthy()
    expect(host.querySelector('button[title="Crunchyroll"] .tag')?.textContent).toBe('1080p')
    expect(host.querySelector('a[title="Hulu"]')?.getAttribute('target')).toBe('_blank')

    click(host.querySelector('button[title="nyaa:b"]')!)
    expect(onSelectHref).toHaveBeenCalledExactlyOnceWith('/watch/m/e/nyaa:b')

    click(host.querySelector('.picker-btn')!)
    expect(onOpenPicker).toHaveBeenCalledExactlyOnceWith(sources[1])

    // Clicking inside the panel must not dismiss the overlay
    click(host.querySelector('.panel')!)
    expect(onClose).not.toHaveBeenCalled()

    act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)

    click(host.firstElementChild!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
