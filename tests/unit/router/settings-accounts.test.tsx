// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'

import type { AccountsProps, TrackerSite } from '../../../src/router/settings/accounts'
import type { CompactAnswer } from '../../../src/tracking/compact'
import type { SiteState, StatusSite } from '../../../src/tracking/site-status'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { createRefresh, createSiteStatuses, FRESH_MS, recordTrackerAnswers } from '../../../src/tracking/site-status'
import { pickCountry } from '../../../src/sources/country'
import { viewerIn } from '../sources/justwatch/viewer'

// lucide-react is CommonJS and requires react under node; the tracking row draws its icons with it
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Smile', 'Star'].map(name => [name, () => null])))

const { AccountsSection } = await import('../../../src/router/settings/accounts')
const { default: TrackingCompact } = await import('../../../src/components/tracking-compact')

// The Accounts section of the settings page: every sign-in stub uses, what it is, and the way out of it
// where one exists. On the cloud a site's session sits in FKN's jar, which a sign out empties; with the
// extension it is the browser's own, which stub can only stop using.

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

const fakeSites = (connected: TrackerSite[] = []) => {
  const on = new Set(connected)
  const listeners = new Map<TrackerSite, Set<() => void>>()
  const tell = (site: TrackerSite) => { for (const listener of listeners.get(site) ?? []) listener() }
  const sites: AccountsProps['sites'] = {
    isConnected: site => on.has(site),
    watch: (site, listener) => {
      const set = listeners.get(site) ?? new Set()
      listeners.set(site, set)
      set.add(listener)
      return () => { set.delete(listener) }
    },
    signIn: vi.fn(async (site: TrackerSite) => { on.add(site); tell(site); return 'authed' as const }),
    signOut: vi.fn(async (site: TrackerSite) => { on.delete(site); tell(site) }),
  }
  return sites
}

const NOW = Date.UTC(2026, 9, 7, 12)
const HOUR = 3_600_000

/** Remembered states over memory, refreshed the way the page refreshes them, by a counted ask answering `answers`. */
const fakeStatus = (answers: Partial<Record<StatusSite, SiteState | Error>> = {}, now = () => NOW) => {
  const values = new Map<string, string>()
  const statuses = createSiteStatuses(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }))
  const ask = vi.fn(async (site: StatusSite, _backend: FknBackend) => {
    const answer = answers[site]
    if (answer === undefined || answer instanceof Error) throw answer ?? new Error('no answer')
    return answer
  })
  const status: AccountsProps['status'] = { read: statuses.read, watch: statuses.watch, refresh: createRefresh(statuses, ask, now) }
  return { status, statuses, ask }
}

const render = (overrides: Partial<AccountsProps> = {}) => {
  const props: AccountsProps = {
    backend: 'cloud',
    crunchyroll: { signIn: vi.fn(async () => 'authed' as const), signOut: vi.fn(async () => {}) },
    prime: { signIn: vi.fn(async () => 'authed' as const), signOut: vi.fn(async () => {}) },
    sites: fakeSites(),
    status: fakeStatus().status,
    ...overrides,
  }
  const host = mount(<AccountsSection {...props}/>)
  hosts.push(host)
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-account="${id}"]`)!
  return { host, props, row }
}

const chip = (row: HTMLElement) => row.querySelector('.head .state')?.textContent

/** Stub remembers the viewer signed in to `site`, so its row offers the sign out. */
const signedInTo = (site: StatusSite) => {
  const remembered = fakeStatus()
  remembered.statuses.record(site, 'signed-in', NOW)
  return remembered.status
}

test('lists the sites stub signs in to, and not the FKN account the header already shows', () => {
  const { host } = render()
  expect([...host.querySelectorAll('[data-account]')].map(row => row.getAttribute('data-account'))).toEqual(['crunchyroll', 'prime', 'anilist', 'mal', 'netflix'])
})

describe('Crunchyroll on the cloud', () => {
  test('signs in through a window', async () => {
    const { row, props } = render()
    await act(async () => { button(row('crunchyroll'), 'Sign in')!.click() })
    expect(props.crunchyroll.signIn).toHaveBeenCalledTimes(1)
  })

  test('signs out only once asked twice, and the question says every fkn.app app is signed out', async () => {
    const { row, props } = render({ status: signedInTo('crunchyroll') })
    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    expect(props.crunchyroll.signOut).not.toHaveBeenCalled()
    expect(row('crunchyroll').textContent).toContain('Sign out of Crunchyroll in every fkn.app app?')

    await act(async () => { button(row('crunchyroll'), 'Cancel')!.click() })
    expect(props.crunchyroll.signOut).not.toHaveBeenCalled()
    expect(button(row('crunchyroll'), 'Yes, sign out')).toBeFalsy()

    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    await act(async () => { button(row('crunchyroll'), 'Yes, sign out')!.click() })
    await flush()
    expect(props.crunchyroll.signOut).toHaveBeenCalledTimes(1)
    expect(row('crunchyroll').textContent).toContain('Signed out')
  })

  test('a sign out FKN refused says why', async () => {
    const { row } = render({ status: signedInTo('crunchyroll'), crunchyroll: { signIn: async () => 'authed', signOut: async () => { throw new Error('the render proxy did not answer') } } })
    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    await act(async () => { button(row('crunchyroll'), 'Yes, sign out')!.click() })
    await flush()
    expect(row('crunchyroll').textContent).toContain('the render proxy did not answer')
  })
})

// a cloud Prime Video sign-in sits in FKN's jar like Crunchyroll's, and this is the only way to end it
describe('Prime Video', () => {
  test('on the cloud in Japan, signs out of FKN\'s jar once asked twice, and signs in through a window', async () => {
    viewerIn('Asia/Tokyo')
    const { row, props } = render({ status: signedInTo('prime') })
    expect(row('prime').querySelector('h3')!.textContent).toBe('Prime Video')
    await act(async () => { button(row('prime'), 'Sign out')!.click() })
    expect(row('prime').textContent).toContain('Sign out of Prime Video in every fkn.app app?')
    await act(async () => { button(row('prime'), 'Yes, sign out')!.click() })
    await flush()
    expect(props.prime.signOut).toHaveBeenCalledTimes(1)
    expect(props.crunchyroll.signOut).not.toHaveBeenCalled()

    const fresh = render()
    await act(async () => { button(fresh.row('prime'), 'Sign in')!.click() })
    expect(fresh.props.prime.signIn).toHaveBeenCalledTimes(1)
    expect(fresh.props.crunchyroll.signIn).not.toHaveBeenCalled()
  })

  test('shows what the player last learned, and is never checked on its own', async () => {
    const { status, statuses, ask } = fakeStatus()
    statuses.record('prime', 'signed-in', NOW - 2 * HOUR)
    const { row } = render({ status })
    await flush()
    expect(chip(row('prime'))).toBe('Signed in')
    expect(ask).not.toHaveBeenCalled()
  })

  test('with the extension, links to the viewer\'s country\'s Prime Video and offers nothing to press', () => {
    viewerIn('Asia/Tokyo')
    const extension = render({ backend: 'extension' }).row('prime')
    expect(extension.querySelector('a')!.getAttribute('href')).toBe('https://www.amazon.co.jp')
    expect(extension.querySelector('a')!.textContent).toBe('Open amazon.co.jp')
    expect(extension.querySelectorAll('button')).toHaveLength(0)
  })

  // MUTATED: drop the row's `signsInOnCloud` condition and both offer a Sign in that lands on a relay's region
  test('on the cloud outside Japan, links to the viewer\'s country\'s Prime Video and offers nothing to press', () => {
    for (const [zone, host] of [['America/New_York', 'amazon.com'], ['America/Toronto', 'primevideo.com']] as const) {
      viewerIn(zone)
      const cloud = render().row('prime')
      expect(cloud.querySelector('a')?.getAttribute('href'), zone).toBe(`https://www.${host}`)
      expect(cloud.querySelector('a')!.textContent).toBe(`Open ${host}`)
      expect(cloud.querySelectorAll('button'), zone).toHaveLength(0)
    }
  })

  test('the Prime Video row follows the country, picked or guessed', async () => {
    viewerIn('America/Toronto')
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
    const { row } = render({ backend: 'extension' })
    expect(row('prime').querySelector('a')!.getAttribute('href')).toBe('https://www.primevideo.com')
    await act(async () => { pickCountry('GB') })
    expect(row('prime').querySelector('a')!.getAttribute('href')).toBe('https://www.amazon.co.uk')
    expect(row('crunchyroll').querySelector('a')!.getAttribute('href'), 'Crunchyroll is one site everywhere').toBe('https://www.crunchyroll.com')
    vi.unstubAllGlobals()
  })
})

describe('AniList and MyAnimeList', () => {
  test('a site connected here offers Sign out, which disconnects it after asking', async () => {
    const sites = fakeSites(['anilist'])
    const { row } = render({ sites })
    expect(chip(row('anilist')), 'nothing learned yet').toBeUndefined()
    expect(chip(row('mal'))).toBe('Not connected')

    await act(async () => { button(row('anilist'), 'Sign out')!.click() })
    expect(sites.signOut).not.toHaveBeenCalled()
    await act(async () => { button(row('anilist'), 'Yes, sign out')!.click() })
    await flush()
    expect(sites.signOut).toHaveBeenCalledWith('anilist', 'cloud')
    expect(row('anilist').textContent).toContain('Not connected')
    expect(button(row('anilist'), 'Sign in')).toBeTruthy()
  })

  test('a site not connected offers Sign in, opened inside the click', async () => {
    const sites = fakeSites()
    const { row } = render({ sites })
    await act(async () => { button(row('mal'), 'Sign in')!.click() })
    expect(sites.signIn).toHaveBeenCalledWith('mal')
    await flush()
    expect(chip(row('mal'))).toBeUndefined()
    expect(button(row('mal'), 'Sign out')).toBeTruthy()
  })

  test('a window the browser blocked says how to let it open', async () => {
    const sites = { ...fakeSites(), signIn: vi.fn(async () => 'blocked' as const) }
    const { row } = render({ sites })
    await act(async () => { button(row('anilist'), 'Sign in')!.click() })
    await flush()
    expect(row('anilist').textContent).toContain('blocked')
  })
})

describe('with the FKN extension', () => {
  test("Crunchyroll runs on the browser's own session: no stub sign out, and where to end it", () => {
    const { row } = render({ backend: 'extension' })
    expect(button(row('crunchyroll'), 'Sign out')).toBeFalsy()
    expect(button(row('crunchyroll'), 'Sign in')).toBeFalsy()
    expect(row('crunchyroll').querySelector('a')?.getAttribute('href')).toBe('https://www.crunchyroll.com')
  })

  test("a connected tracking site offers Disconnect, which leaves the browser's session alone", async () => {
    const sites = fakeSites(['anilist'])
    const { row } = render({ backend: 'extension', sites })
    expect(button(row('anilist'), 'Sign out')).toBeFalsy()
    await act(async () => { button(row('anilist'), 'Disconnect')!.click() })
    await act(async () => { button(row('anilist'), 'Yes, disconnect')!.click() })
    await flush()
    expect(sites.signOut).toHaveBeenCalledWith('anilist', 'extension')
    expect(row('anilist').textContent).toContain('Disconnected.')
    expect(button(row('mal'), 'Connect')).toBeTruthy()
  })
})

describe('Netflix', () => {
  test('plays only through the extension, on the browser\'s own session, so there is nothing for stub to sign out', () => {
    const cloud = render().row('netflix')
    expect(cloud.textContent).toContain('Needs the FKN browser extension')
    expect(cloud.querySelectorAll('button')).toHaveLength(0)

    const extension = render({ backend: 'extension' }).row('netflix')
    expect(extension.textContent).toContain('netflix.com')
    expect(extension.querySelectorAll('button')).toHaveLength(0)
  })
})

test('while it is not known yet whether the extension runs, no site offers an action', () => {
  const { row } = render({ backend: undefined, sites: fakeSites(['anilist']) })
  for (const id of ['crunchyroll', 'prime', 'anilist', 'mal', 'netflix']) expect(row(id).querySelectorAll('button'), id).toHaveLength(0)
})

describe('for a screen reader', () => {
  test('each sign out is named for its site', () => {
    const { row } = render({ sites: fakeSites(['anilist']), status: signedInTo('crunchyroll') })
    expect(button(row('crunchyroll'), 'Sign out')!.getAttribute('aria-label')).toBe('Sign out of Crunchyroll')
    expect(button(row('anilist'), 'Sign out')!.getAttribute('aria-label')).toBe('Sign out of AniList')

    const extension = render({ backend: 'extension', sites: fakeSites(['mal']) })
    expect(button(extension.row('mal'), 'Disconnect')!.getAttribute('aria-label')).toBe('Disconnect MyAnimeList')
  })

  test('every row holds its status region from the start, so the note it later gets is announced', () => {
    const { row } = render()
    for (const id of ['crunchyroll', 'anilist', 'mal']) {
      const status = row(id).querySelector('[role="status"]')
      expect(status, id).toBeTruthy()
      expect(status!.textContent, id).toBe('')
    }
  })
})

describe('the sign-in states', () => {
  const labels = (row: HTMLElement) => [...row.querySelectorAll('.actions button')].map(item => item.textContent)

  // the owner, 2026-10-12: "instead of having things like 'Signed in, checked 6 hours ago', and 'Check
  // now', can we just make it automatically recheck and hide this from the user?"
  test('a row shows what stub last learned, with no age and nothing to press to check it', () => {
    const { status, statuses } = fakeStatus()
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    statuses.record('anilist', 'signed-out', NOW - 26 * HOUR)
    const { host, row } = render({ status, sites: fakeSites(['anilist']) })

    expect(chip(row('crunchyroll'))).toBe('Signed in')
    expect(chip(row('anilist'))).toBe('Signed out')
    expect(row('anilist').querySelector('.head .state')!.classList.contains('on'), 'signed out is not shown as on').toBe(false)
    expect(host.textContent).not.toMatch(/checked|Check/)
    expect([...host.querySelectorAll('button')].map(item => item.textContent).filter(text => /check/i.test(text ?? ''))).toEqual([])
  })

  // the owner, 2026-10-10: "it shows Sign in on crunchyroll when it already says signed in"; and 2026-10-17 (HOR-755):
  // stub cannot check a session it has never seen without a permission, so it reads signed out and Sign in asks for it
  test('Crunchyroll and Prime Video offer the one action their last known state calls for, Sign in before stub knows', () => {
    const signedIn = fakeStatus()
    signedIn.statuses.record('crunchyroll', 'signed-in', NOW)
    expect(labels(render({ status: signedIn.status }).row('crunchyroll'))).toEqual(['Sign out'])

    const signedOut = fakeStatus()
    signedOut.statuses.record('crunchyroll', 'signed-out', NOW)
    expect(labels(render({ status: signedOut.status }).row('crunchyroll'))).toEqual(['Sign in'])

    viewerIn('Asia/Tokyo')
    const fresh = render()
    for (const id of ['crunchyroll', 'prime']) {
      expect(labels(fresh.row(id)), id).toEqual(['Sign in'])
      expect(chip(fresh.row(id)), id).toBe('Signed out')
    }
    expect(labels(render({ status: signedInTo('prime') }).row('prime'))).toEqual(['Sign out'])
  })

  test('a Crunchyroll sign out that lands offers Sign in in its place, and says it signed out', async () => {
    const { status, statuses } = fakeStatus()
    statuses.record('crunchyroll', 'signed-in', NOW)
    const signOut = vi.fn(async () => { statuses.record('crunchyroll', 'signed-out', NOW) })
    const { row } = render({ status, crunchyroll: { signIn: vi.fn(async () => 'authed' as const), signOut } })
    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    await act(async () => { button(row('crunchyroll'), 'Yes, sign out')!.click() })
    await flush()

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(labels(row('crunchyroll'))).toEqual(['Sign in'])
    expect(row('crunchyroll').querySelector('[role="status"]')!.textContent).toBe('Signed out.')
  })

  test('with nothing remembered, Crunchyroll reads signed out, a connected site shows no state, and one not connected says so', () => {
    const { row } = render({ sites: fakeSites(['mal']) })

    expect(chip(row('crunchyroll'))).toBe('Signed out')
    expect(chip(row('mal'))).toBeUndefined()
    expect(chip(row('anilist'))).toBe('Not connected')
  })

  test('once the backend is known to be the cloud, opening the section asks a Crunchyroll stub knows of, and no tracker site', async () => {
    const { status, statuses, ask } = fakeStatus()
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    statuses.record('anilist', 'signed-in', NOW - 2 * HOUR)
    let known!: (backend: FknBackend) => void
    const Harness = () => {
      const [backend, setBackend] = useState<FknBackend>()
      known = setBackend
      return <AccountsSection backend={backend} crunchyroll={{ signIn: async () => 'authed', signOut: async () => {} }} prime={{ signIn: async () => 'authed', signOut: async () => {} }} sites={fakeSites(['anilist', 'mal'])} status={status}/>
    }
    hosts.push(mount(<Harness/>))
    await flush()
    expect(ask, 'what a check does depends on the backend').not.toHaveBeenCalled()

    await act(async () => { known('cloud') })
    expect(ask.mock.calls, "the trackers' own paced reads keep their sites' states").toEqual([['crunchyroll', 'cloud']])

    const unknown = fakeStatus()
    render({ status: unknown.status, sites: fakeSites(['mal', 'anilist']) })
    expect(unknown.ask, 'nothing learned of Crunchyroll yet').not.toHaveBeenCalled()

    const extension = fakeStatus()
    extension.statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    render({ status: extension.status, backend: 'extension' })
    expect(extension.ask, "with the extension each check would be a new Crunchyroll device").not.toHaveBeenCalled()
  })

  test('an answer the automatic check gets shows at once', async () => {
    const { status, statuses, ask } = fakeStatus({ crunchyroll: 'signed-out' })
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    const { row } = render({ status })
    await flush()

    expect(ask.mock.calls).toEqual([['crunchyroll', 'cloud']])
    expect(chip(row('crunchyroll'))).toBe('Signed out')
  })

  test('a state under FRESH_MS old is not asked', async () => {
    const fresh = fakeStatus()
    fresh.statuses.record('crunchyroll', 'signed-in', NOW - FRESH_MS + 1_000)
    render({ status: fresh.status })
    const stale = fakeStatus()
    stale.statuses.record('crunchyroll', 'signed-in', NOW - FRESH_MS)
    render({ status: stale.status })
    await flush()

    expect(fresh.ask).not.toHaveBeenCalled()
    expect(stale.ask.mock.calls).toEqual([['crunchyroll', 'cloud']])
  })

  test('an automatic check that gets no answer shows nothing and keeps the state stub had', async () => {
    const { status, statuses, ask } = fakeStatus({ crunchyroll: new Error('Crunchyroll answered 503') })
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    const { row } = render({ status })
    await flush()

    expect(ask).toHaveBeenCalledTimes(1)
    expect(chip(row('crunchyroll'))).toBe('Signed in')
    expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-in', checkedAt: NOW - 2 * HOUR })
    expect(row('crunchyroll').querySelector('[role="status"]')!.textContent).toBe('')
  })

  test('the page coming back into view asks again once what stub learned is stale, and a hidden page asks nothing', async () => {
    let clock = NOW
    const { status, statuses, ask } = fakeStatus({ crunchyroll: 'signed-in' }, () => clock)
    statuses.record('crunchyroll', 'signed-out', NOW - 2 * HOUR)
    const { row } = render({ status })
    await flush()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(chip(row('crunchyroll'))).toBe('Signed in')

    const visible = async () => { await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); await flush() }
    await visible()
    expect(ask, 'just learned').toHaveBeenCalledTimes(1)

    clock += FRESH_MS
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await visible()
      expect(ask, 'a hidden page').toHaveBeenCalledTimes(1)
    } finally {
      delete (document as { visibilityState?: string }).visibilityState
    }
    await visible()
    expect(ask).toHaveBeenCalledTimes(2)
  })

  test('a state stub learns elsewhere on the page shows at once', async () => {
    const { status, statuses } = fakeStatus()
    const { row } = render({ status })
    await act(async () => { statuses.record('crunchyroll', 'signed-in', NOW) })

    expect(chip(row('crunchyroll'))).toBe('Signed in')
  })
})

describe('a connected tracking site whose session stub learned is signed out', () => {
  const labels = (row: HTMLElement) => [...row.querySelectorAll('.actions button')].map(item => item.textContent)
  const TRACKERS = [['anilist', 'AniList', 'anilist.co'], ['mal', 'MyAnimeList', 'myanimelist.net']] as const

  const signedOut = (site: TrackerSite, backend: FknBackend = 'cloud') => {
    const { status, statuses } = fakeStatus()
    statuses.record(site, 'signed-out', NOW)
    const sites = fakeSites([site])
    return { ...render({ backend, status, sites }), sites, statuses }
  }

  test.each(TRACKERS)('%s offers Sign in and no Sign out', async (site, title) => {
    const { row, sites } = signedOut(site)
    expect(chip(row(site))).toBe('Signed out')
    expect(labels(row(site))).toEqual(['Sign in'])
    expect(button(row(site), `Sign out of ${title}`)).toBeFalsy()

    await act(async () => { button(row(site), 'Sign in')!.click() })
    expect(sites.signIn).toHaveBeenCalledWith(site)
  })

  test.each(TRACKERS)('%s with the extension links to the site to sign in there, and offers nothing to press', (site, _title, host) => {
    const { row } = signedOut(site, 'extension')
    expect(chip(row(site))).toBe('Signed out')
    expect(labels(row(site))).toEqual([])
    expect(row(site).querySelector('.actions a')?.getAttribute('href')).toBe(`https://${host}`)
    expect(row(site).querySelector('.actions a')?.textContent).toBe(`Open ${host}`)
  })

  // the row's Log in and Settings' Sign in come from the same answer: the tracker's SIGNED_OUT, which
  // the row draws and recordTrackerAnswers keeps for Settings
  test.each(TRACKERS)('%s: the tracking row offers Log in where Settings offers Sign in, from one answer', (site, title) => {
    const answers: CompactAnswer[] = [
      { state: 'SIGNED_OUT', candidates: [], tracker: { id: site, name: title, canWrite: false, scoreScale: 'POINT_10' }, entry: null },
      { state: 'NOT_LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100' }, entry: null },
    ]
    const { status, statuses } = fakeStatus()
    statuses.record(site, 'signed-in', NOW - HOUR)
    recordTrackerAnswers(answers, statuses, connected => connected === site)

    const tracking = mount(
      <TrackingCompact
        tracking={{ summary: null, disagreements: [], answers }}
        episodeCount={12}
        onSaveFields={async () => []}
        onRemove={async () => []}
        signIns={{ [site]: async () => 'closed' }}
        prefs={{ targets: {}, expanded: true }}
        onPrefs={() => {}}
      />,
    )
    hosts.push(tracking)
    const { row } = render({ status, sites: fakeSites([site]) })

    expect(tracking.querySelector(`[aria-label="Log in to ${title}"]`)?.textContent).toBe('Log in')
    expect(chip(row(site))).toBe('Signed out')
    expect(labels(row(site))).toEqual(['Sign in'])
  })

  // the real sign in remembers `authed` as signed in (rememberSignIn), the real sign out disconnects and
  // remembers signed out (signOutOfSite)
  test.each(TRACKERS)('%s: a sign in that lands offers Sign out again, and that sign out leaves it not connected', async (site, title) => {
    const { status, statuses } = fakeStatus()
    statuses.record(site, 'signed-out', NOW)
    const base = fakeSites([site])
    const sites: AccountsProps['sites'] = {
      ...base,
      signIn: vi.fn(async (signingIn: TrackerSite) => {
        const outcome = await base.signIn(signingIn)
        statuses.record(signingIn, 'signed-in', NOW)
        return outcome
      }),
      signOut: vi.fn(async (signingOut: TrackerSite, backend: FknBackend) => {
        await base.signOut(signingOut, backend)
        statuses.record(signingOut, 'signed-out', NOW)
      }),
    }
    const { row } = render({ status, sites })

    await act(async () => { button(row(site), 'Sign in')!.click() })
    await flush()
    expect(chip(row(site))).toBe('Signed in')
    expect(labels(row(site))).toEqual(['Sign out'])

    await act(async () => { button(row(site), 'Sign out')!.click() })
    await act(async () => { button(row(site), 'Yes, sign out')!.click() })
    await flush()
    expect(sites.signOut).toHaveBeenCalledWith(site, 'cloud')
    expect(sites.isConnected(site)).toBe(false)
    expect(statuses.read(site)?.state).toBe('signed-out')
    expect(chip(row(site))).toBe('Not connected')
    expect(labels(row(site))).toEqual(['Sign in'])
    expect(button(row(site), `Sign out of ${title}`)).toBeFalsy()
  })
})
