import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin } from '../../utils/uri'
import { charactersByName, languageCode, type SourceCredits } from '../credits'
import { decodeEntities } from '../entities'
import { makeMedia } from '../utils'

export const icon = 'https://www.animenewsnetwork.com/favicon.ico'
export const originUrl = 'https://www.animenewsnetwork.com'
export const categories = ['ANIME'] as const
export const name = 'Anime News Network'
export const origin = 'ann'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['ann']

// below every source that names a title, as JustWatch and Apple TV are: it only adds credits
const SCORE = 0.2

const ENCYCLOPEDIA = 'https://www.animenewsnetwork.com/encyclopedia'

const CAST = /<cast\b[^>]*\blang="([^"]+)"[^>]*>\s*<role>([^<]*)<\/role>\s*<person id="(\d+)">([^<]*)<\/person>/g
const STAFF = /<staff\b[^>]*>\s*<task>([^<]*)<\/task>\s*<person id="(\d+)">([^<]*)<\/person>/g

const personOf = (id: string, name: string) =>
  ({ id: `${origin}:${id}`, name: decodeEntities(name), url: `${ENCYCLOPEDIA}/people.php?id=${id}` })

/**
 * One title's credits out of ANN's encyclopedia XML: a character per role string, as ANN has no
 * character ids, and a staff entry per person id with every task.
 */
export const parseCredits = (xml: string): SourceCredits => {
  const characters = charactersByName([...xml.matchAll(CAST)].map(([, lang, role, id, person]) =>
    ({ name: decodeEntities(role!), language: languageCode(lang!), person: personOf(id!, person!) })))
  const staff = new Map<string, SourceCredits['staff'][number]>()
  for (const [, task, id, person] of xml.matchAll(STAFF)) {
    const entry = staff.get(id!) ?? staff.set(id!, { person: personOf(id!, person!), roles: [] }).get(id!)!
    entry.roles.push(decodeEntities(task!))
  }
  return { characters, staff: [...staff.values()] }
}

// One title per request: ANN delays anything over its own limit rather than refusing it
const fetchCredits = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  try {
    const response = await ctx.fetch(`https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=${id}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const xml = await response.text()
    // an unknown id answers 200 with `<ann><warning>no result for anime=…</warning></ann>`
    if (!xml.includes(`<anime id="${id}"`)) return null
    const fields = { url: `${ENCYCLOPEDIA}/anime.php?id=${id}`, score: SCORE, credits: parseCredits(xml) }
    return makeMedia({ origin, id, ...fields })
  } catch (error) {
    console.error(`Anime News Network ${id} failed`, error)
    return null
  }
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      // only the title page asks `details`, so the modal and the listing never wait on this
      subscribe: async function*(_, { input: { uri, details } }, ctx: ExtractorServerContext) {
        const asked = details && uri ? extractAggregatedUriOrigin(uri, origin) : undefined
        yield { media: asked ? await fetchCredits(asked.id, ctx) : null }
      }
    }
  }
}
