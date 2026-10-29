// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

// HOR-1026 (stub in the viewer's language): the header's account button, the search page's filter menus and its
// layout toggle, as their English reads, pinned before it moves into messages

vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronDown', 'ExternalLink', 'Grid2x2', 'Grid3x2', 'LayoutList', 'LogOut', 'Search'].map(name => [name, () => null]),
))
vi.mock('@fkn/lib/react', () => ({ ConnectButton: () => null }))
const account = vi.hoisted(() => ({ info: { name: 'Ana', premium: true } as { name: string, premium: boolean } | null, logout: () => new Promise<void>(() => {}) }))
vi.mock('../../../src/utils/use-account', () => ({ useAccount: () => ({ info: account.info, ready: true, logout: account.logout }) }))

const { startLanguage } = await import('../../../src/i18n')
const { default: AccountWidget } = await import('../../../src/components/account-widget')
const { default: FilterSelect } = await import('../../../src/components/filter-select')
const { default: DisplayModeToggle } = await import('../../../src/components/display-mode-toggle')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
})
const show = (vnode: preact.ComponentChild) => {
  const host = mount(withIntl(vnode))
  hosts.push(host)
  return host
}
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click() })

test('the account button names the account and its tier, and its menu manages and disconnects it', async () => {
  account.info = { name: 'Ana', premium: true }
  const host = show(<AccountWidget/>)
  const button = host.querySelector('button')!
  expect([button.getAttribute('aria-label'), host.querySelector('.name')?.textContent, host.querySelector('.tier')?.textContent])
    .toEqual(['FKN account: Ana', 'Ana', 'Premium'])
  click(button)
  const items = () => [...document.querySelectorAll('[role="menu"] .item')].map(item => item.textContent)
  expect(items()).toEqual(['Manage account', 'Disconnect'])
  click(document.querySelector('[role="menu"] button.item'))
  expect(items()).toEqual(['Manage account', 'Disconnecting...'])
})

test('an account with no name reads as Account, and a free one as Free', () => {
  account.info = { name: '', premium: false }
  const host = show(<AccountWidget/>)
  expect([host.querySelector('button')?.getAttribute('aria-label'), host.querySelector('.name')?.textContent, host.querySelector('.tier')?.textContent])
    .toEqual(['FKN account: Account', 'Account', 'Free'])
})

const GENRES = [{ value: 'Action', label: 'Action' }, { value: 'Comedy', label: 'Comedy' }, { value: 'Drama', label: 'Drama' }]

test('a filter menu reads Any with nothing picked, and lists what is picked', () => {
  const none = show(<FilterSelect label="Genres & Tags" options={GENRES} selected={[]} onChange={() => {}} multiple/>)
  expect([none.querySelector('.label')?.textContent, none.querySelector('.value')?.textContent]).toEqual(['Genres & Tags', 'Any'])
  const picked = show(<FilterSelect label="Genres & Tags" options={GENRES} selected={['Action', 'Drama', 'Comedy']} onChange={() => {}} multiple/>)
  expect(picked.querySelector('.value')?.textContent).toBe('Action, Drama, Comedy')
})

test('a filter menu\'s box is named for what it narrows, and says when nothing matches', () => {
  const host = show(<FilterSelect label="Genres & Tags" options={GENRES} selected={[]} onChange={() => {}} multiple searchable="Filter genres & tags"/>)
  click(host.querySelector('.control'))
  const box = document.querySelector<HTMLInputElement>('.filter input')!
  expect([box.getAttribute('placeholder'), box.getAttribute('aria-label')]).toEqual(['Filter genres & tags', 'Filter genres & tags'])
  act(() => {
    box.value = 'zzz'
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelector('.empty')?.textContent).toBe('Nothing matches “zzz”.')
  click(host.querySelector('.control'))
  const year = show(<FilterSelect label="Year" options={[{ value: '2026', label: '2026' }]} selected={[]} onChange={() => {}} searchable="Filter year"/>)
  click(year.querySelector('.control'))
  expect(document.querySelector('.filter input')?.getAttribute('placeholder')).toBe('Filter year')
})

test('the layout toggle names itself and each of its three layouts', () => {
  const host = show(<DisplayModeToggle mode="grid" onChange={() => {}}/>)
  expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Result layout')
  expect([...host.querySelectorAll('button')].map(button => [button.getAttribute('aria-label'), button.getAttribute('title')]))
    .toEqual([['Covers', 'Covers'], ['Cards', 'Cards'], ['List', 'List']])
})

describe('in German, from its catalogue', () => {
  beforeAll(() => startLanguage({ language: 'de', languages: ['de-DE'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('the account button and its menu', () => {
    account.info = { name: '', premium: false }
    const host = show(<AccountWidget/>)
    expect([host.querySelector('button')?.getAttribute('aria-label'), host.querySelector('.tier')?.textContent]).toEqual(['FKN-Konto: Konto', 'Kostenlos'])
    click(host.querySelector('button'))
    expect([...document.querySelectorAll('[role="menu"] .item')].map(item => item.textContent)).toEqual(['Konto verwalten', 'Trennen'])
  })

  test('a filter menu joins what is picked the German way, and says when nothing matches', () => {
    const none = show(<FilterSelect label="Jahr" options={GENRES} selected={[]} onChange={() => {}} searchable="Jahr filtern"/>)
    expect(none.querySelector('.value')?.textContent).toBe('Beliebig')
    const picked = show(<FilterSelect label="Genres" options={GENRES} selected={['Action', 'Drama', 'Comedy']} onChange={() => {}} multiple/>)
    expect(picked.querySelector('.value')?.textContent).toBe('Action, Drama und Comedy')
    click(none.querySelector('.control'))
    const box = document.querySelector<HTMLInputElement>('.filter input')!
    act(() => {
      box.value = 'zzz'
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('.empty')?.textContent).toBe('Nichts passt zu \u201Ezzz\u201C.')
  })

  test('the layout toggle', () => {
    const host = show(<DisplayModeToggle mode="list" onChange={() => {}}/>)
    expect([host.querySelector('[role="group"]')?.getAttribute('aria-label'), ...[...host.querySelectorAll('button')].map(button => button.title)])
      .toEqual(['Ergebnisansicht', 'Cover', 'Karten', 'Liste'])
  })
})
