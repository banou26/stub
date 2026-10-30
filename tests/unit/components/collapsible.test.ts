// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { h } from 'preact'
import { expect, test } from 'vite-plus/test'

import Collapsible from '../../../src/components/collapsible'

// A <button> draws in the browser's own face unless its rule says otherwise: measured on Chrome
// 153.0.8010.47 on 2026-10-11, the description's Expand drew in Arial beside the page's Montserrat.
const source = readFileSync(fileURLToPath(new URL('../../../src/components/collapsible.tsx', import.meta.url)), 'utf-8')
const toggle = /\.toggle-button \{([^}]*)\}/.exec(source)?.[1] ?? ''

test("the description's Expand button draws in stub's font", () => {
  // CONTROL: the rule was read, so a missing declaration is the rule's and not the regex's
  expect(toggle).toContain('cursor: pointer;')
  expect(toggle).toContain('font-family: inherit;')
})

// a layout effect, so no frame draws it open: drawn open and closed once measured, it pushed everything under it up
test('a long description is collapsed by the time it mounts, before the observer has reported anything', () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 1000 })
  const host = mount(withIntl(h(Collapsible, { collapsedHeight: 200, className: 'description', children: h('p', null, 'A long description. '.repeat(200)) })))
  try {
    const box = host.querySelector<HTMLElement>('.description')!
    expect(box.classList.contains('collapsed')).toBe(true)
    expect(box.style.maxHeight).toBe('200px')
  } finally {
    unmount(host)
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
  }
})

test('a short description shows whole, with no toggle', () => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 100 })
  const host = mount(withIntl(h(Collapsible, { collapsedHeight: 200, className: 'description', children: h('p', null, 'A short description.') })))
  try {
    const box = host.querySelector<HTMLElement>('.description')!
    expect(box.classList.contains('collapsed')).toBe(false)
    expect(box.style.maxHeight).toBe('')
    expect(host.querySelector('button')).toBe(null)
  } finally {
    unmount(host)
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
  }
})
