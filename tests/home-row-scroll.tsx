import { render } from 'preact'
import { useState } from 'preact/hooks'
import { RawIntlProvider } from 'react-intl'
import { Route, Router, Switch, useLocation } from 'wouter'

import { startLanguage } from '../src/i18n'
import ScrollReset from '../src/components/scroll-reset'
import { MediaSection } from '../src/router/home/media-section'

// The page tests/home-row-scroll.spec.ts drives: a home page of one row at `/` and under a card's `/media/` address, a
// page of its own at `/title/`, and the app's ScrollReset hearing every navigation, on the browser's own history.
// `window.navigate` goes somewhere; a home page draws `window.firstCards` cards (40 when unset) and `window.cards(count)`
// draws that many in the one on screen.
const show = (index: number) => ({
  _id: `cl:${index}`, uri: `ag:(anilist:${index})`, titles: [{ title: `Show ${index}` }], covers: [], handles: [], trailers: [],
  shortDescriptions: [], type: null, categories: [],
})
const Home = () => {
  const [count, setCount] = useState((window as unknown as { firstCards?: number }).firstCards ?? 40)
  Object.assign(window, { cards: setCount })
  return <MediaSection name="season" title="Current season" mediaNodes={Array.from({ length: count }, (_, index) => show(index)) as never}/>
}
const Pages = () => {
  const [, navigate] = useLocation()
  Object.assign(window, { navigate })
  return (
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/media/:uri/:slug?" component={Home}/>
      <Route path="/title/:uri"><h1>Title</h1></Route>
    </Switch>
  )
}
const intl = await startLanguage()
render(
  <RawIntlProvider value={intl}>
    <Router><Pages/><ScrollReset/></Router>
  </RawIntlProvider>,
  document.getElementById('app')!,
)
