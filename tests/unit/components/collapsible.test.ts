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

// clamped from the first frame: drawn open and closed once measured, it pushed everything under it up
test('a description draws clamped from its first render, before anything has measured it', () => {
  const host = mount(withIntl(h(Collapsible, { collapsedHeight: 200, className: 'description', children: h('p', null, 'A long description. '.repeat(200)) })))
  try {
    expect(host.querySelector('.description')!.classList.contains('collapsed')).toBe(true)
  } finally {
    unmount(host)
  }
})
