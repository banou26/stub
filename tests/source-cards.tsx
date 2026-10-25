import { render } from 'preact'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import SourceSelector from '../src/components/source-selector'

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
render(<Router hook={hook}><SourceSelector sources={[crunchyroll]}/></Router>, document.getElementById('sources')!)
