import { expect, test } from 'vite-plus/test'

import { episodeLabel } from '../../../src/utils/episode-label'

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
