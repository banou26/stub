// The settings page shows one category at a time, Sources, Tracking, Playback or Language, picked by the URL's
// fragment so a link or a reload lands on it.
import { expect, test } from 'vite-plus/test'

import { intl } from '../../../src/i18n'
import { SETTINGS_SECTIONS, sectionFromHash } from '../../../src/router/settings/sections'

// STUB-58 (publish what you watch to your FKN Social profile) brought Tracking back, holding its switch
test('four categories, Sources, Tracking, Playback then Language, each with an id a link can name', () => {
  expect(SETTINGS_SECTIONS.map(section => intl.formatMessage(section.title))).toEqual(['Sources', 'Tracking', 'Playback', 'Language'])
  expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['sources', 'tracking', 'playback', 'language'])
})

test('a fragment picks its category, spelled as location.hash spells it', () => {
  expect(sectionFromHash('#sources')).toBe('sources')
  expect(sectionFromHash('#tracking')).toBe('tracking')
  expect(sectionFromHash('#playback')).toBe('playback')
  expect(sectionFromHash('#language')).toBe('language')
})

// the owner, 2026-10-25 (HOR-1019): "I think we can completely remove that Accounts category"
test('no fragment, or one naming no category, Accounts included, picks Sources', () => {
  expect(sectionFromHash('')).toBe('sources')
  expect(sectionFromHash('playback'), 'without its #').toBe('sources')
  expect(sectionFromHash('#Playback')).toBe('sources')
  for (const removed of ['#accounts', '#data', '#api-keys']) expect(sectionFromHash(removed), removed).toBe('sources')
})
