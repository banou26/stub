// FIRST, and it has to stay first: ../../components/dom installs the document that @emotion/react
// reads at module scope. See the file for what happens when it does not.
import { button, mount, unmount } from '../../components/dom'

import type { Frame, GotoOptions, RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren } from 'preact'
import type { WindowSignIn } from '../../../../src/sources/login-window'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { PRIME_DOMAINS } from '../../../../src/sources/amazon/session'
import { SITE_STATUS_KEY } from '../../../../src/tracking/site-status'
import { PLAYER_VOLUME_KEY } from '../../../../src/utils/player-volume'
import { makeRemoteVideo, settle } from '../../components/remote-video'
import { pageRealm } from '../crunchyroll/page-realm'

// The Prime Video player over a fake amazon.co.jp: its page functions run in a page realm shaped like
// the detail page measured in a signed-in Chrome on 2026-10-12, and the lib around it is mocked.

const lib = vi.hoisted(() => ({ extension: false, attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => lib.extension,
}))

const signIn = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/sources/login-window', () => ({ signInThroughWindow: signIn }))

// @banou/media-player is not under test: what is, is the media it is handed
const skin = vi.hoisted(() => ({ media: null as RemoteVideoElement | null }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({ media, children }: { media: RemoteVideoElement | null, children?: ComponentChildren }) => {
    skin.media = media
    return <div className="skin">{children}</div>
  },
}))

const { default: PrimeVideoPlayer } = await import('../../../../src/sources/amazon/player')

const GTI = 'amzn1.dv.gti.fe903f64-0000-0000-0000-000000000002'
const DEEP_LINK = `https://watch.amazon.co.jp/watch?gti=${GTI}`
const DETAIL = 'https://www.amazon.co.jp/gp/video/detail/0PJQL97FNFXU3VZWEHILB694SJ'
const SIGNED_OUT_NOTE = 'Sign in to Prime Video to watch.'
const SIGN_IN = 'Sign in to Prime Video'

const HERO = '<div class="draper-player-container"><video src="blob:https://www.amazon.co.jp/hero"></video></div>'
// signed in: the header's account menu, the muted hero video, Play, and the player's container, empty until Play
const SIGNED_IN_PAGE = `
  <header><a id="nav-link-accountList" data-csa-c-content-id="nav_youraccount_btn">Account</a></header>
  ${HERO}
  <a data-testid="dp-atf-play-button" href="/gp/video/detail/0PJQL97FNFXU3VZWEHILB694SJ?autoplay=1&t=0">Play S1 E2</a>
  <div id="dv-web-player"></div>`
// signed out, as the logged-out page saved on 2026-10-12 has it: the header's sign-in link, and no Play
const SIGNED_OUT_PAGE = `
  <header><a id="nav-link-accountList" data-csa-c-content-id="nav_ya_signin" href="https://www.amazon.co.jp/ap/signin">Sign in</a></header>
  ${HERO}
  <div id="dv-web-player"></div>`
const EPISODE_SURFACE = '<div class="atvwebplayersdk-video-surface"><video src="blob:https://www.amazon.co.jp/episode"></video></div>'

const ready = (video: Element, readyState: number) => Object.defineProperty(video, 'readyState', { configurable: true, value: readyState })

/**
 * A frame holding `html` at `url`. Play, pressed by the page code, puts `surfaces` into the player's
 * container, each video ready unless it is the one `idle` names. Videos the player takes a handle on
 * are recorded in `handed`, each with its remote, which it gets once `handOver` resolves.
 */
const amazon = (html: string, { url = DETAIL, surfaces = EPISODE_SURFACE, idle = -1, handOver = Promise.resolve() } = {}) => {
  const realm = pageRealm(`<!doctype html><html><body>${html}</body></html>`, url)
  for (const video of realm.document.querySelectorAll('video')) ready(video, 4)
  const plays = vi.fn(() => {
    realm.document.querySelector('#dv-web-player')!.innerHTML = surfaces
    realm.document.querySelectorAll('#dv-web-player video').forEach((video, index) => ready(video, index === idle ? 0 : 4))
  })
  realm.document.querySelector('[data-testid="dp-atf-play-button"]')?.addEventListener('click', plays)

  const handed: { element: Element, episode: ReturnType<typeof makeRemoteVideo> }[] = []
  const frame = {
    goto: vi.fn(async (_url: string, _options?: GotoOptions) => {}),
    evaluate: vi.fn(realm.evaluate),
    addStyleTag: vi.fn(async (_options: { content: string }) => {}),
    locator: (selector: string) => ({
      exists: async () => realm.document.querySelector(selector) !== null,
      nth: (index: number) => ({
        videoElement: async () => {
          const element = realm.document.querySelectorAll(selector)[index]
          if (!element) throw new Error(`no ${selector} at ${index}`)
          const episode = makeRemoteVideo()
          handed.push({ element, episode })
          await handOver
          return episode.remote
        },
      }),
    }),
  }
  return { frame, plays, handed, document: realm.document }
}

const hosts: HTMLElement[] = []
const render = () => {
  const host = mount(<PrimeVideoPlayer url={DEEP_LINK} mediaUri="" episodeUri="" sourceUri={`amazon:${GTI}`} />)
  hosts.push(host)
  return host
}

const playing = async (page: ReturnType<typeof amazon>) => {
  lib.attachFrame.mockResolvedValue(page.frame)
  const host = render()
  await vi.waitFor(() => expect(skin.media).toBeTruthy(), { timeout: 5_000 })
  return host
}

const signedOut = async (host: HTMLElement) => {
  await vi.waitFor(() => expect(button(host, SIGN_IN)).toBeTruthy(), { timeout: 5_000 })
  expect(host.textContent).toContain(SIGNED_OUT_NOTE)
  return button(host, SIGN_IN)!
}

const values = new Map<string, string>()
const remembered = () => JSON.parse(values.get(SITE_STATUS_KEY) ?? '{}').prime?.state

// the waits are on the clock: these run it past their 30 s
const afterWaits = async (page: ReturnType<typeof amazon>, ms = 35_000) => {
  vi.useFakeTimers()
  lib.attachFrame.mockResolvedValue(page.frame)
  const host = render()
  await vi.advanceTimersByTimeAsync(ms)
  return host
}

const refusing = (name: string, message: string) => {
  const page = amazon(SIGNED_IN_PAGE)
  page.frame.evaluate.mockRejectedValue(Object.assign(new Error(message), { name }))
  return page
}

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  lib.extension = false
  lib.attachFrame.mockReset()
  signIn.mockReset().mockReturnValue(new Promise(() => {}))
  skin.media = null
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('attaching the Prime Video frame', () => {
  for (const [backend, cookies] of [['extension', 'native'], ['cloud', 'persistent']] as const) {
    test(`on the ${backend}, on the ${cookies} jar, across every host a playback crossed`, async () => {
      lib.extension = backend === 'extension'
      lib.attachFrame.mockReturnValue(new Promise(() => {}))
      render()
      await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(1), { timeout: 5_000 })
      const [{ domains, cookies: jar }] = lib.attachFrame.mock.calls[0]! as [{ domains: string[], cookies: string }]
      expect(jar).toBe(cookies)
      expect([...domains].sort()).toEqual([
        'a2z.com', 'aiv-cdn.net', 'aiv-delivery.net', 'amazon.co.jp', 'amazon.com', 'media-amazon.com',
        'prime-video.amazon.dev', 'pv-cdn.net', 'ssl-images-amazon.com', 'www.amazon.co.jp',
      ])
    })
  }

  // Play and the page reads run as page code, so one Evaluation card is all the player asks
  test('asks upfront for Evaluation alone, with a reason the lib accepts', async () => {
    lib.attachFrame.mockReturnValue(new Promise(() => {}))
    render()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalled(), { timeout: 5_000 })
    const [{ permissions }] = lib.attachFrame.mock.calls[0]! as [{ permissions: { category: string, reason: string }[] }]
    expect(permissions.map(({ category }) => category)).toEqual(['evaluation'])
    expect(permissions[0]!.reason).toMatch(/Play/)
    expect(permissions[0]!.reason.length).toBeLessThanOrEqual(100)
  })
})

describe('playing an episode', () => {
  test('opens the episode\'s detail page, presses Play and hands over the player\'s video, never the hero', async () => {
    const page = amazon(SIGNED_IN_PAGE)
    const host = await playing(page)

    expect(page.frame.goto).toHaveBeenCalledExactlyOnceWith(`https://watch.amazon.co.jp/detail?gti=${GTI}`, { waitUntil: 'commit' })
    expect(page.plays).toHaveBeenCalledTimes(1)
    expect(page.handed).toHaveLength(1)
    expect(page.handed[0]!.element.closest('#dv-web-player')).toBeTruthy()
    expect(page.handed[0]!.element.getAttribute('src')).toBe('blob:https://www.amazon.co.jp/episode')
    // the page is hidden down to the player only once Play has run and the video is there
    expect(page.frame.addStyleTag.mock.invocationCallOrder[0]).toBeGreaterThan(page.plays.mock.invocationCallOrder[0]!)
    const [{ content }] = page.frame.addStyleTag.mock.calls[0]!
    const rules = new Map([...content.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => [selector!.trim(), body!]))
    expect(rules.get('*:not(:has(#dv-web-player)):not(#dv-web-player):not(#dv-web-player *)'), 'all but the player is gone').toContain('display: none')
    expect(rules.get('#dv-web-player *:not(:has(video)):not(video)'), "Amazon's controls stay in, unseen").toContain('opacity: 0')
    expect(host.querySelector('.overlay')).toBeNull()
    expect(remembered()).toBe('signed-in')
  })

  test('waits past a surface with no data yet, for the video that plays', async () => {
    const surfaces = [
      '<video src="blob:https://www.amazon.co.jp/ad"></video>',
      '<video src="blob:https://www.amazon.co.jp/episode"></video>',
    ].join('')
    const page = amazon(SIGNED_IN_PAGE, { surfaces, idle: 0 })
    await playing(page)
    expect(page.handed.map(({ element }) => element.getAttribute('src'))).toEqual(['blob:https://www.amazon.co.jp/episode'])
  })

  test('a Play that brings no video ends on its line, with Retry', async () => {
    const host = await afterWaits(amazon(SIGNED_IN_PAGE, { surfaces: '' }))
    expect(host.textContent).toContain('The episode did not load a player.')
    expect(button(host, 'Retry')).toBeTruthy()
  })

  test('a page with neither Play nor the sign-in link ends on its line, and remembers nothing', async () => {
    const host = await afterWaits(amazon('<header><a id="nav-link-accountList" data-csa-c-content-id="nav_youraccount_btn">Account</a></header>'))
    expect(host.textContent).toContain('Prime Video shows no Play button for this episode.')
    expect(button(host, 'Retry')).toBeTruthy()
    expect(remembered()).toBeUndefined()
  })

  test('reads refused for the whole wait end on the player\'s own line, not the lib\'s', async () => {
    const host = await afterWaits(refusing('LocatorDeniedError', 'frame: this frame no longer holds the document the app attached it to'))
    expect(host.textContent).toContain('Prime Video shows no Play button for this episode.')
    expect(host.textContent).not.toContain('frame:')
  })

  test('a frame that cannot run page code says so at once, without waiting out the poll', async () => {
    const host = await afterWaits(refusing('LocatorUnsupportedError', 'frame.evaluate: this render proxy predates evaluate; reload the app'), 1_000)
    expect(host.textContent).toContain('this render proxy predates evaluate')
    expect(button(host, 'Retry')).toBeTruthy()
  })

  test('a load cancelled while the video is handed over styles nothing', async () => {
    let release!: () => void
    const page = amazon(SIGNED_IN_PAGE, { handOver: new Promise<void>(resolve => { release = resolve }) })
    lib.attachFrame.mockResolvedValue(page.frame)
    render()
    await vi.waitFor(() => expect(page.handed).toHaveLength(1), { timeout: 5_000 })
    unmount(hosts.pop()!)
    release()
    await settle()
    expect(page.frame.addStyleTag).not.toHaveBeenCalled()
  })

  test('an attach FKN refused shows why, and Retry attaches a fresh frame', async () => {
    lib.attachFrame.mockRejectedValueOnce(new Error('The FKN extension refused the frame.')).mockReturnValue(new Promise(() => {}))
    const host = render()
    await vi.waitFor(() => expect(host.textContent).toContain('The FKN extension refused the frame.'), { timeout: 5_000 })
    button(host, 'Retry')!.click()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    const [first, second] = lib.attachFrame.mock.calls.map(([options]) => (options as { iframe: HTMLIFrameElement }).iframe)
    expect(second).not.toBe(first)
  })

  test('a seek is a currentTime write on Amazon\'s video, with no page code run for it', async () => {
    const page = amazon(SIGNED_IN_PAGE)
    await playing(page)
    const ran = page.frame.evaluate.mock.calls.length

    skin.media!.currentTime = 300
    await settle()

    expect(page.handed[0]!.episode.remote.currentTime).toBe(300)
    expect(page.frame.evaluate).toHaveBeenCalledTimes(ran)
  })

  // Prime keeps no volume of its own (measured 2026-10-12), but its player can still unmute the video
  test('a viewer who left the player muted stays muted when Amazon\'s player unmutes the video', async () => {
    values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
    const page = amazon(SIGNED_IN_PAGE)
    await playing(page)
    const { episode } = page.handed[0]!
    await vi.waitFor(() => expect(episode.video.muted, 'the kept mute reached the video').toBe(true))

    episode.setByPage('muted', false)
    await settle()

    expect(episode.video.muted).toBe(true)
    expect(JSON.parse(values.get(PLAYER_VOLUME_KEY)!)).toEqual({ volume: 1, muted: true })
  })
})

describe('signed out', () => {
  test('a detail page with the header\'s sign-in link and no Play shows the line and the sign-in', async () => {
    const page = amazon(SIGNED_OUT_PAGE)
    lib.attachFrame.mockResolvedValue(page.frame)
    const host = render()
    await signedOut(host)
    expect(page.handed).toEqual([])
    expect(page.frame.addStyleTag).not.toHaveBeenCalled()
    expect(remembered()).toBe('signed-out')
  })

  for (const path of ['/ap/signin?openid.mode=checkid_setup', '/ax/claim/validate', '/gp/video/auth-redirect?ref=atv']) {
    test(`a frame sent on to Amazon's sign-in at ${path.split('?')[0]} shows them too`, async () => {
      const page = amazon('<form name="signIn"><input type="email"></form>', { url: `https://www.amazon.co.jp${path}` })
      lib.attachFrame.mockResolvedValue(page.frame)
      await signedOut(render())
    })
  }

  test('on the extension, signs in on amazon.co.jp in a popup, and loads the episode again once it closes', async () => {
    lib.extension = true
    const popup = { closed: false }
    const open = vi.fn(() => popup)
    vi.stubGlobal('open', open)
    const page = amazon(SIGNED_OUT_PAGE)
    lib.attachFrame.mockResolvedValue(page.frame)
    const host = render()
    ;(await signedOut(host)).click()

    expect(open).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin\?/), '_blank', 'width=500,height=700')
    expect(signIn).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(button(host, 'Finish signing in the window...')?.disabled).toBe(true))

    popup.closed = true
    await vi.waitFor(() => expect(page.frame.goto).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    expect(lib.attachFrame).toHaveBeenCalledTimes(1)
  })

  test('on the cloud, signs in through an FKN window opened inside the click, then attaches afresh', async () => {
    signIn.mockResolvedValue('authed' satisfies WindowSignIn)
    const page = amazon(SIGNED_OUT_PAGE)
    lib.attachFrame.mockResolvedValue(page.frame)
    const host = render()
    ;(await signedOut(host)).click()

    expect(signIn).toHaveBeenCalledTimes(1)
    const [{ url, domains, isSignedIn }] = signIn.mock.calls[0]! as [{ url: string, domains: string[], isSignedIn: (login: Frame) => Promise<boolean> }]
    expect(url).toMatch(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin\?/)
    expect(domains, 'the jar the window writes is the one the frame reads').toEqual(PRIME_DOMAINS)
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(2), { timeout: 5_000 })

    // the window counts as signed in once Amazon's header is there and is not the signed-out one
    const header = (html: string) => amazon(html).frame as unknown as Frame
    expect(await isSignedIn(header(SIGNED_IN_PAGE))).toBe(true)
    expect(await isSignedIn(header(SIGNED_OUT_PAGE))).toBe(false)
    expect(await isSignedIn(header('<form name="signIn"></form>'))).toBe(false)
  })
})

describe('a sign-in that does not sign in', () => {
  const clicked = async (outcome: WindowSignIn) => {
    signIn.mockResolvedValue(outcome)
    const page = amazon(SIGNED_OUT_PAGE)
    lib.attachFrame.mockResolvedValue(page.frame)
    const host = render()
    ;(await signedOut(host)).click()
    return { host, page }
  }

  test('a window closed on the cloud loads the episode again, in the same frame', async () => {
    const { page } = await clicked('closed')
    await vi.waitFor(() => expect(page.frame.goto).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    expect(lib.attachFrame).toHaveBeenCalledTimes(1)
  })

  test('a blocked window asks for popups, and keeps the sign-in', async () => {
    const { host } = await clicked('blocked')
    await vi.waitFor(() => expect(host.textContent).toContain('Allow popups for this page to sign in.'))
    expect(button(host, SIGN_IN)).toBeTruthy()
  })

  test('a window mode refused here shows its line, with Retry', async () => {
    const { host } = await clicked('unsupported')
    await vi.waitFor(() => expect(host.textContent).toContain('The Prime Video sign-in window could not open here.'))
    expect(button(host, 'Retry')).toBeTruthy()
  })

  test('a popup the browser blocked on the extension asks for popups', async () => {
    lib.extension = true
    vi.stubGlobal('open', vi.fn(() => null))
    const page = amazon(SIGNED_OUT_PAGE)
    lib.attachFrame.mockResolvedValue(page.frame)
    const host = render()
    ;(await signedOut(host)).click()
    await vi.waitFor(() => expect(host.textContent).toContain('Allow popups for this page to sign in.'))
  })
})
