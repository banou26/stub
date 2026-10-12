import type { RemoteVideoElement } from '@fkn/lib'

type Listener = (event: { type: string }) => void
type VideoVolume = { volume: number, muted: boolean }

/**
 * @fkn/lib's handle on a `<video>` in another page, as far as its volume goes, next to that video.
 *
 * Built the way fkn-client's web-extension/src/lib/revivables/video.ts builds the handle: reads come
 * from the handle's own copy of the video's state, a write lands in that copy at once and on the
 * video one hop later, and the answer to it brings the video's state back over the copy. The video
 * fires `volumechange` as a later task and only on a change, and the handle hears it one hop after
 * that, with the video's state written into the copy before any listener runs.
 *
 * `setByPage` is the page's own player writing the video directly, which stub never sees but
 * through that `volumechange`.
 *
 * Its own listener list, since ./dom swaps the global Event for linkedom's, which node's EventTarget
 * refuses, and linkedom's target ignores the `signal` a player store detaches with.
 */
export const makeRemoteVideo = () => {
  const listeners = new Map<string, Set<Listener>>()
  const off = (type: string, listener: Listener) => { listeners.get(type)?.delete(listener) }
  const on = (type: string, listener: Listener, options?: { signal?: AbortSignal }) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(listener)
    options?.signal?.addEventListener('abort', () => off(type, listener))
  }
  const hop = (then: () => void) => { setTimeout(then, 0) }

  const video: VideoVolume = { volume: 1, muted: false }
  const copy: VideoVolume = { ...video }

  const setByPage = <K extends keyof VideoVolume>(prop: K, value: VideoVolume[K]) => {
    if (video[prop] === value) return
    video[prop] = value
    hop(() => {
      const snapshot = { ...video }
      hop(() => {
        Object.assign(copy, snapshot)
        for (const listener of listeners.get('volumechange') ?? []) listener({ type: 'volumechange' })
      })
    })
  }
  const setByHandle = <K extends keyof VideoVolume>(prop: K, value: VideoVolume[K]) => {
    copy[prop] = value
    hop(() => {
      setByPage(prop, value)
      const snapshot = { ...video }
      hop(() => { Object.assign(copy, snapshot) })
    })
  }

  const remote = Object.defineProperties({
    currentTime: 0, duration: 1_440, paused: true, readyState: 4, seeking: false, playbackRate: 1,
    play: async () => {}, pause: () => {},
    addEventListener: on, removeEventListener: off, dispatchEvent: () => true,
  }, {
    volume: { configurable: true, enumerable: true, get: () => copy.volume, set: (value: number) => setByHandle('volume', value) },
    muted: { configurable: true, enumerable: true, get: () => copy.muted, set: (value: boolean) => setByHandle('muted', value) },
  }) as unknown as RemoteVideoElement

  return { remote, video, setByPage }
}

/** Every hop the handle and the video above take has run, twice over. */
export const settle = () => new Promise(resolve => setTimeout(resolve, 20))
