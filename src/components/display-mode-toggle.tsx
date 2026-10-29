import type { DisplayMode } from '../router/search/display'

import { css } from '@emotion/react'
import { Grid2x2, Grid3x2, LayoutList } from 'lucide-react'
import { defineMessages, useIntl } from 'react-intl'

import { DISPLAY_MODES } from '../router/search/display'

const ICONS = { grid: Grid3x2, card: Grid2x2, list: LayoutList } as const

// here rather than in search/display.ts, which a Playwright spec imports in Node, where react-intl finds no React
const LABELS = defineMessages({
  grid: { id: 'Covers#result layout', defaultMessage: 'Covers', description: 'result layout' },
  card: { id: 'Cards#result layout', defaultMessage: 'Cards', description: 'result layout' },
  list: { id: 'List#result layout', defaultMessage: 'List', description: 'result layout' },
})

const style = css`
  display: inline-flex;
  gap: 0.4rem;
  padding: 0.4rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.05);

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  button:hover { color: #fff; }

  button[aria-pressed="true"] {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
`

/** The three layouts, as the segmented control that picks between them. */
const DisplayModeToggle = ({ mode, onChange }: { mode: DisplayMode, onChange: (mode: DisplayMode) => void }) => {
  const intl = useIntl()
  return (
    <div css={style} role="group" aria-label={intl.formatMessage({ id: 'Result layout', defaultMessage: 'Result layout' })}>
      {DISPLAY_MODES.map(value => {
        const Icon = ICONS[value]
        const label = intl.formatMessage(LABELS[value])
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={mode === value}
            onClick={() => onChange(value)}
          >
            <Icon size={18}/>
          </button>
        )
      })}
    </div>
  )
}

export default DisplayModeToggle
