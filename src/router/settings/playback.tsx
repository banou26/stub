import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { switchStyle } from '../../components/switch-style'
import { readAutoplay, setAutoplay, watchAutoplay } from '../../utils/autoplay'

const style = css`
  label.autoplay {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    max-width: 52rem;
    padding: 1.4rem 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
    font-size: 1.5rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    transition: border-color 0.15s;

    &:hover { border-color: rgba(255, 255, 255, 0.25); }
  }
`

/** The player's settings: whether an episode's end opens the next one by itself. The play order is on the source cards. */
export const PlaybackSection = () => {
  const intl = useIntl()
  const [on, setOn] = useState(readAutoplay)
  useEffect(() => watchAutoplay(() => setOn(readAutoplay())), [])
  return (
    <div css={style}>
      <label className="autoplay">
        {intl.formatMessage({ id: 'Autoplay next episode', defaultMessage: 'Autoplay next episode' })}
        <input
          type="checkbox"
          role="switch"
          css={switchStyle}
          checked={on}
          onChange={event => {
            const checked = (event.target as HTMLInputElement).checked
            setAutoplay(checked)
            setOn(checked)
          }}
        />
      </label>
    </div>
  )
}
