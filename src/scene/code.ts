// A picture's color code for a scene search, computed in the browser: the picture itself never leaves it.

import { ColorLayout, encodeColorLayout } from 'trace.moe-id'

/** Pixels as a canvas reads them: four bytes a pixel (red, green, blue, alpha), row by row. */
export type Pixels = { data: Uint8Array | Uint8ClampedArray, width: number, height: number }

/** A rectangle of a picture, in pixels. */
export type Box = { x: number, y: number, width: number, height: number }

// trace.moe's recommended size: a larger picture finds nothing more and costs more to read
const MAX_WIDTH = 640

// A row or column is a bar when no pixel in it is brighter than this. Measured 2026-10-24: a 640x360 frame centred in
// a black 640x1386 phone screenshot trimmed back to exactly 640x360 at 24, where the untrimmed code matched the
// wrong show at 0.9532, above trace.moe's 0.9 bar. trace.moe trims bars only on an uploaded picture, never on a code.
const BAR_BRIGHTNESS = 24

/** The picture without its black bars, or the whole picture when it is dark all over. */
export const trimBars = ({ data, width, height }: Pixels): Box => {
  const lit = (x: number, y: number) => {
    const at = (y * width + x) * 4
    return Math.max(data[at]!, data[at + 1]!, data[at + 2]!) > BAR_BRIGHTNESS
  }
  const rowLit = (y: number) => {
    for (let x = 0; x < width; x++) if (lit(x, y)) return true
    return false
  }
  let top = 0
  while (top < height && !rowLit(top)) top++
  if (top === height) return { x: 0, y: 0, width, height }
  let bottom = height
  while (!rowLit(bottom - 1)) bottom--
  const columnLit = (x: number) => {
    for (let y = top; y < bottom; y++) if (lit(x, y)) return true
    return false
  }
  let left = 0
  while (!columnLit(left)) left++
  let right = width
  while (!columnLit(right - 1)) right--
  return { x: left, y: top, width: right - left, height: bottom - top }
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
