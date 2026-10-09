// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { StubStorage } from '../../../src/components/stub-list-notice'

const { default: StubListNotice } = await import('../../../src/components/stub-list-notice')

// What the page offers about stub's own list: the unlock that only a click may start, and the list
// kept before signing in, which reaches the account only through the viewer's own "Add".

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const render = (storage: StubStorage) => {
  const onUnlock = vi.fn(async () => {})
  const onAdd = vi.fn(async () => {})
  const host = mount(<StubListNotice storage={storage} onUnlock={onUnlock} onAdd={onAdd}/>)
  hosts.push(host)
  return { host, onUnlock, onAdd }
}

const settled: StubStorage = { location: 'ACCOUNT', signedIn: true, locked: false, waiting: false, held: 0 }

test('says nothing when nothing waits on the viewer', () => {
  expect(render(settled).host.querySelector('.stub-list-notice')).toBeNull()
  expect(render({ ...settled, location: 'DEVICE', signedIn: false }).host.querySelector('.stub-list-notice')).toBeNull()
})

test('a locked list is opened only from the Unlock click', async () => {
  const { host, onUnlock } = render({ ...settled, location: 'DEVICE', locked: true })
  expect(host.textContent).toContain('locked on this device')
  expect(onUnlock).not.toHaveBeenCalled()

  await act(async () => { button(host, 'Unlock')!.click() })
  expect(onUnlock).toHaveBeenCalledTimes(1)
})

test('a list kept before signing in is offered, and added only from the click', async () => {
  const { host, onAdd } = render({ ...settled, held: 3 })
  expect(host.textContent).toContain('3 entries saved on this device before you signed in')
  expect(onAdd).not.toHaveBeenCalled()

  await act(async () => { button(host, 'Add to my FKN account')!.click() })
  expect(onAdd).toHaveBeenCalledTimes(1)
})

test('a single entry kept before signing in reads in the singular', () => {
  const text = render({ ...settled, held: 1 }).host.textContent!.replace(/\s+/g, ' ')
  expect(text).toContain('1 entry saved on this device before you signed in stays on this device')
  expect(text).toContain('and comes back if you sign out')
})

test('offers no account to add to while the list is the device\'s own', () => {
  const { host } = render({ ...settled, location: 'DEVICE', signedIn: false, held: 3 })
  expect(button(host, 'Add to my FKN account')).toBeFalsy()
})
