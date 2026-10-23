import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { PageVideo } from './frame-step-page'

import { useEffect, useMemo } from 'preact/hooks'

import { stepVideoFrame, watchVideoFrames } from './frame-step-page'

/**
 * @banou/media-player's remote `stepFrame` for a video playing in a service's page: the steps are made
 * inside `frame`'s page, on the element `{ video, index }` names there, which has to be the one `remote`
 * is a handle on. Undefined until there is a video. A frame that cannot run page code (an extension
 * older than ABI 3) leaves `<` and `>` doing nothing.
 */
export const usePageFrameStep = (frame: Frame | null, remote: RemoteVideoElement | null, { video, index }: PageVideo) => {
  // once per handle: every one comes from a freshly loaded document
  useEffect(() => {
    if (!frame || !remote) return
    // async, so a frame that throws rather than rejects reads as a refusal too
    const watch = async () => frame.evaluate(watchVideoFrames, { video, index })
    watch().catch(err => console.warn('[frame step] frames not followed:', err))
  }, [frame, remote, video, index])

  return useMemo(
    () => (frame && remote
      ? async (direction: 1 | -1) => {
        try {
          await frame.evaluate(stepVideoFrame, { video, index, direction })
        } catch (err) {
          console.warn('[frame step] failed:', err)
        }
      }
      : undefined),
    [frame, remote, video, index],
  )
}
