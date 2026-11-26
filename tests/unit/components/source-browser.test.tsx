// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import type { CatalogActionResult, CatalogItem } from '../../../src/plugin-sdk'
import type { WatchSource } from '../../../src/components/source-selector'

vi.mock('lucide-react', () => Object.fromEntries(
  ['ArrowLeft', 'Check', 'ChevronDown', 'ChevronRight', 'Copy', 'Download', 'ExternalLink', 'Info', 'LayoutGrid', 'List', 'Play', 'Search', 'SlidersHorizontal', 'Sparkles', 'X'].map(name => [name, () => null]),
))
vi.mock('../../../src/components/source-popup', () => ({ default: () => null }))

const { default: SourceBrowser } = await import('../../../src/components/source-browser')
const { default: QuickSourceSwitcher } = await import('../../../src/components/quick-source-switcher')

const hosts: HTMLElement[] = []
const restores: Array<() => void> = []

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  while (restores.length) restores.pop()!()
  vi.useRealTimers()
})

const makeSources = (): WatchSource[] => [
  {
    id: 'direct',
    name: 'Direct Stream',
    uri: 'direct:1',
    href: '/watch/m/e/direct:1',
    external: false,
    active: false,
    videoQualities: ['1080p'],
  },
  {
    id: 'archive',
    name: 'Archive Hub',
    uri: 'archive:1',
    href: '/watch/m/e/archive:1',
    external: false,
    active: true,
    hasCatalog: true,
    releases: [
      { uri: 'archive:1', label: 'Archive Item 1', href: '/watch/m/e/archive:1', external: false, active: true },
      { uri: 'archive:2', label: 'Archive Item 2', href: '/watch/m/e/archive:2', external: false, active: false },
    ],
  },
  {
    id: 'legacy',
    name: 'Legacy Source',
    uri: 'legacy:1',
    href: '/watch/m/e/legacy:1',
    external: false,
    active: false,
    picker: { pluginUri: 'https://legacy.example' },
    releases: [
      { uri: 'legacy:1', label: 'Legacy 1', href: '/watch/m/e/legacy:1', external: false, active: false },
      { uri: 'legacy:2', label: 'Legacy 2', href: '/watch/m/e/legacy:2', external: false, active: false },
    ],
  },
]

const makeCatalog = (): ReadonlyMap<string, CatalogItem> => new Map([
  [
    'archive:1',
    {
      uri: 'archive:1',
      title: 'Archive Clean 1',
      rawTitle: '[Team] Archive Item 1 [1080p]',
      subtitle: 'Team',
      resolution: 1080,
      videoQualities: ['1080p'],
      audioLanguages: ['ja'],
      subtitleLanguages: ['en'],
      sizeBytes: 900_000_000,
      publishedAt: Date.now() - 3_600_000,
      badges: [{ id: 'verified', label: 'Verified', tone: 'positive', filterable: true }],
      metrics: [{ id: 'score', label: 'Score', value: 88, sort: 'desc', tone: 'positive' }],
      actions: [
        { id: 'copy-link', label: 'Copy share link', icon: 'copy' },
        { id: 'save-file', label: 'Save metadata', icon: 'download' },
        { id: 'open-page', label: 'Open source page', icon: 'external' },
      ],
    },
  ],
  [
    'archive:2',
    {
      uri: 'archive:2',
      title: 'Archive Clean 2',
      rawTitle: '[TeamB] Archive Item 2 [720p]',
      resolution: 720,
      videoQualities: ['720p'],
      audioLanguages: ['en'],
      sizeBytes: 400_000_000,
      metrics: [{ id: 'score', label: 'Score', value: 40, sort: 'desc' }],
    },
  ],
])

describe('SourceBrowser', () => {
  test('defaults to collapsed Cards on inline view, supports folder drill-down, legacy picker, and Cards/List switching', () => {
    const location = memoryLocation({ path: '/watch/m/e/archive:1', record: true })
    const onOpenPicker = vi.fn()
    const sources = makeSources()
    const host = mount(withIntl(
      <Router hook={location.hook}>
        <SourceBrowser
          sources={sources}
          catalogItems={makeCatalog()}
          variant="inline"
          onOpenPicker={onOpenPicker}
        />
      </Router>,
    ))
    hosts.push(host)

    const click = (el: Element) => act(() => { el.dispatchEvent(new Event('click', { bubbles: true })) })

    // Inline starts on Cards view with collapsed root cards (no item list upfront)
    const cardsBtn = [...host.querySelectorAll<HTMLButtonElement>('.view-btn')].find(b => b.textContent?.includes('Cards'))!
    const listBtn = [...host.querySelectorAll<HTMLButtonElement>('.view-btn')].find(b => b.textContent?.includes('List'))!
    expect(cardsBtn.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.entries')).toBeNull()
    expect(host.querySelector('button[title="2 releases on Archive Hub"]')?.getAttribute('aria-expanded')).toBeNull()

    // Legacy multi-release without hasCatalog still invokes onOpenPicker
    click(host.querySelector('button[title="2 releases on Legacy Source"]')!)
    expect(onOpenPicker).toHaveBeenCalledWith(sources[2])

    // Modern folder card drills into scoped folder view with Back to sources
    click(host.querySelector('button[title="2 releases on Archive Hub"]')!)
    expect(host.querySelector('button.back-btn')).toBeTruthy()
    expect(host.querySelectorAll('a.release').length).toBe(2)

    click(host.querySelector('button.back-btn')!)
    expect(host.querySelector('.entries')).toBeNull()

    // Switching to List view displays unified items across all sources and supports search/filter
    click(listBtn)
    expect(listBtn.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelectorAll('.entry-row').length).toBe(5)

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    act(() => {
      search.value = 'Archive Clean 2'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelectorAll('.entry-row').length).toBe(1)
  })

  test('executes generic copy, download, open, refresh, and failure feedback with aria-live status', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async () => {})
    const origClipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    restores.push(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: origClipboard }))

    const openedUrls: string[] = []
    const origOpen = window.open
    window.open = ((url: string) => { openedUrls.push(url); return null }) as typeof window.open
    restores.push(() => { window.open = origOpen })

    const origCreateObjectURL = URL.createObjectURL
    const origRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:mock-1')
    URL.revokeObjectURL = vi.fn()
    restores.push(() => {
      URL.createObjectURL = origCreateObjectURL
      URL.revokeObjectURL = origRevokeObjectURL
    })

    const onRunAction = vi.fn(async (_origin: string, _uri: string, actionId: string): Promise<CatalogActionResult | null> => {
      if (actionId === 'copy-link') return { kind: 'copy', text: 'https://share.test/1', message: 'Copied!' }
      if (actionId === 'save-file') return { kind: 'download', filename: 'meta.txt', mimeType: 'text/plain', base64: Buffer.from('ok').toString('base64') }
      if (actionId === 'open-page') return { kind: 'open', url: 'https://info.example/1' }
      return null
    })

    const location = memoryLocation({ path: '/watch/m/e/archive:1', record: true })
    const host = mount(withIntl(
      <Router hook={location.hook}>
        <SourceBrowser
          sources={makeSources()}
          catalogItems={makeCatalog()}
          variant="inline"
          defaultView="list"
          onRunAction={onRunAction}
        />
      </Router>,
    ))
    hosts.push(host)

    const status = host.querySelector('[role="status"][aria-live="polite"]')!
    expect(status).toBeTruthy()

    const flush = () => act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const copyBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Copy share link"]')!
    await act(async () => { copyBtn.click() })
    await flush()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://share.test/1')
    expect(status.textContent).toBe('Copied!')

    const downloadBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Save metadata"]')!
    await act(async () => { downloadBtn.click() })
    await flush()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

    const openBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Open source page"]')!
    await act(async () => { openBtn.click() })
    await flush()
    expect(openedUrls).toEqual(['https://info.example/1'])

    // Failing action announces localized status and sets data-failed="true", clearing after 3s
    writeText.mockRejectedValueOnce(new Error('denied'))
    await act(async () => { copyBtn.click() })
    await flush()
    expect(copyBtn.getAttribute('data-failed')).toBe('true')
    expect(status.textContent).toBe('Could not copy text.')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(copyBtn.getAttribute('data-failed')).toBeNull()
  })

  test('paginates past 60 items and traps Tab focus inside QuickSourceSwitcher dialog', () => {
    const many: WatchSource[] = [{
      id: 'bulk',
      name: 'Bulk Source',
      href: '/watch/m/e/bulk:0',
      external: false,
      active: false,
      releases: Array.from({ length: 65 }, (_, i) => ({
        uri: `bulk:${i}`,
        label: `Item ${i}`,
        href: `/watch/m/e/bulk:${i}`,
        external: false,
        active: false,
      })),
    }]

    const location = memoryLocation({ path: '/watch/m/e/bulk:0', record: true })
    const listHost = mount(withIntl(
      <Router hook={location.hook}>
        <SourceBrowser sources={many} variant="inline" defaultView="list" />
      </Router>,
    ))
    hosts.push(listHost)
    expect(listHost.querySelectorAll('.entry-row').length).toBe(60)
    const moreBtn = listHost.querySelector<HTMLButtonElement>('.more-btn')!
    expect(moreBtn).toBeTruthy()
    act(() => { moreBtn.click() })
    expect(listHost.querySelectorAll('.entry-row').length).toBe(65)
    expect(listHost.querySelector('.more-btn')).toBeNull()

    // Updating catalogItems Map keeps expanded pagination intact instead of resetting to 60 rows
    const updatedCatalog = new Map<string, CatalogItem>([[
      'bulk:0',
      { uri: 'bulk:0', title: 'Updated Item 0', badges: [{ id: 'verified', label: 'Verified', filterable: true }] },
    ]])
    act(() => {
      render(withIntl(
        <Router hook={location.hook}>
          <SourceBrowser sources={many} catalogItems={updatedCatalog} variant="inline" defaultView="list" />
        </Router>,
      ), listHost)
    })
    expect(listHost.querySelectorAll('.entry-row').length).toBe(65)

    // Focus tracking shim for linkedom Tab trap test
    let currentFocus: Element | null = null
    const origFocus = HTMLElement.prototype.focus
    const docProto = Object.getPrototypeOf(document) as object
    const ownActiveDesc = Object.getOwnPropertyDescriptor(document, 'activeElement')
    const protoActiveDesc = ownActiveDesc ? undefined : Object.getOwnPropertyDescriptor(docProto, 'activeElement')
    HTMLElement.prototype.focus = function () { currentFocus = this }
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => currentFocus })
    restores.push(() => {
      HTMLElement.prototype.focus = origFocus
      if (ownActiveDesc) Object.defineProperty(document, 'activeElement', ownActiveDesc)
      else if (protoActiveDesc) delete (document as unknown as { activeElement?: unknown }).activeElement
      else delete (document as unknown as { activeElement?: unknown }).activeElement
    })

    const dialogHost = mount(withIntl(
      <QuickSourceSwitcher
        sources={makeSources()}
        onSelectHref={() => {}}
        onOpenPicker={() => {}}
        onClose={() => {}}
      />,
    ))
    hosts.push(dialogHost)

    const panel = dialogHost.querySelector('.panel')!
    const focusables = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])')]
    expect(focusables.length).toBeGreaterThan(2)
    expect(document.activeElement).toBe(focusables[0])

    currentFocus = focusables[focusables.length - 1]!
    act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Tab', shiftKey: false })) })
    expect(document.activeElement).toBe(focusables[0])

    currentFocus = focusables[0]!
    act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Tab', shiftKey: true })) })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  test('supports controlled view prop and clears open folder when externally switched to list', () => {
    const location = memoryLocation({ path: '/watch/m/e/archive:1', record: true })
    const onViewChange = vi.fn()
    const sources = makeSources()
    const catalog = makeCatalog()
    const tree = (view: 'cards' | 'list') => withIntl(
      <Router hook={location.hook}>
        <SourceBrowser
          sources={sources}
          catalogItems={catalog}
          variant="inline"
          view={view}
          onViewChange={onViewChange}
        />
      </Router>,
    )

    const host = mount(tree('cards'))
    hosts.push(host)
    const click = (el: Element) => act(() => { el.dispatchEvent(new Event('click', { bubbles: true })) })

    click(host.querySelector('button[title="2 releases on Archive Hub"]')!)
    expect(host.querySelector('button.back-btn')).toBeTruthy()

    const listBtn = [...host.querySelectorAll<HTMLButtonElement>('.view-btn')].find(b => b.textContent?.includes('List'))!
    click(listBtn)
    expect(onViewChange).toHaveBeenCalledWith('list')
    // Stays in Cards until parent updates controlled view prop
    expect(host.querySelector('button.back-btn')).toBeTruthy()

    act(() => { render(tree('list'), host) })
    expect(host.querySelector('.entries')).toBeTruthy()
    expect(host.querySelector('button.back-btn')).toBeNull()

    // Returning to Cards keeps activeFolder cleared
    act(() => { render(tree('cards'), host) })
    expect(host.querySelector('.entries')).toBeNull()
    expect(host.querySelector('button.back-btn')).toBeNull()
  })
})
