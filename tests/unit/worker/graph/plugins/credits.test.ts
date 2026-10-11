// `mergeCredits`: one title's characters and staff out of every member's own credits (HOR-348).
import { expect, test } from 'vite-plus/test'

import type { SourceCharacter, SourceCredits } from '../../../../../src/sources/credits'

import { mergeCredits } from '../../../../../src/worker/graph/plugins/credits'

const person = (id: number, name: string) => ({ id: `anilist:${id}`, name })
const character = (id: number, name: string, role?: SourceCharacter['role'], voiceActors: SourceCharacter['voiceActors'] = []): SourceCharacter =>
  ({ id: `anilist:${id}`, names: [name], role, voiceActors })
const member = (uri: string, credits: Partial<SourceCredits>) =>
  ({ uri, raw: { credits: { characters: [], staff: [], ...credits } } })

test('a person listed under two jobs is one staff entry with both, notes dropped', () => {
  const merged = mergeCredits([member('anilist:1', {
    staff: [
      { person: person(97009, 'Shinichirou Watanabe'), roles: ['Director'] },
      { person: person(97334, 'Keiko Nobumoto'), roles: ['Series Composition'] },
      { person: person(97009, 'Shinichirou Watanabe'), roles: ['Storyboard (eps 1, 26)'] },
    ],
  })])

  expect(merged?.staff).toEqual([
    { name: 'Shinichirou Watanabe', image: null, url: null, roles: ['Director', 'Storyboard'] },
    { name: 'Keiko Nobumoto', image: null, url: null, roles: ['Series Composition'] },
  ])
})

test('characters run MAIN, SUPPORTING, BACKGROUND, then unstated, in source order inside a role', () => {
  const merged = mergeCredits([member('anilist:1', {
    characters: [
      character(5, 'Ein', 'BACKGROUND'),
      character(4, 'Vicious', 'SUPPORTING'),
      character(9, 'Nobody'),
      character(1, 'Spike Spiegel', 'MAIN'),
      character(6, 'Julia', 'SUPPORTING'),
      character(3, 'Jet Black', 'MAIN'),
    ],
  })])

  expect(merged?.characters.map(({ name }) => name)).toEqual(['Spike Spiegel', 'Jet Black', 'Vicious', 'Julia', 'Ein', 'Nobody'])
})

// Two AniList entries in one cluster list the same Spike and the same director
test('the first source leads: a language\'s actors come whole from it, a job keeps its spelling', () => {
  const merged = mergeCredits([
    member('anilist:1', {
      characters: [{ ...character(1, 'Spike Spiegel', undefined, [{ language: 'en', person: person(95012, 'Steven Blum') }]), image: 'first.jpg' }],
      staff: [{ person: person(97009, 'Shinichirou Watanabe'), roles: ['Director'] }],
    }),
    member('anilist:2', {
      characters: [{
        ...character(1, 'Spike Spiegel', 'MAIN', [
          { language: 'ja', person: person(95011, 'Kouichi Yamadera') },
          { language: 'en', person: person(539, 'Another Spike') },
        ]),
        image: 'second.jpg',
      }],
      staff: [{ person: person(97009, 'Shinichirou Watanabe'), roles: ['director'] }],
    }),
  ])

  expect(merged?.characters).toHaveLength(1)
  expect(merged?.characters[0]!.image, 'from the first source that has one').toBe('first.jpg')
  expect(merged?.characters[0]!.role, 'from the first source that states one').toBe('MAIN')
  expect(merged?.characters[0]!.voiceActors.map(({ name, language }) => `${language} ${name}`))
    .toEqual(['en Steven Blum', 'ja Kouichi Yamadera'])
  expect(merged?.staff.map(({ roles }) => roles)).toEqual([['Director']])
})

test('nothing is merged when no member carries credits', () => {
  expect(mergeCredits([{ uri: 'anilist:1', raw: { titles: [] } }])).toBeUndefined()
})
