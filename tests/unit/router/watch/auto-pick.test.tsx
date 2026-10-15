// FIRST: ../../components/dom installs the document preact renders into.
import { mount, unmount } from '../../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import { bestSource, QUIET_MS, useAutoPick, type Ways } from '../../../../src/router/watch/auto-pick'

const cr = { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' }
const nyaa = (id: string) => ({ uri: `nyaa:${id}`, origin: 'nyaa', url: `magnet:?xt=urn:btih:${id}` })

const ways = (overrides: Partial<Ways> = {}): Ways => ({
  builtIn: origin => origin === 'cr',
  signedOut: () => false,
  selfPlaying: origin => origin === 'nyaa',
  ...overrides,
})

describe('bestSource', () => {
  test('a stream stub plays itself wins over a release listed before it, at once', () => {
    expect(bestSource([nyaa('1'), cr], ways())).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('of several releases, the first listed wins, not the lowest uri', () => {
    expect(bestSource([nyaa('3'), nyaa('1'), nyaa('2')], ways())).toEqual({ uri: 'nyaa:3', now: false })
  })

  test('a Crunchyroll the viewer is signed out of is never picked, a signed-in one at once', () => {
    const signedOut = ways({ signedOut: origin => origin === 'cr' })
    expect(bestSource([cr, nyaa('1')], signedOut)).toEqual({ uri: 'nyaa:1', now: false })
    expect(bestSource([cr], signedOut)).toBeUndefined()
    expect(bestSource([cr], ways())).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('before the plugin lookup answers, a release is not picked but Crunchyroll is', () => {
    expect(bestSource([nyaa('1')], ways({ selfPlaying: undefined }))).toBeUndefined()
    expect(bestSource([cr, nyaa('1')], ways({ selfPlaying: undefined, signedOut: origin => origin === 'cr' }))).toBeUndefined()
    expect(bestSource([nyaa('1'), cr], ways({ selfPlaying: undefined }))).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('a source turned off, a handle with no url and a magnet with no plugin player are never picked', () => {
    expect(bestSource([cr], ways({ builtIn: () => false }))).toBeUndefined()
    expect(bestSource([{ ...cr, url: null }], ways())).toBeUndefined()
    expect(bestSource([nyaa('1')], ways({ selfPlaying: () => false }))).toBeUndefined()
    expect(bestSource([{ ...nyaa('1'), embedUrl: 'https://embed.test/1' }], ways({ selfPlaying: () => false })))
      .toEqual({ uri: 'nyaa:1', now: false })
  })
})

describe('useAutoPick', () => {
  type Props = Parameters<typeof useAutoPick>[1] & { best: Parameters<typeof useAutoPick>[0] }
  const Pick = ({ best, navigate, ...params }: Props & { navigate: Parameters<typeof useAutoPick>[2] }) => {
    useAutoPick(best, params, navigate)
    return null
  }

  const hosts: HTMLElement[] = []
  afterEach(() => {
    while (hosts.length) unmount(hosts.pop()!)
    vi.useRealTimers()
  })

  const page = (props: Props) => {
    const navigate = vi.fn()
    const host = mount(<Pick {...props} navigate={navigate}/>)
    hosts.push(host)
    return { navigate, update: (next: Props) => act(() => { render(<Pick {...next} navigate={navigate}/>, host) }) }
  }
  const at = { mediaUri: 'ag:(anilist:1)', episodeUri: 'ag:(anilist:1-1)', guest: false }

  test('a pick that nothing can outrank opens at once, replacing the address', () => {
    const { navigate } = page({ ...at, best: { uri: 'cr:GX1', now: true } })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/cr:GX1', { replace: true })
  })

  test('a release opens once it has stayed the best for QUIET_MS, and a new best restarts the wait', () => {
    vi.useFakeTimers()
    const { navigate, update } = page({ ...at, best: { uri: 'nyaa:1', now: false } })
    act(() => { vi.advanceTimersByTime(QUIET_MS - 1) })
    expect(navigate).not.toHaveBeenCalled()

    update({ ...at, best: { uri: 'nyaa:2', now: false } })
    act(() => { vi.advanceTimersByTime(QUIET_MS - 1) })
    expect(navigate).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/nyaa:2', { replace: true })
  })

  test('nothing opens when the address names a source, or for a party guest', () => {
    vi.useFakeTimers()
    const named = page({ ...at, sourceUri: 'nyaa:1', best: { uri: 'cr:GX1', now: true } })
    const guest = page({ ...at, guest: true, best: { uri: 'cr:GX1', now: true } })
    act(() => { vi.advanceTimersByTime(QUIET_MS) })
    expect(named.navigate).not.toHaveBeenCalled()
    expect(guest.navigate).not.toHaveBeenCalled()
  })
})
