// How a JustWatch result is identified. Split out of extractor.ts so it can be tested: that module
// imports the crunchyroll extractor and the source barrel, which cannot be loaded outside a browser.
//
// JustWatch has no season-level node. 'ts222366' is Mushoku Tensei entire, seasons 1 through 3 hanging
// off one id, and its provider deep links are show-level too (a hulu.com/series/<uuid> url names the
// show). Stub has no notion of a show - every media here is ONE season - so a show-level id lands on
// all of them and union-finds them into a single media. That was visible three ways: picking season 2
// out of search opened season 3, an aggregated uri carried two anilist ids and two mal ids at once,
// and two unrelated shows merged once a shared handle bridged their clusters.
//
// So the rule is absolute: a series media is `<node>-<season>`, never the bare node id.
//
// The suffix is the SEASON'S OWN objectId, not its ordinal. JustWatch gives every season one
// (Mushoku Tensei is 222366 with seasons 230388, 378206, 490814), so this is a real id in their space
// rather than a position in a list - it does not move when a season is renumbered, split into cours,
// or has a recap inserted ahead of it, all of which happen and all of which would otherwise silently
// repoint an existing uri at different episodes.

/** A JustWatch node id scoped to one season. This is the only id shape a series media may carry. */
export const jwId = (objectId: string | number, seasonObjectId: string | number) => `${objectId}-${seasonObjectId}`

/** Reverse of jwId: the node to ask JustWatch for, and the season the uri pinned. */
export const splitJwId = (id: string): { objectId: string, seasonObjectId?: number } => {
  const match = /^(\d+)-(\d+)$/.exec(id)
  return match ? { objectId: match[1]!, seasonObjectId: Number(match[2]) } : { objectId: id }
}

/**
 * Whether this node needs a season before it can become a media.
 *
 * A movie has no seasons to be confused between, so its bare node id identifies it exactly. Anything
 * else is a series, and a series without a season number is precisely the id that merges every season
 * of the show together.
 */
export const showRequiresSeason = (objectType: string | undefined) => objectType !== 'MOVIE'

/**
 * The id a provider handle carries, or undefined when it cannot be given one worth minting.
 *
 * The id is the provider's TITLE, whatever season the offer was read on. Until 2026-09-05 a season
 * suffix wrote JUSTWATCH'S season number into the provider's id space (`nf:80123-2`,
 * `appletv:<umc>-s2`), where unogs and the appletv source mint the same shapes with the PROVIDER'S
 * numbering, and the two numberings do not agree: Netflix folds two anime cours into one season, so
 * its season 2 and JustWatch's season 2 name different runs under one uri, and `graph.link` has no
 * inverse. A show-level offer is therefore a container (`buildOffersAsHandles` hangs the run under it
 * as PART_OF), and the precise run comes from `similarMedia`, asked of the provider's own source on
 * the run's page with evidence about the run. A film's bare id is exact and stays an identity.
 *
 * Crunchyroll is refused OUTRIGHT. `extractContentId` reads a crunchyroll id from one url shape only,
 * `/series/<id>`, so every id that reaches here is a SERIES id: it names a container that holds every
 * run of the show and, on Crunchyroll, the show's FILMS too, since a film belonging to a running series
 * is published under the series. The extractor demotes that id to PART_OF itself; a film whose offer
 * was a /series/ url used to take the bare container id, the same weld measured on kitsu 2026-09-04,
 * where four Demon Slayer films and fifteen Dragon Ball Z films each shared one /series/ id.
 *
 * The extractor's episode-resolving path is where a real crunchyroll handle still comes from, and it
 * has its own reason to refuse a pinned season. See `buildOffersAsHandles`.
 */
export const providerContentId = (mappedOrigin: string, rawContentId: string): string | undefined =>
  mappedOrigin === 'cr' ? undefined : rawContentId

// JustWatch package shortName to stub origin. A package is a TIER, not a service, so one service can
// hold several of them: Paramount+ sells Essential and Premium separately, Netflix lists its ad tier
// apart from its main one, Peacock lists Premium apart from Premium Plus. Every tier of one service
// serves the same urls, so they all map to one origin and the extra handle they mint is the same uri.
//
// `hbm` and `pmp` used to sit here and returned ZERO offers, because both services renamed: HBO Max is
// `mxx` and Paramount+ split into `ppp` and `ppe`. Offers on those two platforms were therefore
// dropped for every title, which is why the hbo and paramount sources saw nothing from JustWatch.
// Measured 2026-09-01 over 25 anime searches: mxx 15 offers, ppp 9, ppe 9, and nfa 38 against nfx's 40.
//
// Resale channels are deliberately absent. "Crunchyroll Amazon Channel" (`cra`) outnumbers `cru`
// itself, but its url is watch.amazon.com, so its id belongs to Amazon; mapping it to `cr` would mint
// a Crunchyroll handle out of an Amazon id and assert an identity that no Crunchyroll call reproduces.
export const PACKAGE_ORIGIN_MAP: Record<string, string> = {
  cru: 'cr', nfx: 'nf', nfa: 'nf', dnp: 'disney', amp: 'amazon', atp: 'appletv',
  hlu: 'hulu', mxx: 'hbo', pcp: 'peacock', pct: 'peacock',
  ppp: 'paramount', ppe: 'paramount', fuv: 'fubo'
}

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * The provider's own id for a title, read out of the deep link the offer carries.
 *
 * Every branch here is measured against a real offer url rather than assumed, because a provider that
 * restyles its site does not break this loudly: the id simply changes shape, and the handle minted
 * from it either clusters nothing or, worse, is a path segment shared by every title on that service.
 *
 * Measured 2026-09-01 across 50 searches. Four of the nine mapped services had moved: Prime Video to
 * watch.amazon.com with the id in a query param, Disney+ to /browse/entity-<uuid>, fubo to
 * /welcome/series/<id>, and HBO Max to /video/watch/<uuid> for a series. That last one is the reason
 * for the shape tests rather than a fixed index: `parts[1]` of an HBO series url is the literal string
 * "watch", which handed 22 unrelated titles the identical `hbo:watch` handle. A handle is a union with
 * no inverse, so that is 22 shows merged into one cluster, permanently, for the session.
 */
export const extractContentId = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace('www.', '')
    const parts = parsed.pathname.split('/').filter(Boolean)

    // `/title/<id>` and `/watch/<id>`, behind a locale on a regional link (`/be-en/title/<id>`)
    if (host === 'netflix.com') {
      const kind = parts.findIndex(part => part === 'title' || part === 'watch')
      return kind === -1 ? undefined : parts[kind + 1]
    }
    if (host === 'crunchyroll.com' && parts[0] === 'series') return parts[1]

    // Prime Video offers now land on watch.amazon.com/detail?gti=<id>, where the id is not in the path
    // at all. Falling back to the last path segment there would return the literal "detail".
    if (host.startsWith('amazon.') || host.endsWith('.amazon.com')) {
      return parsed.searchParams.get('gti') ?? (host.startsWith('amazon.') ? parts.at(-1) : undefined)
    }

    if (host === 'hulu.com') {
      const last = parts.at(-1)
      return last?.match(UUID_AT_END)?.[1] ?? last
    }

    // tv.apple.com names a title twice, as a human slug and as a umc.cmc id, and only the umc id is
    // what the appletv source itself mints. An episode url carries its SHOW's umc id in `showId`,
    // which is the one worth having. The slug is never used: episode slugs repeat across shows.
    if (host === 'tv.apple.com') {
      return parsed.searchParams.get('showId') ?? parts.find(part => part.startsWith('umc.'))
    }

    // /browse/entity-<uuid> and /play/<uuid> today, /<locale>/series/<slug>/<id> before that
    if (host === 'disneyplus.com') {
      const entity = parts.find(part => part.startsWith('entity-'))
      if (entity) return entity.slice('entity-'.length)
      return parts[0] === 'play' ? parts[1] : parts[2]
    }

    // a series url names the SHOW at index 4 and continues into a season and an episode, so the last
    // segment is an episode id; a movie url ends on the movie's own id
    if (host === 'peacocktv.com') return parts[2] === 'tv' ? parts[4] : parts.at(-1)

    if (host === 'paramountplus.com') return parts[1]

    // /welcome/series/<id>/<slug> and /welcome/program/<id>
    if (host === 'fubo.tv') return parts[0] === 'welcome' ? parts[2] : undefined

    // /show/<uuid> for a title, /video/watch/<uuid> for an episode of one
    if (host === 'play.hbomax.com') return parts[0] === 'video' ? parts[2] : parts[1]

    // the regional site, /<country>/<language>/movies/<slug>/<uuid>, ends on the title's uuid
    if (host === 'hbomax.com') return parts.at(-1)?.match(UUID_AT_END)?.[1]
  } catch {}
  return undefined
}
