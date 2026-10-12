// `mergeCredits`: one title's characters and staff out of every member's own credits (HOR-348).
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import type { SourceCharacter, SourceCredits } from '../../../../../src/sources/credits'

import { resolvers as anilistResolvers } from '../../../../../src/sources/anilist/extractor'
import { parseCredits } from '../../../../../src/sources/ann/extractor'
import { parseMalCredits } from '../../../../../src/sources/jikan/credits-page'
import { parseCredits as justwatchCredits } from '../../../../../src/sources/justwatch/extractor'
import { parseCredits as imdbCredits } from '../../../../../src/sources/omdb/extractor'
import { parseCredits as tmdbCredits } from '../../../../../src/sources/tmdb/extractor'
import { parseCredits as tvmazeCredits } from '../../../../../src/sources/tvmaze/extractor'
import { mergeCredits, nameKey, type CreditCharacter } from '../../../../../src/worker/graph/plugins/credits'
import SHOWS from '../../../../fixtures/credits/anilist-shows.json'
import IMDB_BREAKING_BAD from '../../../../fixtures/credits/imdb-breaking-bad.json'
import JUSTWATCH_BREAKING_BAD from '../../../../fixtures/credits/jw-breaking-bad.json'
import TVMAZE_BREAKING_BAD from '../../../../fixtures/credits/tvmaze-breaking-bad.json'

const person = (id: number, name: string) => ({ id: `anilist:${id}`, name })
const character = (id: number, name: string, role?: SourceCharacter['role'], voiceActors: SourceCharacter['voiceActors'] = []): SourceCharacter =>
  ({ id: `anilist:${id}`, names: [name], role, voiceActors })
const member = (uri: string, credits: Partial<SourceCredits>) =>
  ({ uri, raw: { credits: { characters: [], staff: [], ...credits } } })
const actor = (language: string, name: string) => ({ language, person: { id: `x:${name}`, name } })

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

// Slice 2: AniList and Anime News Network joined by name, on trimmed real rows of both
// (tests/fixtures/credits). Eren's AniList cast is trimmed to three languages so one of ANN's
// strings shares no actor on its own.

const anilist = async (show: keyof typeof SHOWS): Promise<SourceCredits> => {
  const fetch = async () => ({ status: 200, json: async () => ({ data: { Media: SHOWS[show] } }) })
  const subscribe = (anilistResolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `anilist:${SHOWS[show].id}`, details: true } }, { fetch, similarMedia: async () => undefined }).next()
  return value.media.credits
}
const ann = (show: keyof typeof SHOWS) => parseCredits(readFileSync(new URL(`../../../../fixtures/credits/ann-${show}.xml`, import.meta.url), 'utf8'))
const both = async (show: keyof typeof SHOWS) => mergeCredits([member('anilist:1', await anilist(show)), member('ann:1', ann(show))])!
const cast = (character: CreditCharacter | undefined, language: string) =>
  character?.voiceActors.filter(actor => actor.language === language).map(({ name }) => name)
const named = (characters: CreditCharacter[], name: string) => characters.filter(character => character.name === name)

const mal = (show: string) => ({
  ...parseMalCredits(readFileSync(new URL(`../../../../fixtures/credits/mal-${show}.html`, import.meta.url), 'utf8')),
  score: 0.7,
})

// MyAnimeList's row scores 0.9, above AniList's 0.8, and its credits 0.7. Mutation: read the sources in
// member order and MyAnimeList's Spike leads with its url, and Faye and Ed come before Jet.
test('Bebop: MyAnimeList\'s credits are read after AniList\'s and before ANN\'s, though its row scores above both', async () => {
  const merged = mergeCredits([
    { ...member('mal:1', mal('bebop')), score: 0.9 },
    { ...member('anilist:1', await anilist('bebop')), score: 0.8 },
    { ...member('ann:13', ann('bebop')), score: 0.2 },
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual([
    'Spike Spiegel', 'Jet Black', 'Faye Valentine', 'Edward Wong Hau Pepelu Tivrusky IV', 'Alisa', 'Actress', 'Lin',
  ])
  expect(merged.characters[0]!.url).toBe('https://anilist.co/character/1')
  expect(cast(merged.characters[0], 'ko'), 'AniList\'s Korean cast, not MyAnimeList\'s "Ja-hyeong Gu"').toEqual(['Ja-Hyeong Koo'])
  expect(cast(merged.characters[1], 'tl'), 'ANN still adds the dub neither lists').toEqual(['Vincent Gutierrez'])
  expect(merged.characters[2]).toMatchObject({
    role: 'MAIN',
    url: 'https://myanimelist.net/character/2/Faye_Valentine',
    image: 'https://cdn.myanimelist.net/images/characters/15/264961.jpg',
  })
  expect(merged.staff).toHaveLength(13)
  expect(merged.staff[0]).toEqual({
    name: 'Shinichirou Watanabe',
    image: expect.stringContaining('anilistcdn'),
    url: 'https://anilist.co/staff/97009',
    roles: ['Director', 'Episode Director', 'Script', 'Storyboard', 'Series Director', 'Unit Director'],
  })
})

// Mutation: remove each fold's line from `nameKey` and its pair splits.
test('names fold across spellings: marks, long vowels, initials, nicknames and "Family, Given"', () => {
  expect(nameKey('Unshou Ishizuka')).toBe(nameKey('Unshō Ishizuka'))
  expect(nameKey('Yuuki Kaji')).toBe(nameKey('Yūki Kaji'))
  expect(nameKey('Tsugumi Ooba')).toBe(nameKey('Tsugumi Ohba'))
  expect(nameKey('Christopher Sabat')).toBe(nameKey('Christopher R. Sabat'))
  expect(nameKey('Shigeo Kageyama')).toBe(nameKey('Shigeo \'Mob\' Kageyama'))
  expect(nameKey('Yamadera, Kouichi')).toBe(nameKey('Kouichi Yamadera'))
  expect(nameKey('Alessandro D\'Errico')).toBe('alessandro d errico')
  expect(nameKey('Ohno'), 'oh before n stays').not.toBe(nameKey('Ono'))
  expect(nameKey('Yoh Asakura'), 'oh ending a word').toBe(nameKey('Yō Asakura'))
  expect(nameKey('Kenji Satoh'), 'oh ending the name').toBe(nameKey('Kenji Satō'))
})

// Mutation: flip every name at its one comma and "Walter White, Jr." keys as "Jr. Walter White".
test('a suffix after a comma stays where it is: "Walter White, Jr." is "Walter White Jr."', () => {
  expect(nameKey('Walter White, Jr.')).toBe(nameKey('Walter White Jr.'))
  expect(nameKey('Lon Chaney, Sr.')).toBe(nameKey('Lon Chaney Sr.'))
  expect(nameKey('Davis Love, III')).toBe(nameKey('Davis Love III'))
  expect(nameKey('Ken Griffey, II')).toBe(nameKey('Ken Griffey II'))
})

// A guard, not a line: red only if a suffix is ever dropped from the key. Staff have no actor to tell
// a father from his son, so the name alone decides.
test('a father and his son are two: "Lon Chaney" never joins "Lon Chaney, Jr."', () => {
  const merged = mergeCredits([
    member('omdb:tt1', { staff: [{ person: { id: 'imdb:nm0151606', name: 'Lon Chaney' }, roles: ['Director'] }] }),
    member('tvmaze:1', { staff: [{ person: { id: 'tvmaze:1', name: 'Lon Chaney, Jr.' }, roles: ['Creator'] }] }),
  ])!
  expect(merged.staff.map(({ name }) => name)).toEqual(['Lon Chaney', 'Lon Chaney, Jr.'])
})

// Guards, not lines: red only if a word sort or an edit distance is ever added to `nameKey`, or a
// person's name is ever tried in the other word order, as a character's is.
test('a person\'s word order is kept and spellings are never compared by likeness', () => {
  const staffOf = (id: string, name: string) => ({ staff: [{ person: { id, name }, roles: ['Key Animation'] }] })
  const people = (a: [string, string], b: [string, string]) =>
    mergeCredits([member('anilist:1', staffOf(...a)), member('ann:1', staffOf(...b))])!.staff.map(({ name }) => name)

  expect(people(['anilist:105003', 'José Leonardo'], ['anilist:194141', 'Leonardo José'])).toEqual(['José Leonardo', 'Leonardo José'])
  expect(people(['anilist:107112', 'Tsutomu Tareki'], ['ann:6602', 'Tsutomu Taruki'])).toEqual(['Tsutomu Tareki', 'Tsutomu Taruki'])
})

// One Piece's rows on AniList, MyAnimeList (its "Dracule, Mihawk" read "Mihawk Dracule") and ANN on
// 2026-10-13, each cast trimmed. Mutation: drop `reordered` from the characters' other keys and Mihawk,
// Hancock and Riku are each drawn twice.
test('a character named in the other word order is one entry, and still needs an actor in common', () => {
  const merged = mergeCredits([
    member('anilist:21', { characters: [{ id: 'anilist:2064', names: ['Dracule Mihawk', 'Hawk-Eyes'], voiceActors: [actor('ja', 'Takeshi Aono')] }] }),
    member('mal:21', {
      characters: [
        { id: 'mal:2064', names: ['Mihawk Dracule'], voiceActors: [actor('ja', 'Takeshi Aono'), actor('en', 'John Gremillion')] },
        { id: 'mal:16342', names: ['Hancock Boa'], voiceActors: [actor('ja', 'Kotono Mitsuishi')] },
        { id: 'mal:108585', names: ['Dold III Riku'], voiceActors: [actor('ja', 'Masashi Hirose')] },
        { id: 'mal:4883', names: ['Roger Gol D.'], voiceActors: [actor('ja', 'Takeshi Kusao')] },
      ],
    }),
    member('ann:836', {
      characters: [
        { names: ['Dracule Mihawk'], voiceActors: [actor('ja', 'Takeshi Aono')] },
        { names: ['Boa Hancock'], voiceActors: [actor('ja', 'Kotono Mitsuishi'), actor('en', 'Lydia Mackay')] },
        { names: ['Riku Dold III'], voiceActors: [actor('ja', 'Masashi Hirose')] },
        { names: ['Gol D. Roger'], voiceActors: [actor('es', 'Antón Cancelas')] },
      ],
    }),
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual(['Dracule Mihawk', 'Hancock Boa', 'Dold III Riku', 'Roger Gol D.', 'Gol D. Roger'])
  expect(cast(merged.characters[0], 'en'), 'MyAnimeList\'s dub joins AniList\'s Mihawk').toEqual(['John Gremillion'])
  expect(cast(merged.characters[1], 'en'), 'ANN\'s dub joins MyAnimeList\'s Hancock').toEqual(['Lydia Mackay'])
})

// Death Note's rows on 2026-10-13: MyAnimeList's Hideki Ryuuga, the idol, reaches AniList's L through L's
// alias "Ryuga Hideki" in the other word order. Mutation: drop the rank of a row's own names and the two
// MyAnimeList rows reaching L join neither, so L is drawn twice.
test('a row reaching an entry by its own names outranks one reaching it in the other word order', () => {
  const merged = mergeCredits([
    member('anilist:1535', { characters: [{ id: 'anilist:71', names: ['L Lawliet', 'Ryuga Hideki', 'Ryuzaki'], voiceActors: [actor('ja', 'Kappei Yamaguchi')] }] }),
    member('mal:1535', {
      characters: [
        { id: 'mal:71', names: ['L Lawliet'], voiceActors: [actor('ja', 'Kappei Yamaguchi'), actor('en', 'Alessandro Juliani')] },
        { id: 'mal:217386', names: ['Hideki Ryuuga'], voiceActors: [actor('ja', 'Kensuke Nishi')] },
      ],
    }),
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual(['L Lawliet', 'Hideki Ryuuga'])
  expect(cast(merged.characters[0], 'en')).toEqual(['Alessandro Juliani'])
})

// ANN lists One Piece's Niji twice: "Niji Vinsmoke" for the German dub, "Vinsmoke Niji" for the Japanese
// one. Mutation: let a row's own names outrank the other word order in a source without ids too, and the
// German string, sharing no actor alone, is drawn as a second Niji.
test('a source without ids joins its strings in either word order together, the other order on an actor of its own', () => {
  const merged = mergeCredits([
    member('mal:21', { characters: [{ id: 'mal:146917', names: ['Niji Vinsmoke'], voiceActors: [actor('ja', 'Atsushi Miyauchi')] }] }),
    member('ann:836', {
      characters: [
        { names: ['Niji Vinsmoke'], voiceActors: [actor('de', 'Johannes Wolko')] },
        { names: ['Vinsmoke Niji'], voiceActors: [actor('ja', 'Atsushi Miyauchi')] },
      ],
    }),
  ])!
  expect(merged.characters).toHaveLength(1)
  expect(cast(merged.characters[0], 'de')).toEqual(['Johannes Wolko'])
})

// Death Note's idol Hideki Ryuga is not L, whose AniList alias is "Ryuga Hideki", and ANN lists both, as
// when MyAnimeList's page has not answered. Mutation: judge ANN's strings reaching L together, whatever
// the order, and the idol rides in on L's string's actor and is not drawn at all.
test('a string reaching an entry only in the other word order joins on an actor of its own, never on another string\'s', () => {
  const merged = mergeCredits([
    member('anilist:1535', { characters: [{ id: 'anilist:71', names: ['L Lawliet', 'Ryuga Hideki', 'Ryuzaki'], voiceActors: [actor('ja', 'Kappei Yamaguchi'), actor('en', 'Alessandro Juliani')] }] }),
    member('ann:6592', {
      characters: [
        { names: ['L Lawliet'], voiceActors: [actor('ja', 'Kappei Yamaguchi')] },
        { names: ['Hideki Ryuga'], voiceActors: [actor('ja', 'Kensuke Nishi'), actor('en', 'Paul Dobson')] },
      ],
    }),
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual(['L Lawliet', 'Hideki Ryuga'])
  expect(cast(merged.characters[1], 'en')).toEqual(['Paul Dobson'])
})

// Mutation: drop the name join from `mergeRows` and Watanabe is drawn twice.
test('a staff member both sources list by name is one entry with both sources\' jobs', async () => {
  const { staff } = await both('bebop')
  expect(staff).toEqual([{
    name: 'Shinichirou Watanabe',
    image: expect.stringContaining('anilistcdn'),
    url: 'https://anilist.co/staff/97009',
    roles: ['Director', 'Series Director', 'Script', 'Storyboard', 'Unit Director'],
  }])
  expect((await both('deathnote')).staff.map(({ name }) => name), 'Ooba and Ohba').toEqual(['Tsugumi Ooba'])
})

// Mutation: accept `targets.length >= 1` and ANN's entry joins one of AniList's two.
test('a name two people share on one side joins nobody', () => {
  const kobayashi = (id: string) => ({ person: { id, name: 'Toshio Kobayashi' }, roles: ['Animation Director'] })
  const ann = member('ann:1', { staff: [kobayashi('ann:8203')] })

  expect(mergeCredits([member('anilist:1', { staff: [kobayashi('anilist:103739'), kobayashi('anilist:245788')] }), ann])!.staff).toHaveLength(3)
  expect(mergeCredits([member('anilist:1', { staff: [kobayashi('anilist:103739')] }), ann])!.staff, 'the control').toHaveLength(1)
  expect(mergeCredits([member('anilist:1', { staff: [kobayashi('anilist:103739')] }), member('ann:1', { staff: [kobayashi('ann:8203'), kobayashi('ann:8204')] })])!.staff, 'two on the other side')
    .toHaveLength(3)
})

// Mutation: drop the name join and Jet is drawn twice; drop the per-language rule and he has two
// Japanese actors.
test('Jet Black joins ANN\'s through the actor they share, and ANN adds only the dubs AniList lacks', async () => {
  const { characters } = await both('bebop')
  const jets = named(characters, 'Jet Black')
  expect(jets).toHaveLength(1)
  expect(cast(jets[0], 'ja')).toEqual(['Unshou Ishizuka'])
  expect(cast(jets[0], 'tl'), 'ANN\'s only language AniList does not list').toEqual(['Vincent Gutierrez'])
  expect(jets[0]!.voiceActors.filter(({ url }) => url?.includes('animenewsnetwork'))).toHaveLength(1)
})

// Mutation: union the languages and ANN's other English Spike and its Korean spelling both stack.
test('Spike keeps AniList\'s English and Korean casts whole', async () => {
  const spike = named((await both('bebop')).characters, 'Spike Spiegel')
  expect(spike).toHaveLength(1)
  expect(cast(spike[0], 'en')).toEqual(['Steven Blum'])
  expect(cast(spike[0], 'ko')).toEqual(['Ja-Hyeong Koo'])
})

// Mutation: require a shared Japanese actor whenever AniList lists one, and Pinako (whom ANN casts
// only in Italian) is drawn twice.
test('Pinako Rockbell joins through her Italian actor and keeps AniList\'s two Japanese ones', async () => {
  const { characters } = await both('fmab')
  const pinako = named(characters, 'Pinako Rockbell')
  expect(pinako).toHaveLength(1)
  expect(cast(pinako[0], 'ja')).toEqual(['Mami Koyama', 'Miyoko Asou'])
  expect(named(characters, 'Alex Louis Armstrong'), 'Sabat and Christopher R. Sabat').toHaveLength(1)
})

// Mutation: judge each ANN string alone and "Eren Jäger", whose German actor AniList's trimmed row
// does not list, stays a second Eren.
test('Eren takes ANN\'s "Eren Jaeger" and "Eren Jäger" together, and one string never joins two characters', async () => {
  const { characters } = await both('aot')
  expect(characters.map(({ name }) => name)).toEqual(['Eren Yeager', 'Eren Jæger', 'Eren Jeager'])
  expect(cast(characters[0], 'de'), 'from "Eren Jäger"').toEqual(['Max Felder'])
  expect(cast(characters[0], 'it'), 'from "Eren Jaeger"').toEqual(['Alessandro Campaiola Ward', 'Alessandro Campaiola'])

  // a row whose names reach two entries joins neither. Mutation: accept `targets.length >= 1`.
  const kaji = { language: 'ja', person: { id: 'anilist:95672', name: 'Yuuki Kaji' } }
  const twoNames = mergeCredits([
    member('anilist:1', { characters: [character(1, 'Eren Yeager', 'MAIN', [kaji]), character(2, 'Zeke Yeager', 'MAIN', [kaji])] }),
    member('anilist:2', { characters: [{ ...character(3, 'Eren Yeager', 'MAIN', [kaji]), names: ['Eren Yeager', 'Zeke Yeager'] }] }),
  ])!
  expect(twoNames.characters).toHaveLength(3)

  // two rows reaching one entry, each by its own name, join neither. Mutation: drop `matched.length > 1`.
  const twoRows = mergeCredits([
    member('anilist:1', { characters: [{ ...character(1, 'Eren Yeager', 'MAIN', [kaji]), names: ['Eren Yeager', 'Eren Jaeger'] }] }),
    member('anilist:2', { characters: [character(2, 'Eren Yeager', 'MAIN', [kaji]), character(3, 'Eren Jaeger', 'MAIN', [kaji])] }),
  ])!
  expect(twoRows.characters).toHaveLength(3)
})

const mother = (source: 'anilist' | 'ann', voiceActors: SourceCharacter['voiceActors']) =>
  member(`${source}:1`, { characters: [{ ...source === 'anilist' ? { id: 'anilist:900' } : {}, names: ['Mother'], voiceActors }] })

// Mutation: make `accept` always agree and the two mothers become one.
test('two characters with one name and no actor in common stay two', () => {
  const merged = mergeCredits([mother('anilist', [actor('ja', 'Akiko Hiramatsu')]), mother('ann', [actor('ja', 'Kikuko Inoue')])])!
  expect(merged.characters).toHaveLength(2)
  expect(mergeCredits([mother('anilist', [actor('ja', 'Akiko Hiramatsu')]), mother('ann', [actor('ja', 'Akiko Hiramatsu')])])!.characters, 'the control')
    .toHaveLength(1)
})

// Mutation: drop the Japanese clause from `sharesActor` and a shared English actor joins them.
test('a shared English actor does not join two characters whose Japanese actors differ', () => {
  const merged = mergeCredits([
    mother('anilist', [actor('ja', 'Akiko Hiramatsu'), actor('en', 'Wendee Lee')]),
    mother('ann', [actor('ja', 'Kikuko Inoue'), actor('en', 'Wendee Lee')]),
  ])!
  expect(merged.characters).toHaveLength(2)
})

// Mutation: hold ANN's strings to the uniqueness of a side with ids, and its second spelling of
// "Mother" is drawn as a second character.
test('two of ANN\'s strings that fold to one name both join it', () => {
  const merged = mergeCredits([
    mother('anilist', [actor('ja', 'Akiko Hiramatsu')]),
    member('ann:1', { characters: [{ names: ['Mother'], voiceActors: [actor('ja', 'Akiko Hiramatsu')] }, { names: ['MOTHER'], voiceActors: [actor('en', 'Wendee Lee')] }] }),
  ])!
  expect(merged.characters).toHaveLength(1)
  expect(cast(merged.characters[0], 'en')).toEqual(['Wendee Lee'])
})

// Mutation: compare actors by name in any language and the English and French ones join them.
test('an actor shared in two different languages joins nothing', () => {
  const merged = mergeCredits([mother('anilist', [actor('en', 'Same Person')]), mother('ann', [actor('fr', 'Same Person')])])!
  expect(merged.characters).toHaveLength(2)
})

// Mutation: drop `.filter(Boolean)` from `keysOf` and two unnamed parts become one character.
test('names that fold to nothing never match', () => {
  const unnamed = (source: 'anilist' | 'ann') =>
    member(`${source}:1`, { characters: [{ ...source === 'anilist' ? { id: 'anilist:900' } : {}, names: ['???'], voiceActors: [actor('ja', 'Akiko Hiramatsu')] }] })
  expect(mergeCredits([unnamed('anilist'), unnamed('ann')])!.characters).toHaveLength(2)
})

// A guard: red only if a match through an actor alone is ever added. Masaki Aizawa voices Masahiko
// Kida on AniList's page and Anthony Rester on ANN's.
test('a voice actor alone never joins two characters', async () => {
  const { characters } = await both('deathnote')
  expect(characters.map(({ name }) => name)).toEqual(['Masahiko Kida', 'Anthony Rester', 'Anthony Lester'])
  expect(cast(characters[0], 'ja')).toEqual(['Masaki Aizawa'])
})

// Mutation: prepend each new entry rather than append it and AniList's order turns over.
test('characters only ANN lists come last, with no role and no face, and a member with no credits changes nothing', async () => {
  const merged = await both('bebop')
  expect(merged.characters.map(({ name }) => name)).toEqual(['Spike Spiegel', 'Jet Black', 'Lin'])
  expect(merged.characters[2]).toMatchObject({ role: null, image: null, url: null })

  const withBare = mergeCredits([member('anilist:1', await anilist('bebop')), { uri: 'kitsu:1', raw: { titles: [] } }, member('ann:1', ann('bebop'))])
  expect(withBare).toEqual(merged)
})

// MyAnimeList's two rows both carry "Mother", so that name joins neither; "Kaa", which only one of
// them carries, still joins it to AniList's Kaa. Mutation: count a key's uses only among the rows
// that propose a match, and the "Mother" that also names Kaa no longer hides the other one's match.
test('a name two characters share on the later side joins nobody, though one of them also names another', () => {
  const row = (id: string, names: string[], actor: string) => ({ id, names, url: id.startsWith('mal') ? id : undefined, voiceActors: [{ language: 'ja', person: { id: `p:${actor}`, name: actor } }] })
  const merged = mergeCredits([
    member('anilist:1', { characters: [row('anilist:1', ['Mother'], 'X'), row('anilist:2', ['Kaa'], 'Y')] }),
    member('mal:1', { characters: [row('mal:1', ['Mother'], 'X'), row('mal:2', ['Mother', 'Kaa'], 'Y')] }),
  ])!
  expect(merged.characters.map(({ name, url }) => `${name} ${url}`)).toEqual(['Mother null', 'Kaa mal:2', 'Mother mal:1'])
})

// Breaking Bad as IMDb, TVmaze and JustWatch answered the title page on 2026-10-12. Mutation: drop the
// name rule and every character and person comes once per source.
test('live action: one part and one person listed by several sources is one entry, with no language', () => {
  const merged = mergeCredits([
    member('omdb:tt0903747', imdbCredits(IMDB_BREAKING_BAD.data.title)),
    member('tvmaze:169-s1', tvmazeCredits(TVMAZE_BREAKING_BAD._embedded)),
    member('jw:4-1', justwatchCredits(JUSTWATCH_BREAKING_BAD)),
  ])!

  const walter = merged.characters.filter(({ name }) => name === 'Walter White')
  expect(walter).toEqual([{
    name: 'Walter White',
    image: 'https://static.tvmaze.com/uploads/images/medium_portrait/0/2404.jpg',
    url: 'https://www.tvmaze.com/characters/45529/breaking-bad-walter-white',
    role: null,
    voiceActors: [{
      name: 'Bryan Cranston',
      image: 'https://m.media-amazon.com/images/M/MV5BMTA2NjEyMTY4MTVeQTJeQWpwZ15BbWU3MDQ5NDAzNDc@._V1_UY256_.jpg',
      url: 'https://www.imdb.com/name/nm0186505',
      language: null,
    }],
  }])
  expect(merged.characters.filter(({ name }) => name === 'Jesse Pinkman')).toHaveLength(1)
  expect(merged.staff.filter(({ name }) => name === 'Vince Gilligan')).toEqual([{
    name: 'Vince Gilligan',
    image: 'https://m.media-amazon.com/images/M/MV5BNTUyNzUxOTAxMV5BMl5BanBnXkFtZTcwNzk0MDM0Nw@@._V1_UY256_.jpg',
    url: 'https://www.imdb.com/name/nm0319213',
    roles: ['Creator', 'Executive Producer', 'Director'],
  }])
})

// Mutation: take every source's characters, and an anime's TVmaze cast draws Spike a second time.
test('beside a cast by language, a cast that names none adds no characters, and its staff still join', () => {
  const merged = mergeCredits([
    member('anilist:1', {
      characters: [character(1, 'Spike Spiegel', 'MAIN', [{ language: 'ja', person: person(95011, 'Kouichi Yamadera') }])],
      staff: [{ person: person(97009, 'Shinichirou Watanabe'), roles: ['Director'] }],
    }),
    member('tvmaze:1', {
      characters: [{ id: 'tvmaze:1', names: ['Spike Spiegel'], voiceActors: [{ language: null, person: { id: 'tvmaze:2', name: 'Steven Blum' } }] }],
      staff: [{ person: { id: 'tvmaze:3', name: 'Shinichirou Watanabe' }, roles: ['Creator'] }],
    }),
  ])!
  expect(merged.characters.map(({ name, voiceActors }) => [name, voiceActors.map(({ name }) => name)])).toEqual([['Spike Spiegel', ['Kouichi Yamadera']]])
  expect(merged.staff).toEqual([{ name: 'Shinichirou Watanabe', image: null, url: null, roles: ['Director', 'Creator'] }])
})

// An upcoming season: AniList lists the characters before any voice actor. Mutation: test the data for
// a language rather than for a null one, and Spike is drawn twice.
test('AniList characters with no actor yet still keep an unlabelled cast\'s characters out', () => {
  const merged = mergeCredits([
    member('anilist:1', { characters: [character(1, 'Spike Spiegel', 'MAIN')] }),
    member('omdb:tt3', { characters: [{ names: ['Spike Spiegel'], voiceActors: [{ language: null, person: { id: 'imdb:nm1', name: 'Koichi Yamadera' } }] }] }),
  ])!
  expect(merged.characters.map(({ name, voiceActors }) => [name, voiceActors.length])).toEqual([['Spike Spiegel', 0]])
})

const parts = (characters: CreditCharacter[]) => characters.map(({ name, voiceActors }) => `${name}: ${voiceActors.map(({ name }) => name).join(', ')}`)

// The three sources list 12 parts. Mutation: drop the suffix rule and RJ Mitte's part is drawn twice;
// drop the nickname and Mike and Gus are.
test('Breaking Bad: "Walter White, Jr." and TVmaze\'s nicknames join, 15 entries for 12 parts become 12', () => {
  const merged = mergeCredits([
    member('omdb:tt0903747', imdbCredits(IMDB_BREAKING_BAD.data.title)),
    member('tvmaze:169-s1', tvmazeCredits(TVMAZE_BREAKING_BAD._embedded)),
    member('jw:4-1', justwatchCredits(JUSTWATCH_BREAKING_BAD)),
  ])!
  expect(parts(merged.characters)).toEqual([
    'Walter White: Bryan Cranston',
    'Skyler White: Anna Gunn',
    'Jesse Pinkman: Aaron Paul',
    'Hank Schrader: Dean Norris',
    'Marie Schrader: Betsy Brandt',
    'Walter White, Jr.: RJ Mitte',
    'Saul Goodman: Bob Odenkirk',
    'Steven Gomez: Steven Michael Quezada',
    'Mike Ehrmantraut: Jonathan Banks',
    'Gus Fring: Giancarlo Esposito',
    'Todd Alquist: Jesse Plemons',
    'Lydia Rodarte-Quayle: Laura Fraser',
  ])
})

// With TMDB, sources run IMDb, TMDB, TVmaze, JustWatch. TMDB's "Gustavo Fring" reaches nothing of
// IMDb's "Gus Fring", and TVmaze's "Gustavo 'Gus' Fring" then names both: its own name joins TMDB's
// and the nickname stays unused, a missed merge (Todd and "Todd Alquist" are another). Mutation: try
// the nickname beside the name and TVmaze's row reaches two entries and joins neither, and JustWatch's
// then too, four Gus entries.
test('four live-action sources: a nickname is tried only when the name reaches nothing', () => {
  const merged = mergeCredits([
    member('omdb:tt0903747', imdbCredits(IMDB_BREAKING_BAD.data.title)),
    member('tmdb:1396-s1', tmdbCredits(readFileSync(new URL('../../../../fixtures/credits/tmdb-breaking-bad.html', import.meta.url), 'utf8'))),
    member('tvmaze:169-s1', tvmazeCredits(TVMAZE_BREAKING_BAD._embedded)),
    member('jw:4-1', justwatchCredits(JUSTWATCH_BREAKING_BAD)),
  ])!
  expect(parts(merged.characters)).toEqual([
    'Walter White: Bryan Cranston',
    'Skyler White: Anna Gunn',
    'Jesse Pinkman: Aaron Paul',
    'Hank Schrader: Dean Norris',
    'Marie Schrader: Betsy Brandt',
    'Walter White, Jr.: RJ Mitte',
    'Saul Goodman: Bob Odenkirk',
    'Steven Gomez: Steven Michael Quezada',
    'Mike Ehrmantraut: Jonathan Banks',
    'Gus Fring: Giancarlo Esposito',
    'Gustavo Fring: Giancarlo Esposito',
    'Skinny Pete: Charles Baker',
    'Ted Beneke: Christopher Cousins',
    'Francesca (voice): Tina Parker',
    'Todd Alquist: Jesse Plemons',
    'Lydia Rodarte-Quayle: Laura Fraser',
  ])
  expect(merged.characters[0]!.voiceActors[0]!.image, 'IMDb leads the face').toContain('media-amazon.com')
  expect(merged.staff.map(({ name, roles }) => `${name}: ${roles!.join(', ')}`), 'TMDB adds no staff').toEqual([
    'Vince Gilligan: Creator, Executive Producer, Director',
    'Michelle MacLaren: Co-Executive Producer, Executive Producer, Director',
    'Dave Porter: Music',
    'Rian Johnson: Director',
    'Bryan Cranston: Director',
  ])
})

const played = (name: string, actor: string): SourceCredits => ({ characters: [{ names: [name], voiceActors: [{ language: null, person: { id: `x:${actor}`, name: actor } }] }], staff: [] })

// TVmaze's row joins TMDB's "Gustavo Fring" by its own name. Mutation: keep that entry's nickname with
// its names and the last "Gus Fring" reaches both entries, joins neither and is drawn a third time.
test('an entry\'s nickname is tried only when a name reaches no entry: a later "Gus Fring" joins IMDb\'s', () => {
  const merged = mergeCredits([
    member('omdb:1', played('Gus Fring', 'Giancarlo Esposito')),
    member('tmdb:1', played('Gustavo Fring', 'Giancarlo Esposito')),
    member('tvmaze:1', played("Gustavo 'Gus' Fring", 'Giancarlo Esposito')),
    member('jw:1', played('Gus Fring', 'Giancarlo Esposito')),
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual(['Gus Fring', 'Gustavo Fring'])
})

// Mutation: match only the row's nickname in the fallback and JustWatch's "Mike Ehrmantraut" misses
// the entry TVmaze named "Michael 'Mike' Ehrmantraut".
test('a nickname read first still takes the name a later source writes', () => {
  const merged = mergeCredits([
    member('tvmaze:1', played("Michael 'Mike' Ehrmantraut", 'Jonathan Banks')),
    member('jw:1', played('Mike Ehrmantraut', 'Jonathan Banks')),
  ])!
  expect(merged.characters.map(({ name }) => name)).toEqual(["Michael 'Mike' Ehrmantraut"])
})
