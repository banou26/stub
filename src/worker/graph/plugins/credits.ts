import { givenFirst, type SourceCharacter, type SourceCredits, type SourcePerson } from '../../../sources/credits'

/** A person as `MediaPerson` answers it. */
export type CreditPerson = { name: string, image: string | null, url: string | null, language?: string | null, roles?: string[] }

/** A character as `MediaCharacter` answers it. */
export type CreditCharacter = {
  name: string
  image: string | null
  url: string | null
  role: string | null
  voiceActors: CreditPerson[]
}

type Member = { uri: string, score?: number | null, raw: Record<string, unknown> }

const ROLE_ORDER = ['MAIN', 'SUPPORTING', 'BACKGROUND']
const roleRank = (role: string | null) => (role && ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length)

const creditsOf = (member: Member): SourceCredits | undefined => {
  const credits = member.raw.credits as SourceCredits | undefined
  return credits && Array.isArray(credits.characters) && Array.isArray(credits.staff) ? credits : undefined
}

const personOf = (person: SourcePerson): CreditPerson => ({ name: person.name, image: person.image ?? null, url: person.url ?? null })

const jobOf = (role: string) => role.replace(/\s*\([^)]*\)/g, '').trim()

/**
 * A name folded so two sources' spellings of it meet, and nothing more: "Yamadera, Kouichi" and
 * "Kouichi Yamadera", "Unshō" and "Unshou", "Ohba" and "Ooba", "Christopher R. Sabat" and
 * "Christopher Sabat", "Walter White, Jr." and "Walter White Jr." give one key. Word order is kept, so
 * "José Leonardo" and "Leonardo José" stay two people, and "Ohno" and "Ono" stay two names.
 */
export const nameKey = (name: string): string =>
  givenFirst(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(^|\s)['"‘“][^'"’”]*['"’”](?=\s|$)/g, ' ')
    .replace(/(^|\s)\p{L}\.(?=\s|$)/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/ou|oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/oh(?=[bcdfghjklmpqrstvwxyz]| |$)/g, 'o')
    .trim()

// "Michael 'Mike' Ehrmantraut" read as "Mike Ehrmantraut", the name another source writes
const nicknamed = (name: string): string[] => {
  const nickname = name.replace(/\S+\s+['"‘“]([^'"’”]+)['"’”](?=\s|$)/u, '$1')
  return nickname === name ? [] : [nickname]
}
const nicknameKeys = (name: string) => nicknamed(name).map(nameKey)

// The first word moved to the end, "dracule mihawk" as "mihawk dracule" and "riku dold iii" as "dold iii
// riku": one direction is enough, as a row's other keys meet an entry's names and its names an entry's
// other keys
const reordered = (key: string) => key.replace(/^(\S+) (.+)$/, '$2 $1')

/**
 * Every source's rows folded into entries, sources in order. A row joins an entry that shares its id;
 * else the one earlier entry its name keys reach, when they reach exactly one and `accept` agrees; else
 * it starts an entry. `otherKeys` (a nickname, a name in the other word order), the row's and the
 * entries', are tried only when the row's own names reach no entry's names. A source with ids joins at
 * most one row to an entry, and when two would, neither does, so a key two rows share on either side
 * joins nothing; but a row reaching the entry by its own names outranks rows reaching it by other keys
 * only. A source without ids joins every row that reaches the entry, those reaching it by their own names
 * judged together and each reaching it by other keys only judged on its own.
 */
const mergeRows = <Row, Entry>(
  sources: Row[][],
  rowOf: { id: (row: Row) => string | undefined, names: (row: Row) => string[], otherKeys: (name: string) => string[] },
  create: (row: Row) => Entry,
  add: (entry: Entry, row: Row, source: number) => void,
  accept: (entry: Entry, rows: Row[]) => boolean,
): Entry[] => {
  const slots: { entry: Entry, ids: Set<string>, keys: Set<string>, others: Set<string> }[] = []
  const keysOf = (rows: Row[]) => new Set(rows.flatMap(rowOf.names).map(nameKey).filter(Boolean))
  const otherKeysOf = (rows: Row[]) => new Set(rows.flatMap(rowOf.names).flatMap(rowOf.otherKeys).filter(Boolean))
  const allKeysOf = (rows: Row[]) => new Set([...keysOf(rows), ...otherKeysOf(rows)])
  sources.forEach((rows, source) => {
    const join = (slot: (typeof slots)[number], row: Row) => {
      const id = rowOf.id(row)
      if (id) slot.ids.add(id)
      for (const key of keysOf([row])) slot.keys.add(key)
      for (const key of otherKeysOf([row])) slot.others.add(key)
      add(slot.entry, row, source)
    }

    // one group per id, so a person AniList lists once per job is one candidate
    const groups: Row[][] = []
    const byId = new Map<string, Row[]>()
    for (const row of rows) {
      const id = rowOf.id(row)
      const known = id ? slots.find(({ ids }) => ids.has(id)) : undefined
      if (known) { join(known, row); continue }
      const group = id ? byId.get(id) : undefined
      if (group) { group.push(row); continue }
      groups.push([row])
      if (id) byId.set(id, groups.at(-1)!)
    }

    const hasIds = rows.some(row => rowOf.id(row))
    const named = new Map<string, number>()
    for (const group of groups) for (const key of allKeysOf(group)) named.set(key, (named.get(key) ?? 0) + 1)
    const reach = (keys: Set<string>, others = false) =>
      slots.filter(slot => [...keys].some(key => (!hasIds || named.get(key) === 1) && (slot.keys.has(key) || (others && slot.others.has(key)))))
    const proposals = new Map<(typeof slots)[number], { group: Row[], own: boolean }[]>()
    for (const group of groups) {
      const own = reach(keysOf(group))
      const targets = own.length ? own : reach(allKeysOf(group), true)
      if (targets.length === 1) proposals.set(targets[0]!, [...proposals.get(targets[0]!) ?? [], { group, own: own.length > 0 }])
    }
    const joined = new Set<Row[]>()
    for (const [slot, offers] of proposals) {
      const matched = (
        hasIds ? (offers.some(({ own }) => own) ? offers.filter(({ own }) => own) : offers)
        : offers.filter(({ own, group }) => own || accept(slot.entry, group))
      ).map(({ group }) => group)
      if (!matched.length || (hasIds && matched.length > 1) || !accept(slot.entry, matched.flat())) continue
      for (const group of matched) {
        for (const row of group) join(slot, row)
        joined.add(group)
      }
    }

    for (const group of groups) {
      if (joined.has(group)) continue
      const slot = { entry: create(group[0]!), ids: new Set<string>(), keys: new Set<string>(), others: new Set<string>() }
      slots.push(slot)
      for (const row of group) join(slot, row)
    }
  })
  return slots.map(({ entry }) => entry)
}

/** Whether a character's drawn cast and another source's share a voice actor, a Japanese one when both list Japanese. */
const sharesActor = (drawn: CreditPerson[], offered: SourceCharacter['voiceActors']): boolean => {
  const japanese = drawn.some(({ language }) => language === 'ja') && offered.some(({ language }) => language === 'ja')
  const known = new Set(drawn.map(({ language, name }) => `${language} ${nameKey(name)}`))
  return offered.some(({ language, person }) => (!japanese || language === 'ja') && known.has(`${language} ${nameKey(person.name)}`))
}

/**
 * One title's characters and staff out of every member's `credits`, or nothing when no member carries
 * any, so only a title opened on its page pays.
 *
 * `members` come in `byScoreThenUri` order, the order every other field reads, and credits that carry
 * their own `score` are read at it: AniList (0.8), MyAnimeList (a 0.9 row, its credits 0.7, so that
 * AniList's names, faces, urls and casts lead and its staff stay in order of relevance, where
 * MyAnimeList's come by job), then Anime News Network (0.2); in live action IMDb, TMDB and TVmaze
 * (0.3), then JustWatch (0.2). Nothing is matched across titles and nothing becomes a graph link, so a
 * wrong rule is a code fix and an `AGGREGATE_VERSION` bump.
 *
 * WHO IS ONE (the owner's decision, 2026-10-12). Rows sharing an id are one entry, inside one source
 * (AniList lists a person once per job) and across sources. Otherwise two characters are one when a
 * `nameKey` of one (AniList's full name and alternatives, ANN's role string) equals one of the other,
 * that key names exactly one character on each side that has ids, and they share a voice actor in one
 * language by `nameKey`, a Japanese one whenever both list Japanese actors. ANN has no character ids,
 * so several of its strings can join one character, one per dub's spelling ("Eren Jaeger" and "Eren
 * Jäger"), judged together, and each string joins at most one. Two staff entries are one when their
 * keys are equal and name exactly one person in each source's list; jobs never decide. A voice actor
 * is never matched on its own: Death Note's Masahiko Kida and ANN's "Anthony Rester" share Masaki
 * Aizawa and are two characters, the actor's other role hidden past AniList's page of 25. No edit
 * distance: "Tsutomu Tareki" and "Tsutomu Taruki" stay two. A refusal draws both: a missed merge,
 * never a wrong one.
 *
 * Two name rules (the owner's decision, 2026-10-12): a suffix after a comma stays a suffix, so IMDb's
 * "Walter White, Jr." meets "Walter White Jr."; and a quoted nickname is another name, for characters
 * and staff alike, so TVmaze's "Michael 'Mike' Ehrmantraut" meets "Mike Ehrmantraut" in either order.
 * Nicknames are tried only when a row's own names reach no entry's names, under the same uniqueness
 * rule, so a nickname never outvotes a name. On Breaking Bad's IMDb, TVmaze and JustWatch credits they
 * turn 15 entries for 12 parts into 12. With TMDB read too, Gus Fring stays two: TMDB's "Gustavo
 * Fring" comes before TVmaze's row, which then joins it by its own name.
 *
 * Names in the other word order: a character's key is also read with its family name at the other
 * end, so AniList's "Dracule Mihawk" meets MyAnimeList's "Dracule, Mihawk" (read "Mihawk Dracule") and
 * ANN's "Boa Hancock" meets "Hancock Boa". It is tried as a nickname is, only when a row's own names
 * reach no entry, and when two rows of a source with ids reach one entry, the one reaching it by its
 * own names joins: MyAnimeList's Hideki Ryuuga reaches Death Note's L through L's alias "Ryuga Hideki"
 * and MyAnimeList's L still joins. In a source without ids, a row reaching an entry only that way joins
 * on an actor of its own, so ANN's idol "Hideki Ryuga" never rides into L on the actor of ANN's "L
 * Lawliet". People keep word order, since only the name joins two staff entries: José Leonardo (born
 * 1973) and Leonardo José (born 1943) are two. On One Piece, Death Note, Cowboy Bebop and Fullmetal
 * Alchemist: Brotherhood with MyAnimeList and ANN it joins 54 more rows, none wrong, and One Piece's
 * names drawn twice by word set go from 102 to 54.
 *
 * Measured over 10 shows (HOR-348, AniList page 1 against ANN): 172 of AniList's 239 characters
 * match ANN's by name, 167 of them sharing an actor; 52 of 54 name matches on Cowboy Bebop,
 * Fullmetal Alchemist: Brotherhood and Frieren pass the whole rule, the other two refused (no actor in
 * common, a Japanese actor spelled two ways). Of the 312 people joined by name that Wikidata can
 * check, 305 agree, 5 are one person under two ANN pages, 1 is a Wikidata id ANN does not know and 1
 * is two live ANN pages read as one; 42 of 42 staff agree.
 *
 * WHAT IS DRAWN. Name, image, url and role come from the first source that has one, so a character
 * only ANN lists has no face and no role. A character's actors in one language come whole from the
 * first source listing any in that language: ANN adds only the dubs neither AniList nor MyAnimeList
 * lists, and two dubs or two spellings of one actor ("Ja-Hyeong Koo" and "Ja-Hyeong Gu") never stack.
 * Characters run MAIN, SUPPORTING, BACKGROUND, then unstated, each in the first source's order, so the
 * ones only ANN lists come last; staff keep that order, with every source's jobs, notes in parentheses
 * dropped.
 *
 * LIVE ACTION. IMDb, TMDB, TVmaze and JustWatch list each actor under the part with a null
 * `language`, so the same rule joins them through the actor on screen and the page draws no language
 * picker. Their casts name no language for an anime either, so beside a source whose characters
 * carry none of those null languages (AniList's, even with no actor listed yet) their characters are
 * left out: they share no actor with AniList's, so each character would be drawn twice.
 */
export const mergeCredits = (members: readonly Member[]): { characters: CreditCharacter[], staff: CreditPerson[] } | undefined => {
  const sources = members
    .flatMap(member => {
      const credits = creditsOf(member)
      return credits ? [{ credits, score: credits.score ?? member.score ?? -1 }] : []
    })
    .sort((a, b) => b.score - a.score)
    .map(({ credits }) => credits)
  if (!sources.length) return undefined

  // `languages` holds, per language, the index of the one source its actors come from
  const unlabelled = (credits: SourceCredits) => credits.characters.some(({ voiceActors }) => voiceActors.some(({ language }) => language === null))
  const cast = sources.some(credits => credits.characters.length && !unlabelled(credits)) ? sources.filter(credits => !unlabelled(credits)) : sources
  const characters = mergeRows(
    cast.map(({ characters }) => characters),
    { id: character => character.id, names: character => character.names, otherKeys: name => [...nicknameKeys(name), reordered(nameKey(name))] },
    (character): { entry: CreditCharacter, languages: Map<string | null, number> } => ({
      entry: { name: character.names[0] ?? '', image: null, url: null, role: null, voiceActors: [] },
      languages: new Map(),
    }),
    ({ entry, languages }, character, source) => {
      entry.image ??= character.image ?? null
      entry.url ??= character.url ?? null
      entry.role ??= character.role ?? null
      for (const { language, person } of character.voiceActors) {
        if ((languages.get(language) ?? source) !== source) continue
        languages.set(language, source)
        if (!entry.voiceActors.some(actor => actor.language === language && actor.name === person.name)) {
          entry.voiceActors.push({ ...personOf(person), language })
        }
      }
    },
    ({ entry }, rows) => sharesActor(entry.voiceActors, rows.flatMap(({ voiceActors }) => voiceActors)),
  )

  const staff = mergeRows(
    sources.map(({ staff }) => staff),
    { id: ({ person }) => person.id, names: ({ person }) => [person.name], otherKeys: nicknameKeys },
    ({ person }): CreditPerson & { roles: string[] } => ({ ...personOf(person), roles: [] }),
    (entry, { person, roles }) => {
      entry.image ??= person.image ?? null
      entry.url ??= person.url ?? null
      for (const job of roles.map(jobOf)) {
        if (job && !entry.roles.some(known => known.toLowerCase() === job.toLowerCase())) entry.roles.push(job)
      }
    },
    () => true,
  )

  return {
    characters: characters.map(({ entry }) => entry).sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    staff,
  }
}
