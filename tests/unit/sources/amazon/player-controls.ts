/**
 * Amazon's player as its SDK draws it (ATVWebPlayerSDK-1.0, read 2026-10-26), and as it behaved on a
 * trailer signed out on primevideo.com the same day: no controls until a mousemove that moved reaches its
 * overlays; Settings opens the settings menu, or closes every open menu, after which the controls are
 * gone again; the menu's Video Quality entry opens the quality menu in its place, three radios that check
 * the one clicked. The quality menu's markup is the one measured, without its class names and images.
 * The check lands a tick after the click, as under a React that renders a click's update once the click
 * has returned (React 18; the SDK carries 16.8.6, which renders at once, but takes its React from its host).
 */
export const PRIME_PLAYER = `
  <div class="atvwebplayersdk-player-container">
    <div class="overlays">
      <div class="atvwebplayersdk-loading-overlay"></div>
      <div class="controls"></div>
    </div>
  </div>`

const QUALITIES = [
  ['good', 'Good', 'Uses about 0.38 GB per hour'],
  ['better', 'Better', 'Uses about 1.40 GB per hour'],
  ['best', 'Best', 'Uses about 6.84 GB per hour'],
]

const SETTINGS_MENU = `
  <div id="atvwebplayersdk-settings-menu" aria-label="Settings">
    <button id="atvwebplayersdk-subtitles-button" aria-label="Subtitles">Subtitles<div>Off</div></button>
    <button id="atvwebplayersdk-audio-button" aria-label="Audio">Audio<div>English</div></button>
    <button id="atvwebplayersdk-video-quality-button" aria-label="Video Quality">Video Quality<div>Best</div></button>
  </div>`

const QUALITY_MENU = `
  <div id="atvwebplayersdk-video-quality-menu" tabindex="-1" aria-label="Video Quality">
    <div><div><div><button aria-label="Close"></button></div></div><h2>Video Quality</h2></div>
    <div><div><fieldset><legend>videoQuality</legend>${QUALITIES.map(([id, name, use]) => `
      <label>
        <input type="radio" name="videoQuality" value="${id}" style="position: absolute; top: 0px; opacity: 0;">
        <div><img alt=""></div>
        <div><div><div>${name}</div><div>${use}</div></div></div>
      </label>`).join('')}
    </fieldset></div></div>
  </div>`

/**
 * Makes `document`'s `PRIME_PLAYER` behave as Amazon's, wherever it is or will be placed. `picks: false`
 * is a player that ignores a click on a quality. What the player stands at is in the state returned.
 */
export const wirePrimeControls = (document: Document, { quality = 'best', picks = true } = {}) => {
  const state = { quality, menu: 'none' as 'none' | 'settings' | 'quality', shown: false }

  const render = () => {
    const controls = document.querySelector('.controls')
    if (!controls) return
    controls.innerHTML = !state.shown ? '' : `
      <button id="atvwebplayersdk-settings-button" aria-label="Settings"></button>
      ${state.menu === 'settings' ? SETTINGS_MENU : state.menu === 'quality' ? QUALITY_MENU : ''}`
    for (const input of controls.querySelectorAll<HTMLInputElement>('input[name="videoQuality"]')) {
      Object.defineProperty(input, 'checked', { configurable: true, get: () => input.value === state.quality })
    }
  }

  document.addEventListener('mousemove', event => {
    const { movementX, movementY } = event as MouseEvent
    if (!(event.target as Element).closest('.overlays') || !(movementX || movementY)) return
    state.shown = true
    render()
  })
  document.addEventListener('click', event => {
    const target = event.target as Element
    if (target.closest('#atvwebplayersdk-settings-button')) {
      if (state.menu === 'none') state.menu = 'settings'
      else Object.assign(state, { menu: 'none', shown: false })
    } else if (target.closest('#atvwebplayersdk-video-quality-button')) {
      state.menu = 'quality'
    } else if (target.matches('input[name="videoQuality"]')) {
      const { value } = target as HTMLInputElement
      if (picks) setTimeout(() => { state.quality = value }, 0)
    } else {
      return
    }
    render()
  })

  /** Leaves `menu` open with the controls up, as a run cut short would. */
  const open = (menu: 'settings' | 'quality') => {
    Object.assign(state, { menu, shown: true })
    render()
  }

  return { state, open }
}
