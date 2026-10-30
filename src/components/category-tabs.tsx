import { css } from '@emotion/react'
import { defineMessages, useIntl } from 'react-intl'

import { MediaCategory } from '../generated/graphql'

const LABELS = defineMessages({
  all: { id: 'All#category', defaultMessage: 'All', description: 'category' },
  anime: { id: 'Anime#category', defaultMessage: 'Anime', description: 'category' },
  series: { id: 'Series#category', defaultMessage: 'Series', description: 'category' },
  movies: { id: 'Movies#category', defaultMessage: 'Movies', description: 'category' },
})

const TABS = [
  { label: LABELS.all, value: null },
  { label: LABELS.anime, value: MediaCategory.Anime },
  { label: LABELS.series, value: MediaCategory.Series },
  { label: LABELS.movies, value: MediaCategory.Movie },
] as const

const style = css`
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;

  .tab {
    padding: 0.5rem 1.3rem;
    border-radius: 2rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.4rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab:hover { color: rgba(255, 255, 255, 0.9); }

  .tab.active {
    background: #fff;
    color: #000;
    border-color: #fff;
  }
`

type Props = {
  value: MediaCategory | null
  onChange: (value: MediaCategory | null) => void
}

const CategoryTabs = ({ value, onChange }: Props) => {
  const intl = useIntl()
  return (
    <div css={style}>
      {TABS.map(tab => (
        <button
          key={tab.label.id}
          className={value === tab.value ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.value)}
        >
          {intl.formatMessage(tab.label)}
        </button>
      ))}
    </div>
  )
}

export default CategoryTabs
