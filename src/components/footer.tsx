import { css } from '@emotion/react'
import { useIntl } from 'react-intl'
import { Link, useRoute } from 'wouter'

import { getRouterRoutePath, getRoutePath, Route } from '../router/path'
import { askForTop } from '../router/scroll-reset'

const style = css`
  display: flex;
  align-items: center;
  gap: 2rem;
  margin-top: 4rem;
  padding: 2.5rem 3rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);

  .wordmark {
    font-size: 1.8rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.8);

    &:hover {
      color: #fff;
    }
  }

  .version {
    margin-left: auto;
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.35);
  }

  .commit {
    /* dimmer than the version: it identifies a build for a bug report, it is not a thing to read */
    font-family: ui-monospace, monospace;
    color: rgba(255, 255, 255, 0.25);
  }

  .nav-link {
    font-size: 1.4rem;
    white-space: nowrap;
    color: rgba(255, 255, 255, 0.55);

    &:hover {
      color: #fff;
    }
  }

  @media (max-width: 768px) {
    gap: 1.2rem;
    padding: 2rem 1.5rem;
  }
`

// the brand, never translated
const WORDMARK = 'stub'

export const Footer = () => {
  const intl = useIntl()
  // a version reads alike in every language
  const version = `v${__STUB_VERSION__}`
  const [onWatch] = useRoute(getRouterRoutePath(Route.WATCH))
  const [onLoginCallback] = useRoute(getRouterRoutePath(Route.LOGIN_CALLBACK))

  if (onWatch || onLoginCallback) return null

  return (
    <footer css={style}>
      <Link to={getRoutePath(Route.HOME)} className="wordmark" onClick={askForTop}>{WORDMARK}</Link>
      <Link to={getRoutePath(Route.LEGAL)} className="nav-link">{intl.formatMessage({ id: 'Legal', defaultMessage: 'Legal' })}</Link>
      <Link to={getRoutePath(Route.PRIVACY)} className="nav-link">{intl.formatMessage({ id: 'Privacy', defaultMessage: 'Privacy' })}</Link>
      {/* a page with no commit meta reads `commit undefined` as before, where a missing value would fail the message */}
      <span
        className="version"
        title={intl.formatMessage({ id: 'stub v{version}, commit {commit}', defaultMessage: 'stub v{version}, commit {commit}' }, { version: __STUB_VERSION__, commit: String(__STUB_COMMIT__) })}
      >
        {version} <span className="commit">{__STUB_COMMIT__}</span>
      </span>
    </footer>
  )
}

export default Footer
