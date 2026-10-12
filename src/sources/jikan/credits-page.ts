import { givenFirst, languageCode, type SourceCharacter, type SourceCredits, type SourcePerson } from '../credits'
import { decodeEntities } from '../entities'
import { num, one } from './season-scrape'

// A face is a 42x62 crop under `/r/42x62/`, signed by `?s=`: the plain file is 225x350, as large as
// AniList's, and a character's has no `l` spelling (404). A face nobody added is `questionmark_23.gif`.
const picture = (block: string) => {
  const url = one(block, /data-src="(https:\/\/cdn\.myanimelist\.net\/[^"]+)"/)
  return url && !url.includes('/questionmark') ? url.replace(/\/r\/\d+x\d+\//, '/').replace(/\?.*$/, '') : undefined
}

const personOf = (block: string): SourcePerson | undefined => {
  const [, url, id, name] = /<a href="(https:\/\/myanimelist\.net\/people\/(\d+)\/[^"]*)">([^<]+)<\/a>/.exec(block) ?? []
  return url && id && name ? { id: `mal:${id}`, name: givenFirst(decodeEntities(name).trim()), image: picture(block), url } : undefined
}

const ROLES: Record<string, SourceCharacter['role']> = { Main: 'MAIN', Supporting: 'SUPPORTING' }

const characterOf = (block: string): SourceCharacter | undefined => {
  const [, url, id] = /<a href="(https:\/\/myanimelist\.net\/character\/(\d+)\/[^"]*)">/.exec(block) ?? []
  const name = one(block, /<h3 class="h3_character_name">([^<]+)<\/h3>/)
  if (!url || !id || !name) return undefined
  return {
    id: `mal:${id}`,
    names: [givenFirst(decodeEntities(name).trim())],
    image: picture(block),
    url,
    role: ROLES[one(block, /<div class="spaceit_pad">\s*(\w+)&nbsp;/) ?? ''],
    voiceActors: block.split('class="js-anime-character-va-lang"').slice(1).flatMap(row => {
      const person = personOf(row)
      const language = one(row, /js-anime-character-language"[^>]*>\s*([^<]*?)\s*</)
      return person && language ? [{ language: languageCode(language), person }] : []
    }),
  }
}

/**
 * A title's characters and staff off its myanimelist.net credits page, `/anime/<id>/_/characters`.
 * Names are turned to "Given Family", as every other source writes them, and ids are `mal:` and the
 * page's character or person id. Characters come in order of their favorites, the page's own
 * "Favorites" sort, since it lists them by role and then by name.
 */
export const parseMalCredits = (html: string): SourceCredits => {
  const [cast = '', crew = ''] = html.split('<h2 class="h2_overwrite">Staff</h2>')
  return {
    characters: cast.split('class="js-anime-character-table"').slice(1)
      .map(block => ({ block, favorites: num(one(block, /js-anime-character-favorites"[^>]*>\s*(\d+)/)) ?? 0 }))
      .sort((a, b) => b.favorites - a.favorites)
      .flatMap(({ block }) => characterOf(block) ?? []),
    staff: crew.split('<table').slice(1).flatMap(block => {
      const person = personOf(block)
      const roles = one(block, /<small>([^<]*)<\/small>/)
      return person ? [{ person, roles: roles ? decodeEntities(roles).split(', ') : [] }] : []
    }),
  }
}
