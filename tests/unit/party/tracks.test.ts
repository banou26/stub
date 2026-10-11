import { describe, expect, test } from 'vite-plus/test'

import { nextMine, trackToSelect } from '../../../src/party/tracks'

const player = (selected: string | null, busy = false) => ({ ids: ['English', 'Spanish', 'Japanese'], selected, busy })

describe('trackToSelect', () => {
  test('follows the party', () => {
    expect(trackToSelect('Spanish', 'party', player('English'))).toBe('Spanish')
  })

  test('keeps the member\'s own pick over the party\'s', () => {
    expect(trackToSelect('Spanish', 'English', player('English'))).toBeUndefined()
    expect(trackToSelect('Spanish', 'Japanese', player('English'))).toBe('Japanese')
  })

  test('turns subtitles off, for the party or for the member', () => {
    expect(trackToSelect(null, 'party', player('English'))).toBeNull()
    expect(trackToSelect('English', null, player('English'))).toBeNull()
  })

  test('leaves a track this source lacks alone', () => {
    expect(trackToSelect('German', 'party', player('English'))).toBeUndefined()
  })

  test('does nothing while a switch runs, with no party choice, or once selected', () => {
    expect(trackToSelect('Spanish', 'party', player('English', true))).toBeUndefined()
    expect(trackToSelect(undefined, 'party', player('English'))).toBeUndefined()
    expect(trackToSelect('English', 'party', player('English'))).toBeUndefined()
    expect(trackToSelect(null, 'party', player(null))).toBeUndefined()
  })
})

describe('nextMine', () => {
  const list = (selected: string | null) => ({ ids: ['English', 'Spanish'], selected })

  // or every episode, loading on whatever the source defaults to, would be an override
  test('a newly loaded player\'s first selection is not a pick', () => {
    expect(nextMine('party', 'Spanish', undefined, list('English'), undefined)).toBe('party')
  })

  test('a change nobody here asked for is the member\'s pick', () => {
    expect(nextMine('party', 'Spanish', list('Spanish'), list('English'), undefined)).toBe('English')
    expect(nextMine('party', 'Spanish', list('Spanish'), list(null), undefined)).toBeNull()
  })

  // the party moved on while the switch to its last choice ran
  test('the change this member\'s page asked for is not, even once the party has moved on', () => {
    expect(nextMine('party', 'English', list('English'), list('Spanish'), 'Spanish')).toBe('party')
    expect(nextMine('party', 'English', list('English'), list(null), null)).toBe('party')
  })

  test('picking the party\'s track again rejoins the party', () => {
    expect(nextMine('English', 'Spanish', list('English'), list('Spanish'), undefined)).toBe('party')
  })

  test('no change keeps the choice', () => {
    expect(nextMine('English', 'Spanish', list('English'), list('English'), undefined)).toBe('English')
  })
})
