// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) => <svg data-icon={name} {...props}/>
  return { ChevronLeft: icon('ChevronLeft'), ChevronRight: icon('ChevronRight') }
})
vi.mock('../../../src/components/draggable', () => ({ default: ({ children }: { children: unknown }) => children }))
vi.mock('react-window', async () => {
  const { h } = await import('preact')
  return {
    useGridCallbackRef: () => [null, () => {}],
    Grid: ({ cellComponent, cellProps, columnCount }: { cellComponent: (props: object) => null, cellProps: object, columnCount: number }) =>
      h('div', null, Array.from({ length: columnCount }, (_, columnIndex) =>
        h(cellComponent, { ...cellProps, key: `0-${columnIndex}`, columnIndex, rowIndex: 0, style: {} }))),
  }
})

const { CardRow } = await import('../../../src/router/home/card-row')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('the row scroll arrows are named Previous and Next buttons with hidden icons', () => {
  const host = mount(withIntl(
    <CardRow
      name="shows"
      count={2}
      cell={({ columnIndex }) => <div>Item {columnIndex + 1}</div>}
      cellProps={{}}
    />
  ))
  hosts.push(host)

  const previous = host.querySelector('.scroll-button.previous')!
  const next = host.querySelector('.scroll-button.next')!
  expect(previous.getAttribute('type')).toBe('button')
  expect(previous.getAttribute('aria-label')).toBe('Previous')
  expect(previous.querySelector('[aria-hidden="true"]')).not.toBeNull()
  expect(next.getAttribute('type')).toBe('button')
  expect(next.getAttribute('aria-label')).toBe('Next')
  expect(next.querySelector('[aria-hidden="true"]')).not.toBeNull()
})
