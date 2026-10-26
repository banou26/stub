import { expect, test } from 'vite-plus/test'

import { castIn, creditLanguages, languageLabel, roleLabel } from '../../../../src/router/title/credits'

const actor = (name: string, language: string) => ({ name, language })

// Cowboy Bebop's first three, as AniList voices them
const BEBOP = [
  { name: 'Spike Spiegel', role: 'MAIN', voiceActors: [actor('Kouichi Yamadera', 'ja'), actor('Steven Blum', 'en'), actor('José Gilberto Vilchis', 'es')] },
  { name: 'Faye Valentine', role: 'MAIN', voiceActors: [actor('Wendee Lee', 'en'), actor('Sherry Lynn', 'en'), actor('Carmen Ambrós', 'es')] },
  { name: 'Ein', role: 'BACKGROUND', voiceActors: [actor('Kouichi Yamadera', 'ja'), actor('Alfonso Ramírez', 'es')] },
]

test('Japanese comes first and is selected, then the languages voicing the most characters', () => {
  expect(creditLanguages(BEBOP)).toEqual({ options: ['ja', 'es', 'en'], selected: 'ja' })
})

test('with no Japanese, the language voicing the most is selected', () => {
  const dubbed = BEBOP.map(character => ({ ...character, voiceActors: character.voiceActors.filter(({ language }) => language !== 'ja') }))
  expect(creditLanguages(dubbed)).toEqual({ options: ['es', 'en'], selected: 'es' })
  expect(creditLanguages([BEBOP[1]!]).selected).toBe('en')
})

test('one language draws no picker', () => {
  expect(creditLanguages([{ name: 'Ein', voiceActors: [actor('Kouichi Yamadera', 'ja')] }])).toEqual({ options: [], selected: 'ja' })
  expect(creditLanguages([])).toEqual({ options: [], selected: undefined })
})

test('the cast in one language keeps a character with no actor in it, stacking two', () => {
  const cast = castIn(BEBOP, 'en')
  expect(cast.map(({ name, actors }) => [name, actors.map(({ name }) => name)])).toEqual([
    ['Spike Spiegel', ['Steven Blum']],
    ['Faye Valentine', ['Wendee Lee', 'Sherry Lynn']],
    ['Ein', []],
  ])
})

test('roles and languages read as words', () => {
  expect(roleLabel('SUPPORTING')).toBe('Supporting')
  expect(roleLabel(null)).toBeUndefined()
  expect(languageLabel('ja')).toBe('Japanese')
  expect(languageLabel('Klingon')).toBe('Klingon')
})

test('each role AniList names, and one it does not as the source wrote it', () => {
  expect(['MAIN', 'SUPPORTING', 'BACKGROUND', 'GUEST'].map(roleLabel)).toEqual(['Main', 'Supporting', 'Background', 'GUEST'])
})

test('the languages AniList voices read in English', () => {
  expect(['ja', 'en', 'es', 'pt', 'fr', 'de', 'it', 'ko', 'zh', 'he', 'hu', 'fil'].map(languageLabel))
    .toEqual(['Japanese', 'English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Korean', 'Chinese', 'Hebrew', 'Hungarian', 'Filipino'])
})

test('live action names no language: no picker, and every actor is drawn', () => {
  const cast = [{ name: 'Walter White', voiceActors: [{ name: 'Bryan Cranston', language: null }] }]
  const languages = creditLanguages(cast)
  expect(languages).toEqual({ options: [], selected: undefined })
  expect(castIn(cast, languages.selected)[0]!.actors.map(({ name }) => name)).toEqual(['Bryan Cranston'])
})
