// The page's half of the stub tracker's account link: the worker sees neither the account nor the
// page's visibility, so the page must tell it of both.
import { expect, test, vi } from 'vitest'

import { watchTrackerAccount } from '../../../src/tracking/account-watch'

const events = () => {
  const listeners = new Map<string, (() => void)[]>()
  return {
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, [...listeners.get(type) ?? [], listener]) },
    fire: (type: string) => { for (const listener of listeners.get(type) ?? []) listener() },
  }
}

test('checks the account at once, on every account change and on the way back online, and refreshes when the page is back in view', async () => {
  let accountListener: (() => void) | undefined
  const accountChanged = vi.fn(async () => {})
  const focused = vi.fn(async () => {})
  const page = events()
  const doc = Object.assign(events(), { visibilityState: 'visible' })

  const stop = watchTrackerAccount({
    onChange: async (listener) => { accountListener = listener; return () => {} },
    accountChanged,
    focused,
    page,
    document: doc,
    intervalMs: 1e9,
  })
  expect(accountChanged).toHaveBeenCalledTimes(1)

  accountListener!()
  page.fire('online')
  expect(accountChanged).toHaveBeenCalledTimes(3)

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
    onChange: async () => () => {},
    accountChanged: async () => { throw new Error('worker gone') },
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
