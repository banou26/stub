import './share-link-open'
import './update'
import { css, Global } from '@emotion/react'
import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Provider } from 'urql'

import './worker.ts'
import { checkSources } from './plugins.ts'
import { watchAccountFiles } from './settings-account'
import client from './urql'
import Router from './router'
import ErrorBoundary from './components/error-boundary'
import { startLanguage } from './i18n'
import { party } from './party'
import './plugin-url.ts'
import './store-export.ts'
import './answers-export.ts'
import { forgetApiKeys } from './utils/forget-api-keys'
import { watchTrackerAccount } from './tracking/account-watch'
import { trackerCheck, trackerFocused } from './worker'
import { baseText } from './base-text'

forgetApiKeys()
watchTrackerAccount({ check: trackerCheck, focused: trackerFocused })
watchAccountFiles(checkSources)

const style = css`
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

  :root[dir='rtl'] {
    /* a gradient and a shadow have no logical direction to name */
    --inline-end: left;
    --inline-sign: -1;
  }

  /* :dir() rather than [dir]: a player stays left to right inside a right to left page, and its icons with it */
  :is(.lucide-chevron-left, .lucide-chevron-right, .lucide-log-out, .lucide-external-link, .lucide-send):dir(rtl) {
    scale: -1 1;
  }

  /* a name, a title, a synopsis or what a viewer types is in its own words, mostly Latin: each keeps its own order and is
     cut at its own end, on the side of the page it sits on. No specificity, so a component's own alignment wins, though
     under plaintext a Latin text's end is its right, which .artists avoids with a <bdi>. Text the page translates stays
     out of this, but a fact's dd (GLOSSARY.md): a line opening on a Latin word would turn left to right. So does an inline
     inside a listed block, whose letters would be hidden from the block choosing the direction. Chrome 156 reads only
     the prefixed match-parent */
  :where(h1, h2, h4, dd, input, textarea, .name, .from, .second, .song, .person .detail, .line .who, .line .text, [class*='title']:not(.title-text), .title-text div, [class*='description'], [class*='description'] :is(div, p)):where(:dir(rtl)) {
    unicode-bidi: plaintext;
    text-align: -webkit-match-parent;
    text-align: match-parent;
  }

  /* spacing pulls Arabic's joined letters apart */
  :lang(ar) {
    letter-spacing: normal !important;
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
    background-color: #0f0f0f;
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

const intl = await startLanguage()

render(
  <RawIntlProvider value={intl}>
    <Provider value={client}>
      {/* outside the boundary, so the base styles the fallback renders against survive a caught error */}
      <Global styles={[baseText, style]}/>
      <ErrorBoundary>
        <Router/>
      </ErrorBoundary>
    </Provider>
  </RawIntlProvider>,
  document.body.appendChild(root)
)
