// The settings page is one page of four sections, in the order the owner chose (HOR-225, L2), each
// reachable by a link in its index.
import { expect, test } from 'vite-plus/test'

import { SETTINGS_SECTIONS, sectionFromHash } from '../../../src/router/settings/sections'

test('four sections, in the chosen order, each with an id a link can name', () => {
  expect(SETTINGS_SECTIONS.map(section => section.title)).toEqual(['Accounts', 'Sources', 'Tracking', 'Playback'])
  expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['accounts', 'sources', 'tracking', 'playback'])
})

test('a fragment names its section, and nothing else names one', () => {
  expect(sectionFromHash('#sources')).toBe('sources')
  expect(sectionFromHash('#accounts')).toBe('accounts')
  expect(sectionFromHash('sources'), 'the fragment as location.hash spells it, with its #').toBeUndefined()
  expect(sectionFromHash('')).toBeUndefined()
  expect(sectionFromHash('#Sources')).toBeUndefined()
  expect(sectionFromHash('#data'), 'the Data section is gone').toBeUndefined()
  expect(sectionFromHash('#api-keys')).toBeUndefined()
})
