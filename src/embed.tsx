import { isExtensionExposed } from '@fkn/lib'
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { triedRelaysOf } from './embed-relays'
import { receiveEmbedTitle } from './embed-title'
import { unlistedRelays } from './sources/crunchyroll/relay-check'
import { getPlayer } from './sources/players'
import { fromUri } from './utils/uri'

const params = new URLSearchParams(globalThis.location.search)
const mediaUri = params.get('mediaUri')
const episodeUri = params.get('episodeUri')
const sourceUri = params.get('sourceUri')
const url = params.get('url')
const triedRelays = triedRelaysOf(params)

const origin = sourceUri ? fromUri(sourceUri as `${string}:${string}`).origin : undefined
const Player = origin ? getPlayer(origin) : undefined
// asked while the page loads, so the answer is in before the player opens its frame; an extension frame
// runs on the viewer's own address and has no relay to choose
const unlisted = origin === 'cr' && url && !isExtensionExposed() ? unlistedRelays(url, triedRelays) : undefined

const App = () => {
  const [title, setTitle] = useState<string>()
  useEffect(() => receiveEmbedTitle(setTitle), [])
  if (!mediaUri || !episodeUri || !sourceUri || !url || !Player) {
    return <div>Unsupported or missing parameters</div>
  }
  return <Player url={url} mediaUri={mediaUri} episodeUri={episodeUri} sourceUri={sourceUri} title={title} triedRelays={triedRelays} unlistedRelays={unlisted} />
}

render(<App />, document.getElementById('app')!)
