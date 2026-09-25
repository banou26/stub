import type { ExternalThumbnails, ThumbnailImage } from '@banou/media-player'
import type { Frame } from '@fkn/lib'
import type { BifFrame } from './bif'
import type { BifReadOptions } from './read-bif'

import { bifFrameAt, parseBif } from './bif'
import { readCrunchyrollBif } from './read-bif'

/** The player's `thumbnails`, plus the call that revokes every image url it has handed out. */
export type CrunchyrollThumbnails = ExternalThumbnails & { dispose: () => void }

// under evaluate's 30 s deadline with room to spare, and under the extension relay's 32 MiB result
// cap. A measured episode's BIF was 1.8 MB
const READ_OPTIONS: BifReadOptions = { waitMs: 10_000, fetchMs: 15_000, maxBytes: 30 * 1024 * 1024 }

/**
 * Seek previews over parsed BIF frames. `at` takes seconds, as the player asks, and makes an image's
 * object url the first time that image is asked for; `dispose` revokes them all, after which `at`
 * answers nothing, so a stale reference cannot mint a url nobody will revoke.
 */
export const createBifThumbnails = (frames: readonly BifFrame[]): CrunchyrollThumbnails => {
  const images = new Map<BifFrame, ThumbnailImage>()
  let disposed = false
  return {
    at: time => {
      if (disposed) return undefined
      const frame = bifFrameAt(frames, time * 1000)
      if (!frame) return undefined
      let image = images.get(frame)
      if (!image) {
        const url = URL.createObjectURL(new Blob([frame.bytes], { type: 'image/jpeg' }))
        image = { url, startTime: frame.start / 1000, endTime: frame.end / 1000 }
        images.set(frame, image)
      }
      return image
    },
    dispose: () => {
      disposed = true
      for (const { url } of images.values()) URL.revokeObjectURL(url)
      images.clear()
    },
  }
}

/**
 * Reads the episode's BIF out of the attached Crunchyroll page and parses it.
 *
 * Rejects whenever there is nothing to show: evaluate refused (an extension older than ABI 3, no
 * Evaluation grant), the page answered `none`, or the file did not parse. The caller treats every
 * one of those the same way, as a preview with the time only.
 */
export const loadCrunchyrollThumbnails = async (frame: Frame) => {
  const answer = await frame.evaluate(readCrunchyrollBif, READ_OPTIONS)
  if ('none' in answer) throw new Error(`no BIF: ${answer.none}${answer.detail ? ` (${answer.detail})` : ''}`)
  const frames = parseBif(answer.bytes)
  if (!frames.length) throw new Error('no BIF: the file has no images')
  return createBifThumbnails(frames)
}
