import type { ExternalSubtitleFormat } from '@banou/media-player'

import type { SubtitleCandidate } from './opensubtitles'

import { languagePreferenceIndex, normalizeSubtitleLanguage, subtitleLanguageLabel } from './languages'

export const XUNLEI_ORACLE_ENDPOINT = 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle'
export const XUNLEI_SUBTITLE_HOST = 'subtitle.v.geilijiasu.com'

const XUNLEI_LIMIT = 8

type XunleiApiItem = {
  cid?: string
  gcid?: string
  url?: string
  ext?: string
  name?: string
  duration?: number
  languages?: string[]
  langs?: string
  score?: number
  fingerprintf_score?: number
}

export function xunleiSubtitleUrl(query: string): string {
  return `${XUNLEI_ORACLE_ENDPOINT}?name=${encodeURIComponent(query.trim())}`
}

function allowedDownloadUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname !== XUNLEI_SUBTITLE_HOST) return null
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    return null
  }
}

function mapFormat(ext: string | undefined, url: string): ExternalSubtitleFormat | null {
  const normalized = (ext ?? '').trim().toLowerCase()
  const raw = normalized || (new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '')
  if (raw === 'srt') return 'srt'
  if (raw === 'vtt') return 'vtt'
  if (raw === 'ass' || raw === 'ssa') return 'ass'
  return null
}

function sanitizeLabelText(value: string | undefined): string {
  return (value ?? '').replace(/[\u2013\u2014]/g, '-').trim()
}

function inferXunleiLanguage(item: XunleiApiItem): string {
  const tokens: string[] = []
  if (Array.isArray(item.languages)) tokens.push(...item.languages)
  if (item.langs) tokens.push(...item.langs.split(/[,/|&\s]+/))

  for (const raw of tokens) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (/繁|cht|zht|big5/i.test(trimmed)) return 'zh-Hant'
    if (/简|双语|chs|默认/i.test(trimmed)) return 'zh-Hans'
  }

  for (const raw of tokens) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const normalized = normalizeSubtitleLanguage(trimmed)
    if (normalized !== 'und') return normalized
  }

  const name = item.name ?? ''
  if (/繁|cht|big5/i.test(name)) return 'zh-Hant'
  return 'zh-Hans'
}

export async function fetchXunleiSubtitles(
  query: string,
  options: {
    fetch: (input: string, init?: RequestInit) => Promise<Response>
    preferredLanguages?: readonly string[]
    locale?: string
    signal?: AbortSignal
  },
): Promise<SubtitleCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  let response: Response
  try {
    response = await options.fetch(xunleiSubtitleUrl(trimmed), { signal: options.signal })
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

  const rawItems = (payload as { data?: unknown })?.data
  if (!Array.isArray(rawItems)) return []

  const preferred = options.preferredLanguages ?? []
  const seenCids = new Set<string>()
  const seenUrls = new Set<string>()

  const parsed: {
    item: XunleiApiItem
    id: string
    url: string
    language: string
    format: ExternalSubtitleFormat
    prefRank: number
    score: number
    index: number
  }[] = []

  for (let index = 0; index < rawItems.length; index++) {
    const item = rawItems[index] as XunleiApiItem | null
    if (!item || typeof item !== 'object') continue
    const url = allowedDownloadUrl(item.url)
    if (!url || seenUrls.has(url)) continue
    const cid = (item.cid ?? '').trim()
    if (cid && seenCids.has(cid)) continue
    const format = mapFormat(item.ext, url)
    if (!format) continue

    seenUrls.add(url)
    if (cid) seenCids.add(cid)

    const language = inferXunleiLanguage(item)
    const numericScore = typeof item.score === 'number'
      ? item.score
      : typeof item.fingerprintf_score === 'number'
        ? item.fingerprintf_score
        : 0

    parsed.push({
      item,
      id: `xunlei:${cid || String(index)}`,
      url,
      language,
      format,
      prefRank: languagePreferenceIndex(language, preferred),
      score: numericScore,
      index,
    })
  }

  parsed.sort((a, b) => {
    if (a.prefRank !== b.prefRank) return a.prefRank - b.prefRank
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })

  const limited = parsed.slice(0, XUNLEI_LIMIT)
  const locale = options.locale ?? 'en'
  const langTotals = new Map<string, number>()
  for (const entry of limited) {
    langTotals.set(entry.language, (langTotals.get(entry.language) ?? 0) + 1)
  }

  const langCounts = new Map<string, number>()
  return limited.map(entry => {
    const langIndex = (langCounts.get(entry.language) ?? 0) + 1
    langCounts.set(entry.language, langIndex)
    const total = langTotals.get(entry.language) ?? 1
    const langName = subtitleLanguageLabel(entry.language, locale)
    const langsDetail = sanitizeLabelText(entry.item.langs)
    const detail = langsDetail
      ? `Xunlei · ${langsDetail}`
      : total > 1
        ? `Xunlei #${langIndex}`
        : 'Xunlei'
    return {
      id: entry.id,
      language: entry.language,
      label: `${langName} (${detail})`,
      format: entry.format,
      url: entry.url,
      source: 'xunlei',
    }
  })
}
