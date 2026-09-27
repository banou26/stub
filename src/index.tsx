import { css, Global } from '@emotion/react'
import { render } from 'preact'
import { Provider } from 'urql'
import { account } from '@fkn/lib'

import './worker.ts'
import './plugins.ts'
import client from './urql'
import Router from './router'
import ErrorBoundary from './components/error-boundary'
import { party } from './party'
import './plugin-url.ts'
import './store-export.ts'
import './answers-export.ts'
import { pushKeys } from './utils/keys'
import { watchTrackerAccount } from './tracking/account-watch'
import { trackerAccountChanged, trackerFocused } from './worker'

pushKeys()
watchTrackerAccount({ onChange: account.onChange, accountChanged: trackerAccountChanged, focused: trackerFocused })

const style = css`
  @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Fira+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,500;1,600;1,700;1,800;1,900&family=Montserrat:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900&display=swap');

  :root {
    color-scheme: dark;
    /* the fixed header's own height. Every page that has to start below the bar reads this instead of
       guessing, which is how /settings ended up 8px short of a header it never measured */
    --stub-header-height: 7rem;
  }

  @media (max-width: 768px) {
    :root {
      --stub-header-height: 6.4rem;
    }
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 62.5%;
    height: 100vh;
    width: 100%;
  }

  body {
    margin: 0;
    height: 100vh;
    width: 100%;
    font-size: 1.6rem;
    font-family: Fira Sans;
    background-color: #0f0f0f;
    color: #fff;
    font-family: Montserrat;
  }

  #stub-root {
    height: 100vh;
    width: 100%;
  }

  a {
    color: #777777;
    text-decoration: none;
  }

  a:hover {
    color: #fff;
  }

  ul {
    list-style: none;
  }

  .hidden {
    display: none !important;
  }
`

// inside the api's 20 s hold a reload keeps the seat, and the host's at that
void party.resume()

const root = document.createElement('div')
root.id = 'stub-root'

render(
  <Provider value={client}>
    {/* outside the boundary, so the base styles the fallback renders against survive a caught error */}
    <Global styles={style}/>
    <ErrorBoundary>
      <Router/>
    </ErrorBoundary>
  </Provider>,
  document.body.appendChild(root)
)
