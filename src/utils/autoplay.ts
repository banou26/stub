import { settings } from '../settings-store'

/** The setting holding whether an episode's end opens the next one by itself: `off`, or nothing for on. */
export const AUTOPLAY_KEY = 'stub.player.autoplay'

/** On unless the viewer turned it off, and on when storage cannot be read. */
export const readAutoplay = (): boolean => settings.getItem(AUTOPLAY_KEY) !== 'off'

export const setAutoplay = (on: boolean) => {
  try {
    if (on) settings.removeItem(AUTOPLAY_KEY)
    else settings.setItem(AUTOPLAY_KEY, 'off')
  } catch {}
}

/** Calls `listener` whenever autoplay is turned on or off, in this tab, in another one, or on the account. */
export const watchAutoplay = (listener: () => void): () => void => settings.watch(AUTOPLAY_KEY, listener)
