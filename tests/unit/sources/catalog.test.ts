import type { WatchSource } from '../../../src/components/source-selector'
import type { CatalogItem } from '../../../src/plugin-sdk'

import { describe, expect, test } from 'vite-plus/test'

import {
  buildCatalogEntries,
  cleanItemTitle,
  DEFAULT_CATALOG_FILTERS,
  extractCatalogOptions,
  filterAndSortCatalog,
  formatBytes,
  formatRelativeAge,
  normalizeLanguageSubtag,
  parseSizeToBytes,
} from '../../../src/sources/catalog'

const sources: WatchSource[] = [
  {
    id: 'provider-a',
    name: 'Provider A',
    external: false,
    active: false,
    releases: [
      { uri: 'provider-a:low', label: '[GroupX] Show - 01 (720p).mkv', href: '/watch/m/e/provider-a:low', external: false, active: false },
      { uri: 'provider-a:uhd', label: '[GroupY] Show - 01 (2160p HDR).mkv', href: '/watch/m/e/provider-a:uhd', external: false, active: true },
    ],
  },
  {
    id: 'provider-b',
    name: 'Provider B',
    uri: 'provider-b:ext',
    href: 'https://provider-b.example/watch/1',
    external: true,
    active: false,
    videoQualities: ['1080p'],
    audioLanguages: ['en-US'],
    subtitleLanguages: ['mul'],
  },
]

const catalogItems = new Map<string, CatalogItem>([
  [
    'provider-a:low',
    {
      uri: 'provider-a:low',
      title: 'Clean Show E01',
      rawTitle: '[GroupX] Show - 01 (720p).mkv',
      subtitle: 'GroupX',
      resolution: 720,
      videoQualities: ['720p'],
      audioLanguages: ['ja-JP'],
      subtitleLanguages: ['en-US'],
      sizeBytes: 350 * 1024 * 1024,
      publishedAt: 1_700_000_000_000,
      badges: [{ id: 'featured', label: 'Featured', tone: 'positive', filterable: true }],
      metrics: [{ id: 'popularity', label: 'Score', value: 15, sort: 'desc' }],
    },
  ],
  [
    'provider-a:uhd',
    {
      uri: 'provider-a:uhd',
      title: 'Clean Show E01',
      rawTitle: '[GroupY] Show - 01 (2160p HDR).mkv',
      subtitle: 'GroupY',
      resolution: 2160,
      videoQualities: ['4K', 'HDR'],
      audioLanguages: ['ja-JP', 'en-US'],
      subtitleLanguages: ['fr-FR'],
      sizeText: '2.5 GiB',
      publishedAt: 1_700_100_000_000,
      badges: [{ id: 'featured', label: 'Featured', tone: 'positive', filterable: true }],
      metrics: [{ id: 'popularity', label: 'Score', value: 98, sort: 'desc' }],
    },
  ],
])

describe('generic source catalog engine', () => {
  test('builds uniform entries merging single sources, item collections, and catalog enrichment', () => {
    const entries = buildCatalogEntries(sources, catalogItems)
    expect(entries.map(e => e.uri)).toEqual(['provider-a:low', 'provider-a:uhd', 'provider-b:ext'])
    expect(entries[0]?.displayTitle).toBe('Clean Show E01')
    expect(entries[0]?.rawTitle).toBe('[GroupX] Show - 01 (720p).mkv')
    expect(entries[0]?.hasRawVariant).toBe(true)
    expect(entries[1]?.sizeBytes).toBe(parseSizeToBytes('2.5 GiB'))
    expect(entries[2]?.videoQualities).toEqual(['1080p'])
  })

  test('extracts normalized filter options including quality aliases, language subtags, badges, and dynamic metrics', () => {
    const entries = buildCatalogEntries(sources, catalogItems)
    const options = extractCatalogOptions(entries, 'en')
    expect(options.sources.map(s => [s.value, s.count])).toEqual([['provider-a', 2], ['provider-b', 1]])
    expect(options.qualities.map(q => q.value)).toEqual(['2160p', '1080p', '720p', 'HDR'])
    expect(options.audioLanguages.map(l => l.value)).toEqual(['en', 'ja'])
    expect(options.subtitleLanguages.map(l => l.value)).toEqual(['en', 'fr', 'mul'])
    expect(options.badges).toEqual([{ value: 'featured', label: 'Featured', count: 2 }])
    expect(options.metricSorts).toEqual([{ id: 'popularity', label: 'Score', direction: 'desc' }])
    expect(options.hasPlayableToggle).toBe(true)
    expect(options.hasSizes).toBe(true)
    expect(options.hasDates).toBe(true)
  })

  test('filters by query, quality alias, language subtag, badge, playableOnly and sorts by built-in and plugin metric keys', () => {
    const entries = buildCatalogEntries(sources, catalogItems)
    const metricDirs = new Map([['popularity', 'desc' as const]])

    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, query: '2160p' }, 'en').map(e => e.uri)).toEqual(['provider-a:uhd'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, quality: '2160p' }, 'en').map(e => e.uri)).toEqual(['provider-a:uhd'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, audio: 'ja' }, 'en').map(e => e.uri)).toEqual(['provider-a:low', 'provider-a:uhd'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, subtitle: 'mul' }, 'en').map(e => e.uri)).toEqual(['provider-b:ext'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, playableOnly: true }, 'en').map(e => e.uri)).toEqual(['provider-a:low', 'provider-a:uhd'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, badgeIds: ['featured'], sort: 'metric:popularity' }, 'en', metricDirs).map(e => e.uri)).toEqual(['provider-a:uhd', 'provider-a:low'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, sort: 'size-desc' }, 'en').map(e => e.uri)).toEqual(['provider-a:uhd', 'provider-a:low', 'provider-b:ext'])
    expect(filterAndSortCatalog(entries, { ...DEFAULT_CATALOG_FILTERS, sort: 'newest' }, 'en').map(e => e.uri)).toEqual(['provider-a:uhd', 'provider-a:low', 'provider-b:ext'])
  })

  test('formats titles, byte sizes, relative ages, and BCP 47 subtags cleanly', () => {
    expect(cleanItemTitle('[Group] Title - 01 (1080p).mkv')).toBe('Title - 01')
    expect(normalizeLanguageSubtag('zh-Hans-CN')).toBe('zh')
    expect(normalizeLanguageSubtag('MUL')).toBe('mul')
    expect(formatBytes(1_500_000_000, 'en')).toBeTruthy()
    expect(formatRelativeAge(1_000_000, 'en', 1_000_000 + 3 * 86_400_000)).toBeTruthy()
  })
})
