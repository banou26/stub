import type { ExternalSubtitleFormat } from '@banou/media-player'

import { languagePreferenceIndex, normalizeSubtitleLanguage, subtitleLanguageLabel } from './languages'

export const OPENSUBTITLES_ORIGIN = 'https://opensubtitles-v3.strem.io'
export const OPENSUBTITLES_SUBTITLE_ORIGIN = 'https://subs5.strem.io'

const PER_LANGUAGE_LIMIT = 2
const TOTAL_LIMIT = 50
const UNSUPPORTED_EXT_RE = /\.(?:zip|rar|7z|gz|tar|idx|sub|sup)$/i

export type OpenSubtitlesTarget =
  | { kind: 'movie', imdbId: string }
  | { kind: 'series', imdbId: string, season: number, episode: number }

export type SubtitleCandidate = {
  id: string
  language: string
  label: string
  format: ExternalSubtitleFormat
  url?: string
  content?: string
  hasLoader?: boolean
  source: 'opensubtitles' | 'xunlei' | 'plugin'
  sourceName?: string
  pluginOrigin?: string
  remoteTrackId?: string
  release?: string
  group?: string
  hearingImpaired?: boolean
  downloads?: number
}

type OpenSubtitlesApiItem = {
  id?: string | number
  url?: string
  lang?: string
  subtitleFileName?: string
  movieReleaseName?: string
  releaseGroup?: string
}

export function openSubtitlesUrl(target: OpenSubtitlesTarget): string {
  const imdb = encodeURIComponent(target.imdbId.trim())
  if (target.kind === 'movie') {
    return `${OPENSUBTITLES_ORIGIN}/subtitles/movie/${imdb}.json`
  }
  return `${OPENSUBTITLES_ORIGIN}/subtitles/series/${imdb}:${target.season}:${target.episode}.json`
}

function allowedDownloadUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.origin !== OPENSUBTITLES_SUBTITLE_ORIGIN) return null
    if (UNSUPPORTED_EXT_RE.test(parsed.pathname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function detectFormat(url: string, fileName?: string): ExternalSubtitleFormat | null {
  const candidate = fileName?.trim() || new URL(url).pathname
  const lower = candidate.toLowerCase()
  if (UNSUPPORTED_EXT_RE.test(lower)) return null
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return 'ass'
  if (lower.endsWith('.vtt')) return 'vtt'
  return 'srt'
}

function sanitizeLabelText(value: string | undefined): string {
  return (value ?? '').replace(/[\u2013\u2014]/g, '-').trim()
}

function tokenizeRelease(releaseName: string | undefined): string[] {
  if (!releaseName) return []
  return releaseName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2)
}

function releaseMatchScore(item: OpenSubtitlesApiItem, tokens: string[]): number {
  if (!tokens.length) return 0
  const haystack = `${item.subtitleFileName ?? ''} ${item.movieReleaseName ?? ''} ${item.releaseGroup ?? ''}`.toLowerCase()
  const group = (item.releaseGroup ?? '').toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1
    if (group && group === token) score += 2
  }
  return score
}

export async function fetchOpenSubtitles(
  target: OpenSubtitlesTarget,
  options: {
    fetch: (input: string, init?: RequestInit) => Promise<Response>
    preferredLanguages?: readonly string[]
    releaseName?: string
    locale?: string
    signal?: AbortSignal
    perLanguageLimit?: number
    totalLimit?: number
  },
): Promise<SubtitleCandidate[]> {
  let response: Response
  try {
    response = await options.fetch(openSubtitlesUrl(target), { signal: options.signal })
  } catch {
    return []
  }
  if (!response.ok) return []

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return []
  }

  const rawItems = (payload as { subtitles?: unknown })?.subtitles
  if (!Array.isArray(rawItems)) return []

  const preferred = options.preferredLanguages ?? []
  const releaseTokens = tokenizeRelease(options.releaseName)

  const parsed: {
    item: OpenSubtitlesApiItem
    id: string
    url: string
    language: string
    format: ExternalSubtitleFormat
    prefRank: number
    score: number
    index: number
  }[] = []

  const seenUrls = new Set<string>()
  for (let index = 0; index < rawItems.length; index++) {
    const item = rawItems[index] as OpenSubtitlesApiItem | null
    if (!item || typeof item !== 'object') continue
    const url = allowedDownloadUrl(item.url)
    if (!url || seenUrls.has(url)) continue
    const format = detectFormat(url, item.subtitleFileName)
    if (!format) continue
    seenUrls.add(url)

    const language = normalizeSubtitleLanguage(item.lang)
    const id = `opensubtitles:${language}:${item.id !== undefined ? String(item.id) : String(index)}`
    parsed.push({
      item,
      id,
      url,
      language,
      format,
      prefRank: languagePreferenceIndex(language, preferred),
      score: releaseMatchScore(item, releaseTokens),
      index,
    })
  }

  parsed.sort((a, b) => {
    if (a.prefRank !== b.prefRank) return a.prefRank - b.prefRank
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })

  const perLanguageCounts = new Map<string, number>()
  const picked: typeof parsed = []
  const usedIds = new Set<string>()
  const perLanguageLimit = options.perLanguageLimit ?? PER_LANGUAGE_LIMIT
  const totalLimit = options.totalLimit ?? TOTAL_LIMIT

  for (const entry of parsed) {
    if (picked.length >= totalLimit) break
    const count = perLanguageCounts.get(entry.language) ?? 0
    if (count >= perLanguageLimit) continue
    perLanguageCounts.set(entry.language, count + 1)

    let id = entry.id
    if (usedIds.has(id)) {
      id = `${entry.id}:${entry.index}`
    }
    usedIds.add(id)
    picked.push({ ...entry, id })
  }

  const locale = options.locale ?? 'en'
  const seenLangLabelIndex = new Map<string, number>()
  return picked.map(entry => {
    const langIndex = (seenLangLabelIndex.get(entry.language) ?? 0) + 1
    seenLangLabelIndex.set(entry.language, langIndex)
    const totalForLang = perLanguageCounts.get(entry.language) ?? 1
    const langName = subtitleLanguageLabel(entry.language, locale)
    const group = sanitizeLabelText(entry.item.releaseGroup)
    const release = sanitizeLabelText(entry.item.movieReleaseName || entry.item.subtitleFileName)
    const suffix = group
      ? `OpenSubtitles · ${group}`
      : totalForLang > 1
        ? `OpenSubtitles #${langIndex}`
        : 'OpenSubtitles'
    return {
      id: entry.id,
      language: entry.language,
      label: `${langName} (${suffix})`,
      format: entry.format,
      url: entry.url,
      source: 'opensubtitles',
      sourceName: 'OpenSubtitles',
      ...(release ? { release } : {}),
      ...(group ? { group } : {}),
    }
  })
}
