// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { createRef } from 'preact'
import { act } from 'preact/test-utils'

const { ConfirmAction } = await import('../../../src/router/settings/confirm')

// The inline confirmation every destructive action on the settings page asks first: what a screen reader
// is told, and where focus goes. linkedom keeps no focus, so the calls to focus() are what is read here;
// tests/settings.spec.ts checks the same in a browser.

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const render = () => {
  const onConfirm = vi.fn()
  const host = mount(
    <ConfirmAction label="Clear" name="Clear API keys" confirmLabel="Yes, clear" busyLabel="Clearing..." question="Clear every API key?" onConfirm={onConfirm}/>,
  )
  hosts.push(host)
  return { host, onConfirm }
}

test('the button is named for what it clears, not only "Clear"', () => {
  const { host } = render()
  const trigger = button(host, 'Clear')!
  expect(trigger.getAttribute('aria-label')).toBe('Clear API keys')
})

test('the question names what it acts on, and both answers are described by it', async () => {
  const { host } = render()
  await act(async () => { button(host, 'Clear')!.click() })

  const group = host.querySelector('[role="group"]')!
  expect(group.getAttribute('aria-label')).toBe('Clear API keys')
  const question = [...host.querySelectorAll('p')].find(paragraph => paragraph.textContent === 'Clear every API key?')!
  expect(question.id).toBeTruthy()
  for (const label of ['Yes, clear', 'Cancel']) expect(button(host, label)!.getAttribute('aria-describedby'), label).toBe(question.id)
})

test('a name left out is the label', () => {
  const host = mount(<ConfirmAction label="Sign out" confirmLabel="Yes" busyLabel="..." question="Sure?" onConfirm={() => {}}/>)
  hosts.push(host)
  expect(button(host, 'Sign out')!.getAttribute('aria-label')).toBeNull()
})

const focused = () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  return { focus, last: () => focus.mock.contexts.at(-1) as HTMLElement | undefined }
}

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

const withHome = (onConfirm: () => Promise<unknown> | void) => {
  const home = createRef<HTMLHeadingElement>()
  const host = mount(
    <div>
      <h3 ref={home} tabIndex={-1}>API keys</h3>
      <ConfirmAction label="Clear" name="Clear API keys" confirmLabel="Yes, clear" busyLabel="Clearing..." question="Clear every API key?" onConfirm={onConfirm} home={home}/>
    </div>,
  )
  hosts.push(host)
  return { host, home }
}

test('opening focuses Cancel, and Cancel gives focus back to the button', async () => {
  const { focus, last } = focused()
  try {
    const { host } = withHome(() => {})
    await act(async () => { button(host, 'Clear')!.click() })
    expect(last()?.textContent).toBe('Cancel')
    await act(async () => { button(host, 'Cancel')!.click() })
    expect(last()).toBe(button(host, 'Clear'))
  } finally {
    focus.mockRestore()
  }
})

test('a confirm hands focus to the row, while the button is still there too', async () => {
  const { focus, last } = focused()
  try {
    const { host, home } = withHome(async () => {})
    await act(async () => { button(host, 'Clear')!.click() })
    await act(async () => { button(host, 'Yes, clear')!.click() })
    await flush()
    expect(button(host, 'Clear'), 'the question closed').toBeTruthy()
    expect(last()).toBe(home.current)
  } finally {
    focus.mockRestore()
  }
})

test('a confirm that settles after the viewer moved on leaves focus where they put it', async () => {
  const { focus } = focused()
  let settle!: () => void
  const outside = document.createElement('button')
  document.body.appendChild(outside)
  try {
    const { host } = withHome(() => new Promise<void>(resolve => { settle = resolve }))
    await act(async () => { button(host, 'Clear')!.click() })
    await act(async () => { button(host, 'Yes, clear')!.click() })
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => outside })
    focus.mockClear()
    await act(async () => { settle() })
    await flush()
    expect(focus, 'neither the row nor the button takes it').not.toHaveBeenCalled()
    expect(button(host, 'Clear'), 'the question still closed').toBeTruthy()
  } finally {
    delete (document as { activeElement?: unknown }).activeElement
    outside.remove()
    focus.mockRestore()
  }
})
