import { css } from '@emotion/react'
import { Frown, Meh, Smile } from 'lucide-react'
import { useIntl } from 'react-intl'

import { scoreMood, type ScoreMood } from '../utils/score'

const FACES = { good: Smile, mixed: Meh, poor: Frown } as const
const COLOURS: Record<ScoreMood, string> = { good: '#4ade80', mixed: '#fb923c', poor: '#f87171' }

const style = css`
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  white-space: nowrap;

  .face {
    display: flex;
  }
`

/** A 0 to 100 rating as the face and percentage the card and list modes both show. */
const MediaScore = ({ percent, size = 18 }: { percent: number, size?: number }) => {
  const intl = useIntl()
  const Face = FACES[scoreMood(percent)]
  return (
    <span css={style} aria-label={intl.formatMessage({ id: 'Rated {percent} percent', defaultMessage: 'Rated {percent} percent' }, { percent })}>
      <span className="face" style={{ color: COLOURS[scoreMood(percent)] }}><Face size={size}/></span>
      <span className="value">{intl.formatNumber(percent, { style: 'unit', unit: 'percent', maximumFractionDigits: 0 })}</span>
    </span>
  )
}

export default MediaScore
