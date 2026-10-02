// The page's half of the stub tracker's account link: the worker hears of an account change itself,
// and the page tells it of the rest, its start, its way back online and its visibility.
import { expect, test, vi } from 'vitest'

import { watchTrackerAccount } from '../../../src/tracking/account-watch'

const events = () => {
  const listeners = new Map<string, (() => void)[]>()
  return {
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, [...listeners.get(type) ?? [], listener]) },
    fire: (type: string) => { for (const listener of listeners.get(type) ?? []) listener() },
  }
}

test('checks the account at once and on the way back online, and refreshes when the page is back in view', async () => {
  const check = vi.fn(async () => {})
  const focused = vi.fn(async () => {})
  const page = events()
  const doc = Object.assign(events(), { visibilityState: 'visible' })

  const stop = watchTrackerAccount({
    check,
    focused,
    page,
    document: doc,
    intervalMs: 1e9,
  })
  expect(check).toHaveBeenCalledTimes(1)

  page.fire('online')
  expect(check).toHaveBeenCalledTimes(2)

  doc.visibilityState = 'hidden'
  doc.fire('visibilitychange')
  expect(focused, 'hidden is not back').not.toHaveBeenCalled()
  doc.visibilityState = 'visible'
  doc.fire('visibilitychange')
  page.fire('focus')
  expect(focused).toHaveBeenCalledTimes(2)
  stop()
})

test('a step that fails is logged, never thrown at the page', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const stop = watchTrackerAccount({
    check: async () => { throw new Error('worker gone') },
    focused: async () => {},
    page: events(),
    document: Object.assign(events(), { visibilityState: 'visible' }),
    intervalMs: 1e9,
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(warn).toHaveBeenCalledWith('tracking: account link', expect.any(Error))
  stop()
  warn.mockRestore()
})
