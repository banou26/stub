// What the stub tracker keys an entry on. The case that shaped these rules is a season beside its own
// show: a cluster may hold the show-level Crunchyroll id next to the season id (utils/uri.ts), so any
// rule that matches on SHARED MEMBERS files season 2 under season 1's entry.
import { describe, expect, test } from 'vitest'

import { entryMatches, identify, newEntryIdentity, type CatalogLookup, type MediaIdentity } from '../../../src/tracking/identity'

const ROWS = [
  { mal: 10, anilist: 1, kitsu: 5, anidb: 7 },
  { mal: 20, anilist: 2, kitsu: 6, anidb: 8 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => ROWS.find(row => row[origin] === id) }

const writable = (identity: MediaIdentity) => {
  if (identity.kind !== 'catalogue' && identity.kind !== 'keys') throw new Error(`expected an identity that can hold an entry, got ${identity.kind}`)
  return identity
}

const SEASON_1 = 'ag:(anilist:1,cr:G24H1N3MP,cr:G24H1N3MP-GS1)'
const SEASON_2 = 'ag:(anilist:2,cr:G24H1N3MP,cr:G24H1N3MP-GS2)'

describe('a season beside its show-level id', () => {
  test('season 2 does not find season 1\'s entry through the Crunchyroll show id they share', () => {
    const entry = newEntryIdentity(writable(identify(SEASON_1, catalog)))

    expect(entryMatches(entry, identify(SEASON_1, catalog)), 'the control: season 1 finds its own entry').toBe(true)
    expect(entryMatches(entry, identify(SEASON_2, catalog))).toBe(false)
  })

  test('with no catalogue id at all, each season is keyed on its own most specific id and matched by equality', () => {
    const first = identify('ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS1)')
    const second = identify('ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS2)')

    expect(first).toEqual({ kind: 'keys', keys: ['cr:G24H1N3MP-GS1'] })
    const entry = newEntryIdentity(writable(first))
    expect(entryMatches(entry, second)).toBe(false)
    expect(entryMatches(entry, identify('ag:(cr:G24H1N3MP-GS1,hulu:abc)')), 'the season found again once the cluster grew').toBe(true)
  })

  test('an entry saved before the media had a catalogue id is still found once it has one', () => {
    const entry = newEntryIdentity(writable(identify('ag:(cr:G24H1N3MP-GS1)')))

    expect(entryMatches(entry, identify(`ag:(anilist:1,cr:G24H1N3MP-GS1)`, catalog))).toBe(true)
    expect(entryMatches(entry, identify(`ag:(anilist:2,cr:G24H1N3MP-GS2)`, catalog))).toBe(false)
  })
})

describe('catalogue ids', () => {
  test('an entry saved under the AniList id is found from a uri naming only the MyAnimeList one', () => {
    const entry = newEntryIdentity(writable(identify('ag:(anilist:1)', catalog)))

    expect(entry.ids).toEqual(['anidb:7', 'anilist:1', 'kitsu:5', 'mal:10'])
    expect(entryMatches(entry, identify('ag:(cr:ZZZ,mal:10)', catalog))).toBe(true)
    expect(entryMatches(entry, identify('ag:(offline:mal-10)', catalog)), 'the offline source\'s borrowed id counts').toBe(true)
    expect(entryMatches(entry, identify('ag:(mal:20)', catalog)), 'the control: another run').toBe(false)
  })

  test('a catalogue the media names itself keeps its own id, and one two rows disagree on is left out', () => {
    const identity = identify('ag:(anilist:1,kitsu:6)', catalog)

    // anilist:1 widens to kitsu 5 and the media says kitsu 6, so kitsu stays 6. The two rows disagree
    // on mal (10 against 20) and on anidb (7 against 8), so neither is claimed.
    expect(identity).toEqual({ kind: 'catalogue', ids: ['anilist:1', 'kitsu:6'], keys: [] })
  })
})

describe('ambiguous', () => {
  test('two ids of one catalogue, which a weld of two runs produces', () => {
    expect(identify('ag:(anilist:1,anilist:2)', catalog)).toEqual({ kind: 'ambiguous', candidates: ['anilist:1', 'anilist:2'] })
  })

  test('two ids of one origin where neither extends the other', () => {
    expect(identify('ag:(cr:X-GS1,cr:X-GS2)')).toEqual({ kind: 'ambiguous', candidates: ['cr:X-GS1', 'cr:X-GS2'] })
  })

  test('the control: a show id beside its own season is not ambiguous', () => {
    expect(identify('ag:(cr:X,cr:X-GS1)')).toEqual({ kind: 'keys', keys: ['cr:X-GS1'] })
  })

  test('an entry matches no ambiguous media, whatever it holds', () => {
    const entry = newEntryIdentity(writable(identify('ag:(anilist:1)', catalog)))
    expect(entryMatches(entry, identify('ag:(anilist:1,anilist:2)', catalog))).toBe(false)
  })
})

test('a media naming nothing to key on', () => {
  expect(identify('ag:(offline:unknown)')).toEqual({ kind: 'none' })
  expect(identify('not a uri')).toEqual({ kind: 'none' })
})
