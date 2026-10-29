// FIRST, and it has to stay first: ../../components/dom installs the document that @emotion/react
// reads at module scope. See the file for what happens when it does not.
import { mount, unmount, withIntl } from '../../components/dom'

import type { ComponentChildren } from 'preact'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

// The Netflix player's attach, rendered for real against a mocked lib: Netflix plays on the extension
// alone, and since @fkn/lib 0.9.42 the jar picks the backend, so the attach names the browser's own
// cookies, and a page with no extension gets one install prompt (the lib's) rather than one per retry.

const lib = vi.hoisted(() => ({ extension: false, attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => lib.extension,
}))

// the media player skin needs a real media to draw anything, and none of it is under test here
vi.mock('../../../../src/sources/unogs/nf-videojs-player', () => ({
  default: ({ children }: { children?: ComponentChildren }) => <div className="skin">{children}</div>,
}))

const { default: NetflixPlayer } = await import('../../../../src/sources/unogs/player')

const EPISODE = 'https://www.netflix.com/watch/80000000'
const NEEDS_EXTENSION = 'Netflix playback currently needs the FKN browser extension.'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const hosts: HTMLElement[] = []
const render = () => {
  const host = mount(withIntl(<NetflixPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" />))
  hosts.push(host)
  return host
}

beforeEach(() => {
  lib.extension = false
  lib.attachFrame.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

describe('attaching the Netflix frame', () => {
  test("asks for the browser's own cookies, which only the extension serves", async () => {
    lib.extension = true
    lib.attachFrame.mockReturnValue(new Promise(() => {}))
    render()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(1))
    expect(lib.attachFrame).toHaveBeenCalledWith(expect.objectContaining({ domains: expect.arrayContaining(['www.netflix.com']), cookies: 'native' }))
  })

  test('with no extension, a refused attach shows that Netflix needs it, and is not tried again', async () => {
    lib.attachFrame.mockRejectedValue(new Error('The FKN WebExtension is not installed, enabled or not exposed on this page.'))
    const host = render()
    await vi.waitFor(() => expect(host.textContent).toContain(NEEDS_EXTENSION))
    // past the first retry's 300 ms backoff
    await sleep(500)
    expect(lib.attachFrame).toHaveBeenCalledTimes(1)
  })

  test('the control: with the extension, a failed attach is tried again', async () => {
    lib.extension = true
    lib.attachFrame.mockRejectedValueOnce(new Error('the content script was not ready')).mockReturnValue(new Promise(() => {}))
    const host = render()
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalledTimes(2), { timeout: 2_000 })
    expect(host.textContent).not.toContain(NEEDS_EXTENSION)
  })
})

describe('its words over the frame', () => {
  test('Loading Netflix player... while the frame attaches', () => {
    lib.extension = true
    lib.attachFrame.mockReturnValue(new Promise(() => {}))
    expect(render().querySelector('.overlay')?.textContent).toBe('Loading Netflix player...')
  })

  test('signed out, a line asking to sign in to Netflix and the button opening its login page', async () => {
    lib.extension = true
    lib.attachFrame.mockResolvedValue({ goto: async () => {}, addStyleTag: async () => {}, locator: (selector: string) => ({ exists: async () => selector.includes('/login') }) })
    const host = render()
    await vi.waitFor(() => expect(host.querySelector('.overlay button')?.textContent).toBe('Open Netflix Login Page'))
    expect(host.querySelector('.overlay')?.textContent).toBe('Sign in to Netflix to watch.Open Netflix Login Page')
  })
})
