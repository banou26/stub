import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { receiveEmbedTitle } from './embed-title'
import { getPlayer } from './sources/players'
import { fromUri } from './utils/uri'

const params = new URLSearchParams(globalThis.location.search)
const mediaUri = params.get('mediaUri')
const episodeUri = params.get('episodeUri')
const sourceUri = params.get('sourceUri')
const url = params.get('url')

const origin = sourceUri ? fromUri(sourceUri as `${string}:${string}`).origin : undefined
const Player = origin ? getPlayer(origin) : undefined

const App = () => {
  const [title, setTitle] = useState<string>()
  useEffect(() => receiveEmbedTitle(setTitle), [])
  if (!mediaUri || !episodeUri || !sourceUri || !url || !Player) {
    return <div>Unsupported or missing parameters</div>
  }
  return <Player url={url} mediaUri={mediaUri} episodeUri={episodeUri} sourceUri={sourceUri} title={title} />
}

render(<App />, document.getElementById('app')!)
