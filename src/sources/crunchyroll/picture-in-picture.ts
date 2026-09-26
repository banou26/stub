import type { PassThroughPictureInPicture } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { useEffect, useMemo, useState } from 'preact/hooks'

import { enterPictureInPictureOnClick } from './cr-page'

// the element `frame.locator('video')` hands over as the player's media
const VIDEO_SELECTOR = 'video'

/**
 * Picture in picture for the Crunchyroll video, which only Crunchyroll's own document can ask for.
 *
 * @banou/media-player lets a click on its control through while the pointer is over it (see its
 * `PassThroughPictureInPicture`). This makes the frame take that click, and the page code installed
 * in the frame enters picture in picture and keeps the click from Crunchyroll. The player takes focus
 * back after the click and leaves picture in picture through the video handle itself.
 *
 * Undefined, which offers no control, until that code is installed in the current episode's document,
 * and for good where it cannot be: evaluate refused (an extension older than ABI 3), or a document
 * where picture in picture is not enabled at all.
 */
export const useCrunchyrollPictureInPicture = (
  frame: Frame | null,
  video: RemoteVideoElement | null,
  iframe: HTMLIFrameElement | null,
): PassThroughPictureInPicture | undefined => {
  const [installedFor, setInstalledFor] = useState<RemoteVideoElement | null>(null)

  // Once per video rather than per frame: every video handle comes from a freshly loaded document,
  // and the listener went away with the one before.
  useEffect(() => {
    if (!frame || !video) return
    let cancelled = false
    // async, so a frame that throws rather than rejects reads as a refusal too
    const install = async () => frame.evaluate(enterPictureInPictureOnClick, { video: VIDEO_SELECTOR })
    install().then(
      installed => { if (!cancelled && installed) setInstalledFor(video) },
      err => { if (!cancelled) console.warn('[cr] picture in picture unavailable:', err) },
    )
    return () => {
      cancelled = true
      setInstalledFor(null)
    }
  }, [frame, video])

  return useMemo(
    () => (installedFor && installedFor === video && iframe
      ? { onArmedChange: (armed: boolean) => { iframe.style.pointerEvents = armed ? 'auto' : '' } }
      : undefined),
    [installedFor, video, iframe],
  )
}
