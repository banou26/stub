type Person = { name: string, image?: string | null, url?: string | null, language?: string | null }
type Character = { name: string, image?: string | null, url?: string | null, role?: string | null, voiceActors: readonly Person[] }

/**
 * The languages the picker offers, Japanese first and selected, then the others by how many characters
 * each voices; with no Japanese, the language that voices the most is selected. No options under two
 * languages, so no picker is drawn.
 */
export const creditLanguages = (characters: readonly Character[]): { options: string[], selected: string | undefined } => {
  const counts = new Map<string, number>()
  for (const character of characters) {
    for (const language of new Set(character.voiceActors.map(actor => actor.language).filter((language): language is string => Boolean(language)))) {
      counts.set(language, (counts.get(language) ?? 0) + 1)
    }
  }
  const languages = [...counts.keys()].sort((a, b) =>
    Number(b === 'ja') - Number(a === 'ja') || counts.get(b)! - counts.get(a)! || a.localeCompare(b))
  return { options: languages.length < 2 ? [] : languages, selected: languages[0] }
}

/**
 * Every character, each with only its actors in `language`; one with none there keeps its card. With no
 * language, the actors that name none: live action's.
 */
export const castIn = <T extends Character>(characters: readonly T[], language: string | undefined): (T & { actors: T['voiceActors'][number][] })[] =>
  characters.map(character => ({ ...character, actors: character.voiceActors.filter(actor => (actor.language ?? undefined) === language) }))

const ROLES: Record<string, string> = { MAIN: 'Main', SUPPORTING: 'Supporting', BACKGROUND: 'Background' }

export const roleLabel = (role: string | null | undefined): string | undefined => (role ? ROLES[role] ?? role : undefined)

const names = new Intl.DisplayNames(['en'], { type: 'language' })

/** A language code's English name, or the source's own word when it is not a code. */
export const languageLabel = (language: string): string =>
  /^[a-z]{2,3}$/.test(language) ? names.of(language) ?? language : language
