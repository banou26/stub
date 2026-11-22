// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronDown', 'Search'].map(name => [name, () => null]),
))

const { default: FilterSelect } = await import('../../../src/components/filter-select')

const GENRES = [
  { value: 'Action', label: 'Action' },
  { value: 'Comedy', label: 'Comedy' },
  { value: 'Drama', label: 'Drama' },
]

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const press = (target: Element, key: string) => {
  const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key })
  act(() => { target.dispatchEvent(event) })
  return event
}

const activeOption = () => document.body.querySelector<HTMLButtonElement>('[role="option"].active')

test('searchable multi-select moves active highlight through options with arrows and picks on Enter', () => {
  const picked: string[][] = []
  const host = mount(withIntl(
    <FilterSelect
      label="Genres & Tags"
      options={GENRES}
      selected={[]}
      onChange={next => picked.push(next)}
      multiple
      searchable="Filter genres & tags"
    />
  ))
  hosts.push(host)

  act(() => { host.querySelector<HTMLButtonElement>('.control')!.click() })
  const input = document.body.querySelector<HTMLInputElement>('.filter input')!
  expect(input.getAttribute('aria-activedescendant')).toBeNull()

  press(input, 'ArrowDown')
  expect(activeOption()?.textContent).toBe('Action')
  expect(input.getAttribute('aria-activedescendant')).toBe(activeOption()?.id)

  press(input, 'ArrowDown')
  expect(activeOption()?.textContent).toBe('Comedy')
  expect(input.getAttribute('aria-activedescendant')).toBe(activeOption()?.id)

  press(input, 'ArrowUp')
  expect(activeOption()?.textContent).toBe('Action')

  const enter = press(input, 'Enter')
  expect(enter.defaultPrevented).toBe(true)
  expect(picked).toEqual([['Action']])
  expect(document.body.querySelector('.options')).not.toBeNull()

  act(() => {
    input.value = 'dr'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(activeOption()).toBeNull()
  expect(input.getAttribute('aria-activedescendant')).toBeNull()

  press(input, 'ArrowDown')
  expect(activeOption()?.textContent).toBe('Drama')
  press(input, 'Enter')
  expect(picked.at(-1)).toEqual(['Drama'])
})

test('non-searchable single-select opens with arrows, supports Home/End, and closes when Enter picks an option', () => {
  const picked: string[][] = []
  const host = mount(withIntl(
    <FilterSelect
      label="Season"
      options={GENRES}
      selected={[]}
      onChange={next => picked.push(next)}
    />
  ))
  hosts.push(host)

  const control = host.querySelector<HTMLButtonElement>('.control')!
  press(control, 'ArrowDown')
  expect(document.body.querySelector('.options')).not.toBeNull()
  expect(activeOption()?.textContent).toBe('Action')
  expect(control.getAttribute('aria-activedescendant')).toBe(activeOption()?.id)

  press(control, 'End')
  expect(activeOption()?.textContent).toBe('Drama')

  press(control, 'Home')
  expect(activeOption()?.textContent).toBe('Action')

  press(control, 'ArrowUp')
  expect(activeOption()?.textContent).toBe('Drama')

  press(control, 'Enter')
  expect(picked).toEqual([['Drama']])
  expect(document.body.querySelector('.options')).toBeNull()
})
