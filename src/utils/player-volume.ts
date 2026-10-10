/** Where the volume and mute the viewer last left an episode player at are kept, in localStorage. */
export const PLAYER_VOLUME_KEY = 'stub.player.volume'

export type PlayerVolume = { volume: number, muted: boolean }

/** What a player's media has to offer for its volume to be remembered: a video element, or a handle on one. */
export type VolumeMedia = {
  volume: number
  muted: boolean
  addEventListener: (type: 'volumechange', listener: () => void) => void
  removeEventListener: (type: 'volumechange', listener: () => void) => void
}

/** The kept volume, or undefined when nothing usable is kept or storage cannot be read. */
export const readPlayerVolume = (): PlayerVolume | undefined => {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage.getItem(PLAYER_VOLUME_KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return undefined
    const { volume, muted } = saved as Partial<Record<keyof PlayerVolume, unknown>>
    return typeof volume === 'number' && volume >= 0 && volume <= 1 && typeof muted === 'boolean'
      ? { volume, muted }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Puts the kept volume and mute on `media`, then keeps every change made to them until the returned
 * function is called.
 *
 * Video.js v10 keeps no preference itself (videojs/v10#944) and its "Remember user preferences" guide
 * leaves storage to the app. This works on the media rather than on a player store so one function
 * serves both of stub's players, its own videojs skin and @banou/media-player: each store reads the
 * media's volume when it attaches and follows `volumechange` after, so the restore reaches the controls
 * whichever runs first. With storage blocked or empty, the media keeps its own defaults.
 */
export const rememberPlayerVolume = (media: VolumeMedia): () => void => {
  const saved = readPlayerVolume()
  if (saved) {
    media.volume = saved.volume
    media.muted = saved.muted
  }
  const save = () => {
    try {
      globalThis.localStorage.setItem(PLAYER_VOLUME_KEY, JSON.stringify({ volume: media.volume, muted: media.muted }))
    } catch {}
  }
  media.addEventListener('volumechange', save)
  return () => media.removeEventListener('volumechange', save)
}
