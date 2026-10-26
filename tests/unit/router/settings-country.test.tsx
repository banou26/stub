// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

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
  const host = mount(withIntl(<CountryRow/>))
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

test('each country reads by its English name, in English order, accented names among the rest', () => {
  viewerIn('America/Toronto')
  const options = [...render().select.querySelectorAll('option')].slice(1)
  const name = (code: string) => options.find(option => option.value === code)?.textContent
  expect(options.slice(0, 4).map(option => option.textContent)).toEqual(['Afghanistan', 'Åland Islands', 'Albania', 'Algeria'])
  expect(options.slice(-4).map(option => option.textContent)).toEqual(['Western Sahara', 'Yemen', 'Zambia', 'Zimbabwe'])
  expect(['CI', 'KN', 'VI', 'HK', 'KR', 'TR', 'MM'].map(name)).toEqual(['Côte d’Ivoire', 'St. Kitts & Nevis', 'U.S. Virgin Islands', 'Hong Kong SAR China', 'South Korea', 'Türkiye', 'Myanmar (Burma)'])
  const cuba = options.findIndex(option => option.value === 'CU')
  expect(options.slice(cuba - 1, cuba + 3).map(option => option.textContent)).toEqual(['Croatia', 'Cuba', 'Curaçao', 'Cyprus'])
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
