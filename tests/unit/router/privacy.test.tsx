// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, expect, test } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { STORED } from '../../../src/router/settings/stored-data'

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

test('names everything the settings page lists, from the same list', () => {
  const { text: page } = text()
  for (const item of STORED) expect(page, item.id).toContain(item.title)
})

test('says the site sign-ins are kept by FKN for every fkn.app app, and where to sign out', () => {
  const { host, text: page } = text()
  expect(page).toContain('every fkn.app app')
  expect([...host.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(expect.arrayContaining(['/settings#data', '/settings#accounts']))
})
