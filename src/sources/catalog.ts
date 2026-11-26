import type { IntlShape } from 'react-intl'

import type { WatchSource } from '../components/source-selector'
import type { CatalogAction, CatalogBadge, CatalogItem, CatalogMetric } from '../plugin-sdk'

export type CatalogSortKey = 'recommended' | 'quality' | 'size-asc' | 'size-desc' | 'newest' | `metric:${string}`

export type CatalogEntry = {
  uri: string
  sourceId: string
  sourceName: string
  sourceIcon?: string | null
  sourceColor?: string | null
  href?: string
  external: boolean
  active: boolean
  isItem: boolean
  rowTitle: string
  displayTitle: string
  rawTitle: string
  hasRawVariant: boolean
  subtitle?: string
  resolution?: number
  videoQualities: string[]
  audioQualities: string[]
  audioLanguages: string[]
  subtitleLanguages: string[]
  sizeBytes?: number
  sizeText?: string
  publishedAt?: number
  badges: CatalogBadge[]
  metrics: CatalogMetric[]
  actions: CatalogAction[]
  orderIndex: number
}

export type CatalogFilterState = {
  query: string
  sourceId: string
  quality: string
  audio: string
  subtitle: string
  badgeIds: string[]
  sort: CatalogSortKey
  playableOnly: boolean
  showRaw: boolean
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilterState = {
  query: '',
  sourceId: '',
  quality: '',
  audio: '',
  subtitle: '',
  badgeIds: [],
  sort: 'recommended',
  playableOnly: false,
  showRaw: false,
}

export const MULTIPLE_LANGUAGES = 'mul'

/** Primary language subtag (`en-US` -> `en`, `mul` -> `mul`), lowercased for stable cross-source filtering. */
export const normalizeLanguageSubtag = (tag: string): string => {
  const trimmed = tag.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed === MULTIPLE_LANGUAGES) return MULTIPLE_LANGUAGES
  return trimmed.split('-')[0] ?? trimmed
}

/** Localized display name of a BCP 47 language tag (or `Multiple languages` for `mul`). */
export const languageName = (intl: IntlShape, tag: string): string => {
  if (normalizeLanguageSubtag(tag) === MULTIPLE_LANGUAGES) {
    return intl.formatMessage({ id: 'Multiple languages', defaultMessage: 'Multiple languages' })
  }
  const language = tag.split('-')[0]!
  return /^(?:[a-z]{2,3}|[a-z]{5,8})$/i.test(language) ? intl.formatDisplayName(language, { type: 'language' }) ?? tag : tag
}

const QUALITY_ALIASES: Record<string, string> = {
  '4k': '2160p',
  uhd: '2160p',
  '2160p': '2160p',
  '8k': '4320p',
  '4320p': '4320p',
  sd: '480p',
  '480p': '480p',
  hd: 'HD',
  '720p': '720p',
  fhd: '1080p',
  '1080p': '1080p',
  '1440p': '1440p',
  '576p': '576p',
  '360p': '360p',
  'dolby vision': 'Dolby Vision',
  hdr10: 'HDR10',
  hdr: 'HDR',
  imax: 'IMAX',
  hevc: 'HEVC',
  x265: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
}

const RESOLUTION_TIERS: Record<string, number> = {
  '4320p': 9000,
  '2160p': 8000,
  '1440p': 6500,
  '1080p': 6000,
  '720p': 5000,
  HD: 4500,
  '576p': 3500,
  '480p': 3000,
  '360p': 2000,
}

const QUALITY_MODIFIERS: Record<string, number> = {
  'Dolby Vision': 50,
  HDR10: 30,
  HDR: 20,
  IMAX: 10,
  AV1: 6,
  HEVC: 4,
}

const CANONICAL_TO_ALIASES = new Map<string, string[]>()
for (const [alias, canonical] of Object.entries(QUALITY_ALIASES)) {
  const list = CANONICAL_TO_ALIASES.get(canonical) ?? []
  list.push(alias)
  CANONICAL_TO_ALIASES.set(canonical, list)
}

/** Canonical quality key (`4K` <-> `2160p`, `SD` <-> `480p`) for consistent filtering and sorting. */
export const canonicalQualityKey = (tag: string): string => {
  const trimmed = tag.trim()
  if (!trimmed) return ''
  return QUALITY_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

const resolutionTierRank = (resolution: number): number =>
  RESOLUTION_TIERS[`${resolution}p`]
  ?? (resolution >= 4320 ? 9000
    : resolution >= 2160 ? 8000
    : resolution >= 1440 ? 6500
    : resolution >= 1080 ? 6000
    : resolution >= 720 ? 5000
    : resolution >= 576 ? 3500
    : resolution >= 480 ? 3000
    : 2000)

const qualityOptionRank = (key: string): number =>
  RESOLUTION_TIERS[key] ?? QUALITY_MODIFIERS[key] ?? 1

/** Ranks item video quality so resolution tiers dominate over HDR/codec modifiers. */
export const qualityRank = (qualities: readonly string[], resolution?: number): number => {
  let bestRes = resolution ? resolutionTierRank(resolution) : 0
  let modifier = 0
  for (const q of qualities) {
    const key = canonicalQualityKey(q)
    const resRank = RESOLUTION_TIERS[key]
    if (resRank != null) {
      if (resRank > bestRes) bestRes = resRank
    } else if (key) {
      modifier = Math.max(modifier, QUALITY_MODIFIERS[key] ?? 1)
    }
  }
  return bestRes + modifier
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  kib: 2 ** 10,
  mb: 1e6,
  mib: 2 ** 20,
  gb: 1e9,
  gib: 2 ** 30,
  tb: 1e12,
  tib: 2 ** 40,
}

/** Parses human-readable byte strings (`1.5 GiB`, `500 MB`) into bytes for sorting. */
export const parseSizeToBytes = (size: string | undefined): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?i?B)\b/i.exec(size?.trim() ?? '')
  if (!match) return undefined
  const multiplier = SIZE_UNITS[match[2]!.toLowerCase()]
  return multiplier ? Math.round(Number(match[1]) * multiplier) : undefined
}

const COMPACT_UNITS = [
  ['terabyte', 2 ** 40],
  ['gigabyte', 2 ** 30],
  ['megabyte', 2 ** 20],
  ['kilobyte', 2 ** 10],
] as const

/** Formats byte counts into compact localized units (`1.4GB` / locale equivalent). */
export const formatBytes = (bytes: number | undefined, locale: string, fallbackSize?: string): string | undefined => {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return fallbackSize
  for (const [unit, factor] of COMPACT_UNITS) {
    if (bytes >= factor || unit === 'kilobyte') {
      const value = bytes / factor
      const digits = value >= 100 ? 0 : 1
      try {
        return new Intl.NumberFormat(locale, {
          style: 'unit',
          unit,
          unitDisplay: 'narrow',
          minimumFractionDigits: unit === 'kilobyte' ? 0 : digits,
          maximumFractionDigits: unit === 'kilobyte' ? 0 : digits,
        }).format(value)
      } catch {
        return fallbackSize
      }
    }
  }
  return fallbackSize
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Formats an epoch millisecond timestamp as relative elapsed age (`3d`, `2h`) in `locale`. */
export const formatRelativeAge = (publishedAt: number | undefined, locale: string, now = Date.now()): string | undefined => {
  if (publishedAt == null || !Number.isFinite(publishedAt)) return undefined
  const elapsed = Math.max(0, now - publishedAt)
  try {
    let rtf = new Intl.RelativeTimeFormat(locale, { style: 'narrow' })
    if (/^[-\u2212]/.test(rtf.format(-1, 'day'))) {
      rtf = new Intl.RelativeTimeFormat(locale, { style: 'short' })
    }
    if (elapsed < HOUR) return rtf.format(-Math.max(1, Math.floor(elapsed / MINUTE)), 'minute')
    if (elapsed < DAY) return rtf.format(-Math.floor(elapsed / HOUR), 'hour')
    const days = Math.floor(elapsed / DAY)
    if (days < 30) return rtf.format(-days, 'day')
    if (days < 365) return rtf.format(-Math.floor(days / 30), 'month')
    return rtf.format(-Math.floor(days / 365), 'year')
  } catch {
    return undefined
  }
}

const MEDIA_EXT = /\.(mkv|mp4|avi|webm)$/i

/** Removes leading/inline bracketed/parenthesized metadata tags and media container extensions for scannable titles. */
export const cleanItemTitle = (name: string): string => {
  const stripped = name
    .replace(/^\[[^\]]*\]/, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(MEDIA_EXT, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-|~]+|[\s\-|~]+$/g, '')
  return stripped || name
}

const uniqueStrings = (values: readonly (string | null | undefined)[] | undefined | null): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of values ?? []) {
    const trimmed = item?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

const toEntry = (
  source: WatchSource,
  orderIndex: number,
  release: WatchSource['releases'] extends (infer R)[] | undefined ? R | undefined : undefined,
  catalogItems?: ReadonlyMap<string, CatalogItem>,
): CatalogEntry => {
  const uri = release?.uri ?? source.uri ?? (source.id ? `${source.id}:0` : source.name)
  const detail = catalogItems?.get(uri)
  const isItem = Boolean(release)

  const rawVideoQualities = detail
    ? uniqueStrings(detail.videoQualities)
    : uniqueStrings(release?.videoQualities ?? source.videoQualities)
  const hasResolutionTag = rawVideoQualities.some(q => RESOLUTION_TIERS[canonicalQualityKey(q)] != null)
  const videoQualities = detail?.resolution && !hasResolutionTag
    ? [`${detail.resolution}p`, ...rawVideoQualities]
    : rawVideoQualities

  const audioQualities = detail
    ? uniqueStrings(detail.audioQualities)
    : uniqueStrings(release?.audioQualities ?? source.audioQualities)
  const audioLanguages = detail
    ? uniqueStrings(detail.audioLanguages)
    : uniqueStrings(release?.audioLanguages ?? source.audioLanguages)
  const subtitleLanguages = detail
    ? uniqueStrings(detail.subtitleLanguages)
    : uniqueStrings(release?.subtitleLanguages ?? source.subtitleLanguages)

  const rawCandidate = detail?.rawTitle ?? detail?.title ?? release?.label ?? source.name
  const described = Boolean(detail?.title || isItem)
  const displayTitle = detail?.title
    ? (detail.rawTitle && detail.title === detail.rawTitle ? cleanItemTitle(detail.title) : detail.title)
    : isItem
      ? cleanItemTitle(rawCandidate)
      : source.name
  const hasRawVariant = described && displayTitle !== rawCandidate
  const rowTitle = described ? rawCandidate : source.name
  const sizeBytes = detail?.sizeBytes ?? parseSizeToBytes(detail?.sizeText)

  return {
    uri,
    sourceId: source.id,
    sourceName: source.name,
    sourceIcon: source.icon,
    sourceColor: source.color,
    href: release ? release.href : source.href,
    external: release ? release.external : source.external,
    active: release ? release.active : source.active,
    isItem,
    rowTitle,
    displayTitle,
    rawTitle: rawCandidate,
    hasRawVariant,
    subtitle: detail?.subtitle,
    resolution: detail?.resolution,
    videoQualities,
    audioQualities,
    audioLanguages,
    subtitleLanguages,
    sizeBytes,
    sizeText: detail?.sizeText,
    publishedAt: detail?.publishedAt,
    badges: detail?.badges ? [...detail.badges] : [],
    metrics: detail?.metrics ? [...detail.metrics] : [],
    actions: detail?.actions ? [...detail.actions] : [],
    orderIndex,
  }
}

/** Flattens `sources` (and their nested entries) into uniform `CatalogEntry` rows enriched with `catalogItems`. */
export const buildCatalogEntries = (
  sources: readonly WatchSource[],
  catalogItems?: ReadonlyMap<string, CatalogItem>,
): CatalogEntry[] => {
  const out: CatalogEntry[] = []
  let orderIndex = 0
  for (const source of sources) {
    if (source.releases && source.releases.length > 0) {
      for (const release of source.releases) {
        out.push(toEntry(source, orderIndex++, release, catalogItems))
      }
    } else if (source.href) {
      out.push(toEntry(source, orderIndex++, undefined, catalogItems))
    }
  }
  return out
}

export type FilterOption = { value: string, label: string, count: number }

export type SortMetricOption = { id: string, label: string, direction: 'asc' | 'desc' }

export type CatalogFilterOptions = {
  sources: FilterOption[]
  qualities: FilterOption[]
  audioLanguages: FilterOption[]
  subtitleLanguages: FilterOption[]
  badges: FilterOption[]
  metricSorts: SortMetricOption[]
  hasPlayableToggle: boolean
  hasRawToggle: boolean
  hasSizes: boolean
  hasDates: boolean
  hasQualities: boolean
}

const makeLanguageLabeler = (intlOrLocale?: IntlShape | string) => {
  const locale = !intlOrLocale ? undefined : typeof intlOrLocale === 'string' ? intlOrLocale : intlOrLocale.locale
  let displayNames: Intl.DisplayNames | undefined
  if (locale) {
    try { displayNames = new Intl.DisplayNames([locale], { type: 'language' }) } catch {}
  }
  return (subtag: string, raw: string) => {
    if (subtag === MULTIPLE_LANGUAGES) {
      return typeof intlOrLocale === 'string' || !intlOrLocale
        ? MULTIPLE_LANGUAGES
        : intlOrLocale.formatMessage({ id: 'Multiple languages', defaultMessage: 'Multiple languages' })
    }
    if (intlOrLocale && typeof intlOrLocale !== 'string') {
      try {
        const named = intlOrLocale.formatDisplayName(subtag, { type: 'language' })
        if (named) return named
      } catch {}
    }
    if (displayNames) {
      try { return displayNames.of(subtag) ?? raw } catch {}
    }
    return raw
  }
}

/** Computes available filter options, plugin-declared filterable badges, and sortable metrics across `entries`. */
export const extractCatalogOptions = (
  entries: readonly CatalogEntry[],
  intlOrLocale: IntlShape | string,
): CatalogFilterOptions => {
  const locale = typeof intlOrLocale === 'string' ? intlOrLocale : intlOrLocale.locale
  const sourceCounts = new Map<string, { label: string, count: number }>()
  const qualityCounts = new Map<string, number>()
  const audioCounts = new Map<string, { raw: string, count: number }>()
  const subCounts = new Map<string, { raw: string, count: number }>()
  const badgeCounts = new Map<string, { label: string, count: number }>()
  const metricSorts = new Map<string, SortMetricOption>()

  let playableCount = 0
  let externalCount = 0
  let hasRawToggle = false
  let hasSizes = false
  let hasDates = false

  const labelForSubtag = makeLanguageLabeler(intlOrLocale)

  for (const item of entries) {
    const existingSource = sourceCounts.get(item.sourceId)
    if (existingSource) existingSource.count += 1
    else sourceCounts.set(item.sourceId, { label: item.sourceName, count: 1 })

    const seenQualities = new Set<string>()
    for (const q of item.videoQualities) {
      const key = canonicalQualityKey(q)
      if (!key || seenQualities.has(key)) continue
      seenQualities.add(key)
      qualityCounts.set(key, (qualityCounts.get(key) ?? 0) + 1)
    }

    const seenAudio = new Set<string>()
    for (const tag of item.audioLanguages) {
      const subtag = normalizeLanguageSubtag(tag)
      if (!subtag || seenAudio.has(subtag)) continue
      seenAudio.add(subtag)
      const existing = audioCounts.get(subtag)
      if (existing) existing.count += 1
      else audioCounts.set(subtag, { raw: tag, count: 1 })
    }

    const seenSub = new Set<string>()
    for (const tag of item.subtitleLanguages) {
      const subtag = normalizeLanguageSubtag(tag)
      if (!subtag || seenSub.has(subtag)) continue
      seenSub.add(subtag)
      const existing = subCounts.get(subtag)
      if (existing) existing.count += 1
      else subCounts.set(subtag, { raw: tag, count: 1 })
    }

    const seenBadges = new Set<string>()
    for (const badge of item.badges) {
      if (!badge.filterable || seenBadges.has(badge.id)) continue
      seenBadges.add(badge.id)
      const existing = badgeCounts.get(badge.id)
      if (existing) existing.count += 1
      else badgeCounts.set(badge.id, { label: badge.label, count: 1 })
    }

    for (const metric of item.metrics) {
      if (metric.sort && !metricSorts.has(metric.id)) {
        metricSorts.set(metric.id, { id: metric.id, label: metric.label, direction: metric.sort })
      }
    }

    if (item.external) externalCount += 1
    else playableCount += 1
    if (item.hasRawVariant) hasRawToggle = true
    if (item.sizeBytes != null) hasSizes = true
    if (item.publishedAt != null) hasDates = true
  }

  const qualities = [...qualityCounts.entries()]
    .sort(([a], [b]) => qualityOptionRank(b) - qualityOptionRank(a) || a.localeCompare(b))
    .map(([value, count]) => ({ value, label: value, count }))

  const sortLangs = (map: Map<string, { raw: string, count: number }>) =>
    [...map.entries()]
      .map(([value, { raw, count }]) => ({ value, label: labelForSubtag(value, raw), count }))
      .sort((a, b) => {
        try { return a.label.localeCompare(b.label, locale) } catch { return a.label.localeCompare(b.label) }
      })

  return {
    sources: [...sourceCounts.entries()].map(([value, { label, count }]) => ({ value, label, count })),
    qualities,
    audioLanguages: sortLangs(audioCounts),
    subtitleLanguages: sortLangs(subCounts),
    badges: [...badgeCounts.entries()].map(([value, { label, count }]) => ({ value, label, count })),
    metricSorts: [...metricSorts.values()],
    hasPlayableToggle: playableCount > 0 && externalCount > 0,
    hasRawToggle,
    hasSizes,
    hasDates,
    hasQualities: qualities.length > 0 || entries.some(item => item.resolution != null),
  }
}

const compareNullableDesc = (a: number | undefined, b: number | undefined): number => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return b - a
}

const compareNullableAsc = (a: number | undefined, b: number | undefined): number => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

const expandLanguageTerms = (
  tags: readonly string[],
  labelForSubtag?: (subtag: string, raw: string) => string,
): string[] =>
  tags.flatMap(tag => {
    const subtag = normalizeLanguageSubtag(tag)
    return [tag, subtag, subtag && labelForSubtag ? labelForSubtag(subtag, tag) : '']
  })

const expandQualityTerms = (qualities: readonly string[]): string[] =>
  qualities.flatMap(q => {
    const key = canonicalQualityKey(q)
    return [q, key, ...(CANONICAL_TO_ALIASES.get(key) ?? [])]
  })

const matchesTokens = (
  item: CatalogEntry,
  tokens: string[],
  labelForSubtag?: (subtag: string, raw: string) => string,
): boolean => {
  if (!tokens.length) return true
  const haystack = [
    item.sourceName,
    item.subtitle ?? '',
    item.rawTitle,
    item.displayTitle,
    ...expandQualityTerms(item.videoQualities),
    ...item.audioQualities,
    ...expandLanguageTerms(item.audioLanguages, labelForSubtag),
    ...expandLanguageTerms(item.subtitleLanguages, labelForSubtag),
    ...item.badges.flatMap(b => [b.id, b.label]),
    ...item.metrics.flatMap(m => [m.id, m.label, m.display ?? '']),
  ].join(' ').toLowerCase()
  return tokens.every(token => haystack.includes(token))
}

const metricValue = (item: CatalogEntry, metricId: string): number | undefined =>
  item.metrics.find(m => m.id === metricId)?.value

/** Filters `entries` according to `filters` and sorts stably by `filters.sort` (built-in or plugin metric). */
export const filterAndSortCatalog = (
  entries: readonly CatalogEntry[],
  filters: CatalogFilterState,
  intlOrLocale?: IntlShape | string,
  metricDirections?: ReadonlyMap<string, 'asc' | 'desc'>,
): CatalogEntry[] => {
  const tokens = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const labelForSubtag = tokens.length && intlOrLocale ? makeLanguageLabeler(intlOrLocale) : undefined
  const filtered = entries.filter(item => {
    if (filters.sourceId && item.sourceId !== filters.sourceId) return false
    if (filters.quality && !item.videoQualities.some(q => canonicalQualityKey(q) === filters.quality)) return false
    if (filters.audio && !item.audioLanguages.some(tag => normalizeLanguageSubtag(tag) === filters.audio)) return false
    if (filters.subtitle && !item.subtitleLanguages.some(tag => normalizeLanguageSubtag(tag) === filters.subtitle)) return false
    if (filters.badgeIds.length && !filters.badgeIds.every(id => item.badges.some(b => b.id === id))) return false
    if (filters.playableOnly && item.external) return false
    return matchesTokens(item, tokens, labelForSubtag)
  })

  if (filters.sort === 'recommended') return filtered
  const metricId = filters.sort.startsWith('metric:') ? filters.sort.slice(7) : undefined
  const metricDir = metricId ? (metricDirections?.get(metricId) ?? 'desc') : undefined
  return [...filtered].sort((a, b) => {
    let cmp = 0
    if (metricId) {
      const av = metricValue(a, metricId)
      const bv = metricValue(b, metricId)
      cmp = metricDir === 'asc' ? compareNullableAsc(av, bv) : compareNullableDesc(av, bv)
    } else {
      switch (filters.sort) {
        case 'quality':
          cmp = qualityRank(b.videoQualities, b.resolution) - qualityRank(a.videoQualities, a.resolution)
          break
        case 'size-asc':
          cmp = compareNullableAsc(a.sizeBytes, b.sizeBytes)
          break
        case 'size-desc':
          cmp = compareNullableDesc(a.sizeBytes, b.sizeBytes)
          break
        case 'newest':
          cmp = compareNullableDesc(a.publishedAt, b.publishedAt)
          break
      }
    }
    return cmp || a.orderIndex - b.orderIndex
  })
}
