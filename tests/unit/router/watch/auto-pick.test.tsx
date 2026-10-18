// FIRST: ../../components/dom installs the document preact renders into.
import { mount, unmount } from '../../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import { bestSource, useAutoPick, type Ways } from '../../../../src/router/watch/auto-pick'

const cr = { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' }
const prime = { uri: 'amazon:gti1', origin: 'amazon', url: 'https://watch.amazon.co.jp/watch?gti=gti1' }
const nyaa = (id: string) => ({ uri: `nyaa:${id}`, origin: 'nyaa', url: `magnet:?xt=urn:btih:${id}` })

const ways = (overrides: Partial<Ways> = {}): Ways => ({
  builtIn: origin => origin === 'cr' || origin === 'amazon',
  selfPlaying: origin => origin === 'nyaa',
  order: ['cr', 'amazon', 'nf'],
  possible: () => true,
  settled: () => false,
  ...overrides,
})

describe('bestSource', () => {
  test('a stream stub plays itself wins over a release listed before it, at once', () => {
    expect(bestSource([nyaa('1'), cr], ways())).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('of several releases, the first listed wins, not the lowest uri', () => {
    expect(bestSource([nyaa('3'), nyaa('1'), nyaa('2')], ways())).toEqual({ uri: 'nyaa:3', now: false })
  })

  test('before the plugin lookup answers, a release is not picked but Crunchyroll is', () => {
    expect(bestSource([nyaa('1')], ways({ selfPlaying: undefined }))).toBeUndefined()
    expect(bestSource([nyaa('1'), cr], ways({ selfPlaying: undefined }))).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('a source turned off, a handle with no url and a magnet with no plugin player are never picked', () => {
    expect(bestSource([cr], ways({ builtIn: () => false }))).toBeUndefined()
    expect(bestSource([{ ...cr, url: null }], ways())).toBeUndefined()
    expect(bestSource([nyaa('1')], ways({ selfPlaying: () => false }))).toBeUndefined()
    expect(bestSource([{ ...nyaa('1'), embedUrl: 'https://embed.test/1' }], ways({ selfPlaying: () => false })))
      .toEqual({ uri: 'nyaa:1', now: false })
  })

  // Frieren from Japan, 2026-10-18: Prime Video answered first and was opened in 13 of 16 fresh runs
  test('stub\'s own players go in the play order, not in the order they answered', () => {
    expect(bestSource([prime, cr], ways())).toEqual({ uri: 'cr:GX1', now: true })
    expect(bestSource([cr, prime], ways({ order: ['amazon', 'cr', 'nf'] }))).toEqual({ uri: 'amazon:gti1', now: true })
  })

  test('a release the viewer ranks first beats Crunchyroll', () => {
    expect(bestSource([cr, nyaa('1')], ways({ order: ['nyaa', 'cr', 'amazon', 'nf'], settled: () => true }))).toEqual({ uri: 'nyaa:1', now: true })
  })

  test('a lower-ranked source waits while one ranked above has not answered, and opens once it has', () => {
    const order = ['nyaa', 'cr', 'amazon', 'nf']
    expect(bestSource([cr], ways({ order }))).toEqual({ uri: 'cr:GX1', now: false })
    expect(bestSource([cr], ways({ order, settled: origin => origin !== 'nyaa' })), 'only the source below answered').toEqual({ uri: 'cr:GX1', now: false })
    expect(bestSource([cr], ways({ order, settled: origin => origin === 'nyaa' }))).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('a source ranked above that cannot play here does not hold the pick', () => {
    expect(bestSource([cr], ways({ order: ['nf', 'cr'], possible: origin => origin !== 'nf' }))).toEqual({ uri: 'cr:GX1', now: true })
  })

  test('an origin the order does not name comes after every one it names', () => {
    const embed = { uri: 'other:1', origin: 'other', url: null, embedUrl: 'https://embed.test/1' }
    expect(bestSource([embed, nyaa('1')], ways({ order: ['nyaa'], settled: () => true }))?.uri).toBe('nyaa:1')
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

  test('a pick that is not now never opens on a timer, and opens as soon as it is', () => {
    vi.useFakeTimers()
    const { navigate, update } = page({ ...at, best: { uri: 'cr:GX1', now: false } })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(navigate).not.toHaveBeenCalled()

    update({ ...at, best: { uri: 'nyaa:1', now: true } })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/nyaa:1', { replace: true })
  })

  // the owner, 2026-10-19: only when their source cannot play it should Play go to the next best ranked one
  test('Play\'s pick that cannot play the episode gives way to the next pick, replacing the address', () => {
    const { navigate, update } = page({ ...at, best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'cr:GX1', best: { uri: 'amazon:gti1', now: true } })
    expect(navigate, 'the control: Play\'s pick that plays stays').toHaveBeenCalledOnce()

    update({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: { uri: 'amazon:gti1', now: true } })
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenLastCalledWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/amazon:gti1', { replace: true })
  })

  test('a source picked by hand that cannot play keeps its message', () => {
    const { navigate } = page({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: { uri: 'amazon:gti1', now: true } })
    expect(navigate).not.toHaveBeenCalled()
  })

  test('Play\'s pick, left for another source and picked again by hand, keeps its message', () => {
    const { navigate, update } = page({ ...at, best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'cr:GX1', best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'nf:81', best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'cr:GX1', best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: { uri: 'amazon:gti1', now: true } })
    expect(navigate).toHaveBeenCalledOnce()
  })

  test('Play\'s pick that cannot play waits for the next pick to be now, and stays when there is none', () => {
    const { navigate, update } = page({ ...at, best: { uri: 'cr:GX1', now: true } })
    update({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: undefined })
    update({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: { uri: 'nyaa:1', now: false } })
    expect(navigate).toHaveBeenCalledOnce()

    update({ ...at, sourceUri: 'cr:GX1', cannotPlay: true, best: { uri: 'nyaa:1', now: true } })
    expect(navigate).toHaveBeenLastCalledWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/nyaa:1', { replace: true })
  })

  test('nothing opens when the address names a source, or for a party guest', () => {
    vi.useFakeTimers()
    const named = page({ ...at, sourceUri: 'nyaa:1', best: { uri: 'cr:GX1', now: true } })
    const guest = page({ ...at, guest: true, best: { uri: 'cr:GX1', now: true } })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(named.navigate).not.toHaveBeenCalled()
    expect(guest.navigate).not.toHaveBeenCalled()
  })
})
