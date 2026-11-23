// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'
import type { PlayerCapabilities } from '../../../src/components/player'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame
const APP = 'https://anime.fkn.app'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const tellSubtitles = (tracks: { id: string, language: string, label: string, format: 'srt' | 'vtt' | 'ass' }[]) => act(() => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-subtitles', tracks },
    source: window,
    origin: APP,
  }))
})

const sendLoaded = (requestId: string, result: { text: string } | { error: string }) => {
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { type: 'stub:embed-subtitles-loaded', requestId, ...result },
    source: window,
    origin: APP,
  }))
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const requestedLoads: string[] = []
let loadResponder: (id: string) => { text: string } | { error: string } = () => ({ error: 'unconfigured' })

const hosts: HTMLElement[] = []
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  requestedLoads.length = 0
  loadResponder = () => ({ error: 'unconfigured' })
  Object.assign(window, {
    location: { origin: APP },
    postMessage: (data: unknown) => {
      const payload = (data ?? {}) as { type?: string, requestId?: string, id?: string }
      if (payload.type !== 'stub:embed-subtitles-load' || !payload.requestId || !payload.id) return
      requestedLoads.push(payload.id)
      const reply = loadResponder(payload.id)
      queueMicrotask(() => sendLoaded(payload.requestId!, reply))
    },
  })
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
  for (const name of ['location', 'postMessage']) Reflect.deleteProperty(window, name)
})

const makeSubtitledRemote = () => {
  const { remote } = makeRemoteVideo()
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const origAdd = remote.addEventListener.bind(remote)
  const origRemove = remote.removeEventListener.bind(remote)
  remote.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(listener)
    origAdd(type, listener, options as AddEventListenerOptions)
  }
  remote.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    listeners.get(type)?.delete(listener)
    origRemove(type, listener, options as EventListenerOptions)
  }
  const emit = (type: string) => {
    const event = new Event(type)
    for (const listener of [...(listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
  return { remote, emit }
}

const openMenu = async (host: HTMLElement, label: string) => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, `${label} menu button`).toBeTruthy()
  await act(async () => { button!.click() })
  await vi.waitFor(() => expect(host.querySelector(`.stub-menu[aria-label="${label}"]`)).toBeTruthy())
  return host.querySelector<HTMLElement>(`.stub-menu[aria-label="${label}"]`)!
}

const menuItem = (menu: HTMLElement, label: string) =>
  [...menu.querySelectorAll<HTMLButtonElement>('.stub-menu__item')]
    .find(item => item.querySelector('.stub-menu__label')?.textContent === label)

describe('built-in player external subtitles & Native/External tags', () => {
  test('tags native and external subtitle items while keeping Off and non-subtitle menus untagged', async () => {
    const { remote } = makeRemoteVideo()
    const capabilities: PlayerCapabilities = {
      subtitles: {
        label: 'Subtitles',
        offLabel: 'Off',
        selectedId: 'en',
        options: [{ id: 'en', label: 'English' }],
        onSelect: async () => {},
      },
      audioTracks: {
        label: 'Audio',
        selectedId: 'ja',
        options: [{ id: 'ja', label: 'Japanese' }],
        onSelect: async () => {},
      },
      qualityLevels: {
        label: 'Quality',
        selectedId: '1080',
        options: [{ id: '1080', label: '1080p' }],
        onSelect: async () => {},
      },
    }

    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)
    tellSubtitles([{ id: 'os:fr:1', language: 'fr', label: 'French (OpenSubtitles)', format: 'srt' }])
    await flush()

    const subMenu = await openMenu(host, 'Subtitles')
    const offRow = menuItem(subMenu, 'Off')!
    const nativeRow = menuItem(subMenu, 'English')!
    const externalRow = menuItem(subMenu, 'French (OpenSubtitles)')!
    expect(offRow.querySelector('.stub-menu__tag')).toBeNull()
    expect(nativeRow.querySelector('.stub-menu__tag')?.textContent).toBe('Native')
    expect(nativeRow.querySelector('.stub-menu__tag')?.classList.contains('stub-menu__tag--external')).toBe(false)
    expect(externalRow.querySelector('.stub-menu__tag')?.textContent).toBe('External')
    expect(externalRow.querySelector('.stub-menu__tag')?.classList.contains('stub-menu__tag--external')).toBe(true)

    const audioMenu = await openMenu(host, 'Audio')
    expect(menuItem(audioMenu, 'Japanese')?.querySelector('.stub-menu__tag')).toBeNull()
  })

  test('loads an external subtitle lazily, clears native selection, renders active cues, and resets on native or Off', async () => {
    const { remote, emit } = makeSubtitledRemote()
    let nativeSelected: string | null = 'en'
    const nativeCalls: (string | null)[] = []
    let renderTree!: () => ReturnType<typeof withIntl>
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)

    const capabilities = (): PlayerCapabilities => ({
      subtitles: {
        label: 'Subtitles',
        offLabel: 'Off',
        selectedId: nativeSelected,
        options: [{ id: 'en', label: 'English' }],
        onSelect: async (id) => {
          nativeCalls.push(id)
          nativeSelected = id
        },
      },
    })

    const { render } = await import('preact')
    renderTree = () => withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities()} />)
    act(() => { render(renderTree(), host) })

    loadResponder = id => (id === 'os:fr:1'
      ? { text: '1\n00:00:01,000 --> 00:00:03,000\nBonjour\n' }
      : { error: 'load failed' })
    tellSubtitles([
      { id: 'os:fr:1', language: 'fr', label: 'French (OpenSubtitles)', format: 'srt' },
      { id: 'broken', language: 'de', label: 'Broken External', format: 'vtt' },
    ])
    await flush()

    // Failed external load keeps native selection active and marks the button as errored
    let subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'Broken External')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['broken']))
    await vi.waitFor(() => expect(host.querySelector('.media-button--menu.media-button--error')).toBeTruthy())
    expect(nativeSelected).toBe('en')
    expect(host.querySelector('.subtitle-cues')).toBeNull()

    // Successful external load turns native off and draws cues at currentTime
    subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'French (OpenSubtitles)')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['broken', 'os:fr:1']))
    expect(nativeCalls).toEqual([null])
    act(() => { render(renderTree(), host) })

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 1.5
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Bonjour'))

    // Switching back to Native clears external cues
    subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'English')!.click() })
    await vi.waitFor(() => expect(nativeCalls).toEqual([null, 'en']))
    act(() => { render(renderTree(), host) })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')).toBeNull())

    // Re-selecting the same external track reuses the cache without re-fetching
    subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'French (OpenSubtitles)')!.click() })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Bonjour'))
    expect(requestedLoads).toEqual(['broken', 'os:fr:1'])

    // Host removing external tracks clears active cues and hides external options
    tellSubtitles([])
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')).toBeNull())
    subMenu = await openMenu(host, 'Subtitles')
    expect(menuItem(subMenu, 'French (OpenSubtitles)')).toBeUndefined()
  })
})
