import type { CatalogAction, CatalogActionIcon, CatalogActionResult, CatalogItem, CatalogTone } from '../plugin-sdk'
import type { WatchSource } from './source-selector'

import { css } from '@emotion/react'
import { ArrowLeft, Check, Copy, Download, ExternalLink, Info, LayoutGrid, List, Play, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import {
  buildCatalogEntries,
  DEFAULT_CATALOG_FILTERS,
  extractCatalogOptions,
  filterAndSortCatalog,
  formatBytes,
  formatRelativeAge,
  languageName,
  type CatalogEntry,
  type CatalogFilterState,
  type CatalogSortKey,
} from '../sources/catalog'
import {
  brandColor,
  detailed,
  Details,
  MARKS,
  SourceIcon,
  SourceLink,
  style as sourceSelectorBaseStyle,
} from './source-selector'

export type SourceBrowserProps = {
  sources: WatchSource[]
  catalogItems?: ReadonlyMap<string, CatalogItem>
  variant: 'inline' | 'dialog'
  defaultView?: 'cards' | 'list'
  onSelectHref?: (href: string) => void
  onOpenPicker?: (source: WatchSource) => void
  onRunAction?: (origin: string, uri: string, actionId: string) => Promise<CatalogActionResult | null>
  onRefreshCatalog?: () => void
  onClose?: () => void
}

const PAGE_SIZE = 60

const browserStyle = css`
  ${sourceSelectorBaseStyle}

  &.watch {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
  }

  & > .label {
    grid-column: 1;
    justify-self: start;
    min-width: 0;
  }

  .view-toggle {
    grid-column: 2;
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.7rem;
    background: rgba(255, 255, 255, 0.03);
  }

  .view-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.75rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;

    &:hover,
    &:focus-visible {
      color: #fff;
      background: rgba(255, 255, 255, 0.07);
      outline: none;
    }

    &[aria-pressed='true'] {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
    }
  }

  .list,
  .catalog {
    grid-column: 1 / -1;
    min-width: 0;
  }

  &.dialog {
    gap: 0.8rem;
  }

  .dialog-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .catalog {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .folder-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 0.65rem 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.85rem;
    background: rgb(28, 28, 30);
  }

  .folder-title {
    --brand: #9aa0a6;
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
    font-size: 1.4rem;
    font-weight: 600;
    color: #fff;

    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 0.5rem;
      background: color-mix(in srgb, var(--brand) 16%, rgba(255, 255, 255, 0.04));
      color: var(--brand);
      font-size: 1.2rem;
      font-weight: 700;
      text-transform: uppercase;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 0.25rem;
        box-sizing: border-box;
      }
    }

    .folder-count {
      padding: 0.1rem 0.55rem;
      border-radius: 0.9rem;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.75);
      font-size: 1.15rem;
      font-weight: 600;
    }
  }

  .back-btn,
  .picker-btn,
  .chip-btn,
  .clear-btn,
  .more-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.85rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.65rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.82);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.11);
      border-color: rgba(255, 255, 255, 0.22);
      color: #fff;
      outline: none;
    }
  }

  .chip-btn[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.35);
    color: #fff;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .search-wrap {
    position: relative;
    flex: 1 1 18rem;
    min-width: 14rem;
    display: flex;
    align-items: center;

    svg {
      position: absolute;
      inset-inline-start: 0.9rem;
      color: rgba(255, 255, 255, 0.45);
      pointer-events: none;
    }

    input {
      width: 100%;
      padding-block: 0.55rem;
      padding-inline: 2.9rem 0.9rem;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 0.65rem;
      background: rgb(24, 24, 27);
      color: #fff;
      font: inherit;
      font-size: 1.25rem;

      &::placeholder {
        color: rgba(255, 255, 255, 0.42);
      }

      &:focus-visible {
        border-color: rgba(255, 255, 255, 0.32);
        outline: none;
      }
    }
  }

  .select {
    padding: 0.55rem 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.65rem;
    background: rgb(24, 24, 27);
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:focus-visible {
      border-color: rgba(255, 255, 255, 0.32);
      outline: none;
    }
  }

  .toggles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .entries {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  &.watch .entries {
    box-sizing: border-box;
    max-height: clamp(28rem, 58vh, 56rem);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.2rem;
    padding-inline-end: 0.4rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;

    > * {
      flex-shrink: 0;
    }
  }

  .entry-row {
    display: flex;
    align-items: stretch;
    gap: 0.45rem;
    min-width: 0;
  }

  .entry-main {
    flex: 1;
    min-width: 0;
    justify-content: flex-start;
    align-items: center;
    padding-block: 0.75rem;
    padding-inline: 1rem 1.2rem;

    &:hover {
      transform: none;
    }
  }

  .entry-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .entry-top {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .entry-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.35rem;
    font-weight: 500;
    color: inherit;
  }

  .entry-sub {
    flex-shrink: 0;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.15rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .entry-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.65rem;
    font-size: 1.15rem;
    color: rgba(255, 255, 255, 0.68);
  }

  .tag,
  .badge,
  .metric {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    padding: 0.15rem 0.55rem;
    border-radius: 0.45rem;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.82);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .tone-positive {
    background: rgba(46, 204, 113, 0.16);
    color: #6ee7a8;
  }

  .tone-warning {
    background: rgba(243, 156, 18, 0.16);
    color: #f8c471;
  }

  .tone-muted {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.55);
  }

  .meta-lang,
  .meta-text {
    color: rgba(255, 255, 255, 0.65);
  }

  .entry-trailing {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    background: rgb(28, 28, 30);
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;

    &:hover,
    &:focus-visible {
      background: rgb(38, 38, 42);
      border-color: rgba(255, 255, 255, 0.22);
      color: #fff;
      outline: none;
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &[data-failed='true'] {
      border-color: rgba(231, 76, 60, 0.65);
      color: #ff8a80;
    }
  }

  .action-status {
    font-size: 1.2rem;
    color: rgba(255, 255, 255, 0.78);

    &:empty {
      display: none;
    }
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.85rem;
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.7);
    font-size: 1.25rem;
  }
`

const toneClass = (tone?: CatalogTone) =>
  tone === 'positive' ? 'tone-positive'
    : tone === 'warning' ? 'tone-warning'
      : tone === 'muted' ? 'tone-muted'
        : ''

const ActionIconGlyph = ({ icon, copied }: { icon?: CatalogActionIcon, copied: boolean }) => {
  if (copied && (!icon || icon === 'copy')) return <Check size={14} aria-hidden="true" />
  switch (icon) {
    case 'copy': return <Copy size={14} aria-hidden="true" />
    case 'download': return <Download size={14} aria-hidden="true" />
    case 'external': return <ExternalLink size={14} aria-hidden="true" />
    case 'info': return <Info size={14} aria-hidden="true" />
    default: return <Sparkles size={14} aria-hidden="true" />
  }
}

const EntryRowIcon = ({ entry }: { entry: CatalogEntry }) => {
  const [failed, setFailed] = useState(false)
  return (
    <span className="icon">
      {entry.sourceIcon && !failed
        ? <img src={entry.sourceIcon} alt="" onError={() => setFailed(true)} />
        : entry.sourceName.charAt(0)}
    </span>
  )
}

const triggerDownload = (filename: string, mimeType: string | undefined, base64: string): boolean => {
  try {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 1_000)
    return true
  } catch {
    return false
  }
}

export const SourceBrowser = ({
  sources,
  catalogItems,
  variant,
  defaultView,
  onSelectHref,
  onOpenPicker,
  onRunAction,
  onRefreshCatalog,
  onClose,
}: SourceBrowserProps) => {
  const intl = useIntl()
  const [view, setView] = useState<'cards' | 'list'>(() => defaultView ?? (variant === 'dialog' ? 'list' : 'cards'))
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [filters, setFilters] = useState<CatalogFilterState>(DEFAULT_CATALOG_FILTERS)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [failedAction, setFailedAction] = useState<{ key: string, message: string } | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const timer of timersRef.current) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [])

  const folderSource = useMemo(
    () => (activeFolder ? sources.find(source => source.id === activeFolder) ?? null : null),
    [sources, activeFolder],
  )

  useEffect(() => {
    if (activeFolder && !folderSource) setActiveFolder(null)
  }, [activeFolder, folderSource])

  const inFolder = view === 'cards' && folderSource !== null
  const showCatalog = view === 'list' || inFolder
  const scopedSources = useMemo(
    () => (inFolder && folderSource ? [folderSource] : sources),
    [inFolder, folderSource, sources],
  )

  const entries = useMemo(
    () => buildCatalogEntries(scopedSources, catalogItems),
    [scopedSources, catalogItems],
  )
  const options = useMemo(
    () => extractCatalogOptions(entries, intl),
    [entries, intl],
  )
  const metricDirections = useMemo(
    () => new Map(options.metricSorts.map(metric => [metric.id, metric.direction] as const)),
    [options.metricSorts],
  )

  const effectiveFilters = useMemo<CatalogFilterState>(() => ({
    ...filters,
    sourceId: inFolder ? '' : (options.sources.some(s => s.value === filters.sourceId) ? filters.sourceId : ''),
    quality: options.qualities.some(q => q.value === filters.quality) ? filters.quality : '',
    audio: options.audioLanguages.some(l => l.value === filters.audio) ? filters.audio : '',
    subtitle: options.subtitleLanguages.some(l => l.value === filters.subtitle) ? filters.subtitle : '',
    badgeIds: filters.badgeIds.filter(id => options.badges.some(b => b.value === id)),
    playableOnly: options.hasPlayableToggle ? filters.playableOnly : false,
    showRaw: options.hasRawToggle ? filters.showRaw : false,
    sort: filters.sort.startsWith('metric:') && !metricDirections.has(filters.sort.slice(7)) ? 'recommended' : filters.sort,
  }), [filters, inFolder, options, metricDirections])

  const filtered = useMemo(
    () => filterAndSortCatalog(entries, effectiveFilters, intl, metricDirections),
    [entries, effectiveFilters, intl, metricDirections],
  )

  const badgeFilterKey = effectiveFilters.badgeIds.join('\u0000')

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [
    view,
    activeFolder,
    effectiveFilters.query,
    effectiveFilters.sourceId,
    effectiveFilters.quality,
    effectiveFilters.audio,
    effectiveFilters.subtitle,
    badgeFilterKey,
    effectiveFilters.sort,
    effectiveFilters.playableOnly,
  ])

  if (!sources.length) return null

  const scheduleClear = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      if (mountedRef.current) fn()
    }, ms)
    timersRef.current.add(timer)
  }

  const announceStatus = (message: string, clearAfterMs = 3_000) => {
    setStatusMessage(message)
    if (clearAfterMs > 0) {
      scheduleClear(() => {
        setStatusMessage(current => current === message ? '' : current)
      }, clearAfterMs)
    }
  }

  const recordFailure = (key: string, message: string) => {
    setFailedAction({ key, message })
    announceStatus(message, 3_000)
    scheduleClear(() => {
      setFailedAction(current => current?.key === key ? null : current)
    }, 3_000)
  }

  const handleAction = async (entry: CatalogEntry, action: CatalogAction) => {
    const key = `${entry.uri}\u0000${action.id}`
    if (!onRunAction) {
      recordFailure(key, intl.formatMessage({ id: 'Could not complete action.', defaultMessage: 'Could not complete action.' }))
      return
    }
    setBusyKey(key)
    setFailedAction(current => current?.key === key ? null : current)
    try {
      const result = await onRunAction(entry.sourceId, entry.uri, action.id)
      if (!mountedRef.current) return
      if (!result) {
        recordFailure(key, intl.formatMessage({ id: 'Could not complete action.', defaultMessage: 'Could not complete action.' }))
        return
      }
      switch (result.kind) {
        case 'copy': {
          try {
            await navigator.clipboard.writeText(result.text)
            if (!mountedRef.current) return
            setCopiedKey(key)
            if (result.message) announceStatus(result.message, 1_500)
            scheduleClear(() => {
              setCopiedKey(current => current === key ? null : current)
            }, 1_500)
          } catch {
            if (mountedRef.current) {
              recordFailure(key, intl.formatMessage({ id: 'Could not copy text.', defaultMessage: 'Could not copy text.' }))
            }
          }
          break
        }
        case 'download': {
          const ok = triggerDownload(result.filename, result.mimeType, result.base64)
          if (!ok) {
            recordFailure(key, intl.formatMessage({ id: 'Could not download file.', defaultMessage: 'Could not download file.' }))
          } else if (result.message) {
            announceStatus(result.message, 2_000)
          }
          break
        }
        case 'open':
          window.open(result.url, '_blank', 'noopener,noreferrer')
          break
        case 'refresh':
          if (result.message) announceStatus(result.message, 2_000)
          onRefreshCatalog?.()
          break
        case 'done':
          if (result.message) announceStatus(result.message, 2_000)
          break
        case 'error':
          recordFailure(key, result.message || intl.formatMessage({ id: 'Could not complete action.', defaultMessage: 'Could not complete action.' }))
          break
      }
    } catch {
      if (mountedRef.current) {
        recordFailure(key, intl.formatMessage({ id: 'Could not complete action.', defaultMessage: 'Could not complete action.' }))
      }
    } finally {
      if (mountedRef.current) setBusyKey(current => current === key ? null : current)
    }
  }

  const switchView = (next: 'cards' | 'list') => {
    setView(next)
    if (next === 'list') setActiveFolder(null)
  }

  const toggleBadge = (id: string) => {
    setFilters(prev => ({
      ...prev,
      badgeIds: prev.badgeIds.includes(id)
        ? prev.badgeIds.filter(existing => existing !== id)
        : [...prev.badgeIds, id],
    }))
  }

  const hasActiveFilters = Boolean(
    effectiveFilters.query.trim()
    || effectiveFilters.sourceId
    || effectiveFilters.quality
    || effectiveFilters.audio
    || effectiveFilters.subtitle
    || effectiveFilters.badgeIds.length
    || effectiveFilters.playableOnly
    || effectiveFilters.sort !== 'recommended',
  )

  const clearFilters = () => {
    setFilters({ ...DEFAULT_CATALOG_FILTERS, showRaw: effectiveFilters.showRaw })
  }

  const legacyPickers = scopedSources.filter(source => source.picker && !source.hasCatalog)
  const shownEntries = filtered.slice(0, visibleCount)
  const remaining = filtered.length - shownEntries.length
  const withCount = (label: string, count: number) => `${label} (${intl.formatNumber(count)})`
  const showMoreText = `${intl.formatMessage({ id: 'Show more', defaultMessage: 'Show more' })} (${intl.formatNumber(shownEntries.length)}/${intl.formatNumber(filtered.length)})`

  const viewToggle = (
    <div className="view-toggle" role="group" aria-label={intl.formatMessage({ id: 'View', defaultMessage: 'View' })}>
      <button
        type="button"
        className="view-btn"
        aria-pressed={view === 'cards'}
        onClick={() => switchView('cards')}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span>{intl.formatMessage({ id: 'Cards', defaultMessage: 'Cards' })}</span>
      </button>
      <button
        type="button"
        className="view-btn"
        aria-pressed={view === 'list'}
        onClick={() => switchView('list')}
      >
        <List size={14} aria-hidden="true" />
        <span>{intl.formatMessage({ id: 'List', defaultMessage: 'List' })}</span>
      </button>
    </div>
  )

  const renderPrimaryRow = (entry: CatalogEntry) => {
    const title = effectiveFilters.showRaw ? entry.rawTitle : entry.displayTitle
    const rowLabel = title || entry.sourceName
    const topQualities = entry.videoQualities.slice(0, 3)
    const audioNames = [...new Set(entry.audioLanguages.map(tag => languageName(intl, tag)))].slice(0, 3)
    const subNames = [...new Set(entry.subtitleLanguages.map(tag => languageName(intl, tag)))].slice(0, 3)
    const sizeLabel = formatBytes(entry.sizeBytes, intl.locale, entry.sizeText)
    const ageLabel = formatRelativeAge(entry.publishedAt, intl.locale)
    const className = `source entry-main${entry.active ? ' active' : ''}${entry.isItem ? ' release' : ''}`

    const content = (
      <>
        <EntryRowIcon entry={entry} />
        <span className="entry-content">
          <span className="entry-top">
            <span className="entry-title">{rowLabel}</span>
            {entry.subtitle ? <span className="entry-sub">{entry.subtitle}</span> : undefined}
          </span>
          {(entry.isItem && !inFolder) || topQualities.length || audioNames.length || subNames.length || sizeLabel || ageLabel || entry.badges.length || entry.metrics.length
            ? (
              <span className="entry-meta">
                {!inFolder && entry.isItem ? <span className="tag">{entry.sourceName}</span> : undefined}
                {topQualities.map(q => <span key={q} className="tag">{q}</span>)}
                {audioNames.length ? (
                  <span className="meta-lang">
                    {intl.formatMessage({ id: '{label}: {names}', defaultMessage: '{label}: {names}' }, {
                      label: intl.formatMessage({ id: 'Audio', defaultMessage: 'Audio' }),
                      names: audioNames.join(', '),
                    })}
                  </span>
                ) : undefined}
                {subNames.length ? (
                  <span className="meta-lang">
                    {intl.formatMessage({ id: '{label}: {names}', defaultMessage: '{label}: {names}' }, {
                      label: intl.formatMessage({ id: 'Subtitles', defaultMessage: 'Subtitles' }),
                      names: subNames.join(', '),
                    })}
                  </span>
                ) : undefined}
                {sizeLabel ? <span className="meta-text">{sizeLabel}</span> : undefined}
                {ageLabel ? <span className="meta-text">{ageLabel}</span> : undefined}
                {entry.badges.map(badge => (
                  <span key={badge.id} className={`badge ${toneClass(badge.tone)}`}>{badge.label}</span>
                ))}
                {entry.metrics.map(metric => (
                  <span key={metric.id} className={`metric ${toneClass(metric.tone)}`} title={metric.label}>
                    {metric.label} {metric.display ?? intl.formatNumber(metric.value)}
                  </span>
                ))}
              </span>
            )
            : undefined}
        </span>
        <span className="entry-trailing">
          {entry.active
            ? <span className="playing"><i/><i/><i/></span>
            : entry.external || !entry.href
              ? <span className="ext">{MARKS.external}</span>
              : <span className="play">{MARKS.play}</span>}
        </span>
      </>
    )

    if (variant === 'dialog') {
      return !entry.external && entry.href ? (
        <button
          type="button"
          className={className}
          style={{ '--brand': brandColor({ id: entry.sourceId, name: entry.sourceName, color: entry.sourceColor, external: entry.external, active: entry.active }) }}
          aria-current={entry.active ? 'true' : undefined}
          title={entry.rowTitle}
          onClick={() => onSelectHref?.(entry.href!)}
        >
          {content}
        </button>
      ) : (
        <a
          className={className}
          style={{ '--brand': brandColor({ id: entry.sourceId, name: entry.sourceName, color: entry.sourceColor, external: entry.external, active: entry.active }) }}
          aria-current={entry.active ? 'true' : undefined}
          href={entry.href}
          target="_blank"
          rel="noreferrer"
          title={entry.rowTitle}
          onClick={() => onClose?.()}
        >
          {content}
        </a>
      )
    }

    return (
      <SourceLink
        className={className}
        style={{ '--brand': brandColor({ id: entry.sourceId, name: entry.sourceName, color: entry.sourceColor, external: entry.external, active: entry.active }) }}
        href={entry.href}
        external={entry.external}
        aria-current={entry.active ? 'true' : undefined}
        title={entry.rowTitle}
      >
        {content}
      </SourceLink>
    )
  }

  return (
    <div css={browserStyle} className={variant === 'dialog' ? 'dialog' : 'watch'}>
      {variant === 'inline'
        ? (
          <>
            <div className="label">{intl.formatMessage({ id: 'Watch on', defaultMessage: 'Watch on' })}</div>
            {viewToggle}
          </>
        )
        : (
          <div className="dialog-bar">
            {viewToggle}
          </div>
        )}

      {!showCatalog
        ? (
          <div className="list">
            {sources.map(source => {
              const releases = source.releases ?? []
              const hasMultiple = releases.length > 1
              if (hasMultiple) {
                const ownedLegacy = Boolean(source.picker && !source.hasCatalog)
                const head = (
                  <>
                    <SourceIcon source={source} />
                    <span className="name">{source.name}</span>
                    <span className="count">{releases.length}</span>
                    <span className={ownedLegacy ? 'chevron' : 'chevron closed'}>
                      {ownedLegacy ? MARKS.picker : MARKS.closed}
                    </span>
                  </>
                )
                const card = variant === 'inline' && detailed(source)
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`source${card ? ' detailed' : ''}${source.active ? ' active' : ''}`}
                    aria-current={source.active ? 'true' : undefined}
                    style={{ '--brand': brandColor(source) }}
                    title={intl.formatMessage({
                      id: '{count, plural, one {{count} release on {name}} other {{count} releases on {name}}}',
                      defaultMessage: '{count, plural, one {{count} release on {name}} other {{count} releases on {name}}}',
                    }, { count: releases.length, name: source.name })}
                    aria-haspopup={ownedLegacy ? 'dialog' : undefined}
                    onClick={() => ownedLegacy && onOpenPicker ? onOpenPicker(source) : setActiveFolder(source.id)}
                  >
                    {card ? <Details source={source} head={head} /> : head}
                  </button>
                )
              }

              const head = (
                <>
                  <SourceIcon source={source} />
                  <span className="name">{source.name}</span>
                  {source.active
                    ? <span className="playing"><i/><i/><i/></span>
                    : source.external
                      ? <span className="ext">{MARKS.external}</span>
                      : <span className="play">{MARKS.play}</span>}
                </>
              )
              const card = variant === 'inline' && detailed(source)

              if (variant === 'dialog' && !source.external && source.href) {
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`source${source.active ? ' active' : ''}`}
                    aria-current={source.active ? 'true' : undefined}
                    style={{ '--brand': brandColor(source) }}
                    title={source.name}
                    onClick={() => onSelectHref?.(source.href!)}
                  >
                    {head}
                  </button>
                )
              }

              return (
                <SourceLink
                  key={source.id}
                  className={`source${card ? ' detailed' : ''}${source.active ? ' active' : ''}`}
                  aria-current={source.active ? 'true' : undefined}
                  style={{ '--brand': brandColor(source) }}
                  href={source.href}
                  external={source.external}
                  title={source.name}
                  onClick={variant === 'dialog' ? onClose : undefined}
                >
                  {card ? <Details source={source} head={head} /> : head}
                </SourceLink>
              )
            })}
          </div>
        )
        : (
          <div className="catalog">
            {inFolder && folderSource
              ? (
                <div className="folder-bar">
                  <button type="button" className="back-btn" onClick={() => setActiveFolder(null)}>
                    <ArrowLeft size={14} aria-hidden="true" />
                    <span>{intl.formatMessage({ id: 'Back to sources', defaultMessage: 'Back to sources' })}</span>
                  </button>
                  <span className="folder-title" style={{ '--brand': brandColor(folderSource) }}>
                    <SourceIcon source={folderSource} />
                    <span>{folderSource.name}</span>
                    <span className="folder-count">{folderSource.releases?.length ?? 0}</span>
                  </span>
                  {folderSource.picker && onOpenPicker
                    ? (
                      <button
                        type="button"
                        className="picker-btn"
                        aria-label={intl.formatMessage({ id: 'Choose a source from {name}', defaultMessage: 'Choose a source from {name}' }, { name: folderSource.name })}
                        onClick={() => onOpenPicker(folderSource)}
                      >
                        <SlidersHorizontal size={13} aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'Release picker', defaultMessage: 'Release picker' })}</span>
                      </button>
                    )
                    : undefined}
                </div>
              )
              : undefined}

            <div className="toolbar">
              <div className="controls">
                <div className="search-wrap">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    value={effectiveFilters.query}
                    aria-label={intl.formatMessage({ id: 'Search sources', defaultMessage: 'Search sources' })}
                    placeholder={intl.formatMessage({ id: 'Search sources', defaultMessage: 'Search sources' })}
                    onInput={event => setFilters(prev => ({ ...prev, query: (event.currentTarget as HTMLInputElement).value }))}
                  />
                </div>

                {!inFolder && options.sources.length > 1
                  ? (
                    <select
                      className="select"
                      aria-label={intl.formatMessage({ id: 'All sources', defaultMessage: 'All sources' })}
                      value={effectiveFilters.sourceId}
                      onChange={event => setFilters(prev => ({ ...prev, sourceId: (event.currentTarget as HTMLSelectElement).value }))}
                    >
                      <option value="">{intl.formatMessage({ id: 'All sources', defaultMessage: 'All sources' })}</option>
                      {options.sources.map(option => (
                        <option key={option.value} value={option.value}>{withCount(option.label, option.count)}</option>
                      ))}
                    </select>
                  )
                  : undefined}

                {options.qualities.length > 0
                  ? (
                    <select
                      className="select"
                      aria-label={intl.formatMessage({ id: 'All qualities', defaultMessage: 'All qualities' })}
                      value={effectiveFilters.quality}
                      onChange={event => setFilters(prev => ({ ...prev, quality: (event.currentTarget as HTMLSelectElement).value }))}
                    >
                      <option value="">{intl.formatMessage({ id: 'All qualities', defaultMessage: 'All qualities' })}</option>
                      {options.qualities.map(option => (
                        <option key={option.value} value={option.value}>{withCount(option.label, option.count)}</option>
                      ))}
                    </select>
                  )
                  : undefined}

                {options.audioLanguages.length > 0
                  ? (
                    <select
                      className="select"
                      aria-label={intl.formatMessage({ id: 'Audio', defaultMessage: 'Audio' })}
                      value={effectiveFilters.audio}
                      onChange={event => setFilters(prev => ({ ...prev, audio: (event.currentTarget as HTMLSelectElement).value }))}
                    >
                      <option value="">{intl.formatMessage({ id: 'All languages', defaultMessage: 'All languages' })}</option>
                      {options.audioLanguages.map(option => (
                        <option key={option.value} value={option.value}>{withCount(option.label, option.count)}</option>
                      ))}
                    </select>
                  )
                  : undefined}

                {options.subtitleLanguages.length > 0
                  ? (
                    <select
                      className="select"
                      aria-label={intl.formatMessage({ id: 'Subtitles', defaultMessage: 'Subtitles' })}
                      value={effectiveFilters.subtitle}
                      onChange={event => setFilters(prev => ({ ...prev, subtitle: (event.currentTarget as HTMLSelectElement).value }))}
                    >
                      <option value="">{intl.formatMessage({ id: 'All languages', defaultMessage: 'All languages' })}</option>
                      {options.subtitleLanguages.map(option => (
                        <option key={option.value} value={option.value}>{withCount(option.label, option.count)}</option>
                      ))}
                    </select>
                  )
                  : undefined}

                <select
                  className="select"
                  aria-label={intl.formatMessage({ id: 'Sort by', defaultMessage: 'Sort by' })}
                  value={effectiveFilters.sort}
                  onChange={event => setFilters(prev => ({ ...prev, sort: (event.currentTarget as HTMLSelectElement).value as CatalogSortKey }))}
                >
                  <option value="recommended">{intl.formatMessage({ id: 'Recommended', defaultMessage: 'Recommended' })}</option>
                  {options.hasQualities
                    ? <option value="quality">{intl.formatMessage({ id: 'Quality', defaultMessage: 'Quality' })}</option>
                    : undefined}
                  {options.hasSizes
                    ? (
                      <>
                        <option value="size-desc">{intl.formatMessage({ id: 'Size (largest)', defaultMessage: 'Size (largest)' })}</option>
                        <option value="size-asc">{intl.formatMessage({ id: 'Size (smallest)', defaultMessage: 'Size (smallest)' })}</option>
                      </>
                    )
                    : undefined}
                  {options.hasDates
                    ? <option value="newest">{intl.formatMessage({ id: 'Newest', defaultMessage: 'Newest' })}</option>
                    : undefined}
                  {options.metricSorts.map(metric => (
                    <option key={metric.id} value={`metric:${metric.id}`}>{metric.label}</option>
                  ))}
                </select>
              </div>

              {(options.badges.length > 0 || options.hasPlayableToggle || options.hasRawToggle || (!inFolder && legacyPickers.length > 0 && onOpenPicker))
                ? (
                  <div className="toggles">
                    {options.badges.map(badge => (
                      <button
                        key={badge.value}
                        type="button"
                        className="chip-btn"
                        aria-pressed={effectiveFilters.badgeIds.includes(badge.value)}
                        onClick={() => toggleBadge(badge.value)}
                      >
                        {withCount(badge.label, badge.count)}
                      </button>
                    ))}
                    {options.hasPlayableToggle
                      ? (
                        <button
                          type="button"
                          className="chip-btn"
                          aria-pressed={effectiveFilters.playableOnly}
                          onClick={() => setFilters(prev => ({ ...prev, playableOnly: !prev.playableOnly }))}
                        >
                          {intl.formatMessage({ id: 'Playable here', defaultMessage: 'Playable here' })}
                        </button>
                      )
                      : undefined}
                    {options.hasRawToggle
                      ? (
                        <button
                          type="button"
                          className="chip-btn"
                          aria-pressed={effectiveFilters.showRaw}
                          onClick={() => setFilters(prev => ({ ...prev, showRaw: !prev.showRaw }))}
                        >
                          {intl.formatMessage({ id: 'Full title', defaultMessage: 'Full title' })}
                        </button>
                      )
                      : undefined}
                    {!inFolder && onOpenPicker
                      ? legacyPickers.map(source => (
                        <button
                          key={source.id}
                          type="button"
                          className="picker-btn"
                          aria-label={intl.formatMessage({ id: 'Choose a source from {name}', defaultMessage: 'Choose a source from {name}' }, { name: source.name })}
                          onClick={() => onOpenPicker(source)}
                        >
                          <SlidersHorizontal size={13} aria-hidden="true" />
                          <span>{intl.formatMessage({ id: 'Release picker', defaultMessage: 'Release picker' })}</span>
                        </button>
                      ))
                      : undefined}
                  </div>
                )
                : undefined}
            </div>

            <div className="action-status" role="status" aria-live="polite">{statusMessage}</div>

            {shownEntries.length
              ? (
                <div className="entries">
                  {shownEntries.map(entry => (
                    <div key={entry.uri} className="entry-row">
                      {renderPrimaryRow(entry)}
                      {entry.actions.length > 0
                        ? (
                          <div className="actions">
                            {entry.actions.map(action => {
                              const key = `${entry.uri}\u0000${action.id}`
                              const isFailed = failedAction?.key === key
                              const isCopied = copiedKey === key
                              return (
                                <button
                                  key={action.id}
                                  type="button"
                                  className="action-btn"
                                  data-failed={isFailed ? 'true' : undefined}
                                  disabled={busyKey === key}
                                  title={isFailed ? failedAction!.message : action.label}
                                  aria-label={action.label}
                                  onClick={() => { void handleAction(entry, action) }}
                                >
                                  <ActionIconGlyph icon={action.icon} copied={isCopied} />
                                </button>
                              )
                            })}
                          </div>
                        )
                        : undefined}
                    </div>
                  ))}
                  {remaining > 0
                    ? (
                      <button
                        type="button"
                        className="more-btn"
                        onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                      >
                        {showMoreText}
                      </button>
                    )
                    : undefined}
                </div>
              )
              : (
                <div className="empty">
                  <span>{intl.formatMessage({ id: 'No items match these filters.', defaultMessage: 'No items match these filters.' })}</span>
                  {hasActiveFilters
                    ? (
                      <button type="button" className="clear-btn" onClick={clearFilters}>
                        {intl.formatMessage({ id: 'Clear filters', defaultMessage: 'Clear filters' })}
                      </button>
                    )
                    : undefined}
                </div>
              )}
          </div>
        )}
    </div>
  )
}

export default SourceBrowser
