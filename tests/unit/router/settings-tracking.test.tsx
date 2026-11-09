// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// STUB-58 (publish what you watch to your FKN Social profile): Settings, Tracking holds the switch that asks FKN
// Social to take stub's posts, and says where the viewer stands there. FKN Social's package is faked behind fkn.app's
// broker: `installed` says whether stub installed it, `state` what it answers, `down` makes each call throw.

const social = vi.hoisted(() => ({
  installed: false,
  down: false,
  state: { state: 'off' } as { state: string, kinds?: string[] },
  installs: 0,
  read: 0,
  asks: [] as object[],
  stops: 0,
}))
vi.mock('@fkn/lib/packages', () => ({
  install: async (_uri: string, options: { noConfirm?: boolean }) => {
    social.installs++
    social.installed = options.noConfirm === true
    return social.installed ? { uri: 'https:social.fkn.app' } : null
  },
  connect: async () => {
    if (!social.installed) throw Object.assign(new Error('not installed'), { code: 'not-installed' })
    return {
      remote: {
        hello: async () => ({ protocol: 2, min: 1 }),
        publishing: async () => {
          if (social.down) throw new Error('down')
          social.read++
          return social.state
        },
        allowPublishing: async (ask: object) => {
          social.asks.push(ask)
          social.state = { state: 'asked' }
          return social.state
        },
        stopPublishing: async () => {
          social.stops++
          social.state = { state: 'off' }
          return social.state
        },
      },
    }
  },
}))

const { TrackingSection } = await import('../../../src/router/settings/tracking')
const { social: publishing } = await import('../../../src/social')

beforeEach(async () => {
  // a call that throws drops the one connection the page keeps, so each test connects afresh
  social.down = true
  await publishing.publishing()
  Object.assign(social, { installed: false, down: false, state: { state: 'off' }, installs: 0, read: 0, asks: [], stops: 0 })
})

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const render = async () => {
  const host = mount(withIntl(<TrackingSection/>))
  hosts.push(host)
  await settle()
  const toggle = host.querySelector<HTMLInputElement>('input[role="switch"]')!
  return {
    host,
    toggle,
    // linkedom implements no `checked` property, so Preact renders the attribute until a flip sets one
    on: () => (toggle.checked as boolean | undefined) ?? toggle.hasAttribute('checked'),
    press: async (on: boolean) => {
      await act(() => {
        Object.assign(toggle, { checked: on })
        toggle.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await settle()
    },
    line: () => [...host.querySelectorAll('.line')].map(line => [line.tagName, line.textContent, line.getAttribute('href')]),
  }
}

test('shown, it reads off and installs nothing; only a press installs FKN Social and asks for the three kinds', async () => {
  const { toggle, on, press, line } = await render()
  expect(toggle.closest('label')!.textContent).toBe('Post to FKN Social')
  expect([on(), line()]).toEqual([false, []])
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await settle()
  expect([social.installs, social.asks]).toEqual([0, []])

  await press(true)
  expect([social.installs, social.asks]).toEqual([1, [{ kinds: ['started', 'watched', 'completed'] }]])
  expect([on(), line()]).toEqual([true, [['A', 'Allow it on FKN Social.', 'https://social.fkn.app/']]])
})

test('reads where the viewer stands each time it is shown or comes back into view, asking nothing', async () => {
  social.installed = true
  social.state = { state: 'asked' }
  const { on, line } = await render()
  expect([on(), line()]).toEqual([true, [['A', 'Allow it on FKN Social.', 'https://social.fkn.app/']]])
  social.state = { state: 'allowed', kinds: ['started', 'watched', 'completed'] }
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await settle()
  expect([on(), line(), social.read, social.asks]).toEqual([true, [], 2, []])
})

test('each answer that stops it reads its own line, with the switch off', async () => {
  const lines: [string, (string | null)[]][] = [
    ['no-name', ['A', 'Pick a name on FKN Social first.', 'https://social.fkn.app/']],
    ['locked', ['P', "The FKN account's storage is locked on this device", null]],
    ...['unavailable', 'not-here', 'outdated', 'unsupported'].map((state): [string, (string | null)[]] =>
      [state, ['P', 'FKN Social is not available right now. Try again later.', null]]),
  ]
  social.installed = true
  for (const [state, shown] of lines) {
    social.state = { state }
    const { on, line } = await render()
    expect([on(), line()], state).toEqual([false, [shown]])
  }
  expect(social.asks).toEqual([])
})

test('turning it off stops the posts', async () => {
  social.installed = true
  social.state = { state: 'allowed', kinds: ['started', 'watched', 'completed'] }
  const { on, press } = await render()
  expect(on()).toBe(true)
  await press(false)
  expect([social.stops, social.asks, on()]).toEqual([1, [], false])
})
