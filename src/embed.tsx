import { isExtensionExposed, shell } from '@fkn/lib'
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { RawIntlProvider, useIntl } from 'react-intl'
import { trackLanguagesOf } from './embed-languages'
import { triedRelaysOf } from './embed-relays'
import { receiveEmbedTitle } from './embed-title'
import { startLanguage } from './i18n'
import { unlistedRelays } from './sources/crunchyroll/relay-check'
import { getPlayer } from './sources/players'
import { fromUri } from './utils/uri'

// the lib's default reloads this player under the viewer; the watch page framing it reloads both at its own safe moment
shell.onUpdateTaken(() => {})

const params = new URLSearchParams(globalThis.location.search)
const mediaUri = params.get('mediaUri')
const episodeUri = params.get('episodeUri')
const sourceUri = params.get('sourceUri')
const url = params.get('url')
const triedRelays = triedRelaysOf(params)
const languages = trackLanguagesOf(params)

const origin = sourceUri ? fromUri(sourceUri as `${string}:${string}`).origin : undefined
const Player = origin ? getPlayer(origin) : undefined
// asked while the page loads, so the answer is in before the player opens its frame; an extension frame
// runs on the viewer's own address and has no relay to choose
const unlisted = origin === 'cr' && url && !isExtensionExposed() ? unlistedRelays(url, triedRelays) : undefined

const App = () => {
  const intl = useIntl()
  const [title, setTitle] = useState<string>()
  useEffect(() => receiveEmbedTitle(setTitle), [])
  if (!mediaUri || !episodeUri || !sourceUri || !url || !Player) {
    return <div>{intl.formatMessage({ id: 'Unsupported or missing parameters', defaultMessage: 'Unsupported or missing parameters' })}</div>
  }
  return <Player url={url} mediaUri={mediaUri} episodeUri={episodeUri} sourceUri={sourceUri} title={title} triedRelays={triedRelays} unlistedRelays={unlisted} languages={languages} />
}

const intl = await startLanguage()

render(<RawIntlProvider value={intl}><App /></RawIntlProvider>, document.getElementById('app')!)
