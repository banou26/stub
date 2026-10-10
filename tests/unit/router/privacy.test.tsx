// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, expect, test } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { STORED } from '../../../src/router/privacy/stored-data'

const { default: Privacy } = await import('../../../src/router/privacy')

// The privacy page has to say what stub keeps today (HOR-225, fact 7). It said everything but the
// watch list went when the tab closed, while the keys, the added sources, the layout and the site
// sign-ins all outlive it.

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const text = () => {
  const host = mount(<Router hook={memoryLocation({ path: '/privacy' }).hook}><Privacy/></Router>)
  hosts.push(host)
  return { host, text: host.textContent!.replace(/\s+/g, ' ') }
}

test('no longer says that everything else goes with the tab', () => {
  expect(text().text).not.toMatch(/everything else stub holds is cleared when you close or refresh the tab/i)
  expect(text().text).not.toMatch(/stores nothing persistently/i)
})

test('names everything stub keeps, from the list the completeness test pins', () => {
  const { text: page } = text()
  for (const item of STORED) expect(page, item.id).toContain(item.title)
})

test('says the site sign-ins are kept by FKN for every fkn.app app, and where to sign out', () => {
  const { host, text: page } = text()
  expect(page).toContain('every fkn.app app')
  expect([...host.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(expect.arrayContaining(['/settings#accounts', '/settings#sources']))
})

test("says a removed list entry stays as a record that it was removed, and that nothing clears it yet", () => {
  const { text: page } = text()
  expect(page).not.toMatch(/your watch list stays until you remove its entries/i)
  expect(page).toContain('Removing an entry keeps a record that it was removed')
  expect(page).toContain('There is no way to clear these records yet')
})

test('says how each thing is cleared now that Settings has no Data section', () => {
  const { host, text: page } = text()
  expect(page).not.toMatch(/can be seen and cleared in Settings/i)
  expect(page).not.toMatch(/under Data/i)
  expect([...host.querySelectorAll('a')].map(link => link.getAttribute('href'))).not.toContain('/settings#data')
  expect(page).toContain('You sign out of a site in Settings, under Accounts, and remove a source you added in Settings, under Sources.')
  expect(page).toContain("Clearing this site's data in your browser removes everything stub keeps in this browser.")
})

test("a sign out removes that site's cookies, and the FKN window is the case without the extension", () => {
  const { text: page } = text()
  expect(page).toContain("Without the FKN browser extension, you sign in on each site's own page, in an FKN window")
  expect(page).toContain("removes that site's cookies from FKN")
})

test('says the relay keeps a copy of each answer, rather than only connection metadata', () => {
  const { text: page } = text()
  expect(page).not.toMatch(/processes only the connection metadata/i)
  expect(page).toContain('keeps a copy of each answer for a while')
})
