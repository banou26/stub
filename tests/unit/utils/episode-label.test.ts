import { expect, test } from 'vite-plus/test'

import { startLanguage } from '../../../src/i18n'
import { entryLabel, episodeLabel } from '../../../src/utils/episode-label'

test('an episode is named by its number and title, whichever of the two it has', () => {
  expect(episodeLabel(5, 'The Rain Stops')).toBe('E5 - The Rain Stops')
  expect(episodeLabel(0, 'Prologue')).toBe('E0 - Prologue')
  expect(episodeLabel(null, 'The Rain Stops')).toBe('The Rain Stops')
  expect(episodeLabel(5, undefined)).toBe('Episode 5')
  expect(episodeLabel(undefined, '')).toBeUndefined()
})

// One Piece's 1100 episodes and on, as the sources count them
test('a number past a thousand reads as the sources write it, with no grouping', () => {
  expect([episodeLabel(1180, 'Egghead'), episodeLabel(1180, undefined)]).toEqual(['E1180 - Egghead', 'Episode 1180'])
})

test('in German and Japanese, an episode is named in the language, its number as the sources write it', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    expect([episodeLabel(1180, 'Egghead'), episodeLabel(1180, undefined), episodeLabel(null, 'Egghead')]).toEqual(['Folge 1180 - Egghead', 'Folge 1180', 'Egghead'])
    await startLanguage({ language: 'ja', languages: ['ja-JP'] })
    expect([episodeLabel(5, '雨上がり'), episodeLabel(5, undefined)]).toEqual(['第5話 雨上がり', '第5話'])
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

// STUB-401: a film's data is its one entry numbered 1, which was named "E1 - Halloween"
test('a film is named by its own title alone, its entry\'s when it has none, and a series\' episode as before', () => {
  const entry = { episodeNumber: 1, titles: [{ title: 'Halloween (2018)' }] }
  expect(entryLabel({ type: 'MOVIE', titles: [{ title: 'Halloween' }] }, entry)).toBe('Halloween')
  expect(entryLabel({ categories: ['MOVIE'] }, entry), 'no title of its own').toBe('Halloween (2018)')
  expect(entryLabel({ type: 'MOVIE' }, { episodeNumber: 1 }), 'nothing to name it by').toBeUndefined()
  expect(entryLabel({ type: 'TV', titles: [{ title: 'Halloween' }] }, entry), 'a series of one episode').toBe('E1 - Halloween (2018)')
  const part = { episodeNumber: 2, titles: [{ title: 'Part 1 of 2' }] }
  expect(entryLabel({ type: 'MOVIE', titles: [{ title: 'Spirited Away' }], episodes: [entry, part] }, part), 'a film in parts').toBe('E2 - Part 1 of 2')
  expect(entryLabel({ type: 'MOVIE', titles: [{ title: 'Halloween' }], episodes: [entry] }, entry), 'a film of one entry').toBe('Halloween')
})
