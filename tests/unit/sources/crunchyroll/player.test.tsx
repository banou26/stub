// FIRST, and it has to stay first: ../../components/dom installs the document that @emotion/react
// reads at module scope. See the file for what happens when it does not.
import { button, mount, unmount } from '../../components/dom'

import type { DelegatedTracks } from '@banou/media-player'
import type { Frame, GotoOptions } from '@fkn/lib'
import type { EmbedTracks, TrackKind } from '../../../../src/embed-tracks'
import type { CrunchyrollTracks } from '../../../../src/sources/crunchyroll/cr-native-controls'
import type { ComponentChildren } from 'preact'
import type { WindowSignIn } from '../../../../src/sources/login-window'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

// The sign-in wiring of the Crunchyroll player, rendered for real against a fake frame. Crunchyroll
// itself is out of reach here: what is pinned is which sign-in each backend opens, that the cloud
// window is opened INSIDE the click, and what each outcome of that window does to the player.

const lib = vi.hoisted(() => ({ extension: false, attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => lib.extension,
}))

const signIn = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/sources/login-window', () => ({ signInThroughWindow: signIn }))

// the skip events are a separate concern, and stay unanswered here
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))

// the media player skin needs a real media to draw anything, and none of it is under test here
// beyond the audio tracks and qualities its menu is handed
const skin = vi.hoisted(() => ({ audioTracks: undefined as DelegatedTracks | undefined, quality: undefined as DelegatedTracks | undefined }))
vi.mock('../../../../src/sources/crunchyroll/cr-videojs-player', () => ({
  default: ({ children, audioTracks, quality }: { children?: ComponentChildren, audioTracks?: DelegatedTracks, quality?: DelegatedTracks }) => {
    skin.audioTracks = audioTracks
    skin.quality = quality
    return <div className="skin">{children}</div>
  },
}))

// the channel to the watch page, captured: what the player serves and the pick it hands over
const served = vi.hoisted(() => vi.fn((..._args: unknown[]) => () => {}))
vi.mock('../../../../src/embed-tracks', () => ({ serveEmbedTracks: served }))

const controls = vi.hoisted(() => ({ discover: vi.fn(), select: vi.fn() }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/sources/crunchyroll/cr-native-controls')>(),
  discoverCrunchyrollTracks: controls.discover,
  selectCrunchyrollTrack: controls.select,
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')
const { siteStatuses } = await import('../../../../src/tracking/site-status')

const EPISODE = 'https://www.crunchyroll.com/watch/GXXXXXXXX/an-episode'
const SIGNED_OUT_NOTE = 'Sign in to Crunchyroll to watch.'

// a watch page that settles as signed out: each load shows the client's `.shell-header` on the first
// read, then the anonymous user menu alone (see login-state.test.ts for the traced timelines)
const makeFrame = () => {
  let shells = 0
  const frame = {
    goto: vi.fn(async (_url: string, _options?: GotoOptions) => {}),
    addStyleTag: vi.fn(async () => {}),
    locator: (selector: string) => ({
      exists: async () => {
        if (selector !== '.shell-header') return selector === '#user-menu-anonymous'
        if (shells === frame.goto.mock.calls.length) return false
        shells = frame.goto.mock.calls.length
        return true
      },
    }),
  }
  return frame
}

const hosts: HTMLElement[] = []

const render = async () => {
  const host = mount(<CrunchyrollPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" />)
  hosts.push(host)
  return host
}

// the player picks a backend only once the page has loaded, then gives a late extension 300 ms
const signedOut = async (host: HTMLElement, label: string) => {
  await vi.waitFor(() => expect(button(host, label)).toBeTruthy(), { timeout: 5_000 })
  expect(host.textContent).toContain(SIGNED_OUT_NOTE)
  return button(host, label)!
}

let frame: ReturnType<typeof makeFrame>
let open: ReturnType<typeof vi.fn>

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  frame = makeFrame()
  lib.extension = false
  lib.attachFrame.mockReset().mockResolvedValue(frame)
  signIn.mockReset().mockReturnValue(new Promise(() => {}))
  // the extension's plain popup, which a cloud sign-in must never reach for
  open = vi.fn(() => ({ closed: false }))
  vi.stubGlobal('open', open)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// the declarations emotion inserted for one of the player's classes
const ruleOf = (className: string) => [...document.head.querySelectorAll('style')]
  .map(style => style.textContent)
  .join('')
  .match(new RegExp(`\\.${className}\\{([^}]*)\\}`))?.[1] ?? ''

describe('while the episode loads', () => {
  test('the player\'s spinner sits on the black cover over the frame, with no text', async () => {
    const held = Promise.withResolvers<void>()
    frame.goto.mockImplementation(() => held.promise)
    const host = await render()
    await vi.waitFor(() => expect(frame.goto).toHaveBeenCalled(), { timeout: 5_000 })

    const overlay = host.querySelector('.overlay')!
    expect(overlay.querySelector('.loading-spinner[role="status"]')).toBeTruthy()
    expect(overlay.textContent).toBe('')
    expect(host.textContent).not.toContain('Loading Crunchyroll player')
    // Crunchyroll keeps loading in the frame, under a cover that is opaque and above it
    expect(host.querySelector('.skin iframe.cr-frame')).toBeTruthy()
    expect(ruleOf('overlay')).toMatch(/inset:0;/)
    expect(ruleOf('overlay')).toMatch(/background:#000;/)
    expect(ruleOf('overlay')).toMatch(/z-index:30;/)
    held.resolve()
  })

  test('a page that settles signed out swaps the spinner for the sign-in', async () => {
    const host = await render()
    await signedOut(host, 'Sign in to Crunchyroll')
    expect(host.querySelector('.loading-spinner')).toBeNull()
  })
})

describe('cloud backend', () => {
  // every control runs as page code (see cr-page.ts), so Interaction and Site data are never asked
  test('the attach asks upfront for Evaluation alone, for tracks, quality, seeking and thumbnails', async () => {
    await render()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalled())
    const [options] = lib.attachFrame.mock.calls[0]!
    const { permissions } = options as { permissions: { category: string, reason: string }[] }
    expect(permissions.map(({ category }) => category)).toEqual(['evaluation'])
    expect(permissions[0]!.reason).toMatch(/audio, subtitles and quality.*seek.*thumbnails/)
    // @fkn/lib refuses a reason over 100 characters, and that refusal fails the attach itself
    expect([...permissions[0]!.reason].length).toBeLessThanOrEqual(100)
  })

  // since @fkn/lib 0.9.42 the jar picks the backend, so the cloud layout asks for the cloud's jar
  test('attaches on the cloud jar, the one its sign-in window signs in to', async () => {
    await render()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalled())
    expect(lib.attachFrame).toHaveBeenCalledWith(expect.objectContaining({ cookies: 'persistent' }))
  })

  test('the sign-in button opens the window inside the click, on the SSO page and its hosts', async () => {
    const host = await render()
    const signInButton = await signedOut(host, 'Sign in to Crunchyroll')

    signInButton.click()
    // counted before anything is awaited: the window only opens with the click's own activation
    expect(signIn).toHaveBeenCalledTimes(1)

    const [{ url, domains, isSignedIn }] = signIn.mock.calls[0]!
    expect(new URL(url).origin + new URL(url).pathname).toBe('https://sso.crunchyroll.com/authorize')
    expect(new URL(url).searchParams.get('state')).toBe('/')
    expect(domains).toContain('sso.crunchyroll.com')
    expect(domains).toContain('www.crunchyroll.com')

    // the signed-in marker, read with a severity-0 exists() so the poll never prompts
    const read = vi.fn(async (_selector: string) => true)
    await isSignedIn({ locator: (selector: string) => ({ exists: () => read(selector) }) } as unknown as Frame)
    expect(read).toHaveBeenCalledWith('#user-menu-authenticated')

    // and the in-frame sign-in is gone: the player frame is only ever sent to the episode
    expect(frame.goto.mock.calls.map(([target]) => target)).toEqual([EPISODE])
    await vi.waitFor(() => expect(button(host, 'Finish signing in the window...')?.disabled).toBe(true))
  })

  // the window is already closed by then, so the whole iframe reloads on a fresh attach
  test('a page whose load never finishes still reaches the sign-in prompt', async () => {
    // a signed-out page's consent script can hold its load past any deadline; only the page's markers may decide
    frame.goto.mockImplementation(async (_url: string, options?: GotoOptions) => {
      if (options?.waitUntil === 'load') await new Promise(() => {})
    })
    const host = await render()
    await signedOut(host, 'Sign in to Crunchyroll')
    expect(host.textContent).not.toContain('timed out')
  })

  test('a signed-in window remounts the player iframe, which loads the episode again', async () => {
    signIn.mockResolvedValue('authed' satisfies WindowSignIn)
    const host = await render()
    ;(await signedOut(host, 'Sign in to Crunchyroll')).click()

    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(2))
    const [first, second] = lib.attachFrame.mock.calls.map(([options]) => (options as { iframe: HTMLIFrameElement }).iframe)
    expect(second).not.toBe(first)
    expect(first!.isConnected).toBe(false)
    expect(host.querySelector('iframe')).toBe(second)
    await vi.waitFor(() => expect(frame.goto).toHaveBeenCalledTimes(2))
    expect(frame.goto).toHaveBeenLastCalledWith(EPISODE, { waitUntil: 'commit' })
  })

  test('a window closed without signing in comes back to the sign-in button', async () => {
    signIn.mockResolvedValue('closed' satisfies WindowSignIn)
    const host = await render()
    ;(await signedOut(host, 'Sign in to Crunchyroll')).click()

    await vi.waitFor(() => expect(frame.goto).toHaveBeenCalledTimes(2))
    const again = await signedOut(host, 'Sign in to Crunchyroll')
    expect(again.disabled).toBe(false)
    expect(lib.attachFrame).toHaveBeenCalledTimes(1)
  })

  test('a blocked window shows the blocked notice, whose button opens the window again', async () => {
    signIn.mockResolvedValue('blocked' satisfies WindowSignIn)
    const host = await render()
    ;(await signedOut(host, 'Sign in to Crunchyroll')).click()

    await vi.waitFor(() => expect(host.textContent).toContain('The login popup was blocked'))
    button(host, 'Open Crunchyroll Login Page')!.click()
    expect(signIn).toHaveBeenCalledTimes(2)
    expect(open).not.toHaveBeenCalled()
    expect(frame.goto).toHaveBeenCalledTimes(1)
  })

  test('a refused window mode surfaces an error with Retry', async () => {
    signIn.mockResolvedValue('unsupported' satisfies WindowSignIn)
    const host = await render()
    ;(await signedOut(host, 'Sign in to Crunchyroll')).click()

    await vi.waitFor(() => expect(host.textContent).toContain('The Crunchyroll sign-in window could not be opened here.'))
    expect(button(host, 'Retry')).toBeTruthy()
  })
})

describe('extension backend', () => {
  test("attaches on the browser's own cookies, which only the extension serves, and sends the episode at commit", async () => {
    lib.extension = true
    await render()
    await vi.waitFor(() => expect(frame.goto).toHaveBeenCalled())
    expect(lib.attachFrame).toHaveBeenCalledWith(expect.objectContaining({ cookies: 'native' }))
    expect(frame.goto).toHaveBeenCalledWith(EPISODE, { waitUntil: 'commit' })
  })

  // the extension refuses window mode, and its frame reads the real browser session anyway
  test('keeps the plain popup on the real site, and never opens an FKN window', async () => {
    lib.extension = true
    const host = await render()
    ;(await signedOut(host, 'Open Crunchyroll Login Page')).click()

    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]).toEqual([expect.stringContaining('https://sso.crunchyroll.com/authorize?'), '_blank', 'width=500,height=700'])
    expect(signIn).not.toHaveBeenCalled()
  })
})

// what Accounts shows for Crunchyroll comes from here at no cost: the player's own check of the page
describe('the sign-in state the page settles on', () => {
  const record = vi.fn<typeof siteStatuses.record>()
  const recorded = () => record.mock.calls.filter(([site]) => site === 'crunchyroll').map(([, state]) => state)

  beforeEach(() => { vi.spyOn(siteStatuses, 'record').mockImplementation(record.mockReset()) })

  for (const [backend, signInLabel] of [['cloud', 'Sign in to Crunchyroll'], ['extension', 'Open Crunchyroll Login Page']] as const) {
    test(`on the ${backend}, a signed-out page is remembered as signed out`, async () => {
      lib.extension = backend === 'extension'
      await signedOut(await render(), signInLabel)
      expect(recorded()).toEqual(['signed-out'])
    })

    test(`on the ${backend}, a signed-in page is remembered as signed in`, async () => {
      lib.extension = backend === 'extension'
      frame.locator = (selector: string) => ({ exists: async () => selector === '#user-menu-authenticated' })
      await render()
      await vi.waitFor(() => expect(recorded()).toEqual(['signed-in']), { timeout: 5_000 })
    })
  }

  test('a check that gets no answer remembers nothing', async () => {
    frame.locator = () => ({ exists: async () => { throw new Error('The page went away') } })
    const host = await render()
    await vi.waitFor(() => expect(host.textContent).toContain('The page went away'), { timeout: 5_000 })
    expect(recorded()).toEqual([])
  })
})

// what the watch page is told, for a party to follow: the tracks by id, and busy while a switch runs
describe('the tracks served to the watch page', () => {
  const TRACKS: CrunchyrollTracks = {
    subtitles: { options: [{ id: 'English', label: 'English' }, { id: 'Deutsch', label: 'Deutsch' }], selectedId: 'English', offLabel: 'Off' },
    audio: { options: [{ id: 'Japanese', label: 'Japanese' }, { id: 'English#2', label: 'English' }], selectedId: 'Japanese' },
    quality: { options: [{ id: 'Highest Available', label: 'Highest Available' }, { id: 'Data Saver', label: 'Data Saver' }], selectedId: 'Highest Available' },
  }
  const lastServed = () => served.mock.calls.at(-1) as [EmbedTracks, (kind: TrackKind, id: string | null) => void]

  // a signed-in page whose video is up, so the player discovers its tracks
  const playing = async () => {
    lib.extension = true
    frame.locator = (selector: string) => ({
      exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
      videoElement: async () => Object.assign(new EventTarget(), { duration: 1440 }),
    }) as unknown as ReturnType<typeof frame.locator>
    Object.assign(frame, { evaluate: () => new Promise(() => {}) })
    await render()
    await vi.waitFor(() => expect(lastServed()[0].subtitles).toBeTruthy(), { timeout: 5_000 })
  }

  beforeEach(() => {
    served.mockClear()
    controls.discover.mockReset().mockResolvedValue(TRACKS)
    controls.select.mockReset()
  })

  test('both lists by id, with the subtitles off as null and a track Crunchyroll will not switch to left out', async () => {
    const subtitles = { ...TRACKS.subtitles!, options: [...TRACKS.subtitles!.options, { id: 'Italiano', label: 'Italiano', disabled: true }], selectedId: null }
    controls.discover.mockResolvedValue({ ...TRACKS, subtitles })
    await playing()
    expect(lastServed()[0]).toEqual({
      subtitles: { ids: ['English', 'Deutsch'], selected: null },
      audio: { ids: ['Japanese', 'English#2'], selected: 'Japanese' },
      busy: false,
    })
  })

  test('Crunchyroll\'s qualities go to the player\'s menu, whose pick switches Crunchyroll\'s, and stay out of the watch page', async () => {
    controls.select.mockResolvedValue({ ...TRACKS, quality: { ...TRACKS.quality!, selectedId: 'Data Saver' } })
    await playing()
    expect(skin.quality!.selection).toMatchObject(TRACKS.quality!)
    expect(lastServed()[0]).not.toHaveProperty('quality')

    await skin.quality!.selection.select('Data Saver')
    expect(controls.select.mock.calls.map(([, , kind, id]) => [kind, id])).toEqual([['quality', 'Data Saver']])
    await vi.waitFor(() => expect(skin.quality!.selection.selectedId).toBe('Data Saver'))
  })

  test('a pick from the page switches that kind of track', async () => {
    controls.select.mockResolvedValue(TRACKS)
    await playing()
    lastServed()[1]('subtitles', 'Deutsch')
    lastServed()[1]('audio', 'English#2')
    await vi.waitFor(() => expect(controls.select).toHaveBeenCalledTimes(2))
    expect(controls.select.mock.calls.map(([, , kind, id]) => [kind, id])).toEqual([['subtitles', 'Deutsch'], ['audio', 'English#2']])
  })

  test('busy while a switch from the player\'s own menu runs', async () => {
    const done = Promise.withResolvers<CrunchyrollTracks>()
    controls.select.mockReturnValue(done.promise)
    await playing()
    void skin.audioTracks!.selection.select('English#2')
    await vi.waitFor(() => expect(lastServed()[0].busy).toBe(true))
    done.resolve(TRACKS)
    await vi.waitFor(() => expect(lastServed()[0].busy).toBe(false))
  })

  for (const outcome of ['succeeds', 'fails'] as const) {
    test(`busy while a switch runs, and not once it ${outcome}`, async () => {
      const done = Promise.withResolvers<CrunchyrollTracks>()
      controls.select.mockReturnValue(done.promise)
      await playing()
      lastServed()[1]('audio', 'English#2')
      await vi.waitFor(() => expect(lastServed()[0].busy).toBe(true))

      if (outcome === 'succeeds') done.resolve(TRACKS)
      else done.reject(new Error('Crunchyroll did not apply the audio option'))
      await vi.waitFor(() => expect(lastServed()[0].busy).toBe(false))
    })
  }
})
