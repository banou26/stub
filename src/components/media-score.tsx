import { css } from '@emotion/react'
import { Star } from 'lucide-react'
import { useIntl } from 'react-intl'

/** The look of `StarScore`, which the page drawing it carries in its own style, as `categoriesStyle` says why. */
export const starScoreStyle = css`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  color: #f5c518;
  white-space: nowrap;
`

/** A 0 to 100 rating as a gold star and its percentage, the star read as Score, drawn as `starScoreStyle` says. */
export const StarScore = ({ percent }: { percent: number }) => {
  const intl = useIntl()
  return (
    <span className="score">
      <Star size={15} fill="currentColor" role="img" aria-label={intl.formatMessage({ id: 'Score', defaultMessage: 'Score' })}/>
      {intl.formatNumber(percent, { style: 'unit', unit: 'percent', maximumFractionDigits: 0 })}
    </span>
  )
}
