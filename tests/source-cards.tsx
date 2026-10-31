import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import SourceSelector from '../src/components/source-selector'
import { startLanguage } from '../src/i18n'

// The page tests/source-cards.spec.ts drives: the watch page's sources, one card naming five audio
// languages and one subtitle language.
const { hook } = memoryLocation({ path: '/watch/m/e/nf:1' })
const crunchyroll = {
  id: 'cr',
  name: 'Crunchyroll',
  href: '/watch/m/e/cr:1',
  external: false,
  active: false,
  audioLanguages: ['ja-JP', 'en-US', 'fr-FR', 'de-DE', 'es-419'],
  subtitleLanguages: ['en-US'],
}
// `?marks`: a source to open elsewhere, and one with its releases folded, for the marks they draw
const nyaa = { id: 'ny', name: 'Nyaa', href: '/watch/m/e/ny:1', external: false, active: false, releases: [{ uri: 'ny:1', label: 'One', external: false, active: false }, { uri: 'ny:2', label: 'Two', external: false, active: false }] }
const prime = { id: 'pv', name: 'Prime Video', href: 'https://www.primevideo.com/', external: true, active: false }
const sources = new URLSearchParams(location.search).has('marks') ? [nyaa, prime] : [crunchyroll]
// in the language setting's language, which tests/source-cards.spec.ts's build offers
void startLanguage().then(intl => render(<RawIntlProvider value={intl}><Router hook={hook}><SourceSelector sources={sources}/></Router></RawIntlProvider>, document.getElementById('sources')!))
