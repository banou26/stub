import { PLUGIN_ORIGIN } from './watch-stage-media'

// The player tests/watch-stage.spec.ts runs where ripple's would be, inside ./watch-stage-plugin.ts: its fullscreen
// button and `f` ask the plugin, as @banou/media-player's do once the fullscreen is handed over, and show the state the
// plugin tells; `k` plays and `e` ends. `keys` lists the keys this document heard, and the button is marked
// `data-clicked` once a click has reached it.

const keys: string[] = []
Object.assign(window, { keys })

// block bodies throughout: a listener's tail call to postMessage loses its source in WebKit (HOR-1043)
const ask = (type: string) => { parent.postMessage({ type }, PLUGIN_ORIGIN) }

const button = document.createElement('button')
button.className = 'full-screen'
button.textContent = 'Fullscreen'
button.setAttribute('aria-pressed', 'false')
button.addEventListener('click', () => {
  button.dataset.clicked = ''
  ask('fullscreen')
})
document.body.append(button)

addEventListener('keydown', event => {
  keys.push(event.key)
  if (event.key === 'f') ask('fullscreen')
  else if (event.key === 'k') ask('play')
  else if (event.key === 'e') ask('end')
})
addEventListener('message', event => {
  const { fullscreen } = (event.data ?? {}) as { fullscreen?: unknown }
  if (event.source === parent && event.origin === PLUGIN_ORIGIN && typeof fullscreen === 'boolean') button.setAttribute('aria-pressed', String(fullscreen))
})
ask('ready')
