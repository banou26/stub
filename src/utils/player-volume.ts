/** Where the volume and mute the viewer last left a player at are kept, in localStorage. */
export const PLAYER_VOLUME_KEY = 'stub.player.volume'

export type PlayerVolume = { volume: number, muted: boolean }

/**
 * What a player's media has to offer for its volume to be remembered: @fkn/lib's handle on a video.
 * Not a native element, whose accessors refuse the Proxy `rememberPlayerVolume` returns as `this`.
 */
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

const writePlayerVolume = (kept: PlayerVolume) => {
  try {
    globalThis.localStorage.setItem(PLAYER_VOLUME_KEY, JSON.stringify(kept))
  } catch {}
}

/**
 * Puts the kept volume and mute on a video stub owns, and keeps every change to it until the returned function is
 * called. No other page can reach such a video, so every change is the viewer's and none is put back.
 */
export const keepVideoVolume = (video: HTMLMediaElement) => {
  const kept = readPlayerVolume()
  if (kept) Object.assign(video, kept)
  const keep = () => writePlayerVolume({ volume: video.volume, muted: video.muted })
  video.addEventListener('volumechange', keep)
  return () => video.removeEventListener('volumechange', keep)
}

export type RememberedVolume<M> = {
  /** The media for the player's controls to drive: a volume or mute written through it is the viewer's, and is kept. */
  media: M
  /**
   * `driven`, which is `media` or a wrapper around it, for the page that frames the player to drive through
   * `exposePlayer`: a volume or mute written through it is held for the episode, and never kept.
   */
  served: <D extends object>(driven: D) => D
  /** Puts the kept volume and mute on the media, and puts what is held back whenever anything else changes it, until the returned function is called. */
  hold: () => () => void
}

/**
 * The volume and mute the viewer picks, held on `media` for the whole episode and kept for the next.
 *
 * Only a write through the returned `media` is the viewer's. One through `served` is the watch party's,
 * such as the mute it falls back to when a follower's browser refuses to start the sound, and is held
 * like the viewer's without being kept. The page behind a remote video can change the volume on its own
 * after stub restored the kept one, as Crunchyroll's player does, and the `volumechange` that brings it
 * here looks like any other, so a change that does not match what is held is put back rather than kept.
 * With storage blocked or empty, nothing is held until the viewer picks something, and the media keeps
 * its own defaults.
 *
 * Video.js v10 keeps no preference itself (videojs/v10#944) and its "Remember user preferences" guide
 * leaves storage to the app. This works on the media rather than on a player store so one function
 * serves both of stub's players, its own videojs skin and @banou/media-player: each store reads the
 * media's volume when it attaches and follows `volumechange` after, so the restore reaches the controls
 * whichever runs first.
 */
export const rememberPlayerVolume = <M extends VolumeMedia>(media: M): RememberedVolume<M> => {
  let held: PlayerVolume | undefined
  let byViewer = true
  const restore = () => {
    if (!held) return
    if (media.volume !== held.volume) media.volume = held.volume
    if (media.muted !== held.muted) media.muted = held.muted
  }
  return {
    media: new Proxy(media, {
      set: (target, prop, value) => {
        if (!Reflect.set(target, prop, value)) return false
        if (prop === 'volume' || prop === 'muted') {
          held = { ...(held ?? { volume: target.volume, muted: target.muted }), [prop]: value }
          if (byViewer) writePlayerVolume(held)
        }
        return true
      },
    }),
    // a write through any wrapper reaches the trap above synchronously, so the flag covers that write alone
    served: driven => new Proxy(driven, {
      set: (target, prop, value) => {
        byViewer = false
        try {
          return Reflect.set(target, prop, value)
        } finally {
          byViewer = true
        }
      },
    }),
    hold: () => {
      held ??= readPlayerVolume()
      restore()
      media.addEventListener('volumechange', restore)
      return () => media.removeEventListener('volumechange', restore)
    },
  }
}
