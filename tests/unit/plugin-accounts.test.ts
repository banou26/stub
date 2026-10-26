import { expect, test } from 'vite-plus/test'

import { createPluginAccounts } from '../../src/plugin-accounts'

test('a source that needs no account is free and never counts as signed out, whatever it said', () => {
  const accounts = createPluginAccounts()
  expect(accounts.free('nyaa', 'none')).toBe(true)
  expect(accounts.neverSignedIn('nyaa', 'none')).toBe(false)
  accounts.record('nyaa', 'signed-out')
  expect(accounts.free('nyaa', 'none')).toBe(true)
  expect(accounts.neverSignedIn('nyaa', 'none')).toBe(false)
})

test('a source that needs an account is free only while it says the viewer is signed in', () => {
  for (const access of ['account', 'paid'] as const) {
    const accounts = createPluginAccounts()
    expect(accounts.free('paid', access), `${access}, not answered`).toBe(false)
    expect(accounts.neverSignedIn('paid', access), `${access}, not answered`).toBe(true)
    accounts.record('paid', 'signed-in')
    expect(accounts.free('paid', access), `${access}, signed in`).toBe(true)
    expect(accounts.neverSignedIn('paid', access), `${access}, signed in`).toBe(false)
    accounts.record('paid', 'signed-out')
    expect(accounts.free('paid', access), `${access}, signed out since`).toBe(false)
    expect(accounts.neverSignedIn('paid', access), `${access}, signed out since a sign in`).toBe(false)
  }
})

test('signed out with no sign in before it counts as never signed in, and two in a row still do', () => {
  const accounts = createPluginAccounts()
  accounts.record('paid', 'signed-out')
  accounts.record('paid', 'signed-out')
  expect(accounts.free('paid', 'account')).toBe(false)
  expect(accounts.neverSignedIn('paid', 'account')).toBe(true)
})

test('no plan is never free and always gives way, a sign in before it too, since a sign in cannot fix it', () => {
  const accounts = createPluginAccounts()
  accounts.record('paid', 'no-plan')
  expect(accounts.free('paid', 'paid')).toBe(false)
  expect(accounts.neverSignedIn('paid', 'paid')).toBe(true)
  accounts.record('paid', 'signed-in')
  accounts.record('paid', 'no-plan')
  expect(accounts.free('paid', 'paid')).toBe(false)
  expect(accounts.neverSignedIn('paid', 'paid')).toBe(true)
})

test('each source keeps its own answer', () => {
  const accounts = createPluginAccounts()
  accounts.record('first', 'signed-in')
  expect(accounts.free('second', 'account')).toBe(false)
  expect(accounts.neverSignedIn('second', 'account')).toBe(true)
})
