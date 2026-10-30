import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { startLanguage } from '../src/i18n'
import { MediaSection } from '../src/router/home/media-section'

// The page tests/media-section.spec.ts drives: `window.draw(count, typed)` draws a home row of that many cards, none
// being the row before the worker has answered. Typed, the cards take turns being a film, a live-action show, an
// anime show and a work no source typed; untyped, no source has named any format yet. `window.visited` is where the
// row's links have gone.
const { hook, history } = memoryLocation({ path: '/', record: true })
const FORMATS = [
  { type: 'MOVIE', categories: ['MOVIE'] },
  { type: null, categories: ['SERIES'] },
  { type: 'TV', categories: ['ANIME', 'SERIES'] },
  { type: null, categories: ['ANIME', 'SERIES'] },
]
const show = (index: number, typed: boolean) => ({
  _id: `cl:${index}`, uri: `ag:(anilist:${index})`, titles: [{ title: `Show ${index}` }], covers: [], handles: [], trailers: [],
  shortDescriptions: [{ shortDescription: 'A show.' }], type: null, categories: [], ...typed ? FORMATS[index % FORMATS.length] : {},
})
const intl = await startLanguage()
const draw = (count: number, typed = false) => render(
  <RawIntlProvider value={intl}>
    <Router hook={hook}><MediaSection title="Current season" mediaNodes={Array.from({ length: count }, (_, index) => show(index, typed)) as never}/></Router>
  </RawIntlProvider>,
  document.getElementById('row')!,
)
Object.assign(window, { draw, visited: history })
