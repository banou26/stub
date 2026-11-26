// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, expect, test } from 'vite-plus/test'
import { act } from 'preact/test-utils'

const { default: OriginIcon } = await import('../../../src/components/origin-icon')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('a source whose icon will not load shows its initial instead of a broken image', async () => {
  const host = mount(<OriginIcon icon="https://www.peacocktv.com/favicon.ico" name="Peacock"/>)
  hosts.push(host)
  const img = host.querySelector('img')!
  expect(img.getAttribute('src')).toBe('https://www.peacocktv.com/favicon.ico')
  expect(host.querySelector('.letter')).toBeNull()

  await act(async () => { img.dispatchEvent(new Event('error')) })
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('.letter')?.textContent).toBe('P')
})

// HOR-1183: stub-plugin hands its icons as data urls, so drawing one asks no host; one it could not fetch is left out
test("a plugin's data url icon is drawn as it is, and a source with no icon shows its initial", () => {
  const icon = 'data:image/png;base64,iVBORw0KGgo='
  const drawn = mount(<OriginIcon icon={icon} name="ExtSource"/>)
  const none = mount(<OriginIcon icon={null} name="YTS"/>)
  hosts.push(drawn, none)
  expect(drawn.querySelector('img')?.getAttribute('src')).toBe(icon)
  expect(none.querySelector('img')).toBeNull()
  expect(none.querySelector('.letter')?.textContent).toBe('Y')
})
