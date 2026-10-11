// What a source writes under `credits` in its own media row, read by `mergeCredits`
// (worker/graph/plugins/credits.ts). The key is `credits` rather than the GraphQL field names, so a
// handle node that kept it answers `characters` null rather than a malformed list.

export type SourcePerson = { id: string, name: string, image?: string, url?: string }

export type SourceCharacter = {
  /** The source's own id, `anilist:1`. */
  id?: string
  /** The full name first, then the alternatives. */
  names: string[]
  image?: string
  url?: string
  role?: 'MAIN' | 'SUPPORTING' | 'BACKGROUND'
  /** `language` is a `languageCode`, or null for live action, where an actor plays the part on screen. */
  voiceActors: { language: string | null, person: SourcePerson }[]
}

export type SourceCredits = {
  characters: SourceCharacter[]
  staff: { person: SourcePerson, roles: string[] }[]
}

/**
 * One character per part name, its actors in source order: for a source with no character ids. A part
 * that names no character ("Self", "Himself") is left out, since it would stack every such person
 * under one card.
 */
export const charactersByName = (parts: { name: string, language: string | null, person: SourcePerson }[]): SourceCharacter[] => {
  const characters = new Map<string, SourceCharacter>()
  for (const { name, language, person } of parts) {
    if (/^(self|himself|herself|themselves)\b/i.test(name)) continue
    const character = characters.get(name) ?? characters.set(name, { names: [name], voiceActors: [] }).get(name)!
    character.voiceActors.push({ language, person })
  }
  return [...characters.values()]
}

const LANGUAGES: Record<string, string> = {
  arabic: 'ar',
  catalan: 'ca',
  chinese: 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  filipino: 'fil',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  malay: 'ms',
  malaysian: 'ms',
  mandarin: 'zh',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swedish: 'sv',
  tagalog: 'tl',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
}

/**
 * A voice actor's language as a primary subtag, whatever the source wrote: AniList's "Japanese",
 * Kitsu's `ja_jp` and Anime News Network's `JA` are all `ja`. A word that is neither a known language
 * nor a code is kept as written.
 */
export const languageCode = (language: string): string => {
  const word = language.trim().toLowerCase()
  return LANGUAGES[word] ?? word.match(/^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/)?.[1] ?? language
}
