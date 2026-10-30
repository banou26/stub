import { PLUGIN_ORIGIN } from './watch-stage-media'

// The player tests/watch-stage.spec.ts runs where ripple's would be, inside ./watch-stage-plugin.ts: its fullscreen
// button and `f` ask the plugin, as @banou/media-player's do once the fullscreen is handed over, and show the state the
// plugin tells; `k` plays and `e` ends. `keys` lists the keys this document heard, and the button is marked
// `data-clicked` once a click has reached it. Its document's load waits for `/late.png`, which tests/watch-stage.spec.ts
// can hold back. Its Skip Ending is up from the start and goes once the plugin has asked and `k` has played, so a test
// can see it and play while it is up, 300 ms later, as a far player's takes a round trip and a render, leaving
// `skipGoneAt` and telling the plugin.

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
const skip = document.createElement('button')
skip.className = 'skip-chapter'
skip.textContent = 'Skip Ending'
let endingAsked = false
let played = false
const leaveEnding = () => {
  if (!endingAsked || !played) return
  setTimeout(() => {
    if (!skip.isConnected) return
    skip.remove()
    Object.assign(window, { skipGoneAt: Date.now() })
    ask('skip-gone')
  }, 300)
}
document.body.append(button, skip)
const late = new Image()
late.src = '/late.png'
document.body.append(late)

addEventListener('keydown', event => {
  keys.push(event.key)
  if (event.key === 'f') ask('fullscreen')
  else if (event.key === 'k') {
    ask('play')
    played = true
    leaveEnding()
  } else if (event.key === 'e') ask('end')
})
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== PLUGIN_ORIGIN) return
  const { fullscreen, offered } = (event.data ?? {}) as { fullscreen?: unknown, offered?: unknown }
  if (typeof fullscreen === 'boolean') button.setAttribute('aria-pressed', String(fullscreen))
  if (offered === false) {
    endingAsked = true
    leaveEnding()
  }
})
ask('ready')
