import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { parseMalCredits } from '../../../../src/sources/jikan/credits-page'

// Real bytes from myanimelist.net's credits pages, 2026-10-13: Cowboy Bebop's first 6 characters and 13
// people, Spirited Away's first 4 and 4 (tests/fixtures/credits).
const page = (name: string) =>
  parseMalCredits(readFileSync(new URL(`../../../fixtures/credits/mal-${name}.html`, import.meta.url), 'utf8'))

// Mutation: drop the sort and Jet, whom the page lists first, leads; drop `givenFirst` and Spike is
// "Spiegel, Spike".
test('characters come in order of favorites, with their role, given name first', () => {
  const { characters } = page('bebop')
  expect(characters.map(({ names, role }) => `${names.join('/')} ${role}`)).toEqual([
    'Spike Spiegel MAIN',
    'Faye Valentine MAIN',
    'Edward Wong Hau Pepelu Tivrusky IV MAIN',
    'Jet Black MAIN',
    'Alisa SUPPORTING',
    'Actress SUPPORTING',
  ])
  expect(characters[0]).toMatchObject({
    id: 'mal:1',
    url: 'https://myanimelist.net/character/1/Spike_Spiegel',
    image: 'https://cdn.myanimelist.net/images/characters/11/516853.jpg',
  })
})

// Mutation: drop "portuguese (br)" from LANGUAGES and Guilherme Briggs's language is the page's own words.
test('every dub is read, each actor given name first, with a language code', () => {
  const [spike] = page('bebop').characters
  expect(spike!.voiceActors.map(({ language, person }) => `${language} ${person.name}`)).toEqual([
    'ja Kouichi Yamadera',
    'en Steven Blum',
    'it Massimo De ambrosis',
    'de Viktor Neumann',
    'hu Zoltán Juhász',
    'fr Yann Pichon',
    'ko Ja-hyeong Gu',
    'es Joan Pera',
    'pt Guilherme Briggs',
    'es José Gilberto Vilchis',
    'es Yamil Atala',
    'es Genaro Vásquez',
  ])
  expect(spike!.voiceActors[0]!.person).toEqual({
    id: 'mal:11',
    name: 'Kouichi Yamadera',
    image: 'https://cdn.myanimelist.net/images/voiceactors/2/73614.jpg',
    url: 'https://myanimelist.net/people/11/Kouichi_Yamadera',
  })
})

// Mutation: keep the placeholder and Kazuhiko Ikeguchi's face is MyAnimeList's question mark.
test('staff carry every role, and a face nobody added is none', () => {
  const { staff } = page('bebop')
  expect(staff).toHaveLength(13)
  expect(staff[0]).toEqual({
    person: { id: 'mal:77978', name: 'Kazuhiko Ikeguchi', image: undefined, url: 'https://myanimelist.net/people/77978/Kazuhiko_Ikeguchi' },
    roles: ['Producer'],
  })
  expect(staff[3]).toEqual({
    person: {
      id: 'mal:2009',
      name: 'Shinichirou Watanabe',
      image: 'https://cdn.myanimelist.net/images/voiceactors/3/48770.jpg',
      url: 'https://myanimelist.net/people/2009/Shinichirou_Watanabe',
    },
    roles: ['Director', 'Episode Director', 'Script', 'Storyboard'],
  })
})

test('a film: its two leads first, a Mandarin dub, and the director\'s four jobs', () => {
  const { characters, staff } = page('spirited-away')
  expect(characters.map(({ names, role }) => `${names[0]} ${role}`)).toEqual(['Haku MAIN', 'Chihiro Ogino MAIN', 'Ani-yaku SUPPORTING', 'Aogaeru SUPPORTING'])
  expect(characters[1]!.voiceActors.filter(({ language }) => language === 'zh').map(({ person }) => person.name)).toEqual(['Maggie Hsu'])
  expect(staff.map(({ person, roles }) => `${person.name}: ${roles.join(', ')}`)).toEqual([
    'Toshio Suzuki: Producer',
    'Tomohiko Ishii: Assistant Producer',
    'Hayao Miyazaki: Director, Script, Storyboard, Original Creator',
    'Kazuhiro Wakabayashi: Sound Director',
  ])
})
