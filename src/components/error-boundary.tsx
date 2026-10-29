import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { Component } from 'preact'
import { useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useLocation } from 'wouter'

const style = css`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 3rem;

  .panel {
    width: 100%;
    max-width: 48rem;
    padding: 2.4rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.8rem;
    background: #171717;
  }

  h2 {
    font-size: 1.9rem;
    margin-bottom: 0.8rem;
  }

  .message {
    font-family: monospace;
    font-size: 1.3rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1.8rem;
  }

  button {
    padding: 0.6rem 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.4rem;
    background: none;
    color: inherit;
    font-size: 1.4rem;
    cursor: pointer;

    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }
`

// the route is the half a stack trace cannot carry, and it is what makes a pasted report reproducible
const details = (error: Error, route: string) =>
  `route: ${route}\nmessage: ${error.message}\nstack: ${error.stack ?? '(no stack)'}`

const Fallback = ({ error, route }: { error: Error, route: string }) => {
  const intl = useIntl()
  const [copied, setCopied] = useState(false)

  const copy = () => {
    const written = navigator.clipboard?.writeText(details(error, route))
    if (!written) return
    written
      .then(() => setCopied(true))
      .catch((cause: unknown) => console.error(new Error('the failure details could not be copied', { cause })))
  }

  return (
    <div css={style}>
      <div className="panel">
        <h2>{intl.formatMessage({ id: 'This page failed to render', defaultMessage: 'This page failed to render' })}</h2>
        <p className="message">{error.message || intl.formatMessage({ id: 'No message was given.', defaultMessage: 'No message was given.' })}</p>
        <div className="actions">
          <button type="button" onClick={() => globalThis.location?.reload()}>{intl.formatMessage({ id: 'Reload', defaultMessage: 'Reload' })}</button>
          <button type="button" onClick={copy}>
            {copied ? intl.formatMessage({ id: 'Copied', defaultMessage: 'Copied' }) : intl.formatMessage({ id: 'Copy details', defaultMessage: 'Copy details' })}
          </button>
        </div>
      </div>
    </div>
  )
}

type BoundaryProps = { children: ComponentChildren, route: string }
type BoundaryState = { error: Error | null, route: string }

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, route: this.props.route }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /**
   * The reset, and the reason this is not a `key` on the boundary.
   *
   * A throw on one route must not wall every other route for the session, so the caught error is
   * dropped the moment the route changes. Keying the element on the location would do that too, and
   * would also unmount and remount the WHOLE app on every navigation, since this boundary sits above
   * the router: the header, the footer and every urql subscription under them would be torn down and
   * rebuilt on each route change. Clearing the state instead costs a remount only on the route that
   * actually failed, which is the one that has nothing to keep.
   */
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.route === state.route ? null : { error: null, route: props.route }
  }

  componentDidCatch(error: unknown) {
    console.error(new Error(`the ${this.props.route} route failed to render`, { cause: error }))
  }

  render() {
    return this.state.error
      ? <Fallback error={this.state.error} route={this.props.route}/>
      : this.props.children
  }
}

/**
 * Renders its children, and on a render time throw anywhere under it renders a compact fallback
 * instead: the error's message, a reload button, and a button that copies message, stack and route
 * to the clipboard so a bug report carries what happened. The failure is logged once through
 * `console.error`, with the route it happened on.
 *
 * The caught error is dropped when the route changes, so a page that throws does not wall the rest
 * of the app for the session. It reads the route from wouter, and works with or without a `Router`
 * above it (wouter falls back to the browser location).
 *
 * Mount it around the router, which is enough to cover every route: the media modal renders through
 * a floating portal, and a portal moves the DOM parent, never the component tree a boundary walks.
 */
export const ErrorBoundary = ({ children }: { children: ComponentChildren }) => {
  const [route] = useLocation()
  return <Boundary route={route}>{children}</Boundary>
}

export default ErrorBoundary
