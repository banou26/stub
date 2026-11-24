import type { WatchSource } from './source-selector'

import { css } from '@emotion/react'
import { ChevronDown, ChevronRight, ExternalLink, Play, SlidersHorizontal, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { brandColor } from './source-selector'

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
    max-width: 48rem;
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

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem 1.2rem 1.2rem;
    overflow-y: auto;
  }

  .group {
    --brand: #9aa0a6;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .head-row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
  }

  .item {
    --brand: #9aa0a6;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    min-width: 0;
    padding: 0.75rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.9);
    font: inherit;
    font-size: 1.35rem;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.18);
      outline: none;
    }

    &.active {
      background: color-mix(in srgb, var(--brand) 18%, rgba(255, 255, 255, 0.04));
      border-color: color-mix(in srgb, var(--brand) 55%, rgba(255, 255, 255, 0.18));
      color: #fff;
    }
  }

  .picker-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.75rem 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.8);
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

  .icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.45rem;
    background: var(--brand);
    color: #fff;
    font-size: 1.15rem;
    font-weight: 700;
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .tag {
    flex-shrink: 0;
    padding: 0.15rem 0.55rem;
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.75);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .trailing {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.55);
  }

  .chevron {
    &:dir(rtl) {
      scale: -1 1;
    }
  }

  .releases {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-inline-start: 1.2rem;
    border-inline-start: 1px solid rgba(255, 255, 255, 0.1);
  }

  .release {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-width: 0;
    padding: 0.55rem 0.9rem;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.8);
    font: inherit;
    font-size: 1.25rem;
    text-align: start;
    text-decoration: none;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: rgba(255, 255, 255, 0.09);
      color: #fff;
      outline: none;
    }

    &.active {
      background: color-mix(in srgb, var(--brand) 18%, rgba(255, 255, 255, 0.04));
      border-color: color-mix(in srgb, var(--brand) 45%, transparent);
      color: #fff;
    }
  }

  .release-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const SwitcherIcon = ({ source }: { source: WatchSource }) => {
  const [failed, setFailed] = useState(false)
  return (
    <span className="icon">
      {source.icon && !failed
        ? <img src={source.icon} alt="" onError={() => setFailed(true)} />
        : source.name.charAt(0)}
    </span>
  )
}

export type QuickSourceSwitcherProps = {
  sources: WatchSource[]
  onSelectHref: (href: string) => void
  onOpenPicker: (source: WatchSource) => void
  onClose: () => void
}

/**
 * In-player quick source and subsource switcher shown over the video frame, keeping stage fullscreen across picks.
 */
export const QuickSourceSwitcher = ({ sources, onSelectHref, onOpenPicker, onClose }: QuickSourceSwitcherProps) => {
  const intl = useIntl()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const closeButton = useRef<HTMLButtonElement>(null)
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement as { focus?: () => void } | null
    window.focus?.()
    closeButton.current?.focus?.()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      latestClose.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  const label = intl.formatMessage({ id: 'Switch source', defaultMessage: 'Switch source' })
  const isOpen = (source: WatchSource) => expanded[source.id] ?? Boolean(source.active || sources.length === 1)

  return (
    <div css={style} role="dialog" aria-modal="true" aria-label={label} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="panel">
        <div className="header">
          <span className="title">{label}</span>
          <span className="spacer" />
          <button
            type="button"
            ref={closeButton}
            className="close"
            aria-label={intl.formatMessage({ id: 'Close', defaultMessage: 'Close' })}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="list">
          {sources.map(source => {
            const brand = brandColor(source)
            const quality = source.videoQualities?.at(0)
            if (source.releases && source.releases.length > 1) {
              const open = isOpen(source)
              return (
                <div key={source.id} className="group" style={{ '--brand': brand }}>
                  <div className="head-row">
                    <button
                      type="button"
                      className={`item${source.active ? ' active' : ''}`}
                      aria-expanded={open}
                      aria-current={source.active ? 'true' : undefined}
                      onClick={() => setExpanded(prev => ({ ...prev, [source.id]: !open }))}
                    >
                      <SwitcherIcon source={source} />
                      <span className="name">{source.name}</span>
                      <span className="tag">{source.releases.length}</span>
                      <span className="trailing">
                        {open
                          ? <ChevronDown size={14} aria-hidden="true" />
                          : <ChevronRight size={14} className="chevron" aria-hidden="true" />}
                      </span>
                    </button>
                    {source.picker ? (
                      <button
                        type="button"
                        className="picker-btn"
                        aria-label={intl.formatMessage({ id: 'Choose a source from {name}', defaultMessage: 'Choose a source from {name}' }, { name: source.name })}
                        onClick={() => onOpenPicker(source)}
                      >
                        <SlidersHorizontal size={13} aria-hidden="true" />
                        <span>{intl.formatMessage({ id: 'Release picker', defaultMessage: 'Release picker' })}</span>
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="releases">
                      {source.releases.map(release => {
                        const marker = (
                          <>
                            <span className="release-label">{release.label}</span>
                            <span className="trailing">
                              {release.external || !release.href
                                ? <ExternalLink size={12} aria-hidden="true" />
                                : <Play size={12} aria-hidden="true" />}
                            </span>
                          </>
                        )
                        return !release.external && release.href ? (
                          <button
                            key={release.uri}
                            type="button"
                            className={`release${release.active ? ' active' : ''}`}
                            aria-current={release.active ? 'true' : undefined}
                            title={release.label}
                            onClick={() => onSelectHref(release.href!)}
                          >
                            {marker}
                          </button>
                        ) : (
                          <a
                            key={release.uri}
                            className={`release${release.active ? ' active' : ''}`}
                            aria-current={release.active ? 'true' : undefined}
                            href={release.href}
                            target="_blank"
                            rel="noreferrer"
                            title={release.label}
                            onClick={onClose}
                          >
                            {marker}
                          </a>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            }

            const marker = (
              <>
                <SwitcherIcon source={source} />
                <span className="name">{source.name}</span>
                {quality ? <span className="tag">{quality}</span> : null}
                <span className="trailing">
                  {source.external || !source.href
                    ? <ExternalLink size={12} aria-hidden="true" />
                    : <Play size={12} aria-hidden="true" />}
                </span>
              </>
            )

            return !source.external && source.href ? (
              <button
                key={source.id}
                type="button"
                className={`item${source.active ? ' active' : ''}`}
                aria-current={source.active ? 'true' : undefined}
                style={{ '--brand': brand }}
                title={source.name}
                onClick={() => onSelectHref(source.href!)}
              >
                {marker}
              </button>
            ) : (
              <a
                key={source.id}
                className={`item${source.active ? ' active' : ''}`}
                aria-current={source.active ? 'true' : undefined}
                style={{ '--brand': brand }}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                title={source.name}
                onClick={onClose}
              >
                {marker}
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default QuickSourceSwitcher
