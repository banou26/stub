// The settings page shows one category at a time, Accounts, Sources or Playback, picked by the URL's
// fragment so a link or a reload lands on it.
import { expect, test } from 'vite-plus/test'

import { SETTINGS_SECTIONS, sectionFromHash } from '../../../src/router/settings/sections'

test('three categories, Accounts, Sources then Playback, each with an id a link can name', () => {
  expect(SETTINGS_SECTIONS.map(section => section.title)).toEqual(['Accounts', 'Sources', 'Playback'])
  expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['accounts', 'sources', 'playback'])
})

test('a fragment picks its category, spelled as location.hash spells it', () => {
  expect(sectionFromHash('#sources')).toBe('sources')
  expect(sectionFromHash('#accounts')).toBe('accounts')
  expect(sectionFromHash('#playback')).toBe('playback')
})

test('no fragment, or one naming no category, picks Accounts', () => {
  expect(sectionFromHash('')).toBe('accounts')
  expect(sectionFromHash('sources'), 'without its #').toBe('accounts')
  expect(sectionFromHash('#Sources')).toBe('accounts')
  for (const removed of ['#data', '#tracking', '#api-keys']) expect(sectionFromHash(removed), removed).toBe('accounts')
})
