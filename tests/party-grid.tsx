import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'

import PartyWidget from '../src/components/party-widget'
import { startLanguage } from '../src/i18n'
import { follower, party } from './party-grid-party'

// The page tests/party-grid.spec.ts drives: the header's party button of a host on a watch page, with
// a follower whose name is as long as a name can be, one with a short name, and one that said nothing.
await party.create()
const path = location.pathname
follower('f1', { t: 'name', name: 'W'.repeat(32) }, { t: 'status', s: 'ready', path, time: 3725, rate: 0 })
follower('f2', { t: 'name', name: 'Alexandra' }, { t: 'status', s: 'loading', path, time: 3725, rate: 0 })
follower('f3')
render(<RawIntlProvider value={await startLanguage()}><PartyWidget/></RawIntlProvider>, document.getElementById('root')!)
