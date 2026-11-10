import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import PluginNotice from '../src/components/plugin-notice'
import SourceSelector from '../src/components/source-selector'
import { startLanguage } from '../src/i18n'
import { addInvites } from '../src/plugin-invites'

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
// `?picker`: that source with its own release picker, and the notice of the link that added it
const PLUGIN = 'https:stub.plugins.banou.dev'
const mode = new URLSearchParams(location.search)
const sources = mode.has('marks') ? [nyaa, prime] : mode.has('picker') ? [{ ...nyaa, picker: { pluginUri: PLUGIN } }] : [crunchyroll]
// in the language setting's language, which tests/source-cards.spec.ts's build offers
void startLanguage().then(intl => {
  render(<RawIntlProvider value={intl}><Router hook={hook}>{mode.has('picker') && <PluginNotice/>}<SourceSelector sources={sources}/></Router></RawIntlProvider>, document.getElementById('sources')!)
  if (mode.has('picker')) void addInvites([PLUGIN])
})
