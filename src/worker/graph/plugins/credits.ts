import type { SourceCredits, SourcePerson } from '../../../sources/credits'

/** A person as `MediaPerson` answers it. */
export type CreditPerson = { name: string, image: string | null, url: string | null, language?: string, roles?: string[] }

/** A character as `MediaCharacter` answers it. */
export type CreditCharacter = {
  name: string
  image: string | null
  url: string | null
  role: string | null
  voiceActors: CreditPerson[]
}

type Member = { uri: string, raw: Record<string, unknown> }

const ROLE_ORDER = ['MAIN', 'SUPPORTING', 'BACKGROUND']
const roleRank = (role: string | null) => (role && ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length)

const creditsOf = (member: Member): SourceCredits | undefined => {
  const credits = member.raw.credits as SourceCredits | undefined
  return credits && Array.isArray(credits.characters) && Array.isArray(credits.staff) ? credits : undefined
}

const personOf = (person: SourcePerson): CreditPerson => ({ name: person.name, image: person.image ?? null, url: person.url ?? null })

const jobOf = (role: string) => role.replace(/\s*\([^)]*\)/g, '').trim()

/**
 * One title's characters and staff out of every member's `credits`, or nothing when no member carries
 * any, so only a title opened on its page pays.
 *
 * `members` come in `byScoreThenUri` order, the order every other field reads. Entries with a shared id
 * are one entry, inside one source (AniList lists a person once per job) and across sources. Name,
 * image, url and role come from the first source that has one; a character's actors in one language
 * come whole from the first source that lists any in that language, so two dubs never stack under one
 * language. Characters are ordered MAIN, SUPPORTING, BACKGROUND, then unstated, each in the order the
 * first source listing them gives; staff keep that order, with every source's jobs, notes in
 * parentheses dropped.
 */
export const mergeCredits = (members: readonly Member[]): { characters: CreditCharacter[], staff: CreditPerson[] } | undefined => {
  const sources = members.flatMap(member => creditsOf(member) ?? [])
  if (!sources.length) return undefined

  // `languages` holds, per language, the index of the one source its actors come from
  const characters: { entry: CreditCharacter, id: string | undefined, languages: Map<string, number> }[] = []
  sources.forEach((credits, source) => {
    for (const character of credits.characters) {
      let found = character.id ? characters.find(({ id }) => id === character.id) : undefined
      if (!found) {
        found = {
          entry: { name: character.names[0] ?? '', image: null, url: null, role: null, voiceActors: [] },
          id: character.id,
          languages: new Map(),
        }
        characters.push(found)
      }
      const { entry, languages } = found
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
    }
  })

  const staff: { entry: CreditPerson & { roles: string[] }, id: string }[] = []
  for (const credits of sources) {
    for (const { person, roles } of credits.staff) {
      let found = staff.find(({ id }) => id === person.id)
      if (!found) {
        found = { entry: { ...personOf(person), roles: [] }, id: person.id }
        staff.push(found)
      }
      found.entry.image ??= person.image ?? null
      found.entry.url ??= person.url ?? null
      for (const job of roles.map(jobOf)) {
        if (job && !found.entry.roles.some(known => known.toLowerCase() === job.toLowerCase())) found.entry.roles.push(job)
      }
    }
  }

  return {
    characters: characters.map(({ entry }) => entry).sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    staff: staff.map(({ entry }) => entry),
  }
}
