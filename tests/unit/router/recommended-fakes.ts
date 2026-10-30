import type { Pick } from '../../../src/router/home/recommended'
import type { FranchisePick } from '../../../src/sources/anilist/franchise'

import ANSWERS from './__fixtures__/anilist-recommended-2026-10-31.json'

type Media = FranchisePick & { recommendations: { nodes: { rating: number, mediaRecommendation: Pick }[] } }

/** AniList's answer to the row's own query for each of five seeds alone, by seed (2026-10-31). */
export const RECOMMENDED = ANSWERS as unknown as Record<number, Media>

/**
 * graphql.anilist.co as it answered on 2026-10-31, over RECOMMENDED: an `id_in` page holds the seeds it has and leaves
 * out the others, while a document of one aliased `Media` a seed fails whole, 404 with every alias null, when one names
 * a seed it does not have. Every other answer is `status`, with no data.
 */
export const fakeAnilist = ({ status = 200 } = {}) => {
  const asked: { url: string, credentials?: RequestCredentials, ids?: number[] }[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { query, variables } = JSON.parse(init?.body as string) as { query: string, variables?: { ids?: number[] } }
    asked.push({ url: input instanceof Request ? input.url : input.toString(), credentials: init?.credentials, ids: variables?.ids })
    if (status !== 200) return new Response(JSON.stringify({ errors: [{ message: 'Too Many Requests.', status }], data: null }), { status })
    if (query.includes('id_in') && variables?.ids) {
      return Response.json({ data: { Page: { media: variables.ids.flatMap(id => RECOMMENDED[id] ? [RECOMMENDED[id]] : []) } } })
    }
    const aliases = [...query.matchAll(/(\w+): Media\(id: (\d+)/g)].map(([, alias, id]) => [alias!, RECOMMENDED[Number(id)]] as const)
    return aliases.some(([, media]) => !media)
      ? new Response(JSON.stringify({ errors: [{ message: 'Not Found.', status: 404 }], data: Object.fromEntries(aliases.map(([alias]) => [alias, null])) }), { status: 404 })
      : Response.json({ data: Object.fromEntries(aliases) })
  }
  return { fetch, asked }
}
