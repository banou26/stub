import type { RouteParams } from './path'

import { css } from '@emotion/react'
import { Redirect, Router, Switch, Route as WRoute, useParams } from 'wouter'
import { useEffect } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { getRouterRoutePath, Route } from './path'
import { legacySearchTerm, searchPath } from './search/params'
import { pluginHref } from '../plugin-url'
import Header from '../components/header'
import Footer from '../components/footer'
import PluginPrompt from '../components/plugin-prompt'
import Home from './home'
import Title from './title'
import Search from './search'
import Legal from './legal'
import Privacy from './privacy'
import Settings from './settings'
import List from './list'
import Continue from './continue'
import Watch from './watch'
import Party from './party'
import Debug from './debug'
import PartySync from '../components/party-sync'
import PartyCursor from '../components/party-cursor'
import PartyChat from '../components/party-chat'
import ScrollReset from '../components/scroll-reset'

/**
 * `/search/<term>`, the search route until the filters moved into the query string.
 *
 * Kept because links to it exist outside the app, and because the header itself pointed there until
 * this change, so a tab left open on an older bundle still lands somewhere.
 */
const LegacySearch = () => {
  const { query } = useParams<RouteParams['SEARCH_LEGACY']>()
  return <Redirect to={searchPath({ query: legacySearchTerm(query) })} replace/>
}

const LoginCallback = () => {
  const intl = useIntl()
  useEffect(() => { globalThis.close() }, [])
  return <div>{intl.formatMessage({ id: 'Logging in...', defaultMessage: 'Logging in...' })}</div>
}

const shellStyle = css`
  display: flex;
  flex-direction: column;
  min-height: 100vh;

  & > .content {
    flex: 1;
  }
`

// the header is fixed, so a route that starts its own flow at y=0 renders its first line behind the bar
const notFoundStyle = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
`

const NotFound = () => <div css={notFoundStyle}>{useIntl().formatMessage({ id: '404 No page found', defaultMessage: '404 No page found' })}</div>

const RouterRoot = () => (
  <Router hrefs={pluginHref}>
    <div css={shellStyle}>
      <Header/>
      <div className="content">
        <Switch>
          <WRoute path={getRouterRoutePath(Route.HOME)} component={Home}/>
          <WRoute path={getRouterRoutePath(Route.MEDIA)} component={Home}/>
          <WRoute path={getRouterRoutePath(Route.TITLE)} component={Title}/>
          <WRoute path={getRouterRoutePath(Route.SEARCH)} component={Search}/>
          <WRoute path={getRouterRoutePath(Route.SEARCH_LEGACY)} component={LegacySearch}/>
          <WRoute path={getRouterRoutePath(Route.LEGAL)} component={Legal}/>
          <WRoute path={getRouterRoutePath(Route.PRIVACY)} component={Privacy}/>
          <WRoute path={getRouterRoutePath(Route.SETTINGS)} component={Settings}/>
          <WRoute path={getRouterRoutePath(Route.LIST)} component={List}/>
          <WRoute path={getRouterRoutePath(Route.CONTINUE)} component={Continue}/>
          <WRoute path={getRouterRoutePath(Route.WATCH)} component={Watch}/>
          <WRoute path={getRouterRoutePath(Route.PARTY)} component={Party}/>
          <WRoute path={getRouterRoutePath(Route.DEBUG_TRACE)}><Debug/></WRoute>
          <WRoute path={getRouterRoutePath(Route.LOGIN_CALLBACK)} component={LoginCallback}/>
          <WRoute component={NotFound}/>
        </Switch>
      </div>
      <Footer/>
      <PluginPrompt/>
      <PartySync/>
      <PartyCursor/>
      <PartyChat/>
      <ScrollReset/>
    </div>
  </Router>
)
export default RouterRoot
