// FIRST: ../../components/dom installs the document preact renders into.
import { mount, unmount } from '../../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

import { bestSource, playPick, useAutoPick, type Access, type Ways } from '../../../../src/router/watch/auto-pick'

const cr = { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' }
const prime = { uri: 'amazon:gti1', origin: 'amazon', url: 'https://watch.amazon.co.jp/watch?gti=gti1' }
const nyaa = (id: string) => ({ uri: `nyaa:${id}`, origin: 'nyaa', url: `magnet:?xt=urn:btih:${id}` })

const ways = (overrides: Partial<Ways> = {}): Ways => ({
  builtIn: origin => origin === 'cr' || origin === 'amazon',
  selfPlaying: origin => origin === 'nyaa',
  off: () => false,
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
    expect(bestSource([nyaa('1'), { ...nyaa('2'), embedUrl: 'https://embed.test/2' }, cr], ways({ order: ['nyaa', 'cr'], off: origin => origin === 'nyaa', possible: origin => origin !== 'nyaa' })))
      .toEqual({ uri: 'cr:GX1', now: true })
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

// HOR-1014: an episode whose every source plays only once the viewer signs in asks them to, rather than opening one
describe('playPick', () => {
  const playsButCr = (handle: { origin: string }) => handle.origin !== 'cr'
  // Crunchyroll still to sign in to, and no state stub learned of any site
  const unknown: Access = { plays: playsButCr, free: playsButCr, signedOut: () => false }
  const answered = { answered: true, asked: false, moving: false }

  test('with none, nothing is opened, and the page is stuck once every source has answered', () => {
    expect(playPick([cr], ways(), unknown, { ...answered, answered: false })).toEqual({ pick: undefined, stuck: false })
    expect(playPick([cr], ways(), unknown, answered)).toEqual({ pick: undefined, stuck: true })
    expect(playPick([], ways(), unknown, answered), 'an episode with no source at all').toEqual({ pick: undefined, stuck: true })
    expect(playPick([cr], ways(), { ...unknown, plays: () => true }, answered), 'the control: every source plays').toEqual({ pick: { uri: 'cr:GX1', now: true }, stuck: false })
  })

  test('once asked, the page stays stuck while sources answer again, and then opens only what plays without a sign in', () => {
    expect(playPick([cr], ways(), unknown, { ...answered, answered: false, asked: true })).toEqual({ pick: undefined, stuck: true })
    expect(playPick([cr, prime], ways({ settled: () => true }), unknown, { ...answered, asked: true })).toEqual({ pick: { uri: 'amazon:gti1', now: true }, stuck: false })
  })

  // the owner, 2026-10-19: "Only if their sources aren't available should it go to the next best ranked source available."
  test('moving on from its own pick that cannot play, Play opens the next ranked source, one still to sign in to too, unless the page has asked', () => {
    expect(playPick([cr], ways(), unknown, { ...answered, moving: true })).toEqual({ pick: { uri: 'cr:GX1', now: true }, stuck: true })
    expect(playPick([cr], ways(), unknown, { ...answered, moving: true, asked: true })).toEqual({ pick: undefined, stuck: true })
  })
})

// HOR-1033, the owner, 2026-10-25: "route automatically the user to free watching alternatives available if there are
// any instead of defaulting to premium sources when the user is not logged in"
describe('playPick for a viewer found signed out', () => {
  const nf = { uri: 'nf:81', origin: 'nf', url: 'https://www.netflix.com/watch/81' }
  const primeUs = { uri: 'amazon:us', origin: 'amazon', url: 'https://watch.amazon.com/watch?gti=us' }
  const every = ways({ builtIn: origin => ['cr', 'amazon', 'nf'].includes(origin), settled: () => true })
  // a computer's cloud browser without the extension: Crunchyroll owes a sign in, and Netflix and Prime Video
  // outside Japan need the extension, which it can add
  const cloud = (signedOut: string[] = []): Access => {
    const owes = (handle: { origin: string }) => handle.origin === 'cr'
    const extensionOnly = (handle: { uri: string }) => handle.uri === nf.uri || handle.uri === primeUs.uri
    return {
      plays: handle => !owes(handle),
      free: handle => !owes(handle) && !extensionOnly(handle) && !signedOut.includes(handle.origin),
      signedOut: handle => signedOut.includes(handle.origin),
    }
  }
  // with the extension nothing owes a sign in or needs the extension
  const extension = (signedOut: string[] = []): Access => ({
    plays: () => true,
    free: handle => !signedOut.includes(handle.origin),
    signedOut: handle => signedOut.includes(handle.origin),
  })
  const answered = { answered: true, asked: false, moving: false }

  test('a favourite the viewer was found signed out of gives way to the release, once the sources ranked above it have answered', () => {
    expect(playPick([cr, nyaa('1')], every, cloud(['cr']), answered)).toEqual({ pick: { uri: 'nyaa:1', now: true }, stuck: false })
    expect(playPick([cr, nyaa('1')], ways({ settled: () => false }), cloud(['cr']), answered), 'Crunchyroll not answered yet, and not opened meanwhile')
      .toEqual({ pick: { uri: 'nyaa:1', now: false }, stuck: false })
  })

  test('Netflix or Prime Video outside Japan ranked between them, which need the extension, never take the release\'s place', () => {
    expect(playPick([cr, nf, nyaa('1')], every, cloud(['cr']), answered).pick?.uri).toBe('nyaa:1')
    expect(playPick([cr, primeUs, nyaa('1')], every, cloud(['cr']), answered).pick?.uri).toBe('nyaa:1')
  })

  test('a favourite stub knows nothing of still opens, for its player to learn the state', () => {
    expect(playPick([cr, nyaa('1')], every, cloud(), answered).pick?.uri).toBe('cr:GX1')
  })

  test('a favourite that needs the extension still opens, with the viewer found signed out of the source below it', () => {
    expect(playPick([cr, nf, nyaa('1')], ways({ ...every, order: ['nf', 'cr', 'amazon'] }), cloud(['cr']), answered).pick?.uri).toBe('nf:81')
  })

  test('with nothing that plays with nothing to fix, the favourite still opens', () => {
    expect(playPick([cr, nf], every, cloud(['cr']), answered)).toEqual({ pick: { uri: 'cr:GX1', now: true }, stuck: false })
  })

  test('with the extension, the release takes the favourite\'s place too, and with none the favourite opens and the page is never stuck', () => {
    expect(playPick([cr, nyaa('1')], every, extension(['cr']), answered).pick?.uri).toBe('nyaa:1')
    expect(playPick([cr], every, extension(['cr']), answered)).toEqual({ pick: { uri: 'cr:GX1', now: true }, stuck: false })
  })

  test('moving on from a failed pick while something plays goes to the release past a source found signed out, not past one never seen', () => {
    const order = ['amazon', 'cr', 'nf']
    expect(playPick([cr, nyaa('1')], ways({ ...every, order }), cloud(['cr']), { ...answered, moving: true }).pick?.uri).toBe('nyaa:1')
    expect(playPick([cr, nyaa('1')], ways({ ...every, order }), cloud(), { ...answered, moving: true }).pick?.uri).toBe('cr:GX1')
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

  // a scene search's link names the second to start at, and Play's pick must not drop it
  test('the pick keeps the address\'s query string', () => {
    const { navigate } = page({ ...at, search: 't=272', best: { uri: 'cr:GX1', now: true } })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/watch/ag:(anilist:1)/ag:(anilist:1-1)/cr:GX1?t=272', { replace: true })
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
