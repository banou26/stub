import type { SubtitleCandidate } from '../subtitles'

import { css } from '@emotion/react'
import { Check, Captions, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { subtitleLanguageLabel } from '../subtitles/languages'

const style = css`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.6rem;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);

  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 56rem;
    max-height: 100%;
    border-radius: 1rem;
    background: #161618;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.1rem 1.4rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .title {
    font-size: 1.4rem;
    font-weight: 600;
  }

  .spacer {
    margin-inline-start: auto;
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      outline: none;
    }
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 1rem 1.2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .search-form {
    flex: 1 1 20rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .search-box {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.85rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.65rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.6);

    &:focus-within {
      border-color: rgba(255, 255, 255, 0.28);
      color: #fff;
    }
  }

  .search-input {
    flex: 1;
    min-width: 0;
    padding: 0.6rem 0;
    border: none;
    background: transparent;
    color: #fff;
    font: inherit;
    font-size: 1.3rem;
    outline: none;

    &::placeholder {
      color: rgba(255, 255, 255, 0.42);
    }
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .select {
    max-width: 16rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.65rem;
    background: #1f1f22;
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    font-size: 1.25rem;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      border-color: rgba(255, 255, 255, 0.25);
      outline: none;
    }
  }

  .pickers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem 1.2rem 0;
  }

  .picker-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.65rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.85);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      outline: none;
    }
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 1rem 1.2rem 1.2rem;
    overflow-y: auto;
  }

  .empty {
    padding: 2rem 1rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1.3rem;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    min-width: 0;
    padding: 0.7rem 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.7rem;
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.18);
      outline: none;
    }

    &.active {
      background: rgba(244, 117, 33, 0.14);
      border-color: rgba(244, 117, 33, 0.5);
      color: #fff;
    }
  }

  .item-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .item-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.3rem;
    font-weight: 500;
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    color: rgba(255, 255, 255, 0.58);
    font-size: 1.15rem;
  }

  .badge {
    padding: 0.1rem 0.45rem;
    border-radius: 0.35rem;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    font-size: 1.05rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .trailing {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.65);
  }
`

export type SubtitleBrowserPluginPicker = {
  origin: string
  name: string
  icon?: string | null
}

export type SubtitleBrowserProps = {
  initialQuery?: string
  locale: string
  activeId?: string
  pluginPickers: SubtitleBrowserPluginPicker[]
  search: (query: string, signal?: AbortSignal) => Promise<SubtitleCandidate[]>
  onPick: (candidate: SubtitleCandidate) => void
  onOpenPluginPicker: (picker: SubtitleBrowserPluginPicker) => void
  onClose: () => void
}

const sourceKeyOf = (candidate: SubtitleCandidate): string =>
  candidate.pluginOrigin ? `plugin:${candidate.pluginOrigin}` : candidate.source

const sourceLabelOf = (candidate: SubtitleCandidate): string => {
  if (candidate.sourceName) return candidate.sourceName
  if (candidate.source === 'opensubtitles') return 'OpenSubtitles'
  if (candidate.source === 'xunlei') return 'Xunlei'
  return candidate.pluginOrigin ?? 'Plugin'
}

const HI_BADGE = 'HI'
const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * In-player external subtitle browser over the video stage, keeping fullscreen across browsing and picking.
 */
export const SubtitleBrowser = ({
  initialQuery = '',
  locale,
  activeId,
  pluginPickers,
  search,
  onPick,
  onOpenPluginPicker,
  onClose,
}: SubtitleBrowserProps) => {
  const intl = useIntl()
  const [query, setQuery] = useState(initialQuery)
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery)
  const [results, setResults] = useState<SubtitleCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [languageFilter, setLanguageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  const panelRef = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const latestSearch = useRef(search)
  latestSearch.current = search
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement as { focus?: () => void } | null
    window.focus?.()
    searchInput.current?.focus?.()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        latestClose.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter(element => element.getAttribute('aria-disabled') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (!panel.contains(active as Node)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus?.()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus?.()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSubmittedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    void latestSearch.current(submittedQuery, controller.signal)
      .then(items => {
        if (!active || controller.signal.aborted) return
        setResults(items)
        setLoading(false)
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return
        setResults([])
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [submittedQuery])

  const languages = useMemo(() => {
    const seen = new Map<string, string>()
    for (const candidate of results) {
      if (!seen.has(candidate.language)) {
        seen.set(candidate.language, subtitleLanguageLabel(candidate.language, locale))
      }
    }
    return [...seen.entries()].map(([code, label]) => ({ code, label }))
  }, [results, locale])

  const sources = useMemo(() => {
    const seen = new Map<string, string>()
    for (const candidate of results) {
      const key = sourceKeyOf(candidate)
      if (!seen.has(key)) seen.set(key, sourceLabelOf(candidate))
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }))
  }, [results])

  const activeLanguage = languages.some(entry => entry.code === languageFilter) ? languageFilter : ''
  const activeSource = sources.some(entry => entry.key === sourceFilter) ? sourceFilter : ''

  const filtered = useMemo(
    () => results.filter(candidate =>
      (!activeLanguage || candidate.language === activeLanguage)
      && (!activeSource || sourceKeyOf(candidate) === activeSource),
    ),
    [results, activeLanguage, activeSource],
  )

  const titleLabel = intl.formatMessage({ id: 'Subtitles', defaultMessage: 'Subtitles' })
  const searchPlaceholder = intl.formatMessage({ id: 'Search subtitles', defaultMessage: 'Search subtitles' })
  const allLanguagesLabel = intl.formatMessage({ id: 'All languages', defaultMessage: 'All languages' })
  const allSourcesLabel = intl.formatMessage({ id: 'All sources', defaultMessage: 'All sources' })

  return (
    <div css={style} role="dialog" aria-modal="true" aria-label={titleLabel} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panelRef} className="panel" onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation() }}>
        <div className="header">
          <span className="title">{titleLabel}</span>
          <span className="spacer" />
          <button
            type="button"
            className="close"
            aria-label={intl.formatMessage({ id: 'Close', defaultMessage: 'Close' })}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="toolbar">
          <form
            className="search-form"
            onSubmit={event => {
              event.preventDefault()
              setSubmittedQuery(query)
            }}
          >
            <label className="search-box">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                className="search-input"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onInput={event => setQuery((event.target as HTMLInputElement).value)}
              />
            </label>
          </form>
          <div className="filters">
            <select
              className="select"
              aria-label={allLanguagesLabel}
              value={activeLanguage}
              onChange={event => setLanguageFilter((event.target as HTMLSelectElement).value)}
            >
              <option value="">{allLanguagesLabel}</option>
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.label}</option>
              ))}
            </select>
            <select
              className="select"
              aria-label={allSourcesLabel}
              value={activeSource}
              onChange={event => setSourceFilter((event.target as HTMLSelectElement).value)}
            >
              <option value="">{allSourcesLabel}</option>
              {sources.map(src => (
                <option key={src.key} value={src.key}>{src.label}</option>
              ))}
            </select>
          </div>
        </div>
        {pluginPickers.length > 0 ? (
          <div className="pickers">
            {pluginPickers.map(picker => (
              <button
                key={picker.origin}
                type="button"
                className="picker-btn"
                onClick={() => onOpenPluginPicker(picker)}
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>{intl.formatMessage({ id: 'Choose subtitles from {name}', defaultMessage: 'Choose subtitles from {name}' }, { name: picker.name })}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="list">
          {loading
            ? <div className="empty">{intl.formatMessage({ id: 'Loading', defaultMessage: 'Loading' })}</div>
            : filtered.length === 0
              ? <div className="empty">{intl.formatMessage({ id: 'No subtitles found.', defaultMessage: 'No subtitles found.' })}</div>
              : filtered.map(candidate => {
                const selected = candidate.id === activeId
                const displayTitle = candidate.release || candidate.label
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`item${selected ? ' active' : ''}`}
                    title={displayTitle}
                    aria-pressed={selected || undefined}
                    onClick={() => onPick(candidate)}
                  >
                    <div className="item-main">
                      <span className="item-title">{displayTitle}</span>
                      <span className="item-meta">
                        <span>{subtitleLanguageLabel(candidate.language, locale)}</span>
                        <span className="badge">{candidate.format}</span>
                        <span>{sourceLabelOf(candidate)}</span>
                        {candidate.group ? <span>{candidate.group}</span> : null}
                        {candidate.hearingImpaired ? <span className="badge">{HI_BADGE}</span> : null}
                      </span>
                    </div>
                    <span className="trailing">
                      {selected ? <Check size={14} aria-hidden="true" /> : <Captions size={14} aria-hidden="true" />}
                    </span>
                  </button>
                )
              })}
        </div>
      </div>
    </div>
  )
}

export default SubtitleBrowser
