/** Where whether an episode's end opens the next one by itself is kept, in localStorage: `off`, or nothing for on. */
export const AUTOPLAY_KEY = 'stub.player.autoplay'

/** On unless the viewer turned it off, and on when storage cannot be read. */
export const readAutoplay = (): boolean => {
  try {
    return globalThis.localStorage.getItem(AUTOPLAY_KEY) !== 'off'
  } catch {
    return true
  }
}

export const setAutoplay = (on: boolean) => {
  try {
    if (on) globalThis.localStorage.removeItem(AUTOPLAY_KEY)
    else globalThis.localStorage.setItem(AUTOPLAY_KEY, 'off')
  } catch {}
}
