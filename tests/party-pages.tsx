import type { Control } from '../src/party/protocol'

import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import PartyChat from '../src/components/party-chat'
import PartyCursor from '../src/components/party-cursor'
import PartyWidget from '../src/components/party-widget'
import { startLanguage } from '../src/i18n'
import Party from '../src/router/party'
import { end, follower, HOST, party, says } from './party-grid-party'

// The pages tests/party-pages.spec.ts reads, one party per load, by the query's `view`: the header's party button,
// the party page and the chat, and for a follower the host's pointer, each drawn in the language the setting names.
// `host` and `guest` are a party on this watch page with followers who said things and used every control, `joining`,
// `ended` and `failed` the three ways a party is not on, `idle` no party at all.

const view = new URLSearchParams(location.search).get('view')
const HOST_PATH = '/watch/a/c'
const INVITE = 'Qm9yZWQtYnV0LWhhcHB5LWV2ZXJ5LWRheS1vay1va2F.https://anime.fkn.app/1b4e28ba2fa111d2883f0016d3cc'
const EVERY: Control[] = ['play', 'seek', 'go', 'rate', 'subs', 'audio']
const TRACKS = { subtitles: { ids: ['English', 'Spanish'], selected: 'English' }, audio: { ids: ['Japanese', 'English'], selected: 'Japanese' }, busy: false }
const at = (time: number, paused = false, rate = 1) => ({ paused, time, rate, at: Date.now() })
const here = location.pathname

if (view === 'host') {
  await party.create()
  party.setGrants({ all: EVERY, by: { ann: { rate: false } } })
  // the host judges an ask by the grants of its own state as the room hands it back
  await new Promise(resolve => setTimeout(resolve, 0))
  party.setPlayerTracks(TRACKS)
  follower('ann', { t: 'name', name: 'Alexandra' }, { t: 'status', s: 'ready', path: here, time: 3725, rate: 0 }, { t: 'chat', text: 'ready?' })
  follower('w', { t: 'name', name: 'W'.repeat(32) }, { t: 'status', s: 'loading', path: here })
  follower('sam1234567', { t: 'status', s: 'away' })
  says(HOST, { t: 'chat', text: 'go' })
  says('ann', { t: 'ask', c: 'play', path: here, s: at(10, true) }, { t: 'ask', c: 'seek', path: here, s: at(754.9) })
  says('w', { t: 'ask', c: 'go', path: HOST_PATH }, { t: 'ask', c: 'subs', sub: null }, { t: 'ask', c: 'audio', audio: 'English' })
  says('sam1234567', { t: 'ask', c: 'subs', sub: 'Spanish' }, { t: 'ask', c: 'audio', audio: null }, { t: 'ask', c: 'play', path: here, s: at(10) })
  says('w', { t: 'ask', c: 'rate', path: here, s: at(10, false, 1.25) })
}

if (view === 'guest' || view === 'ended') {
  await party.join(INVITE)
  if (view === 'ended') end('unavailable')
  else {
    says(HOST, { t: 'name', name: 'Mika' }, { t: 'state', path: HOST_PATH, y: 0, grants: { all: EVERY, by: {} }, sub: 'English', audio: 'Japanese' })
    party.setPlayerTracks(TRACKS)
    says(HOST, { t: 'cursor', x: 0.4, y: 0.3 }, { t: 'chat', text: 'welcome' })
    follower('ann', { t: 'name', name: 'Alexandra' }, { t: 'ask', c: 'seek', path: HOST_PATH, s: at(3725) })
    party.send({ t: 'chat', text: 'hi' })
    for (const ask of [
      { t: 'ask', c: 'play', path: HOST_PATH, s: at(10, true) },
      { t: 'ask', c: 'rate', path: HOST_PATH, s: at(10, false, 1.5) },
      { t: 'ask', c: 'subs', sub: 'Spanish' },
      { t: 'ask', c: 'audio', audio: null },
      { t: 'ask', c: 'go', path: here },
    ] as const) party.send(ask)
    says(HOST, { t: 'ask', c: 'seek', path: HOST_PATH, s: at(9) })
  }
}

if (view === 'joining' || view === 'failed') void party.join(INVITE)

await new Promise(resolve => setTimeout(resolve, 0))
const intl = await startLanguage()
const cursor = memoryLocation({ path: HOST_PATH })
render(
  <RawIntlProvider value={intl}>
    <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem 2rem' }}><PartyWidget/></header>
    <Party/>
    <PartyChat/>
    <Router hook={cursor.hook} searchHook={cursor.searchHook}><PartyCursor/></Router>
  </RawIntlProvider>,
  document.getElementById('root')!,
)
