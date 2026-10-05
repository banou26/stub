// The settings page is one page of five sections, in the order the owner chose (HOR-225, L2), each
// reachable by a link in its index.
import { expect, test } from 'vite-plus/test'

import { SETTINGS_SECTIONS, sectionFromHash } from '../../../src/router/settings/sections'

test('five sections, in the chosen order, each with an id a link can name', () => {
  expect(SETTINGS_SECTIONS.map(section => section.title)).toEqual(['Accounts', 'Sources', 'Tracking', 'Playback', 'Data'])
  expect(SETTINGS_SECTIONS.map(section => section.id)).toEqual(['accounts', 'sources', 'tracking', 'playback', 'data'])
})

test('a fragment names its section, and nothing else names one', () => {
  expect(sectionFromHash('#data')).toBe('data')
  expect(sectionFromHash('#accounts')).toBe('accounts')
  expect(sectionFromHash('data'), 'the fragment as location.hash spells it, with its #').toBeUndefined()
  expect(sectionFromHash('')).toBeUndefined()
  expect(sectionFromHash('#Data')).toBeUndefined()
  expect(sectionFromHash('#api-keys')).toBeUndefined()
})
