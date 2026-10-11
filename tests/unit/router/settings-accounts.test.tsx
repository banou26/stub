// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'

import type { AccountsProps, TrackerSite } from '../../../src/router/settings/accounts'
import type { SiteState, StatusSite } from '../../../src/tracking/site-status'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { createRefresh, createSiteStatuses, FRESH_MS } from '../../../src/tracking/site-status'

const { AccountsSection } = await import('../../../src/router/settings/accounts')

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

test('lists the sites stub signs in to, and not the FKN account the header already shows', () => {
  const { host } = render()
  expect([...host.querySelectorAll('[data-account]')].map(row => row.getAttribute('data-account'))).toEqual(['crunchyroll', 'anilist', 'mal', 'netflix'])
})

describe('Crunchyroll on the cloud', () => {
  test('signs in through a window', async () => {
    const { row, props } = render()
    await act(async () => { button(row('crunchyroll'), 'Sign in')!.click() })
    expect(props.crunchyroll.signIn).toHaveBeenCalledTimes(1)
  })

  test('signs out only once asked twice, and the question says every fkn.app app is signed out', async () => {
    const { row, props } = render()
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
    const { row } = render({ crunchyroll: { signIn: async () => 'authed', signOut: async () => { throw new Error('the render proxy did not answer') } } })
    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    await act(async () => { button(row('crunchyroll'), 'Yes, sign out')!.click() })
    await flush()
    expect(row('crunchyroll').textContent).toContain('the render proxy did not answer')
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
  for (const id of ['crunchyroll', 'anilist', 'mal', 'netflix']) expect(row(id).querySelectorAll('button'), id).toHaveLength(0)
})

describe('for a screen reader', () => {
  test('each sign out is named for its site', () => {
    const { row } = render({ sites: fakeSites(['anilist']) })
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

  // the owner, 2026-10-10: "it shows Sign in on crunchyroll when it already says signed in"
  test('Crunchyroll offers the sign in or the sign out its last known state calls for, and both before it knows', () => {
    const signedIn = fakeStatus()
    signedIn.statuses.record('crunchyroll', 'signed-in', NOW)
    expect(labels(render({ status: signedIn.status }).row('crunchyroll'))).toEqual(['Sign out'])

    const signedOut = fakeStatus()
    signedOut.statuses.record('crunchyroll', 'signed-out', NOW)
    expect(labels(render({ status: signedOut.status }).row('crunchyroll'))).toEqual(['Sign in'])

    expect(labels(render().row('crunchyroll'))).toEqual(['Sign in', 'Sign out'])
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

  test('with nothing remembered, Crunchyroll and a connected site show no state, and one not connected says so', () => {
    const { row } = render({ sites: fakeSites(['mal']) })

    expect(chip(row('crunchyroll'))).toBeUndefined()
    expect(chip(row('mal'))).toBeUndefined()
    expect(chip(row('anilist'))).toBe('Not connected')
  })

  test('once the backend is known, opening the section asks each connected site and a Crunchyroll stub knows of, and no other', async () => {
    const { status, statuses, ask } = fakeStatus()
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    let known!: (backend: FknBackend) => void
    const Harness = () => {
      const [backend, setBackend] = useState<FknBackend>()
      known = setBackend
      return <AccountsSection backend={backend} crunchyroll={{ signIn: async () => 'authed', signOut: async () => {} }} sites={fakeSites(['anilist'])} status={status}/>
    }
    hosts.push(mount(<Harness/>))
    await flush()
    expect(ask, 'what a check does depends on the backend').not.toHaveBeenCalled()

    await act(async () => { known('cloud') })
    expect(ask.mock.calls).toEqual([['crunchyroll', 'cloud'], ['anilist', 'cloud']])

    const unknown = fakeStatus()
    render({ status: unknown.status, sites: fakeSites(['mal', 'anilist']) })
    expect(unknown.ask.mock.calls, 'nothing learned of Crunchyroll yet').toEqual([['anilist', 'cloud'], ['mal', 'cloud']])
  })

  test('an answer the automatic check gets shows at once', async () => {
    const { status, ask } = fakeStatus({ mal: 'signed-out' })
    const { row } = render({ status, sites: fakeSites(['mal']), backend: 'extension' })
    await flush()

    expect(ask.mock.calls).toEqual([['mal', 'extension']])
    expect(chip(row('mal'))).toBe('Signed out')
  })

  test('a site whose state is under FRESH_MS old is not asked', async () => {
    const { status, statuses, ask } = fakeStatus()
    statuses.record('anilist', 'signed-in', NOW - FRESH_MS + 1_000)
    statuses.record('mal', 'signed-in', NOW - FRESH_MS)
    render({ status, sites: fakeSites(['anilist', 'mal']) })
    await flush()

    expect(ask.mock.calls).toEqual([['mal', 'cloud']])
  })

  test('an automatic check that gets no answer shows nothing and keeps the state stub had', async () => {
    const { status, statuses, ask } = fakeStatus({ mal: new Error('MyAnimeList asked stub to wait. Try again later.') })
    statuses.record('mal', 'signed-in', NOW - 2 * HOUR)
    const { row } = render({ status, sites: fakeSites(['mal']) })
    await flush()

    expect(ask).toHaveBeenCalledTimes(1)
    expect(chip(row('mal'))).toBe('Signed in')
    expect(statuses.read('mal')).toEqual({ state: 'signed-in', checkedAt: NOW - 2 * HOUR })
    expect(row('mal').querySelector('[role="status"]')!.textContent).toBe('')
  })

  test('the page coming back into view asks again once what stub learned is stale, and a hidden page asks nothing', async () => {
    let clock = NOW
    const { status, ask } = fakeStatus({ anilist: 'signed-in' }, () => clock)
    const { row } = render({ status, sites: fakeSites(['anilist']) })
    await flush()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(chip(row('anilist'))).toBe('Signed in')

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
