// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { COUNTRIES, COUNTRY_KEY } from '../../../src/sources/country'
import { viewerIn } from '../sources/justwatch/viewer'

const { CountryRow } = await import('../../../src/router/settings/country')

// The Country setting atop Sources (tests/unit/router/settings-sources.test.tsx): Automatic, naming the
// time zone's country, until one is picked.

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const render = () => {
  const host = mount(<CountryRow/>)
  hosts.push(host)
  const row = host.querySelector<HTMLElement>('[data-setting="country"]')!
  const select = row.querySelector('select')!
  // linkedom's select reads `value` off a `selected` attribute and cannot be set, so a pick is the change event alone
  const pick = (value: string) => act(() => {
    Object.defineProperty(select, 'value', { configurable: true, value })
    select.dispatchEvent(new Event('change'))
  })
  return { host, row, select, pick }
}

test('Country offers Automatic, naming the time zone\'s country, then every country by name', () => {
  viewerIn('America/Toronto')
  const { row, select } = render()
  expect(document.getElementById(select.getAttribute('aria-labelledby')!)?.textContent).toBe('Country')
  const options = [...select.querySelectorAll('option')]
  expect(options[0]!.textContent).toBe('Automatic (Canada)')
  expect(options[0]!.value).toBe('')
  expect(options).toHaveLength(COUNTRIES.length + 1)
  const names = options.slice(1).map(option => option.textContent!)
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  expect(options.find(option => option.textContent === 'Japan')?.value).toBe('JP')
  expect(row.querySelector('p'), 'a label and a select, nothing to read').toBeNull()
})

test('a country picked is kept on this device, and Automatic keeps nothing', async () => {
  viewerIn('Asia/Tokyo')
  const { select, pick } = render()
  expect(select.querySelector('option')!.textContent).toBe('Automatic (Japan)')
  await pick('CA')
  expect(stored.get(COUNTRY_KEY)).toBe('CA')
  expect(select.querySelector('option')!.textContent, 'Automatic still names the time zone\'s').toBe('Automatic (Japan)')
  await pick('')
  expect(stored.has(COUNTRY_KEY)).toBe(false)
})
