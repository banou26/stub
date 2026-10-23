type Presented = { mediaTime: number, presentedFrames: number }

/**
 * A page realm's `<video>` (see crunchyroll/page-realm.ts) answering the way Chrome 155's did under
 * Widevine and Clear Key (2026-10-23): every frame presented is reported to
 * `requestVideoFrameCallback` with its time, and a seek fires `seeking`, presents the frame it lands
 * on, then fires `seeked`; with `lands` false it never lands. `writes` holds every `currentTime` set.
 */
export const pageVideo = (element: Element, { currentTime = 0, lands = true } = {}) => {
  const { Event } = element.ownerDocument.defaultView!
  let time = currentTime
  let paused = true
  let presentedFrames = 0
  let seeking = false
  const writes: number[] = []
  const callbacks: ((now: number, frame: Presented) => void)[] = []
  const fire = (type: string) => element.dispatchEvent(new Event(type))
  const present = (mediaTime: number, skipped = 0) => {
    presentedFrames += 1 + skipped
    for (const callback of callbacks.splice(0)) callback(0, { mediaTime, presentedFrames })
  }
  const state = { playbackRate: 1, afterPause: () => {} }
  Object.defineProperties(element, {
    paused: { get: () => paused },
    seeking: { get: () => seeking },
    duration: { value: 1440 },
    playbackRate: { get: () => state.playbackRate },
    currentTime: {
      get: () => time,
      set: (value: number) => {
        writes.push(value)
        time = value
        seeking = true
        fire('seeking')
        if (!lands) return
        setTimeout(() => { seeking = false; present(value); fire('seeked') }, 5)
      },
    },
    pause: { value: () => { paused = true; state.afterPause() } },
    requestVideoFrameCallback: { value: (callback: (now: number, frame: Presented) => void) => callbacks.push(callback) },
  })
  /** Plays the frames at `times`, presented one after another, and leaves the playhead a little past the last. */
  const play = (times: number[], { rate = 1, skipped = 0 } = {}) => {
    paused = false
    state.playbackRate = rate
    for (const at of times) present(at, skipped)
    time = times.at(-1)! + 0.01
  }
  return { element: element as HTMLVideoElement, writes, play, present, callbacks, fire, state }
}

/** `count` frame times `gap` apart from `from`. */
export const evenly = (from: number, gap: number, count: number) => Array.from({ length: count }, (_, n) => from + n * gap)
