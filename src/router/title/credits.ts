import type { MessageDescriptor } from 'react-intl'

import { defineMessages } from 'react-intl'

import { intl } from '../../i18n'

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

const ROLES: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  MAIN: { id: 'Main#character role', defaultMessage: 'Main', description: 'character role' },
  SUPPORTING: { id: 'Supporting#character role', defaultMessage: 'Supporting', description: 'character role' },
  BACKGROUND: { id: 'Background#character role', defaultMessage: 'Background', description: 'character role' },
})

export const roleLabel = (role: string | null | undefined): string | undefined =>
  !role ? undefined : ROLES[role] ? intl.formatMessage(ROLES[role]) : role

/** A language code's name in the language shown, as a menu entry, or the source's own word when it is not a code. */
export const languageLabel = (language: string): string => {
  const name = /^[a-z]{2,3}$/.test(language) ? intl.formatDisplayName(language, { type: 'language' }) ?? language : language
  // Intl.DisplayNames writes a name as inside a sentence (French japonais, Russian японский), where CLDR capitalizes a
  // menu's entry; a code it has no name for stays as given
  return name === language ? name : name.charAt(0).toLocaleUpperCase(intl.locale) + name.slice(1)
}
