// The settings page shows one category at a time, Accounts or Sources, picked by the URL's
// fragment so a link or a reload lands on it.
import { expect, test } from 'vite-plus/test'

import { SETTINGS_SECTIONS, sectionFromHash } from '../../../src/router/settings/sections'

test('two categories, Accounts then Sources, each with an id a link can name', () => {
  expect(SETTINGS_SECTIONS.map(section => section.title)).toEqual(['Accounts', 'Sources'])
  expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['accounts', 'sources'])
})

test('a fragment picks its category, spelled as location.hash spells it', () => {
  expect(sectionFromHash('#sources')).toBe('sources')
  expect(sectionFromHash('#accounts')).toBe('accounts')
})

test('no fragment, or one naming no category, picks Accounts', () => {
  expect(sectionFromHash('')).toBe('accounts')
  expect(sectionFromHash('sources'), 'without its #').toBe('accounts')
  expect(sectionFromHash('#Sources')).toBe('accounts')
  for (const removed of ['#data', '#tracking', '#playback', '#api-keys']) expect(sectionFromHash(removed), removed).toBe('accounts')
})
