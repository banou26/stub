import { css } from '@emotion/react'
import { Frown, Meh, Smile, Star } from 'lucide-react'
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

/** The look of `StarScore`, which the page drawing it carries in its own style, as `categoriesStyle` says why. */
export const starScoreStyle = css`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  color: #f5c518;
  white-space: nowrap;
`

const percentText = (intl: ReturnType<typeof useIntl>, percent: number) =>
  intl.formatNumber(percent, { style: 'unit', unit: 'percent', maximumFractionDigits: 0 })

/** A 0 to 100 rating as the face and percentage the card and list modes both show. */
const MediaScore = ({ percent, size = 18 }: { percent: number, size?: number }) => {
  const intl = useIntl()
  const Face = FACES[scoreMood(percent)]
  return (
    <span css={style} aria-label={intl.formatMessage({ id: 'Rated {percent} percent', defaultMessage: 'Rated {percent} percent' }, { percent })}>
      <span className="face" style={{ color: COLOURS[scoreMood(percent)] }}><Face size={size}/></span>
      <span className="value">{percentText(intl, percent)}</span>
    </span>
  )
}

/** A 0 to 100 rating as a gold star and its percentage, where a title's details show it, the star read as Score, drawn as `starScoreStyle` says. */
export const StarScore = ({ percent }: { percent: number }) => {
  const intl = useIntl()
  return (
    <span className="score">
      <Star size={15} fill="currentColor" role="img" aria-label={intl.formatMessage({ id: 'Score', defaultMessage: 'Score' })}/>
      {percentText(intl, percent)}
    </span>
  )
}

export default MediaScore
