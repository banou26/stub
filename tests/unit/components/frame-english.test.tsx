// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { h } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import Collapsible from '../../../src/components/collapsible'
import Footer from '../../../src/components/footer'

// HOR-1026 (stub in the viewer's language): the footer and a long description's toggle, as their English reads, pinned
// before it moves into messages

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})
const show = (vnode: preact.ComponentChild) => {
  const host = mount(withIntl(vnode))
  hosts.push(host)
  return host
}

test('the footer links Legal and Privacy, and names its version and commit', () => {
  // vite.config.ts defines both for a build, and vitest.config.ts neither
  vi.stubGlobal('__STUB_VERSION__', '0.0.62')
  vi.stubGlobal('__STUB_COMMIT__', 'abc1234')
  const host = show(<Router hook={memoryLocation({ path: '/' }).hook}><Footer/></Router>)
  expect([...host.querySelectorAll('footer a')].map(link => link.textContent)).toEqual(['stub', 'Legal', 'Privacy'])
  const version = host.querySelector('.version')!
  expect([version.textContent, version.getAttribute('title')]).toEqual(['v0.0.62 abc1234', 'stub v0.0.62, commit abc1234'])
})

test('a description taller than its clamp reads Expand, and Collapse once open', async () => {
  const host = show(h(Collapsible, { collapsedHeight: 200, children: h('p', null, 'A long description.') }))
  Object.defineProperty(host.firstElementChild!, 'scrollHeight', { value: 1000 })
  // the observer reports the first size a turn later (./dom)
  await act(() => new Promise(resolve => setTimeout(resolve, 10)))
  const toggle = host.querySelector('button')!
  expect(toggle.textContent).toBe('Expand')
  act(() => { toggle.click() })
  expect(toggle.textContent).toBe('Collapse')
})
