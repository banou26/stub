// A picture's color code for a scene search, computed in the browser: the picture itself never leaves it.

import { ColorLayout, encodeColorLayout } from 'trace.moe-id'

/** Pixels as a canvas reads them: four bytes a pixel (red, green, blue, alpha), row by row. */
export type Pixels = { data: Uint8Array | Uint8ClampedArray, width: number, height: number }

/** A rectangle of a picture, in pixels. */
export type Box = { x: number, y: number, width: number, height: number }

// trace.moe's recommended size: a larger picture finds nothing more and costs more to read
const MAX_WIDTH = 640

// A pixel is lit above this brightness. Measured 2026-10-24: a 640x360 frame centred in a black 640x1386 phone
// screenshot trimmed back to exactly 640x360 at 24, where the untrimmed code matched the wrong show at 0.9532, above
// trace.moe's 0.9 bar. trace.moe trims bars only on an uploaded picture, never on a code.
const BAR_BRIGHTNESS = 24

// A portrait box cannot be a video frame, so there a row or column lit at no more than this share is still a bar: a
// phone's clock, battery and home indicator. Measured 2026-10-25: such a shot kept its bars under the strict rule and
// matched six wrong shows above 0.9, and at 25% it trims to exactly its frame. On landscape pictures the share would
// change 6 of 300 film stills where the strict rule changes 2, so those keep the strict rule.
const PORTRAIT_BAR_SHARE = 0.25

// the first index whose count is over `limit` and the one past the last, or nothing when none is
const span = (counts: number[], limit: number) => {
  const start = counts.findIndex(count => count > limit)
  return start < 0 ? undefined : [start, counts.findLastIndex(count => count > limit) + 1] as const
}

// the box inside the rows and columns lit at no more than `share` of their pixels, or nothing when all of them are
const trim = ({ data, width, height }: Pixels, share: number): Box | undefined => {
  const lit = (x: number, y: number) => {
    const at = (y * width + x) * 4
    return Math.max(data[at]!, data[at + 1]!, data[at + 2]!) > BAR_BRIGHTNESS
  }
  const count = (length: number, isLit: (index: number) => boolean) => {
    let lits = 0
    for (let index = 0; index < length; index++) if (isLit(index)) lits++
    return lits
  }
  const rows = span(Array.from({ length: height }, (_, y) => count(width, x => lit(x, y))), share * width)
  if (!rows) return undefined
  const [top, bottom] = rows
  const columns = span(Array.from({ length: width }, (_, x) => count(bottom - top, y => lit(x, top + y))), share * (bottom - top))
  return columns && { x: columns[0], y: top, width: columns[1] - columns[0], height: bottom - top }
}

/**
 * The picture without its black bars, or the whole picture when it is dark all over. In a portrait shot a bar may carry
 * a phone's clock and indicators.
 */
export const trimBars = (pixels: Pixels): Box => {
  const box = trim(pixels, 0) ?? { x: 0, y: 0, width: pixels.width, height: pixels.height }
  return box.width > box.height ? box : trim(pixels, PORTRAIT_BAR_SHARE) ?? box
}

/** The 28-character code trace.moe searches by: the MPEG-7 color layout of the picture inside its bars. */
export const sceneCode = (pixels: Pixels): string => {
  const box = trimBars(pixels)
  const data = new Uint8ClampedArray(box.width * box.height * 4)
  for (let y = 0; y < box.height; y++) {
    const start = ((box.y + y) * pixels.width + box.x) * 4
    data.set(pixels.data.subarray(start, start + box.width * 4), y * box.width * 4)
  }
  return encodeColorLayout(ColorLayout.extract({ data, width: box.width, height: box.height, channels: 4 }))
}

/** The code of a picture file, read at no more than 640 pixels wide. Rejects a file the browser cannot read as a picture. */
export const pictureCode = async (picture: Blob): Promise<string> => {
  const bitmap = await createImageBitmap(picture)
  const scale = Math.min(1, MAX_WIDTH / bitmap.width)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const context = new OffscreenCanvas(width, height).getContext('2d')!
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return sceneCode(context.getImageData(0, 0, width, height))
}
