// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { AccountsProps, TrackerSite } from '../../../src/router/settings/accounts'
import type { SiteState, StatusSite } from '../../../src/tracking/site-status'

import { createSiteStatuses } from '../../../src/tracking/site-status'

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

/** Remembered states over memory, and a check that answers `answers`, records what it answered, and is counted. */
const fakeStatus = (answers: Partial<Record<StatusSite, SiteState | Error>> = {}) => {
  const values = new Map<string, string>()
  const statuses = createSiteStatuses(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }))
  const status: AccountsProps['status'] = {
    read: statuses.read,
    watch: statuses.watch,
    check: vi.fn(async (site: StatusSite) => {
      const answer = answers[site]
      if (answer === undefined || answer instanceof Error) throw answer ?? new Error('no answer')
      statuses.record(site, answer, NOW)
      return answer
    }),
  }
  return { status, statuses }
}

const render = (overrides: Partial<AccountsProps> = {}) => {
  const props: AccountsProps = {
    account: { info: null, ready: true, logout: vi.fn(async () => 'settled' as const) },
    backend: 'cloud',
    crunchyroll: { signIn: vi.fn(async () => 'authed' as const), signOut: vi.fn(async () => {}) },
    sites: fakeSites(),
    status: fakeStatus().status,
    now: () => NOW,
    ...overrides,
  }
  const host = mount(<AccountsSection {...props}/>)
  hosts.push(host)
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-account="${id}"]`)!
  return { host, props, row }
}

const SIGNED_IN = { name: 'Banou', image: null, premium: true, premiumUntil: null } as unknown as AccountsProps['account']['info']

describe('the FKN account', () => {
  test('signed in: who, which tier, a way to manage it on fkn.app, and Disconnect', async () => {
    const logout = vi.fn(async () => 'settled' as const)
    const { row } = render({ account: { info: SIGNED_IN, ready: true, logout } })
    expect(row('fkn').textContent).toContain('Banou')
    expect(row('fkn').textContent).toContain('Premium')
    expect(row('fkn').querySelector('a')?.getAttribute('href')).toBe('https://fkn.app/account')

    await act(async () => { button(row('fkn'), 'Disconnect')!.click() })
    await act(async () => { button(row('fkn'), 'Yes, disconnect')!.click() })
    await flush()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  test('Disconnect asks first, and says that list changes not sent to the account yet are lost', async () => {
    const logout = vi.fn(async () => 'settled' as const)
    const { row } = render({ account: { info: SIGNED_IN, ready: true, logout } })
    expect(button(row('fkn'), 'Disconnect')!.getAttribute('aria-label')).toBe('Disconnect your FKN account')
    await act(async () => { button(row('fkn'), 'Disconnect')!.click() })
    expect(logout, 'the first click only asks').not.toHaveBeenCalled()
    expect(row('fkn').textContent).toContain('not sent to the account yet are lost')

    await act(async () => { button(row('fkn'), 'Cancel')!.click() })
    expect(logout).not.toHaveBeenCalled()
  })

  test('a disconnect FKN never answered is not reported as one', async () => {
    const { row } = render({ account: { info: SIGNED_IN, ready: true, logout: async () => 'timeout' } })
    await act(async () => { button(row('fkn'), 'Disconnect')!.click() })
    await act(async () => { button(row('fkn'), 'Yes, disconnect')!.click() })
    await flush()
    expect(row('fkn').textContent).toContain('FKN did not answer')
  })

  test('signed out: says so, and offers no Disconnect', () => {
    const { row } = render()
    expect(row('fkn').textContent).toContain('Not connected')
    expect(button(row('fkn'), 'Disconnect')).toBeFalsy()
  })
})

describe('Crunchyroll on the cloud', () => {
  test("says the session is FKN's, shared by every fkn.app app, and signs in through a window", async () => {
    const { row, props } = render()
    expect(row('crunchyroll').textContent).toContain('every fkn.app app')
    await act(async () => { button(row('crunchyroll'), 'Sign in')!.click() })
    expect(props.crunchyroll.signIn).toHaveBeenCalledTimes(1)
  })

  test('signs out only once asked twice, and says what a sign out does not do', async () => {
    const { row, props } = render()
    await act(async () => { button(row('crunchyroll'), 'Sign out')!.click() })
    expect(props.crunchyroll.signOut).not.toHaveBeenCalled()
    expect(row('crunchyroll').textContent).toContain('Crunchyroll itself is not told')

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
    expect(row('anilist').textContent).toContain('Connected on this device')
    expect(row('mal').textContent).toContain('Not connected')

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
    expect(row('mal').textContent).toContain('Connected on this device')
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
    expect(row('crunchyroll').textContent).toContain("browser's own")
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
    expect(row('anilist').textContent).toContain('sign out on anilist.co')
    expect(button(row('mal'), 'Connect')).toBeTruthy()
  })
})

describe('Netflix', () => {
  test('plays only through the extension, on the browser\'s own session, so there is nothing for stub to sign out', () => {
    const cloud = render().row('netflix')
    expect(cloud.textContent).toContain('needs the FKN browser extension')
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
    const { row } = render({ account: { info: SIGNED_IN, ready: true, logout: async () => 'settled' } })
    for (const id of ['fkn', 'crunchyroll', 'anilist', 'mal']) {
      const status = row(id).querySelector('[role="status"]')
      expect(status, id).toBeTruthy()
      expect(status!.textContent, id).toBe('')
    }
  })
})

describe('the sign-in states', () => {
  const chip = (row: HTMLElement) => row.querySelector('.head .state')?.textContent

  test('a row shows what stub last learned and how long ago, without asking the site', () => {
    const { status, statuses } = fakeStatus()
    statuses.record('crunchyroll', 'signed-in', NOW - 2 * HOUR)
    statuses.record('anilist', 'signed-out', NOW - 26 * HOUR)
    const { row } = render({ status, sites: fakeSites(['anilist']) })

    expect(chip(row('crunchyroll'))).toBe('Signed in, checked 2 hours ago')
    expect(chip(row('anilist'))).toBe('Signed out, checked 1 day ago')
    expect(row('anilist').querySelector('.head .state')!.classList.contains('on'), 'signed out is not shown as on').toBe(false)
    expect(status.check).not.toHaveBeenCalled()
  })

  test('with nothing remembered, Crunchyroll says it was not checked and a connected site that it is connected', () => {
    const { row } = render({ sites: fakeSites(['mal']) })

    expect(chip(row('crunchyroll'))).toBe('Not checked yet')
    expect(chip(row('mal'))).toBe('Connected on this device')
    expect(chip(row('anilist'))).toBe('Not connected')
  })

  test('Check now asks the site once, and the row then shows its answer', async () => {
    const { status } = fakeStatus({ crunchyroll: 'signed-out' })
    const { row } = render({ status })
    await act(async () => { button(row('crunchyroll'), 'Check now')!.click() })
    await flush()

    expect(status.check).toHaveBeenCalledTimes(1)
    expect(status.check).toHaveBeenCalledWith('crunchyroll', 'cloud')
    expect(chip(row('crunchyroll'))).toBe('Signed out, checked just now')
  })

  test('with the extension, Crunchyroll is checked on the browser\'s own session', async () => {
    const { status } = fakeStatus({ crunchyroll: 'signed-in' })
    const { row } = render({ status, backend: 'extension' })
    await act(async () => { button(row('crunchyroll'), 'Check now')!.click() })
    await flush()

    expect(status.check).toHaveBeenCalledWith('crunchyroll', 'extension')
    expect(chip(row('crunchyroll'))).toBe('Signed in, checked just now')
  })

  test('a check that gets no answer says so on the row, and records nothing', async () => {
    const { status, statuses } = fakeStatus({ mal: new Error('MyAnimeList asked stub to wait. Try again later.') })
    const { row } = render({ status, sites: fakeSites(['mal']) })
    await act(async () => { button(row('mal'), 'Check now')!.click() })
    await flush()

    expect(row('mal').querySelector('[role="status"]')!.textContent).toBe('stub could not tell whether you are signed in to MyAnimeList: MyAnimeList asked stub to wait. Try again later.')
    expect(statuses.read('mal')).toBeUndefined()
    expect(chip(row('mal'))).toBe('Connected on this device')
  })

  test('a tracking site not connected here offers no Check now, since checking is what would attach it', () => {
    const { row } = render({ sites: fakeSites(['anilist']) })

    expect(button(row('anilist'), 'Check now')).toBeTruthy()
    expect(button(row('mal'), 'Check now')).toBeFalsy()
  })

  test('a state stub learns elsewhere on the page shows at once', async () => {
    const { status, statuses } = fakeStatus()
    const { row } = render({ status })
    await act(async () => { statuses.record('crunchyroll', 'signed-in', NOW) })

    expect(chip(row('crunchyroll'))).toBe('Signed in, checked just now')
  })

  test('each Check now is named for its site', () => {
    const { row } = render({ sites: fakeSites(['anilist']) })

    expect(button(row('crunchyroll'), 'Check now')!.getAttribute('aria-label')).toBe('Check whether you are signed in to Crunchyroll')
    expect(button(row('anilist'), 'Check now')!.getAttribute('aria-label')).toBe('Check whether you are signed in to AniList')
  })
})
