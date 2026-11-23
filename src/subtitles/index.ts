import type { RemoteExternalSubtitleTrack } from '@banou/media-player'

import { fetchAnizipJsonMappings } from '../sources/anizip/extractor'
import { asAggregatedUri, extractAggregatedUriOrigin, fromUri, isAggregatedUri, isUri, matchAggregatedUris } from '../utils/uri'

import { decodeSubtitle } from './decode'
import { languagePreferenceIndex, normalizeSubtitleLanguage } from './languages'
import { fetchOpenSubtitles, type OpenSubtitlesTarget, type SubtitleCandidate } from './opensubtitles'
import { fetchXunleiSubtitles } from './xunlei'

export type { SubtitleCandidate }

export type MediaHandleNodeLike = {
  uri?: string | null
  origin?: string | null
  id?: string | null
  url?: string | null
  handles?: {
    relation?: string | null
    node?: MediaHandleNodeLike | null
  }[] | null
}

export type MediaLike = {
  uri?: string | null
  origin?: string | null
  id?: string | null
  titles?: { title?: string | null }[] | null
  categories?: readonly (string | null)[] | null
  seasons?: readonly { number?: number | null, uri: string }[] | null
  handles?: {
    relation?: string | null
    node?: MediaHandleNodeLike | null
  }[] | null
}

export type EpisodeHandleLike = {
  uri?: string | null
  origin?: string | null
  url?: string | null
  titles?: readonly { title?: string | null }[] | null
  shortDescriptions?: readonly { shortDescription?: string | null }[] | null
}

export type EpisodeLike = {
  episodeNumber?: number | null
  titles?: readonly { title?: string | null }[] | null
}

const IMDB_ID_RE = /^tt\d+$/
const IMDB_URL_RE = /\/title\/(tt\d+)/

function collectHandleNodes(media: MediaLike | undefined | null): MediaHandleNodeLike[] {
  const nodes: MediaHandleNodeLike[] = []
  const seen = new Set<string>()
  const push = (node: MediaHandleNodeLike | null | undefined) => {
    if (!node) return
    const key = node.uri ?? `${node.origin ?? ''}:${node.id ?? ''}`
    if (key && seen.has(key)) return
    if (key) seen.add(key)
    nodes.push(node)
    for (const edge of node.handles ?? []) {
      if (edge?.node) {
        const innerKey = edge.node.uri ?? `${edge.node.origin ?? ''}:${edge.node.id ?? ''}`
        if (innerKey && seen.has(innerKey)) continue
        if (innerKey) seen.add(innerKey)
        nodes.push(edge.node)
      }
    }
  }
  for (const edge of media?.handles ?? []) push(edge?.node)
  return nodes
}

export function extractImdbId(media: MediaLike | undefined | null): string | undefined {
  if (!media) return undefined
  if (media.uri) {
    const fromAgg = extractAggregatedUriOrigin(media.uri, 'imdb')?.id
    if (fromAgg && IMDB_ID_RE.test(fromAgg)) return fromAgg
  }
  if (media.origin === 'imdb' && media.id && IMDB_ID_RE.test(media.id)) return media.id

  for (const node of collectHandleNodes(media)) {
    const origin = node.origin ?? (node.uri?.includes(':') ? fromUri(node.uri as `${string}:${string}`).origin : undefined)
    const id = node.id ?? (node.uri?.includes(':') ? fromUri(node.uri as `${string}:${string}`).id : undefined)
    if (origin === 'imdb' && id && IMDB_ID_RE.test(id)) return id
    const urlMatch = node.url ? IMDB_URL_RE.exec(node.url) : null
    if (urlMatch?.[1]) return urlMatch[1]
  }
  return undefined
}

export function extractAniId(
  media: MediaLike | undefined | null,
): { providerId: 'anilist' | 'mal' | 'anidb', id: string } | undefined {
  if (!media) return undefined
  const providers: ('anilist' | 'mal' | 'anidb')[] = ['anilist', 'mal', 'anidb']

  if (media.uri) {
    for (const providerId of providers) {
      const id = extractAggregatedUriOrigin(media.uri, providerId)?.id
      if (id && /^\d+$/.test(id)) return { providerId, id }
    }
  }

  const nodes = collectHandleNodes(media)
  for (const providerId of providers) {
    if (media.origin === providerId && media.id && /^\d+$/.test(media.id)) {
      return { providerId, id: media.id }
    }
    for (const node of nodes) {
      const origin = node.origin ?? (node.uri?.includes(':') ? fromUri(node.uri as `${string}:${string}`).origin : undefined)
      const id = node.id ?? (node.uri?.includes(':') ? fromUri(node.uri as `${string}:${string}`).id : undefined)
      if (origin === providerId && id && /^\d+$/.test(id)) {
        return { providerId, id }
      }
    }
  }
  return undefined
}

function comparableAggregatedUri(uri: string) {
  const candidate = asAggregatedUri(uri)
  return isAggregatedUri(candidate) ? candidate : undefined
}

export function extractSeasonNumber(media: MediaLike | undefined | null): number {
  if (!media) return 1
  if (media.uri && media.seasons?.length) {
    const mediaTarget = comparableAggregatedUri(media.uri)
    for (const season of media.seasons) {
      if (typeof season.number === 'number' && Number.isFinite(season.number) && season.number >= 0) {
        const seasonTarget = comparableAggregatedUri(season.uri)
        if (season.uri === media.uri || (seasonTarget && mediaTarget && matchAggregatedUris(seasonTarget, mediaTarget))) {
          return season.number
        }
      }
    }
  }
  return 1
}

function magnetDisplayName(url: string | undefined | null): string | undefined {
  if (!url?.startsWith('magnet:')) return undefined
  try {
    const query = url.slice(url.indexOf('?') + 1)
    const dn = new URLSearchParams(query).get('dn')
    return dn?.trim() || undefined
  } catch {
    return undefined
  }
}

export function extractReleaseName(
  selected: EpisodeHandleLike | undefined | null,
  episode: EpisodeLike | undefined | null,
): string | undefined {
  const fromShort = selected?.shortDescriptions?.at(0)?.shortDescription?.trim()
  if (fromShort) return fromShort
  const fromSelectedTitle = selected?.titles?.at(0)?.title?.trim()
  if (fromSelectedTitle) return fromSelectedTitle
  const fromMagnet = magnetDisplayName(selected?.url)
  if (fromMagnet) return fromMagnet
  const fromEpisodeTitle = episode?.titles?.at(0)?.title?.trim()
  if (fromEpisodeTitle) return fromEpisodeTitle
  return undefined
}

function buildXunleiQuery(options: {
  title?: string
  releaseName?: string
  film?: boolean
  season?: number
  episode?: number
}): string | undefined {
  const release = options.releaseName?.trim()
  const title = options.title?.trim()
  // Only rely on releaseName alone when it looks descriptive enough (more than a resolution/generic stub).
  if (release && !/^(?:episode\s*\d+|\d+p|hevc|x26[45])$/i.test(release) && release.length >= 6) {
    return release
  }
  if (!title) return release
  if (options.film) return title
  if (options.episode !== undefined && Number.isInteger(options.episode)) {
    const seasonStr = String(options.season ?? 1).padStart(2, '0')
    const episodeStr = String(options.episode).padStart(2, '0')
    return `${title} S${seasonStr}E${episodeStr}`
  }
  return title
}

export function toRemoteExternalTracks(candidates: readonly SubtitleCandidate[]): RemoteExternalSubtitleTrack[] {
  return candidates.map(({ id, language, label, format }) => ({ id, language, label, format }))
}

export type ExternalSubtitleBundle = {
  tracks: RemoteExternalSubtitleTrack[]
  load: (trackId: string) => Promise<string>
}

export async function fetchExternalSubtitles(options: {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  imdbId?: string
  aniId?: { providerId: 'anilist' | 'mal' | 'anidb', id: string }
  isAnime?: boolean
  film?: boolean
  season?: number
  episode?: number
  title?: string
  releaseName?: string
  preferredLanguages?: readonly string[]
  locale?: string
  signal?: AbortSignal
}): Promise<ExternalSubtitleBundle> {
  const preferred = (options.preferredLanguages ?? [])
    .map(lang => normalizeSubtitleLanguage(lang))
    .filter(lang => lang !== 'und')

  let imdbId = options.imdbId
  if (!imdbId && options.aniId && (options.isAnime ?? true)) {
    try {
      const mapped = await fetchAnizipJsonMappings(options.aniId.providerId, options.aniId.id, {
        fetch: input => options.fetch(String(input), { signal: options.signal }),
      })
      const candidateImdb = mapped?.mappings?.imdb_id
      if (candidateImdb && IMDB_ID_RE.test(candidateImdb)) {
        imdbId = candidateImdb
      }
    } catch {
      // AniZip lookup failure only omits IMDb fallback; Xunlei search still proceeds.
    }
  }

  let openTarget: OpenSubtitlesTarget | undefined
  if (imdbId) {
    if (options.film) {
      openTarget = { kind: 'movie', imdbId }
    } else if (options.episode !== undefined && Number.isInteger(options.episode) && options.episode >= 0) {
      openTarget = {
        kind: 'series',
        imdbId,
        season: options.season ?? 1,
        episode: options.episode,
      }
    }
  }

  const xunleiQuery = buildXunleiQuery({
    title: options.title,
    releaseName: options.releaseName,
    film: options.film,
    season: options.season,
    episode: options.episode,
  })

  const [openTracks, xunleiTracks] = await Promise.all([
    openTarget
      ? fetchOpenSubtitles(openTarget, {
        fetch: options.fetch,
        preferredLanguages: preferred,
        releaseName: options.releaseName,
        locale: options.locale,
        signal: options.signal,
      })
      : Promise.resolve([]),
    xunleiQuery
      ? fetchXunleiSubtitles(xunleiQuery, {
        fetch: options.fetch,
        preferredLanguages: preferred,
        locale: options.locale,
        signal: options.signal,
      })
      : Promise.resolve([]),
  ])

  const candidates = [...openTracks, ...xunleiTracks].sort(
    (a, b) => languagePreferenceIndex(a.language, preferred) - languagePreferenceIndex(b.language, preferred),
  )
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const cache = new Map<string, Promise<string>>()

  const load = (trackId: string): Promise<string> => {
    const existing = cache.get(trackId)
    if (existing) return existing
    const candidate = byId.get(trackId)
    if (!candidate) return Promise.reject(new Error(`Unknown external subtitle track: ${trackId}`))

    const pending = (async () => {
      const response = await options.fetch(candidate.url, { signal: options.signal })
      if (!response.ok) throw new Error(`Failed to fetch subtitle (${response.status})`)
      const buffer = await response.arrayBuffer()
      return decodeSubtitle(new Uint8Array(buffer), candidate.language)
    })()

    const guarded = pending.catch(err => {
      cache.delete(trackId)
      throw err
    })
    cache.set(trackId, guarded)
    return guarded
  }

  return {
    tracks: toRemoteExternalTracks(candidates),
    load,
  }
}
