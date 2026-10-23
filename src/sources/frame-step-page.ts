/**
 * Frame steps on a service's own `<video>`, run inside the service's page with `frame.evaluate`: under
 * Widevine and Clear Key the page cannot read a pixel, yet `requestVideoFrameCallback` still reports
 * every frame presented, and a paused seek of one frame moves the picture one frame (Chrome 155 and
 * Firefox 157, 2026-10-23).
 *
 * Each function is sent as its SOURCE and compiled in the page's realm, so it closes over nothing; the
 * element is named by a selector and, where it matches several, an index. What `watchVideoFrames`
 * learns stays on the element, under `Symbol.for('stub.frames')`, for the steps after it; a step takes
 * the watched element over the index, so a video the page adds ahead of it later is left alone.
 *
 * The step is @banou/media-player's (its `use-frame-step.ts`): from a pause after playing, the middle
 * of the frame after the last one presented, since Chrome often shows the next one once paused; from a
 * seek, the position plus or minus a frame, as a frame a seek presented is never read for its time
 * (Firefox reports the seek's target). The frame's length is learned from frames presented one after
 * another while playing at up to 1x.
 */

export type PageVideo = { video: string, index?: number }

type Frames = {
  played?: { mediaTime: number, presentedFrames: number }
  bySeek: boolean
  gaps: number[]
}

/** Starts following the frames the element presents, once per element. */
export const watchVideoFrames = ({ video, index = 0 }: PageVideo) => {
  const element = document.querySelectorAll<HTMLVideoElement & { [frames: symbol]: Frames }>(video)[index]
  const key = Symbol.for('stub.frames')
  if (!element || typeof element.requestVideoFrameCallback !== 'function' || element[key]) return
  const state: Frames = { bySeek: false, gaps: [] }
  element[key] = state
  element.addEventListener('seeking', () => { state.bySeek = true; state.played = undefined })
  element.addEventListener('emptied', () => { state.played = undefined; state.gaps.length = 0 })
  const onFrame = (_: number, frame: VideoFrameCallbackMetadata) => {
    const fromSeek = state.bySeek
    // the first frame once a seek has landed while playing can still be the seek's own
    if (!element.paused && !element.seeking) state.bySeek = false
    const { played } = state
    if (
      !fromSeek && !element.paused && element.playbackRate <= 1 &&
      played && frame.presentedFrames === played.presentedFrames + 1 && frame.mediaTime > played.mediaTime
    ) {
      state.gaps.push(frame.mediaTime - played.mediaTime)
      if (state.gaps.length > 60) state.gaps.shift()
    }
    state.played = fromSeek ? undefined : { mediaTime: frame.mediaTime, presentedFrames: frame.presentedFrames }
    element.requestVideoFrameCallback(onFrame)
  }
  element.requestVideoFrameCallback(onFrame)
}

/** Pauses the element if it plays, then moves it one frame back (-1) or forward (1), resolving once it has. */
export const stepVideoFrame = async ({ video, index = 0, direction }: PageVideo & { direction: 1 | -1 }) => {
  const key = Symbol.for('stub.frames')
  const elements = [...document.querySelectorAll<HTMLVideoElement & { [frames: symbol]: Frames | undefined }>(video)]
  const element = elements.find(candidate => candidate[key]) ?? elements[index]
  if (!element) return
  if (!element.paused) {
    element.pause()
    await new Promise<void>(done => {
      const timer = setTimeout(done, 100)
      element.requestVideoFrameCallback?.(() => { clearTimeout(timer); done() })
    })
  }
  const { played, gaps } = element[key] ?? { gaps: [] }
  let length = 1001 / 24000
  if (gaps.length >= 5) {
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]!
    const near = sorted.filter(gap => Math.abs(gap - median) <= median / 4)
    length = near.reduce((sum, gap) => sum + gap, 0) / near.length
  }
  const target = played
    ? played.mediaTime + (direction > 0 ? 1.5 : -0.5) * length
    : element.currentTime + direction * length
  // past the 1.3 to 1.9 s a step took in Firefox 157 under Clear Key (2026-10-23): one given up on
  // sooner was cut short by the next, and steps in a row then showed no frame at all
  const landed = new Promise<void>(done => {
    const timer = setTimeout(done, 3000)
    element.addEventListener('seeked', () => { clearTimeout(timer); done() }, { once: true })
  })
  element.currentTime = Math.max(0, Math.min(target, element.duration || target))
  await landed
}
