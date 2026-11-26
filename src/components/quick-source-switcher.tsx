import type { CatalogActionResult, CatalogItem } from '../plugin-sdk'
import type { WatchSource } from './source-selector'

import { css } from '@emotion/react'
import { X } from 'lucide-react'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useIntl } from 'react-intl'

import SourceBrowser from './source-browser'

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
    max-width: 76rem;
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

  .body {
    flex: 1;
    min-height: 0;
    padding: 1rem 1.2rem 1.2rem;
    overflow-y: auto;
  }
`

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type QuickSourceSwitcherProps = {
  sources: WatchSource[]
  catalogItems?: ReadonlyMap<string, CatalogItem>
  onSelectHref: (href: string) => void
  onOpenPicker: (source: WatchSource) => void
  onRunAction?: (origin: string, uri: string, actionId: string) => Promise<CatalogActionResult | null>
  onRefreshCatalog?: () => void
  onClose: () => void
}

/**
 * In-player quick source and item switcher shown over the video frame, keeping stage fullscreen across picks.
 */
export const QuickSourceSwitcher = ({
  sources,
  catalogItems,
  onSelectHref,
  onOpenPicker,
  onRunAction,
  onRefreshCatalog,
  onClose,
}: QuickSourceSwitcherProps) => {
  const intl = useIntl()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const latestClose = useRef(onClose)
  latestClose.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement as { focus?: () => void } | null
    window.focus?.()
    closeButton.current?.focus?.()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        latestClose.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault()
          last.focus?.()
        }
      } else if (active === last || !panelRef.current.contains(active)) {
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

  const label = intl.formatMessage({ id: 'Switch source', defaultMessage: 'Switch source' })

  return (
    <div css={style} role="dialog" aria-modal="true" aria-label={label} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="panel" ref={panelRef}>
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
        <div className="body">
          <SourceBrowser
            sources={sources}
            catalogItems={catalogItems}
            variant="dialog"
            defaultView="list"
            onSelectHref={onSelectHref}
            onOpenPicker={onOpenPicker}
            onRunAction={onRunAction}
            onRefreshCatalog={onRefreshCatalog}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
}

export default QuickSourceSwitcher
