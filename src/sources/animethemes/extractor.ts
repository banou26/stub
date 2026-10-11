import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, MediaTheme } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin } from '../../utils/uri'
import { makeMedia } from '../utils'

export const icon = 'https://animethemes.moe/favicon-32x32.png'
export const originUrl = 'https://animethemes.moe'
export const categories = ['ANIME'] as const
export const name = 'AnimeThemes'
export const origin = 'animethemes'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['mal', 'anilist']

// GraphQL, since the JSON:API is deprecated (api-docs.animethemes.moe/intro). 90 requests a minute per
// address, and the depth limit is 13, which this stays well under.
const QUERY = `
  query ($site: ResourceSite!, $id: Int!) {
    findAnimeByExternalSite(site: $site, id: [$id]) {
      id
      slug
      animethemes {
        type
        sequence
        song {
          title {
            romaji
            native
          }
          performances {
            artist {
              name {
                main
              }
            }
          }
        }
        animethemeentries {
          videos {
            nodes {
              link
            }
          }
        }
      }
    }
  }
`

export type AnimeThemesAnime = {
  id: number
  slug: string
  animethemes: {
    type: string
    sequence?: number | null
    song?: { title?: { romaji?: string | null, native?: string | null } | null, performances?: { artist: { name: { main: string } } }[] | null } | null
    animethemeentries: { videos: { nodes: { link: string }[] } }[]
  }[]
}

const KINDS = ['OP', 'ED', 'IN']

const SITES: Record<string, string> = { mal: 'MAL', anilist: 'ANILIST' }

/** Openings, then endings, then inserts, each by number, an unnumbered one read as a first. */
export const normalizeThemes = (anime: AnimeThemesAnime): MediaTheme[] =>
  anime.animethemes
    .map(theme => ({
      kind: theme.type,
      sequence: theme.sequence ?? null,
      title: theme.song?.title?.romaji ?? theme.song?.title?.native ?? null,
      // a group comes once per member it credits: Aqours nine times on Love Live! Sunshine!!'s opening (2026-10-12)
      artists: [...new Set(theme.song?.performances?.map(({ artist }) => artist.name.main))],
      video: theme.animethemeentries.flatMap(entry => entry.videos.nodes)[0]?.link ?? null,
    }))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.sequence ?? 1) - (b.sequence ?? 1))

/**
 * An enricher: asked with the MyAnimeList id the title already carries (AniList's when it has none),
 * it names back only that id and none of the other ids AnimeThemes lists, so it adds no id to a title.
 */
const fetchThemes = async (asked: { origin: string, id: string }, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  try {
    const response = await ctx.fetch('https://graphql.animethemes.moe/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { site: SITES[asked.origin], id: Number(asked.id) } }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json() as { data?: { findAnimeByExternalSite?: AnimeThemesAnime[] } }
    const anime = body.data?.findAnimeByExternalSite?.[0]
    if (!anime) return null
    return makeMedia({
      origin,
      id: String(anime.id),
      url: `https://animethemes.moe/anime/${anime.slug}`,
      handles: [makeMedia(asked)],
      themes: normalizeThemes(anime),
    })
  } catch (error) {
    console.error(`AnimeThemes ${asked.origin}:${asked.id} failed`, error)
    return null
  }
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      // only the title page asks `details`, so the modal and the listing never wait on this
      subscribe: async function*(_, { input: { uri, details } }, ctx: ExtractorServerContext) {
        const asked = details && uri ? extractAggregatedUriOrigin(uri, 'mal') ?? extractAggregatedUriOrigin(uri, 'anilist') : undefined
        yield { media: asked ? await fetchThemes(asked, ctx) : null }
      }
    }
  }
}
