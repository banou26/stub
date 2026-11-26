import type { RemoteExternalSubtitleTrack } from '@banou/media-player'
import type { SubtitleQueryContext } from '../plugin-api'

import { fetchAnizipJsonMappings } from '../sources/anizip/extractor'
import { asAggregatedUri, extractAggregatedUriOrigin, fromUri, isAggregatedUri, isUri, matchAggregatedUris } from '../utils/uri'

import { decodeSubtitle } from './decode'
import { languagePreferenceIndex, normalizeSubtitleLanguage, subtitleLanguageLabel } from './languages'
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

export function extractReleaseName(
  selected: EpisodeHandleLike | undefined | null,
  episode: EpisodeLike | undefined | null,
): string | undefined {
  const fromShort = selected?.shortDescriptions?.at(0)?.shortDescription?.trim()
  if (fromShort) return fromShort
  const fromSelectedTitle = selected?.titles?.at(0)?.title?.trim()
  if (fromSelectedTitle) return fromSelectedTitle
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
  return candidates.map(({ id, language, label, format }) => ({
    id,
    language,
    label,
    format,
  }))
}

export type ExternalSubtitleBundle = {
  tracks: RemoteExternalSubtitleTrack[]
  candidates?: SubtitleCandidate[]
  load: (trackId: string) => Promise<string>
}

export type ExternalSubtitleQueryOptions = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  mediaUri?: string
  episodeUri?: string
  imdbId?: string
  aniId?: { providerId: 'anilist' | 'mal' | 'anidb', id: string }
  isAnime?: boolean
  film?: boolean
  season?: number
  episode?: number
  title?: string
  releaseName?: string
  query?: string
  preferredLanguages?: readonly string[]
  locale?: string
  signal?: AbortSignal
  findPluginSubtitles?: (context: SubtitleQueryContext) => Promise<SubtitleCandidate[]>
  loadPluginSubtitle?: (origin: string, remoteTrackId: string) => Promise<string>
  fetchOpenCandidates?: () => Promise<SubtitleCandidate[]>
  onImdbResolved?: (imdbId: string | undefined) => void
}

const PLUGIN_PER_LANG_LIMIT = 2
const PLUGIN_TOTAL_LIMIT = 20

/** Limits auto-populated plugin tracks to at most 2 per language and 20 per plugin source. */
export function capPluginSubtitles(
  tracks: readonly SubtitleCandidate[],
  preferred: readonly string[],
): SubtitleCandidate[] {
  const sorted = [...tracks].sort(
    (a, b) => languagePreferenceIndex(a.language, preferred) - languagePreferenceIndex(b.language, preferred),
  )
  const perSourceTotals = new Map<string, number>()
  const perSourceLang = new Map<string, number>()
  const kept: SubtitleCandidate[] = []

  for (const track of sorted) {
    const originKey = track.pluginOrigin ?? track.sourceName ?? 'plugin'
    const total = perSourceTotals.get(originKey) ?? 0
    if (total >= PLUGIN_TOTAL_LIMIT) continue
    const langKey = `${originKey}\0${track.language}`
    const langCount = perSourceLang.get(langKey) ?? 0
    if (langCount >= PLUGIN_PER_LANG_LIMIT) continue
    perSourceTotals.set(originKey, total + 1)
    perSourceLang.set(langKey, langCount + 1)
    kept.push(track)
  }
  return kept
}

/** Resolves an IMDb ID directly or via AniZip for anime titles. */
export async function resolveImdbIdForMedia(
  options: Pick<ExternalSubtitleQueryOptions, 'fetch' | 'imdbId' | 'aniId' | 'isAnime' | 'signal'>,
): Promise<string | undefined> {
  if (options.imdbId) return options.imdbId
  if (!options.aniId || !(options.isAnime ?? true)) return undefined
  try {
    const mapped = await fetchAnizipJsonMappings(options.aniId.providerId, options.aniId.id, {
      fetch: input => options.fetch(String(input), { signal: options.signal }),
    })
    const candidateImdb = mapped?.mappings?.imdb_id
    return candidateImdb && IMDB_ID_RE.test(candidateImdb) ? candidateImdb : undefined
  } catch {
    // AniZip lookup failure only omits IMDb fallback; Xunlei and plugin searches still proceed.
    return undefined
  }
}

export function buildOpenTarget(
  imdbId: string | undefined,
  options: Pick<ExternalSubtitleQueryOptions, 'film' | 'season' | 'episode'>,
): OpenSubtitlesTarget | undefined {
  if (!imdbId) return undefined
  if (options.film) return { kind: 'movie', imdbId }
  if (options.episode !== undefined && Number.isInteger(options.episode) && options.episode >= 0) {
    return {
      kind: 'series',
      imdbId,
      season: options.season ?? 1,
      episode: options.episode,
    }
  }
  return undefined
}

async function resolveQueryInputs(options: ExternalSubtitleQueryOptions): Promise<{
  preferred: string[]
  imdbId?: string
  context: SubtitleQueryContext
  openTarget?: OpenSubtitlesTarget
  xunleiQuery?: string
}> {
  const preferred = (options.preferredLanguages ?? [])
    .map(lang => normalizeSubtitleLanguage(lang))
    .filter(lang => lang !== 'und')

  const imdbId = await resolveImdbIdForMedia(options)
  const openTarget = buildOpenTarget(imdbId, options)

  const trimmedQuery = options.query?.trim()
  const xunleiQuery = trimmedQuery || buildXunleiQuery({
    title: options.title,
    releaseName: options.releaseName,
    film: options.film,
    season: options.season,
    episode: options.episode,
  })

  const context: SubtitleQueryContext = {
    mediaUri: options.mediaUri ?? '',
    episodeUri: options.episodeUri ?? '',
    ...(imdbId ? { imdbId } : {}),
    ...(options.aniId ? { aniId: options.aniId } : {}),
    isAnime: Boolean(options.isAnime),
    film: Boolean(options.film),
    ...(options.season !== undefined ? { season: options.season } : {}),
    ...(options.episode !== undefined ? { episode: options.episode } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.releaseName ? { releaseName: options.releaseName } : {}),
    ...(trimmedQuery ? { query: trimmedQuery } : {}),
    preferredLanguages: preferred,
    locale: options.locale ?? 'en',
  }

  return { preferred, imdbId, context, openTarget, xunleiQuery }
}

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw new Error('Subtitle download exceeds 5 MiB limit')
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Subtitle download exceeds 5 MiB limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Resolves text for a single `SubtitleCandidate` via inline content, plugin loader, or HTTP fetch. */
export async function loadSubtitleCandidate(
  candidate: SubtitleCandidate,
  options: Pick<ExternalSubtitleQueryOptions, 'fetch' | 'loadPluginSubtitle' | 'signal'>,
): Promise<string> {
  if (candidate.content !== undefined) return candidate.content
  if (candidate.pluginOrigin && candidate.remoteTrackId !== undefined && options.loadPluginSubtitle && (candidate.hasLoader || !candidate.url)) {
    return options.loadPluginSubtitle(candidate.pluginOrigin, candidate.remoteTrackId)
  }
  if (!candidate.url) throw new Error(`External subtitle source unavailable: ${candidate.id}`)
  const response = await options.fetch(candidate.url, { signal: options.signal })
  if (!response.ok) throw new Error(`Failed to fetch subtitle (${response.status})`)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_SUBTITLE_BYTES) {
    await response.body?.cancel?.().catch(() => undefined)
    throw new Error('Subtitle download exceeds 5 MiB limit')
  }
  const bytes = await readBoundedBytes(response, MAX_SUBTITLE_BYTES)
  return decodeSubtitle(bytes, candidate.language)
}

async function queryBuiltInSubtitles(
  options: ExternalSubtitleQueryOptions,
  inputs: Awaited<ReturnType<typeof resolveQueryInputs>>,
  limits?: { perLanguageLimit: number, totalLimit: number, xunleiLimit: number },
): Promise<[SubtitleCandidate[], SubtitleCandidate[]]> {
  const { preferred, openTarget, xunleiQuery } = inputs
  return Promise.all([
    limits && options.fetchOpenCandidates
      ? options.fetchOpenCandidates().catch(() => [])
      : openTarget
        ? fetchOpenSubtitles(openTarget, {
          fetch: options.fetch,
          preferredLanguages: preferred,
          releaseName: options.releaseName,
          locale: options.locale,
          signal: options.signal,
          ...(limits ? { perLanguageLimit: limits.perLanguageLimit, totalLimit: limits.totalLimit } : {}),
        })
        : Promise.resolve([]),
    xunleiQuery
      ? fetchXunleiSubtitles(xunleiQuery, {
        fetch: options.fetch,
        preferredLanguages: preferred,
        locale: options.locale,
        signal: options.signal,
        ...(limits ? { limit: limits.xunleiLimit } : {}),
      })
      : Promise.resolve([]),
  ])
}

/** Fetches built-in OpenSubtitles and Xunlei candidates together with any resolved IMDb id. */
export async function fetchBuiltInExternalSubtitles(
  options: ExternalSubtitleQueryOptions,
): Promise<{ candidates: SubtitleCandidate[], imdbId?: string }> {
  const inputs = await resolveQueryInputs(options)
  options.onImdbResolved?.(inputs.imdbId)
  const [openTracks, xunleiTracks] = await queryBuiltInSubtitles(options, inputs)
  const candidates = [...openTracks, ...xunleiTracks].sort(
    (a, b) => languagePreferenceIndex(a.language, inputs.preferred) - languagePreferenceIndex(b.language, inputs.preferred),
  )
  return { candidates, imdbId: inputs.imdbId }
}

/** Searches OpenSubtitles, Xunlei, and enabled plugins without auto-population caps for the interactive subtitle browser. */
export async function searchExternalSubtitles(
  options: ExternalSubtitleQueryOptions,
): Promise<{ candidates: SubtitleCandidate[], load: (candidate: SubtitleCandidate) => Promise<string> }> {
  const inputs = await resolveQueryInputs(options)
  const [[openTracks, xunleiTracks], pluginTracks] = await Promise.all([
    queryBuiltInSubtitles(options, inputs, { perLanguageLimit: 50, totalLimit: 200, xunleiLimit: 50 }),
    options.findPluginSubtitles
      ? options.findPluginSubtitles(inputs.context).catch(() => [])
      : Promise.resolve([]),
  ])

  const rawTokens = options.query?.trim()
    ? options.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    : []
  const matchingOpenTracks = rawTokens.length > 0
    ? openTracks.filter(candidate => {
        const haystack = [
          candidate.release ?? '',
          candidate.label,
          candidate.group ?? '',
          candidate.language,
          subtitleLanguageLabel(candidate.language, options.locale),
          candidate.sourceName ?? 'OpenSubtitles',
        ].join(' ').toLowerCase()
        return rawTokens.every(token => haystack.includes(token))
      })
    : openTracks

  const seen = new Set<string>()
  const merged = [...matchingOpenTracks, ...xunleiTracks, ...pluginTracks]
    .filter(candidate => {
      if (seen.has(candidate.id)) return false
      seen.add(candidate.id)
      return true
    })
    .sort((a, b) => languagePreferenceIndex(a.language, inputs.preferred) - languagePreferenceIndex(b.language, inputs.preferred))

  return {
    candidates: merged,
    load: (candidate: SubtitleCandidate) => loadSubtitleCandidate(candidate, options),
  }
}
