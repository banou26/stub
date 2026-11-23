// A source publishes under one origin and is addressable by others. Conflating those two sets means a
// whole class of source is never asked at all: anizip answers from an anidb or a mal id and mints
// `anizip:` uris, so its own name cannot appear in a cluster until it has already answered.
import { describe, expect, test } from 'vitest'

import { answersForOrigins, shouldAskOnOrigins } from '../../../src/sources/supported'
import { supportedUris as anizipSupports, origin as anizipOrigin } from '../../../src/sources/anizip/extractor'

describe('answersForOrigins', () => {
  const anizip = { origin: anizipOrigin, supportedUris: anizipSupports }

  test('a source is asked when its own origin is known', () => {
    expect(answersForOrigins({ origin: 'kitsu' }, ['kitsu', 'mal'])).toBe(true)
  })

  test('and NOT when nothing it understands is known', () => {
    expect(answersForOrigins({ origin: 'kitsu' }, ['anilist'])).toBe(false)
  })

  test('a source is also asked for an origin it can be ADDRESSED by, not only its own', () => {
    // the bug: a cluster naming anidb and mal but not anizip left anizip unasked forever
    expect(answersForOrigins(anizip, ['anidb', 'anilist', 'kitsu', 'mal', 'offline'])).toBe(true)
  })

  test('anizip really does declare those, so the case above is the live one', () => {
    expect(anizipOrigin).toBe('anizip')
    expect([...anizipSupports].sort()).toEqual(['anidb', 'mal'])
  })

  test('either supported origin on its own is enough', () => {
    expect(answersForOrigins(anizip, ['mal'])).toBe(true)
    expect(answersForOrigins(anizip, ['anidb'])).toBe(true)
  })

  test('and it is still asked for its own origin once that appears', () => {
    expect(answersForOrigins(anizip, ['anizip'])).toBe(true)
  })

  test('a source that declares none is matched on its origin alone', () => {
    expect(answersForOrigins({ origin: 'anilist' }, ['anilist'])).toBe(true)
    expect(answersForOrigins({ origin: 'anilist' }, ['mal'])).toBe(false)
  })

  test('and nothing known means nothing to ask', () => {
    expect(answersForOrigins(anizip, [])).toBe(false)
  })
})

describe('shouldAskOnOrigins', () => {
  const pluginOrigins = new Set(['eztv', 'tpb'])

  test('built-in sources follow answersForOrigins alone', () => {
    expect(shouldAskOnOrigins({ origin: 'anilist' }, ['jw'])).toBe(false)
    expect(shouldAskOnOrigins({ origin: 'anizip', supportedUris: ['anidb', 'mal'] }, ['mal'])).toBe(true)
    expect(shouldAskOnOrigins({ origin: 'anizip', supportedUris: ['anidb', 'mal'] }, [])).toBe(false)
  })

  test('a plugin omitting supportedUris is re-asked when a non-plugin origin joins, until it answers', () => {
    expect(shouldAskOnOrigins({ origin: 'eztv' }, ['jw'], { plugin: true, answered: false, pluginOrigins })).toBe(true)
    expect(shouldAskOnOrigins({ origin: 'eztv' }, ['jw'], { plugin: true, answered: true, pluginOrigins })).toBe(false)
  })

  test('a plugin omitting supportedUris is not re-asked when only plugin origins join', () => {
    expect(shouldAskOnOrigins({ origin: 'eztv' }, ['tpb'], { plugin: true, answered: false, pluginOrigins })).toBe(false)
    expect(shouldAskOnOrigins({ origin: 'eztv' }, ['tpb', 'jw'], { plugin: true, answered: false, pluginOrigins })).toBe(true)
  })

  test('a plugin declaring supportedUris follows them while unanswered, and stops once it answers', () => {
    const eztv = { origin: 'eztv', supportedUris: ['jw'] }
    expect(shouldAskOnOrigins(eztv, ['tmdb'], { plugin: true, answered: false, pluginOrigins })).toBe(false)
    expect(shouldAskOnOrigins(eztv, ['jw'], { plugin: true, answered: false, pluginOrigins })).toBe(true)
    expect(shouldAskOnOrigins(eztv, ['jw'], { plugin: true, answered: true, pluginOrigins })).toBe(false)
  })
})
