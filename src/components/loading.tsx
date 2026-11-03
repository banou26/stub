import { css, keyframes } from '@emotion/react'
import { LoaderCircle } from 'lucide-react'
import { useIntl } from 'react-intl'

const spin = keyframes`
  to { transform: rotate(360deg); }
`

/**
 * How far the mark hangs past what it follows (its padding and its icon). Where something else can sit that close after
 * it, the place keeps this much room free.
 */
export const LOADING_ROOM = '1.5em'

const style = css`
  display: inline-flex;
  padding-inline-start: 0.5em;
  /* its whole width taken back, so it hangs past what it follows and nothing rewraps as it comes or goes; an em tall
     and an eighth under the baseline, inside the line's ascent and descent, so the line is no taller for it */
  margin-inline-end: -${LOADING_ROOM};
  vertical-align: -0.125em;
  pointer-events: none;

  & > svg {
    width: 1em;
    height: 1em;
    animation: ${spin} 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    & > svg { animation: none; }
  }
`

/** A spinner named Loading after what is still loading, taking no room, so what is around it stays put as it goes. */
const Loading = () => {
  const intl = useIntl()
  return (
    <span css={style} role="img" aria-label={intl.formatMessage({ id: 'Loading', defaultMessage: 'Loading' })}>
      <LoaderCircle aria-hidden="true"/>
    </span>
  )
}

export default Loading
