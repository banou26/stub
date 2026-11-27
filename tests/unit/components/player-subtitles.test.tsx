// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame } from '@fkn/lib'
import type { PlayerCapabilities } from '../../../src/components/player'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { makeRemoteVideo } from './remote-video'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'CaptionsOff', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Layers', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Search', 'Settings', 'SkipBack', 'SkipForward', 'SlidersHorizontal', 'TriangleAlert', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const {
  clampSubtitleBackgroundOpacity,
  clampSubtitleFontScale,
  clampSubtitleOffset,
  clampSubtitlePosition,
  detectSubtitleFormat,
  isSubtitleFile,
  readDroppedSubtitleFiles,
  subtitleLabelFromFilename,
} = await import('@banou/media-player')
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
  vi.restoreAllMocks()
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

const makeDropFile = (name: string, content: string, type = '') => {
  const file = new File([content], name, { type })
  return Object.assign(file, { text: async () => content })
}

const dispatchFileDrag = (target: EventTarget, eventType: string, files: File[]) => {
  const event = Object.assign(new Event(eventType, { bubbles: true, cancelable: true }), {
    dataTransfer: {
      files,
      types: ['Files'],
      dropEffect: 'none',
    },
  })
  target.dispatchEvent(event)
  return event
}

const dispatchPointer = (
  target: EventTarget,
  type: string,
  init: { clientX: number, clientY: number, pointerId?: number },
) => {
  const event = Object.assign(
    new Event(type, { bubbles: true, cancelable: true }),
    {
      button: 0,
      clientX: init.clientX,
      clientY: init.clientY,
      pointerId: init.pointerId ?? 1,
      pointerType: 'mouse',
    },
  )
  target.dispatchEvent(event)
  return event
}

describe('media-player subtitle helpers', () => {
  test('clamps offset, scale, opacity, and normalized coordinates safely', () => {
    expect(clampSubtitleOffset(12.345)).toBe(12.35)
    expect(clampSubtitleOffset(999)).toBe(300)
    expect(clampSubtitleOffset(-999)).toBe(-300)
    expect(clampSubtitleOffset(-0)).toBe(0)
    expect(clampSubtitleOffset(Number.NaN)).toBe(0)

    expect(clampSubtitleFontScale(0.1)).toBe(0.5)
    expect(clampSubtitleFontScale(3.5)).toBe(2)
    expect(clampSubtitleFontScale(1.14)).toBe(1.15)
    expect(clampSubtitleFontScale(Number.NaN)).toBe(1)

    expect(clampSubtitleBackgroundOpacity(-1)).toBe(0)
    expect(clampSubtitleBackgroundOpacity(2)).toBe(1)
    expect(clampSubtitleBackgroundOpacity(0.52)).toBe(0.5)
    expect(clampSubtitleBackgroundOpacity(Number.NaN)).toBe(0.75)

    expect(clampSubtitlePosition({ x: -0.4, y: 1.8 })).toEqual({ x: 0, y: 1 })
    expect(clampSubtitlePosition({ x: Number.NaN, y: Number.NaN })).toEqual({ x: 0.5, y: 1 })
  })

  test('detects subtitle formats, labels, and language tags from dropped files', async () => {
    expect(detectSubtitleFormat('Episode.01.ja.SSA')).toBe('ass')
    expect(detectSubtitleFormat('Movie.vtt')).toBe('vtt')
    expect(detectSubtitleFormat('video.mp4')).toBeNull()

    expect(isSubtitleFile({ name: 'sub.srt', type: '' })).toBe(true)
    expect(isSubtitleFile({ name: 'blob', type: 'text/vtt' })).toBe(true)
    expect(isSubtitleFile({ name: 'poster.png', type: 'image/png' })).toBe(false)

    expect(subtitleLabelFromFilename('Show.S01E01.eng.srt')).toEqual({
      label: 'Show.S01E01.eng',
      language: 'en',
    })
    expect(subtitleLabelFromFilename('Movie.zh-Hans.ass')).toEqual({
      label: 'Movie.zh-Hans',
      language: 'zh-Hans',
    })

    const added = await readDroppedSubtitleFiles([
      makeDropFile('Episode.fr.srt', '1\n00:00:00,000 --> 00:00:01,000\nSalut\n'),
      makeDropFile('ignored.png', 'png', 'image/png'),
    ], 'test-drop')
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      language: 'fr',
      label: 'Episode.fr',
      format: 'srt',
    })
    expect(added[0]!.id.startsWith('test-drop:')).toBe(true)
  })

  test('caps dropped subtitle count at 32 and size at 5 MiB, and resolves filename languages with Intl', async () => {
    expect(subtitleLabelFromFilename('Show.fi.srt')).toEqual({
      label: 'Show.fi',
      language: 'fi',
    })
    expect(subtitleLabelFromFilename('Show.chs.ass')).toEqual({
      label: 'Show.chs',
      language: 'zh-Hans',
    })
    expect(subtitleLabelFromFilename('Show.sdh.srt')).toEqual({
      label: 'Show.sdh',
      language: 'und',
    })

    const many = Array.from({ length: 35 }, (_, i) =>
      makeDropFile(`ep-${String(i + 1).padStart(2, '0')}.srt`, '1\n00:00:00,000 --> 00:00:01,000\nLine\n'),
    )
    expect(await readDroppedSubtitleFiles(many, 'cap-drop')).toHaveLength(32)

    const exact = makeDropFile('exact.en.srt', 'a'.repeat(5 * 1024 * 1024), 'application/x-subrip')
    const oversized = makeDropFile('huge.srt', 'a'.repeat(5 * 1024 * 1024 + 1), 'application/x-subrip')
    const small = makeDropFile('small.en.srt', '1\n00:00:00,000 --> 00:00:01,000\nSmall\n')
    const sized = await readDroppedSubtitleFiles([oversized, exact, small], 'size-drop')
    expect(sized.map(track => track.label)).toEqual(['exact.en', 'small.en'])
  })
})

describe('built-in player subtitle settings, drag positioning, and file drop', () => {
  test('adjusts timing offset, text size, background opacity, and drag position with reset', async () => {
    const { remote, emit } = makeSubtitledRemote()
    const capabilities: PlayerCapabilities = {
      subtitles: {
        label: 'Subtitles',
        offLabel: 'Off',
        selectedId: null,
        options: [],
        onSelect: async () => {},
      },
    }

    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)

    loadResponder = () => ({ text: '1\n00:00:01,000 --> 00:00:03,000\nTimed cue\n' })
    tellSubtitles([{ id: 'os:en:1', language: 'en', label: 'English (OpenSubtitles)', format: 'srt' }])
    await flush()

    let subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'English (OpenSubtitles)')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['os:en:1']))

    // At 3.2s the 1s..3s cue is past end
    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 3.2
      emit('timeupdate')
    })
    await flush()
    expect(host.querySelector('.subtitle-cues')).toBeNull()

    // Open subtitle settings view inside Subtitles popover
    subMenu = await openMenu(host, 'Subtitles')
    const optionsBtn = host.querySelector<HTMLButtonElement>('.subtitle-options-btn')
    expect(optionsBtn).toBeTruthy()
    await act(async () => { optionsBtn!.click() })
    const dialog = host.querySelector<HTMLElement>('.stub-settings')!
    expect(dialog).toBeTruthy()

    const stepPlusHalf = [...dialog.querySelectorAll<HTMLButtonElement>('.stub-pill')]
      .find(btn => btn.textContent === '+0.5s')!
    await act(async () => { stepPlusHalf.click() })
    expect(dialog.querySelector('.offset-readout')?.textContent).toBe('+0.5s')
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Timed cue'))

    // Text size + and Background 50%
    const plusSizeBtn = dialog.querySelector<HTMLButtonElement>('button[aria-label="Text size +"]')!
    await act(async () => { plusSizeBtn.click() })
    const bg50Btn = [...dialog.querySelectorAll<HTMLButtonElement>('.stub-pill')]
      .find(btn => btn.textContent === '50%')!
    await act(async () => { bg50Btn.click() })
    const box = host.querySelector<HTMLElement>('.subtitle-cues-box')!
    expect(String(box.style.getPropertyValue('--mp-sub-scale'))).toBe('1.1')
    expect(String(box.style.getPropertyValue('--mp-sub-bg-opacity'))).toBe('0.5')

    // Drag subtitle box upward/leftward and verify clamping + Reset position
    const makeRect = (left: number, top: number, width: number, height: number): DOMRect => ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    })
    const stage = host.querySelector<HTMLElement>('.subtitle-cues-stage')!
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 800, 450))
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(makeRect(300, 420, 200, 30))

    let parentClicked = 0
    host.addEventListener('click', () => { parentClicked++ })
    await act(async () => { dispatchPointer(box, 'pointerdown', { clientX: 400, clientY: 430 }) })
    await act(async () => { dispatchPointer(box, 'pointermove', { clientX: 250, clientY: 220 }) })
    await act(async () => { dispatchPointer(box, 'pointerup', { clientX: 250, clientY: 220 }) })
    expect(box.style.left).toBe('25%')
    expect(box.style.top).toBe('50%')
    expect(parentClicked).toBe(0)

    const resetPosBtn = menuItem(dialog, 'Reset position')
    expect(resetPosBtn).toBeTruthy()
    await act(async () => { resetPosBtn!.click() })
    expect(box.style.left).toBe('50%')
    expect(box.style.top).toBe('100%')

    // Drag again and verify double-click also resets position
    await act(async () => { dispatchPointer(box, 'pointerdown', { clientX: 400, clientY: 430 }) })
    await act(async () => { dispatchPointer(box, 'pointermove', { clientX: 250, clientY: 220 }) })
    await act(async () => { dispatchPointer(box, 'pointerup', { clientX: 250, clientY: 220 }) })
    expect(box.style.left).toBe('25%')
    await act(async () => { box.dispatchEvent(new Event('dblclick', { bubbles: true, cancelable: true })) })
    expect(box.style.left).toBe('50%')
    expect(box.style.top).toBe('100%')

    // Reset offset hides the cue again at 3.2s
    const resetOffsetBtn = dialog.querySelector<HTMLButtonElement>('.stub-reset-btn')!
    await act(async () => { resetOffsetBtn.click() })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')).toBeNull())
  })

  test('loads dropped subtitle files as External tracks, stops drop propagation, and ignores non-subtitle files', async () => {
    const { remote, emit } = makeSubtitledRemote()
    const nativeCalls: (string | null)[] = []
    let nativeSelected: string | null = 'en'
    const capabilities: PlayerCapabilities = {
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
    }

    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)
    const skin = host.querySelector<HTMLElement>('.media-default-skin--video')!
    let hostDropCount = 0
    host.addEventListener('drop', () => { hostDropCount++ })

    // Non-subtitle file drop clears overlay and passes through to parent
    const videoFile = makeDropFile('clip.mp4', 'video-bytes', 'video/mp4')
    await act(async () => { dispatchFileDrag(skin, 'dragenter', [videoFile]) })
    expect(host.textContent).toContain('Drop subtitle file to load')
    await act(async () => { dispatchFileDrag(skin, 'drop', [videoFile]) })
    expect(host.textContent).not.toContain('Drop subtitle file to load')
    expect(hostDropCount).toBe(1)

    // Subtitle file drop shows hint, stops propagation, turns native off, and activates dropped cue
    const srtFile = makeDropFile('dropped.ja.srt', '1\n00:00:01,000 --> 00:00:03,000\nDropped line\n', 'application/x-subrip')
    await act(async () => { dispatchFileDrag(skin, 'dragenter', [srtFile]) })
    expect(host.textContent).toContain('Drop subtitle file to load')

    await act(async () => { dispatchFileDrag(skin, 'drop', [srtFile]) })
    await flush()
    expect(hostDropCount).toBe(1)
    expect(nativeCalls).toEqual([null])

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 1.5
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Dropped line'))

    const subMenu = await openMenu(host, 'Subtitles')
    const droppedRow = menuItem(subMenu, 'dropped.ja')!
    expect(droppedRow.querySelector('.stub-menu__tag')?.textContent).toBe('External')
    expect(droppedRow.querySelector('.stub-menu__tag')?.classList.contains('stub-menu__tag--external')).toBe(true)
  })

  test('clears active cue drag when cues unmount mid-drag so the next cue is not stuck', async () => {
    const { remote, emit } = makeSubtitledRemote()
    const capabilities: PlayerCapabilities = {
      subtitles: { label: 'Subtitles', offLabel: 'Off', selectedId: null, options: [], onSelect: async () => {} },
    }
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)

    loadResponder = () => ({
      text: '1\n00:00:01,000 --> 00:00:03,000\nFirst cue\n\n2\n00:00:05,000 --> 00:00:07,000\nSecond cue\n',
    })
    tellSubtitles([{ id: 'os:en:drag', language: 'en', label: 'English', format: 'srt' }])
    await flush()

    const subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'English')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['os:en:drag']))

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 1.5
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('First cue'))

    const stage = host.querySelector<HTMLElement>('.subtitle-cues-stage')!
    const firstBox = host.querySelector<HTMLElement>('.subtitle-cues-box')!
    const makeRect = (left: number, top: number, width: number, height: number): DOMRect => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
    })
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 800, 450))
    vi.spyOn(firstBox, 'getBoundingClientRect').mockReturnValue(makeRect(300, 420, 200, 30))

    await act(async () => { dispatchPointer(firstBox, 'pointerdown', { clientX: 400, clientY: 430 }) })
    expect(firstBox.getAttribute('data-dragging')).toBe('true')

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 4.0
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')).toBeNull())

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 5.5
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Second cue'))

    const nextBox = host.querySelector<HTMLElement>('.subtitle-cues-box')!
    expect(nextBox.getAttribute('data-dragging')).toBeNull()
    await act(async () => { dispatchPointer(nextBox, 'pointermove', { clientX: 250, clientY: 220 }) })
    expect(nextBox.style.left).toBe('50%')
    expect(nextBox.style.top).toBe('100%')
  })

  test('ends subtitle drag on window pointerup and window blur', async () => {
    const { remote, emit } = makeSubtitledRemote()
    const capabilities: PlayerCapabilities = {
      subtitles: { label: 'Subtitles', offLabel: 'Off', selectedId: null, options: [], onSelect: async () => {} },
    }
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)

    loadResponder = () => ({ text: '1\n00:00:01,000 --> 00:00:03,000\nWindow end cue\n' })
    tellSubtitles([{ id: 'os:en:win', language: 'en', label: 'English', format: 'srt' }])
    await flush()

    const subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'English')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['os:en:win']))

    await act(async () => {
      ;(remote as { currentTime: number }).currentTime = 1.5
      emit('timeupdate')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toContain('Window end cue'))

    const stage = host.querySelector<HTMLElement>('.subtitle-cues-stage')!
    const box = host.querySelector<HTMLElement>('.subtitle-cues-box')!
    const makeRect = (left: number, top: number, width: number, height: number): DOMRect => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
    })
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 800, 450))
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(makeRect(300, 420, 200, 30))

    await act(async () => { dispatchPointer(box, 'pointerdown', { clientX: 400, clientY: 430, pointerId: 1 }) })
    expect(box.getAttribute('data-dragging')).toBe('true')
    await act(async () => { dispatchPointer(window, 'pointerup', { clientX: 250, clientY: 220, pointerId: 1 }) })
    expect(box.getAttribute('data-dragging')).toBeNull()
    await act(async () => { dispatchPointer(box, 'pointermove', { clientX: 250, clientY: 220, pointerId: 1 }) })
    expect(box.style.left).toBe('50%')
    expect(box.style.top).toBe('100%')

    await act(async () => { dispatchPointer(box, 'pointerdown', { clientX: 400, clientY: 430, pointerId: 2 }) })
    expect(box.getAttribute('data-dragging')).toBe('true')
    await act(async () => { window.dispatchEvent(new Event('blur')) })
    expect(box.getAttribute('data-dragging')).toBeNull()
    await act(async () => { dispatchPointer(box, 'pointermove', { clientX: 250, clientY: 220, pointerId: 2 }) })
    expect(box.style.left).toBe('50%')
    expect(box.style.top).toBe('100%')
  })

  test('caps cue-clock extrapolation at 0.5s and stops advancing cues during waiting stalls', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let nextRafId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextRafId++
      rafCallbacks.set(id, cb)
      return id
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafCallbacks.delete(id)
    })
    const flushRaf = async () => {
      const pending = [...rafCallbacks.values()]
      rafCallbacks.clear()
      await act(async () => {
        for (const cb of pending) cb(now)
      })
    }

    const { remote, emit } = makeSubtitledRemote()
    const capabilities: PlayerCapabilities = {
      subtitles: { label: 'Subtitles', offLabel: 'Off', selectedId: null, options: [], onSelect: async () => {} },
    }
    const host = mount(withIntl(<NetflixVideoJSPlayer remote={remote} frame={frame} capabilities={capabilities} />))
    hosts.push(host)

    loadResponder = () => ({
      text: '1\n00:00:00,000 --> 00:00:02,000\nCue A\n\n2\n00:00:02,000 --> 00:00:04,000\nCue B\n\n3\n00:00:05,000 --> 00:00:07,000\nCue C\n',
    })
    tellSubtitles([{ id: 'os:en:clock', language: 'en', label: 'English', format: 'srt' }])
    await flush()

    const subMenu = await openMenu(host, 'Subtitles')
    await act(async () => { menuItem(subMenu, 'English')!.click() })
    await vi.waitFor(() => expect(requestedLoads).toEqual(['os:en:clock']))

    await act(async () => {
      Object.assign(remote, { paused: false, playbackRate: 1, currentTime: 1.2 })
      emit('play')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toBe('Cue A'))

    // Without a timeupdate over 5s, extrapolation must stay capped at 0.5s (1.7s -> still Cue A, never Cue C)
    now += 5000
    await flushRaf()
    expect(host.querySelector('.subtitle-cues')?.textContent).toBe('Cue A')

    // During a waiting stall, cue clock stops extrapolating from 1.8s past 2.0s into Cue B
    await act(async () => {
      Object.assign(remote, { currentTime: 1.8 })
      emit('timeupdate')
      emit('waiting')
    })
    expect(host.querySelector('.subtitle-cues')?.textContent).toBe('Cue A')
    now += 400
    await flushRaf()
    expect(host.querySelector('.subtitle-cues')?.textContent).toBe('Cue A')

    await act(async () => {
      Object.assign(remote, { currentTime: 2.2 })
      emit('playing')
    })
    await vi.waitFor(() => expect(host.querySelector('.subtitle-cues')?.textContent).toBe('Cue B'))
  })
})
