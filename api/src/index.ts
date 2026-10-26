import type { Media } from '../../src/generated/schema/types.generated'
import type { Site } from '../../src/site'
import type { Entry, Store } from './store'

import { siteAsks } from '../../src/site'
import { getMedia, origin as offline } from '../../src/sources/offline/extractor'
import { fromAggregatedUri, routeMediaUri, toAggregatedUri, type AggregatedUri, type Uri } from '../../src/utils/uri'
import { stubOrigin } from './access'
import { readStore } from './store'

/** The Worker's bindings, as api/wrangler.jsonc names them. */
export type Env = {
  STORE: Store
  LIMIT: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
}

const MEDIA_PATH = /^\/v1\/media\/([^/]+)$/
const SITES: readonly string[] = ['anime', 'movie', 'series', 'stub'] satisfies Site[]
const CACHE = 'public, max-age=3600'

// as the link preview's offline answer (src/preview): a record with no cover is one a preview runs the sources for,
// and the store is where what that run settled on would be found
const entryOf = (media: Media): Entry | undefined => {
  const title = media.titles.at(0)?.title
  const cover = media.covers.at(0)?.url
  if (!title || !cover) return undefined
  return {
    uri: toAggregatedUri([media.uri, ...media.handles.map(handle => handle.node.uri)] as Uri[]),
    title,
    description: media.descriptions.map(({ description }) => description).sort((a, b) => b.length - a.length).at(0),
    cover,
    banner: media.banners.at(0)?.url,
    color: media.covers.find(({ color }) => color)?.color ?? undefined,
  }
}

const fromHistory = async (uri: string, site: Site) => {
  if (!siteAsks(offline, site)) return undefined
  const media = await getMedia(uri)
  return media ? entryOf(media) : undefined
}

const lookup = async (segment: string, site: Site, store: Store) => {
  let uri: string
  // `isUri` throws on an id holding a comma
  try {
    uri = routeMediaUri(segment)
  } catch {
    return undefined
  }
  const ids = fromAggregatedUri(uri as AggregatedUri)?.handleUrisValues
  if (!ids?.length) return undefined
  const history = await fromHistory(uri, site)
  if (history) return { ...history, from: 'history' as const }
  const stored = await readStore(store, site, ids)
  return stored && { ...stored, from: 'store' as const }
}

/**
 * `GET /v1/media/<address>?site=anime|movie|series|stub` (`stub` when absent): what stub draws of a show, for stub's own
 * pages only, from the offline history the build bundles, else from the store. Never runs a source. `200` with the
 * answer (`{ uri, title, description?, cover?, banner?, color?, from: 'history' | 'store' }`), `404` when
 * neither holds the address, `403` for any origin but stub's (./access.ts), `429` past the route's rate limit, which
 * is keyed by the route alone. Reads no header but `Origin` and `Referer`, and logs nothing.
 *
 * `GET /health`: `ok`.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok', { headers: { 'cache-control': 'no-store' } })
    const segment = MEDIA_PATH.exec(url.pathname)?.[1]
    if (request.method !== 'GET' || !segment) return new Response(null, { status: 404 })
    const origin = stubOrigin(request)
    if (!origin) return new Response(null, { status: 403, headers: { vary: 'origin' } })
    const cors = { 'access-control-allow-origin': origin, vary: 'origin' }
    if (!(await env.LIMIT.limit({ key: 'media' })).success) return new Response(null, { status: 429, headers: cors })
    const site = url.searchParams.get('site') ?? 'stub'
    const answer = SITES.includes(site) ? await lookup(segment, site as Site, env.STORE) : undefined
    const headers = { ...cors, 'cache-control': CACHE }
    return answer ? Response.json(answer, { headers }) : new Response(null, { status: 404, headers })
  },
}
