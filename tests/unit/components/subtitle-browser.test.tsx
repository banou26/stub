// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { SubtitleCandidate } from '../../../src/subtitles'

import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'Check', 'Search', 'SlidersHorizontal', 'X'].map(name => [name, () => null]),
))

const { default: SubtitleBrowser } = await import('../../../src/components/subtitle-browser')

const hosts: HTMLElement[] = []
const restoreFocus: (() => void)[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  while (restoreFocus.length) restoreFocus.pop()!()
  vi.useRealTimers()
})

const CANDIDATES: SubtitleCandidate[] = [
  {
    id: 'os-en',
    language: 'en',
    label: 'English (OpenSubtitles)',
    format: 'srt',
    url: 'https://subs5.strem.io/1.srt',
    source: 'opensubtitles',
    sourceName: 'OpenSubtitles',
    release: 'Movie.2024.1080p.WEB-DL',
    group: 'NTb',
    hearingImpaired: true,
  },
  {
    id: 'pl-ja',
    language: 'ja',
    label: 'Japanese (CustomSubs)',
    format: 'ass',
    source: 'plugin',
    sourceName: 'CustomSubs',
    pluginOrigin: 'customsubs',
    remoteTrackId: '1',
    release: 'Movie.2024.JA.ASS',
  },
]

const pickSelect = (select: HTMLSelectElement, value: string) => {
  Object.defineProperty(select, 'value', { configurable: true, value })
  select.dispatchEvent(new Event('change'))
}

const click = (target: Element) => act(() => { target.dispatchEvent(new Event('click')) })

describe('SubtitleBrowser', () => {
  test('auto-loads results, filters by language and source, picks a subtitle, triggers plugin pickers, and dismisses', async () => {
    const search = vi.fn(async (query: string) =>
      query.trim() === 'empty'
        ? []
        : query.trim() === 'japanese'
          ? [CANDIDATES[1]!]
          : CANDIDATES,
    )
    const onPick = vi.fn()
    const onOpenPluginPicker = vi.fn()
    const onClose = vi.fn()

    const originalFocus = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
    let focusedElement: unknown = null
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      writable: true,
      value() { focusedElement = this },
    })
    restoreFocus.push(() => {
      if (originalFocus) Object.defineProperty(HTMLElement.prototype, 'focus', originalFocus)
      else Reflect.deleteProperty(HTMLElement.prototype, 'focus')
    })

    const host = mount(withIntl(
      <SubtitleBrowser
        locale="en"
        activeId="os-en"
        pluginPickers={[{ origin: 'customsubs', name: 'CustomSubs' }]}
        search={search}
        onPick={onPick}
        onOpenPluginPicker={onOpenPluginPicker}
        onClose={onClose}
      />,
    ))
    hosts.push(host)

    await vi.waitFor(() => expect(host.querySelectorAll('.item')).toHaveLength(2))
    expect(search).toHaveBeenCalledWith('', expect.any(AbortSignal))
    expect(focusedElement).toBe(host.querySelector('.search-input'))
    expect(host.querySelector('.item.active')?.textContent).toContain('Movie.2024.1080p.WEB-DL')

    // Typing keys inside the panel does not bubble to parent shortcuts outside the dialog
    const parentKeys: string[] = []
    const onParentKey = (event: KeyboardEvent) => { parentKeys.push(event.key) }
    document.body.addEventListener('keydown', onParentKey)
    restoreFocus.push(() => document.body.removeEventListener('keydown', onParentKey))
    act(() => {
      host.querySelector('.panel')!.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true }), { key: 'k' }))
    })
    expect(parentKeys).toEqual([])

    // Language filter narrows results to Japanese
    const selects = [...host.querySelectorAll<HTMLSelectElement>('select.select')]
    const langSelect = selects[0]!
    const sourceSelect = selects[1]!
    act(() => { pickSelect(langSelect, 'ja') })
    expect(host.querySelectorAll('.item')).toHaveLength(1)
    expect(host.querySelector('.item')?.textContent).toContain('Movie.2024.JA.ASS')

    // Reset language filter and filter by source instead
    act(() => {
      pickSelect(langSelect, '')
      pickSelect(sourceSelect, 'opensubtitles')
    })
    expect(host.querySelectorAll('.item')).toHaveLength(1)
    expect(host.querySelector('.item')?.textContent).toContain('OpenSubtitles')

    click(host.querySelector('.item')!)
    expect(onPick).toHaveBeenCalledExactlyOnceWith(CANDIDATES[0])

    click(host.querySelector('.picker-btn')!)
    expect(onOpenPluginPicker).toHaveBeenCalledExactlyOnceWith({ origin: 'customsubs', name: 'CustomSubs' })

    // Submitting "empty" shows localized empty state
    const input = host.querySelector<HTMLInputElement>('.search-input')!
    const form = host.querySelector<HTMLFormElement>('.search-form')!
    act(() => {
      input.value = 'empty'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => expect(host.querySelector('.empty')?.textContent).toBe('No subtitles found.'))

    // Tab wraps focus inside the dialog panel between first and last focusable element
    const originalActive = Object.getOwnPropertyDescriptor(document, 'activeElement')
    const pickerBtn = host.querySelector<HTMLElement>('.picker-btn')!
    const closeBtn = host.querySelector<HTMLElement>('.close')!
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => pickerBtn })
    restoreFocus.push(() => {
      if (originalActive) Object.defineProperty(document, 'activeElement', originalActive)
      else Reflect.deleteProperty(document, 'activeElement')
    })
    focusedElement = null
    act(() => {
      window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Tab', shiftKey: false }))
    })
    expect(focusedElement).toBe(closeBtn)

    // Escape and backdrop clicks close; clicks inside .panel do not
    click(host.querySelector('.panel')!)
    expect(onClose).not.toHaveBeenCalled()

    act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)

    click(host.firstElementChild!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
