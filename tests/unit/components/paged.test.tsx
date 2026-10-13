// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { render } from 'preact'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { default: Paged, pageSlots } = await import('../../../src/components/paged')

const ITEMS = Array.from({ length: 100 }, (_, index) => index + 1)

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const list = (items: readonly number[], start?: number) =>
  <Paged items={items} size={12} label="Characters" start={start}>{page => <ul>{page.map(item => <li key={item}>{item}</li>)}</ul>}</Paged>

const draw = (items: readonly number[] = ITEMS, start?: number) => {
  const host = mount(list(items, start))
  hosts.push(host)
  return host
}

const drawn = (host: HTMLElement) => [...host.querySelectorAll('li')].map(item => Number(item.textContent))
const control = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const slots = (host: HTMLElement) => [...host.querySelector('nav')!.children].filter(slot => slot.getAttribute('role') !== 'status').map(slot => slot.textContent || slot.getAttribute('aria-label'))
const press = (button: HTMLButtonElement) => act(() => { button.click() })

// a gap as the page it leads to, after an ellipsis
const offered = (page: number, pages: number) => pageSlots(page, pages).map(({ page, gap }) => (gap ? `…${page}` : page))

test('pageSlots offers every page up to seven, and past that always seven: the ends, and the current page with its neighbours', () => {
  expect(offered(0, 1)).toEqual([0])
  expect(offered(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(offered(0, 152)).toEqual([0, 1, 2, 3, 4, '…77', 151])
  expect(offered(75, 152)).toEqual([0, '…37', 74, 75, 76, '…113', 151])
  expect(offered(151, 152)).toEqual([0, '…73', 147, 148, 149, 150, 151])
  for (const pages of [8, 9, 10, 23, 152]) {
    for (let page = 0; page < pages; page++) {
      const slots = pageSlots(page, pages)
      const numbers = slots.filter(({ gap }) => !gap).map(slot => slot.page)
      expect(slots, `${page} of ${pages}`).toHaveLength(7)
      expect(numbers, `${page} of ${pages}`).toEqual(expect.arrayContaining([0, Math.max(0, page - 1), page, Math.min(pages - 1, page + 1), pages - 1]))
      // a gap stands for two pages or more, never for one a number would fit in, and leads to one of them
      slots.forEach((slot, index) => {
        if (!slot.gap) return
        expect(slots[index + 1]!.page - slots[index - 1]!.page, `${page} of ${pages}`).toBeGreaterThan(2)
        expect(slot.page, `${page} of ${pages}`).toBeGreaterThan(slots[index - 1]!.page)
        expect(slot.page, `${page} of ${pages}`).toBeLessThan(slots[index + 1]!.page)
      })
    }
  }
})

test('any page of a long list is a few clicks away from the first: a gap leads halfway across the pages it hides', () => {
  for (const pages of [8, 23, 92, 118, 147, 1000]) {
    const clicks = new Map([[0, 0]])
    for (const [page, count] of clicks) {
      for (const next of [...pageSlots(page, pages).map(slot => slot.page), page - 1, page + 1]) {
        if (next >= 0 && next < pages && !clicks.has(next)) clicks.set(next, count + 1)
      }
    }
    expect(clicks.size, `${pages} pages`).toBe(pages)
    expect(Math.max(...clicks.values()), `${pages} pages`).toBeLessThanOrEqual(Math.ceil(Math.log2(pages)))
  }
})

test('a long list draws one page, and Next, Previous and the page numbers move through it', () => {
  const host = draw()
  expect(drawn(host)).toEqual(ITEMS.slice(0, 12))
  expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe('Characters pages')
  expect(slots(host)).toEqual(['Previous page', '1', '2', '3', '4', '5', '…', '9', 'Next page'])
  expect(control(host, 'Page 1').getAttribute('aria-current')).toBe('page')

  press(control(host, 'Next page'))
  expect(drawn(host)).toEqual(ITEMS.slice(12, 24))
  expect(control(host, 'Page 2').getAttribute('aria-current')).toBe('page')
  expect(control(host, 'Page 1').getAttribute('aria-current')).toBeNull()
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Page 2 of 9')

  press(control(host, 'Page 9'))
  expect(drawn(host)).toEqual(ITEMS.slice(96))
  expect(slots(host)).toEqual(['Previous page', '1', '…', '5', '6', '7', '8', '9', 'Next page'])
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Page 9 of 9')

  press(control(host, 'Previous page'))
  expect(drawn(host)).toEqual(ITEMS.slice(84, 96))
})

test('the ends refuse a step past them and keep their focus: marked disabled, never disabled', () => {
  const host = draw()
  const previous = control(host, 'Previous page')
  expect(previous.getAttribute('aria-disabled')).toBe('true')
  expect(previous.disabled).toBe(false)
  press(previous)
  expect(drawn(host)).toEqual(ITEMS.slice(0, 12))
  press(control(host, 'Page 9'))
  const next = control(host, 'Next page')
  expect(next.getAttribute('aria-disabled')).toBe('true')
  expect(next.disabled).toBe(false)
  press(next)
  expect(drawn(host)).toEqual(ITEMS.slice(96))
  expect(previous.getAttribute('aria-disabled')).toBe('false')
})

test('a picked page number stays the same button as the numbers around it move, so focus stays on the page picked', () => {
  const host = draw()
  const fifth = control(host, 'Page 5')
  press(fifth)
  expect(slots(host)).toEqual(['Previous page', '1', '…', '4', '5', '6', '…', '9', 'Next page'])
  expect(fifth.isConnected).toBe(true)
  expect(fifth.getAttribute('aria-current')).toBe('page')
})

test('a gap is a button to the page halfway across it, which it becomes once picked', () => {
  const host = draw(Array.from({ length: 1100 }, (_, index) => index + 1))
  const gap = control(host, 'Page 48')
  expect(gap.textContent).toBe('…')
  press(gap)
  expect(drawn(host)[0]).toBe(565)
  expect(slots(host)).toEqual(['Previous page', '1', '…', '47', '48', '49', '…', '92', 'Next page'])
  expect(gap.isConnected).toBe(true)
  expect(gap.getAttribute('aria-current')).toBe('page')
  expect(gap.textContent).toBe('48')
})

test('one page draws no controls', () => {
  const host = draw(ITEMS.slice(0, 12))
  expect(drawn(host)).toEqual(ITEMS.slice(0, 12))
  expect(host.querySelector('nav')).toBeNull()
})

test('it opens on the page holding start, and follows start until a page is picked', () => {
  const host = draw(ITEMS, 40)
  expect(drawn(host)[0]).toBe(37)
  act(() => { render(list(ITEMS, 70), host) })
  expect(drawn(host)[0]).toBe(61)
  press(control(host, 'Page 1'))
  act(() => { render(list(ITEMS, 90), host) })
  expect(drawn(host)[0]).toBe(1)
})

test('the page status says nothing until a page is picked, so a list growing as sources answer announces nothing', () => {
  const host = draw(ITEMS.slice(0, 30))
  const status = host.querySelector('[role="status"]')!
  expect(status.textContent).toBe('')
  act(() => { render(list(ITEMS), host) })
  expect(host.querySelector('[role="status"]')).toBe(status)
  expect(status.textContent).toBe('')
  press(control(host, 'Page 2'))
  expect(status.textContent).toBe('Page 2 of 9')
})

test('a list that shrinks under its page shows its last page', () => {
  const host = draw()
  press(control(host, 'Page 9'))
  act(() => { render(list(ITEMS.slice(0, 30)), host) })
  expect(drawn(host)).toEqual(ITEMS.slice(24, 30))
})

test('a page change with the list in view keeps it as tall as it has been, so the controls stay under the pointer', () => {
  const host = draw()
  const page = host.querySelector<HTMLElement>('.page')!
  page.getBoundingClientRect = () => ({ top: 200, height: 640 }) as DOMRect
  expect(page.getAttribute('style')).toBeNull()
  press(control(host, 'Page 9'))
  expect(page.getAttribute('style')).toBe('min-height:640px')
  page.getBoundingClientRect = () => ({ top: 200, height: 160 }) as DOMRect
  press(control(host, 'Page 8'))
  expect(page.getAttribute('style')).toBe('min-height:640px')
})

test('a page change brings the list\'s top back into view only when it was scrolled past, and lets go of its height', () => {
  const host = draw()
  const page = host.querySelector<HTMLElement>('.page')!
  const scrollIntoView = vi.fn()
  page.scrollIntoView = scrollIntoView
  page.getBoundingClientRect = () => ({ top: 120, height: 640 }) as DOMRect
  press(control(host, 'Next page'))
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(page.getAttribute('style')).toBe('min-height:640px')
  page.getBoundingClientRect = () => ({ top: -900, height: 640 }) as DOMRect
  press(control(host, 'Next page'))
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
  expect(page.getAttribute('style') ?? '').not.toMatch(/min-height:\s*\d/)
})
