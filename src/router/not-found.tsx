import { css } from '@emotion/react'
import { useIntl } from 'react-intl'

// the header is fixed, so a route that starts its own flow at y=0 renders its first line behind the bar
const style = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
`

const NotFound = () => <div css={style}>{useIntl().formatMessage({ id: '404 No page found', defaultMessage: '404 No page found' })}</div>

export default NotFound
